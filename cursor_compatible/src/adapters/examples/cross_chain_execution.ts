/**
 * Cross-Chain Execution Example
 * 
 * This example demonstrates how to use the cross-chain execution infrastructure
 * to route trade requests across multiple blockchain networks.
 */

import { 
  EthereumAdapter, 
  PolygonAdapter, 
  ArbitrumAdapter, 
  BinanceAdapter,
  AvalancheAdapter,
  ChainId, 
  CoinGeckoAdapter,
  CrossChainExecutionRouter,
  CrossChainTransactionFormatter,
  ExecutionSecurityLayer,
  BlockchainTelemetry,
  Strategy
} from '../index';

import { ethers } from 'ethers';

/**
 * Main example function
 */
async function main() {
  console.log('Initializing Cross-Chain Execution Example');
  
  // Step 1: Set up telemetry
  const telemetry = new BlockchainTelemetry({
    enabled: true,
    detailedLogging: true,
    circuitBreakers: {
      enabled: true,
      config: {
        failureThreshold: 3,
        resetTimeoutMs: 60000
      }
    }
  });
  
  // Step 2: Initialize chain adapters
  console.log('Initializing chain adapters...');
  
  // You would replace these with your own RPC URLs and private keys
  const ethereumAdapter = new EthereumAdapter({
    rpcUrl: 'https://ethereum.example.com',
    chainId: ChainId.ETHEREUM,
    privateKey: process.env.ETHEREUM_PRIVATE_KEY || ethers.Wallet.createRandom().privateKey,
    telemetry
  });
  
  const polygonAdapter = new PolygonAdapter({
    rpcUrl: 'https://polygon.example.com',
    chainId: ChainId.POLYGON,
    privateKey: process.env.POLYGON_PRIVATE_KEY || ethers.Wallet.createRandom().privateKey,
    telemetry
  });
  
  const arbitrumAdapter = new ArbitrumAdapter({
    rpcUrl: 'https://arbitrum.example.com',
    chainId: ChainId.ARBITRUM,
    privateKey: process.env.ARBITRUM_PRIVATE_KEY || ethers.Wallet.createRandom().privateKey,
    telemetry
  });
  
  const binanceAdapter = new BinanceAdapter({
    rpcUrl: 'https://bsc.example.com',
    chainId: ChainId.BINANCE_SMART_CHAIN,
    privateKey: process.env.BSC_PRIVATE_KEY || ethers.Wallet.createRandom().privateKey,
    mevProtection: true,
    telemetry
  });
  
  const avalancheAdapter = new AvalancheAdapter({
    rpcUrl: 'https://avalanche.example.com',
    chainId: ChainId.AVALANCHE,
    privateKey: process.env.AVALANCHE_PRIVATE_KEY || ethers.Wallet.createRandom().privateKey,
    telemetry
  });
  
  // Step 3: Initialize asset adapter for token data
  const assetAdapter = new CoinGeckoAdapter({
    supportedChains: [
      ChainId.ETHEREUM,
      ChainId.POLYGON,
      ChainId.ARBITRUM,
      ChainId.BINANCE_SMART_CHAIN,
      ChainId.AVALANCHE
    ]
  });
  
  // Step 4: Initialize the security layer
  const securityLayer = new ExecutionSecurityLayer({
    flashbots: {
      enabled: true,
      relayUrls: {
        [ChainId.ETHEREUM]: 'https://relay.flashbots.net',
        [ChainId.POLYGON]: 'https://polygon-relay.flashbots.net'
      }
    },
    slippageProtection: {
      defaultTolerance: 0.5, // 0.5%
      maxTolerance: 5, // 5%
      enablePriceChecking: true,
      timeBound: 300 // 5 minutes
    },
    rateLimiting: {
      enabled: true,
      maxRequestsPerMinute: {
        'arbitrage-strategy': 30,
        'yield-farm-strategy': 10
      },
      maxRequestsPerDay: {
        'arbitrage-strategy': 1000,
        'yield-farm-strategy': 100
      }
    },
    telemetry
  });
  
  // Step 5: Initialize the cross-chain formatter
  const formatter = new CrossChainTransactionFormatter({
    chainConfigs: [
      {
        chainId: ChainId.ETHEREUM,
        nativeSymbol: 'ETH',
        nativeDecimals: 18,
        wrappedNativeAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
      },
      {
        chainId: ChainId.POLYGON,
        nativeSymbol: 'MATIC',
        nativeDecimals: 18,
        wrappedNativeAddress: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
      },
      {
        chainId: ChainId.ARBITRUM,
        nativeSymbol: 'ETH',
        nativeDecimals: 18,
        wrappedNativeAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
      },
      {
        chainId: ChainId.BINANCE_SMART_CHAIN,
        nativeSymbol: 'BNB',
        nativeDecimals: 18,
        wrappedNativeAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
      },
      {
        chainId: ChainId.AVALANCHE,
        nativeSymbol: 'AVAX',
        nativeDecimals: 18,
        wrappedNativeAddress: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7'
      }
    ],
    crossChainAssets: [
      {
        symbol: 'USDC',
        name: 'USD Coin',
        addresses: {
          [ChainId.ETHEREUM]: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          [ChainId.POLYGON]: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
          [ChainId.ARBITRUM]: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
          [ChainId.BINANCE_SMART_CHAIN]: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
          [ChainId.AVALANCHE]: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
        },
        decimals: {
          [ChainId.ETHEREUM]: 6,
          [ChainId.POLYGON]: 6,
          [ChainId.ARBITRUM]: 6,
          [ChainId.BINANCE_SMART_CHAIN]: 18,
          [ChainId.AVALANCHE]: 6
        }
      },
      {
        symbol: 'WETH',
        name: 'Wrapped Ether',
        addresses: {
          [ChainId.ETHEREUM]: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          [ChainId.POLYGON]: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
          [ChainId.ARBITRUM]: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
          [ChainId.BINANCE_SMART_CHAIN]: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
          [ChainId.AVALANCHE]: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB'
        },
        decimals: {
          [ChainId.ETHEREUM]: 18,
          [ChainId.POLYGON]: 18,
          [ChainId.ARBITRUM]: 18,
          [ChainId.BINANCE_SMART_CHAIN]: 18,
          [ChainId.AVALANCHE]: 18
        }
      }
    ]
  });
  
  // Step 6: Initialize all adapters
  await Promise.all([
    ethereumAdapter.initialize(),
    polygonAdapter.initialize(),
    arbitrumAdapter.initialize(),
    binanceAdapter.initialize(),
    avalancheAdapter.initialize(),
    assetAdapter.initialize({})
  ]);
  
  // Step 7: Create execution router with strategies
  const router = new CrossChainExecutionRouter({
    adapters: [
      ethereumAdapter,
      polygonAdapter,
      arbitrumAdapter,
      binanceAdapter,
      avalancheAdapter
    ],
    strategies: [
      {
        id: 'arbitrage-strategy',
        name: 'Cross-Chain Arbitrage',
        description: 'Exploits price differences across multiple chains',
        chains: [
          ChainId.ETHEREUM,
          ChainId.POLYGON,
          ChainId.ARBITRUM,
          ChainId.BINANCE_SMART_CHAIN,
          ChainId.AVALANCHE
        ],
        enabled: true,
        rateLimit: {
          maxRequestsPerMinute: 30,
          maxDailyRequests: 1000
        },
        fallbacks: [
          { chainId: ChainId.ETHEREUM, priority: 1 },
          { chainId: ChainId.POLYGON, priority: 2 },
          { chainId: ChainId.ARBITRUM, priority: 3 }
        ]
      },
      {
        id: 'yield-farm-strategy',
        name: 'Yield Farming',
        description: 'Deposits into yield farms across chains',
        chains: [
          ChainId.POLYGON,
          ChainId.AVALANCHE,
          ChainId.BINANCE_SMART_CHAIN
        ],
        enabled: true,
        rateLimit: {
          maxRequestsPerMinute: 10,
          maxDailyRequests: 100
        }
      }
    ],
    telemetry,
    enableCircuitBreakers: true,
    enableRateLimiting: true
  });
  
  // Step 8: Get network status across all chains
  console.log('\nChecking network status across all chains...');
  const networkStatus = await router.getAllNetworkStatus();
  
  for (const [chainId, status] of networkStatus.entries()) {
    console.log(`${status.networkName} (${chainId}): ${status.isConnected ? 'Connected' : 'Disconnected'}`);
    if (status.isConnected) {
      console.log(`  Block: ${status.latestBlock}, Gas: ${formatGas(status.gasPrice)} gwei`);
      console.log(`  Congestion: ${status.congestion}`);
    }
  }
  
  // Step 9: Execute a cross-chain trade (simulated)
  console.log('\nPreparing cross-chain trade...');
  
  // Get token data from asset adapter
  const usdcOnEthereum = await assetAdapter.getTokenPrice('USDC', ChainId.ETHEREUM, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  const usdcOnPolygon = await assetAdapter.getTokenPrice('USDC', ChainId.POLYGON, '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174');
  
  console.log(`USDC price on Ethereum: $${usdcOnEthereum.priceUsd}`);
  console.log(`USDC price on Polygon: $${usdcOnPolygon.priceUsd}`);
  
  // Create a simulated trade request
  const tradeRequest = {
    strategyId: 'arbitrage-strategy',
    chainId: ChainId.POLYGON,
    tradeRequest: {
      fromAsset: {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        chainId: ChainId.POLYGON,
        address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
      },
      toAsset: {
        symbol: 'WETH',
        name: 'Wrapped Ether',
        decimals: 18,
        chainId: ChainId.POLYGON,
        address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619'
      },
      inputAmount: '1000000000', // 1000 USDC (with 6 decimals)
      expectedOutput: '0.25', // Example expected ETH output
      slippageTolerance: 0.5, // 0.5%
      protocol: 'quickswap',
      contractAddress: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff', // QuickSwap router
      callData: '0x01234567', // This would be actual encoded call data in production
      deadline: Math.floor(Date.now() / 1000) + 300 // 5 minutes
    },
    options: {
      fallbackEnabled: true,
      maxRetries: 2,
      retryDelayMs: 2000
    }
  };
  
  console.log('\nValidating slippage and security parameters...');
  // In a real implementation, we would validate with the security layer
  const slippageValidation = securityLayer.validateSlippage(tradeRequest.tradeRequest);
  console.log(`Slippage validation: ${slippageValidation.valid ? 'Passed' : 'Failed'}`);
  
  if (!slippageValidation.valid) {
    console.error(`Slippage validation error: ${slippageValidation.error}`);
  } else {
    console.log(`Minimum acceptable output: ${slippageValidation.minAcceptableOutput}`);
    
    // Add time bounds for safety
    tradeRequest.tradeRequest = securityLayer.addTimeBounds(tradeRequest.tradeRequest);
    
    // Check rate limits
    try {
      securityLayer.checkRateLimits(tradeRequest.strategyId);
      console.log('Rate limit check: Passed');
      
      // In a real implementation, we would actually execute the trade
      // For this example, we'll just log what would happen
      console.log('\nTrade would be executed with these parameters:');
      console.log(`- Strategy: ${tradeRequest.strategyId}`);
      console.log(`- Chain: ${ChainId[tradeRequest.chainId]} (${tradeRequest.chainId})`);
      console.log(`- From: ${tradeRequest.tradeRequest.fromAsset.symbol} (${tradeRequest.tradeRequest.inputAmount})`);
      console.log(`- To: ${tradeRequest.tradeRequest.toAsset.symbol} (expected: ${tradeRequest.tradeRequest.expectedOutput})`);
      console.log(`- Slippage: ${tradeRequest.tradeRequest.slippageTolerance}%`);
      console.log(`- Protocol: ${tradeRequest.tradeRequest.protocol}`);
      console.log(`- Deadline: ${new Date(tradeRequest.tradeRequest.deadline! * 1000).toISOString()}`);
      
      // Show fallback chains
      const strategy = router.getStrategy(tradeRequest.strategyId);
      if (strategy.fallbacks && strategy.fallbacks.length > 0) {
        console.log('\nFallback chains if primary execution fails:');
        
        for (const fallback of strategy.fallbacks) {
          console.log(`- ${ChainId[fallback.chainId]} (priority: ${fallback.priority})`);
        }
      }
    } catch (error) {
      console.error(`Rate limit error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Step 10: Execute a batch operation across multiple chains
  console.log('\nPreparing batch execution across multiple chains...');
  
  const batchRequest = {
    strategyId: 'yield-farm-strategy',
    trades: [
      {
        chainId: ChainId.POLYGON,
        tradeRequest: {
          fromAsset: {
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            chainId: ChainId.POLYGON,
            address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
          },
          toAsset: {
            symbol: 'amUSDC',
            name: 'Aave USDC',
            decimals: 6,
            chainId: ChainId.POLYGON,
            address: '0x1a13F4Ca1d028320A707D99520AbFefca3998b7F'
          },
          inputAmount: '5000000000', // 5000 USDC
          protocol: 'aave',
          contractAddress: '0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf', // Aave lending pool
          callData: '0xabcdef12' // This would be actual encoded call data in production
        }
      },
      {
        chainId: ChainId.AVALANCHE,
        tradeRequest: {
          fromAsset: {
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            chainId: ChainId.AVALANCHE,
            address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
          },
          toAsset: {
            symbol: 'avUSDC',
            name: 'Aave USDC',
            decimals: 6,
            chainId: ChainId.AVALANCHE,
            address: '0x46A51127C3ce23fb7AB1DE06226147F446e4a857'
          },
          inputAmount: '3000000000', // 3000 USDC
          protocol: 'aave',
          contractAddress: '0x4F01AeD16D97E3aB5ab2B501154DC9bb0F1A5A2C', // Aave lending pool
          callData: '0x34567890' // This would be actual encoded call data in production
        }
      }
    ],
    options: {
      sequential: true,
      abortOnFailure: true,
      fallbackEnabled: true,
      maxRetries: 1
    }
  };
  
  console.log('Batch execution would include:');
  for (const trade of batchRequest.trades) {
    console.log(`- ${ChainId[trade.chainId]}: ${trade.tradeRequest.fromAsset.symbol} -> ${trade.tradeRequest.toAsset.symbol} (${trade.tradeRequest.inputAmount} input)`);
  }
  
  console.log(`Execution mode: ${batchRequest.options.sequential ? 'Sequential' : 'Parallel'}`);
  console.log(`Abort on failure: ${batchRequest.options.abortOnFailure ? 'Yes' : 'No'}`);
  
  // Step 11: Check health status of the router
  console.log('\nChecking router health status...');
  const healthStatus = await router.getHealthStatus();
  
  console.log(`Overall health: ${healthStatus.healthy ? 'Healthy' : 'Unhealthy'}`);
  console.log('Chain adapter status:');
  
  for (const [adapter, status] of Object.entries(healthStatus.adapters)) {
    console.log(`- ${adapter} (${status.chainId}): ${status.healthy ? 'Healthy' : 'Unhealthy'}`);
    
    if (status.circuitBreakerStatus) {
      console.log(`  Circuit breaker: ${status.circuitBreakerStatus.state}`);
      
      if (status.circuitBreakerStatus.state === 'OPEN') {
        console.log(`  Failures: ${status.circuitBreakerStatus.failureCount}`);
        if (status.circuitBreakerStatus.nextRetry) {
          console.log(`  Next retry: ${new Date(status.circuitBreakerStatus.nextRetry).toISOString()}`);
        }
      }
    }
  }
  
  // Clean up
  console.log('\nExecution example complete.');
}

/**
 * Format gas price to Gwei
 */
function formatGas(wei: bigint): string {
  return (Number(wei) / 1e9).toFixed(2);
}

// Run the example if this script is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main }; 