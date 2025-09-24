/**
 * JIT Opportunity Scoring System
 * Calculates profitability scores and enforces thresholds
 */

import { tokenAmountToUsd } from '../math/price_utils';

export interface ScoringParams {
  // Swap details
  swapAmountUsd: number;
  swapDirection: boolean; // zeroForOne
  feeTier: number; // basis points (500, 3000, 10000)
  
  // Position details
  estimatedCapture: number; // 0-1
  liquidityAmount: bigint;
  rangeWidth: number; // in ticks
  
  // Cost factors
  gasPrice: bigint;
  gasEstimate: number;
  
  // Market factors
  inclusionProbability: number; // 0-1
  competitionLevel: number; // 0-1, higher = more competition
  volatility: number; // recent volatility
  
  // Token prices
  token0PriceUsd: number;
  token1PriceUsd: number;
}

export interface OpportunityScore {
  grossFeesUsd: number;
  netFeesUsd: number;
  gasCostUsd: number;
  expectedValueUsd: number; // after inclusion probability
  score: number; // 0-100, higher = better
  confidence: number; // 0-1
  recommendation: 'strong_buy' | 'buy' | 'hold' | 'avoid';
  reasoning: string[];
  riskFactors: string[];
  thresholdChecks: {
    minSwapUsd: { passed: boolean; actual: number; required: number };
    minNetProfitUsd: { passed: boolean; actual: number; required: number };
    minScore: { passed: boolean; actual: number; required: number };
  };
}

export interface ScoringConfig {
  poolRules: {
    [feeTier: string]: {
      minSwapUsd: number;
      minNetProfitUsd: number;
      enabled: boolean;
      priority: number;
    };
  };
  simulation: {
    captureFraction: number;
    inclusionProbability: number;
    minScore: number;
    maxPositions: number;
  };
  gas: {
    gasPerPosition: number;
    gasPriceWei: string;
    maxGasCostUsd: number;
  };
  risk: {
    maxInventoryUsd: number;
    maxLossPercentage: number;
    positionTimeoutMs: number;
  };
}

/**
 * Score a JIT opportunity
 * @param params Scoring parameters
 * @param config Scoring configuration
 * @returns Opportunity score
 */
export function scoreJitOpportunity(
  params: ScoringParams,
  config: ScoringConfig
): OpportunityScore {
  const reasoning: string[] = [];
  const riskFactors: string[] = [];
  
  // Get pool rules for this fee tier
  const poolRule = config.poolRules[params.feeTier.toString()];
  if (!poolRule || !poolRule.enabled) {
    return createFailedScore('Pool not enabled or unsupported fee tier', params, config);
  }
  
  // Calculate gross fees
  const feeRate = params.feeTier / 1000000; // Convert basis points to decimal
  const grossFeesUsd = params.swapAmountUsd * feeRate * params.estimatedCapture;
  
  reasoning.push(`Estimated gross fees: $${grossFeesUsd.toFixed(2)} (${(params.estimatedCapture * 100).toFixed(1)}% capture)`);
  
  // Calculate gas costs
  const gasCostWei = params.gasPrice * BigInt(params.gasEstimate);
  const gasCostUsd = tokenAmountToUsd(gasCostWei, params.token0PriceUsd, 18);
  
  reasoning.push(`Gas cost: $${gasCostUsd.toFixed(2)} (${params.gasEstimate} gas @ ${Number(params.gasPrice) / 1e9} gwei)`);
  
  // Calculate net fees
  const netFeesUsd = grossFeesUsd - gasCostUsd;
  
  // Calculate expected value (including inclusion probability)
  const expectedValueUsd = netFeesUsd * params.inclusionProbability;
  
  reasoning.push(`Expected value: $${expectedValueUsd.toFixed(2)} (${(params.inclusionProbability * 100).toFixed(1)}% inclusion)`);
  
  // Threshold checks
  const thresholdChecks = {
    minSwapUsd: {
      passed: params.swapAmountUsd >= poolRule.minSwapUsd,
      actual: params.swapAmountUsd,
      required: poolRule.minSwapUsd
    },
    minNetProfitUsd: {
      passed: netFeesUsd >= poolRule.minNetProfitUsd,
      actual: netFeesUsd,
      required: poolRule.minNetProfitUsd
    },
    minScore: {
      passed: true, // Will be set after score calculation
      actual: 0,
      required: config.simulation.minScore
    }
  };
  
  // Early exit if basic thresholds not met
  if (!thresholdChecks.minSwapUsd.passed) {
    reasoning.push(`❌ Swap size $${params.swapAmountUsd} below minimum $${poolRule.minSwapUsd}`);
    return createFailedScore('Swap size below threshold', params, config, reasoning, thresholdChecks);
  }
  
  if (!thresholdChecks.minNetProfitUsd.passed) {
    reasoning.push(`❌ Net profit $${netFeesUsd.toFixed(2)} below minimum $${poolRule.minNetProfitUsd}`);
    return createFailedScore('Net profit below threshold', params, config, reasoning, thresholdChecks);
  }
  
  // Calculate base score
  let score = calculateBaseScore(params, grossFeesUsd, netFeesUsd, expectedValueUsd);
  reasoning.push(`Base score: ${score.toFixed(1)}/100`);
  
  // Apply adjustments
  const adjustments = calculateScoreAdjustments(params, config);
  score = applyAdjustments(score, adjustments);
  
  adjustments.forEach(adj => {
    reasoning.push(`${adj.factor}: ${adj.change > 0 ? '+' : ''}${adj.change.toFixed(1)} (${adj.reason})`);
  });
  
  // Calculate confidence
  const confidence = calculateConfidence(params, score);
  
  // Identify risk factors
  identifyRiskFactors(params, config, riskFactors);
  
  // Final threshold check
  thresholdChecks.minScore.passed = score >= config.simulation.minScore;
  thresholdChecks.minScore.actual = score;
  
  // Determine recommendation
  const recommendation = determineRecommendation(score, confidence, thresholdChecks);
  
  reasoning.push(`Final score: ${score.toFixed(1)}/100 (confidence: ${(confidence * 100).toFixed(1)}%)`);
  reasoning.push(`Recommendation: ${recommendation.toUpperCase()}`);
  
  return {
    grossFeesUsd,
    netFeesUsd,
    gasCostUsd,
    expectedValueUsd,
    score,
    confidence,
    recommendation,
    reasoning,
    riskFactors,
    thresholdChecks
  };
}

/**
 * Calculate base score from profitability metrics
 */
function calculateBaseScore(
  params: ScoringParams,
  grossFeesUsd: number,
  netFeesUsd: number,
  expectedValueUsd: number
): number {
  // Base score from expected value (0-50 points)
  const valueScore = Math.min(50, (expectedValueUsd / 100) * 50); // $100 = 50 points
  
  // Efficiency score from capture rate (0-25 points)
  const efficiencyScore = params.estimatedCapture * 25;
  
  // Size premium for larger swaps (0-15 points)
  const sizeScore = Math.min(15, (params.swapAmountUsd / 500000) * 15); // $500k = 15 points
  
  // Risk-adjusted score (0-10 points)
  const riskScore = Math.max(0, 10 - (params.volatility * 100)); // Lower volatility = higher score
  
  return valueScore + efficiencyScore + sizeScore + riskScore;
}

/**
 * Calculate score adjustments based on various factors
 */
function calculateScoreAdjustments(params: ScoringParams, config: ScoringConfig): Array<{
  factor: string;
  change: number;
  reason: string;
}> {
  const adjustments = [];
  
  // Fee tier bonus/penalty
  if (params.feeTier === 3000) {
    adjustments.push({
      factor: 'Fee tier bonus',
      change: 5,
      reason: '0.30% pools are primary target'
    });
  } else if (params.feeTier === 500) {
    adjustments.push({
      factor: 'Fee tier adjustment',
      change: -3,
      reason: '0.05% pools require larger swaps'
    });
  }
  
  // Inclusion probability adjustment
  if (params.inclusionProbability > 0.7) {
    adjustments.push({
      factor: 'High inclusion probability',
      change: 3,
      reason: 'Good chance of inclusion'
    });
  } else if (params.inclusionProbability < 0.3) {
    adjustments.push({
      factor: 'Low inclusion probability',
      change: -5,
      reason: 'Poor chance of inclusion'
    });
  }
  
  // Competition penalty
  if (params.competitionLevel > 0.7) {
    adjustments.push({
      factor: 'High competition',
      change: -8,
      reason: 'Many competing MEV bots'
    });
  } else if (params.competitionLevel < 0.3) {
    adjustments.push({
      factor: 'Low competition',
      change: 4,
      reason: 'Less MEV competition'
    });
  }
  
  // Range width adjustment
  if (params.rangeWidth < 10) {
    adjustments.push({
      factor: 'Narrow range bonus',
      change: 3,
      reason: 'Focused liquidity deployment'
    });
  } else if (params.rangeWidth > 50) {
    adjustments.push({
      factor: 'Wide range penalty',
      change: -2,
      reason: 'Spread liquidity reduces efficiency'
    });
  }
  
  return adjustments;
}

/**
 * Apply adjustments to base score
 */
function applyAdjustments(baseScore: number, adjustments: Array<{ change: number }>): number {
  const totalAdjustment = adjustments.reduce((sum, adj) => sum + adj.change, 0);
  return Math.max(0, Math.min(100, baseScore + totalAdjustment));
}

/**
 * Calculate confidence in the score
 */
function calculateConfidence(params: ScoringParams, score: number): number {
  let confidence = 0.7; // Base confidence
  
  // Higher confidence for larger swaps (more predictable)
  if (params.swapAmountUsd > 200000) {
    confidence += 0.1;
  } else if (params.swapAmountUsd < 50000) {
    confidence -= 0.1;
  }
  
  // Lower confidence for high volatility
  if (params.volatility > 0.08) {
    confidence -= 0.2;
  } else if (params.volatility < 0.02) {
    confidence += 0.1;
  }
  
  // Lower confidence for high competition
  if (params.competitionLevel > 0.8) {
    confidence -= 0.15;
  }
  
  // Lower confidence for very high or very low scores (likely edge cases)
  if (score > 90 || score < 10) {
    confidence -= 0.1;
  }
  
  return Math.max(0.1, Math.min(0.95, confidence));
}

/**
 * Identify risk factors
 */
function identifyRiskFactors(
  params: ScoringParams,
  config: ScoringConfig,
  riskFactors: string[]
): void {
  // Inventory risk
  const inventoryUsd = Number(params.liquidityAmount) / 1e18 * params.token0PriceUsd;
  if (inventoryUsd > config.risk.maxInventoryUsd) {
    riskFactors.push(`High inventory risk: $${inventoryUsd.toFixed(0)} position`);
  }
  
  // Gas cost risk
  if (params.gasCostUsd > config.gas.maxGasCostUsd) {
    riskFactors.push(`High gas cost: $${params.gasCostUsd.toFixed(2)}`);
  }
  
  // Volatility risk
  if (params.volatility > 0.1) {
    riskFactors.push(`High volatility: ${(params.volatility * 100).toFixed(1)}%`);
  }
  
  // Competition risk
  if (params.competitionLevel > 0.8) {
    riskFactors.push('Intense MEV competition');
  }
  
  // Narrow range risk
  if (params.rangeWidth < 5) {
    riskFactors.push('Very narrow range - high precision required');
  }
  
  // Inclusion risk
  if (params.inclusionProbability < 0.4) {
    riskFactors.push(`Low inclusion probability: ${(params.inclusionProbability * 100).toFixed(1)}%`);
  }
}

/**
 * Determine recommendation based on score and other factors
 */
function determineRecommendation(
  score: number,
  confidence: number,
  thresholdChecks: OpportunityScore['thresholdChecks']
): OpportunityScore['recommendation'] {
  // Check if all thresholds are met
  const allThresholdsMet = Object.values(thresholdChecks).every(check => check.passed);
  
  if (!allThresholdsMet) {
    return 'avoid';
  }
  
  // Score-based recommendations with confidence adjustment
  const adjustedScore = score * confidence;
  
  if (adjustedScore >= 70) {
    return 'strong_buy';
  } else if (adjustedScore >= 50) {
    return 'buy';
  } else if (adjustedScore >= 30) {
    return 'hold';
  } else {
    return 'avoid';
  }
}

/**
 * Create a failed score result
 */
function createFailedScore(
  reason: string,
  params: ScoringParams,
  config: ScoringConfig,
  reasoning: string[] = [],
  thresholdChecks?: Partial<OpportunityScore['thresholdChecks']>
): OpportunityScore {
  const gasCostWei = params.gasPrice * BigInt(params.gasEstimate);
  const gasCostUsd = tokenAmountToUsd(gasCostWei, params.token0PriceUsd, 18);
  
  return {
    grossFeesUsd: 0,
    netFeesUsd: -gasCostUsd,
    gasCostUsd,
    expectedValueUsd: -gasCostUsd,
    score: 0,
    confidence: 0.9,
    recommendation: 'avoid',
    reasoning: reasoning.length > 0 ? reasoning : [`❌ ${reason}`],
    riskFactors: ['Opportunity rejected at screening'],
    thresholdChecks: {
      minSwapUsd: { passed: false, actual: params.swapAmountUsd, required: 0 },
      minNetProfitUsd: { passed: false, actual: -gasCostUsd, required: 0 },
      minScore: { passed: false, actual: 0, required: config.simulation.minScore },
      ...thresholdChecks
    }
  };
}

/**
 * Batch score multiple opportunities
 * @param opportunities Array of scoring parameters
 * @param config Scoring configuration
 * @returns Array of scores sorted by score descending
 */
export function batchScoreOpportunities(
  opportunities: ScoringParams[],
  config: ScoringConfig
): OpportunityScore[] {
  const scores = opportunities.map(params => scoreJitOpportunity(params, config));
  
  // Sort by expected value descending
  return scores.sort((a, b) => b.expectedValueUsd - a.expectedValueUsd);
}

/**
 * Filter opportunities by recommendation
 * @param scores Array of opportunity scores
 * @param minRecommendation Minimum recommendation level
 * @returns Filtered scores
 */
export function filterByRecommendation(
  scores: OpportunityScore[],
  minRecommendation: 'avoid' | 'hold' | 'buy' | 'strong_buy' = 'buy'
): OpportunityScore[] {
  const recommendationOrder = ['avoid', 'hold', 'buy', 'strong_buy'];
  const minIndex = recommendationOrder.indexOf(minRecommendation);
  
  return scores.filter(score => {
    const scoreIndex = recommendationOrder.indexOf(score.recommendation);
    return scoreIndex >= minIndex;
  });
}

/**
 * Get portfolio-level scoring summary
 * @param scores Array of opportunity scores
 * @returns Portfolio summary
 */
export function getPortfolioSummary(scores: OpportunityScore[]): {
  totalOpportunities: number;
  strongBuy: number;
  buy: number;
  hold: number;
  avoid: number;
  totalExpectedValueUsd: number;
  averageScore: number;
  averageConfidence: number;
  topRiskFactors: string[];
} {
  const recommendations = scores.reduce((acc, score) => {
    acc[score.recommendation]++;
    return acc;
  }, { strong_buy: 0, buy: 0, hold: 0, avoid: 0 } as Record<string, number>);
  
  const totalExpectedValueUsd = scores.reduce((sum, score) => sum + score.expectedValueUsd, 0);
  const averageScore = scores.length > 0 ? scores.reduce((sum, score) => sum + score.score, 0) / scores.length : 0;
  const averageConfidence = scores.length > 0 ? scores.reduce((sum, score) => sum + score.confidence, 0) / scores.length : 0;
  
  // Count risk factors
  const riskFactorCounts = new Map<string, number>();
  scores.forEach(score => {
    score.riskFactors.forEach(risk => {
      riskFactorCounts.set(risk, (riskFactorCounts.get(risk) || 0) + 1);
    });
  });
  
  const topRiskFactors = Array.from(riskFactorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([risk]) => risk);
  
  return {
    totalOpportunities: scores.length,
    strongBuy: recommendations.strong_buy,
    buy: recommendations.buy,
    hold: recommendations.hold,
    avoid: recommendations.avoid,
    totalExpectedValueUsd,
    averageScore,
    averageConfidence,
    topRiskFactors
  };
}