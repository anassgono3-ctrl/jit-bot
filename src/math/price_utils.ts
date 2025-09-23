/**
 * Price utility functions for Uniswap V3
 * Handles sqrtPriceX96 conversions and token orientation
 */

import { getSqrtRatioAtTick, getTickAtSqrtRatio } from './tick_math';

/**
 * Convert sqrtPriceX96 to human-readable price
 * @param sqrtPriceX96 sqrt price in X96 format
 * @param decimals0 token0 decimals
 * @param decimals1 token1 decimals
 * @returns price as token1/token0
 */
export function sqrtPriceX96ToPrice(
  sqrtPriceX96: bigint,
  decimals0: number = 18,
  decimals1: number = 18
): number {
  // price = (sqrtPriceX96 / 2^96)^2
  const Q96 = 2n ** 96n;
  const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
  const price = sqrtPrice * sqrtPrice;
  
  // Adjust for token decimals
  const decimalAdjustment = Math.pow(10, decimals0 - decimals1);
  
  return price * decimalAdjustment;
}

/**
 * Convert human-readable price to sqrtPriceX96
 * @param price price as token1/token0
 * @param decimals0 token0 decimals
 * @param decimals1 token1 decimals
 * @returns sqrt price in X96 format
 */
export function priceToSqrtPriceX96(
  price: number,
  decimals0: number = 18,
  decimals1: number = 18
): bigint {
  // Adjust for token decimals
  const decimalAdjustment = Math.pow(10, decimals1 - decimals0);
  const adjustedPrice = price * decimalAdjustment;
  
  // sqrtPriceX96 = sqrt(price) * 2^96
  const Q96 = 2n ** 96n;
  const sqrtPrice = Math.sqrt(adjustedPrice);
  
  return BigInt(Math.floor(sqrtPrice * Number(Q96)));
}

/**
 * Convert tick to human-readable price
 * @param tick the tick value
 * @param decimals0 token0 decimals
 * @param decimals1 token1 decimals
 * @returns price as token1/token0
 */
export function tickToPrice(
  tick: number,
  decimals0: number = 18,
  decimals1: number = 18
): number {
  const sqrtPriceX96 = getSqrtRatioAtTick(tick);
  return sqrtPriceX96ToPrice(sqrtPriceX96, decimals0, decimals1);
}

/**
 * Convert human-readable price to tick
 * @param price price as token1/token0
 * @param decimals0 token0 decimals
 * @param decimals1 token1 decimals
 * @returns the corresponding tick
 */
export function priceToTick(
  price: number,
  decimals0: number = 18,
  decimals1: number = 18
): number {
  const sqrtPriceX96 = priceToSqrtPriceX96(price, decimals0, decimals1);
  return getTickAtSqrtRatio(sqrtPriceX96);
}

/**
 * Normalize token pair orientation (ensure token0 < token1 by address)
 * @param tokenA address of token A
 * @param tokenB address of token B
 * @param amountA amount of token A
 * @param amountB amount of token B
 * @returns normalized token order
 */
export function normalizeTokenOrder(
  tokenA: string,
  tokenB: string,
  amountA: bigint,
  amountB: bigint
): {
  token0: string;
  token1: string;
  amount0: bigint;
  amount1: bigint;
  flipped: boolean;
} {
  const flipped = tokenA.toLowerCase() > tokenB.toLowerCase();
  
  if (flipped) {
    return {
      token0: tokenB,
      token1: tokenA,
      amount0: amountB,
      amount1: amountA,
      flipped: true
    };
  } else {
    return {
      token0: tokenA,
      token1: tokenB,
      amount0: amountA,
      amount1: amountB,
      flipped: false
    };
  }
}

/**
 * Calculate price impact for a swap
 * @param amountIn input amount
 * @param sqrtPriceBeforeX96 price before swap
 * @param sqrtPriceAfterX96 price after swap
 * @param decimals0 token0 decimals
 * @param decimals1 token1 decimals
 * @returns price impact as percentage
 */
export function calculatePriceImpact(
  _amountIn: bigint,
  sqrtPriceBeforeX96: bigint,
  sqrtPriceAfterX96: bigint,
  decimals0: number = 18,
  decimals1: number = 18
): number {
  const priceBefore = sqrtPriceX96ToPrice(sqrtPriceBeforeX96, decimals0, decimals1);
  const priceAfter = sqrtPriceX96ToPrice(sqrtPriceAfterX96, decimals0, decimals1);
  
  const priceDiff = Math.abs(priceAfter - priceBefore);
  return (priceDiff / priceBefore) * 100;
}

/**
 * Format price for display
 * @param price the price value
 * @param precision decimal places
 * @returns formatted price string
 */
export function formatPrice(price: number, precision: number = 6): string {
  if (price < 0.000001) {
    return price.toExponential(precision);
  } else if (price < 1) {
    return price.toFixed(precision + 2);
  } else if (price < 1000) {
    return price.toFixed(precision);
  } else {
    return price.toFixed(2);
  }
}

/**
 * Convert USD amount to token amount using price
 * @param usdAmount USD amount
 * @param tokenPrice token price in USD
 * @param decimals token decimals
 * @returns token amount
 */
export function usdToTokenAmount(
  usdAmount: number,
  tokenPrice: number,
  decimals: number = 18
): bigint {
  const tokenAmount = usdAmount / tokenPrice;
  const scaledAmount = tokenAmount * Math.pow(10, decimals);
  return BigInt(Math.floor(scaledAmount));
}

/**
 * Convert token amount to USD using price
 * @param tokenAmount token amount
 * @param tokenPrice token price in USD
 * @param decimals token decimals
 * @returns USD amount
 */
export function tokenAmountToUsd(
  tokenAmount: bigint,
  tokenPrice: number,
  decimals: number = 18
): number {
  const scaledAmount = Number(tokenAmount) / Math.pow(10, decimals);
  return scaledAmount * tokenPrice;
}