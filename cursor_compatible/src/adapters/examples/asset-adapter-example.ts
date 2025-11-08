/**
 * Asset Adapter Example
 * 
 * This example demonstrates how to use the asset adapters to fetch token pricing data,
 * historical charts, and perform token searches.
 */

import { CoinGeckoAdapter } from '../CoinGeckoAdapter';
import { ChainId } from '../index';
import { TokenPrice, HistoricalPriceOptions, PriceDataPoint } from '../IAssetAdapter';
import { Asset } from '../IChainAdapter';

/**
 * Main example function
 */
async function main() {
  console.log('Initializing Asset Adapter Example');
  
  // Create and initialize the CoinGecko adapter
  const adapter = new CoinGeckoAdapter({
    // Uncomment and add a Pro API key if you have one
    // useProApi: true,
    // proApiKey: 'YOUR_API_KEY',
    cacheTimeout: 5 * 60 * 1000, // 5 minutes
    supportedChains: [
      ChainId.ETHEREUM,
      ChainId.BINANCE_SMART_CHAIN,
      ChainId.POLYGON,
      ChainId.AVALANCHE,
      ChainId.ARBITRUM
    ]
  });
  
  try {
    // Initialize the adapter
    await adapter.initialize({});
    console.log('Adapter initialized successfully');
    
    // Get current prices for popular tokens
    await getPricesExample(adapter);
    
    // Demonstrate historical price data
    await getHistoricalPricesExample(adapter);
    
    // Search for tokens
    await searchTokensExample(adapter);
    
    // Get multiple token prices
    await getMultiplePricesExample(adapter);
    
    // Get token lists
    await getTokenListExample(adapter);
    
    // Get adapter status
    await getAdapterStatusExample(adapter);
    
  } catch (error) {
    console.error('Error in asset adapter example:', error);
  } finally {
    // Clean shutdown
    await adapter.shutdown();
    console.log('Adapter shut down successfully');
  }
}

/**
 * Get current prices for popular tokens
 */
async function getPricesExample(adapter: CoinGeckoAdapter) {
  console.log('\n--- Current Token Prices ---');
  
  const tokens = [
    { symbol: 'ETH', chainId: ChainId.ETHEREUM },
    { symbol: 'BTC', chainId: ChainId.ETHEREUM }, // BTC price via wrapped BTC on Ethereum
    { symbol: 'AVAX', chainId: ChainId.AVALANCHE },
    { symbol: 'MATIC', chainId: ChainId.POLYGON },
    { symbol: 'BNB', chainId: ChainId.BINANCE_SMART_CHAIN },
    // USDC on Ethereum (using contract address)
    { 
      symbol: 'USDC', 
      chainId: ChainId.ETHEREUM, 
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' 
    }
  ];
  
  // Get and display the current price for each token
  for (const token of tokens) {
    try {
      const price = await adapter.getTokenPrice(token.symbol, token.chainId, token.address);
      console.log(`${price.symbol} (${token.chainId}): $${price.priceUsd.toFixed(2)} USD`);
      console.log(`  24h Change: ${price.priceChange24h?.toFixed(2)}%`);
      console.log(`  Market Cap: $${formatNumber(price.marketCapUsd || 0)}`);
      console.log(`  24h Volume: $${formatNumber(price.volume24hUsd || 0)}`);
    } catch (error: any) {
      console.error(`Error getting price for ${token.symbol}:`, error.message || String(error));
    }
  }
}

/**
 * Get historical price data
 */
async function getHistoricalPricesExample(adapter: CoinGeckoAdapter) {
  console.log('\n--- Historical Price Data ---');
  
  // Get ETH historical prices for different time periods
  const options: HistoricalPriceOptions[] = [
    { interval: '1d', limit: 7 }, // Last 7 days (daily)
    { interval: '1h', limit: 24 }, // Last 24 hours (hourly)
  ];
  
  for (const option of options) {
    try {
      const prices = await adapter.getHistoricalPrices('ETH', ChainId.ETHEREUM, option);
      console.log(`ETH prices (${option.interval}, ${prices.length} data points):`);
      
      // Display a sample of the data
      const sampleSize = 5;
      const step = Math.max(1, Math.floor(prices.length / sampleSize));
      
      for (let i = 0; i < prices.length; i += step) {
        const price = prices[i];
        const date = new Date(price.timestamp * 1000).toISOString();
        console.log(`  ${date}: $${price.priceUsd.toFixed(2)} USD`);
      }
    } catch (error: any) {
      console.error(`Error getting historical prices with interval ${option.interval}:`, error.message || String(error));
    }
  }
}

/**
 * Search for tokens
 */
async function searchTokensExample(adapter: CoinGeckoAdapter) {
  console.log('\n--- Token Search ---');
  
  const searchQueries = ['bitcoin', 'defi', 'uniswap'];
  
  for (const query of searchQueries) {
    try {
      // Limit to 5 results for brevity
      const results = await adapter.searchTokens(query, undefined, 5);
      
      console.log(`Search results for "${query}" (${results.length} tokens):`);
      
      for (const token of results) {
        console.log(`  ${token.symbol} - ${token.name} (Chain: ${token.chainId})`);
      }
    } catch (error: any) {
      console.error(`Error searching for "${query}":`, error.message || String(error));
    }
  }
}

/**
 * Get prices for multiple tokens at once
 */
async function getMultiplePricesExample(adapter: CoinGeckoAdapter) {
  console.log('\n--- Multiple Token Prices ---');
  
  const tokens: Asset[] = [
    {
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      chainId: ChainId.ETHEREUM,
      isNative: true
    },
    {
      symbol: 'BNB',
      name: 'BNB',
      decimals: 18,
      chainId: ChainId.BINANCE_SMART_CHAIN,
      isNative: true
    },
    {
      symbol: 'USDT',
      name: 'Tether',
      decimals: 6,
      chainId: ChainId.ETHEREUM,
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7'
    },
    {
      symbol: 'AAVE',
      name: 'Aave',
      decimals: 18,
      chainId: ChainId.ETHEREUM,
      address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9'
    }
  ];
  
  try {
    const prices = await adapter.getTokenPrices(tokens);
    
    console.log(`Got prices for ${prices.size} tokens:`);
    
    prices.forEach((price, key) => {
      console.log(`  ${price.symbol}: $${price.priceUsd.toFixed(2)} USD`);
    });
  } catch (error: any) {
    console.error('Error getting multiple token prices:', error.message || String(error));
  }
}

/**
 * Get token list
 */
async function getTokenListExample(adapter: CoinGeckoAdapter) {
  console.log('\n--- Token List ---');
  
  try {
    const tokenList = await adapter.getTokenList('Top 100');
    
    console.log(`Token list "${tokenList.name}" with ${tokenList.tokens.length} tokens`);
    console.log(`Last updated: ${tokenList.timestamp}`);
    
    // Show first few tokens
    console.log('Top tokens:');
    tokenList.tokens.slice(0, 5).forEach((token, index) => {
      console.log(`  ${index + 1}. ${token.symbol} - ${token.name}`);
    });
  } catch (error: any) {
    console.error('Error getting token list:', error.message || String(error));
  }
}

/**
 * Get adapter status
 */
async function getAdapterStatusExample(adapter: CoinGeckoAdapter) {
  console.log('\n--- Adapter Status ---');
  
  try {
    const status = await adapter.getStatus();
    
    console.log(`Name: ${status.name} v${status.version}`);
    console.log(`Connected: ${status.isConnected}`);
    console.log(`Supported chains: ${status.supportedChains.join(', ')}`);
    console.log(`Asset types: ${status.supportedAssetTypes.join(', ')}`);
    console.log(`Indexed assets: ${status.indexedAssets}`);
    console.log(`Data source: ${status.dataSource}`);
    
    // Show capabilities
    const capabilities = adapter.getCapabilities();
    console.log(`Capabilities (${capabilities.length}):`);
    console.log(`  ${capabilities.join(', ')}`);
  } catch (error: any) {
    console.error('Error getting adapter status:', error.message || String(error));
  }
}

/**
 * Format number with commas for readability
 */
function formatNumber(num: number): string {
  return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// Run the example if this script is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

// Export for testing
export { main }; 