type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function writeLog(level: LogLevel, event: string, context?: Record<string, unknown>) {
  const payload = {
    level,
    event,
    context: context ?? {},
    at: new Date().toISOString(),
  };

  if (level === 'error') {
    console.error(JSON.stringify(payload));
    return;
  }
  if (level === 'warn') {
    console.warn(JSON.stringify(payload));
    return;
  }
  console.log(JSON.stringify(payload));
}

export const appLogger = {
  debug: (event: string, context?: Record<string, unknown>) => writeLog('debug', event, context),
  info: (event: string, context?: Record<string, unknown>) => writeLog('info', event, context),
  warn: (event: string, context?: Record<string, unknown>) => writeLog('warn', event, context),
  error: (event: string, context?: Record<string, unknown>) => writeLog('error', event, context),
};
