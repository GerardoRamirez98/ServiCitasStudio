# Reglas temporales de desarrollo para Firestore

Usa estas reglas solo mientras estamos construyendo y probando la app. Permiten que cualquier usuario autenticado lea y escriba los datos necesarios. Antes de publicar o rentar la app, cambia a reglas estrictas por organizacion.

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    match /publicCodes/{code} {
      allow read: if true;
      allow write: if signedIn();
    }

    match /employeeInvites/{code} {
      allow read: if true;
      allow write: if signedIn();
    }

    match /{document=**} {
      allow read, write: if signedIn();
    }
  }
}
```
