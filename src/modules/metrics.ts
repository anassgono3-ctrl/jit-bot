/**
 * Prometheus Metrics for JIT Strategy
 * Counters, gauges, and histograms for monitoring
 */

export interface PrometheusMetrics {
  // Counters (monotonically increasing)
  jit_opportunities_detected_total: number;
  jit_positions_opened_total: number;
  jit_positions_successful_total: number;
  jit_positions_profitable_total: number;
  jit_simulation_errors_total: number;
  jit_execution_errors_total: number;
  
  // Gauges (current values)
  jit_active_positions: number;
  jit_total_capital_usd: number;
  jit_unrealized_pnl_usd: number;
  jit_gas_price_gwei: number;
  jit_pool_health_score: Record<string, number>;
  
  // Histograms (distributions)
  jit_position_profit_usd: number[];
  jit_position_duration_ms: number[];
  jit_gas_cost_usd: number[];
  jit_swap_size_usd: number[];
  jit_score_distribution: number[];
}

export interface MetricUpdate {
  timestamp: number;
  name: string;
  value: number;
  labels?: Record<string, string>;
  type: 'counter' | 'gauge' | 'histogram';
}

export class JitMetrics {
  private metrics: PrometheusMetrics;
  private histograms: Map<string, number[]> = new Map();
  private lastUpdate: number = Date.now();
  private updateBuffer: MetricUpdate[] = [];
  
  constructor() {
    this.metrics = {
      // Counters
      jit_opportunities_detected_total: 0,
      jit_positions_opened_total: 0,
      jit_positions_successful_total: 0,
      jit_positions_profitable_total: 0,
      jit_simulation_errors_total: 0,
      jit_execution_errors_total: 0,
      
      // Gauges
      jit_active_positions: 0,
      jit_total_capital_usd: 0,
      jit_unrealized_pnl_usd: 0,
      jit_gas_price_gwei: 15,
      jit_pool_health_score: {},
      
      // Histograms
      jit_position_profit_usd: [],
      jit_position_duration_ms: [],
      jit_gas_cost_usd: [],
      jit_swap_size_usd: [],
      jit_score_distribution: []
    };
    
    // Initialize histogram storage
    this.histograms.set('jit_position_profit_usd', []);
    this.histograms.set('jit_position_duration_ms', []);
    this.histograms.set('jit_gas_cost_usd', []);
    this.histograms.set('jit_swap_size_usd', []);
    this.histograms.set('jit_score_distribution', []);
  }
  
  /**
   * Record opportunity detection
   */
  recordOpportunityDetected(poolAddress: string, swapSizeUsd: number, score: number): void {
    this.incrementCounter('jit_opportunities_detected_total', { pool: poolAddress });
    this.recordHistogram('jit_swap_size_usd', swapSizeUsd);
    this.recordHistogram('jit_score_distribution', score);
  }
  
  /**
   * Record position opening
   */
  recordPositionOpened(
    poolAddress: string,
    liquidityUsd: number,
    tickRange: { lower: number; upper: number }
  ): void {
    this.incrementCounter('jit_positions_opened_total', { pool: poolAddress });
    this.setGauge('jit_active_positions', this.metrics.jit_active_positions + 1);
    
    // Track capital deployment
    this.setGauge('jit_total_capital_usd', this.metrics.jit_total_capital_usd + liquidityUsd);
  }
  
  /**
   * Record position result
   */
  recordPositionResult(
    poolAddress: string,
    success: boolean,
    profitable: boolean,
    profitUsd: number,
    durationMs: number,
    gasCostUsd: number
  ): void {
    // Update counters
    if (success) {
      this.incrementCounter('jit_positions_successful_total', { pool: poolAddress });
    }
    
    if (profitable) {
      this.incrementCounter('jit_positions_profitable_total', { pool: poolAddress });
    }
    
    // Update gauges
    this.setGauge('jit_active_positions', Math.max(0, this.metrics.jit_active_positions - 1));
    this.setGauge('jit_unrealized_pnl_usd', this.metrics.jit_unrealized_pnl_usd + profitUsd);
    
    // Record histograms
    this.recordHistogram('jit_position_profit_usd', profitUsd);
    this.recordHistogram('jit_position_duration_ms', durationMs);
    this.recordHistogram('jit_gas_cost_usd', gasCostUsd);
  }
  
  /**
   * Record simulation error
   */
  recordSimulationError(poolAddress: string, errorType: string): void {
    this.incrementCounter('jit_simulation_errors_total', { 
      pool: poolAddress, 
      error_type: errorType 
    });
  }
  
  /**
   * Record execution error
   */
  recordExecutionError(poolAddress: string, errorType: string): void {
    this.incrementCounter('jit_execution_errors_total', { 
      pool: poolAddress, 
      error_type: errorType 
    });
  }
  
  /**
   * Update gas price
   */
  updateGasPrice(gasPriceGwei: number): void {
    this.setGauge('jit_gas_price_gwei', gasPriceGwei);
  }
  
  /**
   * Update pool health score
   */
  updatePoolHealth(poolAddress: string, healthScore: number): void {
    this.metrics.jit_pool_health_score[poolAddress] = healthScore;
    this.addUpdate('jit_pool_health_score', healthScore, { pool: poolAddress }, 'gauge');
  }
  
  /**
   * Get current metrics snapshot
   */
  getMetricsSnapshot(): PrometheusMetrics & { 
    snapshot_timestamp: number;
    histogram_stats: Record<string, {
      count: number;
      sum: number;
      min: number;
      max: number;
      avg: number;
      p50: number;
      p95: number;
      p99: number;
    }>;
  } {
    const histogramStats: Record<string, any> = {};
    
    for (const [name, values] of this.histograms) {
      if (values.length > 0) {
        const sorted = [...values].sort((a, b) => a - b);
        const sum = values.reduce((a, b) => a + b, 0);
        
        histogramStats[name] = {
          count: values.length,
          sum,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          avg: sum / values.length,
          p50: this.percentile(sorted, 0.5),
          p95: this.percentile(sorted, 0.95),
          p99: this.percentile(sorted, 0.99)
        };
      } else {
        histogramStats[name] = {
          count: 0, sum: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0
        };
      }
    }
    
    return {
      ...this.metrics,
      snapshot_timestamp: Date.now(),
      histogram_stats: histogramStats
    };
  }
  
  /**
   * Export metrics in Prometheus format
   */
  exportPrometheusMetrics(): string {
    const lines: string[] = [];
    const timestamp = Date.now();
    
    // Counters
    lines.push(`# HELP jit_opportunities_detected_total Number of JIT opportunities detected`);
    lines.push(`# TYPE jit_opportunities_detected_total counter`);
    lines.push(`jit_opportunities_detected_total ${this.metrics.jit_opportunities_detected_total} ${timestamp}`);
    
    lines.push(`# HELP jit_positions_opened_total Number of JIT positions opened`);
    lines.push(`# TYPE jit_positions_opened_total counter`);
    lines.push(`jit_positions_opened_total ${this.metrics.jit_positions_opened_total} ${timestamp}`);
    
    lines.push(`# HELP jit_positions_successful_total Number of successful JIT positions`);
    lines.push(`# TYPE jit_positions_successful_total counter`);
    lines.push(`jit_positions_successful_total ${this.metrics.jit_positions_successful_total} ${timestamp}`);
    
    lines.push(`# HELP jit_positions_profitable_total Number of profitable JIT positions`);
    lines.push(`# TYPE jit_positions_profitable_total counter`);
    lines.push(`jit_positions_profitable_total ${this.metrics.jit_positions_profitable_total} ${timestamp}`);
    
    // Gauges
    lines.push(`# HELP jit_active_positions Number of currently active JIT positions`);
    lines.push(`# TYPE jit_active_positions gauge`);
    lines.push(`jit_active_positions ${this.metrics.jit_active_positions} ${timestamp}`);
    
    lines.push(`# HELP jit_total_capital_usd Total capital deployed in USD`);
    lines.push(`# TYPE jit_total_capital_usd gauge`);
    lines.push(`jit_total_capital_usd ${this.metrics.jit_total_capital_usd} ${timestamp}`);
    
    lines.push(`# HELP jit_unrealized_pnl_usd Unrealized PnL in USD`);
    lines.push(`# TYPE jit_unrealized_pnl_usd gauge`);
    lines.push(`jit_unrealized_pnl_usd ${this.metrics.jit_unrealized_pnl_usd} ${timestamp}`);
    
    lines.push(`# HELP jit_gas_price_gwei Current gas price in Gwei`);
    lines.push(`# TYPE jit_gas_price_gwei gauge`);
    lines.push(`jit_gas_price_gwei ${this.metrics.jit_gas_price_gwei} ${timestamp}`);
    
    // Pool health scores
    lines.push(`# HELP jit_pool_health_score Health score for each pool (0-100)`);
    lines.push(`# TYPE jit_pool_health_score gauge`);
    for (const [pool, score] of Object.entries(this.metrics.jit_pool_health_score)) {
      lines.push(`jit_pool_health_score{pool="${pool}"} ${score} ${timestamp}`);
    }
    
    // Histogram summaries
    const snapshot = this.getMetricsSnapshot();
    for (const [name, stats] of Object.entries(snapshot.histogram_stats)) {
      lines.push(`# HELP ${name} ${name.replace(/_/g, ' ')}`);
      lines.push(`# TYPE ${name} histogram`);
      lines.push(`${name}_count ${stats.count} ${timestamp}`);
      lines.push(`${name}_sum ${stats.sum} ${timestamp}`);
      lines.push(`${name}_bucket{le="0.5"} ${stats.p50} ${timestamp}`);
      lines.push(`${name}_bucket{le="0.95"} ${stats.p95} ${timestamp}`);
      lines.push(`${name}_bucket{le="0.99"} ${stats.p99} ${timestamp}`);
      lines.push(`${name}_bucket{le="+Inf"} ${stats.count} ${timestamp}`);
    }
    
    return lines.join('\n');
  }
  
  /**
   * Reset all metrics (for testing)
   */
  reset(): void {
    this.metrics = {
      jit_opportunities_detected_total: 0,
      jit_positions_opened_total: 0,
      jit_positions_successful_total: 0,
      jit_positions_profitable_total: 0,
      jit_simulation_errors_total: 0,
      jit_execution_errors_total: 0,
      jit_active_positions: 0,
      jit_total_capital_usd: 0,
      jit_unrealized_pnl_usd: 0,
      jit_gas_price_gwei: 15,
      jit_pool_health_score: {},
      jit_position_profit_usd: [],
      jit_position_duration_ms: [],
      jit_gas_cost_usd: [],
      jit_swap_size_usd: [],
      jit_score_distribution: []
    };
    
    this.histograms.clear();
    this.updateBuffer = [];
  }
  
  /**
   * Get performance summary
   */
  getPerformanceSummary(): {
    totalOpportunities: number;
    totalPositions: number;
    successRate: number;
    profitabilityRate: number;
    totalPnLUsd: number;
    avgPositionSizeUsd: number;
    avgGasCostUsd: number;
    activePositions: number;
    uptime: number;
  } {
    const snapshot = this.getMetricsSnapshot();
    const profitStats = snapshot.histogram_stats.jit_position_profit_usd;
    const gasCostStats = snapshot.histogram_stats.jit_gas_cost_usd;
    
    return {
      totalOpportunities: this.metrics.jit_opportunities_detected_total,
      totalPositions: this.metrics.jit_positions_opened_total,
      successRate: this.metrics.jit_positions_opened_total > 0 
        ? this.metrics.jit_positions_successful_total / this.metrics.jit_positions_opened_total 
        : 0,
      profitabilityRate: this.metrics.jit_positions_opened_total > 0 
        ? this.metrics.jit_positions_profitable_total / this.metrics.jit_positions_opened_total 
        : 0,
      totalPnLUsd: this.metrics.jit_unrealized_pnl_usd,
      avgPositionSizeUsd: this.metrics.jit_positions_opened_total > 0 
        ? this.metrics.jit_total_capital_usd / this.metrics.jit_positions_opened_total 
        : 0,
      avgGasCostUsd: gasCostStats.count > 0 ? gasCostStats.avg : 0,
      activePositions: this.metrics.jit_active_positions,
      uptime: Date.now() - this.lastUpdate
    };
  }
  
  // Private helper methods
  
  private incrementCounter(name: keyof PrometheusMetrics, labels?: Record<string, string>): void {
    if (typeof this.metrics[name] === 'number') {
      (this.metrics[name] as number)++;
      this.addUpdate(name, this.metrics[name] as number, labels, 'counter');
    }
  }
  
  private setGauge(name: keyof PrometheusMetrics, value: number, labels?: Record<string, string>): void {
    if (typeof this.metrics[name] === 'number') {
      (this.metrics[name] as number) = value;
      this.addUpdate(name, value, labels, 'gauge');
    }
  }
  
  private recordHistogram(name: string, value: number): void {
    const histogram = this.histograms.get(name);
    if (histogram) {
      histogram.push(value);
      
      // Keep only last 10000 values to prevent memory issues
      if (histogram.length > 10000) {
        histogram.splice(0, histogram.length - 10000);
      }
      
      this.addUpdate(name, value, undefined, 'histogram');
    }
  }
  
  private addUpdate(name: string, value: number, labels?: Record<string, string>, type: 'counter' | 'gauge' | 'histogram' = 'gauge'): void {
    this.updateBuffer.push({
      timestamp: Date.now(),
      name,
      value,
      labels,
      type
    });
    
    // Keep buffer size manageable
    if (this.updateBuffer.length > 1000) {
      this.updateBuffer.splice(0, this.updateBuffer.length - 1000);
    }
  }
  
  private percentile(sortedArray: number[], p: number): number {
    if (sortedArray.length === 0) return 0;
    
    const index = (sortedArray.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    
    if (lower === upper) {
      return sortedArray[lower];
    }
    
    const weight = index - lower;
    return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
  }
}

/**
 * Global metrics instance
 */
let globalMetrics: JitMetrics | null = null;

/**
 * Initialize global metrics
 */
export function initializeMetrics(): JitMetrics {
  if (globalMetrics) {
    globalMetrics.reset();
  } else {
    globalMetrics = new JitMetrics();
  }
  
  return globalMetrics;
}

/**
 * Get global metrics instance
 */
export function getMetrics(): JitMetrics {
  if (!globalMetrics) {
    globalMetrics = new JitMetrics();
  }
  
  return globalMetrics;
}

/**
 * Create metrics HTTP endpoint handler
 */
export function createMetricsHandler() {
  return (req: any, res: any) => {
    const metrics = getMetrics();
    
    if (req.url === '/metrics') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(metrics.exportPrometheusMetrics());
    } else if (req.url === '/metrics/json') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(metrics.getMetricsSnapshot(), null, 2));
    } else if (req.url === '/health') {
      const summary = metrics.getPerformanceSummary();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        summary
      }, null, 2));
    } else {
      res.statusCode = 404;
      res.end('Not Found');
    }
  };
}