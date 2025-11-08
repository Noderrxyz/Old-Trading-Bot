/**
 * CoinMarketCapAdapter - Asset adapter implementation using CoinMarketCap API
 * 
 * This adapter provides token price data, historical charts, and market information
 * by querying the CoinMarketCap API.
 */

import { BaseAssetAdapter, AssetAdapterConfig } from './BaseAssetAdapter';
import { 
  AssetAdapterStatus, 
  TokenPrice, 
  PriceDataPoint, 
  NFTMetadata,
  NFTCollection, 
  DeFiProtocol, 
  TokenList,
  HistoricalPriceOptions,
  NFTPriceOptions,
  AssetAdapterCapability,
  PriceSource,
  IAssetAdapter,
  TokenListOptions,
  Portfolio
} from './IAssetAdapter';
import { Asset } from './IChainAdapter';

/**
 * Extended Asset type with CoinMarketCap-specific properties
 */
export interface ExtendedAsset extends Asset {
  coinmarketcapId?: string;
}

// Add a MARKET_DATA capability that's missing from the enum
export enum ExtendedAssetAdapterCapability {
  MARKET_DATA = 'data.market_data'
}

/**
 * CoinMarketCap-specific adapter configuration
 */
export interface CoinMarketCapAdapterConfig extends Omit<AssetAdapterConfig, 'supportedChains'> {
  apiKey: string; // CoinMarketCap API key (required)
  baseCurrency?: string; // Base currency for prices (default: USD)
  includeMarketData?: boolean; // Whether to include extra market data in responses
  supportedChains: number[]; // Make this required
  tier?: 'basic' | 'hobbyist' | 'startup' | 'standard' | 'professional' | 'enterprise'; // API tier level
}

/**
 * Chain ID to CoinMarketCap platform ID mapping
 */
const CHAIN_TO_PLATFORM: Record<number, number> = {
  1: 1, // Ethereum
  56: 56, // BSC
  137: 137, // Polygon
  43114: 43114, // Avalanche
  42161: 42161, // Arbitrum
  10: 10, // Optimism
  8453: 8453, // Base
  // Add more chains as needed
};

/**
 * CoinMarketCap adapter implementation for asset data
 */
export class CoinMarketCapAdapter extends BaseAssetAdapter implements IAssetAdapter {
  private apiKey: string;
  private coinIdMap: Map<string, number> = new Map();
  private addressToIdMap: Map<string, number> = new Map();
  private platformIdMap: Map<string, number> = new Map();
  private baseCurrency: string;
  
  // Track API rate limits
  private lastRequestTime: number = 0;
  private requestsThisMinute: number = 0;
  private minuteStartTime: number = 0;
  
  // API URL constants
  private readonly BASE_URL = 'https://pro-api.coinmarketcap.com';
  
  /**
   * Constructor for CoinMarketCap adapter
   * @param config Configuration options
   */
  constructor(config: CoinMarketCapAdapterConfig) {
    super({
      apiUrl: 'https://pro-api.coinmarketcap.com',
      rateLimitPerMinute: config.rateLimitPerMinute || getRateLimit(config.tier || 'basic'),
      cacheTimeout: config.cacheTimeout || 5 * 60 * 1000, // 5 minutes
      supportedChains: config.supportedChains,
      ...config
    });
    
    this.apiKey = config.apiKey;
    this.baseCurrency = config.baseCurrency || 'USD';
    
    this._name = 'CoinMarketCapAdapter';
    this._version = '1.0.0';
    
    // Initialize capabilities
    this.addCapability(AssetAdapterCapability.PRICE_QUERY);
    this.addCapability(AssetAdapterCapability.TOKEN_METADATA);
    this.addCapability(AssetAdapterCapability.HISTORICAL_PRICE);
    this.addCapability(AssetAdapterCapability.TOKEN_SEARCH);
    this.addCapability(ExtendedAssetAdapterCapability.MARKET_DATA);
    
    // Initialize platform to chain ID mapping
    this.platformIdMap.set('ethereum', 1);
    this.platformIdMap.set('binance-smart-chain', 56);
    this.platformIdMap.set('polygon-pos', 137);
    this.platformIdMap.set('avalanche', 43114);
    this.platformIdMap.set('arbitrum-one', 42161);
    this.platformIdMap.set('optimistic-ethereum', 10);
    this.platformIdMap.set('base', 8453);
  }
  
  /**
   * Initialize the CoinMarketCap adapter
   */
  protected async initializeImpl(): Promise<void> {
    try {
      // Make a test API call to verify connection
      await this.makeRequest('/v1/cryptocurrency/map', { limit: 1 });
      console.log('CoinMarketCap API connection successful');
      
      // Pre-fetch top coins to populate the cache
      await this.fetchTopCoins();
    } catch (error) {
      this._lastError = error instanceof Error ? error : new Error(String(error));
      throw new Error(`Failed to initialize CoinMarketCap adapter: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Make a request to the CoinMarketCap API
   * @param endpoint API endpoint path
   * @param params URL parameters
   * @returns Response data
   */
  private async makeRequest(endpoint: string, params: Record<string, any> = {}): Promise<any> {
    // Handle rate limiting
    await this.handleRateLimit();
    
    // Increment request counter
    this.requestCount++;
    
    // Build URL
    const url = new URL(`${this.BASE_URL}${endpoint}`);
    
    // Add query parameters
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });
    
    try {
      // Make the request
      const response = await fetch(url.toString(), {
        headers: {
          'X-CMC_PRO_API_KEY': this.apiKey,
          'Accept': 'application/json'
        }
      });
      
      // Handle HTTP errors
      if (!response.ok) {
        throw new Error(`CoinMarketCap API error (${response.status}): ${response.statusText}`);
      }
      
      // Parse the response
      const responseData = await response.json();
      
      // CoinMarketCap specific error handling
      if (responseData.status && responseData.status.error_code !== 0) {
        throw new Error(`CoinMarketCap API error (${responseData.status.error_code}): ${responseData.status.error_message}`);
      }
      
      return responseData.data;
    } catch (error) {
      // Increment error counter
      this.errorCount++;
      
      // Record the error
      this._lastError = error instanceof Error ? error : new Error(String(error));
      
      // Rethrow the error
      throw error;
    }
  }
  
  /**
   * Handle API rate limiting
   */
  private async handleRateLimit(): Promise<void> {
    const now = Date.now();
    
    // Reset counters if a minute has passed
    if (now - this.minuteStartTime >= 60000) {
      this.minuteStartTime = now;
      this.requestsThisMinute = 0;
    }
    
    // Increment counter
    this.requestsThisMinute++;
    
    // Check if we're exceeding the rate limit
    const rateLimit = this.config.rateLimitPerMinute || 30;
    if (this.requestsThisMinute > rateLimit) {
      // Calculate time to wait until next minute starts
      const timeToWait = 60000 - (now - this.minuteStartTime);
      console.warn(`Rate limit reached, waiting ${timeToWait}ms before next request`);
      await new Promise(resolve => setTimeout(resolve, timeToWait));
      
      // Reset counters after waiting
      this.minuteStartTime = Date.now();
      this.requestsThisMinute = 1;
    }
    
    // Ensure we're not making requests too quickly
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < 100) {
      await new Promise(resolve => setTimeout(resolve, 100 - timeSinceLastRequest));
    }
    
    this.lastRequestTime = Date.now();
  }
  
  /**
   * Fetch and cache the top 1000 coins from CoinMarketCap
   */
  private async fetchTopCoins(): Promise<void> {
    try {
      const data = await this.makeRequest('/v1/cryptocurrency/map', { limit: 1000 });
      
      // Update coin ID maps
      for (const coin of data) {
        // Map symbol to ID (may have collisions, preference to higher rank)
        if (!this.coinIdMap.has(coin.symbol.toLowerCase()) || coin.rank < 1000) {
          this.coinIdMap.set(coin.symbol.toLowerCase(), coin.id);
        }
        
        // Map platform addresses to coin IDs
        if (coin.platform && coin.platform.token_address) {
          const key = `${coin.platform.id}:${coin.platform.token_address.toLowerCase()}`;
          this.addressToIdMap.set(key, coin.id);
        }
      }
      
      console.log(`Loaded ${data.length} coins from CoinMarketCap`);
    } catch (error) {
      console.error('Failed to fetch top coins:', error);
      throw error;
    }
  }
  
  /**
   * Get current status of the adapter
   */
  protected async getStatusImpl(): Promise<Partial<AssetAdapterStatus>> {
    return {
      dataSource: 'CoinMarketCap',
      refreshInterval: this.config.refreshInterval,
      metadata: {
        tier: (this.config as CoinMarketCapAdapterConfig).tier || 'basic',
        cachedCoins: this.coinIdMap.size,
        cachedAddresses: this.addressToIdMap.size,
        requestsThisMinute: this.requestsThisMinute,
        rateLimit: this.config.rateLimitPerMinute
      }
    };
  }
  
  /**
   * Get token price
   */
  public async getTokenPrice(symbol: string, chainId: number, address?: string): Promise<TokenPrice> {
    // Generate cache key
    const cacheKey = this.getTokenCacheKey(symbol, chainId, address);
    
    // Check cache first
    const cached = this.tokenPriceCache.get(cacheKey);
    if (cached && this.isCacheFresh(cached.timestamp)) {
      this.cacheHits++;
      return cached.data;
    }
    
    this.cacheMisses++;
    
    // Determine the coin ID
    let coinId: number | undefined;
    
    // If we have the address, try to get token by address
    if (address && chainId) {
      const platformId = CHAIN_TO_PLATFORM[chainId];
      if (platformId) {
        const key = `${platformId}:${address.toLowerCase()}`;
        coinId = this.addressToIdMap.get(key);
      }
    }
    
    // If we couldn't find by address or don't have an address, try by symbol
    if (!coinId) {
      coinId = this.coinIdMap.get(symbol.toLowerCase());
      
      // If still not found, try to search for it
      if (!coinId) {
        const searchResults = await this.searchTokens(symbol);
        const matchingToken = searchResults.find(t => 
          t.symbol.toLowerCase() === symbol.toLowerCase() && 
          (t.chainId === chainId || !chainId)
        );
        
        if (matchingToken && matchingToken.coinmarketcapId) {
          coinId = parseInt(matchingToken.coinmarketcapId);
        }
      }
    }
    
    if (!coinId) {
      throw new Error(`Could not find token ${symbol} on chain ${chainId}`);
    }
    
    // Get data from CoinMarketCap
    const data = await this.makeRequest('/v2/cryptocurrency/quotes/latest', {
      id: coinId,
      convert: this.baseCurrency
    });
    
    const coinData = data[coinId];
    if (!coinData) {
      throw new Error(`No data returned for coin ID ${coinId}`);
    }
    
    const quote = coinData.quote[this.baseCurrency];
    
    // Build the price info
    const tokenPrice: TokenPrice = {
      symbol: coinData.symbol,
      address: address,
      chainId,
      priceUsd: quote.price,
      priceChange24h: quote.percent_change_24h,
      priceChange7d: quote.percent_change_7d,
      marketCapUsd: quote.market_cap,
      fullyDilutedValuationUsd: quote.fully_diluted_market_cap,
      volume24hUsd: quote.volume_24h,
      high24h: undefined, // Not available directly
      low24h: undefined, // Not available directly
      ath: undefined, // Not available directly
      athDate: undefined,
      atl: undefined,
      atlDate: undefined,
      lastUpdated: coinData.last_updated,
      source: PriceSource.AGGREGATOR,
      confidence: 0.95 // High confidence for CMC data
    };
    
    // Cache the result
    this.tokenPriceCache.set(cacheKey, {
      data: tokenPrice,
      timestamp: Date.now()
    });
    
    return tokenPrice;
  }
  
  /**
   * Get prices for multiple tokens
   */
  public async getTokenPrices(tokens: Asset[]): Promise<Map<string, TokenPrice>> {
    const result = new Map<string, TokenPrice>();
    
    // First check which tokens we need to fetch
    const tokensToFetch: Asset[] = [];
    
    for (const token of tokens) {
      const cacheKey = this.getTokenCacheKey(token.symbol, token.chainId, token.address);
      const cached = this.tokenPriceCache.get(cacheKey);
      
      if (cached && this.isCacheFresh(cached.timestamp)) {
        this.cacheHits++;
        result.set(token.address || token.symbol, cached.data);
      } else {
        this.cacheMisses++;
        tokensToFetch.push(token);
      }
    }
    
    if (tokensToFetch.length === 0) {
      return result;
    }
    
    // Collect IDs for tokens we need to fetch
    const idToFetch: number[] = [];
    const idToAssetMap: Map<number, Asset> = new Map();
    
    for (const token of tokensToFetch) {
      let coinId: number | undefined;
      
      // Try to find by address
      if (token.address && token.chainId) {
        const platformId = CHAIN_TO_PLATFORM[token.chainId];
        if (platformId) {
          const key = `${platformId}:${token.address.toLowerCase()}`;
          coinId = this.addressToIdMap.get(key);
        }
      }
      
      // Try to find by symbol
      if (!coinId) {
        coinId = this.coinIdMap.get(token.symbol.toLowerCase());
      }
      
      // Skip if we couldn't find the ID
      if (!coinId) {
        continue;
      }
      
      idToFetch.push(coinId);
      idToAssetMap.set(coinId, token);
    }
    
    if (idToFetch.length === 0) {
      // If we couldn't find any IDs, fall back to individual fetches
      for (const token of tokensToFetch) {
        try {
          const price = await this.getTokenPrice(token.symbol, token.chainId, token.address);
          result.set(token.address || token.symbol, price);
        } catch (error) {
          console.error(`Failed to get price for ${token.symbol}:`, error);
        }
      }
      return result;
    }
    
    // Fetch prices in batches of 100 (CMC limit)
    const batchSize = 100;
    for (let i = 0; i < idToFetch.length; i += batchSize) {
      const batchIds = idToFetch.slice(i, i + batchSize);
      
      try {
        const data = await this.makeRequest('/v2/cryptocurrency/quotes/latest', {
          id: batchIds.join(','),
          convert: this.baseCurrency
        });
        
        // Process the batch results
        for (const coinId of Object.keys(data)) {
          const coinData = data[coinId];
          const asset = idToAssetMap.get(parseInt(coinId));
          
          if (asset && coinData) {
            const quote = coinData.quote[this.baseCurrency];
            
            // Build the price info
            const tokenPrice: TokenPrice = {
              symbol: coinData.symbol,
              address: asset.address,
              chainId: asset.chainId,
              priceUsd: quote.price,
              priceChange24h: quote.percent_change_24h,
              priceChange7d: quote.percent_change_7d,
              marketCapUsd: quote.market_cap,
              fullyDilutedValuationUsd: quote.fully_diluted_market_cap,
              volume24hUsd: quote.volume_24h,
              lastUpdated: coinData.last_updated,
              source: PriceSource.AGGREGATOR,
              confidence: 0.95
            };
            
            // Cache the result
            const cacheKey = this.getTokenCacheKey(asset.symbol, asset.chainId, asset.address);
            this.tokenPriceCache.set(cacheKey, {
              data: tokenPrice,
              timestamp: Date.now()
            });
            
            // Add to result
            result.set(asset.address || asset.symbol, tokenPrice);
          }
        }
      } catch (error) {
        console.error(`Failed to get prices for batch:`, error);
      }
    }
    
    return result;
  }
  
  /**
   * Get historical price data
   */
  public async getHistoricalPrices(
    symbol: string, 
    chainId: number, 
    options: HistoricalPriceOptions,
    address?: string
  ): Promise<PriceDataPoint[]> {
    // Determine the coin ID
    let coinId: number | undefined;
    
    // Try by address if provided
    if (address && chainId) {
      const platformId = CHAIN_TO_PLATFORM[chainId];
      if (platformId) {
        const key = `${platformId}:${address.toLowerCase()}`;
        coinId = this.addressToIdMap.get(key);
      }
    }
    
    // If not found by address, try by symbol
    if (!coinId) {
      coinId = this.coinIdMap.get(symbol.toLowerCase());
    }
    
    if (!coinId) {
      throw new Error(`Could not find token ${symbol} on chain ${chainId}`);
    }
    
    // Map interval to CoinMarketCap interval parameter
    let interval: string;
    let count: number;
    
    switch (options.interval) {
      case '1m':
      case '5m':
      case '15m':
      case '30m':
        interval = 'hourly';
        count = 24;
        break;
      case '1h':
        interval = 'hourly';
        count = options.limit || 24;
        break;
      case '4h':
        interval = 'daily';
        count = options.limit || 7;
        break;
      case '1d':
        interval = 'daily';
        count = options.limit || 30;
        break;
      case '1w':
        interval = 'weekly';
        count = options.limit || 4;
        break;
      case '1mo':
        interval = 'monthly';
        count = options.limit || 12;
        break;
      default:
        interval = 'daily';
        count = 30;
    }
    
    // CoinMarketCap has a maximum count limitation based on plan
    const tier = (this.config as CoinMarketCapAdapterConfig).tier || 'basic';
    const maxCount = getMaxHistoricalDataPoints(tier);
    count = Math.min(count, maxCount);
    
    // Determine time range if specified
    const timeStart = options.from ? Math.floor(options.from / 1000) : undefined;
    const timeEnd = options.to ? Math.floor(options.to / 1000) : undefined;
    
    // Get data from CoinMarketCap
    const data = await this.makeRequest('/v3/cryptocurrency/quotes/historical', {
      id: coinId,
      convert: this.baseCurrency,
      interval: interval,
      count: count,
      time_start: timeStart,
      time_end: timeEnd
    });
    
    // Transform the data into the expected format
    const prices: PriceDataPoint[] = [];
    
    for (const quote of data.quotes) {
      prices.push({
        timestamp: new Date(quote.timestamp).getTime() / 1000,
        priceUsd: quote.quote[this.baseCurrency].price,
        volume: quote.quote[this.baseCurrency].volume_24h,
        marketCap: quote.quote[this.baseCurrency].market_cap
      });
    }
    
    return prices;
  }
  
  /**
   * Search for tokens
   */
  public async searchTokens(query: string, chainIds?: number[], limit?: number): Promise<Asset[]> {
    try {
      const searchQuery = query.toLowerCase();
      const results: ExtendedAsset[] = [];
      
      // Search for the token in top coins first
      const response = await this.makeRequest('/v1/cryptocurrency/listings/latest', {
        limit: 100,
        convert: this.baseCurrency
      });
      
      if (response.data) {
        for (const coin of response.data) {
          // Check if the token name or symbol matches the query
          if (coin.name.toLowerCase().includes(searchQuery) || 
              coin.symbol.toLowerCase().includes(searchQuery)) {
            
            // Filter by chain ID if specified
            if (chainIds && chainIds.length > 0) {
              if (!coin.platform || !this.isSupportedChain(coin.platform.id, chainIds)) {
                continue;
              }
            }
            
            // Choose an appropriate chain ID
            let matchingChainId: number | undefined;
            if (coin.platform) {
              matchingChainId = this.mapPlatformToChainId(coin.platform.id);
            }
            
            // Add to results with chain-appropriate info
            if (matchingChainId && this.isSupportedChain(coin.platform.id, chainIds)) {
              // For tokens with specific chain info
              results.push({
                symbol: coin.symbol,
                name: coin.name,
                decimals: 18, // Default, actual decimals may vary
                logoURI: `https://s2.coinmarketcap.com/static/img/coins/64x64/${coin.id}.png`,
                chainId: Number(matchingChainId),
                address: coin.platform.token_address,
                coingeckoId: String(coin.id),
                coinmarketcapId: String(coin.id)
              });
            } else {
              // For tokens without specific chain info
              results.push({
                symbol: coin.symbol,
                name: coin.name,
                decimals: 18, // Default
                chainId: chainIds ? chainIds[0] : 1, // Default to first specified chain or Ethereum
                coingeckoId: String(coin.id),
                coinmarketcapId: String(coin.id)
              });
            }
          }
        }
      }
      
      // Limit results if needed
      return limit ? results.slice(0, limit) : results;
    } catch (error) {
      this.logError("Error searching tokens", error);
      return [];
    }
  }
  
  /**
   * Get NFT metadata - Not implemented for CoinMarketCap
   */
  public async getNFTMetadata(
    collectionAddress: string, 
    tokenId: string, 
    chainId: number
  ): Promise<NFTMetadata> {
    throw new Error('NFT metadata not implemented in CoinMarketCap adapter');
  }
  
  /**
   * Get NFT collection - Not implemented for CoinMarketCap
   */
  public async getNFTCollection(
    collectionAddress: string, 
    chainId: number
  ): Promise<NFTCollection> {
    throw new Error('NFT collection not implemented in CoinMarketCap adapter');
  }
  
  /**
   * Get NFT floor price history - Not implemented for CoinMarketCap
   */
  public async getNFTFloorPriceHistory(options: NFTPriceOptions): Promise<PriceDataPoint[]> {
    throw new Error('NFT floor price history not implemented in CoinMarketCap adapter');
  }
  
  /**
   * Get NFTs by owner - Not implemented for CoinMarketCap
   */
  public async getNFTsByOwner(
    ownerAddress: string, 
    chainId: number, 
    limit?: number, 
    cursor?: string
  ): Promise<{
    nfts: NFTMetadata[];
    cursor?: string;
    total: number;
  }> {
    throw new Error('NFTs by owner not implemented in CoinMarketCap adapter');
  }
  
  /**
   * Search NFT collections - Not implemented for CoinMarketCap
   */
  public async searchNFTCollections(
    query: string, 
    chainIds?: number[], 
    limit?: number
  ): Promise<NFTCollection[]> {
    throw new Error('NFT collection search not implemented in CoinMarketCap adapter');
  }
  
  /**
   * Get DeFi protocols - Not implemented for CoinMarketCap
   */
  public async getDeFiProtocols(
    chainIds?: number[], 
    types?: string[],
    limit?: number
  ): Promise<DeFiProtocol[]> {
    throw new Error('DeFi protocols not implemented in CoinMarketCap adapter');
  }
  
  /**
   * Get DeFi protocol details - Not implemented for CoinMarketCap
   */
  public async getDeFiProtocolDetails(protocolId: string): Promise<DeFiProtocol> {
    throw new Error('DeFi protocol details not implemented in CoinMarketCap adapter');
  }
  
  /**
   * Get token list from CoinMarketCap
   */
  public async getTokenList(listName: string): Promise<TokenList> {
    // Validate list name - for CoinMarketCap we can support various lists
    let filter: any = {};
    
    switch (listName.toLowerCase()) {
      case 'top100':
      case 'top 100':
        filter.limit = 100;
        filter.sort = 'market_cap';
        filter.sort_dir = 'desc';
        break;
      case 'trending':
        filter.limit = 50;
        filter.sort = 'percent_change_24h';
        filter.sort_dir = 'desc';
        break;
      case 'gainers':
        filter.limit = 50;
        filter.sort = 'percent_change_24h';
        filter.sort_dir = 'desc';
        break;
      case 'losers':
        filter.limit = 50;
        filter.sort = 'percent_change_24h';
        filter.sort_dir = 'asc';
        break;
      default:
        // Default to top 100
        filter.limit = 100;
        filter.sort = 'market_cap';
        filter.sort_dir = 'desc';
    }
    
    // Get data from CoinMarketCap
    const data = await this.makeRequest('/v1/cryptocurrency/listings/latest', {
      ...filter,
      convert: this.baseCurrency
    });
    
    // Transform to token list format
    const tokens: Asset[] = data.map((coin: any) => ({
      symbol: coin.symbol,
      name: coin.name,
      decimals: 18, // Default
      chainId: 1, // Default to Ethereum
      coinmarketcapId: String(coin.id),
      usdPrice: coin.quote[this.baseCurrency].price
    }));
    
    return {
      name: `CoinMarketCap ${listName}`,
      timestamp: new Date().toISOString(),
      version: {
        major: 1,
        minor: 0,
        patch: 0
      },
      tokens,
      logoURI: 'https://s2.coinmarketcap.com/static/cloud/img/coinmarketcap_icon.svg'
    };
  }
  
  /**
   * Refresh data from CoinMarketCap
   */
  public async refreshData(force: boolean = false): Promise<void> {
    // If forced, clear caches
    if (force) {
      this.tokenPriceCache.clear();
      this.coinIdMap.clear();
      this.addressToIdMap.clear();
    }
    
    // Re-fetch top coins
    await this.fetchTopCoins();
  }
  
  /**
   * Implementation-specific reset
   */
  protected async resetImpl(): Promise<void> {
    // Clear all internal maps and counters
    this.coinIdMap.clear();
    this.addressToIdMap.clear();
    this.lastRequestTime = 0;
    this.requestsThisMinute = 0;
    this.minuteStartTime = 0;
  }
  
  /**
   * Implementation-specific shutdown
   */
  protected async shutdownImpl(): Promise<void> {
    // No specific shutdown tasks needed
  }
  
  /**
   * Get data source name
   */
  protected getDataSource(): string {
    return 'CoinMarketCap';
  }
  
  // Map CoinMarketCap platform ID to chain ID
  private mapPlatformToChainId(platform: string): number | undefined {
    return this.platformIdMap.get(platform);
  }
  
  // Check if the platform/chain is supported
  private isSupportedChain(platform: string, chainIds?: number[]): boolean {
    const chainId = this.mapPlatformToChainId(platform);
    if (!chainId) return false;
    
    if (chainIds && chainIds.length > 0) {
      return chainIds.includes(chainId);
    }
    
    return this.config.supportedChains.includes(chainId);
  }
  
  // Helper method for standardized error logging
  private logError(message: string, error: any): void {
    console.error(`[CoinMarketCapAdapter] ${message}:`, error);
  }
}

/**
 * Helper function to get rate limit based on CoinMarketCap plan tier
 */
function getRateLimit(tier: string): number {
  switch (tier) {
    case 'basic':
      return 333; // 10k per month / 30 days
    case 'startup':
      return 1000; // 30k per month
    case 'standard':
      return 10000; // 300k per month
    case 'professional':
      return 33333; // 1M per month
    case 'enterprise':
      return 100000; // 3M+ per month
    default:
      return 333; // Default to basic tier
  }
}

/**
 * Helper function to get maximum historical data points based on tier
 */
function getMaxHistoricalDataPoints(tier: string): number {
  switch (tier) {
    case 'basic':
      return 30; // Limited historical data on basic
    case 'hobbyist':
      return 60;
    case 'startup':
      return 100;
    case 'standard':
      return 500;
    case 'professional':
    case 'enterprise':
      return 1000;
    default:
      return 30;
  }
} 