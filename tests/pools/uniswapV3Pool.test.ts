/**
 * Tests for Uniswap V3 pool functionality
 */

import { JsonRpcProvider } from 'ethers';
import { UniswapV3Pool } from '../../src/pools/index.js';

describe('UniswapV3Pool Tests', () => {
  it('should construct pool accessor safely', () => {
    const provider = new JsonRpcProvider('https://rpc.ankr.com/eth');
    const pool = new UniswapV3Pool(
      '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640', // ETH/USDC 0.05% pool
      provider
    );

    expect(pool).toBeDefined();
    expect(pool.getAddress()).toBe(
      '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640'
    );
  });

  it('should fetch slot0 when ETH_RPC_HTTP and UNISWAP_V3_POOL_ADDRESS are set', async () => {
    if (!process.env.ETH_RPC_HTTP || !process.env.UNISWAP_V3_POOL_ADDRESS) {
      // Skip network-dependent test when environment variables are not set
      console.log(
        'Skipping pool state test - ETH_RPC_HTTP or UNISWAP_V3_POOL_ADDRESS not set'
      );
      return;
    }

    const provider = new JsonRpcProvider(process.env.ETH_RPC_HTTP);
    const pool = new UniswapV3Pool(
      process.env.UNISWAP_V3_POOL_ADDRESS,
      provider
    );

    // This should fetch real pool data when properly configured
    const state = await pool.getState();

    expect(state).toBeDefined();
    expect(state.sqrtPriceX96).toBeDefined();
    expect(typeof state.tick).toBe('number');
    expect(typeof state.fee).toBe('number');
    expect(state.liquidity).toBeDefined();
  }, 10000); // 10 second timeout for network call
});
