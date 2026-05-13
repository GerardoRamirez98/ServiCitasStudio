# Mercado Pago Marketplace - ServiCitas Studio

## Objetivo

Cada negocio conecta su propia cuenta Mercado Pago con OAuth. Los anticipos se crean con el `access_token` del vendedor correspondiente, no con un token global de la plataforma.

Referencias oficiales:

- Marketplace Checkout Pro y Checkout API: https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/how-tos/integrate-marketplace
- OAuth Authorization Code y PKCE: https://www.mercadopago.com.mx/developers/en/docs/checkout-api-payments/additional-content/security/oauth/creation
- Webhooks y firma `x-signature`: https://www.mercadopago.com.mx/developers/en/docs/checkout-pro/payment-notifications

## Estructura Firestore

Estado publico que la app puede leer:

```text
organizations/{organizationId}/paymentConnections/mercadopago
  connected: boolean
  provider: "mercado_pago"
  userId: number
  publicKey: string
  expiresAt: timestamp
  connectedAt: timestamp
  lastRefreshAt: timestamp
```

Tokens privados, solo backend:

```text
organizations/{organizationId}/private/mercadopago
  provider: "mercado_pago"
  connected: true
  accessToken: string
  refreshToken: string
  userId: number
  publicKey: string
  expiresAt: timestamp
  scope: string
  tokenType: string
```

Estados temporales OAuth:

```text
organizations/{organizationId}/mercadoPagoOAuthStates/{state}
  state: string
  organizationId: string
  adminId: string
  codeVerifier: string
  expiresAt: timestamp
  used: boolean
```

Eventos de pago:

```text
organizations/{organizationId}/paymentEvents/{paymentId}
  provider: "mercado_pago"
  paymentId: string
  status: string
  statusDetail: string
  externalReference: string
  receivedAt: timestamp
```

Campos relevantes en cita:

```text
organizations/{organizationId}/appointments/{appointmentId}
  requiresDeposit: boolean
  deposit: number
  paymentProvider: "mercado_pago"
  paymentStatus: "pending" | "paid" | "refunded"
  paymentMethod: "card"
  mercadoPagoPreferenceId: string
  mercadoPagoPaymentId: string
  paymentReference: string
  marketplaceFee: number
```

## Endpoints implementados

Callable desde la app:

- `createMercadoPagoOAuthUrl`: genera URL OAuth con `state` y PKCE.
- `disconnectMercadoPago`: desconecta el negocio y elimina tokens privados.
- `createDepositPreference`: crea preferencia Checkout Pro con el token OAuth del vendedor.

HTTP:

- `mercadoPagoOAuthCallback`: recibe `code` y `state`, intercambia token y guarda conexion.
- `mercadoPagoWebhook`: valida firma, consulta el pago y actualiza la cita.

Scheduled:

- `refreshMercadoPagoTokens`: renueva tokens que vencen dentro de 30 dias.

## Variables y secretos

En `functions/.env.example` quedan las variables no secretas. Los secretos se deben configurar con Firebase:

```powershell
npx firebase-tools functions:secrets:set MP_CLIENT_SECRET
npx firebase-tools functions:secrets:set MP_WEBHOOK_SECRET
```

Variables esperadas:

```text
MP_CLIENT_ID
MP_REDIRECT_URI
MP_WEBHOOK_URL
PUBLIC_APP_URL
MP_MARKETPLACE_FEE_PERCENT
MP_MARKETPLACE_FEE_FIXED
```

## Si la app muestra `not-found`

Ese error significa que la app llamo una Cloud Function que Firebase todavia no encuentra. Revisa:

1. Que las Functions esten desplegadas.
2. Que se hayan desplegado en `us-central1`.
3. Que el nombre exista: `createMercadoPagoOAuthUrl`.
4. Que estes usando el proyecto correcto: `servicitas-studio`.

Comandos recomendados desde la raiz:

```powershell
npm run functions:build
npx firebase-tools login
npx firebase-tools use servicitas-studio
npm run functions:secrets
npm run functions:deploy
npx firebase-tools functions:list
```

Si `functions:list` no muestra `createMercadoPagoOAuthUrl`, la app seguira marcando `not-found`.

## Flujo OAuth

1. Admin abre Admin > Pagos.
2. Presiona Conectar Mercado Pago.
3. La app llama `createMercadoPagoOAuthUrl`.
4. Backend guarda `state` y `codeVerifier`.
5. La app abre la URL de Mercado Pago.
6. Mercado Pago redirige a `mercadoPagoOAuthCallback`.
7. Backend intercambia `code` por tokens.
8. Backend guarda tokens privados y estado publico conectado.

## Flujo de pago

1. Cliente crea cita con anticipo.
2. App llama `createDepositPreference`.
3. Backend busca la cita y el negocio.
4. Backend obtiene el `accessToken` del negocio.
5. Backend crea preferencia en `/checkout/preferences`.
6. Si hay comision, envia `marketplace_fee`.
7. App abre `init_point`.
8. Mercado Pago manda webhook.
9. Backend valida firma y consulta `/v1/payments/{paymentId}`.
10. Si el pago esta aprobado, marca `paymentStatus: paid` y confirma la cita.

## Metodos de pago

Checkout Pro para Mexico puede ofrecer tarjeta, cuenta Mercado Pago, Transferencia SPEI, OXXO, Paycash y otros medios disponibles segun la cuenta del vendedor.

- Mercado Pago / tarjeta / saldo: normalmente se confirma rapido, pero siempre debe esperarse webhook.
- SPEI: se confirma cuando Mercado Pago acredita la transferencia.
- OXXO Pay / efectivo: no es inmediato; la cita queda pendiente hasta que Mercado Pago notifique pago aprobado.
- Transferencia directa fuera de Mercado Pago: no se puede confirmar automaticamente sin integrar banco/API o revision manual del negocio.

La app guarda `requestedDepositPaymentMethod`, pero la confirmacion real siempre depende de `paymentStatus` actualizado por webhook.

## Comisiones

Checkout Pro usa `marketplace_fee`.

Ejemplo:

```text
Anticipo: 200 MXN
MP_MARKETPLACE_FEE_PERCENT=10
Comision plataforma: 20 MXN
Negocio recibe el restante despues de comisiones Mercado Pago.
```

Checkout API usaria `application_fee`, pero el scaffold actual usa Checkout Pro para Expo porque es mas simple y seguro para empezar.

## Seguridad pendiente antes de produccion

- Ajustar reglas Firestore para bloquear `organizations/{id}/private/{doc}` a cualquier cliente.
- Agregar App Check.
- Revisar politicas legales de cancelacion y no reembolso.
- Configurar URLs reales de produccion en Mercado Pago.
- Probar flujo con cuentas de prueba de Mercado Pago antes de usar dinero real.
- Auditar logs para no imprimir tokens.
