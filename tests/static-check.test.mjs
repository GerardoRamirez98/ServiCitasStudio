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
  ]) {
    assert.ok(server.includes(route), `falta ruta ${route}`);
  }
});
