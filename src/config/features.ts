export const runtimeFeatures = {
  firebaseFunctions: false,
  firebaseStorage: false,
  mercadoPagoCheckout: false,
};

export const noBlazeMessage =
  'Modo sin Blaze activo. Por ahora la app trabaja con confirmacion manual de anticipos y guarda el logo pequeno en Firestore. Cuando actives Blaze, cambia estas banderas a true y despliega Functions/Storage.';
