/**
 * HTTP provider wrapper for JSON-RPC operations
 */

import { JsonRpcProvider } from 'ethers';
import type { ProviderConfig } from '../types/index.js';
import { ProviderError } from '../utils/errors.js';

/**
 * HTTP provider wrapper with enhanced error handling
 */
export class HttpProvider {
  private provider: JsonRpcProvider;

  constructor(private config: ProviderConfig) {
    this.provider = new JsonRpcProvider(config.httpUrl, {
      chainId: config.chainId,
      name: 'ethereum',
    });
  }

  /**
   * Get the underlying ethers provider
   */
  getProvider(): JsonRpcProvider {
    return this.provider;
  }

  /**
   * Test provider connection
   */
  async testConnection(): Promise<void> {
    try {
      const network = await this.provider.getNetwork();
      if (Number(network.chainId) !== this.config.chainId) {
        throw new ProviderError(
          `Chain ID mismatch: expected ${this.config.chainId}, got ${network.chainId}`
        );
      }
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      throw new ProviderError(
        `HTTP provider connection failed: ${String(error)}`
      );
    }
  }

  /**
   * Get current block number
   */
  async getBlockNumber(): Promise<number> {
    try {
      return await this.provider.getBlockNumber();
    } catch (error) {
      throw new ProviderError(`Failed to get block number: ${String(error)}`);
    }
  }
}
