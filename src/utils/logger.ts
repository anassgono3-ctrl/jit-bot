/**
 * Structured logging utilities using pino
 */

import pino from 'pino';

/**
 * Create a logger instance with the specified log level
 */
export function createLogger(level: string = 'info'): pino.Logger {
  return pino({
    level,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  });
}

/**
 * Default logger instance
 */
export const logger = createLogger();

/**
 * Log helper that accepts additional metadata
 */
export function logWithMeta(
  logger: pino.Logger,
  level: string,
  message: string,
  meta?: Record<string, unknown>
): void {
  if (meta) {
    (logger as any)[level](meta, message);
  } else {
    (logger as any)[level](message);
  }
}