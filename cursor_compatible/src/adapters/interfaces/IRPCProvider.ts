/**
 * RPC Provider Interface
 * 
 * Standardized interface for blockchain RPC providers.
 * Supports both real blockchain connections and mock simulation.
 */

export interface BlockInfo {
  number: number;
  hash: string;
  parentHash: string;
  timestamp: number;
  gasUsed: number;
  gasLimit: number;
  difficulty?: string;
  totalDifficulty?: string;
  nonce?: string;
  baseFeePerGas?: number;
}

export interface TransactionInfo {
  hash: string;
  blockNumber: number;
  blockHash: string;
  transactionIndex: number;
  from: string;
  to: string;
  value: string;
  gas: number;
  gasPrice: number;
  gasUsed?: number;
  status?: number;
  input: string;
  nonce: number;
  timestamp?: number;
}

export interface TransactionReceipt {
  transactionHash: string;
  transactionIndex: number;
  blockNumber: number;
  blockHash: string;
  from: string;
  to: string;
  gasUsed: number;
  cumulativeGasUsed: number;
  contractAddress?: string;
  logs: LogEntry[];
  status: number;
  effectiveGasPrice?: number;
}

export interface LogEntry {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number;
  transactionHash: string;
  transactionIndex: number;
  blockHash: string;
  logIndex: number;
  removed: boolean;
}

export interface GasEstimate {
  gasLimit: number;
  gasPrice: number;
  maxFeePerGas?: number;
  maxPriorityFeePerGas?: number;
  estimatedCost: number;
  estimatedTimeSeconds: number;
}

export interface NetworkStatus {
  chainId: number;
  blockNumber: number;
  gasPrice: number;
  peerCount: number;
  syncing: boolean;
  networkId: number;
}

export interface ContractCallRequest {
  to: string;
  data: string;
  from?: string;
  gas?: number;
  gasPrice?: number;
  value?: string;
  blockNumber?: number | 'latest' | 'pending';
}

export interface ContractCallResult {
  result: string;
  gasUsed?: number;
  success: boolean;
  error?: string;
}

/**
 * Main RPC Provider Interface
 */
export interface IRPCProvider {
  /**
   * Provider identification
   */
  getProviderId(): string;
  getProviderName(): string;
  getChainId(): Promise<number>;
  getNetworkId(): Promise<number>;
  
  /**
   * Connection management
   */
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  
  /**
   * Block operations
   */
  getBlockNumber(): Promise<number>;
  getBlock(blockNumber: number | 'latest' | 'pending'): Promise<BlockInfo>;
  getBlockWithTransactions(blockNumber: number | 'latest' | 'pending'): Promise<BlockInfo & { transactions: TransactionInfo[] }>;
  
  /**
   * Transaction operations
   */
  getTransaction(hash: string): Promise<TransactionInfo>;
  getTransactionReceipt(hash: string): Promise<TransactionReceipt>;
  sendRawTransaction(signedTransaction: string): Promise<string>;
  getTransactionCount(address: string, block?: number | 'latest' | 'pending'): Promise<number>;
  
  /**
   * Account operations
   */
  getBalance(address: string, block?: number | 'latest' | 'pending'): Promise<string>;
  getCode(address: string, block?: number | 'latest' | 'pending'): Promise<string>;
  getStorageAt(address: string, position: string, block?: number | 'latest' | 'pending'): Promise<string>;
  
  /**
   * Contract interactions
   */
  call(request: ContractCallRequest): Promise<ContractCallResult>;
  estimateGas(request: ContractCallRequest): Promise<GasEstimate>;
  
  /**
   * Gas and fee operations
   */
  getGasPrice(): Promise<number>;
  getFeeHistory(blockCount: number, newestBlock: number | 'latest'): Promise<{
    baseFeePerGas: number[];
    gasUsedRatio: number[];
    reward?: number[][];
  }>;
  
  /**
   * Network information
   */
  getNetworkStatus(): Promise<NetworkStatus>;
  getPeerCount(): Promise<number>;
  isSyncing(): Promise<boolean>;
  
  /**
   * Event filtering and logs
   */
  getLogs(filter: {
    fromBlock?: number | 'latest' | 'pending';
    toBlock?: number | 'latest' | 'pending';
    address?: string | string[];
    topics?: (string | string[] | null)[];
  }): Promise<LogEntry[]>;
  
  /**
   * Subscription methods (optional, for WebSocket providers)
   */
  subscribeToNewBlocks?(callback: (block: BlockInfo) => void): Promise<string>;
  subscribeToLogs?(filter: any, callback: (log: LogEntry) => void): Promise<string>;
  subscribeToPendingTransactions?(callback: (txHash: string) => void): Promise<string>;
  unsubscribe?(subscriptionId: string): Promise<boolean>;
  
  /**
   * Utility methods
   */
  waitForTransaction(hash: string, confirmations?: number, timeout?: number): Promise<TransactionReceipt>;
  batchRequest(requests: any[]): Promise<any[]>;
} 