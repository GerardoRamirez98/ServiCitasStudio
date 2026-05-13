# Reglas sugeridas para Firebase Storage

El archivo desplegable actual es [storage.rules](./storage.rules). Para publicarlo:

```powershell
npm run storage:deploy
```

Si Firebase Storage aun no esta activado, primero entra a Firebase Console > Compilacion > Storage > Comenzar.

## Version de desarrollo incluida

Permite que usuarios autenticados suban logos del negocio en `organizations/{orgId}/branding/`, con limite de 2 MB e imagenes solamente.

## Version mas estricta para produccion

Permiten leer logos/fotos del negocio a miembros del negocio y subir branding solo a administradores.

```js
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    function signedIn() {
      return request.auth != null;
    }

    function userProfile() {
      return firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data;
    }

    function sameOrg(orgId) {
      return signedIn() && userProfile().organizationId == orgId;
    }

    function isAdmin(orgId) {
      return sameOrg(orgId) && userProfile().role == 'admin';
    }

    match /organizations/{orgId}/branding/{fileName} {
      allow read: if sameOrg(orgId);
      allow write: if isAdmin(orgId)
        && request.resource.size < 2 * 1024 * 1024
        && request.resource.contentType.matches('image/.*');
    }
  }
}
```
