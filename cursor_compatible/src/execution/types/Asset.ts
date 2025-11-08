import { ChainId } from './ChainId';

/**
 * Represents a token/asset on a specific chain
 */
export interface Asset {
  /**
   * Chain ID where this asset exists
   */
  chainId: ChainId;
  
  /**
   * Contract address of the asset
   */
  address: string;
  
  /**
   * Symbol of the asset (e.g. "ETH", "USDC")
   */
  symbol: string;
  
  /**
   * Number of decimals for the asset
   */
  decimals: number;
  
  /**
   * Optional name of the asset
   */
  name?: string;
  
  /**
   * Optional logo URL for the asset
   */
  logoUrl?: string;
} 