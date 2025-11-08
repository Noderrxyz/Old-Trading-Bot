/**
 * Base implementation for asset adapters
 * 
 * Provides common functionality that can be reused across different
 * asset adapter implementations
 */

import { IAssetAdapter, AssetAdapterStatus, TokenPrice, PriceDataPoint, NFTMetadata, 
         NFTCollection, DeFiProtocol, TokenList, HistoricalPriceOptions, 
         NFTPriceOptions, AssetAdapterCapability, PriceSource } from './IAssetAdapter';
import { Asset } from './IChainAdapter';
import { AdapterCapability } from './IAdapter';

/**
 * Configuration options for asset adapters
 */
export interface AssetAdapterConfig {
  supportedChains: number[];
  apiKey?: string;
  apiUrl?: string;
  cacheTimeout?: number; // in milliseconds
  rateLimitPerMinute?: number;
  maxConcurrentRequests?: number;
  proxyUrl?: string;
  defaultLimit?: number;
  telemetryEnabled?: boolean;
  refreshInterval?: number; // in milliseconds
  retryOptions?: {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
  };
}

/**
 * Base asset adapter implementation
 * Provides common functionality for asset adapters
 */
export abstract class BaseAssetAdapter implements IAssetAdapter {
  protected config: AssetAdapterConfig;
  protected _isInitialized: boolean = false;
  protected _version: string = '1.0.0';
  protected _name: string = 'BaseAssetAdapter';
  protected _startTime: number;
  protected _capabilities: Set<string> = new Set();
  protected _lastError?: Error;
  
  // Cache for asset data
  protected tokenPriceCache: Map<string, { data: TokenPrice, timestamp: number }> = new Map();
  protected nftMetadataCache: Map<string, { data: NFTMetadata, timestamp: number }> = new Map();
  protected collectionCache: Map<string, { data: NFTCollection, timestamp: number }> = new Map();
  protected protocolCache: Map<string, { data: DeFiProtocol, timestamp: number }> = new Map();
  
  // Statistics
  protected requestCount: number = 0;
  protected cacheHits: number = 0;
  protected cacheMisses: number = 0;
  protected errorCount: number = 0;
  
  /**
   * Constructor for the base asset adapter
   * @param config Configuration options
   */
  constructor(config?: Partial<AssetAdapterConfig>) {
    this._startTime = Date.now();
    
    this.config = {
      supportedChains: [],
      cacheTimeout: 5 * 60 * 1000, // 5 minutes default
      rateLimitPerMinute: 100,
      maxConcurrentRequests: 10,
      defaultLimit: 100,
      telemetryEnabled: true,
      refreshInterval: 15 * 60 * 1000, // 15 minutes default
      retryOptions: {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 10000
      },
      ...config
    };
    
    // Initialize capabilities
    this._capabilities.add(AdapterCapability.BALANCE_QUERY);
  }
  
  /**
   * Initialize the adapter with configuration
   * Must be called before using the adapter
   * @param config Configuration for the adapter
   */
  public async initialize(config: Partial<AssetAdapterConfig>): Promise<void> {
    // Merge with existing config
    this.config = {
      ...this.config,
      ...config
    };
    
    // Validate configuration
    this.validateConfig();
    
    // Perform adapter-specific initialization
    await this.initializeImpl();
    
    // Start periodic refresh if enabled
    if (this.config.refreshInterval && this.config.refreshInterval > 0) {
      this.startPeriodicRefresh();
    }
    
    this._isInitialized = true;
  }
  
  /**
   * Implementation-specific initialization
   * Should be overridden by concrete adapters
   */
  protected abstract initializeImpl(): Promise<void>;
  
  /**
   * Validate the adapter configuration
   * @throws Error if configuration is invalid
   */
  protected validateConfig(): void {
    if (!this.config.supportedChains || this.config.supportedChains.length === 0) {
      throw new Error(`${this._name}: supportedChains is required and must not be empty`);
    }
    
    if (this.config.apiUrl === undefined && this.requiresApiUrl()) {
      throw new Error(`${this._name}: apiUrl is required for this adapter`);
    }
    
    if (this.config.apiKey === undefined && this.requiresApiKey()) {
      throw new Error(`${this._name}: apiKey is required for this adapter`);
    }
  }
  
  /**
   * Whether this adapter requires an API URL
   * Can be overridden by concrete adapters
   */
  protected requiresApiUrl(): boolean {
    return true;
  }
  
  /**
   * Whether this adapter requires an API key
   * Can be overridden by concrete adapters
   */
  protected requiresApiKey(): boolean {
    return true;
  }
  
  /**
   * Start periodic refresh of data
   */
  protected startPeriodicRefresh(): void {
    const refreshInterval = this.config.refreshInterval || 15 * 60 * 1000;
    
    // Schedule first refresh
    setTimeout(async () => {
      try {
        await this.refreshData(false);
      } catch (error) {
        console.error(`${this._name}: Error during periodic refresh:`, error);
      }
      
      // Schedule subsequent refreshes
      setInterval(async () => {
        try {
          await this.refreshData(false);
        } catch (error) {
          console.error(`${this._name}: Error during periodic refresh:`, error);
        }
      }, refreshInterval);
    }, Math.min(60000, refreshInterval / 2)); // Start first refresh earlier
  }
  
  /**
   * Get the adapter status
   */
  public async getStatus(): Promise<AssetAdapterStatus> {
    const uptime = Date.now() - this._startTime;
    
    const baseStatus: AssetAdapterStatus = {
      isConnected: this._isInitialized,
      name: this._name,
      version: this._version,
      supportedAssetTypes: this.getSupportedAssetTypes(),
      supportedChains: [...this.config.supportedChains],
      indexedAssets: this.getIndexedAssetsCount(),
      lastUpdate: this.getLastUpdateTime(),
      isPriceDataAvailable: this.hasCapability(AssetAdapterCapability.TOKEN_PRICE),
      lastSyncTimestamp: Date.now(),
      metadata: {
        uptime,
        cacheHits: this.cacheHits,
        cacheMisses: this.cacheMisses,
        hitRatio: this.getTotalRequests() > 0 ? this.cacheHits / this.getTotalRequests() : 0,
        errorRate: this.getTotalRequests() > 0 ? this.errorCount / this.getTotalRequests() : 0,
        dataSource: this.getDataSource()
      }
    };
    
    if (this._lastError) {
      baseStatus.errors = [this._lastError.message];
    }
    
    // Get implementation-specific status
    const additionalStatus = await this.getStatusImpl();
    
    return {
      ...baseStatus,
      ...additionalStatus
    };
  }
  
  /**
   * Implementation-specific status
   * Should be overridden by concrete adapters
   */
  protected abstract getStatusImpl(): Promise<Partial<AssetAdapterStatus>>;
  
  /**
   * Get supported asset types
   */
  protected getSupportedAssetTypes(): string[] {
    const types: string[] = [];
    
    if (this.hasCapability(AssetAdapterCapability.TOKEN_PRICE) || 
        this.hasCapability(AssetAdapterCapability.TOKEN_METADATA)) {
      types.push('token');
    }
    
    if (this.hasCapability(AssetAdapterCapability.NFT_METADATA) || 
        this.hasCapability(AssetAdapterCapability.NFT_COLLECTION)) {
      types.push('nft');
    }
    
    if (this.hasCapability(AssetAdapterCapability.DEFI_PROTOCOL)) {
      types.push('defi');
    }
    
    if (types.length === 0) {
      types.push('unknown');
    }
    
    return types;
  }
  
  /**
   * Get the number of indexed assets
   */
  protected getIndexedAssetsCount(): number {
    return this.tokenPriceCache.size + this.nftMetadataCache.size + this.collectionCache.size;
  }
  
  /**
   * Get the last update time
   */
  protected getLastUpdateTime(): number {
    return Date.now(); // Override in concrete adapters
  }
  
  /**
   * Get total requests (hits + misses)
   */
  protected getTotalRequests(): number {
    return this.cacheHits + this.cacheMisses;
  }
  
  /**
   * Get data source name
   */
  protected getDataSource(): string {
    return 'unknown'; // Override in concrete adapters
  }
  
  /**
   * Get token price
   */
  public abstract getTokenPrice(symbol: string, chainId: number, address?: string): Promise<TokenPrice>;
  
  /**
   * Get prices for multiple tokens
   */
  public abstract getTokenPrices(tokens: Asset[]): Promise<Map<string, TokenPrice>>;
  
  /**
   * Get historical price data
   */
  public abstract getHistoricalPrices(
    symbol: string, 
    chainId: number, 
    options: HistoricalPriceOptions,
    address?: string
  ): Promise<PriceDataPoint[]>;
  
  /**
   * Get NFT metadata
   */
  public abstract getNFTMetadata(
    collectionAddress: string, 
    tokenId: string, 
    chainId: number
  ): Promise<NFTMetadata>;
  
  /**
   * Get NFT collection info
   */
  public abstract getNFTCollection(
    collectionAddress: string, 
    chainId: number
  ): Promise<NFTCollection>;
  
  /**
   * Get NFT floor price history
   */
  public abstract getNFTFloorPriceHistory(options: NFTPriceOptions): Promise<PriceDataPoint[]>;
  
  /**
   * Get NFTs owned by an address
   */
  public abstract getNFTsByOwner(
    ownerAddress: string, 
    chainId: number, 
    limit?: number, 
    cursor?: string
  ): Promise<{
    nfts: NFTMetadata[];
    cursor?: string;
    total: number;
  }>;
  
  /**
   * Search for tokens
   */
  public abstract searchTokens(
    query: string, 
    chainIds?: number[], 
    limit?: number
  ): Promise<Asset[]>;
  
  /**
   * Search for NFT collections
   */
  public abstract searchNFTCollections(
    query: string, 
    chainIds?: number[], 
    limit?: number
  ): Promise<NFTCollection[]>;
  
  /**
   * Get DeFi protocols
   */
  public abstract getDeFiProtocols(
    chainIds?: number[], 
    types?: string[],
    limit?: number
  ): Promise<DeFiProtocol[]>;
  
  /**
   * Get DeFi protocol details
   */
  public abstract getDeFiProtocolDetails(protocolId: string): Promise<DeFiProtocol>;
  
  /**
   * Get token list
   */
  public abstract getTokenList(listName: string): Promise<TokenList>;
  
  /**
   * Refresh data from sources
   * @param force Whether to force refresh regardless of cache status
   */
  public abstract refreshData(force?: boolean): Promise<void>;
  
  /**
   * Reset adapter to clean state
   */
  public async reset(): Promise<void> {
    // Clear caches
    this.tokenPriceCache.clear();
    this.nftMetadataCache.clear();
    this.collectionCache.clear();
    this.protocolCache.clear();
    
    // Reset counters
    this.requestCount = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.errorCount = 0;
    
    // Clear last error
    this._lastError = undefined;
    
    // Call implementation-specific reset
    await this.resetImpl();
  }
  
  /**
   * Implementation-specific reset
   * Should be overridden by concrete adapters
   */
  protected abstract resetImpl(): Promise<void>;
  
  /**
   * Check if the adapter is initialized
   */
  public isInitialized(): boolean {
    return this._isInitialized;
  }
  
  /**
   * Get adapter name
   */
  public getName(): string {
    return this._name;
  }
  
  /**
   * Get adapter version
   */
  public getVersion(): string {
    return this._version;
  }
  
  /**
   * Get adapter capabilities
   */
  public getCapabilities(): string[] {
    return Array.from(this._capabilities);
  }
  
  /**
   * Check if adapter has a specific capability
   */
  public hasCapability(capability: string): boolean {
    return this._capabilities.has(capability);
  }
  
  /**
   * Add a capability to the adapter
   */
  protected addCapability(capability: string): void {
    this._capabilities.add(capability);
  }
  
  /**
   * Remove a capability from the adapter
   */
  protected removeCapability(capability: string): void {
    this._capabilities.delete(capability);
  }
  
  /**
   * Shutdown the adapter
   */
  public async shutdown(): Promise<void> {
    // Implement any cleanup needed
    await this.shutdownImpl();
    this._isInitialized = false;
  }
  
  /**
   * Implementation-specific shutdown
   * Should be overridden by concrete adapters
   */
  protected abstract shutdownImpl(): Promise<void>;
  
  /**
   * Helper method to generate cache key for tokens
   */
  protected getTokenCacheKey(symbol: string, chainId: number, address?: string): string {
    return address 
      ? `${chainId}:${address.toLowerCase()}`
      : `${chainId}:${symbol.toUpperCase()}`;
  }
  
  /**
   * Helper method to generate cache key for NFTs
   */
  protected getNFTCacheKey(collectionAddress: string, tokenId: string, chainId: number): string {
    return `${chainId}:${collectionAddress.toLowerCase()}:${tokenId}`;
  }
  
  /**
   * Helper method to generate cache key for collections
   */
  protected getCollectionCacheKey(collectionAddress: string, chainId: number): string {
    return `${chainId}:${collectionAddress.toLowerCase()}`;
  }
  
  /**
   * Helper method to check if data is fresh
   */
  protected isCacheFresh(timestamp: number): boolean {
    const maxAge = this.config.cacheTimeout || 5 * 60 * 1000; // 5 minutes default
    return (Date.now() - timestamp) < maxAge;
  }
} 