# JIT Liquidity Simulation Framework - Deployment Guide

## Overview

This document outlines the deployment requirements and procedures for the JIT Liquidity Simulation Framework. This framework is designed for **backtesting and strategy development only**. Live trading requires additional components described in the sealed specifications.

## System Requirements

### Minimum Requirements (Development/Testing)
- **CPU**: 4 cores, 2.4GHz+
- **RAM**: 8GB
- **Storage**: 100GB SSD
- **Network**: Stable internet connection
- **OS**: Ubuntu 20.04+, macOS 10.15+, Windows 10+

### Recommended Requirements (Production Simulation)
- **CPU**: 8+ cores, 3.0GHz+
- **RAM**: 16GB+
- **Storage**: 500GB NVMe SSD
- **Network**: 1Gbps+ connection with low latency
- **OS**: Ubuntu 22.04 LTS

### Future Live Trading Requirements
**(NOT IMPLEMENTED - For Reference Only)**
- **CPU**: 16+ cores, 3.5GHz+
- **RAM**: 32GB+
- **Storage**: 2TB NVMe SSD (for full archive node)
- **Network**: Dedicated 10Gbps+ with <10ms latency to major exchanges
- **Location**: Frankfurt, London, or New York data centers
- **Redundancy**: Multiple regions with failover capability

## Software Dependencies

### Core Dependencies
```bash
# Node.js (LTS version)
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# TypeScript globally
npm install -g typescript ts-node

# Build tools
sudo apt-get install -y build-essential git curl
```

### Optional Dependencies
```bash
# For advanced monitoring (optional)
docker pull prom/prometheus
docker pull grafana/grafana

# For database storage (optional)
sudo apt-get install -y postgresql-14
```

## Installation

### 1. Clone Repository
```bash
git clone https://github.com/your-org/jit-bot
cd jit-bot
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Build Framework
```bash
npm run build
```

### 4. Run Tests
```bash
npm test
```

### 5. Generate Fixtures
```bash
npm run generate-fixtures
```

### 6. Run Example Backtest
```bash
npm run example-backtest
```

## Configuration

### Environment Variables
```bash
# Framework Configuration
export NODE_ENV=production
export LOG_LEVEL=info
export METRICS_PORT=3001

# Price Feeds (for USD calculations)
export ETH_PRICE_USD=3000
export USDC_PRICE_USD=1

# Simulation Parameters
export INCLUSION_PROBABILITY=0.4
export GAS_PRICE_GWEI=15
export MAX_POSITIONS=10
```

### Configuration Files

#### `src/config/pools.json`
```json
{
  "pools": [
    {
      "name": "WETH/USDC 0.30%",
      "address": "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8",
      "feeTier": 3000,
      "enabled": true
    }
  ]
}
```

#### `src/config/strategy-config.json`
```json
{
  "poolRules": {
    "3000": {
      "minSwapUsd": 15000,
      "minNetProfitUsd": 25,
      "enabled": true
    }
  }
}
```

## Deployment Scenarios

### 1. Development Environment

**Purpose**: Strategy development and testing

```bash
# Install and run locally
npm install
npm run dev

# Access metrics
curl http://localhost:3001/metrics
```

**Features**:
- Hot reloading
- Debug logging
- Small fixture files
- Local file storage

### 2. Staging Environment

**Purpose**: Performance testing and validation

```bash
# Production build
npm run build

# Run with staging config
NODE_ENV=staging npm run start

# Health check
curl http://localhost:3001/health
```

**Features**:
- Production-like configuration
- Large fixture files
- Performance monitoring
- Stress testing

### 3. Production Simulation

**Purpose**: Final strategy validation before live trading

```bash
# Secure deployment
sudo useradd -r -s /bin/false jit-sim
sudo mkdir -p /opt/jit-simulation
sudo chown jit-sim:jit-sim /opt/jit-simulation

# Deploy application
sudo -u jit-sim cp -r dist/* /opt/jit-simulation/
sudo -u jit-sim NODE_ENV=production npm run start
```

**Features**:
- Isolated user account
- Production monitoring
- Comprehensive logging
- Historical data analysis

## Monitoring and Observability

### Metrics Collection

The framework exports Prometheus metrics at `/metrics`:

```bash
# Key metrics
jit_opportunities_detected_total
jit_positions_opened_total  
jit_positions_successful_total
jit_positions_profitable_total
jit_total_capital_usd
jit_unrealized_pnl_usd
```

### Logging

Structured JSON logs with configurable levels:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "INFO",
  "component": "jit-planner",
  "event": "decision",
  "data": {
    "swapId": "0x...",
    "decision": "attempt",
    "score": 75.2
  }
}
```

### Health Checks

```bash
# Application health
curl http://localhost:3001/health

# Metrics snapshot
curl http://localhost:3001/metrics/json
```

## Security Considerations

### Development Environment
- No private keys required
- Local file access only
- Network isolation recommended

### Production Simulations
- Restricted user account
- Firewall configuration
- Log rotation and cleanup
- Resource monitoring

### Future Live Trading
**(Requirements for live implementation)**
- Hardware security modules
- Multi-signature wallets
- Network segmentation
- 24/7 monitoring
- Emergency shutdown procedures

## Performance Optimization

### Memory Management
```bash
# Node.js memory optimization
export NODE_OPTIONS="--max-old-space-size=8192"

# Garbage collection tuning
export NODE_OPTIONS="--gc-interval=100"
```

### CPU Optimization
```bash
# Use all available cores
export UV_THREADPOOL_SIZE=16

# CPU affinity (Linux)
taskset -c 0-7 npm run start
```

### Storage Optimization
```bash
# SSD optimization
echo noop > /sys/block/sda/queue/scheduler

# Temporary file cleanup
find /tmp -name "jit-*" -mtime +1 -delete
```

## Backup and Recovery

### Configuration Backup
```bash
# Backup configuration
tar -czf config-backup-$(date +%Y%m%d).tar.gz src/config/

# Backup fixtures
tar -czf fixtures-backup-$(date +%Y%m%d).tar.gz src/backtest/fixtures/
```

### Data Recovery
```bash
# Restore configuration
tar -xzf config-backup-20240115.tar.gz

# Verify integrity
npm run validate-config
```

## Troubleshooting

### Common Issues

#### Build Failures
```bash
# Clear cache
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

#### Memory Issues
```bash
# Check memory usage
free -h
ps aux | grep node

# Increase Node.js memory
export NODE_OPTIONS="--max-old-space-size=16384"
```

#### Performance Issues
```bash
# Profile CPU usage
node --prof src/backtest/example_runner.js

# Profile memory usage
node --inspect src/backtest/example_runner.js
```

### Log Analysis
```bash
# Filter error logs
grep '"level":"ERROR"' logs/jit-simulation.log

# Count decisions by type
grep '"event":"decision"' logs/jit-simulation.log | jq '.data.decision' | sort | uniq -c
```

## Maintenance

### Regular Tasks
- **Daily**: Check health endpoints, review error logs
- **Weekly**: Update dependencies, rotate logs
- **Monthly**: Performance review, capacity planning
- **Quarterly**: Security audit, disaster recovery testing

### Updates and Patches
```bash
# Update dependencies
npm audit fix
npm update

# Test updates
npm run test
npm run example-backtest

# Deploy updates
npm run build
sudo systemctl restart jit-simulation
```

## Support and Documentation

### Framework Documentation
- `README.md` - Quick start guide
- `docs/RUNBOOK.md` - Operational procedures  
- `docs/SECURITY.md` - Security guidelines
- `src/specs/` - Live trading specifications

### Getting Help
- Review logs for error details
- Check GitHub issues for known problems
- Consult the sealed specifications for live trading requirements

---

**⚠️ Important Notice**

This deployment guide covers the **simulation framework only**. Live trading deployment requires:

1. Full security audit and risk assessment
2. Implementation of mempool listener (see `src/specs/mempool_listener.md`)
3. Implementation of builder adapter (see `src/specs/builder_adapter.md`)
4. Comprehensive testing on testnets
5. Regulatory compliance review
6. Insurance and risk management procedures

Do not attempt live trading without proper implementation of all required components and thorough security review.