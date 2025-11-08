/**
 * CoinGeckoAdapter - Asset adapter implementation using CoinGecko API
 * 
 * This adapter provides token price data, historical charts, and market information
 * by querying the CoinGecko API.
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
  PriceSource
} from './IAssetAdapter';
import { Asset } from './IChainAdapter';

/**
 * CoinGecko-specific adapter configuration
 */
export interface CoinGeckoAdapterConfig extends AssetAdapterConfig {
  proApiKey?: string; // For CoinGecko Pro API access
  useProApi?: boolean; // Whether to use the Pro API
  baseCurrency?: string; // Base currency for prices (default: usd)
  includeMarketData?: boolean; // Whether to include extra market data in responses
}

/**
 * CoinGecko API endpoints
 */
const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';
const COINGECKO_PRO_API_BASE = 'https://pro-api.coingecko.com/api/v3';

/**
 * Chain ID to CoinGecko platform ID mapping
 */
const CHAIN_TO_PLATFORM: Record<number, string> = {
  1: 'ethereum', // Ethereum Mainnet
  56: 'binance-smart-chain', // BSC
  137: 'polygon-pos', // Polygon
  43114: 'avalanche', // Avalanche
  42161: 'arbitrum-one', // Arbitrum
  10: 'optimistic-ethereum', // Optimism
  8453: 'base', // Base
  // Add more chains as needed
};

/**
 * Chain ID to CoinGecko network ID mapping for NFT data
 */
const CHAIN_TO_NFT_NETWORK: Record<number, string> = {
  1: 'ethereum',
  56: 'bsc',
  137: 'polygon',
  43114: 'avalanche',
  // Add more as supported by CoinGecko
};

/**
 * CoinGecko adapter implementation for asset data
 */
export class CoinGeckoAdapter extends BaseAssetAdapter {
  // Map to store coin ID lookups
  private coinIdMap: Map<string, string> = new Map();
  
  // Track API rate limits
  private lastRequestTime: number = 0;
  private requestsThisMinute: number = 0;
  private minuteStartTime: number = 0;
  
  /**
   * Constructor for CoinGecko adapter
   * @param config Configuration options
   */
  constructor(config?: Partial<CoinGeckoAdapterConfig>) {
    super({
      supportedChains: [1, 56, 137, 43114, 42161, 10, 8453], // Default supported chains
      apiUrl: COINGECKO_API_BASE,
      rateLimitPerMinute: 10, // Free API limit (10-50 calls per minute)
      cacheTimeout: 5 * 60 * 1000, // 5 minutes
      ...config
    });
    
    this._name = 'CoinGeckoAdapter';
    this._version = '1.0.0';
    
    // Initialize capabilities
    this.addCapability(AssetAdapterCapability.TOKEN_PRICE);
    this.addCapability(AssetAdapterCapability.TOKEN_METADATA);
    this.addCapability(AssetAdapterCapability.HISTORICAL_PRICES);
    this.addCapability(AssetAdapterCapability.TOKEN_SEARCH);
    
    // Add NFT and protocol capabilities if not using free API
    if ((config as CoinGeckoAdapterConfig)?.useProApi) {
      this.addCapability(AssetAdapterCapability.NFT_METADATA);
      this.addCapability(AssetAdapterCapability.NFT_COLLECTION);
      this.addCapability(AssetAdapterCapability.DEFI_PROTOCOL);
    }
  }
  
  /**
   * Initialize the CoinGecko adapter
   */
  protected async initializeImpl(): Promise<void> {
    // Check if using Pro API
    if ((this.config as CoinGeckoAdapterConfig).useProApi) {
      if (!(this.config as CoinGeckoAdapterConfig).proApiKey) {
        throw new Error('Pro API key is required when useProApi is true');
      }
      
      // Update API URL and rate limits for Pro API
      this.config.apiUrl = COINGECKO_PRO_API_BASE;
      this.config.rateLimitPerMinute = 500; // Pro tier allows more requests
    }
    
    // Validate API connection by making a simple ping request
    try {
      await this.makeRequest('/ping');
      console.log('CoinGecko API connection successful');
      
      // Pre-fetch supported coins list
      await this.fetchCoinsList();
    } catch (error) {
      this._lastError = error instanceof Error ? error : new Error(String(error));
      throw new Error(`Failed to initialize CoinGecko adapter: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Make a request to the CoinGecko API
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
    const baseUrl = this.config.apiUrl as string;
    const url = new URL(`${baseUrl}${endpoint}`);
    
    // Add API key for Pro API
    if ((this.config as CoinGeckoAdapterConfig).useProApi) {
      params.x_cg_pro_api_key = (this.config as CoinGeckoAdapterConfig).proApiKey;
    }
    
    // Add query parameters
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });
    
    try {
      // Make the request
      const response = await fetch(url.toString());
      
      // Handle HTTP errors
      if (!response.ok) {
        throw new Error(`CoinGecko API error (${response.status}): ${response.statusText}`);
      }
      
      // Parse the response
      const data = await response.json();
      return data;
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
    const rateLimit = this.config.rateLimitPerMinute || 10;
    if (this.requestsThisMinute > rateLimit) {
      // Calculate time to wait until next minute starts
      const timeToWait = 60000 - (now - this.minuteStartTime);
      console.warn(`Rate limit reached, waiting ${timeToWait}ms before next request`);
      await new Promise(resolve => setTimeout(resolve, timeToWait));
      
      // Reset counters after waiting
      this.minuteStartTime = Date.now();
      this.requestsThisMinute = 1;
    }
    
    // Ensure we're not making requests too quickly (at least 100ms between requests)
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < 100) {
      await new Promise(resolve => setTimeout(resolve, 100 - timeSinceLastRequest));
    }
    
    this.lastRequestTime = Date.now();
  }
  
  /**
   * Fetch and cache the list of coins from CoinGecko
   */
  private async fetchCoinsList(): Promise<void> {
    try {
      const data = await this.makeRequest('/coins/list');
      
      // Update coin ID map
      for (const coin of data) {
        // Map lowercase symbol to ID
        this.coinIdMap.set(coin.symbol.toLowerCase(), coin.id);
        
        // Also map ID to itself for direct lookups
        this.coinIdMap.set(coin.id, coin.id);
      }
      
      console.log(`Loaded ${data.length} coins from CoinGecko`);
    } catch (error) {
      console.error('Failed to fetch coins list:', error);
      throw error;
    }
  }
  
  /**
   * Get coin ID from symbol
   * @param symbol Coin symbol
   * @returns Coin ID or undefined if not found
   */
  private getCoinId(symbol: string): string | undefined {
    return this.coinIdMap.get(symbol.toLowerCase());
  }
  
  /**
   * Get detailed information about a coin
   * @param coinId CoinGecko coin ID
   * @returns Coin data
   */
  private async getCoinData(coinId: string): Promise<any> {
    return this.makeRequest(`/coins/${coinId}`, {
      localization: false,
      tickers: false,
      market_data: true,
      community_data: false,
      developer_data: false,
      sparkline: false
    });
  }
  
  /**
   * Get platform-specific token info by contract address
   * @param address Token contract address
   * @param chainId Chain ID
   * @returns Token data
   */
  private async getTokenByAddress(address: string, chainId: number): Promise<any | null> {
    // Get platform ID for chain
    const platform = CHAIN_TO_PLATFORM[chainId];
    if (!platform) {
      throw new Error(`Chain ID ${chainId} not supported by CoinGecko`);
    }
    
    try {
      const data = await this.makeRequest(`/coins/${platform}/contract/${address}`);
      return data;
    } catch (error) {
      // Token might not be found, return null in this case
      return null;
    }
  }
  
  /**
   * Get current status of the adapter
   */
  protected async getStatusImpl(): Promise<Partial<AssetAdapterStatus>> {
    return {
      dataSource: 'CoinGecko',
      refreshInterval: this.config.refreshInterval,
      metadata: {
        useProApi: (this.config as CoinGeckoAdapterConfig).useProApi,
        cachedCoins: this.coinIdMap.size,
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
    let coinId: string | undefined;
    
    // If we have the address, try to get token by address
    if (address) {
      const tokenData = await this.getTokenByAddress(address, chainId);
      if (tokenData) {
        coinId = tokenData.id;
      }
    }
    
    // If we couldn't find by address or don't have an address, try by symbol
    if (!coinId) {
      coinId = this.getCoinId(symbol);
      
      // If still not found, try to search for it
      if (!coinId) {
        const searchResults = await this.searchTokens(symbol);
        const matchingToken = searchResults.find(t => 
          t.symbol.toLowerCase() === symbol.toLowerCase() && 
          t.chainId === chainId
        );
        
        if (matchingToken && matchingToken.address) {
          const tokenData = await this.getTokenByAddress(matchingToken.address, chainId);
          if (tokenData) {
            coinId = tokenData.id;
          }
        }
      }
    }
    
    if (!coinId) {
      throw new Error(`Could not find token ${symbol} on chain ${chainId}`);
    }
    
    // Get data from CoinGecko
    const data = await this.getCoinData(coinId);
    
    // Determine base currency
    const baseCurrency = (this.config as CoinGeckoAdapterConfig).baseCurrency || 'usd';
    
    // Build the price info
    const tokenPrice: TokenPrice = {
      symbol: data.symbol.toUpperCase(),
      address: address,
      chainId,
      priceUsd: data.market_data.current_price[baseCurrency] || 0,
      priceChange24h: data.market_data.price_change_percentage_24h,
      priceChange7d: data.market_data.price_change_percentage_7d,
      marketCapUsd: data.market_data.market_cap[baseCurrency],
      fullyDilutedValuationUsd: data.market_data.fully_diluted_valuation?.[baseCurrency],
      volume24hUsd: data.market_data.total_volume[baseCurrency],
      high24h: data.market_data.high_24h[baseCurrency],
      low24h: data.market_data.low_24h[baseCurrency],
      ath: data.market_data.ath[baseCurrency],
      athDate: data.market_data.ath_date[baseCurrency],
      atl: data.market_data.atl[baseCurrency],
      atlDate: data.market_data.atl_date[baseCurrency],
      lastUpdated: data.last_updated,
      source: PriceSource.COINGECKO,
      confidence: 0.9 // High confidence for CoinGecko data
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
    
    // Process tokens in batches to avoid rate limiting
    const batchSize = 10;
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      
      // Process batch in parallel
      const promises = batch.map(token => {
        return this.getTokenPrice(token.symbol, token.chainId, token.address)
          .then(price => {
            // Add to result map using address or symbol as key
            const key = token.address ? token.address : `${token.chainId}:${token.symbol}`;
            result.set(key, price);
          })
          .catch(error => {
            console.error(`Failed to get price for ${token.symbol}:`, error);
            // Continue with other tokens on error
          });
      });
      
      // Wait for batch to complete
      await Promise.all(promises);
      
      // Add a small delay between batches to avoid rate limiting
      if (i + batchSize < tokens.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
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
    // First determine the coin ID
    let coinId: string | undefined;
    
    // Try by address if provided
    if (address) {
      const tokenData = await this.getTokenByAddress(address, chainId);
      if (tokenData) {
        coinId = tokenData.id;
      }
    }
    
    // If not found by address, try by symbol
    if (!coinId) {
      coinId = this.getCoinId(symbol);
    }
    
    if (!coinId) {
      throw new Error(`Could not find token ${symbol} on chain ${chainId}`);
    }
    
    // Map interval to CoinGecko days parameter
    let days: number;
    switch (options.interval) {
      case '1m':
      case '5m':
      case '15m':
      case '30m':
      case '1h':
        days = 1;
        break;
      case '4h':
        days = 7;
        break;
      case '1d':
        days = options.limit ? Math.min(options.limit, 90) : 90;
        break;
      case '1w':
        days = options.limit ? Math.min(options.limit * 7, 365) : 365;
        break;
      case '1mo':
        days = options.limit ? Math.min(options.limit * 30, 365) : 365;
        break;
      default:
        days = 30;
    }
    
    // Determine date range if specified
    let fromTimestamp: number | undefined;
    let toTimestamp: number | undefined;
    
    if (options.from) {
      fromTimestamp = options.from;
      days = undefined as any; // Use from/to instead of days
    }
    
    if (options.to) {
      toTimestamp = options.to;
      days = undefined as any; // Use from/to instead of days
    }
    
    // Get data from CoinGecko
    const currency = options.currency?.toLowerCase() || 'usd';
    
    // Choose appropriate endpoint based on the interval
    let data: any;
    
    if (['1m', '5m', '15m', '30m', '1h'].includes(options.interval)) {
      // For hourly data
      data = await this.makeRequest(`/coins/${coinId}/market_chart`, {
        vs_currency: currency,
        days: days,
        interval: options.interval === '1h' ? 'hourly' : null,
        from: fromTimestamp,
        to: toTimestamp
      });
    } else {
      // For daily data
      data = await this.makeRequest(`/coins/${coinId}/market_chart`, {
        vs_currency: currency,
        days: days,
        from: fromTimestamp,
        to: toTimestamp
      });
    }
    
    // Transform the data into the expected format
    const prices: PriceDataPoint[] = data.prices.map((price: number[]) => {
      const timestamp = price[0];
      const priceValue = price[1];
      
      // Find matching volume and market cap entries
      const volumeEntry = data.total_volumes.find((v: number[]) => v[0] === timestamp);
      const marketCapEntry = data.market_caps.find((m: number[]) => m[0] === timestamp);
      
      return {
        timestamp: Math.floor(timestamp / 1000), // Convert ms to seconds
        priceUsd: priceValue,
        volume: volumeEntry ? volumeEntry[1] : undefined,
        marketCap: marketCapEntry ? marketCapEntry[1] : undefined
      };
    });
    
    return prices;
  }
  
  /**
   * Search for tokens
   */
  public async searchTokens(query: string, chainIds?: number[], limit?: number): Promise<Asset[]> {
    // Search coins in CoinGecko
    const data = await this.makeRequest('/search', {
      query: query
    });
    
    // Filter and transform results
    const coins = data.coins || [];
    const maxResults = limit || this.config.defaultLimit || 100;
    
    const results: Asset[] = [];
    
    for (const coin of coins.slice(0, maxResults)) {
      // Only include tokens for specified chains
      if (chainIds) {
        const matchingPlatforms = Object.entries(coin.platforms || {})
          .filter(([platform]) => {
            // Convert platform to chain ID
            const matchingChainId = Object.entries(CHAIN_TO_PLATFORM)
              .find(([_, platformId]) => platformId === platform)?.[0];
            
            return matchingChainId && chainIds.includes(Number(matchingChainId));
          });
        
        if (matchingPlatforms.length === 0) {
          continue;
        }
        
        // Add each platform as a separate asset
        for (const [platform, address] of matchingPlatforms) {
          // Get chain ID for platform
          const chainId = Number(Object.entries(CHAIN_TO_PLATFORM)
            .find(([_, platformId]) => platformId === platform)?.[0]);
          
          if (!chainId) continue;
          
          results.push({
            symbol: coin.symbol.toUpperCase(),
            name: coin.name,
            decimals: 18, // Default, will be overridden when actually used
            chainId,
            address: address ? String(address) : undefined,
            logoURI: coin.large,
            isNative: !address,
            coingeckoId: coin.id
          });
        }
      } else {
        // If no chain filter, return an entry for each supported chain
        // This is a simplified approach - real implementation would check
        // which chains actually support this token
        for (const chainId of this.config.supportedChains) {
          results.push({
            symbol: coin.symbol.toUpperCase(),
            name: coin.name,
            decimals: 18, // Default, will be overridden when actually used
            chainId,
            logoURI: coin.large,
            isNative: coin.symbol.toLowerCase() === 'eth' || 
                     coin.symbol.toLowerCase() === 'bnb' ||
                     coin.symbol.toLowerCase() === 'matic' ||
                     coin.symbol.toLowerCase() === 'avax',
            coingeckoId: coin.id
          });
        }
      }
    }
    
    return results;
  }
  
  /**
   * Get NFT metadata - Placeholder implementation
   */
  public async getNFTMetadata(
    collectionAddress: string, 
    tokenId: string, 
    chainId: number
  ): Promise<NFTMetadata> {
    throw new Error('NFT metadata not implemented in CoinGecko adapter');
  }
  
  /**
   * Get NFT collection - Placeholder implementation
   */
  public async getNFTCollection(
    collectionAddress: string, 
    chainId: number
  ): Promise<NFTCollection> {
    throw new Error('NFT collection not implemented in CoinGecko adapter');
  }
  
  /**
   * Get NFT floor price history - Placeholder implementation
   */
  public async getNFTFloorPriceHistory(options: NFTPriceOptions): Promise<PriceDataPoint[]> {
    throw new Error('NFT floor price history not implemented in CoinGecko adapter');
  }
  
  /**
   * Get NFTs by owner - Placeholder implementation
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
    throw new Error('NFTs by owner not implemented in CoinGecko adapter');
  }
  
  /**
   * Search NFT collections - Placeholder implementation
   */
  public async searchNFTCollections(
    query: string, 
    chainIds?: number[], 
    limit?: number
  ): Promise<NFTCollection[]> {
    throw new Error('NFT collection search not implemented in CoinGecko adapter');
  }
  
  /**
   * Get DeFi protocols - Placeholder implementation
   */
  public async getDeFiProtocols(
    chainIds?: number[], 
    types?: string[],
    limit?: number
  ): Promise<DeFiProtocol[]> {
    throw new Error('DeFi protocols not implemented in CoinGecko adapter');
  }
  
  /**
   * Get DeFi protocol details - Placeholder implementation
   */
  public async getDeFiProtocolDetails(protocolId: string): Promise<DeFiProtocol> {
    throw new Error('DeFi protocol details not implemented in CoinGecko adapter');
  }
  
  /**
   * Get token list - Basic implementation
   */
  public async getTokenList(listName: string): Promise<TokenList> {
    // For CoinGecko, we'll create a simple token list from top tokens
    const data = await this.makeRequest('/coins/markets', {
      vs_currency: 'usd',
      order: 'market_cap_desc',
      per_page: 100,
      page: 1,
      sparkline: false
    });
    
    const tokens: Asset[] = data.map((coin: any) => ({
      symbol: coin.symbol.toUpperCase(),
      name: coin.name,
      decimals: 18, // Default
      chainId: 1, // Default to Ethereum
      logoURI: coin.image,
      coingeckoId: coin.id,
      usdPrice: coin.current_price
    }));
    
    return {
      name: `CoinGecko ${listName}`,
      timestamp: new Date().toISOString(),
      version: {
        major: 1,
        minor: 0,
        patch: 0
      },
      tokens,
      logoURI: 'https://static.coingecko.com/s/thumbnail-007177f3eca19695592f0b8b0eabbdae282b54154e1be912285c9034ea6cbaf2.png'
    };
  }
  
  /**
   * Refresh data from CoinGecko
   */
  public async refreshData(force: boolean = false): Promise<void> {
    // If forced, clear caches
    if (force) {
      this.tokenPriceCache.clear();
      this.coinIdMap.clear();
    }
    
    // Re-fetch coins list
    await this.fetchCoinsList();
  }
  
  /**
   * Implementation-specific reset
   */
  protected async resetImpl(): Promise<void> {
    // Clear coin ID map
    this.coinIdMap.clear();
    
    // Reset rate limit tracking
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
    return (this.config as CoinGeckoAdapterConfig).useProApi
      ? 'CoinGecko Pro API'
      : 'CoinGecko API';
  }
  
  /**
   * Whether this adapter requires an API key
   */
  protected requiresApiKey(): boolean {
    return Boolean((this.config as CoinGeckoAdapterConfig).useProApi);
  }
} 