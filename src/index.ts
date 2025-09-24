/**
 * Entry point for the JIT Bot foundation
 * Loads configuration, initializes providers, and manages clean startup/shutdown
 */

import { loadConfig } from './config/index.js';
import { createLogger } from './utils/logger.js';
import { HttpProvider, WsProvider } from './providers/index.js';
import { StateStore } from './db/index.js';
import { MempoolWatcher } from './mempool/index.js';
import { UniswapV3Pool } from './pools/index.js';
import { TransactionExecutor } from './executor/index.js';

/**
 * Main application class
 */
class JitBot {
  private logger = createLogger();
  private httpProvider?: HttpProvider;
  private wsProvider?: WsProvider;
  private stateStore?: StateStore;
  private mempoolWatcher?: MempoolWatcher;
  private pool?: UniswapV3Pool;
  private executor?: TransactionExecutor;
  private isShuttingDown = false;

  /**
   * Initialize the bot
   */
  async initialize(): Promise<void> {
    this.logger.info('🚀 Starting JIT Bot Foundation');

    try {
      // Load configuration
      const config = loadConfig();
      this.logger = createLogger(config.logLevel);
      
      this.logger.info(`Configuration loaded: chainId=${config.chainId}, pool=${config.uniswapV3PoolAddress}`);

      // Initialize HTTP provider
      this.httpProvider = new HttpProvider({
        httpUrl: config.ethRpcHttp,
        chainId: config.chainId,
      });

      await this.httpProvider.testConnection();
      this.logger.info('HTTP provider initialized');

      // Initialize WebSocket provider (if configured)
      if (config.ethRpcWs) {
        this.wsProvider = new WsProvider({
          httpUrl: config.ethRpcHttp,
          wsUrl: config.ethRpcWs,
          chainId: config.chainId,
        });

        await this.wsProvider.start();
        this.logger.info('WebSocket provider initialized');
      }

      // Initialize state store
      this.stateStore = new StateStore();
      await this.stateStore.load();
      this.logger.info('State store initialized');

      // Initialize Uniswap V3 pool
      this.pool = new UniswapV3Pool(
        config.uniswapV3PoolAddress,
        this.httpProvider.getProvider()
      );

      // Test pool connection by fetching current state
      const poolState = await this.pool.getState();
      this.logger.info(`Pool initialized: ${this.pool.getAddress()}, tick=${poolState.tick}, fee=${poolState.fee}`);

      // Initialize transaction executor
      this.executor = new TransactionExecutor(
        config.privateKey,
        this.httpProvider.getProvider()
      );

      const balance = await this.executor.getBalance();
      this.logger.info(`Transaction executor initialized: ${this.executor.getAddress()}, balance=${balance.toString()}`);

      // Initialize mempool watcher (if WebSocket provider available)
      if (this.wsProvider) {
        this.mempoolWatcher = new MempoolWatcher(this.wsProvider.getProvider());
        await this.mempoolWatcher.start();
        this.logger.info('Mempool watcher initialized');
      }

      this.logger.info('✅ JIT Bot Foundation initialized successfully');

    } catch (error) {
      this.logger.error(`❌ Failed to initialize JIT Bot: ${String(error)}`);
      throw error;
    }
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    await this.initialize();
    
    // In the foundation, we just log that we're ready and exit cleanly
    // Future PRs will add the main event loop
    this.logger.info('🟢 JIT Bot is ready for opportunity detection');
    this.logger.info('📝 This is the foundation - main loop will be added in future PRs');
    
    // Schedule clean shutdown after demonstration
    setTimeout(() => {
      this.shutdown().catch(console.error);
    }, 3000);
  }

  /**
   * Shutdown the bot cleanly
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    
    this.isShuttingDown = true;
    this.logger.info('🛑 Shutting down JIT Bot');

    try {
      // Stop mempool watcher
      if (this.mempoolWatcher?.isActive()) {
        await this.mempoolWatcher.stop();
      }

      // Stop WebSocket provider
      if (this.wsProvider?.isConnected()) {
        await this.wsProvider.stop();
      }

      // Save state
      if (this.stateStore) {
        await this.stateStore.save();
      }

      this.logger.info('✅ JIT Bot shutdown complete');
    } catch (error) {
      this.logger.error(`❌ Error during shutdown: ${String(error)}`);
    }
  }
}

/**
 * Handle graceful shutdown
 */
function setupGracefulShutdown(bot: JitBot): void {
  const shutdown = () => {
    bot.shutdown()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error('Shutdown error:', error);
        process.exit(1);
      });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    shutdown();
  });
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    shutdown();
  });
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const bot = new JitBot();
  setupGracefulShutdown(bot);
  await bot.start();
}

// Start the application
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Application failed to start:', error);
    process.exit(1);
  });
}