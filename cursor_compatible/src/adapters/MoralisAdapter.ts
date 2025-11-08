/**
 * MoralisAdapter - Asset adapter implementation using Moralis API
 * 
 * This adapter provides NFT data, token balances, and DeFi positions
 * by querying the Moralis Web3 API.
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
  NFTStandard
} from './IAssetAdapter';
import { Asset } from './IChainAdapter';

/**
 * Extended Asset type with Moralis-specific properties
 */
export interface MoralisAsset extends Asset {
  balance?: string;
}

/**
 * Portfolio interface with proper timestamp as number
 */
export interface Portfolio {
  name: string;
  timestamp: number;
  tokens: MoralisAsset[];
  error?: string;
}

/**
 * Moralis-specific adapter configuration
 */
export interface MoralisAdapterConfig extends Omit<AssetAdapterConfig, 'supportedChains'> {
  apiKey: string; // Moralis API key (required)
  baseCurrency?: string; // Base currency for prices (default: USD)
  nftFetchLimit?: number; // Maximum NFTs to fetch per request
  supportedChains: number[]; // Required supported chains
  version?: string;
  cacheTimeout?: number;
  rateLimitPerMinute?: number;
}

/**
 * Chain ID to Moralis chain name mapping
 */
const CHAIN_TO_MORALIS: Record<number, string> = {
  1: 'eth', // Ethereum
  56: 'bsc', // BSC
  137: 'polygon', // Polygon
  43114: 'avalanche', // Avalanche
  42161: 'arbitrum', // Arbitrum
  10: 'optimism', // Optimism
  8453: 'base', // Base
  // Add more chains as needed
};

/**
 * MoralisAdapter implementation for asset data
 */
export class MoralisAdapter extends BaseAssetAdapter {
  private apiKey: string;
  private chainMap: Map<string, number> = new Map();
  
  // Track API rate limits
  private lastRequestTime: number = 0;
  private requestsThisSecond: number = 0;
  
  // Cached collection metadata
  private collectionMetadataCache: Map<string, NFTCollection> = new Map();
  
  // API URL constants
  private readonly BASE_URL = 'https://deep-index.moralis.io/api/v2';
  
  /**
   * Constructor for Moralis adapter
   * @param config Configuration options
   */
  constructor(config: MoralisAdapterConfig) {
    super({
      supportedChains: config.supportedChains || [1, 56, 137, 43114, 42161, 10, 8453], // Major chains
      apiUrl: 'https://deep-index.moralis.io/api/v2',
      rateLimitPerMinute: config.rateLimitPerMinute || 600, // 10 per second
    });
    
    this.apiKey = config.apiKey;
    this._name = 'MoralisAdapter';
    this._version = config.version || '1.0.0';
    
    // Add adapter capabilities
    this.addCapability(AssetAdapterCapability.PRICE_QUERY);
    this.addCapability(AssetAdapterCapability.HISTORICAL_PRICE);
    this.addCapability(AssetAdapterCapability.NFT_METADATA);
    this.addCapability(AssetAdapterCapability.NFT_COLLECTION);
    this.addCapability(AssetAdapterCapability.NFT_SEARCH);
    this.addCapability(AssetAdapterCapability.BALANCE_QUERY);
    this.addCapability(AssetAdapterCapability.PORTFOLIO);
    
    // Initialize chain mapping
    this.initializeChainMapping();
  }
  
  /**
   * Initialize chain mapping between Moralis chain IDs and ChainId enum
   */
  private initializeChainMapping(): void {
    this.chainMap.set('eth', 1);
    this.chainMap.set('goerli', 5);
    this.chainMap.set('sepolia', 11155111);
    this.chainMap.set('bsc', 56);
    this.chainMap.set('bsc testnet', 97);
    this.chainMap.set('polygon', 137);
    this.chainMap.set('mumbai', 80001);
    this.chainMap.set('avalanche', 43114);
    this.chainMap.set('avalanche testnet', 43113);
    this.chainMap.set('fantom', 250);
    this.chainMap.set('cronos', 25);
    this.chainMap.set('arbitrum', 42161);
    this.chainMap.set('arbitrum goerli', 421613);
    this.chainMap.set('optimism', 10);
    this.chainMap.set('base', 8453);
  }
  
  /**
   * Convert Moralis chain identifier to ChainId
   */
  private moralisChainToChainId(moralisChain: string): number {
    const chainId = this.chainMap.get(moralisChain.toLowerCase());
    if (!chainId) {
      throw new Error(`Unsupported chain: ${moralisChain}`);
    }
    return chainId;
  }
  
  /**
   * Initialize the Moralis adapter
   */
  protected async initializeImpl(): Promise<void> {
    try {
      // Make a test API call to verify connection
      // We'll use a lightweight endpoint like supported chains
      await this.makeRequest('/info/endpointWeights', {});
      console.log('Moralis API connection successful');
    } catch (error) {
      this._lastError = error instanceof Error ? error : new Error(String(error));
      throw new Error(`Failed to initialize Moralis adapter: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Make a request to the Moralis API
   * @param endpoint API endpoint path
   * @param params URL parameters
   * @returns Response data
   */
  private async makeRequest(endpoint: string, params: Record<string, any> = {}): Promise<any> {
    // Handle rate limiting - Moralis limits by requests per second
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
          'X-API-Key': this.apiKey,
          'Accept': 'application/json'
        }
      });
      
      // Handle HTTP errors
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Moralis API error (${response.status}): ${errorText || response.statusText}`);
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
   * Handle API rate limiting - Moralis limits by requests per second
   */
  private async handleRateLimit(): Promise<void> {
    const now = Date.now();
    
    // Reset counter if a second has passed
    if (now - this.lastRequestTime >= 1000) {
      this.requestsThisSecond = 0;
      this.lastRequestTime = now;
    }
    
    // Increment counter
    this.requestsThisSecond++;
    
    // Check if we're exceeding the rate limit (10 requests per second)
    if (this.requestsThisSecond > 10) {
      // Wait until the next second starts
      const timeToWait = 1000 - (now - this.lastRequestTime);
      await new Promise(resolve => setTimeout(resolve, timeToWait > 0 ? timeToWait : 100));
      
      // Reset counters after waiting
      this.requestsThisSecond = 1;
      this.lastRequestTime = Date.now();
    }
  }
  
  /**
   * Get current status of the adapter
   */
  protected async getStatusImpl(): Promise<Partial<AssetAdapterStatus>> {
    return {
      dataSource: 'Moralis',
      refreshInterval: this.config.refreshInterval,
      metadata: {
        cachedNFTCollections: this.collectionMetadataCache.size,
        cachedNFTs: this.nftMetadataCache.size
      }
    };
  }
  
  /**
   * Get token price (not primary function of Moralis adapter)
   * This is a limited implementation
   */
  public async getTokenPrice(symbol: string, chainId: number, address?: string): Promise<TokenPrice> {
    if (!address) {
      throw new Error('Token address is required for Moralis price queries');
    }
    
    const moralisChain = CHAIN_TO_MORALIS[chainId];
    if (!moralisChain) {
      throw new Error(`Chain ID ${chainId} not supported by Moralis`);
    }
    
    // Generate cache key
    const cacheKey = this.getTokenCacheKey(symbol, chainId, address);
    
    // Check cache first
    const cached = this.tokenPriceCache.get(cacheKey);
    if (cached && this.isCacheFresh(cached.timestamp)) {
      this.cacheHits++;
      return cached.data;
    }
    
    this.cacheMisses++;
    
    // Get token price from Moralis
    const data = await this.makeRequest(`/erc20/${address}/price`, {
      chain: moralisChain
    });
    
    // Build the price info
    const tokenPrice: TokenPrice = {
      symbol: symbol,
      address: address,
      chainId,
      priceUsd: data.usdPrice,
      priceChange24h: undefined, // Not available from this endpoint
      priceChange7d: undefined,
      marketCapUsd: undefined,
      fullyDilutedValuationUsd: undefined,
      volume24hUsd: undefined,
      high24h: undefined,
      low24h: undefined,
      ath: undefined,
      athDate: undefined,
      atl: undefined,
      atlDate: undefined,
      lastUpdated: new Date().toISOString(),
      source: PriceSource.AGGREGATOR,
      confidence: 0.8 // Medium-high confidence
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
   * Limited implementation as Moralis is not primarily for token prices
   */
  public async getTokenPrices(tokens: Asset[]): Promise<Map<string, TokenPrice>> {
    const result = new Map<string, TokenPrice>();
    
    // Process tokens one by one (no batch endpoint available)
    for (const token of tokens) {
      if (!token.address) continue; // Skip native tokens
      
      try {
        const price = await this.getTokenPrice(token.symbol, token.chainId, token.address);
        result.set(token.address, price);
      } catch (error) {
        console.error(`Failed to get price for ${token.symbol}:`, error);
        // Continue with other tokens
      }
    }
    
    return result;
  }
  
  /**
   * Get historical price data - Not well supported in Moralis
   */
  public async getHistoricalPrices(
    symbol: string, 
    chainId: number, 
    options: HistoricalPriceOptions,
    address?: string
  ): Promise<PriceDataPoint[]> {
    throw new Error('Historical prices not supported by Moralis adapter');
  }
  
  /**
   * Get NFT metadata
   */
  public async getNFTMetadata(
    collectionAddress: string, 
    tokenId: string, 
    chainId: number
  ): Promise<NFTMetadata> {
    // Generate cache key
    const cacheKey = this.getNFTCacheKey(collectionAddress, tokenId, chainId);
    
    // Check cache first
    const cached = this.nftMetadataCache.get(cacheKey);
    if (cached && this.isCacheFresh(cached.timestamp)) {
      this.cacheHits++;
      return cached.data;
    }
    
    this.cacheMisses++;
    
    const moralisChain = CHAIN_TO_MORALIS[chainId];
    if (!moralisChain) {
      throw new Error(`Chain ID ${chainId} not supported by Moralis`);
    }
    
    // Get NFT metadata from Moralis
    const data = await this.makeRequest(`/nft/${collectionAddress}/${tokenId}`, {
      chain: moralisChain,
      format: 'decimal',
      normalizeMetadata: true
    });
    
    // Determine NFT standard
    let standard: NFTStandard;
    switch (data.contract_type?.toUpperCase()) {
      case 'ERC721':
        standard = NFTStandard.ERC721;
        break;
      case 'ERC1155':
        standard = NFTStandard.ERC1155;
        break;
      default:
        standard = NFTStandard.OTHER;
    }
    
    // Parse attributes
    const attributes = data.normalized_metadata?.attributes?.map((attr: any) => ({
      trait_type: attr.trait_type,
      value: attr.value
    })) || [];
    
    // Build the NFT metadata
    const nftMetadata: NFTMetadata = {
      name: data.normalized_metadata?.name || `${data.name} #${tokenId}`,
      description: data.normalized_metadata?.description,
      image: data.normalized_metadata?.image || data.token_uri,
      attributes,
      externalUrl: data.normalized_metadata?.external_url,
      animationUrl: data.normalized_metadata?.animation_url,
      tokenId,
      collectionName: data.name,
      collectionAddress,
      chainId,
      standard,
      owner: data.owner_of
    };
    
    // Cache the result
    this.nftMetadataCache.set(cacheKey, {
      data: nftMetadata,
      timestamp: Date.now()
    });
    
    return nftMetadata;
  }
  
  /**
   * Get NFT collection
   */
  public async getNFTCollection(
    collectionAddress: string, 
    chainId: number
  ): Promise<NFTCollection> {
    // Generate cache key
    const cacheKey = this.getCollectionCacheKey(collectionAddress, chainId);
    
    // Check cache first
    const cached = this.collectionCache.get(cacheKey);
    if (cached && this.isCacheFresh(cached.timestamp)) {
      this.cacheHits++;
      return cached.data;
    }
    
    this.cacheMisses++;
    
    const moralisChain = CHAIN_TO_MORALIS[chainId];
    if (!moralisChain) {
      throw new Error(`Chain ID ${chainId} not supported by Moralis`);
    }
    
    // Get NFT collection metadata from Moralis
    const data = await this.makeRequest(`/nft/${collectionAddress}/metadata`, {
      chain: moralisChain
    });
    
    // Get collection stats if available
    let stats;
    try {
      stats = await this.makeRequest(`/nft/${collectionAddress}/stats`, {
        chain: moralisChain
      });
    } catch (error) {
      // Stats might not be available for all collections
      console.warn(`Could not fetch stats for collection ${collectionAddress}:`, error);
    }
    
    // Determine NFT standard
    let standard: NFTStandard;
    switch (data.contract_type?.toUpperCase()) {
      case 'ERC721':
        standard = NFTStandard.ERC721;
        break;
      case 'ERC1155':
        standard = NFTStandard.ERC1155;
        break;
      default:
        standard = NFTStandard.OTHER;
    }
    
    // Build the collection info
    const collection: NFTCollection = {
      address: collectionAddress,
      name: data.name,
      symbol: data.symbol,
      description: data.normalized_metadata?.description,
      chainId,
      standard,
      totalSupply: data.synced_at ? stats?.total_supply?.toString() : undefined,
      verified: true, // Assuming verified if in Moralis
      imageUrl: data.normalized_metadata?.image,
      stats: stats ? {
        totalVolume: stats.total_volume?.toString(),
        owners: stats.num_owners,
        sales24h: undefined, // Not directly available
        averagePrice: stats.average_price?.toString()
      } : undefined
    };
    
    // Cache the result
    this.collectionCache.set(cacheKey, {
      data: collection,
      timestamp: Date.now()
    });
    
    return collection;
  }
  
  /**
   * Get NFT floor price history - Not well supported in Moralis
   */
  public async getNFTFloorPriceHistory(options: NFTPriceOptions): Promise<PriceDataPoint[]> {
    throw new Error('NFT floor price history not supported by Moralis adapter');
  }
  
  /**
   * Get NFTs owned by an address
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
    const moralisChain = CHAIN_TO_MORALIS[chainId];
    if (!moralisChain) {
      throw new Error(`Chain ID ${chainId} not supported by Moralis`);
    }
    
    // Get NFTs owned by address from Moralis
    const pageSize = limit || (this.config as MoralisAdapterConfig).nftFetchLimit || 100;
    
    const data = await this.makeRequest(`/${ownerAddress}/nft`, {
      chain: moralisChain,
      format: 'decimal',
      limit: pageSize,
      cursor,
      normalizeMetadata: true
    });
    
    // Transform to NFT metadata
    const nfts: NFTMetadata[] = [];
    
    for (const nft of data.result) {
      // Determine NFT standard
      let standard: NFTStandard;
      switch (nft.contract_type?.toUpperCase()) {
        case 'ERC721':
          standard = NFTStandard.ERC721;
          break;
        case 'ERC1155':
          standard = NFTStandard.ERC1155;
          break;
        default:
          standard = NFTStandard.OTHER;
      }
      
      // Parse attributes
      const attributes = nft.normalized_metadata?.attributes?.map((attr: any) => ({
        trait_type: attr.trait_type,
        value: attr.value
      })) || [];
      
      nfts.push({
        name: nft.normalized_metadata?.name || `${nft.name} #${nft.token_id}`,
        description: nft.normalized_metadata?.description,
        image: nft.normalized_metadata?.image || nft.token_uri,
        attributes,
        externalUrl: nft.normalized_metadata?.external_url,
        animationUrl: nft.normalized_metadata?.animation_url,
        tokenId: nft.token_id,
        collectionName: nft.name,
        collectionAddress: nft.token_address,
        chainId,
        standard,
        owner: ownerAddress
      });
    }
    
    return {
      nfts,
      cursor: data.cursor,
      total: data.total
    };
  }
  
  /**
   * Search for tokens
   */
  public async searchTokens(query: string, chainIds?: number[], limit?: number): Promise<Asset[]> {
    // Moralis doesn't have a direct token search endpoint
    // This is a simplified implementation that just returns
    // tokens that match the query from a limited preset
    throw new Error('Token search not implemented for Moralis adapter');
  }
  
  /**
   * Search NFT collections
   */
  public async searchNFTCollections(query: string, chainIds?: number[], limit?: number): Promise<NFTCollection[]> {
    // Moralis doesn't have a direct collection search endpoint
    throw new Error('NFT collection search not implemented for Moralis adapter');
  }
  
  /**
   * Get DeFi protocols - Not supported by Moralis
   */
  public async getDeFiProtocols(
    chainIds?: number[], 
    types?: string[],
    limit?: number
  ): Promise<DeFiProtocol[]> {
    throw new Error('DeFi protocols not supported by Moralis adapter');
  }
  
  /**
   * Get DeFi protocol details - Not supported by Moralis
   */
  public async getDeFiProtocolDetails(protocolId: string): Promise<DeFiProtocol> {
    throw new Error('DeFi protocol details not supported by Moralis adapter');
  }
  
  /**
   * Get token list from wallet address
   */
  public async getTokenList(walletAddress: string): Promise<TokenList> {
    if (!this._isInitialized) {
      throw new Error("Adapter not initialized");
    }
    
    try {
      const tokens = await this.getUserTokens(walletAddress);
      
      return {
        name: `${walletAddress} Portfolio`,
        timestamp: new Date().toISOString(),
        version: {
          major: 1,
          minor: 0,
          patch: 0
        },
        tokens
      };
    } catch (error) {
      this.logError("Failed to get token list", error);
      
      return {
        name: `${walletAddress} Portfolio`,
        timestamp: new Date().toISOString(),
        version: {
          major: 1,
          minor: 0,
          patch: 0
        },
        tokens: []
      };
    }
  }
  
  /**
   * Get user portfolio with token balances
   */
  public async getPortfolio(walletAddress: string, chainIds?: number[]): Promise<Portfolio> {
    if (!this._isInitialized) {
      throw new Error("Adapter not initialized");
    }
    
    try {
      const tokens = await this.getUserTokens(walletAddress, chainIds);
      
      return {
        name: `${walletAddress} Portfolio`,
        timestamp: Date.now(),
        tokens
      };
    } catch (error) {
      this.logError("Failed to get portfolio", error);
      
      return {
        name: `${walletAddress} Portfolio`,
        timestamp: Date.now(),
        tokens: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Convert ChainId to Moralis chain format
   */
  private chainIdToMoralisChain(chainId: number): string | undefined {
    for (const [chain, id] of this.chainMap.entries()) {
      if (id === chainId) {
        return chain;
      }
    }
    return undefined;
  }
  
  /**
   * Log errors to console
   * @param message Error message
   * @param error Error object
   */
  private logError(message: string, error: unknown): void {
    console.error(`[${this._name}] ${message}:`, error);
  }
} 