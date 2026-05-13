# Arquitectura

## Estructura

- `src/firebase.ts`: inicializa Firebase desde variables `EXPO_PUBLIC_*`; App Check queda condicionado por ambiente.
- `src/config/features.ts`: feature flags runtime para Functions, Storage, Mercado Pago y App Check.
- `src/services`: frontera de integraciones: citas atomicas, pagos, organizaciones, notificaciones, finanzas y logs.
- `src/hooks`: suscripciones a Auth y datos de organizacion.
- `src/screens`: pantallas por rol.
- `functions/src/index.ts`: backend seguro para Mercado Pago, reservas atomicas, webhooks y push.
- `firestore.rules`, `storage.rules`, `firestore.indexes.json`: seguridad e indices desplegables.

## Modelo Multi Tenant

El tenant principal es `organizations/{organizationId}`. Los usuarios guardan su `organizationId` en `users/{uid}` y las reglas comparan cada acceso contra ese perfil.

Colecciones principales:

- `users/{uid}`: perfil, rol, organizacion y `pushTokens`.
- `organizations/{orgId}`: datos del negocio.
- `organizations/{orgId}/settings/{business|appearance}`: configuracion operativa y visual.
- `organizations/{orgId}/services`: servicios con categoria y duracion base.
- `organizations/{orgId}/serviceCategories`: categorias como cabello, unas, barba, facial, spa o depilacion.
- `organizations/{orgId}/employees`: empleados, compensacion y duraciones por servicio.
- `organizations/{orgId}/employeeBlocks`: vacaciones, comida, permisos, incapacidades y horarios personalizados.
- `organizations/{orgId}/appointments`: citas.
- `organizations/{orgId}/announcements`: avisos.
- `organizations/{orgId}/promotions`: promociones con fechas, porcentaje o monto fijo y servicios aplicables.
- `organizations/{orgId}/portfolio`: fotos de trabajos por categoria/empleado.
- `organizations/{orgId}/clientHistory`: historial agregado del cliente.
- `organizations/{orgId}/paymentConnections`: estado publico de Mercado Pago.
- `organizations/{orgId}/private`: secretos OAuth, solo Admin SDK.
- `organizations/{orgId}/paymentEvents`: eventos de webhook, solo backend.

## Roles

- `owner`: control total del negocio.
- `admin`: administracion operativa completa.
- `manager`: servicios, empleados, agenda, pagos y reportes.
- `receptionist`: agenda y atencion.
- `employee`: citas asignadas y disponibilidad propia.
- `client`: reserva y gestiona sus citas.

Las reglas separan `adminRole`, `managerRole` y `staffRole` para evitar permisos planos.

## Flujo de Citas

1. Cliente o staff selecciona servicios, fecha, hora y empleado opcional.
2. `src/services/appointments.ts` llama `createAppointment`.
3. La Function valida Auth, rol, tenant, formato, duracion, total y terminos.
4. En transaccion consulta las citas del mismo dia y empleado, calcula overlap y asigna empleado disponible.
5. Escribe la cita con `endTime`, estado inicial, pago y auditoria.
6. Triggers envian push a cliente, empleado y administracion.

Este flujo evita la doble reserva por condicion de carrera y permite que Firestore Rules bloqueen `allow create` directo.

## Pagos y Mercado Pago

- `createMercadoPagoOAuthUrl`: genera OAuth state y PKCE.
- `mercadoPagoOAuthCallback`: intercambia code por tokens y guarda secreto privado.
- `createDepositPreference`: crea preference usando el access token del negocio.
- `mercadoPagoWebhook`: valida firma, consulta el pago y confirma anticipo/cita.
- `refreshMercadoPagoTokens`: renueva tokens diariamente.

Los clientes solo leen estado publico. Los tokens y OAuth states son inaccesibles desde SDK cliente.

## Storage

Rutas:

- `organizations/{orgId}/branding/*`: logos, maximo 2 MB, imagenes, solo owner/admin.
- `organizations/{orgId}/portfolio/*`: fotos de portafolio, maximo 5 MB, staff del tenant.

## Notificaciones

La app registra tokens Expo en `users/{uid}/pushTokens/{token}`. Functions dispara:

- Cliente: cita recibida, confirmada, cancelada, recordatorio, demora, anticipo confirmado.
- Empleado: nueva cita asignada, cancelacion, cambio de horario.
- Admin/manager: nueva cita, pago recibido, cancelacion.

## Finanzas

`src/services/finance.ts` calcula:

- ingresos totales
- anticipos
- pagos pendientes/completados
- efectivo, transferencia, Mercado Pago, SPEI, OXXO
- comisiones
- ingresos por empleado y servicio

El panel vive en la pestaña Pagos del admin.

## Performance Firestore

- Reservas usan queries por `date` y `employeeId`.
- `useOrganizationData` limita la carga de citas a 1000 documentos recientes.
- `firestore.indexes.json` incluye indices para agenda, usuarios por rol y eventos de pago.
- Evitar offsets; usar cursores al agregar paginacion dedicada para historial largo.
- Evitar IDs secuenciales para documentos de alto trafico; usar IDs automaticos de Firestore.

## App Check, Analytics y Crashlytics

App Check esta preparado por variables de ambiente. En Expo Go, Crashlytics nativo requiere development build o EAS; mientras tanto se agrego `appLogger` para logs estructurados. Para produccion nativa se recomienda agregar `@react-native-firebase/crashlytics` en un dev client/EAS build.

## Referencias Oficiales

- [Firestore best practices](https://firebase.google.com/docs/firestore/best-practices)
- [Avoid insecure Firebase Security Rules](https://firebase.google.com/docs/rules/insecure-rules)
- [Firestore Security Rules structure](https://firebase.google.com/docs/firestore/security/rules-structure)
- [Expo docs](https://docs.expo.dev)
