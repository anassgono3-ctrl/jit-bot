/**
 * Runtime configuration loader and validator for the JIT bot
 */

import { config } from 'dotenv-safe';
import type { BotConfig } from '../types/index.js';

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): BotConfig {
  // Load environment variables with validation against .env.example
  config({
    allowEmptyValues: false,
    example: '.env.example',
  });

  const ethRpcHttp = process.env.ETH_RPC_HTTP;
  const ethRpcWs = process.env.ETH_RPC_WS;
  const privateKey = process.env.PRIVATE_KEY;
  const chainId = process.env.CHAIN_ID;
  const uniswapV3PoolAddress = process.env.UNISWAP_V3_POOL_ADDRESS;
  const logLevel = process.env.LOG_LEVEL;

  // Validate required environment variables
  if (!ethRpcHttp) {
    throw new Error('ETH_RPC_HTTP environment variable is required');
  }
  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is required');
  }
  if (!chainId) {
    throw new Error('CHAIN_ID environment variable is required');
  }
  if (!uniswapV3PoolAddress) {
    throw new Error('UNISWAP_V3_POOL_ADDRESS environment variable is required');
  }

  // Validate private key format
  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    throw new Error('PRIVATE_KEY must be a valid 32-byte hex string starting with 0x');
  }

  // Validate chain ID
  const parsedChainId = parseInt(chainId, 10);
  if (isNaN(parsedChainId) || parsedChainId <= 0) {
    throw new Error('CHAIN_ID must be a positive integer');
  }

  // Validate log level
  const validLogLevels = ['debug', 'info', 'warn', 'error'] as const;
  const parsedLogLevel = (logLevel as typeof validLogLevels[number]) || 'info';
  if (!validLogLevels.includes(parsedLogLevel)) {
    throw new Error(`LOG_LEVEL must be one of: ${validLogLevels.join(', ')}`);
  }

  return {
    ethRpcHttp,
    ethRpcWs: ethRpcWs || undefined,
    privateKey,
    chainId: parsedChainId,
    uniswapV3PoolAddress,
    logLevel: parsedLogLevel,
  };
}