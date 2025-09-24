# Mempool Listener Specification

**⚠️ NOT IMPLEMENTED - SEALED SPECIFICATION ONLY**

This document describes the behavior and interface for a mempool listener component that would detect relevant swaps for JIT liquidity provision. This specification is provided for future implementation and must not be built until proper security review and risk assessment.

## Overview

The mempool listener monitors pending transactions in the Ethereum mempool to identify potential JIT opportunities. It parses transaction calldata, filters for relevant swaps, and forwards opportunities to the JIT planner.

## Architecture

```
Mempool Stream → Parser → Filter → Validator → JIT Planner
```

## Interface Specification

### MempoolListener Class

```typescript
interface MempoolListener {
  // Lifecycle management
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  
  // Event handling
  on(event: 'swap_detected', handler: (swap: PendingSwapDetected) => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  on(event: 'connection_lost', handler: () => void): void;
  
  // Configuration
  updateFilters(filters: SwapFilters): void;
  getStatistics(): MempoolStatistics;
}
```

### Data Structures

```typescript
interface PendingSwapDetected {
  txHash: string;
  from: string;
  to: string;
  value: string;
  gasPrice: string;
  gasLimit: string;
  nonce: number;
  
  // Swap details
  poolAddress: string;
  token0: string;
  token1: string;
  feeTier: number;
  zeroForOne: boolean;
  amountIn: string;
  amountOutMinimum: string;
  sqrtPriceLimitX96: string;
  recipient: string;
  deadline: number;
  
  // Metadata
  detectedAt: number;
  estimatedSwapSizeUsd: number;
  confidenceScore: number; // 0-1
  routerAddress: string;
  methodSignature: string;
}

interface SwapFilters {
  minSwapSizeUsd: number;
  maxSwapSizeUsd: number;
  enabledPools: string[];
  enabledFeeTiers: number[];
  minGasPrice: string;
  maxGasPrice: string;
  blacklistedAddresses: string[];
  whitelistedAddresses?: string[];
}

interface MempoolStatistics {
  totalTransactionsProcessed: number;
  swapsDetected: number;
  filteredOut: number;
  processingRate: number; // tx/sec
  avgProcessingTimeMs: number;
  connectionUptime: number;
  lastBlockProcessed: number;
}
```

## Implementation Requirements

### Connection Management

1. **Multiple Provider Support**
   - Primary: Erigon/Nethermind full node with txpool access
   - Fallback: Private mempool services (Flashbots Protect, Blocknative)
   - Redundancy: Multiple connections with automatic failover

2. **Connection Monitoring**
   - Heartbeat checks every 30 seconds
   - Automatic reconnection with exponential backoff
   - Connection quality metrics (latency, miss rate)

### Transaction Parsing

1. **Supported Router Contracts**
   - Uniswap V3 SwapRouter (0xE592427A0AEce92De3Edee1F18E0157C05861564)
   - Uniswap V3 SwapRouter02 (0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45)
   - Custom aggregator contracts (configurable)

2. **Method Signatures**
   ```solidity
   // Single exact input swap
   function exactInputSingle(ExactInputSingleParams calldata params)
   
   // Multi-hop exact input swap  
   function exactInput(ExactInputParams calldata params)
   
   // Single exact output swap
   function exactOutputSingle(ExactOutputSingleParams calldata params)
   
   // Multi-hop exact output swap
   function exactOutput(ExactOutputParams calldata params)
   ```

3. **Calldata Decoding**
   - ABI decode parameters from transaction input
   - Extract pool address, token pair, amounts, slippage
   - Validate parameter integrity

### Filtering Logic

1. **Size Filters**
   - Minimum swap size: $15k for 0.30% pools, $70k for 0.05% pools
   - Maximum swap size: $10M (risk management)
   - USD value calculation using real-time price feeds

2. **Pool Filters**
   - Whitelist of monitored pools from pool manager
   - Health status checks (exclude degraded/unhealthy pools)
   - Fee tier preferences (prioritize 0.30% > 0.05% > 1.00%)

3. **Gas Filters**
   - Minimum gas price: 10 gwei (avoid low-priority transactions)
   - Maximum gas price: 500 gwei (avoid gas wars)
   - Gas limit validation (reasonable range)

4. **Address Filters**
   - Blacklist known MEV bots and competitors
   - Blacklist sandwich attack patterns
   - Optional whitelist for specific traders

### Risk Controls

1. **Rate Limiting**
   - Maximum opportunities per minute: 100
   - Cooldown period after failed attempts: 30 seconds
   - Pool-specific rate limits

2. **Validation Checks**
   - Transaction signature validation
   - Parameter sanity checks (deadline, slippage)
   - Duplicate detection (same nonce/sender)

3. **Anomaly Detection**
   - Unusual swap patterns
   - Suspicious gas prices
   - Repeated failed transactions

## Error Handling

### Connection Errors
- Network timeouts: Retry with exponential backoff
- Authentication failures: Log and alert
- Rate limiting: Reduce request frequency

### Parsing Errors
- Unknown method signatures: Log and skip
- Invalid calldata: Log and skip
- Decoding failures: Log and skip

### Processing Errors
- Filter validation failures: Log and skip
- External service timeouts: Use cached data
- Memory/CPU limits: Implement circuit breakers

## Security Considerations

### Operational Security
- No private keys in mempool listener process
- Read-only access to blockchain data
- Network isolation from trading components

### Data Privacy
- No logging of sensitive transaction details
- Aggregate statistics only
- Automatic log rotation and cleanup

### Attack Prevention
- No automatic transaction submission
- Manual approval required for any state changes
- Isolated execution environment

## Performance Requirements

### Throughput
- Process 5000+ transactions per second
- Sub-100ms latency for swap detection
- 99.9% uptime requirement

### Resource Usage
- Maximum 4GB RAM usage
- Maximum 2 CPU cores
- Efficient memory management (no leaks)

### Monitoring
- Prometheus metrics export
- Health check endpoint
- Performance dashboard

## Testing Strategy

### Unit Tests
- Transaction parsing accuracy
- Filter logic validation
- Error handling coverage

### Integration Tests
- End-to-end mempool simulation
- Provider failover testing
- Performance benchmarking

### Load Tests
- High transaction volume scenarios
- Memory usage under stress
- Connection stability tests

## Configuration

### Environment Variables
```bash
MEMPOOL_PROVIDER_URL=ws://localhost:8546
MEMPOOL_FALLBACK_URL=wss://api.blocknative.com/v0
MEMPOOL_FILTERS_CONFIG=/config/mempool-filters.json
MEMPOOL_MAX_CONNECTIONS=5
MEMPOOL_HEARTBEAT_INTERVAL=30000
MEMPOOL_PROCESSING_TIMEOUT=1000
```

### Configuration Files
```json
{
  "providers": [
    {
      "name": "erigon-local",
      "url": "ws://localhost:8546",
      "priority": 1,
      "maxConnections": 3
    },
    {
      "name": "blocknative",
      "url": "wss://api.blocknative.com/v0",
      "priority": 2,
      "apiKey": "${BLOCKNATIVE_API_KEY}"
    }
  ],
  "filters": {
    "minSwapSizeUsd": 15000,
    "maxSwapSizeUsd": 10000000,
    "enabledFeeTiers": [500, 3000],
    "minGasPrice": "10000000000",
    "maxGasPrice": "500000000000"
  },
  "performance": {
    "maxQueueSize": 10000,
    "processingTimeout": 1000,
    "rateLimitPerMin": 100
  }
}
```

## Deployment Notes

### Infrastructure Requirements
- Dedicated server with 8GB+ RAM
- Low-latency network connection
- Direct connection to Ethereum node
- Monitoring and alerting setup

### Scaling Considerations
- Horizontal scaling with multiple instances
- Load balancing across providers
- Regional deployment for latency

## Future Enhancements

1. **Machine Learning Integration**
   - Swap pattern recognition
   - Success probability prediction
   - Dynamic filter optimization

2. **Advanced Routing**
   - Multi-hop swap detection
   - Aggregator protocol support
   - Cross-chain bridge monitoring

3. **Collaborative Filtering**
   - Shared intelligence networks
   - MEV protection alliances
   - Community-driven blacklists

---

**⚠️ IMPORTANT SECURITY NOTICE**

This specification describes a system that directly interfaces with live blockchain data and could potentially impact real trading operations. Implementation must follow strict security protocols:

1. **Security Review Required**: Full security audit before any implementation
2. **Staged Deployment**: Testnet → Limited Mainnet → Full Production
3. **Kill Switch**: Emergency shutdown capability
4. **Monitoring**: Comprehensive alerting and monitoring
5. **Risk Management**: Position size limits and loss protection

DO NOT IMPLEMENT without proper security review and risk assessment.