/**
 * Range Selection Strategy
 * Adaptive width logic for JIT liquidity positions
 */

import { nearestUsableTick } from '../math/tick_math';

export interface RangeSelectionParams {
  currentTick: number;
  tickSpacing: number;
  volatility: number;
  swapDirection: boolean; // true for zeroForOne
  swapSize: number; // USD value
  timeHorizon: number; // seconds
  confidence: number; // 0-1
  liquidityDistribution: Map<number, bigint>; // existing liquidity by tick
}

export interface SelectedRange {
  tickLower: number;
  tickUpper: number;
  rangeType: 'narrow' | 'medium' | 'wide' | 'asymmetric';
  reasoning: string;
  expectedCapture: number;
  riskScore: number;
}

/**
 * Select optimal tick range for JIT position
 * @param params Range selection parameters
 * @returns Selected range with metadata
 */
export function selectOptimalRange(params: RangeSelectionParams): SelectedRange {
  const strategy = determineRangeStrategy(params);
  
  switch (strategy.type) {
    case 'narrow':
      return selectNarrowRange(params, strategy);
    case 'wide':
      return selectWideRange(params, strategy);
    case 'asymmetric':
      return selectAsymmetricRange(params, strategy);
    default:
      return selectMediumRange(params, strategy);
  }
}

interface RangeStrategy {
  type: 'narrow' | 'medium' | 'wide' | 'asymmetric';
  widthMultiplier: number;
  biasDirection: number; // -1, 0, 1
  reasoning: string;
}

/**
 * Determine the appropriate range strategy based on market conditions
 */
function determineRangeStrategy(params: RangeSelectionParams): RangeStrategy {
  const { volatility, swapSize, timeHorizon, confidence } = params;
  
  // High confidence, large swap, short horizon -> narrow range
  if (confidence > 0.8 && swapSize > 100000 && timeHorizon < 60) {
    return {
      type: 'narrow',
      widthMultiplier: 1.0,
      biasDirection: params.swapDirection ? -1 : 1,
      reasoning: 'High confidence, large swap, short timeframe - narrow focused range'
    };
  }
  
  // High volatility -> wide range
  if (volatility > 0.08) {
    return {
      type: 'wide',
      widthMultiplier: 2.5,
      biasDirection: 0,
      reasoning: 'High volatility requires wider range for safety'
    };
  }
  
  // Medium to large swap with directional bias -> asymmetric
  if (swapSize > 50000 && confidence > 0.6) {
    return {
      type: 'asymmetric',
      widthMultiplier: 1.5,
      biasDirection: params.swapDirection ? -1 : 1,
      reasoning: 'Directional swap with good confidence - asymmetric range'
    };
  }
  
  // Long time horizon -> wide range
  if (timeHorizon > 300) {
    return {
      type: 'wide',
      widthMultiplier: 2.0,
      biasDirection: 0,
      reasoning: 'Long time horizon requires wider range'
    };
  }
  
  // Default: medium range
  return {
    type: 'medium',
    widthMultiplier: 1.5,
    biasDirection: 0,
    reasoning: 'Standard conditions - balanced medium range'
  };
}

/**
 * Select narrow range (±5-15 ticks)
 */
function selectNarrowRange(params: RangeSelectionParams, strategy: RangeStrategy): SelectedRange {
  const baseWidth = Math.max(2, Math.floor(10 * strategy.widthMultiplier)); // 2-15 tick spacings
  const halfWidth = Math.floor(baseWidth / 2);
  
  let centerTick = params.currentTick;
  
  // Apply directional bias
  if (strategy.biasDirection !== 0) {
    const bias = strategy.biasDirection * params.tickSpacing * Math.floor(baseWidth * 0.3);
    centerTick += bias;
  }
  
  const tickLower = nearestUsableTick(centerTick - halfWidth * params.tickSpacing, params.tickSpacing);
  const tickUpper = nearestUsableTick(centerTick + halfWidth * params.tickSpacing, params.tickSpacing);
  
  // Check for liquidity gaps
  const adjustedRange = avoidLiquidityGaps(tickLower, tickUpper, params);
  
  return {
    tickLower: adjustedRange.tickLower,
    tickUpper: adjustedRange.tickUpper,
    rangeType: 'narrow',
    reasoning: strategy.reasoning + ' (narrow range for precision)',
    expectedCapture: 0.85, // High capture due to focused range
    riskScore: 0.7 // Higher risk due to narrow range
  };
}

/**
 * Select medium range (±15-25 ticks)
 */
function selectMediumRange(params: RangeSelectionParams, strategy: RangeStrategy): SelectedRange {
  const baseWidth = Math.floor(20 * strategy.widthMultiplier); // 15-30 tick spacings
  const halfWidth = Math.floor(baseWidth / 2);
  
  const centerTick = params.currentTick;
  const tickLower = nearestUsableTick(centerTick - halfWidth * params.tickSpacing, params.tickSpacing);
  const tickUpper = nearestUsableTick(centerTick + halfWidth * params.tickSpacing, params.tickSpacing);
  
  const adjustedRange = avoidLiquidityGaps(tickLower, tickUpper, params);
  
  return {
    tickLower: adjustedRange.tickLower,
    tickUpper: adjustedRange.tickUpper,
    rangeType: 'medium',
    reasoning: strategy.reasoning + ' (balanced medium range)',
    expectedCapture: 0.75, // Good capture with reasonable risk
    riskScore: 0.5 // Balanced risk
  };
}

/**
 * Select wide range (±25-50 ticks)
 */
function selectWideRange(params: RangeSelectionParams, strategy: RangeStrategy): SelectedRange {
  const baseWidth = Math.floor(35 * strategy.widthMultiplier); // 25-87 tick spacings
  const halfWidth = Math.floor(baseWidth / 2);
  
  const centerTick = params.currentTick;
  const tickLower = nearestUsableTick(centerTick - halfWidth * params.tickSpacing, params.tickSpacing);
  const tickUpper = nearestUsableTick(centerTick + halfWidth * params.tickSpacing, params.tickSpacing);
  
  return {
    tickLower,
    tickUpper,
    rangeType: 'wide',
    reasoning: strategy.reasoning + ' (wide range for safety)',
    expectedCapture: 0.65, // Lower capture due to spread liquidity
    riskScore: 0.3 // Lower risk due to wide coverage
  };
}

/**
 * Select asymmetric range biased towards expected price movement
 */
function selectAsymmetricRange(params: RangeSelectionParams, strategy: RangeStrategy): SelectedRange {
  const baseWidth = Math.floor(20 * strategy.widthMultiplier);
  const biasStrength = 0.7; // 70% of range in bias direction
  
  const biasedWidth = Math.floor(baseWidth * biasStrength);
  const counterWidth = baseWidth - biasedWidth;
  
  let tickLower: number;
  let tickUpper: number;
  
  if (strategy.biasDirection > 0) {
    // Bias towards higher ticks (price going up)
    tickLower = nearestUsableTick(params.currentTick - counterWidth * params.tickSpacing, params.tickSpacing);
    tickUpper = nearestUsableTick(params.currentTick + biasedWidth * params.tickSpacing, params.tickSpacing);
  } else {
    // Bias towards lower ticks (price going down)
    tickLower = nearestUsableTick(params.currentTick - biasedWidth * params.tickSpacing, params.tickSpacing);
    tickUpper = nearestUsableTick(params.currentTick + counterWidth * params.tickSpacing, params.tickSpacing);
  }
  
  const adjustedRange = avoidLiquidityGaps(tickLower, tickUpper, params);
  
  return {
    tickLower: adjustedRange.tickLower,
    tickUpper: adjustedRange.tickUpper,
    rangeType: 'asymmetric',
    reasoning: strategy.reasoning + ' (asymmetric range with directional bias)',
    expectedCapture: 0.80, // High capture if direction is correct
    riskScore: 0.6 // Medium-high risk due to directional bet
  };
}

/**
 * Avoid placing liquidity in gaps where there's no existing liquidity
 */
function avoidLiquidityGaps(
  tickLower: number,
  tickUpper: number,
  params: RangeSelectionParams
): { tickLower: number; tickUpper: number } {
  if (params.liquidityDistribution.size === 0) {
    return { tickLower, tickUpper };
  }
  
  // Find ticks with existing liquidity near our range
  const nearbyTicks = Array.from(params.liquidityDistribution.keys())
    .filter(tick => tick >= tickLower - 10 * params.tickSpacing && tick <= tickUpper + 10 * params.tickSpacing)
    .sort((a, b) => a - b);
  
  if (nearbyTicks.length === 0) {
    return { tickLower, tickUpper };
  }
  
  // Adjust range to include areas with existing liquidity
  const liquidityWeightedCenter = calculateLiquidityWeightedCenter(nearbyTicks, params.liquidityDistribution);
  
  if (liquidityWeightedCenter) {
    const rangeWidth = tickUpper - tickLower;
    const halfWidth = Math.floor(rangeWidth / 2);
    
    const adjustedLower = nearestUsableTick(liquidityWeightedCenter - halfWidth, params.tickSpacing);
    const adjustedUpper = nearestUsableTick(liquidityWeightedCenter + halfWidth, params.tickSpacing);
    
    return { tickLower: adjustedLower, tickUpper: adjustedUpper };
  }
  
  return { tickLower, tickUpper };
}

/**
 * Calculate liquidity-weighted center of existing positions
 */
function calculateLiquidityWeightedCenter(
  ticks: number[],
  liquidityDistribution: Map<number, bigint>
): number | null {
  if (ticks.length === 0) return null;
  
  let weightedSum = 0;
  let totalWeight = 0n;
  
  for (const tick of ticks) {
    const liquidity = liquidityDistribution.get(tick) || 0n;
    if (liquidity > 0n) {
      weightedSum += tick * Number(liquidity);
      totalWeight += liquidity;
    }
  }
  
  if (totalWeight === 0n) return null;
  
  return Math.floor(weightedSum / Number(totalWeight));
}

/**
 * Dynamic range adjustment based on real-time market conditions
 */
export function dynamicRangeAdjustment(
  currentRange: SelectedRange,
  marketUpdate: {
    newVolatility: number;
    priceMovement: number; // Recent price change %
    liquidityShift: number; // Change in nearby liquidity
    timeRemaining: number; // Seconds until expected swap
  }
): SelectedRange {
  let adjustedRange = { ...currentRange };
  
  // Adjust for volatility changes
  if (marketUpdate.newVolatility > 0.1 && adjustedRange.rangeType === 'narrow') {
    // Widen narrow range if volatility spikes
    const currentWidth = adjustedRange.tickUpper - adjustedRange.tickLower;
    const expansion = Math.floor(currentWidth * 0.3);
    
    adjustedRange.tickLower -= expansion;
    adjustedRange.tickUpper += expansion;
    adjustedRange.rangeType = 'medium';
    adjustedRange.reasoning += ' (widened due to volatility spike)';
    adjustedRange.riskScore *= 0.8; // Lower risk due to wider range
  }
  
  // Adjust for significant price movement
  if (Math.abs(marketUpdate.priceMovement) > 0.02) { // >2% move
    const moveDirection = marketUpdate.priceMovement > 0 ? 1 : -1;
    
    // Shift range in direction of movement
    const shift = Math.floor((adjustedRange.tickUpper - adjustedRange.tickLower) * 0.2 * moveDirection);
    adjustedRange.tickLower += shift;
    adjustedRange.tickUpper += shift;
    adjustedRange.reasoning += ' (shifted due to price movement)';
  }
  
  // Adjust for time pressure
  if (marketUpdate.timeRemaining < 30 && adjustedRange.rangeType === 'wide') {
    // Narrow range if time is running out
    const center = Math.floor((adjustedRange.tickLower + adjustedRange.tickUpper) / 2);
    const newHalfWidth = Math.floor((adjustedRange.tickUpper - adjustedRange.tickLower) * 0.3);
    
    adjustedRange.tickLower = center - newHalfWidth;
    adjustedRange.tickUpper = center + newHalfWidth;
    adjustedRange.rangeType = 'narrow';
    adjustedRange.reasoning += ' (narrowed due to time pressure)';
    adjustedRange.expectedCapture *= 1.1; // Better capture due to focus
  }
  
  return adjustedRange;
}

/**
 * Validate range selection against pool constraints
 */
export function validateRangeSelection(
  range: SelectedRange,
  poolConstraints: {
    minTick: number;
    maxTick: number;
    tickSpacing: number;
    maxRangeWidth: number;
  }
): { valid: boolean; errors: string[]; adjustedRange?: SelectedRange } {
  const errors: string[] = [];
  
  // Check tick bounds
  if (range.tickLower < poolConstraints.minTick) {
    errors.push(`tickLower ${range.tickLower} below minimum ${poolConstraints.minTick}`);
  }
  
  if (range.tickUpper > poolConstraints.maxTick) {
    errors.push(`tickUpper ${range.tickUpper} above maximum ${poolConstraints.maxTick}`);
  }
  
  // Check tick spacing alignment
  if (range.tickLower % poolConstraints.tickSpacing !== 0) {
    errors.push(`tickLower ${range.tickLower} not aligned to spacing ${poolConstraints.tickSpacing}`);
  }
  
  if (range.tickUpper % poolConstraints.tickSpacing !== 0) {
    errors.push(`tickUpper ${range.tickUpper} not aligned to spacing ${poolConstraints.tickSpacing}`);
  }
  
  // Check range width
  const rangeWidth = range.tickUpper - range.tickLower;
  if (rangeWidth > poolConstraints.maxRangeWidth) {
    errors.push(`Range width ${rangeWidth} exceeds maximum ${poolConstraints.maxRangeWidth}`);
  }
  
  if (rangeWidth <= 0) {
    errors.push(`Invalid range: tickUpper must be greater than tickLower`);
  }
  
  // If there are errors, try to create an adjusted range
  let adjustedRange: SelectedRange | undefined;
  if (errors.length > 0) {
    try {
      adjustedRange = {
        ...range,
        tickLower: Math.max(
          poolConstraints.minTick,
          nearestUsableTick(range.tickLower, poolConstraints.tickSpacing)
        ),
        tickUpper: Math.min(
          poolConstraints.maxTick,
          nearestUsableTick(range.tickUpper, poolConstraints.tickSpacing)
        ),
        reasoning: range.reasoning + ' (adjusted for pool constraints)',
        riskScore: range.riskScore * 1.1 // Slightly higher risk due to constraints
      };
      
      // Ensure adjusted range is still valid
      if (adjustedRange.tickUpper <= adjustedRange.tickLower) {
        adjustedRange = undefined;
      }
    } catch {
      adjustedRange = undefined;
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    adjustedRange
  };
}