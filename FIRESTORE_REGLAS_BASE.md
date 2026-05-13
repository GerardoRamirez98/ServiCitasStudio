# Reglas base sugeridas para Firestore

Estas reglas son una base para desarrollo. Antes de publicar la app conviene endurecer invitaciones, pagos y permisos de administradores.

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function userProfile() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }

    function hasUserProfile() {
      return signedIn() && exists(/databases/$(database)/documents/users/$(request.auth.uid));
    }

    function sameOrg(orgId) {
      return hasUserProfile() && userProfile().organizationId == orgId;
    }

    function isAdmin(orgId) {
      return sameOrg(orgId) && userProfile().role == 'admin';
    }

    function isEmployee(orgId) {
      return sameOrg(orgId) && userProfile().role == 'employee';
    }

    match /users/{userId} {
      allow create: if signedIn() && request.auth.uid == userId;
      allow read, update: if signedIn() && (
        request.auth.uid == userId ||
        (resource.data.organizationId == userProfile().organizationId && userProfile().role == 'admin')
      );
    }

    match /publicCodes/{code} {
      allow read: if true;
      allow create: if signedIn();
      allow update, delete: if signedIn() && (
        hasUserProfile() &&
        userProfile().role == 'admin' &&
        userProfile().organizationId == resource.data.organizationId
      );
    }

    match /employeeInvites/{code} {
      allow read: if true;
      allow create: if signedIn() && (
        hasUserProfile() &&
        userProfile().role == 'admin' &&
        userProfile().organizationId == request.resource.data.organizationId
      );
      allow delete: if signedIn() && (
        hasUserProfile() &&
        userProfile().role == 'admin' &&
        userProfile().organizationId == resource.data.organizationId
      );
      allow update: if signedIn() && (
        (
          hasUserProfile() &&
          userProfile().role == 'admin' &&
          userProfile().organizationId == request.resource.data.organizationId
        ) ||
        (
          hasUserProfile() &&
          userProfile().role == 'employee' &&
          userProfile().organizationId == resource.data.organizationId &&
          userProfile().employeeId == resource.data.employeeId &&
          request.resource.data.used == true &&
          request.resource.data.usedBy == request.auth.uid
        )
      );
    }

    match /organizations/{orgId} {
      allow create: if signedIn();
      allow read: if sameOrg(orgId) || (signedIn() && resource.data.ownerId == request.auth.uid);
      allow update, delete: if isAdmin(orgId) || (signedIn() && resource.data.ownerId == request.auth.uid);

      match /settings/{settingId} {
        allow read: if sameOrg(orgId);
        allow write: if isAdmin(orgId) || (
          signedIn() &&
          get(/databases/$(database)/documents/organizations/$(orgId)).data.ownerId == request.auth.uid
        );
      }

      match /paymentConnections/{providerId} {
        allow read: if sameOrg(orgId);
        allow write: if false; // Solo Firebase Functions debe escribir estados de conexion.
      }

      match /private/{secretId} {
        allow read, write: if false; // Tokens OAuth y secretos: solo Admin SDK en Functions.
      }

      match /mercadoPagoOAuthStates/{stateId} {
        allow read, write: if false; // State y codeVerifier: solo backend.
      }

      match /paymentEvents/{eventId} {
        allow read: if isAdmin(orgId);
        allow write: if false; // Solo webhooks en Functions.
      }

      match /services/{serviceId} {
        allow read: if sameOrg(orgId);
        allow write: if isAdmin(orgId);
      }

      match /employees/{employeeId} {
        allow read: if sameOrg(orgId);
        allow write: if isAdmin(orgId) || (
          isEmployee(orgId) &&
          userProfile().employeeId == employeeId
        );
      }

      match /dayNotes/{dayNoteId} {
        allow read: if sameOrg(orgId);
        allow write: if isAdmin(orgId);
      }

      match /announcements/{announcementId} {
        allow read: if sameOrg(orgId);
        allow write: if isAdmin(orgId);
      }

      match /appointments/{appointmentId} {
        allow read: if sameOrg(orgId);
        allow create: if sameOrg(orgId) && userProfile().role in ['client', 'employee', 'admin'];
        allow update: if isAdmin(orgId) || isEmployee(orgId) || (
          sameOrg(orgId) &&
          userProfile().role == 'client' &&
          resource.data.clientId == request.auth.uid &&
          request.resource.data.status == 'cancelled'
        );
        allow delete: if isAdmin(orgId);
      }
    }
  }
}
```
