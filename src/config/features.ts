export const runtimeFeatures = {
  firebaseFunctions: process.env.EXPO_PUBLIC_ENABLE_FUNCTIONS === 'true',
  firebaseStorage: process.env.EXPO_PUBLIC_ENABLE_STORAGE === 'true',
  mercadoPagoCheckout: process.env.EXPO_PUBLIC_ENABLE_MP === 'true',
  firebaseAppCheck: process.env.EXPO_PUBLIC_ENABLE_APP_CHECK === 'true',
};

export const noBlazeMessage =
  'Modo sin Blaze activo. Por ahora la app trabaja con confirmacion manual de anticipos y guarda el logo pequeno en Firestore. Cuando actives Blaze, cambia estas banderas a true y despliega Functions/Storage.';
