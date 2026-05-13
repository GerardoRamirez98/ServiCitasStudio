# Revision del proyecto ServiCitas Studio

## Lo que ya tiene buena base

- Roles separados para cliente, empleado y administrador.
- Organizaciones separadas por negocio.
- Codigos cortos para clientes y codigos privados para empleados.
- Servicios con precio, duracion, activacion y edicion.
- Horario laboral, dias especiales y disponibilidad segun duracion.
- Citas manuales para personas sin app o sin tarjeta.
- Precio especial por cita sin cambiar el catalogo general.
- Agenda activa e historial por dia.
- Cancelacion del cliente con motivo y politica de anticipo no reembolsable.
- Configuracion para pedir o no pedir anticipo.
- Configuracion de apariencia por negocio.
- Scaffold marketplace Mercado Pago con OAuth, preferencias, webhooks y refresh de tokens.
- Logo del negocio con Firebase Storage.
- Break/comida configurable.
- Conteo de clientes atendidos y destajo estimado por empleado.

## Lo que falta antes de produccion

- Reglas de Firestore de produccion estrictas por rol y organizacion.
- Cloud Functions para validar acciones sensibles: pagos, cancelaciones, cambios de rol y codigos.
- Configurar credenciales reales de Mercado Pago y desplegar Functions.
- Probar webhooks Mercado Pago con cuentas de prueba.
- Notificaciones push para recordatorios, confirmaciones y cambios de estado.
- Reprogramacion de citas.
- Politicas legales revisadas: anticipo, cancelacion, tolerancia, privacidad y reembolsos.
- Telefono del cliente y empleado.
- Fotos de servicios.
- Panel de pagos para admin: pagado, pendiente, en local, reembolsado.
- Historial del cliente y notas internas del negocio.
- Filtros/busqueda avanzada en historial.
- Exportacion administrativa.
- Builds con EAS y pruebas en Android/iOS reales.
- Refactor de membresias para que un usuario pertenezca a multiples negocios.

## Ideas nuevas recomendadas

- Lista de espera: cuando un dia esta lleno, el cliente puede pedir aviso si se libera horario.
- Bloqueo rapido: admin o empleado bloquea 30, 60 o 90 minutos por comida, emergencia o limpieza.
- Clientes frecuentes: historial, notas internas y preferencias.
- Paquetes o combos: varios servicios con precio cerrado.
- Comisiones por empleado: reporte simple por dia o semana.
- Plantillas de mensajes: demora, confirmacion, cita perdida y promocion.
- Modo recepcion: pantalla simplificada para crear citas manuales en menos pasos.
- Confirmacion automatica opcional: si no hay anticipo, el negocio decide si toda cita entra pendiente o confirmada.

## Prioridad sugerida

1. Reglas de seguridad de Firestore.
2. Flujo real de pagos con webhooks.
3. Notificaciones push.
4. Reprogramaciones.
5. Logo/fotos y Storage.
6. Reportes y exportacion.
