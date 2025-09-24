/**
 * Mint/Burn Operations for JIT Simulation
 * Handles liquidity position lifecycle and fee calculations
 */

import { PoolState, getPositionKey } from './pool_state';
import { getAmountsForLiquidity, liquidityForAmounts } from '../math/liquidity_math';
import { getSqrtRatioAtTick } from '../math/tick_math';

export interface MintParams {
  recipient: string;
  tickLower: number;
  tickUpper: number;
  amount: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
}

export interface MintResult {
  amount0: bigint;
  amount1: bigint;
  liquidity: bigint;
  positionKey: string;
}

export interface BurnParams {
  positionKey: string;
  liquidity: bigint;
}

export interface BurnResult {
  amount0: bigint;
  amount1: bigint;
  feeAmount0: bigint;
  feeAmount1: bigint;
}

export interface CollectParams {
  positionKey: string;
  amount0Max: bigint;
  amount1Max: bigint;
}

export interface CollectResult {
  amount0: bigint;
  amount1: bigint;
}

/**
 * Mint a new liquidity position
 * @param state Pool state to modify
 * @param params Mint parameters
 * @returns Mint result
 */
export function mintPosition(state: PoolState, params: MintParams): MintResult {
  // Validate tick range
  if (params.tickLower >= params.tickUpper) {
    throw new Error('Invalid tick range');
  }
  
  if (params.tickLower % state.tickSpacing !== 0 || params.tickUpper % state.tickSpacing !== 0) {
    throw new Error('Ticks not aligned to tick spacing');
  }

  // Calculate liquidity to mint
  const sqrtPriceLowerX96 = getSqrtRatioAtTick(params.tickLower);
  const sqrtPriceUpperX96 = getSqrtRatioAtTick(params.tickUpper);
  
  const liquidity = liquidityForAmounts(
    state.sqrtPriceX96,
    sqrtPriceLowerX96,
    sqrtPriceUpperX96,
    params.amount0Max,
    params.amount1Max
  );

  if (liquidity === 0n) {
    throw new Error('No liquidity to mint');
  }

  // Calculate actual amounts needed
  const { amount0, amount1 } = getAmountsForLiquidity(
    state.sqrtPriceX96,
    sqrtPriceLowerX96,
    sqrtPriceUpperX96,
    liquidity
  );

  // Check amount limits
  if (amount0 > params.amount0Max || amount1 > params.amount1Max) {
    throw new Error('Amount exceeds maximum');
  }

  // Update ticks
  updateTick(state, params.tickLower, liquidity);
  updateTick(state, params.tickUpper, -liquidity);

  // Update global liquidity if position is active
  if (params.tickLower <= state.currentTick && state.currentTick < params.tickUpper) {
    state.liquidity += liquidity;
  }

  // Create or update position
  const positionKey = getPositionKey(params.recipient, params.tickLower, params.tickUpper);
  const existingPosition = state.positions.get(positionKey);
  
  if (existingPosition) {
    // Update existing position
    const feeGrowthInside0X128 = getFeeGrowthInside(state, params.tickLower, params.tickUpper, true);
    const feeGrowthInside1X128 = getFeeGrowthInside(state, params.tickLower, params.tickUpper, false);
    
    // Calculate fees owed
    const feeGrowthInside0DeltaX128 = feeGrowthInside0X128 - existingPosition.feeGrowthInside0LastX128;
    const feeGrowthInside1DeltaX128 = feeGrowthInside1X128 - existingPosition.feeGrowthInside1LastX128;
    
    existingPosition.tokensOwed0 += (existingPosition.liquidity * feeGrowthInside0DeltaX128) >> 128n;
    existingPosition.tokensOwed1 += (existingPosition.liquidity * feeGrowthInside1DeltaX128) >> 128n;
    
    // Update position
    existingPosition.liquidity += liquidity;
    existingPosition.feeGrowthInside0LastX128 = feeGrowthInside0X128;
    existingPosition.feeGrowthInside1LastX128 = feeGrowthInside1X128;
  } else {
    // Create new position
    const feeGrowthInside0X128 = getFeeGrowthInside(state, params.tickLower, params.tickUpper, true);
    const feeGrowthInside1X128 = getFeeGrowthInside(state, params.tickLower, params.tickUpper, false);
    
    state.positions.set(positionKey, {
      owner: params.recipient,
      tickLower: params.tickLower,
      tickUpper: params.tickUpper,
      liquidity,
      feeGrowthInside0LastX128: feeGrowthInside0X128,
      feeGrowthInside1LastX128: feeGrowthInside1X128,
      tokensOwed0: 0n,
      tokensOwed1: 0n
    });
  }

  return {
    amount0,
    amount1,
    liquidity,
    positionKey
  };
}

/**
 * Burn liquidity from a position
 * @param state Pool state to modify
 * @param params Burn parameters
 * @returns Burn result
 */
export function burnPosition(state: PoolState, params: BurnParams): BurnResult {
  const position = state.positions.get(params.positionKey);
  if (!position) {
    throw new Error('Position not found');
  }

  if (params.liquidity > position.liquidity) {
    throw new Error('Insufficient liquidity');
  }

  // Calculate fee growth inside
  const feeGrowthInside0X128 = getFeeGrowthInside(state, position.tickLower, position.tickUpper, true);
  const feeGrowthInside1X128 = getFeeGrowthInside(state, position.tickLower, position.tickUpper, false);

  // Calculate amounts to return
  const sqrtPriceLowerX96 = getSqrtRatioAtTick(position.tickLower);
  const sqrtPriceUpperX96 = getSqrtRatioAtTick(position.tickUpper);
  
  const { amount0, amount1 } = getAmountsForLiquidity(
    state.sqrtPriceX96,
    sqrtPriceLowerX96,
    sqrtPriceUpperX96,
    params.liquidity
  );

  // Calculate fees earned
  const feeGrowthInside0DeltaX128 = feeGrowthInside0X128 - position.feeGrowthInside0LastX128;
  const feeGrowthInside1DeltaX128 = feeGrowthInside1X128 - position.feeGrowthInside1LastX128;
  
  const feeAmount0 = (params.liquidity * feeGrowthInside0DeltaX128) >> 128n;
  const feeAmount1 = (params.liquidity * feeGrowthInside1DeltaX128) >> 128n;

  // Update ticks
  updateTick(state, position.tickLower, -params.liquidity);
  updateTick(state, position.tickUpper, params.liquidity);

  // Update global liquidity if position is active
  if (position.tickLower <= state.currentTick && state.currentTick < position.tickUpper) {
    state.liquidity -= params.liquidity;
  }

  // Update position
  position.liquidity -= params.liquidity;
  position.tokensOwed0 += feeAmount0;
  position.tokensOwed1 += feeAmount1;
  position.feeGrowthInside0LastX128 = feeGrowthInside0X128;
  position.feeGrowthInside1LastX128 = feeGrowthInside1X128;

  // Remove position if liquidity is zero
  if (position.liquidity === 0n) {
    state.positions.delete(params.positionKey);
  }

  return {
    amount0,
    amount1,
    feeAmount0,
    feeAmount1
  };
}

/**
 * Collect fees from a position
 * @param state Pool state to modify
 * @param params Collect parameters
 * @returns Collect result
 */
export function collectFees(state: PoolState, params: CollectParams): CollectResult {
  const position = state.positions.get(params.positionKey);
  if (!position) {
    throw new Error('Position not found');
  }

  // Calculate amounts to collect
  const amount0 = params.amount0Max < position.tokensOwed0 ? params.amount0Max : position.tokensOwed0;
  const amount1 = params.amount1Max < position.tokensOwed1 ? params.amount1Max : position.tokensOwed1;

  // Update position
  position.tokensOwed0 -= amount0;
  position.tokensOwed1 -= amount1;

  return {
    amount0,
    amount1
  };
}

/**
 * Update tick info when liquidity changes
 */
function updateTick(state: PoolState, tick: number, liquidityDelta: bigint): void {
  let tickInfo = state.ticks.get(tick);
  
  if (!tickInfo) {
    // Initialize new tick
    tickInfo = {
      liquidityGross: 0n,
      liquidityNet: 0n,
      feeGrowthOutside0X128: 0n,
      feeGrowthOutside1X128: 0n,
      tickCumulativeOutside: 0n,
      secondsPerLiquidityOutsideX128: 0n,
      secondsOutside: 0,
      initialized: false
    };
    
    // Set fee growth outside if below current tick
    if (tick <= state.currentTick) {
      tickInfo.feeGrowthOutside0X128 = state.feeGrowthGlobal0X128;
      tickInfo.feeGrowthOutside1X128 = state.feeGrowthGlobal1X128;
    }
    
    state.ticks.set(tick, tickInfo);
  }

  const liquidityGrossBefore = tickInfo.liquidityGross;
  const liquidityGrossAfter = liquidityGrossBefore + (liquidityDelta < 0n ? -liquidityDelta : liquidityDelta);

  if (liquidityGrossAfter > (BigInt(2) ** 128n - 1n)) {
    throw new Error('Liquidity overflow');
  }

  const flipped = (liquidityGrossAfter === 0n) !== (liquidityGrossBefore === 0n);

  if (liquidityGrossBefore === 0n) {
    tickInfo.initialized = true;
  }

  tickInfo.liquidityGross = liquidityGrossAfter;
  tickInfo.liquidityNet += liquidityDelta;

  if (flipped && liquidityGrossAfter === 0n) {
    tickInfo.initialized = false;
    state.ticks.delete(tick);
  }
}

/**
 * Calculate fee growth inside a position's range
 */
function getFeeGrowthInside(
  state: PoolState,
  tickLower: number,
  tickUpper: number,
  token0: boolean
): bigint {
  const tickLowerInfo = state.ticks.get(tickLower);
  const tickUpperInfo = state.ticks.get(tickUpper);

  const feeGrowthGlobalX128 = token0 ? state.feeGrowthGlobal0X128 : state.feeGrowthGlobal1X128;
  
  // Calculate fee growth below
  let feeGrowthBelowX128: bigint;
  if (tickLowerInfo && tickLowerInfo.initialized) {
    const feeGrowthOutsideX128 = token0 ? tickLowerInfo.feeGrowthOutside0X128 : tickLowerInfo.feeGrowthOutside1X128;
    feeGrowthBelowX128 = state.currentTick >= tickLower ? feeGrowthOutsideX128 : feeGrowthGlobalX128 - feeGrowthOutsideX128;
  } else {
    feeGrowthBelowX128 = 0n;
  }

  // Calculate fee growth above
  let feeGrowthAboveX128: bigint;
  if (tickUpperInfo && tickUpperInfo.initialized) {
    const feeGrowthOutsideX128 = token0 ? tickUpperInfo.feeGrowthOutside0X128 : tickUpperInfo.feeGrowthOutside1X128;
    feeGrowthAboveX128 = state.currentTick < tickUpper ? feeGrowthOutsideX128 : feeGrowthGlobalX128 - feeGrowthOutsideX128;
  } else {
    feeGrowthAboveX128 = 0n;
  }

  return feeGrowthGlobalX128 - feeGrowthBelowX128 - feeGrowthAboveX128;
}