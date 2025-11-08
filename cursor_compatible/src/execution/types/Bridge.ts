import { ChainId } from './ChainId';

/**
 * Represents a bridge between two chains
 */
export interface Bridge {
  /**
   * Unique identifier for the bridge
   */
  id: string;
  
  /**
   * Name of the bridge
   */
  name: string;
  
  /**
   * Source chain ID
   */
  sourceChain: ChainId;
  
  /**
   * Destination chain ID
   */
  destinationChain: ChainId;
  
  /**
   * Contract address of the bridge on the source chain
   */
  sourceAddress: string;
  
  /**
   * Contract address of the bridge on the destination chain
   */
  destinationAddress: string;
  
  /**
   * Whether the bridge is currently active
   */
  isActive: boolean;
  
  /**
   * Minimum amount that can be bridged (in USD)
   */
  minAmountUsd: number;
  
  /**
   * Maximum amount that can be bridged (in USD)
   */
  maxAmountUsd: number;
  
  /**
   * Estimated time to complete the bridge (in seconds)
   */
  estimatedTimeSeconds: number;
  
  /**
   * Fee percentage (e.g. 0.1 for 0.1%)
   */
  feePercentage: number;
  
  /**
   * Optional URL for the bridge's website
   */
  websiteUrl?: string;
  
  /**
   * Optional URL for the bridge's documentation
   */
  docsUrl?: string;
} 