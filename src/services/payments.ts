import { httpsCallable } from 'firebase/functions';
import { noBlazeMessage, runtimeFeatures } from '../config/features';
import { functions } from '../firebase';

type CreateOAuthUrlResponse = {
  authorizationUrl: string;
};

type CreateDepositPreferenceResponse = {
  checkoutUrl: string;
  preferenceId: string;
  sandboxCheckoutUrl?: string;
};

export async function createMercadoPagoOAuthUrl(organizationId: string) {
  if (!runtimeFeatures.firebaseFunctions || !runtimeFeatures.mercadoPagoCheckout) {
    throw new Error(noBlazeMessage);
  }
  const callable = httpsCallable<{ organizationId: string }, CreateOAuthUrlResponse>(functions, 'createMercadoPagoOAuthUrl');
  const result = await callable({ organizationId });
  return result.data.authorizationUrl;
}

export async function disconnectMercadoPago(organizationId: string) {
  if (!runtimeFeatures.firebaseFunctions || !runtimeFeatures.mercadoPagoCheckout) {
    throw new Error(noBlazeMessage);
  }
  const callable = httpsCallable<{ organizationId: string }, { connected: boolean }>(functions, 'disconnectMercadoPago');
  const result = await callable({ organizationId });
  return result.data;
}

export async function createDepositPreference(organizationId: string, appointmentId: string) {
  if (!runtimeFeatures.firebaseFunctions || !runtimeFeatures.mercadoPagoCheckout) {
    throw new Error(noBlazeMessage);
  }
  const callable = httpsCallable<{ organizationId: string; appointmentId: string }, CreateDepositPreferenceResponse>(functions, 'createDepositPreference');
  const result = await callable({ organizationId, appointmentId });
  return result.data;
}
