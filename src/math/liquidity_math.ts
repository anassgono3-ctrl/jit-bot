/**
 * Uniswap V3 Liquidity Math Implementation
 * Deterministic, pure functions for liquidity calculations using BigInt for precision
 */

import { getSqrtRatioAtTick } from './tick_math';

/**
 * Calculate liquidity from token0 amount
 * @param sqrtRatioAX96 sqrt price at tick A
 * @param sqrtRatioBX96 sqrt price at tick B
 * @param amount0 token0 amount
 * @returns liquidity
 */
export function liquidityFromToken0(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  amount0: bigint
): bigint {
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  }
  
  const intermediate = (sqrtRatioAX96 * sqrtRatioBX96) >> 96n;
  return (amount0 * intermediate) / (sqrtRatioBX96 - sqrtRatioAX96);
}

/**
 * Calculate liquidity from token1 amount
 * @param sqrtRatioAX96 sqrt price at tick A
 * @param sqrtRatioBX96 sqrt price at tick B
 * @param amount1 token1 amount
 * @returns liquidity
 */
export function liquidityFromToken1(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  amount1: bigint
): bigint {
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  }
  
  return (amount1 << 96n) / (sqrtRatioBX96 - sqrtRatioAX96);
}

/**
 * Calculate liquidity for given token amounts and price range
 * @param sqrtRatioCurrentX96 current sqrt price
 * @param sqrtRatioAX96 sqrt price at lower tick
 * @param sqrtRatioBX96 sqrt price at upper tick
 * @param amount0 token0 amount available
 * @param amount1 token1 amount available
 * @returns liquidity that can be deployed
 */
export function liquidityForAmounts(
  sqrtRatioCurrentX96: bigint,
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  amount0: bigint,
  amount1: bigint
): bigint {
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  }

  let liquidity: bigint;

  if (sqrtRatioCurrentX96 <= sqrtRatioAX96) {
    // Current price is below the range - only token0 is needed
    liquidity = liquidityFromToken0(sqrtRatioAX96, sqrtRatioBX96, amount0);
  } else if (sqrtRatioCurrentX96 < sqrtRatioBX96) {
    // Current price is within the range - both tokens are needed
    const liquidity0 = liquidityFromToken0(sqrtRatioCurrentX96, sqrtRatioBX96, amount0);
    const liquidity1 = liquidityFromToken1(sqrtRatioAX96, sqrtRatioCurrentX96, amount1);
    
    liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
  } else {
    // Current price is above the range - only token1 is needed
    liquidity = liquidityFromToken1(sqrtRatioAX96, sqrtRatioBX96, amount1);
  }

  return liquidity;
}

/**
 * Calculate token amounts for given liquidity and price range
 * @param sqrtRatioCurrentX96 current sqrt price
 * @param sqrtRatioAX96 sqrt price at lower tick
 * @param sqrtRatioBX96 sqrt price at upper tick
 * @param liquidity liquidity amount
 * @returns token amounts needed
 */
export function getAmountsForLiquidity(
  sqrtRatioCurrentX96: bigint,
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint
): { amount0: bigint; amount1: bigint } {
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  }

  let amount0 = 0n;
  let amount1 = 0n;

  if (sqrtRatioCurrentX96 <= sqrtRatioAX96) {
    // Current price is below the range
    amount0 = getAmount0ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
  } else if (sqrtRatioCurrentX96 < sqrtRatioBX96) {
    // Current price is within the range
    amount0 = getAmount0ForLiquidity(sqrtRatioCurrentX96, sqrtRatioBX96, liquidity);
    amount1 = getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioCurrentX96, liquidity);
  } else {
    // Current price is above the range
    amount1 = getAmount1ForLiquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity);
  }

  return { amount0, amount1 };
}

/**
 * Calculate token0 amount for given liquidity and price range
 * @param sqrtRatioAX96 sqrt price at tick A
 * @param sqrtRatioBX96 sqrt price at tick B
 * @param liquidity liquidity amount
 * @returns token0 amount
 */
export function getAmount0ForLiquidity(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint
): bigint {
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  }
  
  return (liquidity << 96n) * (sqrtRatioBX96 - sqrtRatioAX96) / sqrtRatioBX96 / sqrtRatioAX96;
}

/**
 * Calculate token1 amount for given liquidity and price range
 * @param sqrtRatioAX96 sqrt price at tick A
 * @param sqrtRatioBX96 sqrt price at tick B
 * @param liquidity liquidity amount
 * @returns token1 amount
 */
export function getAmount1ForLiquidity(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint
): bigint {
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  }
  
  return (liquidity * (sqrtRatioBX96 - sqrtRatioAX96)) >> 96n;
}

/**
 * Calculate liquidity for tick range with current pool price
 * @param tickLower lower tick of the range
 * @param tickUpper upper tick of the range
 * @param currentTick current pool tick
 * @param amount0 token0 amount available
 * @param amount1 token1 amount available
 * @returns liquidity that can be deployed
 */
export function calculateLiquidityForTicks(
  tickLower: number,
  tickUpper: number,
  currentTick: number,
  amount0: bigint,
  amount1: bigint
): bigint {
  const sqrtRatioLowerX96 = getSqrtRatioAtTick(tickLower);
  const sqrtRatioUpperX96 = getSqrtRatioAtTick(tickUpper);
  const sqrtRatioCurrentX96 = getSqrtRatioAtTick(currentTick);
  
  return liquidityForAmounts(
    sqrtRatioCurrentX96,
    sqrtRatioLowerX96,
    sqrtRatioUpperX96,
    amount0,
    amount1
  );
}