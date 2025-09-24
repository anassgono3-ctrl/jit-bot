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
