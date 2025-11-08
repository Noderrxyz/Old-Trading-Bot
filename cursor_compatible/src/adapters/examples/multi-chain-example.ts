/**
 * Multi-Chain Example with Enhanced Adapter Registry
 * 
 * This example demonstrates how to use the adapter registry with multiple chains,
 * telemetry integration, and error handling.
 */

// Import adapter infrastructure
import { 
  ChainId, 
  createAdapter, 
  getDefaultRpcUrl, 
  getBlockExplorerUrl,
  getChainName,
  isTestnet
} from '../index';

// Import telemetry integration
import { createEnhancedAdapter } from '../telemetry/BlockchainTelemetry';

// Import adapter registry for centralized management
import { AdapterRegistry } from '../registry/AdapterRegistry';

// Import types
import { TradeOrder, Asset, ExecutionStrategy } from '../IChainAdapter';

/**
 * Example of setting up and using a multi-chain adapter registry
 */
async function main() {
  console.log('Initializing Multi-Chain Example');
  
  // Create and configure the adapter registry
  const registry = new AdapterRegistry({
    autoInitialize: true,
    metricsEnabled: true,
    maxRetries: 3,
    retryBaseDelayMs: 1000,
    circuitBreakerThreshold: 5,
    logger: (message: string, context?: any) => {
      console.log(`[Registry] ${message}`, context ? JSON.stringify(context) : '');
    }
  });
  
  try {
    // Register multiple chains with enhanced telemetry
    await registerChains(registry);
    
    // Initialize all adapters
    await registry.initialize();
    
    // Connect to all chains
    await connectToChains(registry);
    
    // Get registry status
    const status = await registry.getStatus();
    console.log('Registry Status:', JSON.stringify(status, null, 2));
    
    // Perform cross-chain operations
    await performSampleOperations(registry);
    
    // Get metrics
    const metrics = registry.getMetrics();
    console.log('Registry Metrics:', JSON.stringify(metrics, null, 2));
    
  } catch (error) {
    console.error('Error in multi-chain example:', error);
  } finally {
    // Clean shutdown
    await registry.shutdown();
    console.log('Registry shut down successfully');
  }
}

/**
 * Register multiple chains with the registry
 */
async function registerChains(registry: AdapterRegistry): Promise<void> {
  // Define chains to register
  const chains = [
    ChainId.ETHEREUM,
    ChainId.AVALANCHE,
    ChainId.POLYGON,
    ChainId.BINANCE_SMART_CHAIN,
    ChainId.ARBITRUM
  ];
  
  for (const chainId of chains) {
    try {
      // Create base adapter with default configuration
      const baseConfig = {
        chainId,
        rpcUrl: getDefaultRpcUrl(chainId),
        networkName: getChainName(chainId),
        isMainnet: !isTestnet(chainId),
        blockExplorerUrl: getBlockExplorerUrl(chainId)
      };
      
      // Create the adapter
      const adapter = createAdapter(chainId, baseConfig);
      
      // Enhance with telemetry
      const enhancedAdapter = createEnhancedAdapter(adapter);
      
      // Register with the registry
      registry.registerAdapter(chainId, enhancedAdapter);
      
      console.log(`Registered ${getChainName(chainId)} (ID: ${chainId})`);
    } catch (error) {
      console.error(`Failed to register chain ${chainId}:`, error);
    }
  }
}

/**
 * Connect to all registered chains
 */
async function connectToChains(registry: AdapterRegistry): Promise<void> {
  const chains = registry.getSupportedChains();
  
  // Connect to each chain
  for (const chainId of chains) {
    try {
      // Get the adapter
      const adapter = registry.getAdapter(chainId);
      if (!adapter) {
        console.warn(`No adapter found for chain ${chainId}`);
        continue;
      }
      
      // Connect to the chain
      await adapter.connect();
      
      // Get chain status
      const status = await adapter.getStatus();
      console.log(`Connected to ${status.networkName} (Block: ${status.blockHeight})`);
      
    } catch (error) {
      console.error(`Failed to connect to chain ${chainId}:`, error);
    }
  }
}

/**
 * Perform sample operations across chains
 */
async function performSampleOperations(registry: AdapterRegistry): Promise<void> {
  // Sample Ethereum wallet address
  const sampleAddress = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
  
  // Check balance across chains
  await checkBalances(registry, sampleAddress);
  
  // Get gas prices across chains
  await getGasPrices(registry);
  
  // Simulate a cross-chain trade quote
  await simulateTradeQuote(registry);
}

/**
 * Check balances across all chains
 */
async function checkBalances(registry: AdapterRegistry, address: string): Promise<void> {
  console.log(`\nChecking balances for ${address}:`);
  
  const chains = registry.getSupportedChains();
  
  for (const chainId of chains) {
    try {
      // Get native token balance
      const balance = await registry.getBalance(chainId, address);
      console.log(`- ${getChainName(chainId)}: ${balance}`);
      
    } catch (error) {
      console.error(`Failed to get balance for chain ${chainId}:`, error);
    }
  }
}

/**
 * Get gas prices across all chains
 */
async function getGasPrices(registry: AdapterRegistry): Promise<void> {
  console.log('\nCurrent gas prices:');
  
  const chains = registry.getSupportedChains();
  
  for (const chainId of chains) {
    try {
      // Get adapter for the chain
      const adapter = registry.getAdapter(chainId);
      if (!adapter) continue;
      
      // Get gas price estimates
      const gasPrice = await adapter.getGasPrice();
      
      console.log(`- ${getChainName(chainId)}:`);
      console.log(`  Slow: ${gasPrice.slow.gasPrice || gasPrice.slow.maxFeePerGas || 'N/A'}`);
      console.log(`  Average: ${gasPrice.average.gasPrice || gasPrice.average.maxFeePerGas || 'N/A'}`);
      console.log(`  Fast: ${gasPrice.fast.gasPrice || gasPrice.fast.maxFeePerGas || 'N/A'}`);
      
    } catch (error) {
      console.error(`Failed to get gas price for chain ${chainId}:`, error);
    }
  }
}

/**
 * Simulate getting a trade quote
 */
async function simulateTradeQuote(registry: AdapterRegistry): Promise<void> {
  console.log('\nSimulating trade quotes:');
  
  // Define sample assets for each chain
  const assets: Record<number, [Asset, Asset]> = {
    [ChainId.ETHEREUM]: [
      { 
        symbol: 'ETH', 
        name: 'Ethereum', 
        decimals: 18, 
        chainId: ChainId.ETHEREUM, 
        isNative: true,
        coingeckoId: 'ethereum',
        usdPrice: 2500
      },
      { 
        symbol: 'USDC', 
        name: 'USD Coin', 
        decimals: 6, 
        chainId: ChainId.ETHEREUM, 
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        coingeckoId: 'usd-coin',
        usdPrice: 1
      }
    ],
    [ChainId.AVALANCHE]: [
      { 
        symbol: 'AVAX', 
        name: 'Avalanche', 
        decimals: 18, 
        chainId: ChainId.AVALANCHE, 
        isNative: true,
        coingeckoId: 'avalanche-2',
        usdPrice: 30
      },
      { 
        symbol: 'USDC', 
        name: 'USD Coin', 
        decimals: 6, 
        chainId: ChainId.AVALANCHE, 
        address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
        coingeckoId: 'usd-coin',
        usdPrice: 1
      }
    ],
    [ChainId.POLYGON]: [
      { 
        symbol: 'MATIC', 
        name: 'Polygon', 
        decimals: 18, 
        chainId: ChainId.POLYGON, 
        isNative: true,
        coingeckoId: 'matic-network',
        usdPrice: 0.8
      },
      { 
        symbol: 'USDC', 
        name: 'USD Coin', 
        decimals: 6, 
        chainId: ChainId.POLYGON, 
        address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
        coingeckoId: 'usd-coin',
        usdPrice: 1
      }
    ]
  };
  
  // Get quotes for each chain
  for (const chainId of Object.keys(assets).map(Number)) {
    try {
      const [fromAsset, toAsset] = assets[chainId];
      const amount = "1.0"; // 1 native token
      
      console.log(`- ${getChainName(chainId)}: ${fromAsset.symbol} -> ${toAsset.symbol}`);
      
      // Get adapter
      const adapter = registry.getAdapter(chainId);
      if (!adapter) {
        console.warn(`No adapter found for chain ${chainId}`);
        continue;
      }
      
      // Get quote
      const quote = await adapter.getQuote(fromAsset, toAsset, amount);
      
      console.log(`  Expected output: ${quote.expectedOutput} ${toAsset.symbol}`);
      console.log(`  Price impact: ${quote.priceImpact.toFixed(2)}%`);
      if (quote.route) {
        console.log(`  Route: ${quote.route.join(' -> ')}`);
      }
      
      // Simulate a trade execution (without actually doing it)
      await simulateTradeExecution(registry, chainId, fromAsset, toAsset, amount);
      
    } catch (error) {
      console.error(`Failed to get quote for chain ${chainId}:`, error);
    }
  }
}

/**
 * Simulate a trade execution (without actually executing it)
 */
async function simulateTradeExecution(
  registry: AdapterRegistry, 
  chainId: number, 
  fromAsset: Asset, 
  toAsset: Asset, 
  amount: string
): Promise<void> {
  try {
    // Get adapter
    const adapter = registry.getAdapter(chainId);
    if (!adapter) return;
    
    // Create a mock trade order
    const tradeOrder: TradeOrder = {
      id: `order-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      fromAsset,
      toAsset,
      amount,
      slippageTolerance: 0.5, // 0.5% slippage tolerance
      timestamp: Date.now(),
      status: 'pending',
      mevProtection: true,
      executionStrategy: ExecutionStrategy.MARKET
    };
    
    // For simulation, we'll just call checkHealth instead of actually executing the trade
    const health = await adapter.checkHealth();
    
    console.log(`  Chain health check: ${health.healthy ? 'Healthy' : 'Unhealthy'}`);
    console.log(`  Block delay: ${health.blockDelay} seconds`);
    console.log(`  Latency: ${health.latency}ms`);
    
    if (health.healthy) {
      console.log(`  Trade simulation successful (would execute on ${getChainName(chainId)})`);
    } else {
      console.log(`  Trade simulation failed: ${health.errors?.join(', ') || 'Unknown error'}`);
    }
    
  } catch (error) {
    console.error(`Trade simulation error:`, error);
  }
}

// Run the example if this script is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

// Export for testing
export { main, registerChains, connectToChains, performSampleOperations }; 