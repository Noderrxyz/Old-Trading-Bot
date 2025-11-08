/**
 * IAdapter - Base interface for all adapters in the Noderr Protocol
 * 
 * All adapters must implement this interface to ensure consistent
 * initialization and status checking capabilities.
 */
export interface IAdapter {
  /**
   * Initialize the adapter with configuration
   * @param config The configuration object for the adapter
   * @returns A promise that resolves when initialization is complete
   */
  initialize(config: any): Promise<void>;
  
  /**
   * Get the current status of the adapter
   * @returns A promise that resolves with the adapter's status information
   */
  getStatus(): Promise<AdapterStatus>;

  /**
   * Shutdown the adapter gracefully
   * @returns A promise that resolves when shutdown is complete
   */
  shutdown(): Promise<void>;
  
  /**
   * Get adapter name
   * @returns The name of the adapter
   */
  getName(): string;
  
  /**
   * Get adapter version
   * @returns The version of the adapter
   */
  getVersion(): string;
  
  /**
   * Reset adapter to a clean state
   * Useful after errors or when changing configurations
   * @returns A promise that resolves when reset is complete
   */
  reset(): Promise<void>;
  
  /**
   * Check if the adapter is initialized
   * @returns True if the adapter is initialized
   */
  isInitialized(): boolean;
  
  /**
   * Get adapter capabilities
   * @returns An array of capability strings this adapter supports
   */
  getCapabilities(): string[];
}

/**
 * AdapterStatus - Common status information for all adapters
 */
export interface AdapterStatus {
  isConnected: boolean;
  name: string;
  version: string;
  latency?: number;
  lastSyncTimestamp?: number;
  errors?: string[];
  warnings?: string[];
  metadata?: Record<string, any>;
}

/**
 * Standard adapter capability flags
 */
export enum AdapterCapability {
  // Core capabilities
  CORE = 'core',
  BALANCE_QUERY = 'balance.query',
  TRADE_EXECUTION = 'trade.execution',
  TRADING = 'trading',
  QUOTE = 'trade.quote',
  TRANSACTION_HISTORY = 'tx.history',
  TRANSACTION_STATUS = 'tx.status',
  TOKEN_METADATA = 'token.metadata',
  EVENT_SUBSCRIPTION = 'event.subscription',
  HISTORICAL_DATA = 'data.historical',
  CROSS_CHAIN = 'chain.cross',
  GAS_ESTIMATION = 'gas.estimation',
  UNIVERSAL_ACCOUNT = 'account.universal',
  
  // Transaction enhancement capabilities
  FLASHBOTS = 'tx.flashbots',
  MEV_PROTECTION = 'tx.mev_protection',
  
  // Chain-specific capabilities
  FEE_MARKET = 'tx.fee_market',          // EIP-1559 support
  MULTICALL = 'chain.multicall',         // Batch multiple calls
  TOKEN_TRANSFER = 'token.transfer',     // Token transfer capability
  NFT_SUPPORT = 'nft.support',           // NFT operations support
  STAKING = 'staking.support',           // Staking operations
  
  // Data retrieval capabilities
  PRICE_FEED = 'data.price_feed',        // Real-time price feeds
  DEFI_METRICS = 'data.defi_metrics',    // DeFi protocol metrics
  NFT_PRICE_FEED = 'data.nft_price',     // NFT price data
  
  // Asset adapter capabilities
  PORTFOLIO = 'portfolio.tracking',      // Portfolio tracking
  NFT_COLLECTION = 'nft.collection',     // NFT collection data
  NFT_SEARCH = 'nft.search'              // NFT search capability
} 