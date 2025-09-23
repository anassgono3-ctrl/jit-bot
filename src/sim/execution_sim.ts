/**
 * JIT Execution Simulation
 * Full lifecycle simulation: mint → swap → burn → profit calculation
 */

import { PoolState, clonePoolState } from './pool_state';
import { executeSwap, SwapParams, SwapResult } from './swap_engine';
import { mintPosition, burnPosition, MintParams, BurnParams } from './mint_burn';
import { tokenAmountToUsd } from '../math/price_utils';

export interface JitExecutionParams {
  poolState: PoolState;
  swapParams: SwapParams;
  tickLower: number;
  tickUpper: number;
  liquidityAmount: bigint;
  gasPrice: bigint;
  token0PriceUsd: number;
  token1PriceUsd: number;
  inclusionProbability: number;
}

export interface JitExecutionResult {
  success: boolean;
  profitable: boolean;
  grossFeesToken0: bigint;
  grossFeesToken1: bigint;
  grossFeesUsd: number;
  gasCostWei: bigint;
  gasCostUsd: number;
  netProfitWei: bigint;
  netProfitUsd: number;
  expectedValueUsd: number; // Including inclusion probability
  swapResult: SwapResult;
  liquidityDeployed: bigint;
  priceImpact: number;
  steps: JitExecutionStep[];
}

export interface JitExecutionStep {
  step: string;
  success: boolean;
  gasUsed: number;
  details: any;
}

/**
 * Execute full JIT strategy simulation
 * @param params Execution parameters
 * @returns Execution result
 */
export function executeJitSimulation(params: JitExecutionParams): JitExecutionResult {
  const steps: JitExecutionStep[] = [];
  let totalGasUsed = 0;
  
  // Step 1: Clone pool state for simulation
  const simulationState = clonePoolState(params.poolState);
  steps.push({
    step: 'prepare_simulation',
    success: true,
    gasUsed: 0,
    details: { originalTick: simulationState.currentTick }
  });

  try {
    // Step 2: Mint liquidity position
    const mintParams: MintParams = {
      recipient: 'jit-bot',
      tickLower: params.tickLower,
      tickUpper: params.tickUpper,
      amount: params.liquidityAmount,
      amount0Max: BigInt('2') ** 256n - 1n, // Max amounts for calculation
      amount1Max: BigInt('2') ** 256n - 1n
    };

    const mintResult = mintPosition(simulationState, mintParams);
    const mintGasUsed = 150000; // Estimated gas for mint
    totalGasUsed += mintGasUsed;
    
    steps.push({
      step: 'mint_position',
      success: true,
      gasUsed: mintGasUsed,
      details: {
        liquidity: mintResult.liquidity.toString(),
        amount0: mintResult.amount0.toString(),
        amount1: mintResult.amount1.toString(),
        positionKey: mintResult.positionKey
      }
    });

    // Step 3: Execute the target swap
    const swapResult = executeSwap(simulationState, params.swapParams);
    const swapGasUsed = 60000; // Estimated gas for swap
    totalGasUsed += swapGasUsed;
    
    steps.push({
      step: 'execute_swap',
      success: true,
      gasUsed: swapGasUsed,
      details: {
        amount0: swapResult.amount0.toString(),
        amount1: swapResult.amount1.toString(),
        feeAmount: swapResult.feeAmount.toString(),
        priceImpact: swapResult.priceImpact
      }
    });

    // Step 4: Burn liquidity position and collect fees
    const burnParams: BurnParams = {
      positionKey: mintResult.positionKey,
      liquidity: mintResult.liquidity
    };

    const burnResult = burnPosition(simulationState, burnParams);
    const burnGasUsed = 100000; // Estimated gas for burn + collect
    totalGasUsed += burnGasUsed;
    
    steps.push({
      step: 'burn_position',
      success: true,
      gasUsed: burnGasUsed,
      details: {
        amount0: burnResult.amount0.toString(),
        amount1: burnResult.amount1.toString(),
        feeAmount0: burnResult.feeAmount0.toString(),
        feeAmount1: burnResult.feeAmount1.toString()
      }
    });

    // Step 5: Calculate profit/loss
    const grossFeesToken0 = burnResult.feeAmount0;
    const grossFeesToken1 = burnResult.feeAmount1;
    
    const grossFeesUsd = 
      tokenAmountToUsd(grossFeesToken0, params.token0PriceUsd, simulationState.decimals.token0) +
      tokenAmountToUsd(grossFeesToken1, params.token1PriceUsd, simulationState.decimals.token1);

    const gasCostWei = params.gasPrice * BigInt(totalGasUsed);
    const gasCostUsd = tokenAmountToUsd(gasCostWei, params.token0PriceUsd, 18); // Assuming ETH for gas

    const netProfitUsd = grossFeesUsd - gasCostUsd;
    const netProfitWei = netProfitUsd > 0 
      ? BigInt(Math.floor(netProfitUsd * Math.pow(10, 18) / params.token0PriceUsd))
      : -BigInt(Math.floor(Math.abs(netProfitUsd) * Math.pow(10, 18) / params.token0PriceUsd));

    // Expected value considering inclusion probability
    const expectedValueUsd = netProfitUsd * params.inclusionProbability;

    const profitable = netProfitUsd > 0;

    steps.push({
      step: 'calculate_profit',
      success: true,
      gasUsed: 0,
      details: {
        grossFeesUsd,
        gasCostUsd,
        netProfitUsd,
        expectedValueUsd,
        profitable
      }
    });

    return {
      success: true,
      profitable,
      grossFeesToken0,
      grossFeesToken1,
      grossFeesUsd,
      gasCostWei,
      gasCostUsd,
      netProfitWei,
      netProfitUsd,
      expectedValueUsd,
      swapResult,
      liquidityDeployed: mintResult.liquidity,
      priceImpact: swapResult.priceImpact,
      steps
    };

  } catch (error) {
    steps.push({
      step: 'error',
      success: false,
      gasUsed: 0,
      details: { error: error instanceof Error ? error.message : String(error) }
    });

    return {
      success: false,
      profitable: false,
      grossFeesToken0: 0n,
      grossFeesToken1: 0n,
      grossFeesUsd: 0,
      gasCostWei: params.gasPrice * BigInt(totalGasUsed),
      gasCostUsd: tokenAmountToUsd(params.gasPrice * BigInt(totalGasUsed), params.token0PriceUsd, 18),
      netProfitWei: 0n,
      netProfitUsd: 0,
      expectedValueUsd: 0,
      swapResult: {
        amount0: 0n,
        amount1: 0n,
        sqrtPriceX96: params.poolState.sqrtPriceX96,
        liquidity: params.poolState.liquidity,
        tick: params.poolState.currentTick,
        feeAmount: 0n,
        priceImpact: 0
      },
      liquidityDeployed: 0n,
      priceImpact: 0,
      steps
    };
  }
}

/**
 * Quick profitability estimation without full simulation
 * @param params Execution parameters
 * @returns Basic profitability metrics
 */
export function quickProfitabilityEstimate(params: JitExecutionParams): {
  estimatedFeesUsd: number;
  estimatedGasCostUsd: number;
  estimatedNetProfitUsd: number;
  estimatedExpectedValueUsd: number;
  worthSimulating: boolean;
} {
  // Estimate fees based on swap amount and fee tier
  const swapAmountUsd = params.swapParams.zeroForOne
    ? tokenAmountToUsd(params.swapParams.amountSpecified, params.token0PriceUsd, params.poolState.decimals.token0)
    : tokenAmountToUsd(params.swapParams.amountSpecified, params.token1PriceUsd, params.poolState.decimals.token1);

  const feeRate = params.poolState.feeTier / 1000000; // Convert basis points to decimal
  const estimatedFeesUsd = swapAmountUsd * feeRate * 0.9; // Assume 90% capture

  // Estimate gas cost
  const estimatedGasUsed = 310000; // mint + swap + burn
  const gasCostWei = params.gasPrice * BigInt(estimatedGasUsed);
  const estimatedGasCostUsd = tokenAmountToUsd(gasCostWei, params.token0PriceUsd, 18);

  const estimatedNetProfitUsd = estimatedFeesUsd - estimatedGasCostUsd;
  const estimatedExpectedValueUsd = estimatedNetProfitUsd * params.inclusionProbability;

  // Worth simulating if expected value is positive with some margin
  const worthSimulating = estimatedExpectedValueUsd > 5; // $5 minimum expected value

  return {
    estimatedFeesUsd,
    estimatedGasCostUsd,
    estimatedNetProfitUsd,
    estimatedExpectedValueUsd,
    worthSimulating
  };
}

/**
 * Batch simulate multiple JIT opportunities
 * @param opportunities Array of execution parameters
 * @returns Array of results sorted by expected value
 */
export function batchJitSimulation(opportunities: JitExecutionParams[]): JitExecutionResult[] {
  const results = opportunities.map(executeJitSimulation);
  
  // Sort by expected value descending
  return results.sort((a, b) => b.expectedValueUsd - a.expectedValueUsd);
}

/**
 * Calculate optimal liquidity amount for JIT position
 * @param swapAmountUsd USD value of the swap
 * @param tickRange Width of the tick range
 * @param captureFraction Target fraction of volume to capture
 * @returns Suggested liquidity amount
 */
export function calculateOptimalLiquidity(
  swapAmountUsd: number,
  tickRange: number,
  captureFraction: number = 0.9
): bigint {
  // Simplified liquidity calculation
  // In practice, this would use precise Uniswap V3 math
  const targetCapture = swapAmountUsd * captureFraction;
  
  // Rough approximation: liquidity ∝ capture amount / tick range
  const liquidityFactor = targetCapture / (tickRange * 0.0001); // 0.01% per tick approximation
  
  return BigInt(Math.floor(liquidityFactor * Math.pow(10, 18)));
}