import * as crypto from 'crypto';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { defineSecret, defineString } from 'firebase-functions/params';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

initializeApp();

const db = getFirestore();
const region = 'us-central1';

const mpClientId = defineString('MP_CLIENT_ID');
const mpRedirectUri = defineString('MP_REDIRECT_URI');
const mpWebhookUrl = defineString('MP_WEBHOOK_URL');
const publicAppUrl = defineString('PUBLIC_APP_URL');
const mpMarketplaceFeePercent = defineString('MP_MARKETPLACE_FEE_PERCENT');
const mpMarketplaceFeeFixed = defineString('MP_MARKETPLACE_FEE_FIXED');
const mpClientSecret = defineSecret('MP_CLIENT_SECRET');
const mpWebhookSecret = defineSecret('MP_WEBHOOK_SECRET');

type UserProfile = {
  role?: string;
  organizationId?: string;
  email?: string;
};

type MercadoPagoTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in: number;
  scope?: string;
  user_id: number;
  refresh_token: string;
  public_key?: string;
  live_mode?: boolean;
};

type MercadoPagoConnectionSecret = {
  accessToken: string;
  refreshToken: string;
  userId: number;
  publicKey?: string;
  expiresAt?: Timestamp;
};

type MercadoPagoPreferenceResponse = {
  id: string;
  init_point?: string;
  sandbox_init_point?: string;
};

type MercadoPagoPayment = {
  id: number | string;
  status?: string;
  status_detail?: string;
  external_reference?: string;
  transaction_amount?: number;
  marketplace_fee?: number;
  metadata?: Record<string, unknown>;
};

function getParam(param: ReturnType<typeof defineString>, fallback = '') {
  const value = param.value();
  return value || fallback;
}

function requireParam(name: string, value: string) {
  if (!value) {
    throw new HttpsError('failed-precondition', `Falta configurar ${name} en Firebase Functions.`);
  }
  return value;
}

async function requireUser(uid: string) {
  const snapshot = await db.doc(`users/${uid}`).get();
  if (!snapshot.exists) {
    throw new HttpsError('permission-denied', 'No existe perfil de usuario.');
  }
  return snapshot.data() as UserProfile;
}

async function requireOrganizationAdmin(uid: string, organizationId: string) {
  const profile = await requireUser(uid);
  if (profile.role !== 'admin' || profile.organizationId !== organizationId) {
    throw new HttpsError('permission-denied', 'Solo un administrador de este negocio puede realizar esta accion.');
  }
  return profile;
}

async function requireOrganizationMember(uid: string, organizationId: string) {
  const profile = await requireUser(uid);
  if (profile.organizationId !== organizationId) {
    throw new HttpsError('permission-denied', 'El usuario no pertenece a este negocio.');
  }
  return profile;
}

function randomBase64Url(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256Base64Url(value: string) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function parseNumberParam(param: ReturnType<typeof defineString>, fallback = 0) {
  const parsed = Number(param.value() || fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function calculateMarketplaceFee(amount: number) {
  const percent = Math.max(0, parseNumberParam(mpMarketplaceFeePercent, 0));
  const fixed = Math.max(0, parseNumberParam(mpMarketplaceFeeFixed, 0));
  const fee = Math.round((amount * (percent / 100) + fixed) * 100) / 100;
  return Math.min(amount, fee);
}

function privateConnectionRef(organizationId: string) {
  return db.doc(`organizations/${organizationId}/private/mercadopago`);
}

function publicConnectionRef(organizationId: string) {
  return db.doc(`organizations/${organizationId}/paymentConnections/mercadopago`);
}

function oauthStateRef(organizationId: string, state: string) {
  return db.doc(`organizations/${organizationId}/mercadoPagoOAuthStates/${state}`);
}

async function mercadoPagoRequest<T>(path: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string; error?: string };
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Mercado Pago respondio ${response.status}`);
  }
  return payload;
}

async function exchangeOAuthToken(body: Record<string, unknown>) {
  const response = await fetch('https://api.mercadopago.com/oauth/token', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as MercadoPagoTokenResponse & { message?: string; error?: string };
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Mercado Pago OAuth respondio ${response.status}`);
  }
  return payload;
}

async function saveMercadoPagoConnection(organizationId: string, token: MercadoPagoTokenResponse) {
  const expiresAt = Timestamp.fromMillis(Date.now() + token.expires_in * 1000);
  const privatePayload = {
    provider: 'mercado_pago',
    connected: true,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenType: token.token_type ?? 'bearer',
    scope: token.scope ?? '',
    userId: token.user_id,
    publicKey: token.public_key ?? '',
    liveMode: Boolean(token.live_mode),
    expiresAt,
    updatedAt: FieldValue.serverTimestamp(),
  };
  const publicPayload = {
    provider: 'mercado_pago',
    connected: true,
    userId: token.user_id,
    publicKey: token.public_key ?? '',
    liveMode: Boolean(token.live_mode),
    expiresAt,
    connectedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await Promise.all([
    privateConnectionRef(organizationId).set(privatePayload, { merge: true }),
    publicConnectionRef(organizationId).set(publicPayload, { merge: true }),
  ]);
}

async function refreshMercadoPagoConnection(organizationId: string, connection: MercadoPagoConnectionSecret) {
  const token = await exchangeOAuthToken({
    client_id: requireParam('MP_CLIENT_ID', getParam(mpClientId)),
    client_secret: mpClientSecret.value(),
    grant_type: 'refresh_token',
    refresh_token: connection.refreshToken,
  });
  await saveMercadoPagoConnection(organizationId, token);
  await publicConnectionRef(organizationId).set({ lastRefreshAt: FieldValue.serverTimestamp() }, { merge: true });
  return token.access_token;
}

async function getValidSellerAccessToken(organizationId: string) {
  const snapshot = await privateConnectionRef(organizationId).get();
  if (!snapshot.exists) {
    throw new HttpsError('failed-precondition', 'Este negocio todavia no conecto Mercado Pago.');
  }
  const connection = snapshot.data() as MercadoPagoConnectionSecret;
  const expiresAt = connection.expiresAt?.toMillis?.() ?? 0;
  if (!connection.accessToken || !connection.refreshToken) {
    throw new HttpsError('failed-precondition', 'La conexion de Mercado Pago esta incompleta.');
  }
  if (expiresAt && expiresAt < Date.now() + 7 * 24 * 60 * 60 * 1000) {
    return refreshMercadoPagoConnection(organizationId, connection);
  }
  return connection.accessToken;
}

export const createMercadoPagoOAuthUrl = onCall({ region }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Inicia sesion para conectar Mercado Pago.');
  }

  const organizationId = String(request.data?.organizationId ?? '');
  if (!organizationId) {
    throw new HttpsError('invalid-argument', 'Falta organizationId.');
  }
  await requireOrganizationAdmin(request.auth.uid, organizationId);

  const clientId = requireParam('MP_CLIENT_ID', getParam(mpClientId));
  const redirectUri = requireParam('MP_REDIRECT_URI', getParam(mpRedirectUri));
  const state = randomBase64Url(32);
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = sha256Base64Url(codeVerifier);

  await oauthStateRef(organizationId, state).set({
    state,
    organizationId,
    adminId: request.auth.uid,
    codeVerifier,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
    used: false,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    platform_id: 'mp',
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return {
    authorizationUrl: `https://auth.mercadopago.com.mx/authorization?${params.toString()}`,
  };
});

export const disconnectMercadoPago = onCall({ region }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Inicia sesion para desconectar Mercado Pago.');
  }
  const organizationId = String(request.data?.organizationId ?? '');
  if (!organizationId) {
    throw new HttpsError('invalid-argument', 'Falta organizationId.');
  }
  await requireOrganizationAdmin(request.auth.uid, organizationId);

  await Promise.all([
    privateConnectionRef(organizationId).delete(),
    publicConnectionRef(organizationId).set(
      {
        connected: false,
        disconnectedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    ),
  ]);

  return { connected: false };
});

export const mercadoPagoOAuthCallback = onRequest({ region, secrets: [mpClientSecret] }, async (req, res) => {
  const code = String(req.query.code ?? '');
  const state = String(req.query.state ?? '');

  if (!code || !state) {
    res.status(400).send('Falta code o state.');
    return;
  }

  const states = await db.collectionGroup('mercadoPagoOAuthStates').where('state', '==', state).limit(1).get();
  if (states.empty) {
    res.status(400).send('State invalido o expirado.');
    return;
  }

  const stateDoc = states.docs[0];
  const stateData = stateDoc.data() as { organizationId?: string; codeVerifier?: string; expiresAt?: Timestamp; used?: boolean };
  const organizationId = stateData.organizationId;

  if (!organizationId || stateData.used || (stateData.expiresAt?.toMillis?.() ?? 0) < Date.now()) {
    res.status(400).send('La autorizacion expiro. Vuelve a conectar Mercado Pago desde la app.');
    return;
  }

  try {
    const token = await exchangeOAuthToken({
      client_id: requireParam('MP_CLIENT_ID', getParam(mpClientId)),
      client_secret: mpClientSecret.value(),
      code,
      grant_type: 'authorization_code',
      redirect_uri: requireParam('MP_REDIRECT_URI', getParam(mpRedirectUri)),
      code_verifier: stateData.codeVerifier,
    });
    await saveMercadoPagoConnection(organizationId, token);
    await stateDoc.ref.set({ used: true, usedAt: FieldValue.serverTimestamp() }, { merge: true });

    res.status(200).send(`
      <html>
        <body style="font-family: system-ui; padding: 32px;">
          <h1>Mercado Pago conectado</h1>
          <p>Ya puedes volver a ServiCitas. Los anticipos de este negocio se cobraran con esta cuenta.</p>
        </body>
      </html>
    `);
  } catch (error) {
    logger.error('Error OAuth Mercado Pago', error);
    res.status(500).send('No se pudo conectar Mercado Pago. Revisa logs de Firebase Functions.');
  }
});

export const createDepositPreference = onCall({ region, secrets: [mpClientSecret] }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Inicia sesion para pagar.');
  }

  const organizationId = String(request.data?.organizationId ?? '');
  const appointmentId = String(request.data?.appointmentId ?? '');
  if (!organizationId || !appointmentId) {
    throw new HttpsError('invalid-argument', 'Faltan organizationId o appointmentId.');
  }

  const profile = await requireOrganizationMember(request.auth.uid, organizationId);
  const appointmentRef = db.doc(`organizations/${organizationId}/appointments/${appointmentId}`);
  const appointmentSnapshot = await appointmentRef.get();
  if (!appointmentSnapshot.exists) {
    throw new HttpsError('not-found', 'No encontramos la cita.');
  }

  const appointment = appointmentSnapshot.data() as {
    clientId?: string;
    clientName?: string;
    date?: string;
    time?: string;
    total?: number;
    deposit?: number;
    requiresDeposit?: boolean;
    paymentStatus?: string;
    status?: string;
  };

  if (profile.role === 'client' && appointment.clientId !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'Solo el cliente de la cita puede pagar este anticipo.');
  }
  if (!appointment.requiresDeposit || !appointment.deposit || appointment.deposit <= 0) {
    throw new HttpsError('failed-precondition', 'Esta cita no requiere anticipo.');
  }
  if (appointment.paymentStatus === 'paid') {
    throw new HttpsError('failed-precondition', 'Esta cita ya tiene anticipo pagado.');
  }
  if (['completed', 'lost', 'cancelled'].includes(appointment.status ?? '')) {
    throw new HttpsError('failed-precondition', 'No se puede pagar una cita cerrada.');
  }

  const sellerAccessToken = await getValidSellerAccessToken(organizationId);
  const amount = Math.round(Number(appointment.deposit) * 100) / 100;
  const marketplaceFee = calculateMarketplaceFee(amount);
  const webhookUrl = requireParam('MP_WEBHOOK_URL', getParam(mpWebhookUrl));
  const appUrl = getParam(publicAppUrl, 'https://servicitas-studio.web.app');
  const notificationUrl = `${webhookUrl}?organizationId=${encodeURIComponent(organizationId)}&appointmentId=${encodeURIComponent(appointmentId)}`;

  const preferenceBody: Record<string, unknown> = {
    items: [
      {
        id: appointmentId,
        title: `Anticipo cita ${appointment.clientName ?? ''}`.trim(),
        description: `Cita ${appointment.date ?? ''} ${appointment.time ?? ''}`.trim(),
        currency_id: 'MXN',
        quantity: 1,
        unit_price: amount,
      },
    ],
    external_reference: `appointment:${organizationId}:${appointmentId}`,
    notification_url: notificationUrl,
    back_urls: {
      success: `${appUrl}/payment/success`,
      failure: `${appUrl}/payment/failure`,
      pending: `${appUrl}/payment/pending`,
    },
    metadata: {
      organization_id: organizationId,
      appointment_id: appointmentId,
      client_id: appointment.clientId ?? '',
    },
  };

  if (marketplaceFee > 0) {
    preferenceBody.marketplace_fee = marketplaceFee;
  }

  const preference = await mercadoPagoRequest<MercadoPagoPreferenceResponse>('/checkout/preferences', sellerAccessToken, {
    method: 'POST',
    body: JSON.stringify(preferenceBody),
  });

  await appointmentRef.set(
    {
      paymentProvider: 'mercado_pago',
      paymentStatus: 'pending',
      paymentMethod: 'card',
      paymentReference: preference.id,
      mercadoPagoPreferenceId: preference.id,
      marketplaceFee,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    preferenceId: preference.id,
    checkoutUrl: preference.init_point ?? preference.sandbox_init_point ?? '',
    sandboxCheckoutUrl: preference.sandbox_init_point,
  };
});

type WebhookRequest = {
  query: Record<string, unknown>;
  body?: { data?: { id?: unknown }; id?: unknown };
  header(name: string): string | undefined;
};

function getWebhookDataId(req: WebhookRequest) {
  const queryDataId = req.query['data.id'] ?? req.query.id;
  return String(queryDataId ?? req.body?.data?.id ?? req.body?.id ?? '').toLowerCase();
}

function validateMercadoPagoSignature(req: WebhookRequest) {
  const secret = mpWebhookSecret.value();
  if (!secret) return true;

  const xSignature = String(req.header('x-signature') ?? '');
  const xRequestId = String(req.header('x-request-id') ?? '');
  const dataId = getWebhookDataId(req);
  if (!xSignature || !xRequestId || !dataId) return false;

  const parts = Object.fromEntries(
    xSignature.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key?.trim(), value?.trim()];
    }),
  );
  const ts = parts.ts;
  const hash = parts.v1;
  if (!ts || !hash) return false;

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  if (expected.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash));
}

export const mercadoPagoWebhook = onRequest({ region, secrets: [mpWebhookSecret, mpClientSecret] }, async (req, res) => {
  if (!validateMercadoPagoSignature(req)) {
    res.status(401).send('Firma invalida.');
    return;
  }

  const organizationId = String(req.query.organizationId ?? '');
  const appointmentId = String(req.query.appointmentId ?? '');
  const paymentId = getWebhookDataId(req);

  if (!organizationId || !appointmentId || !paymentId) {
    res.status(200).send('Webhook recibido sin datos accionables.');
    return;
  }

  try {
    const sellerAccessToken = await getValidSellerAccessToken(organizationId);
    const payment = await mercadoPagoRequest<MercadoPagoPayment>(`/v1/payments/${paymentId}`, sellerAccessToken);
    const expectedReference = `appointment:${organizationId}:${appointmentId}`;
    const metadata = payment.metadata ?? {};

    if (payment.external_reference !== expectedReference && metadata.appointment_id !== appointmentId) {
      logger.warn('Webhook Mercado Pago no coincide con cita esperada', { organizationId, appointmentId, paymentId });
      res.status(202).send('Pago no corresponde a esta cita.');
      return;
    }

    const appointmentRef = db.doc(`organizations/${organizationId}/appointments/${appointmentId}`);
    const approved = payment.status === 'approved';
    const update: Record<string, unknown> = {
      paymentProvider: 'mercado_pago',
      mercadoPagoPaymentId: String(payment.id),
      paymentReference: String(payment.id),
      paymentStatusDetail: payment.status_detail ?? '',
      marketplaceFee: payment.marketplace_fee ?? 0,
      lastPaymentWebhookAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (approved) {
      update.paymentStatus = 'paid';
      update.paidAt = FieldValue.serverTimestamp();
      update.status = 'confirmed';
    } else if (payment.status === 'refunded') {
      update.paymentStatus = 'refunded';
      update.refundStatus = 'refunded';
    } else {
      update.paymentStatus = 'pending';
    }

    await db.runTransaction(async (transaction) => {
      transaction.set(db.doc(`organizations/${organizationId}/paymentEvents/${paymentId}`), {
        provider: 'mercado_pago',
        paymentId: String(payment.id),
        status: payment.status ?? '',
        statusDetail: payment.status_detail ?? '',
        externalReference: payment.external_reference ?? '',
        receivedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(appointmentRef, update, { merge: true });
    });

    res.status(200).send('OK');
  } catch (error) {
    logger.error('Error procesando webhook Mercado Pago', error);
    res.status(500).send('Error interno.');
  }
});

export const refreshMercadoPagoTokens = onSchedule({ region, schedule: 'every 24 hours', secrets: [mpClientSecret] }, async () => {
  const limit = Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const snapshots = await db.collectionGroup('private').where('provider', '==', 'mercado_pago').where('expiresAt', '<=', limit).get();

  await Promise.all(
    snapshots.docs.map(async (snapshot) => {
      const organizationId = snapshot.ref.parent.parent?.id;
      if (!organizationId) return;
      try {
        await refreshMercadoPagoConnection(organizationId, snapshot.data() as MercadoPagoConnectionSecret);
      } catch (error) {
        logger.error('No se pudo renovar token Mercado Pago', { organizationId, error });
      }
    }),
  );
});
