# Noderr Core - Rust Performance Components

High-performance Rust implementations of latency-critical trading components for the Noderr trading protocol.

## Overview

This crate contains Rust implementations of key performance-sensitive components of the Noderr protocol:

- **Smart Order Router**: Optimized order execution across multiple venues
- **Execution Strategy Router**: Strategy selection and management (TWAP, VWAP, etc.)
- **Risk Calculator**: Fast risk limit checks and position validation
- **Trade Sizer**: Dynamic position sizing based on volatility
- **Drawdown Monitor**: Real-time drawdown tracking and circuit breaker

All components are designed for sub-millisecond performance and minimal memory usage, with a target of <5ms for the full execution chain.

## Usage

### From Rust

```rust
use noderr_core::{SmartOrderRouter, Order, OrderSide};
use std::collections::HashMap;

#[tokio::main]
async fn main() {
    // Create a new smart order router
    let router = SmartOrderRouter::new();
    
    // Execute an order
    let order = Order {
        symbol: "BTC-USD".to_string(),
        side: OrderSide::Buy,
        amount: 1.0,
        price: 50000.0,
        venues: vec!["binance".to_string(), "coinbase".to_string()],
        id: "test-order-1".to_string(),
        max_slippage: Some(0.01),
        max_retries: Some(3),
        additional_params: HashMap::new(),
    };
    
    let result = router.execute_order(order).await;
    println!("Execution result: {:?}", result);
}
```

### From TypeScript/Node.js

```typescript
import { NapiSmartOrderRouter, OrderParams } from '@noderr/core';

// Create a new smart order router
const router = new NapiSmartOrderRouter();

// Execute an order
const params: OrderParams = {
  symbol: 'BTC-USD',
  side: 'buy',
  amount: 1.0,
  price: 50000.0,
  venues: ['binance', 'coinbase'],
  id: 'test-order-1',
  max_slippage: 0.01,
  max_retries: 3,
  additional_params: {},
};

router.execute_order(params)
  .then(result => console.log('Execution result:', result))
  .catch(err => console.error('Execution error:', err));
```

## Performance

Benchmarks show significant performance improvements over the TypeScript implementation:

| Component              | TypeScript (ms) | Rust (ms) | Improvement |
|------------------------|----------------|-----------|-------------|
| SmartOrderRouter       | 12.3           | 1.2       | 10.2x       |
| ExecutionStrategyRouter| 8.7            | 0.8       | 10.9x       |
| RiskCalculator         | 5.4            | 0.4       | 13.5x       |
| DynamicTradeSizer      | 3.2            | 0.3       | 10.7x       |
| DrawdownMonitor        | 6.8            | 0.6       | 11.3x       |
| **Full Chain**         | 36.4           | 3.3       | 11.0x       |

The full execution chain (sizing + risk check + strategy selection + execution) runs in under 5ms, meeting the target for high-frequency trading applications.

## Benchmarking

Run benchmarks using Criterion:

```bash
cargo bench
```

For a detailed HTML report:

```bash
cargo bench --features html_reports
open target/criterion/report/index.html
```

## Building from Source

```bash
# Build Rust library
cargo build --release

# Build Node.js bindings
npm run build:napi
```

## License

MIT 