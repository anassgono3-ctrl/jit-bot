/**
 * Swap Engine for JIT Simulation
 * Implements tick-by-tick swap logic with state mutations
 */

import { PoolState } from './pool_state';
import { getSqrtRatioAtTick, getTickAtSqrtRatio } from '../math/tick_math';

export interface SwapParams {
  zeroForOne: boolean;
  amountSpecified: bigint;
  sqrtPriceLimitX96?: bigint;
}

export interface SwapResult {
  amount0: bigint;
  amount1: bigint;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tick: number;
  feeAmount: bigint;
  priceImpact: number;
}

export interface SwapStep {
  sqrtPriceStartX96: bigint;
  tickNext: number;
  initialized: boolean;
  sqrtPriceNextX96: bigint;
  amountIn: bigint;
  amountOut: bigint;
  feeAmount: bigint;
}

/**
 * Execute a swap against the pool state
 * @param state Pool state to swap against (will be mutated)
 * @param params Swap parameters
 * @returns Swap result
 */
export function executeSwap(state: PoolState, params: SwapParams): SwapResult {
  const {
    sqrtPriceX96: sqrtPriceStartX96,
    currentTick,
    liquidity
  } = state;

  // Set price limit if not specified
  const sqrtPriceLimitX96 = params.sqrtPriceLimitX96 || 
    (params.zeroForOne ? BigInt('4295128740') : BigInt('1461446703485210103287273052203988822378723970342'));

  let { sqrtPriceX96: currentSqrtPriceX96, currentTick: currentTickValue, liquidity: currentLiquidity } = state;
  let amountSpecifiedRemaining = params.amountSpecified;
  let amountCalculated = 0n;
  let feeAmount = 0n;

  const steps: SwapStep[] = [];

  // Main swap loop
  while (amountSpecifiedRemaining !== 0n && currentSqrtPriceX96 !== sqrtPriceLimitX96) {
    const step: Partial<SwapStep> = {};
    step.sqrtPriceStartX96 = currentSqrtPriceX96;

    // Find next initialized tick
    const { tickNext, initialized } = getNextInitializedTick(
      state,
      currentTickValue,
      params.zeroForOne
    );
    
    step.tickNext = tickNext;
    step.initialized = initialized;

    // Get sqrt price for next tick
    step.sqrtPriceNextX96 = getSqrtRatioAtTick(tickNext);

    // Compute swap target
    const sqrtPriceTargetX96 = (params.zeroForOne 
      ? step.sqrtPriceNextX96 < sqrtPriceLimitX96 
      : step.sqrtPriceNextX96 > sqrtPriceLimitX96)
      ? sqrtPriceLimitX96
      : step.sqrtPriceNextX96;

    // Compute swap amounts
    const swapComputation = computeSwapStep(
      currentSqrtPriceX96,
      sqrtPriceTargetX96,
      currentLiquidity,
      amountSpecifiedRemaining,
      state.feeTier
    );

    currentSqrtPriceX96 = swapComputation.sqrtPriceNextX96;
    step.amountIn = swapComputation.amountIn;
    step.amountOut = swapComputation.amountOut;
    step.feeAmount = swapComputation.feeAmount;

    amountSpecifiedRemaining -= (swapComputation.amountIn + swapComputation.feeAmount);
    amountCalculated += swapComputation.amountOut;
    feeAmount += swapComputation.feeAmount;

    // Update fee growth
    if (currentLiquidity > 0n) {
      const feeGrowthGlobalX128 = (swapComputation.feeAmount << 128n) / currentLiquidity;
      if (params.zeroForOne) {
        state.feeGrowthGlobal0X128 += feeGrowthGlobalX128;
      } else {
        state.feeGrowthGlobal1X128 += feeGrowthGlobalX128;
      }
    }

    // Cross tick if needed
    if (currentSqrtPriceX96 === step.sqrtPriceNextX96) {
      if (step.initialized) {
        const liquidityNet = crossTick(state, tickNext);
        if (params.zeroForOne) currentLiquidity -= liquidityNet;
        else currentLiquidity += liquidityNet;
      }

      currentTickValue = params.zeroForOne ? tickNext - 1 : tickNext;
    } else {
      currentTickValue = getTickAtSqrtRatio(currentSqrtPriceX96);
    }

    steps.push(step as SwapStep);
  }

  // Calculate price impact
  const priceStart = Number(sqrtPriceStartX96 * sqrtPriceStartX96) / Number((BigInt(2) ** 192n));
  const priceEnd = Number(currentSqrtPriceX96 * currentSqrtPriceX96) / Number((BigInt(2) ** 192n));
  const priceImpact = Math.abs((priceEnd - priceStart) / priceStart) * 100;

  // Update pool state
  state.sqrtPriceX96 = currentSqrtPriceX96;
  state.currentTick = currentTickValue;
  state.liquidity = currentLiquidity;

  // Calculate final amounts
  const amount0 = params.zeroForOne ? params.amountSpecified - amountSpecifiedRemaining : -amountCalculated;
  const amount1 = params.zeroForOne ? -amountCalculated : params.amountSpecified - amountSpecifiedRemaining;

  return {
    amount0,
    amount1,
    sqrtPriceX96: currentSqrtPriceX96,
    liquidity: currentLiquidity,
    tick: currentTickValue,
    feeAmount,
    priceImpact
  };
}

/**
 * Find next initialized tick
 */
function getNextInitializedTick(
  state: PoolState,
  currentTick: number,
  zeroForOne: boolean
): { tickNext: number; initialized: boolean } {
  const { tickSpacing } = state;
  
  if (zeroForOne) {
    // Find next initialized tick to the left
    let tickNext = Math.floor(currentTick / tickSpacing) * tickSpacing;
    
    // Look for initialized ticks
    for (let i = 0; i < 256; i++) {
      if (state.ticks.has(tickNext) && state.ticks.get(tickNext)!.initialized) {
        return { tickNext, initialized: true };
      }
      tickNext -= tickSpacing;
      if (tickNext < -887272) {
        return { tickNext: -887272, initialized: false };
      }
    }
    return { tickNext, initialized: false };
  } else {
    // Find next initialized tick to the right
    let tickNext = Math.ceil(currentTick / tickSpacing) * tickSpacing;
    
    // Look for initialized ticks
    for (let i = 0; i < 256; i++) {
      if (state.ticks.has(tickNext) && state.ticks.get(tickNext)!.initialized) {
        return { tickNext, initialized: true };
      }
      tickNext += tickSpacing;
      if (tickNext > 887272) {
        return { tickNext: 887272, initialized: false };
      }
    }
    return { tickNext, initialized: false };
  }
}

/**
 * Compute swap step amounts
 */
function computeSwapStep(
  sqrtPriceCurrentX96: bigint,
  sqrtPriceTargetX96: bigint,
  liquidity: bigint,
  amountRemaining: bigint,
  feeTier: number
): {
  sqrtPriceNextX96: bigint;
  amountIn: bigint;
  amountOut: bigint;
  feeAmount: bigint;
} {
  const zeroForOne = sqrtPriceCurrentX96 >= sqrtPriceTargetX96;
  const exactIn = amountRemaining >= 0n;

  let sqrtPriceNextX96: bigint;
  let amountIn: bigint = 0n;
  let amountOut: bigint = 0n;

  if (exactIn) {
    const amountRemainingLessFee = (amountRemaining * BigInt(1000000 - feeTier)) / 1000000n;
    amountIn = zeroForOne
      ? getAmount0Delta(sqrtPriceTargetX96, sqrtPriceCurrentX96, liquidity, true)
      : getAmount1Delta(sqrtPriceCurrentX96, sqrtPriceTargetX96, liquidity, true);
    
    if (amountRemainingLessFee >= amountIn) {
      sqrtPriceNextX96 = sqrtPriceTargetX96;
    } else {
      sqrtPriceNextX96 = getNextSqrtPriceFromInput(
        sqrtPriceCurrentX96,
        liquidity,
        amountRemainingLessFee,
        zeroForOne
      );
    }
  } else {
    amountOut = zeroForOne
      ? getAmount1Delta(sqrtPriceTargetX96, sqrtPriceCurrentX96, liquidity, false)
      : getAmount0Delta(sqrtPriceCurrentX96, sqrtPriceTargetX96, liquidity, false);
    
    if (-amountRemaining >= amountOut) {
      sqrtPriceNextX96 = sqrtPriceTargetX96;
    } else {
      sqrtPriceNextX96 = getNextSqrtPriceFromOutput(
        sqrtPriceCurrentX96,
        liquidity,
        -amountRemaining,
        zeroForOne
      );
    }
  }

  const max = sqrtPriceTargetX96 === sqrtPriceNextX96;

  if (zeroForOne) {
    amountIn = max && exactIn
      ? amountIn
      : getAmount0Delta(sqrtPriceNextX96, sqrtPriceCurrentX96, liquidity, true);
    amountOut = max && !exactIn
      ? amountOut
      : getAmount1Delta(sqrtPriceNextX96, sqrtPriceCurrentX96, liquidity, false);
  } else {
    amountIn = max && exactIn
      ? amountIn
      : getAmount1Delta(sqrtPriceCurrentX96, sqrtPriceNextX96, liquidity, true);
    amountOut = max && !exactIn
      ? amountOut
      : getAmount0Delta(sqrtPriceCurrentX96, sqrtPriceNextX96, liquidity, false);
  }

  if (!exactIn && amountOut > -amountRemaining) {
    amountOut = -amountRemaining;
  }

  if (exactIn && sqrtPriceNextX96 !== sqrtPriceTargetX96) {
    const feeAmount = amountRemaining - amountIn;
    return { sqrtPriceNextX96, amountIn, amountOut, feeAmount };
  } else {
    const feeAmount = (amountIn * BigInt(feeTier)) / BigInt(1000000 - feeTier);
    return { sqrtPriceNextX96, amountIn, amountOut, feeAmount };
  }
}

/**
 * Cross a tick and return liquidity delta
 */
function crossTick(state: PoolState, tick: number): bigint {
  const tickInfo = state.ticks.get(tick);
  if (!tickInfo) {
    return 0n;
  }

  // Update fee growth outside
  tickInfo.feeGrowthOutside0X128 = state.feeGrowthGlobal0X128 - tickInfo.feeGrowthOutside0X128;
  tickInfo.feeGrowthOutside1X128 = state.feeGrowthGlobal1X128 - tickInfo.feeGrowthOutside1X128;

  return tickInfo.liquidityNet;
}

// Helper functions for amount calculations
function getAmount0Delta(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
  roundUp: boolean
): bigint {
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  }

  const numerator1 = liquidity << 96n;
  const numerator2 = sqrtRatioBX96 - sqrtRatioAX96;

  if (roundUp) {
    return (numerator1 * numerator2 + sqrtRatioBX96 * sqrtRatioAX96 - 1n) / (sqrtRatioBX96 * sqrtRatioAX96);
  } else {
    return (numerator1 * numerator2) / (sqrtRatioBX96 * sqrtRatioAX96);
  }
}

function getAmount1Delta(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
  roundUp: boolean
): bigint {
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  }

  if (roundUp) {
    return (liquidity * (sqrtRatioBX96 - sqrtRatioAX96) + (1n << 96n) - 1n) >> 96n;
  } else {
    return (liquidity * (sqrtRatioBX96 - sqrtRatioAX96)) >> 96n;
  }
}

function getNextSqrtPriceFromInput(
  sqrtPX96: bigint,
  liquidity: bigint,
  amountIn: bigint,
  zeroForOne: boolean
): bigint {
  if (zeroForOne) {
    return getNextSqrtPriceFromAmount0RoundingUp(sqrtPX96, liquidity, amountIn, true);
  } else {
    return getNextSqrtPriceFromAmount1RoundingDown(sqrtPX96, liquidity, amountIn, true);
  }
}

function getNextSqrtPriceFromOutput(
  sqrtPX96: bigint,
  liquidity: bigint,
  amountOut: bigint,
  zeroForOne: boolean
): bigint {
  if (zeroForOne) {
    return getNextSqrtPriceFromAmount1RoundingDown(sqrtPX96, liquidity, amountOut, false);
  } else {
    return getNextSqrtPriceFromAmount0RoundingUp(sqrtPX96, liquidity, amountOut, false);
  }
}

function getNextSqrtPriceFromAmount0RoundingUp(
  sqrtPX96: bigint,
  liquidity: bigint,
  amount: bigint,
  add: boolean
): bigint {
  if (amount === 0n) return sqrtPX96;

  const numerator1 = liquidity << 96n;

  if (add) {
    const product = amount * sqrtPX96;
    if (product / amount === sqrtPX96) {
      const denominator = numerator1 + product;
      if (denominator >= numerator1) {
        return (numerator1 * sqrtPX96 + denominator - 1n) / denominator;
      }
    }
    return (numerator1 + (amount * sqrtPX96 + sqrtPX96 - 1n) / sqrtPX96 - 1n) / liquidity + 1n;
  } else {
    const product = amount * sqrtPX96;
    const denominator = numerator1 - product;
    return (numerator1 * sqrtPX96) / denominator;
  }
}

function getNextSqrtPriceFromAmount1RoundingDown(
  sqrtPX96: bigint,
  liquidity: bigint,
  amount: bigint,
  add: boolean
): bigint {
  if (add) {
    const quotient = amount <= (BigInt(2) ** 160n - 1n)
      ? (amount << 96n) / liquidity
      : amount / (liquidity >> 96n);
    
    return sqrtPX96 + quotient;
  } else {
    const quotient = amount <= (BigInt(2) ** 160n - 1n)
      ? (amount << 96n) / liquidity
      : amount / (liquidity >> 96n);
    
    return sqrtPX96 - quotient;
  }
}