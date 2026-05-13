# ServiCitas Studio

App Expo + Firebase para agenda multi negocio con roles, citas, anticipos, Mercado Pago Marketplace y reglas listas para despliegue.

## Stack

- React Native + Expo SDK 54
- Firebase Auth, Firestore, Storage, Functions
- Mercado Pago OAuth + webhooks
- Expo Notifications para push
- Multi tenant por `organizationId`

## Configuracion

1. Copia `.env.example` a `.env`.
2. Completa las variables `EXPO_PUBLIC_FIREBASE_*`.
3. Activa features por ambiente:

```env
EXPO_PUBLIC_ENABLE_FUNCTIONS=true
EXPO_PUBLIC_ENABLE_STORAGE=true
EXPO_PUBLIC_ENABLE_MP=true
EXPO_PUBLIC_ENABLE_APP_CHECK=false
```

Para Functions configura parametros/secrets:

```bash
npx firebase-tools functions:secrets:set MP_CLIENT_SECRET --project servicitas-studio
npx firebase-tools functions:secrets:set MP_WEBHOOK_SECRET --project servicitas-studio
```

## Scripts

```bash
npm start
npm run typecheck
npm run functions:build
npm run deploy:rules
npm run deploy:indexes
```

## Seguridad

- `firestore.rules` bloquea escritura directa de citas; las reservas se crean con `createAppointment` en Functions.
- `storage.rules` valida autenticacion, pertenencia a organizacion, rol admin/owner, tamano y MIME.
- Tokens OAuth de Mercado Pago viven en `organizations/{orgId}/private/mercadopago`, sin acceso cliente.
- Webhooks escriben `paymentEvents` y actualizan citas solo desde Admin SDK.

## Reservas

La app usa `src/services/appointments.ts`, que llama la Function `createAppointment`. Esa Function valida rol, organizacion, fecha, hora, duracion, servicios y ejecuta una transaccion que lee las citas del dia y evita solapamientos por empleado.

## Produccion

Antes de publicar:

- Desplegar `firestore.rules`, `storage.rules` e indices.
- Activar App Check en Firebase Console y colocar `EXPO_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY` si se usa web.
- Configurar URL publica del webhook de Mercado Pago.
- Revisar `npm audit` y decidir actualizaciones compatibles.

Ver detalles completos en `ARCHITECTURE.md`.
