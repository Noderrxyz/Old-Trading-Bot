import { IChainAdapter, Asset, ChainId, TransactionResponse, FeeData } from '../IChainAdapter';

/**
 * Session information for authenticated connections
 */
export interface Session {
  id: string;
  token: string;
  expiresAt: number;
  refreshToken?: string;
  accountId?: string;
}

/**
 * Account status information
 */
export interface AccountStatus {
  accountId: string;
  isActive: boolean;
  chains: ChainInfo[];
  totalValueUSD?: number;
  lastUpdated: number;
}

/**
 * Chain information
 */
export interface ChainInfo {
  id: string;
  name: string;
  chainId: number;
  isSupported: boolean;
  status: 'active' | 'maintenance' | 'inactive';
  nativeToken: {
    symbol: string;
    decimals: number;
  };
}

/**
 * Cross-chain swap parameters
 */
export interface CrossChainSwapParams {
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  amount: string;
  slippageTolerance?: number;
  recipient?: string;
  deadline?: number;
}

/**
 * Cross-chain swap result
 */
export interface SwapResult {
  success: boolean;
  transactionHash?: string;
  fromChainTxHash?: string;
  toChainTxHash?: string;
  status: 'pending' | 'completed' | 'failed';
  estimatedTime?: number;
  actualTime?: number;
  fromAmount: string;
  toAmount: string;
  fee: {
    total: string;
    gasFee?: string;
    bridgeFee?: string;
    protocolFee?: string;
    breakdown?: Record<string, string>;
  };
  route?: string[];
  error?: string;
}

/**
 * Fee estimate for cross-chain operations
 */
export interface FeeEstimate {
  totalFee: string;
  bridgeFee: string;
  gasFee: string;
  protocolFee?: string;
  estimatedTime: number; // in seconds
  priceImpact?: number; // as percentage
}

/**
 * Transaction status
 */
export interface TransactionStatus {
  transactionId: string;
  status: 'pending' | 'confirmed' | 'failed';
  confirmations?: number;
  blockNumber?: number;
  timestamp?: number;
  error?: string;
}

/**
 * ICrossChainAdapter - Interface for cross-chain execution adapters
 * 
 * Extends IChainAdapter with cross-chain specific functionality
 */
export interface ICrossChainAdapter extends IChainAdapter {
  /**
   * Authenticate with the cross-chain service
   * @param credentials Authentication credentials
   * @returns Session information
   */
  authenticate(credentials: Record<string, any>): Promise<Session>;
  
  /**
   * Get the current universal account status
   * @returns Account status information
   */
  getUniversalAccountStatus(): Promise<AccountStatus>;
  
  /**
   * Execute a cross-chain swap
   * @param params Swap parameters
   * @returns Swap result
   */
  executeCrossChainSwap(params: CrossChainSwapParams): Promise<SwapResult>;
  
  /**
   * Estimate fees for a cross-chain operation
   * @param params Swap parameters
   * @returns Fee estimate
   */
  estimateCrossChainFees(params: CrossChainSwapParams): Promise<FeeEstimate>;
  
  /**
   * Get list of supported chains
   * @returns Array of chain information
   */
  getSupportedChains(): Promise<ChainInfo[]>;
  
  /**
   * Get transaction status by ID
   * @param txId Transaction ID
   * @returns Transaction status
   */
  getTransactionStatus(txId: string): Promise<TransactionStatus>;
  
  /**
   * Refresh authentication session
   * @param session Current session
   * @returns New session
   */
  refreshSession?(session: Session): Promise<Session>;
  
  /**
   * Fund the universal account
   * @param chainId Chain to fund from
   * @param token Token to fund with
   * @param amount Amount to fund
   * @returns Transaction response
   */
  fundAccount?(chainId: string, token: string, amount: string): Promise<TransactionResponse>;
} 