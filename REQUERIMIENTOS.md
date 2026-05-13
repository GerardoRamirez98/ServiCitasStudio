# ServiCitas Studio - Lista de requerimientos

## Objetivo

Crear una aplicacion movil para Android y iOS con Expo React Native que funcione como agenda para una estetica, permitiendo a clientes apartar citas y al administrador controlar servicios, horarios, personal, anticipos y avisos.

## Roles independientes

- Cliente: consulta servicios, disponibilidad, promociones y solicita citas.
- Administrador: administra agenda, servicios, precios, empleados, dias especiales, anticipos y publicaciones.
- Empleado: ve solo sus citas asignadas, puede aceptar/confirmar, terminar, marcar perdida o pasar la cita a otro empleado disponible.

## Multi-organizacion

- La app debe poder servir a mas de una organizacion o negocio.
- Cada organizacion tiene su propio `organizationId`.
- Los servicios, empleados, citas, avisos, dias especiales y configuracion viven separados por organizacion.
- Cada organizacion puede modificar su apariencia: tema visual, nombre visible, frase corta y mensaje para clientes.
- Una cuenta de usuario debe poder pertenecer a multiples negocios mediante membresias.
- Un cliente puede agregarse a varios negocios usando codigos publicos.
- Un empleado tambien puede ser cliente en otros negocios.
- Un administrador crea una organizacion y la app genera un codigo corto publico, por ejemplo `BARBER123`.
- Al registrar una organizacion se debe capturar direccion completa: calle, colonia, ciudad, estado, numero exterior, numero interior opcional y codigo postal.
- La direccion permite diferenciar negocios con el mismo nombre pero diferente dueno o ubicacion.
- Clientes y administradores invitados se unen usando el codigo corto del negocio, no el ID largo de Firebase.
- Los empleados se registran con un codigo privado de invitacion, por ejemplo `EMP4821`.
- El `organizationId` largo queda oculto para usuarios y solo se usa internamente.
- Un administrador tambien puede unirse a una organizacion existente usando el codigo corto para soportar varios administradores.
- Los empleados se registran con el codigo privado que el administrador genero al registrarlos.
- En una version posterior se debe agregar invitacion por enlace o codigo temporal para empleados y clientes.

## Funciones del cliente

- Ver servicios disponibles con precio y duracion estimada.
- Seleccionar uno o varios servicios para una cita.
- Ver dias disponibles y horarios libres.
- Apartar cita con nombre, nota y anticipo solo cuando el negocio lo tenga activado.
- Apartar cita sin tarjeta cuando el negocio no pida anticipo.
- Aceptar terminos de puntualidad antes de solicitar la cita.
- Cancelar una cita futura desde su pantalla de citas.
- Al cancelar, capturar motivo y conservar la cita en historial como cancelada.
- Si la cita tenia anticipo pagado, mostrar que el anticipo no sera devuelto y que no conserva derecho a exigir el servicio cancelado.
- Ver sus citas en tiempo real.
- Recibir estado de la cita: pendiente, confirmada, en espera, atendiendo, terminada, cancelada o perdida.
- Ver un aviso de demora y disculpa cuando el empleado este atendiendo a otro cliente.
- Ver promociones, descuentos o eventos publicados por el negocio.

## Funciones del administrador

- Registrar, editar, activar, desactivar y borrar servicios.
- Editar datos del negocio: nombre, calle, colonia, ciudad, estado, numero exterior, numero interior y codigo postal.
- Cambiar precios y duracion de cada servicio.
- La duracion de servicios debe capturarse con horas y minutos separados.
- Los minutos de duracion solo permiten 0 a 59; 60 minutos debe representarse como 1 hora.
- La duracion maxima permitida para un servicio es 24 horas.
- Antes de guardar un servicio, el admin debe confirmar nombre, precio y duracion legible.
- Activar o desactivar si el negocio pedira anticipo para apartar citas.
- Configurar porcentaje de anticipo requerido para apartar una cita.
- Conectar o desconectar la cuenta Mercado Pago propia del negocio.
- Ver el estado publico de conexion Mercado Pago sin exponer tokens.
- Subir logo del negocio.
- Compartir codigo publico del negocio con clientes.
- Registrar forma de pago del empleado: sueldo fijo, destajo o mixto.
- Ver conteo de clientes atendidos por empleado y estimado de destajo.
- Configurar cuantas horas antes debe cancelar el cliente para considerar la cancelacion en tiempo.
- Ver calendario/lista de citas.
- Ver agenda activa sin mezclar citas terminadas, perdidas o canceladas.
- Ver historial de citas por dia.
- Confirmar citas solicitadas por clientes.
- Marcar citas como pendientes, confirmadas o perdidas.
- Las citas perdidas deben salir automaticamente de la agenda activa del administrador.
- Las citas terminadas, perdidas y canceladas deben quedar visibles en historial por dia.
- El administrador puede eliminar definitivamente una cita desde agenda o historial con doble confirmacion.
- Si una cita tiene anticipo o pago, la app debe advertir que eliminarla no hace reembolso automatico en la pasarela.
- Asignar o reasignar citas a empleados.
- Agregar citas manuales para clientes que llaman, llegan al negocio o no usan la app.
- Al crear una cita manual se debe calcular total, duracion acumulada y hora aproximada de termino segun los servicios seleccionados.
- En citas manuales, admin o empleado pueden aplicar un precio especial para una persona sin cambiar el precio global del servicio.
- El precio especial debe guardar subtotal normal, descuento aplicado, total final y motivo del descuento.
- En citas manuales, admin o empleado pueden registrar clientes que no tienen tarjeta o no usan la app.
- Registrar dias de descanso, retraso o complicacion con nota visible.
- Registrar, editar, activar, desactivar y borrar empleados.
- Al borrar un empleado, las citas activas asignadas a esa persona deben quedar sin empleado y regresar a estado pendiente para que el administrador las reasigne.
- Si el empleado tenia cuenta vinculada, al borrarlo debe perder el rol de empleado y quedar como cliente de la organizacion.
- Publicar descuentos, eventos o anuncios importantes.
- Modificar la apariencia del negocio sin afectar a otras organizaciones.
- Ver resumen rapido del negocio: citas del dia, pendientes, servicios activos y empleados disponibles.

## Funciones del empleado

- Iniciar sesion con cuenta independiente.
- Ver solo las citas que tiene asignadas.
- Confirmar/aceptar citas.
- Compartir codigo publico del negocio con clientes.
- Ver conteo de servicios atendidos y destajo estimado.
- Marcar citas como terminadas o perdidas.
- Agregar citas manuales para clientes que llegan directo con ese empleado.
- Aplicar precio especial en una cita manual cuando corresponda, sin modificar el catalogo general.
- Pasar una cita a otro empleado activo si esta disponible.
- No puede pasar una cita a un empleado que ya tenga otra cita activa en el mismo dia y horario.
- Puede marcar una cita como en espera y enviar un aviso de disculpa por demora al cliente.
- No puede editar servicios, precios, empleados, configuracion ni avisos.

## Reglas de agenda

- No permitir apartar citas en dias marcados como descanso.
- No permitir apartar citas en dias no laborales configurados por el administrador.
- El administrador puede configurar dias laborales, hora de apertura, hora de cierre e intervalo de horarios.
- El administrador puede configurar hora de comida o break, o desactivarlo.
- Los dias especiales deben estar en un apartado independiente de la agenda principal con vista de calendario mensual.
- No mostrar horarios ocupados por citas activas.
- La disponibilidad debe contemplar la duracion total de los servicios, no solo la hora de inicio.
- Calcular total segun servicios seleccionados.
- Calcular hora aproximada de termino segun la duracion acumulada de los servicios.
- Calcular anticipo segun porcentaje configurado por el administrador solo si el negocio activo la opcion de anticipo.
- Si el negocio no pide anticipo, la cita se guarda con anticipo 0 y pago no requerido.
- Si el negocio pide anticipo, la cita se guarda con anticipo pendiente hasta conectar una pasarela de pago real.
- Las citas canceladas no se borran; quedan con estado cancelada, motivo, usuario que cancelo y fecha de cancelacion.
- El historial del administrador se consulta por dia para revisar citas terminadas, perdidas y canceladas.
- El borrado definitivo elimina la cita de Firestore y debe reservarse para errores, duplicados o limpieza administrativa.
- El anticipo pagado debe tratarse como no reembolsable segun la politica aceptada por el cliente.
- Cancelar una cita no da derecho a exigir el servicio en otro horario sin crear una nueva cita.
- Guardar nota del cliente para preparar el servicio.
- Incluir politica de puntualidad, cancelacion y anticipo: si el cliente llega tarde fuera del margen definido, puede perder su cita; si cancela con anticipo pagado, el anticipo no se devuelve.

## Pagos y anticipos

- La app no debe guardar numeros de tarjeta, CVV ni datos bancarios sensibles en Firebase.
- Para cobrar anticipos con tarjeta se debe integrar una pasarela como Mercado Pago, Stripe o Conekta.
- El flujo recomendado es que la app cree una intencion/preferencia de pago desde Cloud Functions y la pasarela cobre la tarjeta.
- El administrador decide si su negocio pide anticipo o no desde Configuracion.
- Si el cliente no tiene tarjeta, el negocio puede trabajar sin anticipo o crear la cita manualmente y cobrar en local.
- Si el barbero o administrador no tiene tarjeta o cuenta bancaria para recibir pagos, ese negocio debe iniciar sin anticipo hasta configurar una cuenta de cobro con la pasarela.
- Las citas deben guardar estado de pago: no requerido, pendiente, pagado, pago en local o reembolsado.
- El pago del anticipo debe confirmarse desde webhook antes de marcarlo como pagado.
- Cada negocio debe cobrar anticipos con su propio token OAuth de Mercado Pago.
- La plataforma puede cobrar comision con `marketplace_fee` al usar Checkout Pro.
- El cliente puede elegir preferencia de pago: Mercado Pago, SPEI, OXXO Pay o transferencia directa.
- Mercado Pago, SPEI y OXXO se reflejan automaticamente solo cuando Mercado Pago los acredita y manda webhook.
- La transferencia directa fuera de Mercado Pago queda pendiente de revision manual o de una futura integracion bancaria.
- Si el cliente cancela una cita pagada, la app debe conservar el pago como no reembolsable, salvo que el administrador haga una excepcion manual.

## Backend recomendado con Firebase

- Firebase Authentication para usuarios, administradores y empleados.
- Cloud Firestore para servicios, empleados, citas, dias especiales, anuncios y configuracion.
- Firebase Storage para imagenes de servicios, promociones o comprobantes.
- Cloud Functions para validar pagos, confirmar anticipos y enviar notificaciones.
- Firebase Cloud Messaging para recordatorios de cita y cambios de estado.

## Colecciones sugeridas en Firestore

- `users`: perfil, rol, organizationId, employeeId, telefono, fecha de registro.
- `publicCodes`: codigo corto publico, organizationId, organizationName.
- `employeeInvites`: codigo privado, organizationId, employeeId, email, used.
- `organizations`: nombre, direccion, propietario, codigo publico, fecha de creacion.
- `organizations/{organizationId}/services`: nombre, precio, duracion, activo, descripcion, imagen.
- `organizations/{organizationId}/employees`: nombre, correo, rol, activo, userId.
- `organizations/{organizationId}/appointments`: cliente, servicios, empleado, fecha, hora, estado, anticipo, requiereAnticipo, estadoPago, metodoPago, estadoReembolso, motivoCancelacion, canceladoPor, canceladoEn, nota, aceptoTerminos.
- `organizations/{organizationId}/dayNotes`: fecha, tipo, nota, visible.
- `organizations/{organizationId}/announcements`: titulo, mensaje, fecha, activo.
- `organizations/{organizationId}/settings/business`: pideAnticipo, porcentaje de anticipo, tolerancia de retraso, horas limite de cancelacion, horarios de atencion.
- `organizations/{organizationId}/settings/appearance`: tema visual, nombre visible, frase corta y mensaje de bienvenida.
- `organizations/{organizationId}/paymentConnections/mercadopago`: estado publico de conexion Mercado Pago.
- `organizations/{organizationId}/private/mercadopago`: tokens OAuth privados, solo backend.
- `organizations/{organizationId}/paymentEvents`: eventos recibidos por webhook.

## Pendientes importantes

- Configurar credenciales reales de Mercado Pago en Firebase Functions.
- Desplegar Cloud Functions de OAuth, pagos, webhook y renovacion de tokens.
- Fortalecer reglas de seguridad de Firestore para produccion.
- Crear recordatorios por notificacion push.
- Agregar reprogramaciones.
- Definir tolerancia exacta de retraso, politicas de reembolso y texto legal.
- Agregar historial del cliente y notas internas del administrador.
- Agregar telefono del cliente y empleado.
- Agregar imagen/logo del negocio y fotos de servicios con Firebase Storage.
- Crear panel de pagos para ver anticipos pagados, pendientes y pagos en local.
- Agregar busqueda/filtros en historial cuando haya muchas citas.
- Agregar exportacion de historial a PDF/Excel para administracion.
- Preparar builds con EAS para Android y iOS.
