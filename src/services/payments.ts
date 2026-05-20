type CreateDepositPreferenceResponse = {
  checkoutUrl: string;
  preferenceId: string;
  sandboxCheckoutUrl?: string;
};

export async function createMercadoPagoOAuthUrl(_organizationId: string) {
  throw new Error('Mercado Pago automatico esta desactivado en modo self-hosted.');
}

export async function disconnectMercadoPago(_organizationId: string) {
  return { connected: false };
}

export async function createDepositPreference(_organizationId: string, _appointmentId: string): Promise<CreateDepositPreferenceResponse> {
  throw new Error('Los anticipos se confirman manualmente en modo self-hosted.');
}
