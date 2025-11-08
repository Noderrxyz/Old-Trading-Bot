/**
 * IAssetAdapter - Interface for asset-specific adapters
 * 
 * This interface defines the contract for adapters that deal with various
 * asset types including tokens, NFTs, and other digital assets.
 */

import { IAdapter, AdapterStatus, AdapterCapability } from './IAdapter';
import { Asset, AssetInfo } from './IChainAdapter';

/**
 * NFT Metadata structure
 */
export interface NFTMetadata {
  name?: string;
  description?: string;
  image?: string;
  attributes?: Array<{
    trait_type: string;
    value: string | number;
  }>;
  externalUrl?: string;
  animationUrl?: string;
  backgroundColor?: string;
  tokenId: string;
  collectionName?: string;
  collectionAddress: string;
  chainId: number;
  standard: NFTStandard;
  owner?: string;
  lastSalePrice?: {
    amount: string;
    currency: string;
    usdValue?: number;
  };
  rarityRank?: number;
  rarityScore?: number;
}

/**
 * NFT Collection information
 */
export interface NFTCollection {
  address: string;
  name: string;
  symbol?: string;
  description?: string;
  chainId: number;
  standard: NFTStandard;
  totalSupply?: string;
  floorPrice?: {
    amount: string;
    currency: string;
    usdValue?: number;
  };
  verified: boolean;
  createdAt?: number;
  creator?: string;
  imageUrl?: string;
  bannerUrl?: string;
  website?: string;
  twitter?: string;
  discord?: string;
  stats?: {
    totalVolume?: string;
    owners?: number;
    sales24h?: number;
    averagePrice?: string;
  };
}

/**
 * NFT standard types
 */
export enum NFTStandard {
  ERC721 = 'ERC721',
  ERC1155 = 'ERC1155',
  SPL = 'SPL', // Solana
  OTHER = 'OTHER'
}

/**
 * DeFi Protocol types
 */
export enum DeFiProtocolType {
  DEX = 'dex',
  LENDING = 'lending',
  YIELD = 'yield',
  DERIVATIVES = 'derivatives',
  INSURANCE = 'insurance',
  ASSET_MANAGEMENT = 'asset_management',
  PAYMENT = 'payment',
  BRIDGE = 'bridge',
  DAO = 'dao',
  OTHER = 'other'
}

/**
 * DeFi Protocol information
 */
export interface DeFiProtocol {
  id: string;
  name: string;
  type: DeFiProtocolType;
  chainIds: number[]; // Supported chains
  description?: string;
  website?: string;
  tvlUsd?: number; // Total Value Locked in USD
  volumeUsd24h?: number;
  feesUsd24h?: number;
  tokens?: string[]; // Protocol token addresses
  verified: boolean;
  logoUrl?: string;
  risks?: string[]; // Potential risks associated with the protocol
  audits?: {
    auditor: string;
    date: number;
    report?: string;
  }[];
}

/**
 * Token List - Collection of tokens that adhere to a standard format
 */
export interface TokenList {
  name: string;
  timestamp: string;
  version: {
    major: number;
    minor: number;
    patch: number;
  };
  tokens: Asset[];
  logoURI?: string;
  keywords?: string[];
  tags?: Record<string, {
    name: string;
    description: string;
  }>;
}

/**
 * Status for asset adapter
 */
export interface AssetAdapterStatus extends AdapterStatus {
  supportedAssetTypes: string[];
  supportedChains: number[];
  indexedAssets: number;
  lastUpdate: number;
  isPriceDataAvailable: boolean;
  dataSource?: string;
  refreshInterval?: number;
}

/**
 * Asset adapter capabilities
 */
export enum AssetAdapterCapability {
  PRICE_QUERY = 'price.query',
  HISTORICAL_PRICE = 'price.historical',
  TOKEN_METADATA = 'token.metadata',
  TOKEN_LIST = 'token.list',
  TOKEN_SEARCH = 'token.search',
  NFT_METADATA = 'nft.metadata',
  NFT_COLLECTION = 'nft.collection',
  NFT_FLOOR_PRICE = 'nft.floor_price',
  NFT_SEARCH = 'nft.search',
  NFT_OWNER_QUERY = 'nft.owner_query',
  DEFI_PROTOCOL = 'defi.protocol',
  BALANCE_QUERY = 'balance.query',
  PORTFOLIO = 'portfolio.tracking'
}

/**
 * Token price source
 */
export enum PriceSource {
  DEX = 'dex',
  CEX = 'cex',
  ORACLE = 'oracle',
  AGGREGATOR = 'aggregator',
  COINGECKO = 'coingecko',
  CUSTOM = 'custom'
}

/**
 * Token price information
 */
export interface TokenPrice {
  symbol: string;
  address?: string;
  chainId: number;
  priceUsd: number;
  priceChange24h?: number;
  priceChange7d?: number;
  marketCapUsd?: number;
  fullyDilutedValuationUsd?: number;
  volume24hUsd?: number;
  high24h?: number;
  low24h?: number;
  ath?: number;
  athDate?: string;
  atl?: number;
  atlDate?: string;
  lastUpdated: string;
  source: PriceSource;
  confidence?: number; // 0-1 scale, confidence in price accuracy
}

/**
 * Historical price data point
 */
export interface PriceDataPoint {
  timestamp: number;
  priceUsd: number;
  volume?: number;
  marketCap?: number;
}

/**
 * Historical price data options
 */
export interface HistoricalPriceOptions {
  interval: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1mo';
  limit?: number;
  from?: number; // Unix timestamp
  to?: number; // Unix timestamp
  currency?: string; // Default USD
}

/**
 * NFT price data options
 */
export interface NFTPriceOptions {
  collectionAddress: string;
  chainId: number;
  days?: number;
  currency?: string; // Default USD
}

/**
 * Token list options for filtering
 */
export interface TokenListOptions {
  limit?: number;
  sortBy?: 'market_cap' | 'volume_24h' | 'price_change_24h' | 'name' | 'symbol';
  sortDirection?: 'asc' | 'desc';
  category?: string;
  priceChangeFilter?: {
    min?: number;
    max?: number;
  };
  chains?: number[];
}

/**
 * Portfolio structure for wallet assets
 */
export interface Portfolio {
  name: string;
  timestamp: string;
  tokens: Asset[];
  totalValueUsd?: number;
  error?: string;
}

/**
 * IAssetAdapter - Interface for adapters that handle asset data
 */
export interface IAssetAdapter extends IAdapter {
  /**
   * Get current price for a token
   * @param symbol Token symbol (e.g., 'ETH')
   * @param chainId Blockchain chain ID
   * @param address Optional token address for non-native tokens
   * @returns Promise resolving to token price information
   */
  getTokenPrice(symbol: string, chainId: number, address?: string): Promise<TokenPrice>;
  
  /**
   * Get prices for multiple tokens
   * @param tokens Array of assets to get prices for
   * @returns Promise resolving to a map of token addresses to prices
   */
  getTokenPrices(tokens: Asset[]): Promise<Map<string, TokenPrice>>;
  
  /**
   * Get historical price data for a token
   * @param symbol Token symbol
   * @param chainId Blockchain chain ID
   * @param options Historical data options
   * @param address Optional token address for non-native tokens
   * @returns Promise resolving to array of price data points
   */
  getHistoricalPrices(
    symbol: string, 
    chainId: number, 
    options: HistoricalPriceOptions,
    address?: string
  ): Promise<PriceDataPoint[]>;
  
  /**
   * Get metadata for an NFT
   * @param collectionAddress NFT collection address
   * @param tokenId Token ID within the collection
   * @param chainId Blockchain chain ID
   * @returns Promise resolving to NFT metadata
   */
  getNFTMetadata(collectionAddress: string, tokenId: string, chainId: number): Promise<NFTMetadata>;
  
  /**
   * Get information about an NFT collection
   * @param collectionAddress Collection contract address
   * @param chainId Blockchain chain ID
   * @returns Promise resolving to collection information
   */
  getNFTCollection(collectionAddress: string, chainId: number): Promise<NFTCollection>;
  
  /**
   * Get floor price history for an NFT collection
   * @param options NFT price options
   * @returns Promise resolving to array of price data points
   */
  getNFTFloorPriceHistory(options: NFTPriceOptions): Promise<PriceDataPoint[]>;
  
  /**
   * Get NFTs owned by an address
   * @param ownerAddress Wallet address
   * @param chainId Blockchain chain ID
   * @param limit Optional result limit
   * @param cursor Optional pagination cursor
   * @returns Promise resolving to NFTs owned by the address
   */
  getNFTsByOwner(
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
   * Search for tokens by name, symbol, or address
   * @param query Search query
   * @param chainIds Optional array of chain IDs to search
   * @param limit Optional result limit
   * @returns Promise resolving to matching tokens
   */
  searchTokens(query: string, chainIds?: number[], limit?: number): Promise<Asset[]>;
  
  /**
   * Search for NFT collections
   * @param query Search query
   * @param chainIds Optional array of chain IDs to search
   * @param limit Optional result limit
   * @returns Promise resolving to matching collections
   */
  searchNFTCollections(query: string, chainIds?: number[], limit?: number): Promise<NFTCollection[]>;
  
  /**
   * Get information about DeFi protocols
   * @param chainIds Optional array of chain IDs to filter
   * @param types Optional array of protocol types to filter
   * @param limit Optional result limit
   * @returns Promise resolving to protocol information
   */
  getDeFiProtocols(
    chainIds?: number[], 
    types?: DeFiProtocolType[],
    limit?: number
  ): Promise<DeFiProtocol[]>;
  
  /**
   * Get detailed information about a DeFi protocol
   * @param protocolId Protocol ID
   * @returns Promise resolving to detailed protocol information
   */
  getDeFiProtocolDetails(protocolId: string): Promise<DeFiProtocol>;
  
  /**
   * Get a token list (e.g., for a DEX or a standard list like CoinGecko)
   * @param listName List name or URL
   * @returns Promise resolving to token list
   */
  getTokenList(listName: string): Promise<TokenList>;
  
  /**
   * Get the adapter status
   * @returns Promise resolving to asset adapter status
   */
  getStatus(): Promise<AssetAdapterStatus>;
  
  /**
   * Refresh data from sources
   * Useful for adapters that cache data
   * @param force Whether to force refresh regardless of cache status
   * @returns Promise resolving when refresh is complete
   */
  refreshData(force?: boolean): Promise<void>;
} 