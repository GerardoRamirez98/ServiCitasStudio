import * as crypto from 'crypto';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { defineSecret, defineString } from 'firebase-functions/params';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
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
  name?: string;
  employeeId?: string;
};

type CreateAppointmentInput = {
  organizationId?: string;
  clientId?: string;
  clientName?: string;
  date?: string;
  time?: string;
  duration?: number;
  serviceIds?: string[];
  employeeId?: string;
  note?: string;
  source?: 'client' | 'manual';
  total?: number;
  subtotal?: number;
  deposit?: number;
  requiresDeposit?: boolean;
  depositPercent?: number;
  paymentMethod?: string;
  requestedDepositPaymentMethod?: string;
  specialPrice?: number | null;
  discountAmount?: number;
  discountReason?: string;
  termsAccepted?: boolean;
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
  if (!['owner', 'admin'].includes(profile.role ?? '') || profile.organizationId !== organizationId) {
    throw new HttpsError('permission-denied', 'Solo un administrador de este negocio puede realizar esta accion.');
  }
  return profile;
}

async function requireAppointmentWriter(uid: string, organizationId: string, source: string) {
  const profile = await requireUser(uid);
  if (profile.organizationId !== organizationId) {
    throw new HttpsError('permission-denied', 'El usuario no pertenece a este negocio.');
  }
  const manualRoles = ['owner', 'admin', 'manager', 'receptionist', 'employee'];
  if (source === 'manual' && !manualRoles.includes(profile.role ?? '')) {
    throw new HttpsError('permission-denied', 'No tienes permisos para crear citas manuales.');
  }
  if (source === 'client' && profile.role !== 'client') {
    throw new HttpsError('permission-denied', 'Solo clientes pueden crear esta solicitud.');
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

function parseTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function addMinutes(time: string, minutesToAdd: number) {
  const start = parseTime(time);
  if (start === null) return time;
  const value = start + minutesToAdd;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function overlaps(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && endA > startB;
}

function validateCreateAppointmentInput(data: CreateAppointmentInput) {
  const organizationId = String(data.organizationId ?? '');
  const source = data.source ?? 'client';
  const date = String(data.date ?? '');
  const time = String(data.time ?? '');
  const duration = Number(data.duration ?? 0);
  const serviceIds = Array.isArray(data.serviceIds) ? data.serviceIds.map(String).filter(Boolean) : [];
  const total = Number(data.total ?? 0);

  if (!organizationId) throw new HttpsError('invalid-argument', 'Falta organizationId.');
  if (!['client', 'manual'].includes(source)) throw new HttpsError('invalid-argument', 'Origen de cita invalido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpsError('invalid-argument', 'Fecha invalida.');
  if (parseTime(time) === null) throw new HttpsError('invalid-argument', 'Hora invalida.');
  if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 60) throw new HttpsError('invalid-argument', 'Duracion invalida.');
  if (!serviceIds.length) throw new HttpsError('invalid-argument', 'Selecciona al menos un servicio.');
  if (!String(data.clientName ?? '').trim()) throw new HttpsError('invalid-argument', 'Falta nombre del cliente.');
  if (!Number.isFinite(total) || total < 0) throw new HttpsError('invalid-argument', 'Total invalido.');
  if (!data.termsAccepted) throw new HttpsError('failed-precondition', 'Debes aceptar los terminos de la cita.');

  return { organizationId, source, date, time, duration, serviceIds, total };
}

async function collectPushTokens(userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  const tokenSnapshots = await Promise.all(uniqueUserIds.map((uid) => db.collection(`users/${uid}/pushTokens`).get()));
  return tokenSnapshots.flatMap((snapshot) => snapshot.docs.map((docSnapshot) => String(docSnapshot.data().token ?? '')).filter(Boolean));
}

async function sendExpoPush(tokens: string[], title: string, body: string, data: Record<string, string>) {
  if (!tokens.length) return;
  const messages = tokens.map((to) => ({ to, title, body, data, sound: 'default' }));
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(messages),
  });
  if (!response.ok) {
    logger.warn('Expo push respondio con error', { status: response.status, body: await response.text().catch(() => '') });
  }
}

async function organizationAdminUserIds(organizationId: string) {
  const snapshot = await db
    .collection('users')
    .where('organizationId', '==', organizationId)
    .where('role', 'in', ['owner', 'admin', 'manager'])
    .get();
  return snapshot.docs.map((docSnapshot) => docSnapshot.id);
}

export const createAppointment = onCall({ region }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Inicia sesion para crear una cita.');
  }
  const uid = request.auth.uid;

  const data = request.data as CreateAppointmentInput;
  const normalized = validateCreateAppointmentInput(data);
  const profile = await requireAppointmentWriter(uid, normalized.organizationId, normalized.source);
  const requestedEmployeeId = String(data.employeeId ?? '');
  const requestedStart = parseTime(normalized.time);
  if (requestedStart === null) throw new HttpsError('invalid-argument', 'Hora invalida.');
  const requestedEnd = requestedStart + normalized.duration;

  const appointmentRef = db.collection(`organizations/${normalized.organizationId}/appointments`).doc();
  const result = await db.runTransaction(async (transaction) => {
    const employeesQuery = db
      .collection(`organizations/${normalized.organizationId}/employees`)
      .where('active', '==', true);
    const employeesSnapshot = await transaction.get(employeesQuery);
    const employeeIds = employeesSnapshot.docs.map((docSnapshot) => docSnapshot.id).filter((id) => !requestedEmployeeId || id === requestedEmployeeId);
    if (!employeeIds.length) {
      throw new HttpsError('failed-precondition', 'No hay empleados activos disponibles.');
    }

    const appointmentsQuery = requestedEmployeeId
      ? db
          .collection(`organizations/${normalized.organizationId}/appointments`)
          .where('date', '==', normalized.date)
          .where('employeeId', '==', requestedEmployeeId)
      : db.collection(`organizations/${normalized.organizationId}/appointments`).where('date', '==', normalized.date);
    const appointmentsSnapshot = await transaction.get(appointmentsQuery);
    const busyEmployeeIds = new Set<string>();
    appointmentsSnapshot.docs.forEach((docSnapshot) => {
      const appointment = docSnapshot.data();
      if (['completed', 'lost', 'cancelled'].includes(String(appointment.status ?? ''))) return;
      const start = parseTime(String(appointment.time ?? ''));
      const duration = Number(appointment.duration ?? 60);
      if (start === null || !Number.isFinite(duration)) return;
      if (overlaps(requestedStart, requestedEnd, start, start + duration)) {
        busyEmployeeIds.add(String(appointment.employeeId ?? ''));
      }
    });

    const assignedEmployeeId = requestedEmployeeId || employeeIds.find((id) => !busyEmployeeIds.has(id));
    if (!assignedEmployeeId || busyEmployeeIds.has(assignedEmployeeId)) {
      throw new HttpsError('already-exists', 'Ese horario acaba de ocuparse. Selecciona otro disponible.');
    }

    const requiresDeposit = Boolean(data.requiresDeposit);
    const deposit = Math.max(0, Number(data.deposit ?? 0));
    const paymentMethod = String(data.paymentMethod ?? 'none');
    const automaticMp = requiresDeposit && deposit > 0 && !['transfer', 'cash', 'none'].includes(paymentMethod);

    transaction.set(appointmentRef, {
      clientId: normalized.source === 'client' ? uid : String(data.clientId ?? 'manual'),
      clientName: String(data.clientName ?? profile.name ?? '').trim(),
      date: normalized.date,
      time: normalized.time,
      endTime: addMinutes(normalized.time, normalized.duration),
      duration: normalized.duration,
      serviceIds: normalized.serviceIds,
      employeeId: assignedEmployeeId,
      status: normalized.source === 'manual' ? 'confirmed' : 'pending',
      note: String(data.note ?? '').trim() || (normalized.source === 'manual' ? 'Cita creada manualmente.' : 'Sin nota.'),
      deposit,
      requiresDeposit,
      depositPercent: requiresDeposit ? Number(data.depositPercent ?? 0) : 0,
      paymentStatus: requiresDeposit && deposit > 0 ? 'pending' : normalized.source === 'manual' ? 'offline' : 'not_required',
      paymentMethod: requiresDeposit && deposit > 0 ? paymentMethod : normalized.source === 'manual' ? 'cash' : 'none',
      requestedDepositPaymentMethod: data.requestedDepositPaymentMethod ?? paymentMethod,
      paymentProvider: automaticMp ? 'mercado_pago' : 'none',
      refundStatus: 'not_applicable',
      subtotal: Number(data.subtotal ?? normalized.total),
      specialPrice: data.specialPrice ?? null,
      discountAmount: Number(data.discountAmount ?? 0),
      discountReason: String(data.discountReason ?? ''),
      total: normalized.total,
      termsAccepted: true,
      serviceRightForfeited: false,
      source: normalized.source,
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { appointmentId: appointmentRef.id, employeeId: assignedEmployeeId };
  });

  logger.info('Cita creada atomicamente', { organizationId: normalized.organizationId, appointmentId: result.appointmentId });
  return result;
});

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

export const notifyAppointmentCreated = onDocumentCreated(
  { region, document: 'organizations/{organizationId}/appointments/{appointmentId}' },
  async (event) => {
    const appointment = event.data?.data();
    if (!appointment) return;
    const organizationId = String(event.params.organizationId);
    const appointmentId = String(event.params.appointmentId);
    const employeeId = String(appointment.employeeId ?? '');
    const clientId = String(appointment.clientId ?? '');
    const employeeSnapshot = employeeId ? await db.doc(`organizations/${organizationId}/employees/${employeeId}`).get() : null;
    const employeeUserId = String(employeeSnapshot?.data()?.userId ?? '');
    const adminIds = await organizationAdminUserIds(organizationId);

    const adminTokens = await collectPushTokens(adminIds);
    await sendExpoPush(adminTokens, 'Nueva cita', `${appointment.clientName ?? 'Cliente'} agendo para ${appointment.date} ${appointment.time}.`, {
      organizationId,
      appointmentId,
      type: 'admin_new_appointment',
    });

    const employeeTokens = await collectPushTokens([employeeUserId]);
    await sendExpoPush(employeeTokens, 'Nueva cita asignada', `${appointment.clientName ?? 'Cliente'} te fue asignado el ${appointment.date} a las ${appointment.time}.`, {
      organizationId,
      appointmentId,
      type: 'employee_new_appointment',
    });

    const clientTokens = await collectPushTokens([clientId]);
    await sendExpoPush(clientTokens, 'Cita recibida', `Tu cita para ${appointment.date} ${appointment.time} quedo en revision.`, {
      organizationId,
      appointmentId,
      type: 'client_appointment_created',
    });
  },
);

export const notifyAppointmentUpdated = onDocumentUpdated(
  { region, document: 'organizations/{organizationId}/appointments/{appointmentId}' },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    const organizationId = String(event.params.organizationId);
    const appointmentId = String(event.params.appointmentId);
    const clientId = String(after.clientId ?? '');
    const employeeId = String(after.employeeId ?? '');
    const employeeSnapshot = employeeId ? await db.doc(`organizations/${organizationId}/employees/${employeeId}`).get() : null;
    const employeeUserId = String(employeeSnapshot?.data()?.userId ?? '');

    if (before.status !== after.status) {
      if (after.status === 'confirmed') {
        await sendExpoPush(await collectPushTokens([clientId]), 'Cita confirmada', `Tu cita del ${after.date} a las ${after.time} fue confirmada.`, {
          organizationId,
          appointmentId,
          type: 'client_appointment_confirmed',
        });
      }
      if (after.status === 'cancelled') {
        const tokens = await collectPushTokens([clientId, employeeUserId, ...(await organizationAdminUserIds(organizationId))]);
        await sendExpoPush(tokens, 'Cita cancelada', `La cita de ${after.clientName ?? 'cliente'} fue cancelada.`, {
          organizationId,
          appointmentId,
          type: 'appointment_cancelled',
        });
      }
      if (after.status === 'waiting' && after.delayNotice) {
        await sendExpoPush(await collectPushTokens([clientId]), 'Aviso de demora', String(after.delayNotice), {
          organizationId,
          appointmentId,
          type: 'client_delay_notice',
        });
      }
    }

    if (before.time !== after.time || before.employeeId !== after.employeeId) {
      const tokens = await collectPushTokens([clientId, employeeUserId]);
      await sendExpoPush(tokens, 'Cambio de horario', `Tu cita ahora esta para ${after.date} ${after.time}.`, {
        organizationId,
        appointmentId,
        type: 'appointment_rescheduled',
      });
    }

    if (before.paymentStatus !== after.paymentStatus && after.paymentStatus === 'paid') {
      const tokens = await collectPushTokens([clientId, ...(await organizationAdminUserIds(organizationId))]);
      await sendExpoPush(tokens, 'Anticipo confirmado', `Se confirmo el anticipo de ${after.clientName ?? 'la cita'}.`, {
        organizationId,
        appointmentId,
        type: 'deposit_confirmed',
      });
    }
  },
);

export const appointmentReminders = onSchedule({ region, schedule: 'every 15 minutes' }, async () => {
  const now = Date.now();
  const inOneHour = new Date(now + 60 * 60 * 1000);
  const date = inOneHour.toISOString().slice(0, 10);
  const hour = inOneHour.toISOString().slice(11, 16);
  const snapshot = await db.collectionGroup('appointments').where('date', '==', date).where('time', '==', hour).get();

  await Promise.all(
    snapshot.docs.map(async (docSnapshot) => {
      const appointment = docSnapshot.data();
      if (['cancelled', 'completed', 'lost'].includes(String(appointment.status ?? ''))) return;
      await sendExpoPush(await collectPushTokens([String(appointment.clientId ?? '')]), 'Recordatorio de cita', `Tu cita inicia a las ${appointment.time}.`, {
        appointmentId: docSnapshot.id,
        type: 'client_appointment_reminder',
      });
    }),
  );
});
