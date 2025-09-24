# Builder Adapter Specification

**⚠️ NOT IMPLEMENTED - SEALED SPECIFICATION ONLY**

This document describes the interface and behavior for a builder adapter that would submit JIT liquidity bundles to block builders (Flashbots, etc.). This specification is provided for future implementation and must not be built until proper security review and risk assessment.

## Overview

The builder adapter is responsible for constructing, simulating, and submitting transaction bundles containing JIT liquidity operations. It manages relationships with multiple builders, handles retry logic, and provides detailed execution feedback.

## Architecture

```
JIT Strategy → Bundle Builder → Simulator → Builder Network → Block Inclusion
```

## Interface Specification

### BuilderAdapter Class

```typescript
interface BuilderAdapter {
  // Lifecycle management
  initialize(config: BuilderConfig): Promise<void>;
  shutdown(): Promise<void>;
  
  // Bundle operations
  submitBundle(bundle: TransactionBundle): Promise<BundleSubmissionResult>;
  simulateBundle(bundle: TransactionBundle): Promise<BundleSimulationResult>;
  cancelBundle(bundleId: string): Promise<void>;
  
  // Status and monitoring
  getBundleStatus(bundleId: string): Promise<BundleStatus>;
  getBuilderStatistics(): BuilderStatistics;
  
  // Configuration
  updateBuilderWeights(weights: Record<string, number>): void;
  enableBuilder(builderId: string): void;
  disableBuilder(builderId: string): void;
}
```

### Data Structures

```typescript
interface TransactionBundle {
  id: string;
  transactions: BundleTransaction[];
  targetBlock: number;
  minTimestamp: number;
  maxTimestamp: number;
  revertingTxHashes?: string[];
  replacementUuid?: string;
  signingKey?: string;
}

interface BundleTransaction {
  to: string;
  value: string;
  data: string;
  gasLimit: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: number;
  type?: number;
  accessList?: AccessListEntry[];
}

interface BundleSubmissionResult {
  bundleId: string;
  submittedTo: string[];
  submissionTime: number;
  targetBlock: number;
  estimatedInclusion: {
    probability: number;
    expectedBlock: number;
    confidence: number;
  };
  gasEstimate: {
    totalGasUsed: number;
    effectiveGasPrice: string;
    totalFeePaid: string;
  };
}

interface BundleSimulationResult {
  success: boolean;
  gasUsed: number;
  gasPrice: string;
  effectiveGasPrice: string;
  coinbaseDiff: string;
  ethSentToCoinbase: string;
  gasFees: string;
  logs: SimulationLog[];
  error?: string;
  revertReason?: string;
}

interface BundleStatus {
  bundleId: string;
  status: 'pending' | 'included' | 'failed' | 'cancelled' | 'expired';
  targetBlock: number;
  currentBlock: number;
  submittedTo: string[];
  includedIn?: {
    blockNumber: number;
    blockHash: string;
    transactionIndex: number;
    gasUsed: number;
    effectiveGasPrice: string;
  };
  failureReason?: string;
}
```

## Builder Integration

### Supported Builders

1. **Flashbots Protect**
   - Endpoint: `https://relay.flashbots.net`
   - Authentication: Signing key required
   - Bundle types: Standard, searcher bundles
   - Features: Private mempool, MEV protection

2. **Builder0x69**
   - Endpoint: `https://rpc.builder0x69.io`
   - Authentication: API key
   - Bundle types: Standard bundles
   - Features: High inclusion rate

3. **Titan Builder**
   - Endpoint: `https://rpc.titanbuilder.xyz`
   - Authentication: Signing key
   - Bundle types: Standard, private bundles
   - Features: Low latency

4. **Generic Relay**
   - Configurable endpoints
   - Multiple authentication methods
   - Custom bundle formats

### Builder Selection Logic

```typescript
interface BuilderSelectionStrategy {
  // Weight-based selection
  weighted: {
    builders: Record<string, number>; // builderId -> weight
    includeAll: boolean; // Submit to all builders
  };
  
  // Performance-based selection
  performance: {
    preferHighInclusion: boolean;
    preferLowLatency: boolean;
    minInclusionRate: number;
    maxLatency: number;
  };
  
  // Redundancy settings
  redundancy: {
    minBuilders: number;
    maxBuilders: number;
    requireTrusted: boolean;
  };
}
```

## Bundle Construction

### JIT Bundle Structure

```typescript
interface JitBundle {
  // Flash loan initiation
  flashloanTx: BundleTransaction;
  
  // Target user swap (must be included)
  userSwapTx: BundleTransaction;
  
  // JIT execution transactions
  jitTxs: {
    mint: BundleTransaction;
    burn: BundleTransaction;
    collect: BundleTransaction;
  };
  
  // Flash loan repayment
  repaymentTx: BundleTransaction;
  
  // Optional: MEV share to coinbase
  coinbaseTx?: BundleTransaction;
}
```

### Bundle Validation

```typescript
interface BundleValidator {
  // Transaction validation
  validateTransactions(txs: BundleTransaction[]): ValidationResult;
  
  // Ordering validation
  validateOrdering(bundle: JitBundle): ValidationResult;
  
  // Gas validation
  validateGas(bundle: TransactionBundle): ValidationResult;
  
  // Economic validation
  validateProfitability(bundle: JitBundle): ValidationResult;
}
```

## Simulation Engine

### Pre-submission Simulation

1. **Fork State Simulation**
   - Fork blockchain state at target block
   - Execute bundle transactions sequentially
   - Validate state changes and gas usage

2. **Gas Estimation**
   - Accurate gas limit estimation
   - Gas price optimization
   - Fee market analysis

3. **Profitability Check**
   - Net profit calculation after gas costs
   - Slippage and MEV impact assessment
   - Risk-adjusted expected value

### Simulation Parameters

```typescript
interface SimulationConfig {
  // Blockchain state
  forkBlock: number | 'latest';
  stateOverrides?: StateOverride[];
  
  // Gas settings
  gasLimit: number;
  baseFee: string;
  priorityFee: string;
  
  // Validation rules
  requireSuccess: boolean;
  allowRevert: string[]; // Allowed reverting tx hashes
  maxGasUsed: number;
  minProfitWei: string;
}
```

## Retry and Error Handling

### Retry Strategy

```typescript
interface RetryConfig {
  // Basic retry settings
  maxAttempts: number;
  baseDelay: number; // milliseconds
  maxDelay: number;
  backoffMultiplier: number;
  
  // Conditional retry
  retryableErrors: string[];
  fatalErrors: string[];
  
  // Builder-specific settings
  builderRetryLimits: Record<string, number>;
}
```

### Error Categories

1. **Retryable Errors**
   - Network timeouts
   - Temporary builder unavailability
   - Rate limiting
   - Nonce gaps

2. **Fatal Errors**
   - Invalid transaction format
   - Insufficient funds
   - Contract reverts (unless allowed)
   - Authentication failures

3. **Builder-Specific Errors**
   - Bundle too large
   - Invalid target block
   - Conflicting transactions
   - Policy violations

## Performance Monitoring

### Metrics Collection

```typescript
interface BuilderMetrics {
  // Submission metrics
  bundlesSubmitted: number;
  bundlesIncluded: number;
  inclusionRate: number;
  avgSubmissionLatency: number;
  
  // Builder performance
  builderStats: Record<string, {
    submitted: number;
    included: number;
    avgLatency: number;
    uptime: number;
    lastError?: string;
  }>;
  
  // Economic metrics
  totalGasSpent: string;
  totalProfit: string;
  avgProfitPerBundle: string;
  profitableBundles: number;
}
```

### Health Monitoring

```typescript
interface HealthCheck {
  // Builder connectivity
  checkBuilderHealth(): Promise<Record<string, boolean>>;
  
  // Simulation accuracy
  validateSimulationAccuracy(): Promise<number>; // 0-1
  
  // Performance benchmarks
  measureLatency(): Promise<Record<string, number>>;
  
  // Resource usage
  getResourceUsage(): {
    memory: number;
    cpu: number;
    network: number;
  };
}
```

## Security Considerations

### Private Key Management

1. **Key Isolation**
   - Signing keys stored in secure hardware
   - No key material in application logs
   - Automatic key rotation capability

2. **Transaction Signing**
   - Offline signing when possible
   - Multi-signature requirements for high-value
   - Hardware security module integration

3. **Access Control**
   - Role-based permissions
   - IP whitelisting
   - API key rotation

### Bundle Security

1. **Transaction Validation**
   - Cryptographic signature verification
   - Parameter bounds checking
   - Reentrancy protection

2. **MEV Protection**
   - Bundle privacy until inclusion
   - Frontrunning protection
   - Sandwich attack prevention

3. **Financial Controls**
   - Maximum bundle value limits
   - Daily/hourly spending limits
   - Emergency stop functionality

## Configuration

### Environment Variables

```bash
# Builder endpoints
FLASHBOTS_RELAY_URL=https://relay.flashbots.net
BUILDER_0X69_URL=https://rpc.builder0x69.io
TITAN_BUILDER_URL=https://rpc.titanbuilder.xyz

# Authentication
FLASHBOTS_SIGNING_KEY_PATH=/secrets/flashbots-key.pem
BUILDER_API_KEY=${BUILDER_API_KEY}

# Operational settings
MAX_BUNDLE_SIZE=10
SIMULATION_TIMEOUT=5000
SUBMISSION_TIMEOUT=10000
MAX_CONCURRENT_BUNDLES=100
```

### Configuration Files

```json
{
  "builders": [
    {
      "id": "flashbots",
      "name": "Flashbots Protect",
      "endpoint": "https://relay.flashbots.net",
      "authType": "signing_key",
      "weight": 40,
      "enabled": true,
      "maxBundleSize": 10,
      "maxConcurrent": 50
    },
    {
      "id": "builder0x69",
      "name": "Builder 0x69",
      "endpoint": "https://rpc.builder0x69.io",
      "authType": "api_key",
      "weight": 30,
      "enabled": true
    }
  ],
  "simulation": {
    "enabled": true,
    "requireSuccess": true,
    "maxGasUsed": 1000000,
    "forkLatestBlock": true
  },
  "retry": {
    "maxAttempts": 3,
    "baseDelay": 1000,
    "backoffMultiplier": 2.0
  },
  "security": {
    "maxBundleValueUsd": 1000000,
    "requireSimulation": true,
    "allowedTargetBlocks": 3
  }
}
```

## Testing Strategy

### Unit Tests
- Bundle construction validation
- Transaction signing accuracy
- Error handling coverage
- Retry logic verification

### Integration Tests
- End-to-end bundle submission
- Builder failover testing
- Simulation accuracy validation
- Performance benchmarking

### Load Tests
- High-volume bundle submission
- Concurrent request handling
- Memory usage under stress
- Network resilience testing

## Deployment Requirements

### Infrastructure
- Dedicated servers with redundancy
- Low-latency network connections
- Secure key management system
- Comprehensive monitoring setup

### Operational Procedures
- Staged deployment (testnet → mainnet)
- Real-time monitoring and alerting
- Emergency shutdown procedures
- Performance optimization guidelines

## Future Enhancements

1. **Advanced Bundle Types**
   - Multi-block bundles
   - Conditional execution
   - State-dependent transactions

2. **Cross-Builder Coordination**
   - Bundle sharing protocols
   - Collaborative MEV extraction
   - Builder reputation systems

3. **Machine Learning Optimization**
   - Dynamic builder selection
   - Gas price prediction
   - Inclusion probability modeling

---

**⚠️ CRITICAL SECURITY WARNING**

This specification describes a system that submits real transactions to the Ethereum blockchain with actual financial consequences. Implementation must follow the highest security standards:

1. **Security Audit Required**: Comprehensive third-party security review
2. **Financial Controls**: Strict limits on transaction values and frequency
3. **Emergency Procedures**: Immediate shutdown and recovery capabilities
4. **Insurance**: Consideration of smart contract and operational insurance
5. **Legal Compliance**: Review of regulatory requirements in all jurisdictions

DO NOT IMPLEMENT without proper security audit, risk assessment, and legal review.