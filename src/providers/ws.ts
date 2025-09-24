/**
 * WebSocket provider wrapper with lifecycle management
 */

import { WebSocketProvider } from 'ethers';
import type { ProviderConfig } from '../types/index.js';
import { ProviderError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * WebSocket provider wrapper with start/stop lifecycle
 */
export class WsProvider {
  private provider: WebSocketProvider | null = null;
  private isStarted = false;

  constructor(private config: ProviderConfig) {
    if (!config.wsUrl) {
      throw new ProviderError('WebSocket URL is required');
    }
  }

  /**
   * Start the WebSocket connection
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      logger.warn('WebSocket provider already started');
      return;
    }

    try {
      const wsUrl = this.config.wsUrl;
      if (!wsUrl) {
        throw new ProviderError('WebSocket URL is required but not provided');
      }

      this.provider = new WebSocketProvider(wsUrl, {
        chainId: this.config.chainId,
        name: 'ethereum',
      });

      // Test connection
      const network = await this.provider.getNetwork();
      if (Number(network.chainId) !== this.config.chainId) {
        throw new ProviderError(
          `Chain ID mismatch: expected ${this.config.chainId}, got ${network.chainId}`
        );
      }

      this.isStarted = true;
      logger.info('WebSocket provider started');
    } catch (error) {
      this.provider = null;
      throw new ProviderError(
        `WebSocket provider start failed: ${String(error)}`
      );
    }
  }

  /**
   * Stop the WebSocket connection
   */
  async stop(): Promise<void> {
    if (!this.isStarted || !this.provider) {
      logger.warn('WebSocket provider not started');
      return;
    }

    try {
      await this.provider.destroy();
      this.provider = null;
      this.isStarted = false;
      logger.info('WebSocket provider stopped');
    } catch (error) {
      logger.error(`Error stopping WebSocket provider: ${String(error)}`);
      throw new ProviderError(
        `WebSocket provider stop failed: ${String(error)}`
      );
    }
  }

  /**
   * Get the underlying ethers provider (only when started)
   */
  getProvider(): WebSocketProvider {
    if (!this.isStarted || !this.provider) {
      throw new ProviderError('WebSocket provider not started');
    }
    return this.provider;
  }

  /**
   * Check if provider is started
   */
  isConnected(): boolean {
    return this.isStarted && this.provider !== null;
  }
}
