/**
 * Minimal Uniswap V3 pool accessor for slot0, fee, and liquidity data
 */

import { Contract } from 'ethers';
import type { Provider } from 'ethers';
import type { PoolState } from '../types/index.js';
import { logger } from '../utils/logger.js';

// Minimal Uniswap V3 Pool ABI for slot0, fee, and liquidity
const UNISWAP_V3_POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function fee() external view returns (uint24)',
  'function liquidity() external view returns (uint128)',
] as const;

/**
 * Uniswap V3 Pool accessor
 */
export class UniswapV3Pool {
  private contract: Contract;

  constructor(
    private address: string,
    provider: Provider
  ) {
    this.contract = new Contract(address, UNISWAP_V3_POOL_ABI, provider);
  }

  /**
   * Get current pool state including slot0, fee, and liquidity
   */
  async getState(): Promise<PoolState> {
    try {
      const [slot0Result, feeResult, liquidityResult] = await Promise.all([
        this.contract.slot0(),
        this.contract.fee(),
        this.contract.liquidity(),
      ]);

      const poolState: PoolState = {
        sqrtPriceX96: slot0Result.sqrtPriceX96,
        tick: slot0Result.tick,
        observationIndex: slot0Result.observationIndex,
        observationCardinality: slot0Result.observationCardinality,
        observationCardinalityNext: slot0Result.observationCardinalityNext,
        feeProtocol: slot0Result.feeProtocol,
        unlocked: slot0Result.unlocked,
        fee: feeResult,
        liquidity: liquidityResult,
      };

      logger.debug(
        `Pool state fetched: address=${this.address}, tick=${poolState.tick}, fee=${poolState.fee}`
      );

      return poolState;
    } catch (error) {
      logger.error(`Failed to fetch pool state: ${String(error)}`);
      throw new Error(`Failed to fetch pool state: ${String(error)}`);
    }
  }

  /**
   * Get pool address
   */
  getAddress(): string {
    return this.address;
  }
}
