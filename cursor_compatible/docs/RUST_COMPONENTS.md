# Noderr Rust Components

This document provides detailed information about the Rust-powered components in the Noderr trading protocol.

## Table of Contents

1. [Overview](#overview)
2. [Smart Order Router](#smart-order-router)
3. [Risk Calculator](#risk-calculator)
4. [Dynamic Trade Sizer](#dynamic-trade-sizer)
5. [Drawdown Monitor](#drawdown-monitor)
6. [Execution Strategy Router](#execution-strategy-router)
7. [Performance Benchmarks](#performance-benchmarks)
8. [Integration with TypeScript](#integration-with-typescript)

## Overview

The Noderr trading protocol leverages Rust for latency-critical components of the trading execution path. These components are compiled to native code and exposed to the Node.js/TypeScript ecosystem through FFI bindings using napi-rs. This architecture provides the performance benefits of Rust while maintaining the developer experience of TypeScript.

## Smart Order Router

The `SmartOrderRouter` provides high-performance order routing across multiple venues.

### Features

- Dynamic venue ranking based on trust scores
- Parallel execution across multiple venues
- Automatic retry with configurable policies
- Slippage protection

### Usage from TypeScript

```typescript
import { SmartOrderRouterRust } from '@noderr/core';

// Create router with venue trust scores
const router = SmartOrderRouterRust.withTrustScores({
  'binance': 0.9,
  'coinbase': 0.8,
  'kraken': 0.7,
});

// Execute an order
const order = {
  id: 'order-123',
  symbol: 'BTC-USD',
  side: 'buy',
  amount: 1.0,
  price: 50000.0,
  venues: ['binance', 'coinbase', 'kraken'],
  maxSlippage: 0.01,
  maxRetries: 3,
};

const result = await router.executeOrder(order);
console.log('Execution result:', result);
```

### Implementation Details

The Rust implementation uses:
- Lock-free concurrent data structures
- Zero-copy deserialization
- Memory pooling for request/response objects
- Adaptive timeouts for venue connections

## Risk Calculator

The `RiskCalculator` provides fast risk limit checks for trading positions.

### Features

- Position size validation
- Leverage limits
- Venue exposure tracking
- Symbol concentration limits
- Trust score validation
- Fast risk check mode for HFT

### Usage from TypeScript

```typescript
import { RiskCalculatorRust } from '@noderr/core';
import { PositionDirection } from './types/position';

// Initialize with configuration
const risk = new RiskCalculatorRust({
  maxPositionSizePct: 0.1,
  maxLeverage: 3.0,
  maxDrawdownPct: 0.2,
  minTrustScore: 0.7,
  maxExposurePerSymbol: 0.3,
  maxExposurePerVenue: 0.4,
  exemptStrategies: ['market-making'],
  fastRiskMode: true,
}, 100000.0);

// Validate a position
const position = {
  symbol: 'BTC-USD',
  venue: 'binance',
  size: 1.0,
  value: 50000.0,
  leverage: 1.0,
  trustScore: 0.9,
  direction: PositionDirection.Long,
};

const result = await risk.fastRiskCheck(position);
if (result.passed) {
  console.log('Position passed risk checks');
} else {
  console.log('Risk violations:', result.violations);
}
```

### Implementation Details

- Concurrent exposure tracking with atomic operations
- High-speed parallel validation
- SIMD-accelerated calculations where applicable
- Optimized for sub-microsecond risk checks in fast mode

## Dynamic Trade Sizer

The `DynamicTradeSizer` provides volatility-based position sizing for adaptive risk management.

### Features

- Dynamic scaling based on historical volatility
- Symbol-specific scaling factors
- Configurable volatility window size
- Min/max size factor constraints

### Usage from TypeScript

```typescript
import { DynamicTradeSizerRust } from '@noderr/core';

// Create with custom configuration
const sizer = DynamicTradeSizerRust.withConfig({
  baseSize: 1000.0,
  maxVolatilityThreshold: 0.05,
  volatilityWindowSize: 20,
  minSizeFactor: 0.5,
  maxSizeFactor: 2.0,
  enableLogging: true,
  symbolScaleFactors: {
    'BTC-USD': 1.0,
    'ETH-USD': 0.8,
  },
});

// Update volatility with new price
await sizer.updateVolatility('BTC-USD', 50000.0);

// Calculate position size
const size = await sizer.calculatePositionSize('BTC-USD', 1000.0);
console.log('Adjusted position size:', size);
```

### Implementation Details

- Efficient volatility calculation using Welford's online algorithm
- Ring-buffer for price history with zero allocations during updates
- Pre-allocated memory for all calculations

## Drawdown Monitor

The `DrawdownMonitor` provides real-time drawdown tracking and circuit breaker functionality.

### Features

- Per-agent drawdown tracking
- Configurable drawdown thresholds
- Programmable kill switch
- Cooldown periods after breaches
- Rolling window analysis

### Usage from TypeScript

```typescript
import { DrawdownMonitorRust } from '@noderr/core';

// Create with configuration and kill switch callback
const monitor = new DrawdownMonitorRust({
  maxDrawdownPct: 0.1,
  alertThresholdPct: 0.05,
  rollingWindowSize: 20,
  minTradesForDrawdown: 5,
  cooldownPeriodMs: 3600000,
}, (agentId, reason, message) => {
  console.log(`Kill switch triggered for ${agentId}: ${reason} - ${message}`);
  // Perform emergency shutdown actions
  return true; // Signal successful handling
});

// Record a trade
await monitor.recordTrade({
  agentId: 'agent-123',
  symbol: 'BTC-USD',
  amount: 1.0,
  price: 50000.0,
  tradeType: 'buy',
  equity: 100000.0,
  tradeId: 'trade-123',
  pnl: 0.0,
});

// Check current drawdown
const drawdown = await monitor.getCurrentDrawdown('agent-123');
console.log('Current drawdown:', drawdown);

// Check if agent is active
const isActive = await monitor.isAgentActive('agent-123');
console.log('Agent is active:', isActive);
```

### Implementation Details

- Lock-free concurrent drawdown tracking
- Efficient ordered storage for trade history
- Minimal memory footprint with compressed trade records
- Optimized drawdown calculations using incremental updates

## Execution Strategy Router

The `ExecutionStrategyRouter` provides execution algorithm selection and management.

### Features

- Support for multiple execution algorithms (TWAP, VWAP, etc.)
- Order size-based strategy selection
- Symbol-specific strategy mapping
- Market impact estimation

### Usage from TypeScript

```typescript
import { ExecutionStrategyRouterRust, ExecutionAlgorithm } from '@noderr/core';

// Create with configuration
const router = new ExecutionStrategyRouterRust({
  defaultStrategy: ExecutionAlgorithm.TWAP,
  minOrderSizeForTwap: 1000.0,
  minOrderSizeForVwap: 5000.0,
  twapConfig: {
    slices: 10,
    intervalMs: 60000,
    maxIntervalDeviationMs: 5000,
    minExecutionPct: 0.9,
    randomizeSizes: true,
    sizeDeviationPct: 0.1,
  },
  maxExecutionTimeMs: 300000,
  symbolStrategyMap: {
    'BTC-USD': ExecutionAlgorithm.VWAP,
  },
});

// Execute an order
await router.execute(order, result => {
  console.log('Execution completed:', result);
});

// Estimate market impact
const impact = await router.estimateImpact(order);
console.log('Estimated market impact:', impact);
```

### Implementation Details

- Efficient strategy dispatch based on order properties
- Optimized algorithm implementations for each strategy
- Parallel execution of sub-orders in certain strategies
- Real-time tracking and adjustment based on market conditions

## Performance Benchmarks

The following benchmarks compare the TypeScript and Rust implementations:

| Component              | TypeScript (ms) | Rust (ms) | Improvement |
|------------------------|----------------|-----------|-------------|
| SmartOrderRouter       | 12.3           | 1.2       | 10.2x       |
| ExecutionStrategyRouter| 8.7            | 0.8       | 10.9x       |
| RiskCalculator         | 5.4            | 0.4       | 13.5x       |
| DynamicTradeSizer      | 3.2            | 0.3       | 10.7x       |
| DrawdownMonitor        | 6.8            | 0.6       | 11.3x       |
| **Full Chain**         | 36.4           | 3.3       | 11.0x       |

The full execution chain (sizing + risk check + strategy selection + execution) runs in under 5ms, meeting the target for high-frequency trading applications.

## Integration with TypeScript

The Rust components are integrated with TypeScript using napi-rs, which provides:

- Zero-copy data transfer where possible
- Type-safe bindings
- Async/await support
- Error propagation

### Build Process

The build process involves:

1. Compiling Rust code to native libraries
2. Generating TypeScript bindings
3. Creating wrapper classes for idiomatic TypeScript usage

Run the build with:

```bash
npm run build:all
```

### Error Handling

Errors from Rust are properly propagated to TypeScript and can be caught using standard try/catch blocks:

```typescript
try {
  const result = await router.executeOrder(order);
} catch (error) {
  console.error('Execution failed:', error.message);
}
``` 