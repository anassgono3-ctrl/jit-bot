/**
 * Generate synthetic swap fixtures for backtesting
 * Creates realistic swap sequences with different patterns
 */

import * as fs from 'fs';
import * as path from 'path';
import { getSqrtRatioAtTick, getTickAtSqrtRatio } from '../../math/tick_math';

export interface SwapEventFixture {
  timestamp: number;
  poolAddress: string;
  zeroForOne: boolean;
  amountIn: string; // BigInt as string
  amountOut: string;
  sqrtPriceX96Before: string;
  sqrtPriceX96After: string;
  tick: number;
  liquidity: string;
  feeAmount: string;
  swapSizeUsd: number;
  gasPrice: string;
}

export interface FixtureConfig {
  name: string;
  eventCount: number;
  pools: Array<{
    address: string;
    name: string;
    feeTier: number;
    weight: number; // Relative activity weight
  }>;
  
  swapSizeDistribution: {
    small: { min: number; max: number; weight: number }; // $1k-$15k
    medium: { min: number; max: number; weight: number }; // $15k-$100k
    large: { min: number; max: number; weight: number }; // $100k-$500k
    whale: { min: number; max: number; weight: number }; // $500k+
  };
  
  timePattern: {
    startTime: number;
    endTime: number;
    peakHours: number[]; // Hours with higher activity (UTC)
    volumeMultiplierPeak: number;
  };
  
  priceEvolution: {
    volatility: number; // Daily volatility
    trend: number; // Daily trend (-1 to 1)
    meanReversion: number; // Mean reversion strength
  };
}

/**
 * Generate synthetic swap fixtures
 */
export function generateFixtures(): void {
  const configs: FixtureConfig[] = [
    createSmallFixtureConfig(),
    createMediumFixtureConfig(),
    createLargeFixtureConfig(),
    createWhaleFixtureConfig()
  ];
  
  const outputDir = path.join(__dirname);
  
  for (const config of configs) {
    console.log(`Generating fixture: ${config.name}`);
    const fixture = generateSwapFixture(config);
    
    const filename = path.join(outputDir, `${config.name}.json`);
    fs.writeFileSync(filename, JSON.stringify(fixture, null, 2));
    
    console.log(`Generated ${fixture.length} events for ${config.name}`);
  }
  
  console.log('All fixtures generated successfully!');
}

/**
 * Generate swap fixture from configuration
 */
function generateSwapFixture(config: FixtureConfig): SwapEventFixture[] {
  const events: SwapEventFixture[] = [];
  const random = new SeededRandom(12345); // Deterministic random
  
  // Initialize price state for each pool
  const poolStates = new Map<string, {
    currentTick: number;
    currentPrice: bigint;
    liquidity: bigint;
    cumVolume: number;
  }>();
  
  for (const pool of config.pools) {
    const initialTick = 0; // Start at tick 0 (price = 1)
    poolStates.set(pool.address, {
      currentTick: initialTick,
      currentPrice: getSqrtRatioAtTick(initialTick),
      liquidity: BigInt(Math.floor(1000000 * Math.pow(10, 18))), // 1M initial liquidity
      cumVolume: 0
    });
  }
  
  // Generate events over time
  const timeSpan = config.timePattern.endTime - config.timePattern.startTime;
  
  for (let i = 0; i < config.eventCount; i++) {
    // Generate timestamp with activity patterns
    const progress = i / config.eventCount;
    const baseTime = config.timePattern.startTime + (progress * timeSpan);
    const hour = new Date(baseTime).getUTCHours();
    
    // Apply time-of-day volume multiplier
    const isPeakHour = config.timePattern.peakHours.includes(hour);
    const volumeMultiplier = isPeakHour ? config.timePattern.volumeMultiplierPeak : 1.0;
    
    // Add some randomness to timestamp
    const timestamp = Math.floor(baseTime + (random.next() - 0.5) * 3600000); // ±30 min
    
    // Select pool based on weights
    const selectedPool = selectWeightedPool(config.pools, random);
    const poolState = poolStates.get(selectedPool.address)!;
    
    // Generate swap size
    const swapSize = generateSwapSize(config.swapSizeDistribution, volumeMultiplier, random);
    
    // Generate price movement
    const priceMovement = generatePriceMovement(
      config.priceEvolution,
      poolState.currentTick,
      swapSize,
      random
    );
    
    // Determine swap direction
    const zeroForOne = priceMovement < 0;
    
    // Calculate new price and tick
    const newTick = Math.max(-887272, Math.min(887272, 
      poolState.currentTick + Math.floor(priceMovement * 1000) // Scale movement
    ));
    const newPrice = getSqrtRatioAtTick(newTick);
    
    // Calculate amounts (simplified)
    const amountIn = BigInt(Math.floor(swapSize * Math.pow(10, 18))); // Assume 18 decimals
    const feeRate = selectedPool.feeTier / 1000000;
    const feeAmount = amountIn * BigInt(Math.floor(feeRate * 1000000)) / 1000000n;
    const amountOut = amountIn - feeAmount; // Simplified
    
    // Calculate gas price (fluctuates between 10-50 gwei)
    const gasPrice = BigInt(Math.floor((10 + random.next() * 40) * 1e9));
    
    // Create swap event
    const swapEvent: SwapEventFixture = {
      timestamp,
      poolAddress: selectedPool.address,
      zeroForOne,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      sqrtPriceX96Before: poolState.currentPrice.toString(),
      sqrtPriceX96After: newPrice.toString(),
      tick: newTick,
      liquidity: poolState.liquidity.toString(),
      feeAmount: feeAmount.toString(),
      swapSizeUsd: swapSize,
      gasPrice: gasPrice.toString()
    };
    
    events.push(swapEvent);
    
    // Update pool state
    poolState.currentTick = newTick;
    poolState.currentPrice = newPrice;
    poolState.cumVolume += swapSize;
    
    // Occasionally adjust liquidity
    if (random.next() < 0.01) { // 1% chance
      const liquidityChange = (random.next() - 0.5) * 0.2; // ±10%
      poolState.liquidity = BigInt(Math.floor(Number(poolState.liquidity) * (1 + liquidityChange)));
    }
  }
  
  // Sort by timestamp
  events.sort((a, b) => a.timestamp - b.timestamp);
  
  return events;
}

/**
 * Select pool based on weights
 */
function selectWeightedPool(pools: Array<{ address: string; weight: number }>, random: SeededRandom): typeof pools[0] {
  const totalWeight = pools.reduce((sum, pool) => sum + pool.weight, 0);
  const randomValue = random.next() * totalWeight;
  
  let cumWeight = 0;
  for (const pool of pools) {
    cumWeight += pool.weight;
    if (randomValue <= cumWeight) {
      return pool;
    }
  }
  
  return pools[pools.length - 1]; // Fallback
}

/**
 * Generate swap size based on distribution
 */
function generateSwapSize(
  distribution: FixtureConfig['swapSizeDistribution'],
  volumeMultiplier: number,
  random: SeededRandom
): number {
  const categories = [
    { ...distribution.small, type: 'small' },
    { ...distribution.medium, type: 'medium' },
    { ...distribution.large, type: 'large' },
    { ...distribution.whale, type: 'whale' }
  ];
  
  // Select category
  const totalWeight = categories.reduce((sum, cat) => sum + cat.weight, 0);
  const randomValue = random.next() * totalWeight;
  
  let cumWeight = 0;
  let selectedCategory = categories[0];
  
  for (const category of categories) {
    cumWeight += category.weight;
    if (randomValue <= cumWeight) {
      selectedCategory = category;
      break;
    }
  }
  
  // Generate size within category
  const baseSize = selectedCategory.min + random.next() * (selectedCategory.max - selectedCategory.min);
  
  return Math.floor(baseSize * volumeMultiplier);
}

/**
 * Generate price movement
 */
function generatePriceMovement(
  evolution: FixtureConfig['priceEvolution'],
  currentTick: number,
  swapSize: number,
  random: SeededRandom
): number {
  // Base random movement
  const randomComponent = (random.next() - 0.5) * evolution.volatility;
  
  // Trend component
  const trendComponent = evolution.trend * 0.001;
  
  // Mean reversion (toward tick 0)
  const meanReversionComponent = -currentTick * evolution.meanReversion * 0.0001;
  
  // Swap size impact (larger swaps move price more)
  const sizeImpact = (swapSize / 100000) * 0.001 * (random.next() - 0.5);
  
  return randomComponent + trendComponent + meanReversionComponent + sizeImpact;
}

/**
 * Fixture configurations
 */
function createSmallFixtureConfig(): FixtureConfig {
  return {
    name: 'swaps_10k',
    eventCount: 10000,
    pools: [
      { address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640', name: 'WETH/USDC 0.05%', feeTier: 500, weight: 3 },
      { address: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8', name: 'WETH/USDC 0.30%', feeTier: 3000, weight: 5 },
      { address: '0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36', name: 'WETH/USDT 0.30%', feeTier: 3000, weight: 2 }
    ],
    swapSizeDistribution: {
      small: { min: 1000, max: 15000, weight: 60 },
      medium: { min: 15000, max: 100000, weight: 30 },
      large: { min: 100000, max: 500000, weight: 8 },
      whale: { min: 500000, max: 2000000, weight: 2 }
    },
    timePattern: {
      startTime: Date.now() - 7*24*3600*1000, // Last week
      endTime: Date.now(),
      peakHours: [13, 14, 15, 16, 17], // 1-5 PM UTC (US market hours)
      volumeMultiplierPeak: 2.5
    },
    priceEvolution: {
      volatility: 0.05, // 5% daily volatility
      trend: 0.1, // Slight upward trend
      meanReversion: 0.3
    }
  };
}

function createMediumFixtureConfig(): FixtureConfig {
  return {
    name: 'swaps_50k',
    eventCount: 50000,
    pools: [
      { address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640', name: 'WETH/USDC 0.05%', feeTier: 500, weight: 4 },
      { address: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8', name: 'WETH/USDC 0.30%', feeTier: 3000, weight: 6 },
      { address: '0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36', name: 'WETH/USDT 0.30%', feeTier: 3000, weight: 3 },
      { address: '0xCBCdF9626bC03E24f779434178A73a0B4bad62eD', name: 'WBTC/WETH 0.30%', feeTier: 3000, weight: 2 }
    ],
    swapSizeDistribution: {
      small: { min: 2000, max: 20000, weight: 50 },
      medium: { min: 20000, max: 150000, weight: 35 },
      large: { min: 150000, max: 750000, weight: 12 },
      whale: { min: 750000, max: 3000000, weight: 3 }
    },
    timePattern: {
      startTime: Date.now() - 30*24*3600*1000, // Last month
      endTime: Date.now(),
      peakHours: [13, 14, 15, 16, 17, 18],
      volumeMultiplierPeak: 3.0
    },
    priceEvolution: {
      volatility: 0.06,
      trend: -0.05, // Slight downward trend
      meanReversion: 0.25
    }
  };
}

function createLargeFixtureConfig(): FixtureConfig {
  return {
    name: 'swaps_100k',
    eventCount: 100000,
    pools: [
      { address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640', name: 'WETH/USDC 0.05%', feeTier: 500, weight: 5 },
      { address: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8', name: 'WETH/USDC 0.30%', feeTier: 3000, weight: 7 },
      { address: '0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36', name: 'WETH/USDT 0.30%', feeTier: 3000, weight: 4 },
      { address: '0xCBCdF9626bC03E24f779434178A73a0B4bad62eD', name: 'WBTC/WETH 0.30%', feeTier: 3000, weight: 3 }
    ],
    swapSizeDistribution: {
      small: { min: 5000, max: 25000, weight: 40 },
      medium: { min: 25000, max: 200000, weight: 40 },
      large: { min: 200000, max: 1000000, weight: 15 },
      whale: { min: 1000000, max: 5000000, weight: 5 }
    },
    timePattern: {
      startTime: Date.now() - 90*24*3600*1000, // Last 3 months
      endTime: Date.now(),
      peakHours: [12, 13, 14, 15, 16, 17, 18, 19],
      volumeMultiplierPeak: 2.0
    },
    priceEvolution: {
      volatility: 0.08,
      trend: 0.0, // No trend
      meanReversion: 0.2
    }
  };
}

function createWhaleFixtureConfig(): FixtureConfig {
  return {
    name: 'swaps_whale',
    eventCount: 5000,
    pools: [
      { address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640', name: 'WETH/USDC 0.05%', feeTier: 500, weight: 8 },
      { address: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8', name: 'WETH/USDC 0.30%', feeTier: 3000, weight: 5 },
    ],
    swapSizeDistribution: {
      small: { min: 50000, max: 100000, weight: 10 },
      medium: { min: 100000, max: 500000, weight: 30 },
      large: { min: 500000, max: 2000000, weight: 40 },
      whale: { min: 2000000, max: 10000000, weight: 20 }
    },
    timePattern: {
      startTime: Date.now() - 7*24*3600*1000, // Last week
      endTime: Date.now(),
      peakHours: [9, 10, 11, 15, 16, 17], // Asian + US market hours
      volumeMultiplierPeak: 1.5
    },
    priceEvolution: {
      volatility: 0.12, // High volatility due to large trades
      trend: 0.2, // Strong upward trend
      meanReversion: 0.1 // Less mean reversion
    }
  };
}

/**
 * Seeded random number generator for deterministic results
 */
class SeededRandom {
  private seed: number;
  
  constructor(seed: number) {
    this.seed = seed;
  }
  
  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
}

// Run generation if called directly
if (require.main === module) {
  generateFixtures();
}