# Position Manager

The Position Manager is a critical component of the Noderr Trading System that tracks and manages positions across multiple symbols and agents. It provides position tracking, risk management, and accounting functionality.

## Features

- **Multi-Agent Support**: Track positions for multiple trading agents/strategies simultaneously
- **Real-Time Position Updates**: Maintain accurate position information based on orders and fills
- **Risk Limits**: Enforce position size limits per symbol and total exposure limits
- **P&L Calculation**: Calculate realized and unrealized profit and loss
- **Cash Balance Management**: Track cash balances for each agent
- **Open Order Tracking**: Monitor pending orders awaiting execution
- **High Performance**: Implemented in Rust with JavaScript fallback

## Usage

```typescript
import { PositionManagerRust, OrderSide } from '../risk/PositionManagerRust';

// Get the singleton instance
const positionManager = PositionManagerRust.getInstance();

// Update a position based on a new order or fill
positionManager.updatePosition('agent1', {
  symbol: 'BTC-USD',
  side: OrderSide.Buy,
  size: 1.0,
  price: 50000.0,
  timestamp: Date.now(),
  orderId: 'order-123',
  fillId: 'fill-123',
  isFill: true,
  venue: 'exchange-a',
  strategyId: 'momentum-1'
});

// Get current position for a symbol
const btcPosition = positionManager.getSymbolPosition('agent1', 'BTC-USD');
console.log(`BTC Position: ${btcPosition.netSize} @ ${btcPosition.averagePrice}`);
console.log(`Realized P&L: ${btcPosition.realizedPnl}`);
console.log(`Unrealized P&L: ${btcPosition.unrealizedPnl}`);

// Get full agent position
const agentPosition = positionManager.getPosition('agent1');
console.log(`Cash Balance: ${agentPosition.cashBalance}`);
console.log(`Total Exposure: ${positionManager.calculateExposure('agent1')}`);

// Check if a new order would exceed limits
const wouldExceedLimits = positionManager.checkLimits(
  'agent1', 
  'BTC-USD', 
  OrderSide.Buy, 
  3.0
);

// Update current market price (affects unrealized P&L calculations)
positionManager.updatePrice('BTC-USD', 52000.0);

// Update configuration
positionManager.updateConfig({
  maxPositionPerSymbol: {
    'BTC-USD': 10.0
  },
  maxTotalExposure: 200000.0
});
```

## Configuration

The Position Manager can be configured with the following options:

- `maxPositionPerSymbol`: Maximum allowed position size per symbol (key-value pairs)
- `defaultMaxPosition`: Default maximum position size for symbols not specified in `maxPositionPerSymbol`
- `maxTotalExposure`: Maximum allowed total exposure across all positions
- `initialCashBalance`: Initial cash balance for new agents

## Implementation

The Position Manager is implemented in two ways:

1. **Native Rust Implementation**: High-performance implementation using Rust with NAPI bindings
2. **JavaScript Fallback**: Pure JavaScript implementation used as fallback if native code is unavailable

The system automatically selects the appropriate implementation based on availability, with priority given to the native Rust implementation for better performance.

## Integration

The Position Manager integrates with other Noderr Trading System components:

- **Order Management**: Receives order and fill updates to track positions
- **Market Data**: Uses current market prices to calculate unrealized P&L
- **Strategy Engine**: Provides position information to strategies for decision making
- **Risk Management**: Enforces risk limits and prevents excessive exposure 