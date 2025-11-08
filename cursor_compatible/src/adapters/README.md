# Noderr Protocol Blockchain Adapter System

The Noderr Protocol Blockchain Adapter System provides a unified interface for interacting with multiple blockchain networks. This modular and extensible system enables seamless cross-chain execution, asset data retrieval, and MEV protection while maintaining consistent error handling, telemetry, and performance metrics.

## Architecture

The adapter system is built around these core components:

1. **Core Interfaces**
   - `IAdapter` - Base interface for all adapters
   - `IChainAdapter` - Extended interface specifically for blockchain adapters
   - `IAssetAdapter` - Extended interface for asset data (tokens, NFTs, prices)
   - `BaseChainAdapter` - Abstract base implementation with common functionality
   - `BaseAssetAdapter` - Abstract base implementation for asset adapters

2. **Concrete Adapters**
   - Chain-specific implementations (Ethereum, Avalanche, Polygon, Arbitrum, Binance, etc.)
   - Asset-specific implementations (CoinGecko, CoinMarketCap, Moralis, etc.)
   - Each adapter handles specific details while adhering to a consistent interface

3. **Cross-Chain Infrastructure**
   - `CrossChainExecutionRouter` - Routes execution across multiple chains
   - `CrossChainTransactionFormatter` - Standardizes transaction formats
   - `ExecutionSecurityLayer` - Provides MEV protection and slippage guards

4. **Telemetry Integration**
   - `BlockchainTelemetry` - Records performance metrics, errors, and operational statistics
   - `CircuitBreaker` - Provides circuit breaking for resilience
   - Integrates with Prometheus for monitoring and alerting

## Features

- **Multi-Chain Support**: Unified interface for all major EVM-compatible blockchains
- **Cross-Chain Execution**: Execute strategies across multiple chains with fallbacks
- **Asset Data**: Price data, historical charts, and token metadata from multiple sources
- **MEV Protection**: Built-in support for Flashbots and other MEV protection mechanisms
- **Advanced Reliability**: Circuit breakers, retry mechanisms, and fallback systems
- **Comprehensive Telemetry**: Metrics for RPC calls, gas prices, trade execution, and more
- **Flexible Configuration**: Chain-specific configuration with sensible defaults
- **Rate Limiting**: Built-in rate limiting for strategies and adapters
- **Type Safety**: Full TypeScript support with strict typing

## Quick Start

### Basic Usage

```typescript
import { EthereumAdapter, ChainId } from './adapters';
import { ethers } from 'ethers';

// Create an Ethereum adapter
const ethereumAdapter = new EthereumAdapter({
  rpcUrl: 'https://mainnet.infura.io/v3/YOUR_API_KEY',
  chainId: ChainId.ETHEREUM,
  privateKey: process.env.PRIVATE_KEY || ethers.Wallet.createRandom().privateKey
});

// Initialize the adapter
await ethereumAdapter.initialize();

// Get chain info
const chainInfo = ethereumAdapter.getChainInfo();
console.log(`Connected to ${chainInfo.name} (Chain ID: ${chainInfo.chainId})`);

// Get network status
const status = await ethereumAdapter.getNetworkStatus();
console.log(`Latest block: ${status.latestBlock}, Gas price: ${Number(status.gasPrice) / 1e9} gwei`);
```

### Using Asset Adapters

```typescript
import { CoinGeckoAdapter } from './adapters';
import { ChainId } from './adapters';

// Create and configure CoinGecko adapter
const assetAdapter = new CoinGeckoAdapter({
  supportedChains: [ChainId.ETHEREUM, ChainId.AVALANCHE],
  cacheTimeout: 5 * 60 * 1000 // 5 minutes
});

// Initialize adapter
await assetAdapter.initialize({});

// Get token price
const ethPrice = await assetAdapter.getTokenPrice('ETH', ChainId.ETHEREUM);
console.log(`ETH Price: $${ethPrice.priceUsd} USD`);

// Get historical data
const historicalPrices = await assetAdapter.getHistoricalPrices(
  'ETH', 
  ChainId.ETHEREUM, 
  { interval: '1d', limit: 7 }
);
console.log('Historical prices:', historicalPrices);
```

### Using the Cross-Chain Execution Router

```typescript
import { 
  EthereumAdapter, 
  PolygonAdapter, 
  CoinGeckoAdapter,
  CrossChainExecutionRouter,
  BlockchainTelemetry,
  ChainId
} from './adapters';

// Setup telemetry
const telemetry = new BlockchainTelemetry({
  enabled: true,
  circuitBreakers: { enabled: true }
});

// Initialize adapters
const ethereumAdapter = new EthereumAdapter({
  rpcUrl: 'https://ethereum.rpc.com',
  chainId: ChainId.ETHEREUM,
  privateKey: process.env.ETH_PRIVATE_KEY,
  telemetry
});

const polygonAdapter = new PolygonAdapter({
  rpcUrl: 'https://polygon.rpc.com',
  chainId: ChainId.POLYGON,
  privateKey: process.env.POLYGON_PRIVATE_KEY,
  telemetry
});

await ethereumAdapter.initialize();
await polygonAdapter.initialize();

// Create router with strategies
const router = new CrossChainExecutionRouter({
  adapters: [ethereumAdapter, polygonAdapter],
  strategies: [{
    id: 'arb-strategy',
    name: 'Arbitrage Strategy',
    chains: [ChainId.ETHEREUM, ChainId.POLYGON],
    enabled: true,
    fallbacks: [
      { chainId: ChainId.ETHEREUM, priority: 1 }
    ]
  }],
  telemetry,
  enableCircuitBreakers: true
});

// Execute cross-chain trade
const result = await router.executeTrade({
  strategyId: 'arb-strategy',
  chainId: ChainId.POLYGON,
  tradeRequest: {
    // Trade details...
    fromAsset: { symbol: 'USDC', /* ... */ },
    toAsset: { symbol: 'WETH', /* ... */ },
    inputAmount: '1000000000',
    slippageTolerance: 0.5
  },
  options: {
    fallbackEnabled: true,
    maxRetries: 2
  }
});

console.log(`Trade execution: ${result.success ? 'Success' : 'Failed'}`);
if (result.success) {
  console.log(`Transaction hash: ${result.txHash}`);
}
```

## Supported Adapters

### Blockchain Adapters

| Chain | Chain ID | Adapter | Features |
|-------|----------|---------|----------|
| Ethereum Mainnet | 1 | EthereumAdapter | EIP-1559, MEV Protection |
| BNB Chain | 56 | BinanceAdapter | MEV Protection |
| Polygon | 137 | PolygonAdapter | EIP-1559 |
| Avalanche | 43114 | AvalancheAdapter | EIP-1559 |
| Arbitrum | 42161 | ArbitrumAdapter | Sequencer status |
| Optimism | 10 | OptimismAdapter (coming soon) | |
| Base | 8453 | BaseAdapter (coming soon) | |
| Fantom | 250 | FantomAdapter (coming soon) | |

### Asset Adapters

| Data Source | Adapter | Features |
|-------------|---------|----------|
| CoinGecko | CoinGeckoAdapter | Token prices, historical data, metadata |
| CoinMarketCap | CoinMarketCapAdapter | Token prices, market data |
| Moralis | MoralisAdapter | Token balances, NFTs, transfers |
| OpenSea | OpenSeaAdapter (coming soon) | NFT data, collections, trading |
| Alchemy | AlchemyAdapter (coming soon) | NFT data, token metadata |

## Adapter Capabilities

Each adapter can report its capabilities using the `getCapabilities()` method.

### Chain Adapter Capabilities

- `BALANCE_QUERY` - Get token balances
- `TRADE_EXECUTION` - Execute trades
- `TRANSACTION_STATUS` - Check transaction status
- `MEV_PROTECTION` - MEV protection support
- `GAS_ESTIMATION` - Gas price estimation
- `FEE_MARKET` - EIP-1559 support
- `MULTICALL` - Batch query support
- `TOKEN_TRANSFER` - Token transfer support
- `NFT_SUPPORT` - NFT support

### Asset Adapter Capabilities

- `TOKEN_PRICE` - Get token prices
- `TOKEN_METADATA` - Get token metadata
- `HISTORICAL_PRICES` - Get historical price data
- `NFT_METADATA` - Get NFT metadata
- `NFT_COLLECTION` - Get NFT collection data
- `DEFI_PROTOCOL` - Get DeFi protocol data
- `TOKEN_SEARCH` - Search for tokens
- `NFT_SEARCH` - Search for NFT collections
- `MARKET_DATA` - Get market data
- `WATCHLIST` - User watchlist support
- `PORTFOLIO` - User portfolio support

## Cross-Chain Execution

The cross-chain execution infrastructure consists of several key components:

### CrossChainExecutionRouter

Routes trade requests to the appropriate chain adapters with support for:

- Strategy-based routing
- Circuit breaker protection
- Automatic fallbacks to alternative chains
- Rate limiting
- Batch execution

### CrossChainTransactionFormatter

Standardizes transaction formats across chains:

- Unified asset representation
- Chain-specific formatting
- Token decimals normalization
- Gas parameter handling

### ExecutionSecurityLayer

Provides security features:

- MEV protection via Flashbots
- Slippage protection
- Rate limiting
- Multi-sig validation
- Time-bounded execution

## Advanced Features

### MEV Protection

```typescript
// Configure ExecutionSecurityLayer with Flashbots
const securityLayer = new ExecutionSecurityLayer({
  flashbots: {
    enabled: true,
    relayUrls: {
      [ChainId.ETHEREUM]: 'https://relay.flashbots.net'
    }
  },
  slippageProtection: {
    defaultTolerance: 0.5,
    maxTolerance: 5
  }
});

// Send a protected transaction
const protectedTx = await securityLayer.sendProtectedTransaction(
  ethereumAdapter,
  transaction
);
```

### Circuit Breakers

```typescript
// Check circuit breaker status
const cbStatus = telemetry.getCircuitBreakerStatus('EthereumAdapter');

if (cbStatus.state === CircuitBreakerState.OPEN) {
  console.log('Circuit breaker is open!');
  console.log(`Failures: ${cbStatus.failureCount}`);
  console.log(`Will retry at: ${new Date(cbStatus.nextRetry || 0).toISOString()}`);
} else {
  console.log('Circuit breaker is closed, operations normal');
}

// Reset circuit breaker
telemetry.resetCircuitBreaker('EthereumAdapter');
```

### Cross-Chain Batch Execution

```typescript
// Execute operations across multiple chains in one call
const batchResult = await router.executeBatch({
  strategyId: 'yield-strategy',
  trades: [
    {
      chainId: ChainId.ETHEREUM,
      tradeRequest: { /* Ethereum trade details */ }
    },
    {
      chainId: ChainId.POLYGON,
      tradeRequest: { /* Polygon trade details */ }
    }
  ],
  options: {
    sequential: true,
    abortOnFailure: true
  }
});

console.log(`Batch execution: ${batchResult.allSucceeded ? 'All succeeded' : 'Some failed'}`);
console.log(`Results:`, batchResult.results);
```

## Telemetry Metrics

The adapter system automatically records these metrics:

- **Cross-Chain Metrics**
  - `cross_chain_execution_total` - Cross-chain executions
  - `cross_chain_execution_success_rate` - Success rate
  - `cross_chain_fallback_total` - Fallback usage

- **Chain Status**
  - `blockchain_connection_status` - Connection status (0 or 1)
  - `blockchain_block_height` - Current block height
  - `blockchain_gas_price_gwei` - Current gas price

- **MEV Protection**
  - `mev_protection_attempts_total` - Protection attempts
  - `mev_protection_success_rate` - Success rate
  - `mev_protection_latency_ms` - Latency

- **Circuit Breakers**
  - `circuit_breaker_state` - Circuit breaker state
  - `circuit_breaker_trips_total` - Trip count
  - `circuit_breaker_recovery_time_ms` - Recovery time

## Examples

For more detailed examples, see:

- [Cross-Chain Execution Example](./examples/cross_chain_execution.ts)
- [Asset Adapter Example](./examples/asset-adapter-example.ts)
- [MEV Protection Example](./examples/mev_protection_example.ts) (coming soon)

## Extending the System

### Creating a Custom Chain Adapter

```typescript
import { BaseChainAdapter, ChainId, AdapterCapability } from './adapters';

export class MyCustomAdapter extends BaseChainAdapter {
  constructor(config) {
    super({
      chain: {
        chainId: 999,
        name: "My Custom Chain",
        nativeCurrency: {
          name: "Custom Coin",
          symbol: "CST",
          decimals: 18
        }
      },
      providerUrl: config.rpcUrl,
      privateKey: config.privateKey
    });
    
    this._name = 'MyCustomAdapter';
    this._version = '1.0.0';
    
    // Register capabilities
    this.addCapability(AdapterCapability.BALANCE_QUERY);
    this.addCapability(AdapterCapability.TOKEN_TRANSFER);
  }
  
  // Implement required methods...
  public async getGasPrice(): Promise<bigint> {
    // Custom implementation
  }
  
  public async estimateGas(transaction: TransactionRequest): Promise<bigint> {
    // Custom implementation
  }
  
  // Additional custom functionality...
}
```

### Creating a Custom Asset Adapter

```typescript
import { BaseAssetAdapter, AssetAdapterConfig, AssetAdapterCapability } from './adapters';

export class MyCustomAssetAdapter extends BaseAssetAdapter {
  constructor(config) {
    super({
      supportedChains: [ChainId.ETHEREUM, ChainId.POLYGON],
      apiKey: config.apiKey,
      ...config
    });
    
    this._name = 'MyCustomAssetAdapter';
    this._version = '1.0.0';
    
    // Register capabilities
    this.addCapability(AssetAdapterCapability.TOKEN_PRICE);
    this.addCapability(AssetAdapterCapability.HISTORICAL_PRICES);
  }
  
  // Implement required methods...
  protected async initializeImpl(): Promise<void> {
    // Custom initialization logic
  }
  
  public async getTokenPrice(symbol: string, chainId: number, address?: string): Promise<TokenPrice> {
    // Custom implementation
  }
  
  // Additional methods...
}
```

## Best Practices

1. **Use The Cross-Chain Router**: Centralize execution with CrossChainExecutionRouter
2. **Enable Telemetry and Circuit Breakers**: Always use telemetry for production systems
3. **Handle RPC Errors**: Plan for intermittent RPC failures with retries and fallbacks
4. **Slippage Protection**: Always set reasonable slippage tolerances for trades
5. **Custom RPC URLs**: Use dedicated RPC endpoints for production
6. **Security Layer**: Use ExecutionSecurityLayer for MEV protection
7. **Asset Adapter Fallbacks**: Configure multiple asset adapters for redundancy 