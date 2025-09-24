/**
 * Backtest Runner
 * Evaluates JIT strategy performance over historical/synthetic data
 */

import * as fs from 'fs';
import * as path from 'path';
import { PoolState, createPoolState } from '../sim/pool_state';
import { executeJitSimulation, JitExecutionParams } from '../sim/execution_sim';
import { planJitPosition, PlanningContext } from '../strategy/jit_planner';
import { scoreJitOpportunity, ScoringConfig } from '../strategy/scoring';
import { PoolManager } from '../strategy/pool_manager';

export interface SwapEvent {
  timestamp: number;
  poolAddress: string;
  zeroForOne: boolean;
  amountIn: bigint;
  amountOut: bigint;
  sqrtPriceX96Before: bigint;
  sqrtPriceX96After: bigint;
  tick: number;
  liquidity: bigint;
  feeAmount: bigint;
  swapSizeUsd: number;
  gasPrice: bigint;
}

export interface BacktestConfig {
  startTime: number;
  endTime: number;
  initialCapitalUsd: number;
  maxPositions: number;
  scoringConfig: ScoringConfig;
  priceFeeds: {
    token0PriceUsd: number;
    token1PriceUsd: number;
  };
  simulation: {
    inclusionProbability: number;
    gasPerPosition: number;
    slippageTolerance: number;
  };
}

export interface BacktestResult {
  summary: {
    fixture: string;
    swapsProcessed: number;
    positionsOpened: number;
    positionsSuccessful: number;
    totalGrossFeesUsd: number;
    totalGasCostUsd: number;
    totalNetFeesUsd: number;
    successRate: number;
    profitabilityRate: number; // % of profitable positions
    finalCapitalUsd: number;
    totalReturnUsd: number;
    totalReturnPercent: number;
    sharpeRatio: number; // Risk-adjusted return
    maxDrawdownUsd: number;
    avgPositionSizeUsd: number;
    avgHoldTimeMs: number;
  };
  
  positions: BacktestPosition[];
  
  performance: {
    daily: DailyPerformance[];
    monthly: MonthlyPerformance[];
    poolBreakdown: PoolPerformance[];
    feeTickerBreakdown: FeeTickerPerformance[];
  };
  
  metrics: {
    winRate: number;
    avgWinUsd: number;
    avgLossUsd: number;
    largestWinUsd: number;
    largestLossUsd: number;
    profitFactor: number; // Gross profit / Gross loss
    consecutiveWins: number;
    consecutiveLosses: number;
    avgScoreWinning: number;
    avgScoreLoosing: number;
  };
}

export interface BacktestPosition {
  id: number;
  timestamp: number;
  poolAddress: string;
  tickLower: number;
  tickUpper: number;
  liquidityAmount: bigint;
  swapEvent: SwapEvent;
  
  // Results
  success: boolean;
  profitable: boolean;
  grossFeesUsd: number;
  gasCostUsd: number;
  netProfitUsd: number;
  score: number;
  confidence: number;
  holdTimeMs: number;
  
  // Risk metrics
  maxInventoryUsd: number;
  priceImpact: number;
  slippage: number;
}

export interface DailyPerformance {
  date: string;
  positions: number;
  grossFeesUsd: number;
  gasCostUsd: number;
  netFeesUsd: number;
  returnPercent: number;
  capitalUsd: number;
}

export interface MonthlyPerformance {
  month: string;
  positions: number;
  grossFeesUsd: number;
  gasCostUsd: number;
  netFeesUsd: number;
  returnPercent: number;
  sharpeRatio: number;
  maxDrawdownUsd: number;
}

export interface PoolPerformance {
  poolAddress: string;
  poolName: string;
  positions: number;
  grossFeesUsd: number;
  netFeesUsd: number;
  successRate: number;
  avgScore: number;
}

export interface FeeTickerPerformance {
  feeTier: number;
  positions: number;
  grossFeesUsd: number;
  netFeesUsd: number;
  successRate: number;
  avgSwapSizeUsd: number;
}

/**
 * Run backtest over swap events
 * @param fixtureFile Path to swap events fixture
 * @param config Backtest configuration
 * @returns Backtest results
 */
export async function runBacktest(
  fixtureFile: string,
  config: BacktestConfig
): Promise<BacktestResult> {
  console.log(`Starting backtest with fixture: ${path.basename(fixtureFile)}`);
  
  // Load swap events
  const swapEvents = loadSwapEvents(fixtureFile);
  console.log(`Loaded ${swapEvents.length} swap events`);
  
  // Initialize pool manager
  const poolManager = new PoolManager();
  
  // Initialize tracking variables
  const positions: BacktestPosition[] = [];
  let currentCapital = config.initialCapitalUsd;
  let positionId = 0;
  let activePositions = 0;
  
  const dailyPerformance = new Map<string, DailyPerformance>();
  const poolPerformance = new Map<string, PoolPerformance>();
  const feeTickerPerformance = new Map<number, FeeTickerPerformance>();
  
  // Process each swap event
  for (let i = 0; i < swapEvents.length; i++) {
    const swapEvent = swapEvents[i];
    
    // Skip if outside time range
    if (swapEvent.timestamp < config.startTime || swapEvent.timestamp > config.endTime) {
      continue;
    }
    
    // Skip if at max positions
    if (activePositions >= config.maxPositions) {
      continue;
    }
    
    try {
      // Evaluate JIT opportunity
      const opportunity = await evaluateJitOpportunity(
        swapEvent,
        poolManager,
        config
      );
      
      if (opportunity.worthPursuing) {
        const position = await simulateJitPosition(
          swapEvent,
          opportunity,
          config,
          positionId++
        );
        
        positions.push(position);
        activePositions++;
        
        // Update capital
        currentCapital += position.netProfitUsd;
        
        // Update performance tracking
        updatePerformanceTracking(
          position,
          dailyPerformance,
          poolPerformance,
          feeTickerPerformance,
          poolManager
        );
        
        // Simulate position closing (immediate for JIT)
        activePositions--;
      }
    } catch (error) {
      console.warn(`Error processing swap event ${i}:`, error);
    }
    
    // Progress reporting
    if (i % 10000 === 0) {
      console.log(`Processed ${i}/${swapEvents.length} events (${((i/swapEvents.length)*100).toFixed(1)}%)`);
    }
  }
  
  console.log(`Backtest completed. Processed ${positions.length} positions.`);
  
  // Calculate final metrics
  return calculateBacktestResults(
    path.basename(fixtureFile),
    positions,
    config,
    dailyPerformance,
    poolPerformance,
    feeTickerPerformance,
    currentCapital
  );
}

/**
 * Load swap events from fixture file
 */
function loadSwapEvents(fixtureFile: string): SwapEvent[] {
  try {
    const rawData = fs.readFileSync(fixtureFile, 'utf8');
    const events = JSON.parse(rawData);
    
    return events.map((event: any) => ({
      ...event,
      amountIn: BigInt(event.amountIn),
      amountOut: BigInt(event.amountOut),
      sqrtPriceX96Before: BigInt(event.sqrtPriceX96Before),
      sqrtPriceX96After: BigInt(event.sqrtPriceX96After),
      liquidity: BigInt(event.liquidity),
      feeAmount: BigInt(event.feeAmount),
      gasPrice: BigInt(event.gasPrice || '15000000000') // Default 15 gwei
    }));
  } catch (error) {
    throw new Error(`Failed to load swap events from ${fixtureFile}: ${error}`);
  }
}

/**
 * Evaluate if swap event presents a JIT opportunity
 */
async function evaluateJitOpportunity(
  swapEvent: SwapEvent,
  poolManager: PoolManager,
  config: BacktestConfig
): Promise<{ worthPursuing: boolean; planningContext?: PlanningContext; score?: number }> {
  // Get pool configuration
  const poolConfig = poolManager.getPoolConfig(swapEvent.poolAddress);
  if (!poolConfig) {
    return { worthPursuing: false };
  }
  
  // Check basic thresholds
  const poolRule = config.scoringConfig.poolRules[poolConfig.feeTier.toString()];
  if (!poolRule || !poolRule.enabled || swapEvent.swapSizeUsd < poolRule.minSwapUsd) {
    return { worthPursuing: false };
  }
  
  // Create pool state from swap event
  const poolState = createPoolState(
    swapEvent.poolAddress,
    poolConfig.token0,
    poolConfig.token1,
    poolConfig.feeTier,
    swapEvent.sqrtPriceX96Before,
    swapEvent.tick,
    swapEvent.liquidity,
    poolConfig.decimals
  );
  
  // Create planning context
  const planningContext: PlanningContext = {
    poolState,
    swapPrediction: {
      zeroForOne: swapEvent.zeroForOne,
      amountIn: swapEvent.amountIn,
      expectedPriceAfter: swapEvent.sqrtPriceX96After,
      swapSizeUsd: swapEvent.swapSizeUsd,
      timeHorizon: 30 // Assume 30 second horizon for backtesting
    },
    token0PriceUsd: config.priceFeeds.token0PriceUsd,
    token1PriceUsd: config.priceFeeds.token1PriceUsd,
    volatility: 0.05, // Default 5% volatility for backtesting
    competitorLiquidity: swapEvent.liquidity / 10n // Assume some competition
  };
  
  // Plan JIT position
  const jitPlan = planJitPosition(planningContext);
  
  // Score the opportunity
  const scoringParams = {
    swapAmountUsd: swapEvent.swapSizeUsd,
    swapDirection: swapEvent.zeroForOne,
    feeTier: poolConfig.feeTier,
    estimatedCapture: jitPlan.estimatedCapture,
    liquidityAmount: jitPlan.liquidityAmount,
    rangeWidth: jitPlan.rangeWidth,
    gasPrice: swapEvent.gasPrice,
    gasEstimate: config.simulation.gasPerPosition,
    inclusionProbability: config.simulation.inclusionProbability,
    competitionLevel: 0.5, // Default competition level
    volatility: 0.05,
    token0PriceUsd: config.priceFeeds.token0PriceUsd,
    token1PriceUsd: config.priceFeeds.token1PriceUsd
  };
  
  const score = scoreJitOpportunity(scoringParams, config.scoringConfig);
  
  return {
    worthPursuing: score.recommendation === 'strong_buy' || score.recommendation === 'buy',
    planningContext,
    score: score.score
  };
}

/**
 * Simulate JIT position execution
 */
async function simulateJitPosition(
  swapEvent: SwapEvent,
  opportunity: { planningContext: PlanningContext; score: number },
  config: BacktestConfig,
  positionId: number
): Promise<BacktestPosition> {
  const jitPlan = planJitPosition(opportunity.planningContext);
  
  // Simulate JIT execution
  const executionParams: JitExecutionParams = {
    poolState: opportunity.planningContext.poolState,
    swapParams: {
      zeroForOne: swapEvent.zeroForOne,
      amountSpecified: swapEvent.amountIn
    },
    tickLower: jitPlan.tickLower,
    tickUpper: jitPlan.tickUpper,
    liquidityAmount: jitPlan.liquidityAmount,
    gasPrice: swapEvent.gasPrice,
    token0PriceUsd: config.priceFeeds.token0PriceUsd,
    token1PriceUsd: config.priceFeeds.token1PriceUsd,
    inclusionProbability: config.simulation.inclusionProbability
  };
  
  const executionResult = executeJitSimulation(executionParams);
  
  return {
    id: positionId,
    timestamp: swapEvent.timestamp,
    poolAddress: swapEvent.poolAddress,
    tickLower: jitPlan.tickLower,
    tickUpper: jitPlan.tickUpper,
    liquidityAmount: jitPlan.liquidityAmount,
    swapEvent,
    success: executionResult.success,
    profitable: executionResult.profitable,
    grossFeesUsd: executionResult.grossFeesUsd,
    gasCostUsd: executionResult.gasCostUsd,
    netProfitUsd: executionResult.netProfitUsd,
    score: opportunity.score,
    confidence: jitPlan.confidence,
    holdTimeMs: 12000, // 12 seconds average for JIT
    maxInventoryUsd: Number(executionResult.liquidityDeployed) / 1e18 * config.priceFeeds.token0PriceUsd,
    priceImpact: executionResult.priceImpact,
    slippage: 0.001 // Assume 0.1% slippage for backtesting
  };
}

/**
 * Update performance tracking
 */
function updatePerformanceTracking(
  position: BacktestPosition,
  dailyPerformance: Map<string, DailyPerformance>,
  poolPerformance: Map<string, PoolPerformance>,
  feeTickerPerformance: Map<number, FeeTickerPerformance>,
  poolManager: PoolManager
): void {
  const date = new Date(position.timestamp).toISOString().split('T')[0];
  
  // Update daily performance
  if (!dailyPerformance.has(date)) {
    dailyPerformance.set(date, {
      date,
      positions: 0,
      grossFeesUsd: 0,
      gasCostUsd: 0,
      netFeesUsd: 0,
      returnPercent: 0,
      capitalUsd: 0
    });
  }
  
  const daily = dailyPerformance.get(date)!;
  daily.positions++;
  daily.grossFeesUsd += position.grossFeesUsd;
  daily.gasCostUsd += position.gasCostUsd;
  daily.netFeesUsd += position.netProfitUsd;
  
  // Update pool performance
  const poolConfig = poolManager.getPoolConfig(position.poolAddress);
  const poolName = poolConfig?.name || position.poolAddress;
  
  if (!poolPerformance.has(position.poolAddress)) {
    poolPerformance.set(position.poolAddress, {
      poolAddress: position.poolAddress,
      poolName,
      positions: 0,
      grossFeesUsd: 0,
      netFeesUsd: 0,
      successRate: 0,
      avgScore: 0
    });
  }
  
  const pool = poolPerformance.get(position.poolAddress)!;
  pool.positions++;
  pool.grossFeesUsd += position.grossFeesUsd;
  pool.netFeesUsd += position.netProfitUsd;
  pool.avgScore = ((pool.avgScore * (pool.positions - 1)) + position.score) / pool.positions;
  pool.successRate = pool.positions > 0 ? (pool.grossFeesUsd > 0 ? 1 : 0) : 0; // Simplified
  
  // Update fee tier performance
  const feeTier = poolConfig?.feeTier || 3000;
  
  if (!feeTickerPerformance.has(feeTier)) {
    feeTickerPerformance.set(feeTier, {
      feeTier,
      positions: 0,
      grossFeesUsd: 0,
      netFeesUsd: 0,
      successRate: 0,
      avgSwapSizeUsd: 0
    });
  }
  
  const feePerf = feeTickerPerformance.get(feeTier)!;
  feePerf.positions++;
  feePerf.grossFeesUsd += position.grossFeesUsd;
  feePerf.netFeesUsd += position.netProfitUsd;
  feePerf.avgSwapSizeUsd = ((feePerf.avgSwapSizeUsd * (feePerf.positions - 1)) + position.swapEvent.swapSizeUsd) / feePerf.positions;
  feePerf.successRate = feePerf.positions > 0 ? (feePerf.grossFeesUsd > 0 ? 1 : 0) : 0; // Simplified
}

/**
 * Calculate final backtest results
 */
function calculateBacktestResults(
  fixtureName: string,
  positions: BacktestPosition[],
  config: BacktestConfig,
  dailyPerformance: Map<string, DailyPerformance>,
  poolPerformance: Map<string, PoolPerformance>,
  feeTickerPerformance: Map<number, FeeTickerPerformance>,
  finalCapital: number
): BacktestResult {
  if (positions.length === 0) {
    throw new Error('No positions to analyze');
  }
  
  // Calculate summary statistics
  const totalGrossFeesUsd = positions.reduce((sum, p) => sum + p.grossFeesUsd, 0);
  const totalGasCostUsd = positions.reduce((sum, p) => sum + p.gasCostUsd, 0);
  const totalNetFeesUsd = positions.reduce((sum, p) => sum + p.netProfitUsd, 0);
  const successfulPositions = positions.filter(p => p.success).length;
  const profitablePositions = positions.filter(p => p.profitable).length;
  
  // Calculate metrics
  const winningPositions = positions.filter(p => p.netProfitUsd > 0);
  const losingPositions = positions.filter(p => p.netProfitUsd < 0);
  
  const avgWinUsd = winningPositions.length > 0 
    ? winningPositions.reduce((sum, p) => sum + p.netProfitUsd, 0) / winningPositions.length 
    : 0;
    
  const avgLossUsd = losingPositions.length > 0 
    ? losingPositions.reduce((sum, p) => sum + p.netProfitUsd, 0) / losingPositions.length 
    : 0;
  
  const grossProfitUsd = winningPositions.reduce((sum, p) => sum + p.netProfitUsd, 0);  
  const grossLossUsd = Math.abs(losingPositions.reduce((sum, p) => sum + p.netProfitUsd, 0));
  
  const summary = {
    fixture: fixtureName,
    swapsProcessed: positions.length,
    positionsOpened: positions.length,
    positionsSuccessful: successfulPositions,
    totalGrossFeesUsd,
    totalGasCostUsd,
    totalNetFeesUsd,
    successRate: positions.length > 0 ? successfulPositions / positions.length : 0,
    profitabilityRate: positions.length > 0 ? profitablePositions / positions.length : 0,
    finalCapitalUsd: finalCapital,
    totalReturnUsd: finalCapital - config.initialCapitalUsd,
    totalReturnPercent: ((finalCapital - config.initialCapitalUsd) / config.initialCapitalUsd) * 100,
    sharpeRatio: calculateSharpeRatio(positions),
    maxDrawdownUsd: calculateMaxDrawdown(positions),
    avgPositionSizeUsd: positions.reduce((sum, p) => sum + p.maxInventoryUsd, 0) / positions.length,
    avgHoldTimeMs: positions.reduce((sum, p) => sum + p.holdTimeMs, 0) / positions.length
  };
  
  const metrics = {
    winRate: positions.length > 0 ? winningPositions.length / positions.length : 0,
    avgWinUsd,
    avgLossUsd,
    largestWinUsd: winningPositions.length > 0 ? Math.max(...winningPositions.map(p => p.netProfitUsd)) : 0,
    largestLossUsd: losingPositions.length > 0 ? Math.min(...losingPositions.map(p => p.netProfitUsd)) : 0,
    profitFactor: grossLossUsd > 0 ? grossProfitUsd / grossLossUsd : 0,
    consecutiveWins: calculateMaxConsecutive(positions, true),
    consecutiveLosses: calculateMaxConsecutive(positions, false),
    avgScoreWinning: winningPositions.length > 0 ? winningPositions.reduce((sum, p) => sum + p.score, 0) / winningPositions.length : 0,
    avgScoreLoosing: losingPositions.length > 0 ? losingPositions.reduce((sum, p) => sum + p.score, 0) / losingPositions.length : 0
  };
  
  return {
    summary,
    positions,
    performance: {
      daily: Array.from(dailyPerformance.values()).sort((a, b) => a.date.localeCompare(b.date)),
      monthly: aggregateMonthlyPerformance(dailyPerformance),
      poolBreakdown: Array.from(poolPerformance.values()).sort((a, b) => b.netFeesUsd - a.netFeesUsd),
      feeTickerBreakdown: Array.from(feeTickerPerformance.values()).sort((a, b) => a.feeTier - b.feeTier)
    },
    metrics
  };
}

/**
 * Calculate Sharpe ratio (simplified)
 */
function calculateSharpeRatio(positions: BacktestPosition[]): number {
  if (positions.length < 2) return 0;
  
  const returns = positions.map(p => p.netProfitUsd);
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);
  
  return stdDev > 0 ? avgReturn / stdDev : 0;
}

/**
 * Calculate maximum drawdown
 */
function calculateMaxDrawdown(positions: BacktestPosition[]): number {
  let peak = 0;
  let maxDrawdown = 0;
  let runningPnL = 0;
  
  for (const position of positions) {
    runningPnL += position.netProfitUsd;
    if (runningPnL > peak) {
      peak = runningPnL;
    }
    const drawdown = peak - runningPnL;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }
  
  return maxDrawdown;
}

/**
 * Calculate maximum consecutive wins/losses
 */
function calculateMaxConsecutive(positions: BacktestPosition[], wins: boolean): number {
  let maxConsecutive = 0;
  let currentConsecutive = 0;
  
  for (const position of positions) {
    const isWin = position.netProfitUsd > 0;
    if (isWin === wins) {
      currentConsecutive++;
      maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
    } else {
      currentConsecutive = 0;
    }
  }
  
  return maxConsecutive;
}

/**
 * Aggregate daily performance into monthly
 */
function aggregateMonthlyPerformance(dailyPerformance: Map<string, DailyPerformance>): MonthlyPerformance[] {
  const monthlyMap = new Map<string, MonthlyPerformance>();
  
  for (const daily of dailyPerformance.values()) {
    const month = daily.date.substring(0, 7); // YYYY-MM
    
    if (!monthlyMap.has(month)) {
      monthlyMap.set(month, {
        month,
        positions: 0,
        grossFeesUsd: 0,
        gasCostUsd: 0,
        netFeesUsd: 0,
        returnPercent: 0,
        sharpeRatio: 0,
        maxDrawdownUsd: 0
      });
    }
    
    const monthly = monthlyMap.get(month)!;
    monthly.positions += daily.positions;
    monthly.grossFeesUsd += daily.grossFeesUsd;
    monthly.gasCostUsd += daily.gasCostUsd;
    monthly.netFeesUsd += daily.netFeesUsd;
  }
  
  return Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));
}