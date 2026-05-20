import { apiSqlServerHealth } from './api';

export type SqlServerHealthResponse = {
  serverName: string;
  databaseName: string;
  checkedAt: string;
};

export async function checkSqlServerConnection(): Promise<SqlServerHealthResponse> {
  const status = await apiSqlServerHealth();
  return {
    serverName: status.serverName,
    databaseName: status.databaseName,
    checkedAt: status.checkedAt,
  };
}
