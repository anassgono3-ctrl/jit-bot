/**
 * Core TypeScript interfaces for the JIT Bot foundation
 */

/**
 * Configuration for the JIT bot runtime
 */
export interface BotConfig {
  ethRpcHttp: string;
  ethRpcWs?: string;
  privateKey: string;
  chainId: number;
  uniswapV3PoolAddress: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Provider configuration for HTTP and WebSocket connections
 */
export interface ProviderConfig {
  httpUrl: string;
  wsUrl?: string;
  chainId: number;
}

/**
 * Mempool transaction data structure
 */
export interface MempoolTransaction {
  hash: string;
  from: string;
  to: string;
  value: bigint;
  gasPrice: bigint;
  gasLimit: bigint;
  data: string;
  nonce: number;
}

/**
 * Uniswap V3 pool state information
 */
export interface PoolState {
  sqrtPriceX96: bigint;
  tick: number;
  observationIndex: number;
  observationCardinality: number;
  observationCardinalityNext: number;
  feeProtocol: number;
  unlocked: boolean;
  fee: number;
  liquidity: bigint;
}

/**
 * Bot runtime state for persistence
 */
export interface BotState {
  lastProcessedBlock: number;
  opportunityCount: number;
  startTime: number;
}