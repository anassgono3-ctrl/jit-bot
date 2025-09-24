/**
 * Pool State Management for JIT Simulation
 * Represents pool state snapshots for deterministic simulation
 */

export interface PoolState {
  // Core pool information
  address: string;
  token0: string;
  token1: string;
  feeTier: number;
  tickSpacing: number;
  
  // Current state (slot0-like)
  sqrtPriceX96: bigint;
  currentTick: number;
  observationIndex: number;
  observationCardinality: number;
  observationCardinalityNext: number;
  feeProtocol: number;
  unlocked: boolean;
  
  // Liquidity
  liquidity: bigint;
  
  // Fee growth globals
  feeGrowthGlobal0X128: bigint;
  feeGrowthGlobal1X128: bigint;
  
  // Protocol fees
  protocolFees: {
    token0: bigint;
    token1: bigint;
  };
  
  // Token decimals
  decimals: {
    token0: number;
    token1: number;
  };
  
  // Tick bitmap (simplified - only track initialized ticks)
  tickBitmap: Map<number, bigint>;
  
  // Tick info for active ticks
  ticks: Map<number, TickInfo>;
  
  // Positions (for tracking)
  positions: Map<string, PositionInfo>;
}

export interface TickInfo {
  liquidityGross: bigint;
  liquidityNet: bigint;
  feeGrowthOutside0X128: bigint;
  feeGrowthOutside1X128: bigint;
  tickCumulativeOutside: bigint;
  secondsPerLiquidityOutsideX128: bigint;
  secondsOutside: number;
  initialized: boolean;
}

export interface PositionInfo {
  owner: string;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}

/**
 * Create a new pool state with default values
 */
export function createPoolState(
  address: string,
  token0: string,
  token1: string,
  feeTier: number,
  sqrtPriceX96: bigint,
  currentTick: number,
  liquidity: bigint = 0n,
  decimals: { token0: number; token1: number } = { token0: 18, token1: 18 }
): PoolState {
  const tickSpacing = getTickSpacing(feeTier);
  
  return {
    address,
    token0,
    token1,
    feeTier,
    tickSpacing,
    sqrtPriceX96,
    currentTick,
    observationIndex: 0,
    observationCardinality: 1,
    observationCardinalityNext: 1,
    feeProtocol: 0,
    unlocked: true,
    liquidity,
    feeGrowthGlobal0X128: 0n,
    feeGrowthGlobal1X128: 0n,
    protocolFees: {
      token0: 0n,
      token1: 0n
    },
    decimals,
    tickBitmap: new Map(),
    ticks: new Map(),
    positions: new Map()
  };
}

/**
 * Get tick spacing for a fee tier
 */
function getTickSpacing(feeTier: number): number {
  switch (feeTier) {
    case 500:
      return 10;
    case 3000:
      return 60;
    case 10000:
      return 200;
    default:
      throw new Error(`Unknown fee tier: ${feeTier}`);
  }
}

/**
 * Deep copy a pool state for simulation
 */
export function clonePoolState(state: PoolState): PoolState {
  return {
    ...state,
    protocolFees: { ...state.protocolFees },
    decimals: { ...state.decimals },
    tickBitmap: new Map(state.tickBitmap),
    ticks: new Map(
      Array.from(state.ticks.entries()).map(([tick, info]) => [
        tick,
        { ...info }
      ])
    ),
    positions: new Map(
      Array.from(state.positions.entries()).map(([key, position]) => [
        key,
        { ...position }
      ])
    )
  };
}

/**
 * Export pool state as JSON for persistence
 */
export function exportPoolState(state: PoolState): string {
  const exportData = {
    ...state,
    sqrtPriceX96: state.sqrtPriceX96.toString(),
    liquidity: state.liquidity.toString(),
    feeGrowthGlobal0X128: state.feeGrowthGlobal0X128.toString(),
    feeGrowthGlobal1X128: state.feeGrowthGlobal1X128.toString(),
    protocolFees: {
      token0: state.protocolFees.token0.toString(),
      token1: state.protocolFees.token1.toString()
    },
    tickBitmap: Array.from(state.tickBitmap.entries()).map(([key, value]) => [
      key.toString(),
      value.toString()
    ]),
    ticks: Array.from(state.ticks.entries()).map(([tick, info]) => [
      tick.toString(),
      {
        ...info,
        liquidityGross: info.liquidityGross.toString(),
        liquidityNet: info.liquidityNet.toString(),
        feeGrowthOutside0X128: info.feeGrowthOutside0X128.toString(),
        feeGrowthOutside1X128: info.feeGrowthOutside1X128.toString(),
        tickCumulativeOutside: info.tickCumulativeOutside.toString(),
        secondsPerLiquidityOutsideX128: info.secondsPerLiquidityOutsideX128.toString()
      }
    ]),
    positions: Array.from(state.positions.entries()).map(([key, position]) => [
      key,
      {
        ...position,
        liquidity: position.liquidity.toString(),
        feeGrowthInside0LastX128: position.feeGrowthInside0LastX128.toString(),
        feeGrowthInside1LastX128: position.feeGrowthInside1LastX128.toString(),
        tokensOwed0: position.tokensOwed0.toString(),
        tokensOwed1: position.tokensOwed1.toString()
      }
    ])
  };
  
  return JSON.stringify(exportData, null, 2);
}

/**
 * Import pool state from JSON
 */
export function importPoolState(jsonData: string): PoolState {
  const data = JSON.parse(jsonData);
  
  return {
    ...data,
    sqrtPriceX96: BigInt(data.sqrtPriceX96),
    liquidity: BigInt(data.liquidity),
    feeGrowthGlobal0X128: BigInt(data.feeGrowthGlobal0X128),
    feeGrowthGlobal1X128: BigInt(data.feeGrowthGlobal1X128),
    protocolFees: {
      token0: BigInt(data.protocolFees.token0),
      token1: BigInt(data.protocolFees.token1)
    },
    tickBitmap: new Map(
      data.tickBitmap.map(([key, value]: [string, string]) => [
        parseInt(key),
        BigInt(value)
      ])
    ),
    ticks: new Map(
      data.ticks.map(([tick, info]: [string, any]) => [
        parseInt(tick),
        {
          ...info,
          liquidityGross: BigInt(info.liquidityGross),
          liquidityNet: BigInt(info.liquidityNet),
          feeGrowthOutside0X128: BigInt(info.feeGrowthOutside0X128),
          feeGrowthOutside1X128: BigInt(info.feeGrowthOutside1X128),
          tickCumulativeOutside: BigInt(info.tickCumulativeOutside),
          secondsPerLiquidityOutsideX128: BigInt(info.secondsPerLiquidityOutsideX128)
        }
      ])
    ),
    positions: new Map(
      data.positions.map(([key, position]: [string, any]) => [
        key,
        {
          ...position,
          liquidity: BigInt(position.liquidity),
          feeGrowthInside0LastX128: BigInt(position.feeGrowthInside0LastX128),
          feeGrowthInside1LastX128: BigInt(position.feeGrowthInside1LastX128),
          tokensOwed0: BigInt(position.tokensOwed0),
          tokensOwed1: BigInt(position.tokensOwed1)
        }
      ])
    )
  };
}

/**
 * Generate position key
 */
export function getPositionKey(
  owner: string,
  tickLower: number,
  tickUpper: number
): string {
  return `${owner}-${tickLower}-${tickUpper}`;
}