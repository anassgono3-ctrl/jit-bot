/**
 * Structured JSON Logger for JIT Strategy
 * Logs decision events, results, and anomalies
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export interface LogEntry {
  timestamp: string;
  level: string;
  component: string;
  event: string;
  data: any;
  sessionId?: string;
  traceId?: string;
}

export interface JitDecisionLog {
  swapId: string;
  poolAddress: string;
  swapSizeUsd: number;
  decision: 'skip' | 'attempt' | 'abort';
  reason: string;
  score?: number;
  confidence?: number;
  estimatedProfitUsd?: number;
  tickRange?: { lower: number; upper: number };
  liquidityAmount?: string;
}

export interface JitResultLog {
  swapId: string;
  positionId: string;
  success: boolean;
  profitable: boolean;
  grossFeesUsd: number;
  gasCostUsd: number;
  netProfitUsd: number;
  executionTimeMs: number;
  priceImpact: number;
  slippage: number;
}

export interface AnomalyLog {
  type: 'price_anomaly' | 'liquidity_anomaly' | 'gas_spike' | 'execution_delay' | 'unexpected_revert';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  affectedPools?: string[];
  metrics: Record<string, number>;
  actionTaken?: string;
}

export class JitLogger {
  private logLevel: LogLevel;
  private sessionId: string;
  private logBuffer: LogEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private outputStream: NodeJS.WritableStream;
  
  constructor(
    logLevel: LogLevel = LogLevel.INFO,
    outputStream: NodeJS.WritableStream = process.stdout
  ) {
    this.logLevel = logLevel;
    this.sessionId = this.generateSessionId();
    this.outputStream = outputStream;
    
    // Auto-flush every 5 seconds
    this.flushInterval = setInterval(() => this.flush(), 5000);
  }
  
  /**
   * Log JIT decision event
   */
  logJitDecision(decision: JitDecisionLog, traceId?: string): void {
    this.log(LogLevel.INFO, 'jit-planner', 'decision', decision, traceId);
  }
  
  /**
   * Log JIT execution result
   */
  logJitResult(result: JitResultLog, traceId?: string): void {
    const level = result.success ? LogLevel.INFO : LogLevel.WARN;
    this.log(level, 'jit-executor', 'result', result, traceId);
  }
  
  /**
   * Log anomaly detection
   */
  logAnomaly(anomaly: AnomalyLog, traceId?: string): void {
    const levelMap = {
      low: LogLevel.DEBUG,
      medium: LogLevel.INFO,
      high: LogLevel.WARN,
      critical: LogLevel.ERROR
    };
    
    this.log(levelMap[anomaly.severity], 'anomaly-detector', anomaly.type, anomaly, traceId);
  }
  
  /**
   * Log pool health update
   */
  logPoolHealth(poolAddress: string, health: string, metrics: any, traceId?: string): void {
    this.log(LogLevel.INFO, 'pool-manager', 'health-update', {
      poolAddress,
      health,
      metrics
    }, traceId);
  }
  
  /**
   * Log backtest progress
   */
  logBacktestProgress(progress: {
    fixture: string;
    processed: number;
    total: number;
    positions: number;
    currentPnL: number;
  }, traceId?: string): void {
    this.log(LogLevel.INFO, 'backtest-runner', 'progress', progress, traceId);
  }
  
  /**
   * Log strategy performance metrics
   */
  logPerformanceMetrics(metrics: {
    timeframe: string;
    totalPositions: number;
    successRate: number;
    totalPnLUsd: number;
    sharpeRatio: number;
    maxDrawdownUsd: number;
  }, traceId?: string): void {
    this.log(LogLevel.INFO, 'performance-tracker', 'metrics', metrics, traceId);
  }
  
  /**
   * Log error with context
   */
  logError(component: string, error: Error, context?: any, traceId?: string): void {
    this.log(LogLevel.ERROR, component, 'error', {
      message: error.message,
      stack: error.stack,
      context
    }, traceId);
  }
  
  /**
   * Log warning
   */
  logWarning(component: string, message: string, data?: any, traceId?: string): void {
    this.log(LogLevel.WARN, component, 'warning', { message, ...data }, traceId);
  }
  
  /**
   * Log info
   */
  logInfo(component: string, event: string, data?: any, traceId?: string): void {
    this.log(LogLevel.INFO, component, event, data, traceId);
  }
  
  /**
   * Log debug information
   */
  logDebug(component: string, event: string, data?: any, traceId?: string): void {
    this.log(LogLevel.DEBUG, component, event, data, traceId);
  }
  
  /**
   * Core logging method
   */
  private log(level: LogLevel, component: string, event: string, data: any, traceId?: string): void {
    if (level < this.logLevel) {
      return;
    }
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      component,
      event,
      data,
      sessionId: this.sessionId,
      traceId
    };
    
    this.logBuffer.push(entry);
    
    // Auto-flush on errors or if buffer is full
    if (level >= LogLevel.ERROR || this.logBuffer.length >= 100) {
      this.flush();
    }
  }
  
  /**
   * Flush log buffer to output
   */
  flush(): void {
    if (this.logBuffer.length === 0) {
      return;
    }
    
    for (const entry of this.logBuffer) {
      this.outputStream.write(JSON.stringify(entry) + '\n');
    }
    
    this.logBuffer = [];
  }
  
  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `jit-${timestamp}-${random}`;
  }
  
  /**
   * Generate trace ID for request tracking
   */
  static generateTraceId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 15);
    return `${timestamp}-${random}`;
  }
  
  /**
   * Set log level
   */
  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }
  
  /**
   * Get current session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }
  
  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    
    this.flush(); // Final flush
  }
}

/**
 * Global logger instance
 */
let globalLogger: JitLogger | null = null;

/**
 * Initialize global logger
 */
export function initializeLogger(
  logLevel: LogLevel = LogLevel.INFO,
  outputStream?: NodeJS.WritableStream
): JitLogger {
  if (globalLogger) {
    globalLogger.destroy();
  }
  
  globalLogger = new JitLogger(logLevel, outputStream);
  return globalLogger;
}

/**
 * Get global logger instance
 */
export function getLogger(): JitLogger {
  if (!globalLogger) {
    globalLogger = new JitLogger();
  }
  
  return globalLogger;
}

/**
 * Log structured event with automatic trace ID
 */
export function logEvent(component: string, event: string, data: any): string {
  const traceId = JitLogger.generateTraceId();
  getLogger().logInfo(component, event, data, traceId);
  return traceId;
}

/**
 * Create component-specific logger
 */
export function createComponentLogger(componentName: string) {
  const logger = getLogger();
  
  return {
    debug: (event: string, data?: any, traceId?: string) => 
      logger.logDebug(componentName, event, data, traceId),
    
    info: (event: string, data?: any, traceId?: string) => 
      logger.logInfo(componentName, event, data, traceId),
    
    warn: (message: string, data?: any, traceId?: string) => 
      logger.logWarning(componentName, message, data, traceId),
    
    error: (error: Error, context?: any, traceId?: string) => 
      logger.logError(componentName, error, context, traceId),
    
    decision: (decision: JitDecisionLog, traceId?: string) => 
      logger.logJitDecision(decision, traceId),
    
    result: (result: JitResultLog, traceId?: string) => 
      logger.logJitResult(result, traceId),
    
    anomaly: (anomaly: AnomalyLog, traceId?: string) => 
      logger.logAnomaly(anomaly, traceId)
  };
}

/**
 * Utility function to create structured log data
 */
export function createLogData(data: Record<string, any>): any {
  // Ensure BigInt values are converted to strings for JSON serialization
  return JSON.parse(JSON.stringify(data, (key, value) => 
    typeof value === 'bigint' ? value.toString() : value
  ));
}

/**
 * Log performance timing
 */
export function logTiming<T>(
  component: string,
  operation: string,
  fn: () => T | Promise<T>,
  traceId?: string
): Promise<T> {
  const startTime = Date.now();
  const logger = getLogger();
  
  const logCompletion = (duration: number, success: boolean, error?: Error) => {
    logger.logInfo(component, 'timing', {
      operation,
      durationMs: duration,
      success,
      error: error?.message
    }, traceId);
  };
  
  try {
    const result = fn();
    
    if (result instanceof Promise) {
      return result
        .then(value => {
          logCompletion(Date.now() - startTime, true);
          return value;
        })
        .catch(error => {
          logCompletion(Date.now() - startTime, false, error);
          throw error;
        });
    } else {
      logCompletion(Date.now() - startTime, true);
      return Promise.resolve(result);
    }
  } catch (error) {
    logCompletion(Date.now() - startTime, false, error as Error);
    throw error;
  }
}