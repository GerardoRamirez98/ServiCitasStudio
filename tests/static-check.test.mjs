import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const files = [
  'src/screens/AdminScreen.tsx',
  'src/screens/ClientScreen.tsx',
  'server/src/index.ts',
  'database/sqlserver/schema.sql',
  'README.md',
];

test('no quedan separadores corruptos conocidos', () => {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    assert.equal(content.includes('ТЗ'), false, `${file} contiene ТЗ`);
    assert.equal(content.includes('�'), false, `${file} contiene caracter de reemplazo`);
  }
});

test('rutas criticas sin credenciales estan presentes', () => {
  const server = readFileSync('server/src/index.ts', 'utf8');
  for (const route of [
    '/promotions',
    '/client-histories',
    '/employee-blocks',
    '/reports/finance',
    '/portfolio',
    '/clients/organizations/search',
    '/clients/appointments',
  ]) {
    assert.ok(server.includes(route), `falta ruta ${route}`);
  }
});

test('agenda valida horarios, permisos y paginacion', () => {
  const server = readFileSync('server/src/index.ts', 'utf8');
  assert.ok(server.includes('employeeScheduleAllowsSlot'), 'falta validacion de horario por empleado');
  assert.ok(server.includes('assertOrgScheduler'), 'falta permiso de agenda completa');
  assert.ok(server.includes("app.get('/organizations/:organizationId/appointments'"), 'falta paginacion de citas');
  assert.ok(server.includes('OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY'), 'falta consulta paginada');
});
