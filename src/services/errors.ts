export function readableApiError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Correo o contrasena')) return 'Correo o contrasena incorrectos.';
  if (message.includes('registrado')) return 'Ese correo ya esta registrado.';
  if (message.includes('401')) return 'Sesion vencida. Inicia sesion otra vez.';
  if (message.includes('403')) return 'No tienes permiso para realizar esta accion.';
  if (message.includes('404')) return 'No encontramos el recurso solicitado.';
  if (message.includes('Tiempo de espera agotado')) return 'El backend tardo demasiado en responder. Revisa que el servidor y el tunel sigan activos.';
  if (message.includes('Network request failed')) return 'No hay conexion con el backend. Revisa internet o intenta mas tarde.';
  return message || 'Ocurrio un error inesperado.';
}
