export function readableFirebaseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const serverResponse =
    typeof error === 'object' &&
    error !== null &&
    'customData' in error &&
    typeof (error as { customData?: { serverResponse?: unknown } }).customData?.serverResponse === 'string'
      ? String((error as { customData?: { serverResponse?: unknown } }).customData?.serverResponse)
      : '';
  if (serverResponse) return `${message}\n${serverResponse}`;
  if (message.includes('auth/invalid-credential')) return 'Correo o contrasena incorrectos.';
  if (message.includes('auth/email-already-in-use')) return 'Ese correo ya esta registrado.';
  if (message.includes('auth/weak-password')) return 'Usa una contrasena de al menos 6 caracteres.';
  if (message.includes('permission-denied')) return 'Firebase rechazo la operacion. Revisa las reglas de Firestore.';
  if (message.includes('storage/unauthorized')) return 'Firebase Storage rechazo la subida. Activa Storage y publica las reglas de Storage.';
  if (message.includes('storage/bucket-not-found')) return 'No encontramos el bucket de Firebase Storage. Activa Storage en Firebase Console.';
  if (message.includes('storage/object-not-found')) return 'No encontramos el archivo en Storage. Intenta subirlo nuevamente.';
  if (message.includes('storage/quota-exceeded')) return 'Firebase Storage alcanzo su limite de cuota.';
  if (message.includes('storage/unauthenticated')) return 'Inicia sesion antes de subir imagenes.';
  if (message.includes('functions/not-found') || message.includes('not-found')) {
    return 'No encontramos la funcion de backend en Firebase. Despliega Firebase Functions y verifica que este en us-central1.';
  }
  if (message.includes('failed-precondition')) {
    return message.replace('FirebaseError: ', '').replace('FunctionsError: ', '');
  }
  return message;
}
