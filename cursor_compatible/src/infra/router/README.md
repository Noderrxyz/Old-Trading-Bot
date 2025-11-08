# Smart Order Router

## Overview

The Smart Order Router (SOR) is a crucial component of the trade execution system, designed to optimize order execution across multiple decentralized exchanges (DEXs) by considering:

- **Slippage estimation** based on order size and liquidity depth
- **Gas costs** for transaction execution
- **Venue trust scores** based on historical performance
- **Liquidity depth** for each trading pair

By dynamically analyzing these factors, the SOR selects the most cost-effective and reliable route for order execution.

## Architecture

The SOR consists of these key components:

### Core Components

1. **SmartOrderRouter** (`SmartOrderRouter.ts`)
   - Main router implementation that fetches quotes, scores routes, and selects the optimal execution venue
   - Handles caching of quotes to reduce network requests
   - Manages execution style selection based on order parameters

2. **DEX Venue Implementations**
   - `UniswapVenue.ts` - Execution adapter for Uniswap V3
   - `SushiswapVenue.ts` - Execution adapter for Sushiswap

3. **Trust Engine** (`TrustEngine.ts`)
   - Provides trust scores for venues based on historical performance
   - Helps the router make reliability-aware routing decisions

### Integration with Existing Systems

The SOR integrates with these existing components:

- **Execution Router**: The SOR can be used alongside or as a replacement for the existing `ExecutionRouter` when DEX execution is needed
- **Venue Registry**: Uses the same `ExecutionVenue` interface for compatibility
- **Fusion Memory**: Can update execution feedback to improve future routing decisions

## Key Features

### 1. Real-time Quote Aggregation

The SOR fetches quotes from multiple DEXs simultaneously, providing a comprehensive view of available liquidity and pricing:

```typescript
// Get quotes from all eligible venues
const quotes = await this.getQuotesFromVenues(order, eligibleVenues);
```

### 2. Slippage Estimation

Accurately estimates slippage based on order size and liquidity depth for each venue:

```typescript
// Calculate simulated slippage based on order size
const orderSizeUsd = order.quantity * basePrice;
let priceImpactPct = 0.1 + (orderSizeUsd / 100000) * (0.5 + Math.random() * 0.5);
```

### 3. Gas Cost Optimization

Considers gas costs in the routing decision, especially important during high network congestion:

```typescript
// Calculate gas cost in USD
const gasCostEth = (gasPriceGwei * 1e-9) * estimatedGas;
const gasCostUsd = gasCostEth * ethUsdPrice;
```

### 4. Multi-factor Route Scoring

Scores routes based on multiple weighted factors to find the best overall execution path:

```typescript
// Calculate weighted total score
const totalScore = 
  (slippageScore * this.config.weights.slippage) +
  (gasScore * this.config.weights.gas) +
  (trustScore * this.config.weights.trust) +
  (liquidityScore * this.config.weights.liquidity);
```

### 5. Adaptive Execution Styles

Automatically selects the appropriate execution style based on order parameters and market conditions:

```typescript
// High urgency always uses aggressive style
if (order.urgency === 'high') {
  return ExecutionStyle.Aggressive;
}

// Use TWAP for higher impact orders
if (quote.priceImpact > 2) {
  return ExecutionStyle.TWAP;
}
```

## Usage

### Basic Usage

```typescript
// Create the Smart Order Router
const router = new SmartOrderRouter(venues, trustEngine, fusionMemory, config);

// Route an order to find the best venue
const routingResult = await router.route(orderIntent);

// Execute the order on the selected venue
const executedOrder = await router.execute(orderIntent);
```

### Configuration

The SOR is highly configurable to adapt to different trading strategies and market conditions:

```typescript
const config: SmartOrderRouterConfig = {
  enabledDexes: ['uniswap_v3', 'sushiswap', '0x_api', 'curve'],
  considerGasCosts: true,
  weights: {
    slippage: 0.5,
    gas: 0.25,
    trust: 0.15,
    liquidity: 0.1
  },
  // Additional configuration parameters...
};
```

## Extension

The SOR is designed to be extensible. To add support for a new DEX:

1. Implement the `ExecutionVenue` interface for the new DEX
2. Register the venue in your application setup
3. Add the venue ID to the `enabledDexes` array in the SOR configuration

## Future Improvements

- **Advanced gas optimization** with EIP-1559 support
- **Cross-chain routing** for multi-chain DEX aggregation
- **MEV protection** mechanisms to prevent sandwich attacks
- **Route splitting** to handle large orders across multiple venues

---

For more information on implementation details, refer to the inline documentation in the source code. 