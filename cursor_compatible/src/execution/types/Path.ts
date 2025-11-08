import { Asset } from './Asset';
import { ChainId } from './ChainId';

/**
 * Represents a single hop in a cross-chain path
 */
export interface PathHop {
  /**
   * Source chain ID
   */
  fromChain: ChainId;
  
  /**
   * Destination chain ID
   */
  toChain: ChainId;
  
  /**
   * ID of the bridge to use
   */
  bridge: string;
  
  /**
   * Asset being transferred
   */
  asset: Asset;
}

/**
 * Represents a complete path for a cross-chain transaction
 */
export interface Path {
  /**
   * List of hops in the path
   */
  hops: PathHop[];
  
  /**
   * Source asset
   */
  fromAsset: Asset;
  
  /**
   * Destination asset
   */
  toAsset: Asset;
  
  /**
   * Amount to transfer
   */
  amount: string;
} 