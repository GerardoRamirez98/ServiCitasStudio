# ServiCitas Studio - Plan de pagos

## Regla principal

La app nunca debe guardar datos de tarjeta como numero, fecha de vencimiento o CVV. Esos datos deben capturarse y procesarse con una pasarela de pago certificada.

## Modos de negocio

- Sin anticipo: el cliente aparta su cita sin pago inicial.
- Con anticipo: el cliente debe pagar el porcentaje configurado por el negocio.
- Pago en local: admin o empleado crea la cita manualmente para clientes sin tarjeta o personas que no usan la app.

## Flujo recomendado para tarjeta

1. El cliente selecciona servicios, dia y horario.
2. La app calcula total y anticipo.
3. La app crea una cita temporal con estado de pago `pending`.
4. Una Cloud Function crea la preferencia o intencion de pago con Mercado Pago, Stripe o Conekta.
5. El cliente paga en el checkout seguro del proveedor.
6. El proveedor confirma el pago por webhook.
7. La Cloud Function valida el webhook con el proveedor y actualiza Firestore.
8. Firestore cambia la cita a `paymentStatus: paid` si el pago fue aprobado.

## Cancelaciones con anticipo

- La cita nunca se elimina fisicamente de Firestore; se marca como `cancelled`.
- Se guarda `cancelledAt`, `cancelledBy`, `cancellationReason` y `cancellationTiming`.
- Si la cita tenia anticipo, se guarda `refundStatus: non_refundable`.
- La app debe mostrar al cliente que cancelar una cita con anticipo pagado no genera reembolso ni derecho a exigir el servicio cancelado.
- El administrador puede hacer una excepcion manual en el futuro, pero eso debe quedar registrado en historial.

## Cobro al negocio

- Si el negocio quiere recibir pagos, debe configurar una cuenta de cobro en la pasarela.
- Si el administrador o barbero no tiene cuenta/tarjeta/banco disponible, puede dejar desactivado el anticipo.
- Para una app rentada a varios negocios, cada organizacion debe tener su propia configuracion de pagos.

## Campos utiles en Firestore

- `requireDeposit`: si el negocio pide anticipo.
- `depositPercent`: porcentaje de anticipo.
- `deposit`: monto calculado de anticipo en la cita.
- `paymentStatus`: `not_required`, `pending`, `paid`, `offline` o `refunded`.
- `paymentMethod`: `none`, `card`, `cash` o `transfer`.
- `paymentProvider`: proveedor usado, por ejemplo `mercado_pago`, `stripe` o `conekta`.
- `paymentReference`: id de pago externo para consultar o conciliar.
- `refundStatus`: `not_applicable`, `non_refundable` o `refunded`.
- `cancelledAt`: fecha/hora en que se cancelo.
- `cancelledBy`: cliente, empleado, administrador o sistema.
- `cancellationReason`: motivo capturado.
- `serviceRightForfeited`: confirma que la cita cancelada no conserva derecho al servicio.

## Implementacion exacta con Mercado Pago

1. Crear cuenta de Mercado Pago para la plataforma.
2. Para cada negocio que quiera cobrar anticipos, conectar una cuenta de vendedor con OAuth o configurar el modelo de marketplace.
3. Crear una Cloud Function `createDepositPreference`.
4. La funcion recibe `appointmentId`, valida que la cita exista, calcula el anticipo desde Firestore y crea una preferencia de Checkout Pro.
5. La funcion usa el `access_token` OAuth del negocio, nunca un token global para crear el pago.
6. Si hay comision de plataforma, la funcion envia `marketplace_fee`.
7. La funcion guarda `paymentProvider: mercado_pago`, `paymentReference`, `paymentStatus: pending` y devuelve `init_point` o `preferenceId` a la app.
8. La app abre el checkout de Mercado Pago.
9. Mercado Pago llama un webhook cuando el pago cambia.
10. La Cloud Function del webhook valida la firma, consulta el pago con el token del negocio y solo entonces marca `paymentStatus: paid`.

## Implementacion exacta con Stripe

1. Instalar `@stripe/stripe-react-native` si se elige Stripe.
2. Crear cuentas conectadas con Stripe Connect para cada negocio que vaya a recibir dinero.
3. Crear una Cloud Function `createPaymentIntent` o `createCheckoutSession`.
4. La funcion calcula el anticipo en el backend y crea el pago usando la cuenta conectada del negocio.
5. La app presenta PaymentSheet o Checkout.
6. Stripe confirma el resultado con webhook.
7. La Cloud Function del webhook actualiza `paymentStatus: paid` o `paymentStatus: pending` segun corresponda.
