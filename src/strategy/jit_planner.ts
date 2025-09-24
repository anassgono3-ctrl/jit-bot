/**
 * JIT Strategy Planner
 * Chooses optimal tick ranges and liquidity amounts for JIT positions
 */

import { PoolState } from '../sim/pool_state';
import { nearestUsableTick } from '../math/tick_math';
import { calculateLiquidityForTicks } from '../math/liquidity_math';
import { tokenAmountToUsd, usdToTokenAmount } from '../math/price_utils';

export interface JitPlan {
  tickLower: number;
  tickUpper: number;
  liquidityAmount: bigint;
  estimatedCapture: number; // Fraction of swap volume expected to capture
  rangeWidth: number; // In tick spacings
  confidence: number; // 0-1, confidence in the plan
}

export interface SwapPrediction {
  zeroForOne: boolean;
  amountIn: bigint;
  expectedPriceAfter: bigint;
  swapSizeUsd: number;
  timeHorizon: number; // seconds
}

export interface PlanningContext {
  poolState: PoolState;
  swapPrediction: SwapPrediction;
  token0PriceUsd: number;
  token1PriceUsd: number;
  volatility: number; // Recent volatility metric
  competitorLiquidity: bigint; // Existing liquidity in range
}

/**
 * Plan optimal JIT position for anticipated swap
 * @param context Planning context
 * @param captureFraction Target fraction of volume to capture (default 0.9)
 * @returns JIT plan
 */
export function planJitPosition(
  context: PlanningContext,
  captureFraction: number = 0.9
): JitPlan {
  const { poolState, swapPrediction } = context;
  
  // Determine range width based on confidence and volatility
  const rangeWidth = calculateOptimalRangeWidth(
    context.volatility,
    swapPrediction.timeHorizon,
    poolState.tickSpacing
  );

  // Calculate tick range around current price
  const centerTick = poolState.currentTick;
  let tickLower: number;
  let tickUpper: number;

  if (swapPrediction.zeroForOne) {
    // Price will move down, bias range below current price
    tickUpper = nearestUsableTick(centerTick + poolState.tickSpacing, poolState.tickSpacing);
    tickLower = nearestUsableTick(centerTick - rangeWidth * poolState.tickSpacing, poolState.tickSpacing);
  } else {
    // Price will move up, bias range above current price
    tickLower = nearestUsableTick(centerTick - poolState.tickSpacing, poolState.tickSpacing);
    tickUpper = nearestUsableTick(centerTick + rangeWidth * poolState.tickSpacing, poolState.tickSpacing);
  }

  // Ensure minimum range width
  const minRangeWidth = 2 * poolState.tickSpacing;
  if (tickUpper - tickLower < minRangeWidth) {
    const center = Math.floor((tickLower + tickUpper) / 2);
    tickLower = nearestUsableTick(center - minRangeWidth / 2, poolState.tickSpacing);
    tickUpper = nearestUsableTick(center + minRangeWidth / 2, poolState.tickSpacing);
  }

  // Calculate required liquidity for target capture
  const liquidityAmount = calculateRequiredLiquidity(
    swapPrediction,
    tickLower,
    tickUpper,
    poolState,
    captureFraction,
    context.competitorLiquidity
  );

  // Estimate actual capture based on liquidity amount
  const estimatedCapture = estimateVolumeCapture(
    liquidityAmount,
    context.competitorLiquidity,
    swapPrediction.swapSizeUsd
  );

  // Calculate confidence based on various factors
  const confidence = calculatePlanConfidence(
    context,
    rangeWidth,
    estimatedCapture
  );

  return {
    tickLower,
    tickUpper,
    liquidityAmount,
    estimatedCapture,
    rangeWidth: Math.floor((tickUpper - tickLower) / poolState.tickSpacing),
    confidence
  };
}

/**
 * Calculate optimal range width based on market conditions
 */
function calculateOptimalRangeWidth(
  volatility: number,
  timeHorizon: number,
  tickSpacing: number
): number {
  // Base range width (in tick spacings)
  let baseWidth = 10;
  
  // Adjust for volatility
  if (volatility > 0.1) { // High volatility
    baseWidth = 30;
  } else if (volatility > 0.05) { // Medium volatility
    baseWidth = 20;
  } else { // Low volatility
    baseWidth = 10;
  }
  
  // Adjust for time horizon
  if (timeHorizon > 300) { // > 5 minutes
    baseWidth *= 1.5;
  } else if (timeHorizon > 60) { // > 1 minute
    baseWidth *= 1.2;
  }
  
  return Math.max(2, Math.floor(baseWidth));
}

/**
 * Calculate required liquidity to capture target volume fraction
 */
function calculateRequiredLiquidity(
  swapPrediction: SwapPrediction,
  tickLower: number,
  tickUpper: number,
  poolState: PoolState,
  captureFraction: number,
  competitorLiquidity: bigint
): bigint {
  // Estimate current liquidity in the range
  const existingLiquidity = competitorLiquidity || poolState.liquidity / 10n; // Rough estimate
  
  // Calculate target liquidity based on capture fraction
  // Higher capture fraction requires more liquidity relative to existing
  const targetRatio = captureFraction / (1 - captureFraction);
  const requiredLiquidity = existingLiquidity * BigInt(Math.floor(targetRatio * 100)) / 100n;
  
  // Ensure minimum liquidity
  const minLiquidity = BigInt(Math.floor(swapPrediction.swapSizeUsd * Math.pow(10, 15))); // Rough minimum
  
  return requiredLiquidity > minLiquidity ? requiredLiquidity : minLiquidity;
}

/**
 * Estimate volume capture based on liquidity ratio
 */
function estimateVolumeCapture(
  ourLiquidity: bigint,
  competitorLiquidity: bigint,
  swapSizeUsd: number
): number {
  const totalLiquidity = ourLiquidity + competitorLiquidity;
  
  if (totalLiquidity === 0n) return 0;
  
  // Simple proportional capture model
  const captureRatio = Number(ourLiquidity) / Number(totalLiquidity);
  
  // Apply diminishing returns for very large positions
  const adjustedCapture = Math.min(0.95, captureRatio * (1 - Math.exp(-swapSizeUsd / 100000)));
  
  return adjustedCapture;
}

/**
 * Calculate confidence in the JIT plan
 */
function calculatePlanConfidence(
  context: PlanningContext,
  rangeWidth: number,
  estimatedCapture: number
): number {
  let confidence = 0.5; // Base confidence
  
  // Higher confidence for larger swaps
  if (context.swapPrediction.swapSizeUsd > 100000) {
    confidence += 0.2;
  } else if (context.swapPrediction.swapSizeUsd > 50000) {
    confidence += 0.1;
  }
  
  // Higher confidence for good capture estimates
  if (estimatedCapture > 0.8) {
    confidence += 0.2;
  } else if (estimatedCapture > 0.5) {
    confidence += 0.1;
  }
  
  // Lower confidence for very volatile conditions
  if (context.volatility > 0.1) {
    confidence -= 0.2;
  }
  
  // Lower confidence for very wide ranges (uncertainty)
  if (rangeWidth > 40) {
    confidence -= 0.1;
  }
  
  return Math.max(0.1, Math.min(0.95, confidence));
}

/**
 * Plan multiple JIT positions for a batch of swaps
 * @param contexts Array of planning contexts
 * @param maxPositions Maximum number of positions to plan
 * @returns Array of JIT plans sorted by expected value
 */
export function planBatchJitPositions(
  contexts: PlanningContext[],
  maxPositions: number = 5
): JitPlan[] {
  const plans = contexts.map(context => planJitPosition(context));
  
  // Score plans by expected value (simplified)
  const scoredPlans = plans.map(plan => ({
    ...plan,
    score: plan.estimatedCapture * plan.confidence
  }));
  
  // Sort by score and take top N
  return scoredPlans
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPositions);
}

/**
 * Adaptive range adjustment based on market microstructure
 * @param basePlan Initial JIT plan
 * @param marketData Recent market data
 * @returns Adjusted JIT plan
 */
export function adaptiveRangeAdjustment(
  basePlan: JitPlan,
  marketData: {
    recentTrades: Array<{ size: number; direction: boolean; timestamp: number }>;
    currentSpread: number;
    liquidityDistribution: Map<number, bigint>;
  }
): JitPlan {
  let adjustedPlan = { ...basePlan };
  
  // Analyze recent trade patterns
  const recentLargeTrades = marketData.recentTrades.filter(trade => trade.size > 50000);
  
  if (recentLargeTrades.length > 2) {
    // Multiple large trades suggest increased activity - widen range
    const tickSpacing = Math.floor((basePlan.tickUpper - basePlan.tickLower) / basePlan.rangeWidth);
    adjustedPlan.tickLower -= tickSpacing;
    adjustedPlan.tickUpper += tickSpacing;
    adjustedPlan.rangeWidth += 2;
    adjustedPlan.confidence *= 0.9; // Slightly lower confidence due to uncertainty
  }
  
  // Adjust for current spread
  if (marketData.currentSpread > 0.001) { // Wide spread
    // Market is less liquid, be more conservative
    adjustedPlan.liquidityAmount = (adjustedPlan.liquidityAmount * 8n) / 10n; // Reduce by 20%
  }
  
  return adjustedPlan;
}

/**
 * Risk assessment for JIT plan
 * @param plan JIT plan to assess
 * @param context Planning context
 * @returns Risk metrics
 */
export function assessJitRisk(
  plan: JitPlan,
  context: PlanningContext
): {
  inventoryRisk: number; // 0-1, risk of holding inventory
  priceRisk: number; // 0-1, risk of adverse price moves
  competitionRisk: number; // 0-1, risk of being outcompeted
  overallRisk: number; // 0-1, combined risk score
} {
  // Inventory risk based on position size and volatility
  const inventoryValue = Number(plan.liquidityAmount) / Math.pow(10, 18) * context.token0PriceUsd;
  const inventoryRisk = Math.min(1, (inventoryValue / 100000) * (1 + context.volatility));
  
  // Price risk based on volatility and range width
  const priceRisk = context.volatility * (1 - plan.confidence);
  
  // Competition risk based on existing liquidity
  const competitionRatio = Number(context.competitorLiquidity) / Number(plan.liquidityAmount);
  const competitionRisk = Math.min(1, competitionRatio / 2);
  
  // Overall risk (weighted average)
  const overallRisk = (inventoryRisk * 0.4 + priceRisk * 0.4 + competitionRisk * 0.2);
  
  return {
    inventoryRisk,
    priceRisk,
    competitionRisk,
    overallRisk
  };
}