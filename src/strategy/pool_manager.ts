/**
 * Pool Manager
 * Loads, filters, and prioritizes pools for JIT strategy
 */

import * as fs from 'fs';
import * as path from 'path';

export interface PoolConfig {
  name: string;
  address: string;
  feeTier: number;
  token0: string;
  token1: string;
  decimals: {
    token0: number;
    token1: number;
  };
}

export interface PoolMetrics {
  tvl: number; // Total Value Locked in USD
  volume24h: number; // 24h volume in USD
  volatility: number; // Recent volatility measure
  spread: number; // Current bid-ask spread
  liquidityDistribution: Map<number, bigint>; // Liquidity by tick
  lastUpdate: number; // Timestamp of last metrics update
  health: 'healthy' | 'degraded' | 'unhealthy';
  enabled: boolean;
}

export interface PoolPriority {
  pool: PoolConfig;
  metrics: PoolMetrics;
  priority: number; // 1-10, higher = better
  reasoning: string[];
}

export class PoolManager {
  private pools: Map<string, PoolConfig> = new Map();
  private metrics: Map<string, PoolMetrics> = new Map();
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(__dirname, '../config/pools.json');
    this.loadPools();
  }

  /**
   * Load pool configurations from JSON file
   */
  private loadPools(): void {
    try {
      const poolsData = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      
      for (const poolConfig of poolsData) {
        this.pools.set(poolConfig.address.toLowerCase(), poolConfig);
        
        // Initialize default metrics
        this.metrics.set(poolConfig.address.toLowerCase(), {
          tvl: 0,
          volume24h: 0,
          volatility: 0.02, // Default 2% volatility
          spread: 0.001, // Default 0.1% spread
          liquidityDistribution: new Map(),
          lastUpdate: 0,
          health: 'healthy',
          enabled: true
        });
      }
      
      console.log(`Loaded ${this.pools.size} pool configurations`);
    } catch (error) {
      console.error('Failed to load pool configurations:', error);
      throw new Error('Pool configuration loading failed');
    }
  }

  /**
   * Get all eligible pools
   * @param filters Optional filters to apply
   * @returns Array of eligible pools
   */
  getEligiblePools(filters?: {
    minTvl?: number;
    minVolume24h?: number;
    maxVolatility?: number;
    feeTiers?: number[];
    healthStates?: Array<'healthy' | 'degraded' | 'unhealthy'>;
  }): PoolConfig[] {
    const eligiblePools: PoolConfig[] = [];
    
    for (const [address, pool] of this.pools) {
      const metrics = this.metrics.get(address);
      
      if (!metrics || !metrics.enabled) {
        continue;
      }
      
      // Apply filters
      if (filters) {
        if (filters.minTvl && metrics.tvl < filters.minTvl) continue;
        if (filters.minVolume24h && metrics.volume24h < filters.minVolume24h) continue;
        if (filters.maxVolatility && metrics.volatility > filters.maxVolatility) continue;
        if (filters.feeTiers && !filters.feeTiers.includes(pool.feeTier)) continue;
        if (filters.healthStates && !filters.healthStates.includes(metrics.health)) continue;
      }
      
      eligiblePools.push(pool);
    }
    
    return eligiblePools;
  }

  /**
   * Get prioritized pools for JIT strategy
   * @param maxPools Maximum number of pools to return
   * @returns Array of pools with priority rankings
   */
  getPrioritizedPools(maxPools: number = 10): PoolPriority[] {
    const eligiblePools = this.getEligiblePools({
      healthStates: ['healthy', 'degraded']
    });
    
    const prioritizedPools = eligiblePools.map(pool => {
      const metrics = this.metrics.get(pool.address.toLowerCase())!;
      const priority = this.calculatePoolPriority(pool, metrics);
      
      return {
        pool,
        metrics,
        priority: priority.score,
        reasoning: priority.reasoning
      };
    });
    
    // Sort by priority descending and limit
    return prioritizedPools
      .sort((a, b) => b.priority - a.priority)
      .slice(0, maxPools);
  }

  /**
   * Calculate priority score for a pool
   */
  private calculatePoolPriority(pool: PoolConfig, metrics: PoolMetrics): {
    score: number;
    reasoning: string[];
  } {
    let score = 5; // Base score
    const reasoning: string[] = [];
    
    // Fee tier priority (0.30% pools are primary target)
    if (pool.feeTier === 3000) {
      score += 3;
      reasoning.push('0.30% fee tier - primary target');
    } else if (pool.feeTier === 500) {
      score += 1;
      reasoning.push('0.05% fee tier - secondary target');
    } else {
      score -= 1;
      reasoning.push('Non-standard fee tier');
    }
    
    // Volume score (higher volume = more opportunities)
    if (metrics.volume24h > 50000000) { // >$50M
      score += 2;
      reasoning.push('High volume (>$50M/24h)');
    } else if (metrics.volume24h > 10000000) { // >$10M
      score += 1;
      reasoning.push('Good volume (>$10M/24h)');
    } else if (metrics.volume24h < 1000000) { // <$1M
      score -= 2;
      reasoning.push('Low volume (<$1M/24h)');
    }
    
    // TVL score (higher TVL = more stable)
    if (metrics.tvl > 100000000) { // >$100M
      score += 1;
      reasoning.push('High TVL (>$100M)');
    } else if (metrics.tvl < 10000000) { // <$10M
      score -= 1;
      reasoning.push('Low TVL (<$10M)');
    }
    
    // Volatility adjustment
    if (metrics.volatility > 0.08) { // >8%
      score -= 2;
      reasoning.push('High volatility (>8%)');
    } else if (metrics.volatility < 0.02) { // <2%
      score += 1;
      reasoning.push('Low volatility (<2%)');
    }
    
    // Health penalty
    if (metrics.health === 'degraded') {
      score -= 1;
      reasoning.push('Pool health degraded');
    } else if (metrics.health === 'unhealthy') {
      score -= 3;
      reasoning.push('Pool health unhealthy');
    }
    
    // Spread penalty (wider spread = less attractive)
    if (metrics.spread > 0.005) { // >0.5%
      score -= 1;
      reasoning.push('Wide spread (>0.5%)');
    }
    
    // Ensure score is within bounds
    score = Math.max(1, Math.min(10, score));
    
    return { score, reasoning };
  }

  /**
   * Update pool metrics
   * @param address Pool address
   * @param newMetrics Updated metrics
   */
  updatePoolMetrics(address: string, newMetrics: Partial<PoolMetrics>): void {
    const normalizedAddress = address.toLowerCase();
    const currentMetrics = this.metrics.get(normalizedAddress);
    
    if (currentMetrics) {
      this.metrics.set(normalizedAddress, {
        ...currentMetrics,
        ...newMetrics,
        lastUpdate: Date.now()
      });
    }
  }

  /**
   * Disable a pool (e.g., due to issues)
   * @param address Pool address
   * @param reason Reason for disabling
   */
  disablePool(address: string, reason: string): void {
    const normalizedAddress = address.toLowerCase();
    const metrics = this.metrics.get(normalizedAddress);
    
    if (metrics) {
      metrics.enabled = false;
      metrics.health = 'unhealthy';
      console.log(`Pool ${address} disabled: ${reason}`);
    }
  }

  /**
   * Enable a pool
   * @param address Pool address
   */
  enablePool(address: string): void {
    const normalizedAddress = address.toLowerCase();
    const metrics = this.metrics.get(normalizedAddress);
    
    if (metrics) {
      metrics.enabled = true;
      if (metrics.health === 'unhealthy') {
        metrics.health = 'degraded'; // Conservative re-enable
      }
      console.log(`Pool ${address} enabled`);
    }
  }

  /**
   * Get pool configuration by address
   * @param address Pool address
   * @returns Pool configuration or undefined
   */
  getPoolConfig(address: string): PoolConfig | undefined {
    return this.pools.get(address.toLowerCase());
  }

  /**
   * Get pool metrics by address
   * @param address Pool address
   * @returns Pool metrics or undefined
   */
  getPoolMetrics(address: string): PoolMetrics | undefined {
    return this.metrics.get(address.toLowerCase());
  }

  /**
   * Get pools by token pair
   * @param token0 First token symbol
   * @param token1 Second token symbol
   * @returns Array of matching pools
   */
  getPoolsByTokenPair(token0: string, token1: string): PoolConfig[] {
    const matchingPools: PoolConfig[] = [];
    
    for (const pool of this.pools.values()) {
      if (
        (pool.token0 === token0 && pool.token1 === token1) ||
        (pool.token0 === token1 && pool.token1 === token0)
      ) {
        matchingPools.push(pool);
      }
    }
    
    return matchingPools.sort((a, b) => {
      // Sort by fee tier priority (3000 > 500 > 10000)
      const priorityOrder = [3000, 500, 10000];
      const aPriority = priorityOrder.indexOf(a.feeTier);
      const bPriority = priorityOrder.indexOf(b.feeTier);
      
      if (aPriority === -1 && bPriority === -1) return 0;
      if (aPriority === -1) return 1;
      if (bPriority === -1) return -1;
      
      return aPriority - bPriority;
    });
  }

  /**
   * Get health summary of all pools
   * @returns Health summary
   */
  getHealthSummary(): {
    total: number;
    enabled: number;
    healthy: number;
    degraded: number;
    unhealthy: number;
    avgVolume24h: number;
    avgTvl: number;
  } {
    let enabled = 0;
    let healthy = 0;
    let degraded = 0;
    let unhealthy = 0;
    let totalVolume = 0;
    let totalTvl = 0;
    
    for (const metrics of this.metrics.values()) {
      if (metrics.enabled) enabled++;
      
      switch (metrics.health) {
        case 'healthy':
          healthy++;
          break;
        case 'degraded':
          degraded++;
          break;
        case 'unhealthy':
          unhealthy++;
          break;
      }
      
      totalVolume += metrics.volume24h;
      totalTvl += metrics.tvl;
    }
    
    const total = this.pools.size;
    
    return {
      total,
      enabled,
      healthy,
      degraded,
      unhealthy,
      avgVolume24h: total > 0 ? totalVolume / total : 0,
      avgTvl: total > 0 ? totalTvl / total : 0
    };
  }

  /**
   * Refresh pool health based on metrics
   */
  refreshPoolHealth(): void {
    for (const [address, metrics] of this.metrics) {
      let newHealth: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      
      // Check for unhealthy conditions
      if (
        metrics.volume24h < 100000 || // <$100k volume
        metrics.tvl < 1000000 || // <$1M TVL
        metrics.volatility > 0.15 || // >15% volatility
        Date.now() - metrics.lastUpdate > 3600000 // >1 hour since update
      ) {
        newHealth = 'unhealthy';
      }
      // Check for degraded conditions
      else if (
        metrics.volume24h < 1000000 || // <$1M volume
        metrics.tvl < 10000000 || // <$10M TVL
        metrics.volatility > 0.1 || // >10% volatility
        Date.now() - metrics.lastUpdate > 1800000 // >30 min since update
      ) {
        newHealth = 'degraded';
      }
      
      if (metrics.health !== newHealth) {
        metrics.health = newHealth;
        console.log(`Pool ${address} health changed to ${newHealth}`);
      }
    }
  }

  /**
   * Export pool configuration and metrics
   * @returns Serializable pool data
   */
  exportPoolData(): {
    pools: PoolConfig[];
    metrics: Array<{ address: string; metrics: PoolMetrics }>;
    timestamp: number;
  } {
    return {
      pools: Array.from(this.pools.values()),
      metrics: Array.from(this.metrics.entries()).map(([address, metrics]) => ({
        address,
        metrics: {
          ...metrics,
          liquidityDistribution: Array.from(metrics.liquidityDistribution.entries())
        } as any
      })),
      timestamp: Date.now()
    };
  }

  /**
   * Import pool metrics (for testing or data restoration)
   * @param data Pool data to import
   */
  importPoolData(data: {
    metrics: Array<{ address: string; metrics: any }>;
  }): void {
    for (const { address, metrics } of data.metrics) {
      const normalizedAddress = address.toLowerCase();
      
      if (this.pools.has(normalizedAddress)) {
        this.metrics.set(normalizedAddress, {
          ...metrics,
          liquidityDistribution: new Map(metrics.liquidityDistribution || [])
        });
      }
    }
  }
}