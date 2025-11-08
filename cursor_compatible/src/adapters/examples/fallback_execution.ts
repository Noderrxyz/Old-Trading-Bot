/**
 * Fallback Execution Example
 * 
 * This example demonstrates the cross-chain fallback execution capabilities
 * of the Noderr protocol. It shows how a trade can automatically fall back
 * to alternative chains if the primary chain experiences issues.
 */

import { CrossChainExecutionRouter } from '../CrossChainExecutionRouter';
import { ExecutionSecurityLayer } from '../ExecutionSecurityLayer';
import { BlockchainTelemetry } from '../telemetry/BlockchainTelemetry';
import { CircuitBreaker } from '../telemetry/CircuitBreaker';
import { AdapterRegistry } from '../registry/AdapterRegistry';
import { ChainId, Asset, TradeRequest, TradeOptions, TradeOrder } from '../IChainAdapter';
import { EthereumAdapter } from '../EthereumAdapter';
import { ArbitrumAdapter } from '../ArbitrumAdapter';
import { PolygonAdapter } from '../PolygonAdapter';
import { AvalancheAdapter } from '../AvalancheAdapter';
import { BinanceAdapter } from '../BinanceAdapter';

/**
 * Common assets to use across chains
 */
const USDC: Asset = {
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  isNative: false,
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Ethereum USDC
  chainId: ChainId.ETHEREUM
};

const WETH: Asset = {
  symbol: 'WETH',
  name: 'Wrapped Ether',
  decimals: 18,
  isNative: false,
  address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // Ethereum WETH
  chainId: ChainId.ETHEREUM
};

/**
 * Chain-specific asset mappings
 */
const CHAIN_ASSETS = {
  [ChainId.ETHEREUM]: {
    USDC: {
      ...USDC,
      chainId: ChainId.ETHEREUM,
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    },
    WETH: {
      ...WETH,
      chainId: ChainId.ETHEREUM,
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
    }
  },
  [ChainId.ARBITRUM]: {
    USDC: {
      ...USDC,
      chainId: ChainId.ARBITRUM,
      address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'
    },
    WETH: {
      ...WETH,
      chainId: ChainId.ARBITRUM,
      address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
    }
  },
  [ChainId.POLYGON]: {
    USDC: {
      ...USDC,
      chainId: ChainId.POLYGON,
      address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
    },
    WETH: {
      ...WETH,
      chainId: ChainId.POLYGON,
      address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619'
    }
  },
  [ChainId.AVALANCHE]: {
    USDC: {
      ...USDC,
      chainId: ChainId.AVALANCHE,
      address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
    },
    WETH: {
      ...WETH,
      chainId: ChainId.AVALANCHE,
      symbol: 'WAVAX',
      name: 'Wrapped AVAX',
      address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7'
    }
  },
  [ChainId.BINANCE]: {
    USDC: {
      ...USDC,
      chainId: ChainId.BINANCE,
      address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'
    },
    WETH: {
      ...WETH,
      chainId: ChainId.BINANCE,
      symbol: 'WBNB',
      name: 'Wrapped BNB',
      address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
    }
  }
};

/**
 * Set up the adapter registry with multiple chain adapters
 */
async function setupCrossChainInfrastructure(): Promise<CrossChainExecutionRouter> {
  console.log("Setting up cross-chain infrastructure with fallback support...");
  
  // Create adapter registry
  const registry = new AdapterRegistry();
  
  // Create chain adapters with appropriate RPC endpoints
  const ethereumAdapter = new EthereumAdapter({
    chainId: ChainId.ETHEREUM,
    rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth-mainnet.alchemyapi.io/v2/your-api-key',
    privateKey: process.env.WALLET_PRIVATE_KEY || '',
    isMainnet: true,
    networkName: 'Ethereum Mainnet',
    gasMultiplier: 1.1,
    maxGasPrice: '200000000000' // 200 Gwei
  });
  
  const arbitrumAdapter = new ArbitrumAdapter({
    chainId: ChainId.ARBITRUM,
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb-mainnet.g.alchemy.com/v2/your-api-key',
    privateKey: process.env.WALLET_PRIVATE_KEY || '',
    isMainnet: true,
    networkName: 'Arbitrum One',
    sequencerStatusEndpoint: 'https://status-api.arbitrum.io/status',
    gasMultiplier: 1.2
  });
  
  const polygonAdapter = new PolygonAdapter({
    chainId: ChainId.POLYGON,
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-mainnet.g.alchemy.com/v2/your-api-key',
    privateKey: process.env.WALLET_PRIVATE_KEY || '',
    isMainnet: true,
    networkName: 'Polygon Mainnet',
    gasMultiplier: 1.5,
    maxFeePerGas: '600000000000', // 600 Gwei
    maxPriorityFeePerGas: '50000000000' // 50 Gwei
  });
  
  const avalancheAdapter = new AvalancheAdapter({
    chainId: ChainId.AVALANCHE,
    rpcUrl: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
    privateKey: process.env.WALLET_PRIVATE_KEY || '',
    isMainnet: true,
    networkName: 'Avalanche C-Chain',
    gasMultiplier: 1.2
  });
  
  const binanceAdapter = new BinanceAdapter({
    chainId: ChainId.BINANCE,
    rpcUrl: process.env.BINANCE_RPC_URL || 'https://bsc-dataseed.binance.org/',
    privateKey: process.env.WALLET_PRIVATE_KEY || '',
    isMainnet: true,
    networkName: 'Binance Smart Chain',
    gasMultiplier: 1.1
  });
  
  // Initialize the adapters
  await Promise.all([
    ethereumAdapter.initialize(),
    arbitrumAdapter.initialize(),
    polygonAdapter.initialize(),
    avalancheAdapter.initialize(),
    binanceAdapter.initialize()
  ]);
  
  // Register the adapters
  registry.registerChainAdapter(ChainId.ETHEREUM, ethereumAdapter);
  registry.registerChainAdapter(ChainId.ARBITRUM, arbitrumAdapter);
  registry.registerChainAdapter(ChainId.POLYGON, polygonAdapter);
  registry.registerChainAdapter(ChainId.AVALANCHE, avalancheAdapter);
  registry.registerChainAdapter(ChainId.BINANCE, binanceAdapter);
  
  // Create telemetry systems for each chain
  const ethereumTelemetry = new BlockchainTelemetry({
    enabled: true,
    chainId: ChainId.ETHEREUM,
    logLevel: 'info'
  });
  
  const arbitrumTelemetry = new BlockchainTelemetry({
    enabled: true,
    chainId: ChainId.ARBITRUM,
    logLevel: 'info'
  });
  
  const polygonTelemetry = new BlockchainTelemetry({
    enabled: true,
    chainId: ChainId.POLYGON,
    logLevel: 'info'
  });
  
  const avalancheTelemetry = new BlockchainTelemetry({
    enabled: true,
    chainId: ChainId.AVALANCHE,
    logLevel: 'info'
  });
  
  const binanceTelemetry = new BlockchainTelemetry({
    enabled: true,
    chainId: ChainId.BINANCE,
    logLevel: 'info'
  });
  
  // Create circuit breakers for each chain
  const ethereumCircuitBreaker = new CircuitBreaker({
    name: 'EthereumCircuitBreaker',
    errorThreshold: 50, // Percentage of failures that will trip the circuit
    resetTimeout: 30000, // 30 seconds until trying to recover
    rollingWindowSize: 10 // Number of requests to track
  });
  
  const arbitrumCircuitBreaker = new CircuitBreaker({
    name: 'ArbitrumCircuitBreaker',
    errorThreshold: 50,
    resetTimeout: 30000,
    rollingWindowSize: 10
  });
  
  const polygonCircuitBreaker = new CircuitBreaker({
    name: 'PolygonCircuitBreaker',
    errorThreshold: 50,
    resetTimeout: 30000,
    rollingWindowSize: 10
  });
  
  const avalancheCircuitBreaker = new CircuitBreaker({
    name: 'AvalancheCircuitBreaker',
    errorThreshold: 50,
    resetTimeout: 30000,
    rollingWindowSize: 10
  });
  
  const binanceCircuitBreaker = new CircuitBreaker({
    name: 'BinanceCircuitBreaker',
    errorThreshold: 50,
    resetTimeout: 30000,
    rollingWindowSize: 10
  });
  
  // Create security layers for each chain with appropriate settings
  const ethereumSecurity = new ExecutionSecurityLayer({
    slippageProtection: {
      defaultTolerance: 0.5,
      maxTolerance: 2.0,
      enablePriceChecking: true,
      timeBound: 300000 // 5 minutes
    },
    mevProtection: {
      enabled: true
    }
  });
  
  const arbitrumSecurity = new ExecutionSecurityLayer({
    slippageProtection: {
      defaultTolerance: 0.5,
      maxTolerance: 2.0,
      enablePriceChecking: true,
      timeBound: 300000
    },
    mevProtection: {
      enabled: true
    }
  });
  
  const polygonSecurity = new ExecutionSecurityLayer({
    slippageProtection: {
      defaultTolerance: 0.7, // Higher tolerance for Polygon volatility
      maxTolerance: 2.5,
      enablePriceChecking: true,
      timeBound: 300000
    },
    mevProtection: {
      enabled: true
    }
  });
  
  const avalancheSecurity = new ExecutionSecurityLayer({
    slippageProtection: {
      defaultTolerance: 0.6,
      maxTolerance: 2.2,
      enablePriceChecking: true,
      timeBound: 300000
    },
    mevProtection: {
      enabled: true
    }
  });
  
  const binanceSecurity = new ExecutionSecurityLayer({
    slippageProtection: {
      defaultTolerance: 0.5,
      maxTolerance: 2.0,
      enablePriceChecking: true,
      timeBound: 300000
    },
    mevProtection: {
      enabled: true
    }
  });
  
  // Create cross-chain execution router with fallback support
  const router = new CrossChainExecutionRouter({
    adapters: [
      // Ethereum as primary chain
      {
        adapter: ethereumAdapter,
        telemetry: ethereumTelemetry,
        circuitBreaker: ethereumCircuitBreaker,
        security: ethereumSecurity,
        priority: 1
      },
      // Arbitrum as first fallback
      {
        adapter: arbitrumAdapter,
        telemetry: arbitrumTelemetry,
        circuitBreaker: arbitrumCircuitBreaker,
        security: arbitrumSecurity,
        priority: 2
      },
      // Polygon as second fallback
      {
        adapter: polygonAdapter,
        telemetry: polygonTelemetry,
        circuitBreaker: polygonCircuitBreaker,
        security: polygonSecurity,
        priority: 3
      },
      // Avalanche as third fallback
      {
        adapter: avalancheAdapter,
        telemetry: avalancheTelemetry,
        circuitBreaker: avalancheCircuitBreaker,
        security: avalancheSecurity,
        priority: 4
      },
      // Binance as final fallback
      {
        adapter: binanceAdapter,
        telemetry: binanceTelemetry,
        circuitBreaker: binanceCircuitBreaker,
        security: binanceSecurity,
        priority: 5
      }
    ],
    fallbackEnabled: true,
    maxFallbacks: 4, // Try all fallback chains
    // Define error scenarios that should trigger fallback
    errorCasesEligibleForFallback: [
      'rpc_error',
      'gas_too_high',
      'timeout',
      'network_congestion',
      'transaction_underpriced',
      'insufficient_funds',
      'rate_limit_exceeded',
      'nonce_too_low'
    ]
  });
  
  // Initialize the router
  await router.initialize();
  console.log("Cross-chain infrastructure with fallback support is ready");
  
  return router;
}

/**
 * Example of a trade with automatic fallback
 */
async function executeTradWithFallback() {
  try {
    // Set up the cross-chain infrastructure
    const router = await setupCrossChainInfrastructure();
    
    // Create a trade request using USDC -> WETH on Ethereum (will map to appropriate assets on other chains)
    const tradeRequest: TradeRequest = {
      fromAsset: CHAIN_ASSETS[ChainId.ETHEREUM].USDC,
      toAsset: CHAIN_ASSETS[ChainId.ETHEREUM].WETH,
      amount: '1000000000', // 1000 USDC (6 decimals)
      slippageTolerance: 0.5,
      deadline: Math.floor(Date.now() / 1000) + 60 * 20 // 20 minutes
    };
    
    // Define trade options with MEV protection
    const tradeOptions: TradeOptions = {
      gasLimit: BigInt(350000),
      waitForConfirmation: true,
      confirmations: 1,
      mevProtection: true
    };
    
    console.log(`Executing trade: ${tradeRequest.amount} ${tradeRequest.fromAsset.symbol} -> ${tradeRequest.toAsset.symbol}`);
    console.log("Primary chain: Ethereum");
    console.log("Fallback chains: Arbitrum, Polygon, Avalanche, Binance");
    
    // Execute the trade with automatic fallback if needed
    const result = await router.executeTrade(tradeRequest, tradeOptions);
    
    if (result.success) {
      console.log(`Trade execution successful on ${result.networkName} (Chain ID: ${result.chainId})`);
      console.log(`Transaction hash: ${result.txHash}`);
      console.log(`Output amount: ${result.amountOut} ${tradeRequest.toAsset.symbol}`);
      
      if (result.fallbacksAttempted && result.fallbacksAttempted > 0) {
        console.log(`Fallbacks attempted: ${result.fallbacksAttempted}`);
        console.log(`Original error: ${result.originalError}`);
      }
      
      if (result.mevProtectionApplied) {
        console.log("MEV protection was applied");
      }
    } else {
      console.error("Trade execution failed on all chains");
      console.error(`Reason: ${result.failureReason}`);
      console.error(`Fallbacks attempted: ${result.fallbacksAttempted}`);
    }
    
    // Shutdown the router and adapters
    await router.shutdown();
  } catch (error) {
    console.error("Fatal error in trade execution:", error);
  }
}

// Run the example if executed directly
if (require.main === module) {
  executeTradWithFallback().catch(console.error);
}

export {
  setupCrossChainInfrastructure,
  executeTradWithFallback,
  CHAIN_ASSETS
}; 