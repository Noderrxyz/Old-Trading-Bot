# UniversalX Integration Guide

## Overview

The Noderr Protocol now supports UniversalX (Particle Network) as an optional cross-chain execution adapter. UniversalX provides seamless cross-chain trading capabilities through their universal account system, eliminating the need for manual bridging and reducing execution latency.

## Key Features

- **Universal Account**: Single account that works across all supported chains
- **Seamless Cross-Chain Swaps**: Execute trades across different blockchains without manual bridging
- **Optimized Routing**: Automatic selection of the best execution path
- **Lower Fees**: Reduced transaction costs through optimized routing
- **Fallback Support**: Automatic fallback to legacy adapters if UniversalX is unavailable

## Architecture

### Components

1. **UniversalXAdapter** (`src/adapters/UniversalXAdapter.ts`)
   - Implements the `ICrossChainAdapter` interface
   - Handles authentication, swap execution, and fee estimation
   - Manages session lifecycle and automatic refresh

2. **UniversalAccountService** (`src/services/UniversalAccountService.ts`)
   - Singleton service for managing the universal account
   - Monitors account health and balances
   - Provides telemetry and alerting

3. **CrossChainExecutionRouter** (Enhanced)
   - Intelligently routes trades through UniversalX or legacy adapters
   - Supports strategy-level configuration
   - Provides circuit breaker functionality

## Configuration

### Environment Variables

```bash
# UniversalX API Configuration
UNIVERSALX_API_URL=https://api.universalx.app/v1
UNIVERSALX_API_KEY=your-api-key
UNIVERSALX_API_SECRET=your-api-secret
```

### Trading Configuration

```typescript
// src/config/trading.config.ts
export const tradingConfig = {
  // Enable UniversalX globally
  enableUniversalX: true,
  
  universalXConfig: {
    environment: 'mainnet', // or 'testnet', 'sandbox'
    maxCrossChainLatency: 60000, // 60 seconds
    preferredChains: ['ethereum', 'polygon', 'arbitrum'],
    fallbackToLegacy: true // Use legacy adapters if UniversalX fails
  }
};
```

### Strategy Configuration

Individual strategies can opt-in to UniversalX:

```typescript
const strategy: StrategyParameters = {
  // Standard parameters
  riskLevel: 'medium',
  positionSizePercent: 50,
  
  // UniversalX parameters
  useUniversalX: true,
  preferredExecutionPath: 'universalx', // 'universalx' | 'legacy' | 'auto'
  crossChainEnabled: true,
  maxCrossChainLatency: 30000 // 30 seconds
};
```

## Usage

### Basic Setup

```typescript
import { UniversalXAdapter } from './adapters/UniversalXAdapter';
import { UniversalAccountService } from './services/UniversalAccountService';
import { CrossChainExecutionRouter } from './adapters/CrossChainExecutionRouter';

// 1. Create UniversalX adapter
const universalXAdapter = new UniversalXAdapter({
  apiKey: process.env.UNIVERSALX_API_KEY,
  apiSecret: process.env.UNIVERSALX_API_SECRET,
  environment: 'mainnet'
});

// 2. Initialize the adapter
await universalXAdapter.initialize();

// 3. Initialize the account service
const accountService = UniversalAccountService.getInstance();
await accountService.initialize(universalXAdapter);

// 4. Create router with UniversalX support
const router = new CrossChainExecutionRouter({
  adapters: [ethereumAdapter, polygonAdapter], // Legacy adapters
  crossChainAdapter: universalXAdapter,
  enableUniversalX: true
});
```

### Executing Cross-Chain Trades

```typescript
// Define trade request
const tradeRequest: TradeRequest = {
  fromAsset: {
    symbol: 'ETH',
    chainId: 1, // Ethereum
    decimals: 18
  },
  toAsset: {
    symbol: 'MATIC',
    chainId: 137, // Polygon
    decimals: 18
  },
  amount: '1000000000000000000', // 1 ETH
  slippageTolerance: 0.01 // 1%
};

// Execute through router (will use UniversalX if enabled)
const result = await router.executeTrade({
  strategyId: 'my-strategy',
  chainId: 1,
  tradeRequest,
  options: {
    useUniversalX: true // Override strategy setting
  }
});

if (result.success && result.usedUniversalX) {
  console.log(`Cross-chain swap executed via UniversalX: ${result.txHash}`);
}
```

### Monitoring Account Health

```typescript
// Get account health status
const health = await accountService.getHealthStatus();

if (!health.isHealthy) {
  console.warn('UniversalX account issues:', health.errors);
}

// Get account balances
const balances = await accountService.getBalances();
balances.forEach(balance => {
  console.log(`${balance.chainName}: ${balance.balance} ${balance.token}`);
});
```

## Evolutionary Strategy Support

The mutation engine now considers cross-chain execution performance when evolving strategies:

```typescript
// Strategies using UniversalX successfully get fitness bonuses for:
// - High success rate on cross-chain trades
// - Low latency execution (< 30 seconds)
// - Cost savings compared to traditional bridging
```

## Telemetry Events

The following telemetry events are emitted for monitoring:

- `adapter_initialized` - When UniversalX adapter is initialized
- `cross_chain_swap_executed` - Successful cross-chain swap
- `cross_chain_swap_failed` - Failed cross-chain swap
- `universal_account_created` - Account creation
- `universal_account_funded` - Account funding
- `universal_account_unhealthy` - Health check failures

## Security Considerations

1. **API Credentials**: Store API keys securely using environment variables
2. **Session Management**: Sessions are automatically refreshed before expiry
3. **Error Handling**: All errors are logged without exposing sensitive data
4. **Fallback Mechanism**: Automatic fallback to legacy adapters on failure

## Testing

Run the comprehensive test suite:

```bash
npm test tests/adapters/universalx.test.ts
```

The test suite covers:
- Authentication and session management
- Cross-chain swap execution
- Fee estimation
- Transaction status tracking
- Health monitoring
- Router integration
- Fallback scenarios

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   - Verify API credentials are correct
   - Check network connectivity
   - Ensure environment is set correctly

2. **Swap Failures**
   - Check account has sufficient balance
   - Verify both chains are supported and active
   - Check slippage tolerance is reasonable

3. **High Latency**
   - Monitor network conditions
   - Check UniversalX service status
   - Consider increasing timeout settings

### Debug Mode

Enable detailed logging:

```typescript
const adapter = new UniversalXAdapter({
  // ... other config
  debug: true // Enables verbose logging
});
```

## Performance Optimization

1. **Caching**: Account status and chain info are cached to reduce API calls
2. **Batch Operations**: Use batch execution for multiple trades
3. **Smart Routing**: Router automatically selects best execution path
4. **Circuit Breakers**: Prevent cascading failures

## Future Enhancements

- Support for more chains (Solana, Cosmos, etc.)
- Advanced routing algorithms
- MEV protection integration
- Limit order support
- Cross-chain arbitrage strategies

## Support

For issues or questions:
1. Check the troubleshooting guide above
2. Review test cases for usage examples
3. Contact UniversalX support for API-specific issues
4. Open an issue in the Noderr repository for integration problems 