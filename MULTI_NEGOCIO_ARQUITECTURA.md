# Arquitectura necesaria para usuarios en multiples negocios

## Problema actual

Hoy `users/{uid}` guarda un solo:

```text
organizationId
organizationName
role
employeeId
```

Eso funciona para una primera version, pero no permite que:

- Un cliente agende en varios negocios.
- Un empleado sea cliente en otros negocios.
- Un administrador administre mas de un negocio sin cambiar de cuenta.

## Modelo recomendado

Separar identidad global de membresias por negocio.

```text
users/{uid}
  name
  email
  phone
  activeOrganizationId
  createdAt

users/{uid}/memberships/{organizationId}
  organizationId
  organizationName
  role: "client" | "employee" | "admin"
  employeeId
  joinedAt
  active

organizations/{organizationId}/members/{uid}
  userId
  role
  employeeId
  active
```

## Flujo cliente multi negocio

1. Cliente crea cuenta una sola vez.
2. Entra a "Mis negocios".
3. Usa codigo publico de negocio.
4. Se crea una membresia como cliente.
5. Puede cambiar de negocio desde un selector.

## Flujo empleado que tambien es cliente

1. Admin registra empleado en un negocio.
2. Empleado crea cuenta con codigo privado.
3. Se crea membresia como empleado para ese negocio.
4. Si el empleado quiere agendar en otro negocio, usa codigo publico y se agrega otra membresia como cliente.

## Cambio necesario en la app

- Cambiar `useAuthProfile` por `useAuthContext` con usuario global y membresia activa.
- Agregar pantalla "Mis negocios".
- Agregar selector de negocio en `AppShell`.
- Cambiar reglas Firestore para validar membresia por organizacion.
- Migrar usuarios existentes creando una membresia con su `organizationId` actual.

## Prioridad

Este cambio debe hacerse antes de rentar la app a muchos negocios, porque es una decision estructural. Conviene hacerlo antes de agregar demasiadas pantallas nuevas.
