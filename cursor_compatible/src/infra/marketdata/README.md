# Market Microstructure Analysis

This module provides real-time analysis of market microstructure data to uncover hidden order flow signals that can be used to improve trading execution and detect market manipulation.

## Overview

The `MicrostructureAnalyzer` processes orderbook data to calculate metrics that provide insights into market dynamics that aren't visible through traditional price-based analysis.

## Key Metrics

The analyzer computes five key metrics:

1. **Order Book Imbalance (`topImbalance`)**: Measures the delta between top bid/ask liquidity (-1 to 1, where positive values indicate more demand than supply)

2. **Spoofing Detection (`spoofingScore`)**: Identifies potential market manipulation by detecting patterns of sudden order vanishing (0 to 1, where higher values indicate higher probability of spoofing)

3. **Spread Pressure (`spreadPressure`)**: Tracks aggressive tightening/widening of the bid-ask spread (negative values indicate tightening, positive indicate widening)

4. **Quote Volatility (`quoteVolatility`)**: Measures fluctuation in quote sizes to detect market maker withdrawal

5. **Sweep Risk (`sweepRisk`)**: Identifies single-sided depth vulnerability indicating possible stop-loss hunting (0 to 1, where higher values indicate higher risk)

## Redis Schema

The analyzer uses the following Redis data structures:

- `orderbook:<venue>` (Hash) - Current orderbook snapshot
- `ob:spread:<venue>` (String) - Last known spread value
- `ob:volatility:<venue>` (List) - Rolling buffer of top quote sizes
- `ob:spoofing:<venue>` (List) - History of recent orderbook snapshots
- `metrics:microstructure:<venue>` (List) - Historical metrics for analysis

## Usage Example

```typescript
import { RedisClient } from '../core/RedisClient.js';
import { MicrostructureAnalyzer } from './MicrostructureAnalyzer.js';

// Initialize with Redis connection
const redis = new RedisClient({ host: 'localhost', port: 6379 });
const analyzer = new MicrostructureAnalyzer(redis);

// Use in a trading strategy
async function executeTrade(venue, symbol, side, amount) {
  // Get current microstructure metrics
  const metrics = await analyzer.analyze(venue);
  
  if (!metrics) {
    console.log('No microstructure data available');
    return false;
  }
  
  // Check for potential manipulation
  if (metrics.spoofingScore > 0.7 || metrics.sweepRisk > 0.9) {
    console.log('Market manipulation detected, aborting execution');
    return false;
  }
  
  // Adjust execution based on order book imbalance
  if (side === 'buy' && metrics.topImbalance < -0.3) {
    console.log('Strong selling pressure detected, delaying buy execution');
    return false;
  }
  
  if (side === 'sell' && metrics.topImbalance > 0.3) {
    console.log('Strong buying pressure detected, delaying sell execution');
    return false;
  }
  
  // Execute trade if all checks pass
  return executeTradeOnExchange(venue, symbol, side, amount);
}
```

## Integration with Trading Strategies

The microstructure analyzer can be injected into trading strategies to:

1. Detect market manipulation and pause execution
2. Determine favorable entry/exit timing
3. Dynamically adjust position sizing based on liquidity
4. Optimize execution parameters based on real-time market conditions

See `src/examples/MicrostructureStrategyExample.ts` for a complete implementation example. 