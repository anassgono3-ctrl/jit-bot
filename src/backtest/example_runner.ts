/**
 * Example Backtest Runner
 * Demonstrates how to use the JIT simulation framework
 */

import * as path from 'path';
import { runBacktest, BacktestConfig } from './runner';
import { generateFixtures } from './fixtures/generate_fixtures';
import { ScoringConfig } from '../strategy/scoring';
import { initializeLogger, LogLevel } from '../modules/logger';
import { initializeMetrics } from '../modules/metrics';

/**
 * Example backtest configuration
 */
function createExampleConfig(): BacktestConfig {
  const scoringConfig: ScoringConfig = {
    poolRules: {
      "500": {
        minSwapUsd: 70000,
        minNetProfitUsd: 25,
        enabled: true,
        priority: 2
      },
      "3000": {
        minSwapUsd: 15000,
        minNetProfitUsd: 25,
        enabled: true,
        priority: 1
      }
    },
    simulation: {
      captureFraction: 0.9,
      inclusionProbability: 0.4,
      minScore: 10.0,
      maxPositions: 10
    },
    gas: {
      gasPerPosition: 210000,
      gasPriceWei: "15000000000", // 15 gwei
      maxGasCostUsd: 100
    },
    risk: {
      maxInventoryUsd: 500000,
      maxLossPercentage: 2.0,
      positionTimeoutMs: 300000
    }
  };

  return {
    startTime: Date.now() - 7*24*3600*1000, // Last week
    endTime: Date.now(),
    initialCapitalUsd: 100000, // Start with $100k
    maxPositions: 5,
    scoringConfig,
    priceFeeds: {
      token0PriceUsd: 3000, // ETH @ $3000
      token1PriceUsd: 1     // USDC @ $1
    },
    simulation: {
      inclusionProbability: 0.4,
      gasPerPosition: 210000,
      slippageTolerance: 0.001
    }
  };
}

/**
 * Run example backtest
 */
async function runExampleBacktest(): Promise<void> {
  console.log('🚀 JIT Liquidity Simulation Framework - Example Backtest');
  console.log('===============================================\n');

  // Initialize logging and metrics
  const logger = initializeLogger(LogLevel.INFO);
  const metrics = initializeMetrics();
  
  try {
    // Generate fixtures if they don't exist
    console.log('📊 Generating synthetic swap fixtures...');
    generateFixtures();
    console.log('✅ Fixtures generated\n');

    // Configuration
    const config = createExampleConfig();
    console.log('⚙️ Backtest Configuration:');
    console.log(`- Initial Capital: $${config.initialCapitalUsd.toLocaleString()}`);
    console.log(`- Max Positions: ${config.maxPositions}`);
    console.log(`- Min Swap Size (0.30%): $${config.scoringConfig.poolRules['3000'].minSwapUsd.toLocaleString()}`);
    console.log(`- Min Swap Size (0.05%): $${config.scoringConfig.poolRules['500'].minSwapUsd.toLocaleString()}`);
    console.log(`- Min Net Profit: $${config.scoringConfig.poolRules['3000'].minNetProfitUsd}`);
    console.log(`- Inclusion Probability: ${(config.simulation.inclusionProbability * 100).toFixed(1)}%`);
    console.log(`- Gas Per Position: ${config.simulation.gasPerPosition.toLocaleString()}`);
    console.log('');

    // Run backtests on different fixtures
    const fixtures = [
      'swaps_10k.json',
      'swaps_50k.json',
      'swaps_100k.json',
      'swaps_whale.json'
    ];

    const results = [];

    for (const fixture of fixtures) {
      const fixtureFile = path.join(__dirname, 'fixtures', fixture);
      
      console.log(`📈 Running backtest: ${fixture}`);
      console.log('-'.repeat(50));
      
      try {
        const result = await runBacktest(fixtureFile, config);
        results.push(result);
        
        // Display summary
        console.log('📊 Results Summary:');
        console.log(`   Swaps Processed: ${result.summary.swapsProcessed.toLocaleString()}`);
        console.log(`   Positions Opened: ${result.summary.positionsOpened}`);
        console.log(`   Success Rate: ${(result.summary.successRate * 100).toFixed(1)}%`);
        console.log(`   Profitability Rate: ${(result.summary.profitabilityRate * 100).toFixed(1)}%`);
        console.log(`   Total Gross Fees: $${result.summary.totalGrossFeesUsd.toFixed(2)}`);
        console.log(`   Total Gas Cost: $${result.summary.totalGasCostUsd.toFixed(2)}`);
        console.log(`   Total Net Fees: $${result.summary.totalNetFeesUsd.toFixed(2)}`);
        console.log(`   Final Capital: $${result.summary.finalCapitalUsd.toFixed(2)}`);
        console.log(`   Total Return: ${result.summary.totalReturnPercent.toFixed(2)}%`);
        console.log(`   Sharpe Ratio: ${result.summary.sharpeRatio.toFixed(3)}`);
        console.log(`   Max Drawdown: $${result.summary.maxDrawdownUsd.toFixed(2)}`);
        console.log('');

        // Display top performing pools
        if (result.performance.poolBreakdown.length > 0) {
          console.log('🏆 Top Performing Pools:');
          result.performance.poolBreakdown
            .slice(0, 3)
            .forEach((pool, i) => {
              console.log(`   ${i + 1}. ${pool.poolName}`);
              console.log(`      Positions: ${pool.positions}, Net P&L: $${pool.netFeesUsd.toFixed(2)}`);
            });
          console.log('');
        }

        // Fee tier breakdown
        if (result.performance.feeTickerBreakdown.length > 0) {
          console.log('💰 Fee Tier Performance:');
          result.performance.feeTickerBreakdown.forEach(fee => {
            console.log(`   ${fee.feeTier/100}% Pools: ${fee.positions} positions, $${fee.netFeesUsd.toFixed(2)} net`);
          });
          console.log('');
        }

      } catch (error) {
        console.error(`❌ Error running backtest for ${fixture}:`, error);
      }
      
      console.log('='.repeat(60));
      console.log('');
    }

    // Overall analysis
    if (results.length > 0) {
      console.log('🎯 Overall Analysis');
      console.log('==================');
      
      const totalPositions = results.reduce((sum, r) => sum + r.summary.positionsOpened, 0);
      const totalNetPnL = results.reduce((sum, r) => sum + r.summary.totalNetFeesUsd, 0);
      const avgSuccessRate = results.reduce((sum, r) => sum + r.summary.successRate, 0) / results.length;
      const avgProfitabilityRate = results.reduce((sum, r) => sum + r.summary.profitabilityRate, 0) / results.length;
      
      console.log(`Total Positions Across All Tests: ${totalPositions}`);
      console.log(`Total Net P&L: $${totalNetPnL.toFixed(2)}`);
      console.log(`Average Success Rate: ${(avgSuccessRate * 100).toFixed(1)}%`);
      console.log(`Average Profitability Rate: ${(avgProfitabilityRate * 100).toFixed(1)}%`);
      
      // Strategy insights
      console.log('\n💡 Strategy Insights:');
      
      if (avgProfitabilityRate > 0.6) {
        console.log('✅ Strategy shows strong profitability across scenarios');
      } else if (avgProfitabilityRate > 0.4) {
        console.log('⚠️ Strategy shows moderate profitability - consider optimization');
      } else {
        console.log('❌ Strategy shows poor profitability - major revision needed');
      }
      
      if (avgSuccessRate > 0.8) {
        console.log('✅ High execution success rate indicates robust implementation');
      } else if (avgSuccessRate > 0.6) {
        console.log('⚠️ Moderate success rate - investigate failure causes');
      } else {
        console.log('❌ Low success rate indicates implementation issues');
      }
      
      // Recommendations
      console.log('\n🔧 Recommendations:');
      
      const whale_result = results.find(r => r.summary.fixture.includes('whale'));
      if (whale_result && whale_result.summary.profitabilityRate > 0.7) {
        console.log('• Focus on large swap opportunities (>$500k)');
      }
      
      const small_result = results.find(r => r.summary.fixture.includes('10k'));
      if (small_result && small_result.summary.profitabilityRate < 0.3) {
        console.log('• Consider raising minimum swap size thresholds');
      }
      
      if (totalNetPnL > 0) {
        console.log('• Strategy is net profitable - consider live testing');
      } else {
        console.log('• Strategy is not profitable - requires optimization');
      }
      
      console.log('• Monitor gas costs and adjust thresholds for current market conditions');
      console.log('• Consider implementing dynamic position sizing based on volatility');
    }

  } catch (error) {
    console.error('❌ Backtest failed:', error);
    logger.logError('example-runner', error as Error);
  } finally {
    // Cleanup
    logger.destroy();
    console.log('\n🏁 Backtest completed!');
  }
}

/**
 * Display framework information
 */
function displayFrameworkInfo(): void {
  console.log('\n📋 JIT Liquidity Simulation Framework');
  console.log('====================================');
  console.log('');
  console.log('🎯 Purpose: Evaluate JIT liquidity strategies with deterministic simulation');
  console.log('');
  console.log('📦 Components:');
  console.log('  • Deterministic Math Core (tick_math, liquidity_math, price_utils)');
  console.log('  • Local Simulation Engine (pool_state, swap_engine, mint_burn)');
  console.log('  • Strategy Logic (jit_planner, range_selection, scoring)');
  console.log('  • Backtest Framework (runner, fixtures, metrics)');
  console.log('');
  console.log('🔧 Configuration:');
  console.log('  • Target: 0.30% pools @ $15k+, 0.05% pools @ $70k+');
  console.log('  • Capture: 90% of in-range volume');
  console.log('  • Gas Model: 210k gas per position');
  console.log('  • Risk: $25 minimum net profit after gas');
  console.log('');
  console.log('⚠️  Note: This is a SIMULATION framework only');
  console.log('   Real trading requires mempool integration (see specs/)');
  console.log('');
}

// Run example if called directly
if (require.main === module) {
  displayFrameworkInfo();
  runExampleBacktest().catch(console.error);
}

export { runExampleBacktest, createExampleConfig };