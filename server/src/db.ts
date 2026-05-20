import tediousSql from 'mssql';
import type * as SqlTypes from 'mssql';

let poolPromise: Promise<SqlTypes.ConnectionPool> | null = null;

function env(name: string, fallback = '') {
  return process.env[name] || fallback;
}

function boolEnv(name: string, fallback: boolean) {
  return ['1', 'true', 'yes', 'si'].includes(env(name, String(fallback)).toLowerCase());
}

function numberEnv(name: string) {
  const value = Number(env(name));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function driver() {
  if (env('SQLSERVER_DRIVER', 'tedious').toLowerCase() === 'msnodesqlv8') {
    return require('mssql/msnodesqlv8') as typeof import('mssql');
  }
  return tediousSql;
}

function tediousConfig(): SqlTypes.config {
  const port = numberEnv('SQLSERVER_PORT');
  const instanceName = env('SQLSERVER_INSTANCE');
  return {
    server: env('SQLSERVER_HOST', 'localhost'),
    database: env('SQLSERVER_DATABASE', 'ServiCitasStudio'),
    user: env('SQLSERVER_USER', 'sa'),
    password: env('SQLSERVER_PASSWORD'),
    port,
    options: {
      instanceName: port ? undefined : instanceName || undefined,
      encrypt: boolEnv('SQLSERVER_ENCRYPT', false),
      trustServerCertificate: boolEnv('SQLSERVER_TRUST_CERTIFICATE', true),
    },
  };
}

function odbcConfig() {
  const host = env('SQLSERVER_HOST', 'localhost');
  const instanceName = env('SQLSERVER_INSTANCE');
  const port = numberEnv('SQLSERVER_PORT');
  const server = port ? `${host},${port}` : instanceName ? `${host}\\${instanceName}` : host;
  return {
    connectionString: [
      'Driver={ODBC Driver 17 for SQL Server}',
      `Server=${server}`,
      `Database=${env('SQLSERVER_DATABASE', 'ServiCitasStudio')}`,
      `UID=${env('SQLSERVER_USER', 'sa')}`,
      `PWD=${env('SQLSERVER_PASSWORD')}`,
      'TrustServerCertificate=yes',
    ].join(';'),
  };
}

export function getPool() {
  const currentDriver = driver();
  const config = env('SQLSERVER_DRIVER', 'tedious').toLowerCase() === 'msnodesqlv8' ? odbcConfig() : tediousConfig();
  poolPromise ??= new currentDriver.ConnectionPool(config as SqlTypes.config).connect();
  return poolPromise;
}

export { tediousSql as sql };
