# ServiCitas Studio

App Expo self-hosted para agenda multi negocio con API propia y SQL Server.

## Desarrollo local

1. Configura SQL Server y ejecuta los scripts en `database/sqlserver`.
2. Copia `server/.env.example` a `server/.env` y ajusta credenciales.
3. Copia `.env.example` a `.env` y apunta la app a la API.
4. Inicia backend y app:

```bash
npm run server:start
npm start
```

## Arquitectura

- `server/`: API Express con JWT, SQL Server y endpoints REST.
- `database/sqlserver/`: esquema y migraciones base.
- `src/services/api.ts`: cliente HTTP de la app.
- `src/hooks/useAuthProfile.ts`: sesion local con token JWT.
- `src/hooks/useOrganizationData.ts`: carga inicial desde la API.
- `server/uploads/` o `UPLOADS_DIR`: imagenes subidas por el backend; SQL Server guarda solo la ruta publica.

## Estado actual

- Autenticacion con JWT y roles por negocio.
- Registro de negocio con direccion, clientes por codigo publico y empleados por codigo privado.
- Agenda con servicios, empleados, horarios laborales, descansos, dias especiales y bloqueo de empalmes desde la API.
- Categorias de servicios, portafolio de trabajos con imagenes y promociones automaticas por fecha/servicio.
- Historial de clientes con puntos, nivel de recompensa, notas internas y auditoria reciente.
- Edicion y reprogramacion de citas desde agenda con validacion de bloqueos y horarios propios por empleado.
- Permisos de agenda separados para recepcion, administracion y empleado, con historial paginado para volumen alto.
- Bloqueos individuales de empleado que se respetan al buscar horarios disponibles.
- Mutaciones del negocio refrescan la informacion visible de la app automaticamente.
- Anticipos en modo self-hosted: se registran y confirman manualmente.
- Reportes financieros por rango y exportacion CSV.
- Logo del negocio subido al backend como archivo; SQL Server guarda solo la ruta.

## Pendiente externo

- Mercado Pago automatico requiere credenciales, OAuth y webhooks reales.
- Push notifications requieren configurar proveedor de notificaciones y permisos de dispositivo.

## Variables principales

App:

```env
EXPO_PUBLIC_API_URL=http://127.0.0.1:4000
EXPO_PUBLIC_ENABLE_MP=false
```

Servidor:

```env
PORT=4000
JWT_SECRET=change-this-long-random-secret
UPLOADS_DIR=uploads
SQLSERVER_HOST=localhost
SQLSERVER_INSTANCE=SQLEXPRESS
SQLSERVER_DATABASE=ServiCitasStudio
SQLSERVER_USER=sa
SQLSERVER_PASSWORD=
SQLSERVER_DRIVER=msnodesqlv8
```
