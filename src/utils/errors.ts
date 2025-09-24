/**
 * Custom error types for the JIT bot
 */

/**
 * Base error class for JIT bot operations
 */
export class JitBotError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'JitBotError';
  }
}

/**
 * Configuration validation error
 */
export class ConfigError extends JitBotError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

/**
 * Provider connection error
 */
export class ProviderError extends JitBotError {
  constructor(message: string) {
    super(message, 'PROVIDER_ERROR');
    this.name = 'ProviderError';
  }
}

/**
 * Transaction execution error
 */
export class TransactionError extends JitBotError {
  constructor(message: string) {
    super(message, 'TRANSACTION_ERROR');
    this.name = 'TransactionError';
  }
}
