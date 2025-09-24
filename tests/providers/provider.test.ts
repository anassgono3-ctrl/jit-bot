/**
 * Tests for provider functionality
 */

import { HttpProvider, WsProvider } from '../../src/providers/index';

describe('Provider Tests', () => {
  describe('HttpProvider', () => {
    it('should construct HTTP provider safely', () => {
      const provider = new HttpProvider({
        httpUrl: 'https://rpc.ankr.com/eth',
        chainId: 1,
      });

      expect(provider).toBeDefined();
      expect(provider.getProvider()).toBeDefined();
    });

    it('should handle connection testing when ETH_RPC_HTTP is not set', async () => {
      if (!process.env.ETH_RPC_HTTP) {
        // Skip network-dependent test when environment variable is not set
        console.log('Skipping HTTP provider connection test - ETH_RPC_HTTP not set');
        return;
      }

      const provider = new HttpProvider({
        httpUrl: process.env.ETH_RPC_HTTP,
        chainId: parseInt(process.env.CHAIN_ID || '1', 10),
      });

      // This should not throw when properly configured
      await expect(provider.testConnection()).resolves.not.toThrow();
    });
  });

  describe('WsProvider', () => {
    it('should construct WebSocket provider safely', () => {
      const provider = new WsProvider({
        httpUrl: 'https://rpc.ankr.com/eth',
        wsUrl: 'wss://rpc.ankr.com/eth/ws',
        chainId: 1,
      });

      expect(provider).toBeDefined();
      expect(provider.isConnected()).toBe(false);
    });

    it('should require WebSocket URL', () => {
      expect(() => {
        new WsProvider({
          httpUrl: 'https://rpc.ankr.com/eth',
          chainId: 1,
        });
      }).toThrow('WebSocket URL is required');
    });
  });
});