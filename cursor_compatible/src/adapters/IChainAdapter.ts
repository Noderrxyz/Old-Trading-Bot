import { IAdapter, AdapterStatus, AdapterCapability } from './IAdapter';
import { UnifiedMarketData } from '../types/UnifiedMarketData.types.js';
import { MarketRegime } from '../market/MarketRegime';

/**
 * Asset representation within the Noderr system
 */
export interface Asset {
  symbol: string;
  name: string;
  decimals: number;
  address?: string; // Contract address if token
  chainId: number; // Chain identifier
  logoURI?: string;
  isNative?: boolean; // Whether this is a native chain asset (ETH, BNB, etc.)
  coingeckoId?: string; // CoinGecko ID for price lookups
  usdPrice?: number; // Optional cached USD price
  lastPriceUpdate?: number; // Timestamp of last price update
}

/**
 * Extended asset information
 */
export interface AssetInfo extends Asset {
  totalSupply?: string;
  marketCap?: number;
  volume24h?: number;
  priceChange24h?: number;
  contractType?: 'ERC20' | 'ERC721' | 'ERC1155' | 'NATIVE' | 'OTHER';
  verified?: boolean;
  riskScore?: number; // 0-100, higher is riskier
  tags?: string[];
}

/**
 * Chain ID enumeration for supported networks
 */
export enum ChainId {
  ETHEREUM = 1,
  BINANCE_SMART_CHAIN = 56,
  BINANCE = 56, // Alias for BINANCE_SMART_CHAIN for backward compatibility
  POLYGON = 137,
  AVALANCHE = 43114,
  ARBITRUM = 42161,
  OPTIMISM = 10,
  BASE = 8453,
  FANTOM = 250,
  GNOSIS = 100,
  KLAYTN = 8217,
  AURORA = 1313161554,
  CELO = 42220,
  HARMONY = 1666600000,
  MOONBEAM = 1284,
  CRONOS = 25,
  METIS = 1088,
  EVMOS = 9001,
  // Testnets
  ETHEREUM_GOERLI = 5,
  ETHEREUM_SEPOLIA = 11155111,
  BINANCE_TESTNET = 97,
  POLYGON_MUMBAI = 80001,
  AVALANCHE_FUJI = 43113,
  ARBITRUM_GOERLI = 421613,
  OPTIMISM_GOERLI = 420,
  BASE_GOERLI = 84531
}

/**
 * Network enumeration for supported networks
 */
export enum Network {
  ETHEREUM = 'ethereum',
  BINANCE_SMART_CHAIN = 'bsc',
  POLYGON = 'polygon',
  AVALANCHE = 'avalanche',
  ARBITRUM = 'arbitrum',
  OPTIMISM = 'optimism',
  BASE = 'base',
  FANTOM = 'fantom',
  GNOSIS = 'gnosis',
  KLAYTN = 'klaytn',
  AURORA = 'aurora',
  CELO = 'celo',
  HARMONY = 'harmony',
  MOONBEAM = 'moonbeam',
  CRONOS = 'cronos',
  METIS = 'metis',
  EVMOS = 'evmos'
}

/**
 * Transaction request parameters for sending a transaction
 */
export interface TransactionRequest {
  to?: string;
  from?: string;
  nonce?: number;
  gasLimit?: bigint;
  gasPrice?: bigint;
  data?: string;
  value?: bigint;
  chainId?: number;
  maxPriorityFeePerGas?: bigint;
  maxFeePerGas?: bigint;
  type?: number;
  accessList?: Array<{
    address: string;
    storageKeys: string[];
  }>;
}

/**
 * Transaction response from a blockchain
 */
export interface TransactionResponse {
  hash: string;
  confirmations: number;
  from: string;
  wait: (confirmations?: number) => Promise<TransactionReceipt>;
  to?: string;
  data?: string;
  value?: bigint;
  chainId?: number;
  nonce?: number;
  gasLimit?: bigint;
  gasPrice?: bigint;
  maxPriorityFeePerGas?: bigint;
  maxFeePerGas?: bigint;
  type?: number;
}

/**
 * Fee data for gas pricing
 */
export interface FeeData {
  gasPrice: bigint | null;
  maxFeePerGas: bigint | null;
  maxPriorityFeePerGas: bigint | null;
  lastBaseFeePerGas: bigint | null;
}

/**
 * Network configuration for a blockchain
 */
export interface NetworkConfig {
  chainId: number;
  name: string;
  network: Network;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  blockExplorerUrl?: string;
}

/**
 * Network status information
 */
export interface NetworkStatus {
  networkName: string;
  chainId: number;
  isConnected: boolean;
  latestBlock: number;
  blockTime: number;
  gasPrice: bigint;
  maxPriorityFeePerGas: bigint | null;
  maxFeePerGas: bigint | null;
  baseFeePerGas: bigint | null;
  congestion: 'low' | 'medium' | 'high' | 'unknown';
  timestamp: number;
  error?: string;
  sequencerHealthy?: boolean;
}

/**
 * Trade request parameters
 */
export interface TradeRequest {
  fromAsset: Asset;
  toAsset: Asset;
  amount: string;
  slippageTolerance?: number;
  expectedOutput?: string;
  minOutput?: string;
  deadline?: number;
  recipient?: string;
  protocol?: string;
  contractAddress?: string;
  callData?: string;
  value?: bigint;
}

/**
 * Trade execution options
 */
export interface TradeOptions {
  gasLimit?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce?: number;
  deadline?: number;
  mevProtection?: boolean;
  flashbots?: boolean;
  waitForConfirmation?: boolean;
  confirmations?: number;
  slippageTolerance?: number;
  preferredDex?: string;
  routingStrategy?: 'lowest_gas' | 'best_price' | 'fastest' | 'safest';
}

/**
 * General transaction options
 */
export interface TransactionOptions {
  gasLimit?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce?: number;
  value?: bigint;
  data?: string;
  waitForConfirmation?: boolean;
  confirmations?: number;
  mevProtection?: boolean;
}

/**
 * Trade order details
 */
export interface TradeOrder {
  id: string;
  fromAsset: Asset;
  toAsset: Asset;
  amount: string; // String representation of a BigNumber
  slippageTolerance: number; // As a percentage (e.g., 0.5 for 0.5%)
  txHash?: string;
  timestamp: number;
  status: 'pending' | 'completed' | 'failed';
  gasPrice?: string;
  gasLimit?: string;
  maxFeePerGas?: string; // For EIP-1559 transactions
  maxPriorityFeePerGas?: string; // For EIP-1559 transactions
  routerAddress?: string; // DEX router if applicable
  executionStrategy?: ExecutionStrategy; // Strategy for executing the trade
  mevProtection?: boolean; // Whether MEV protection is enabled
  deadline?: number; // Transaction deadline as a timestamp
}

/**
 * Strategy for executing trades
 */
export enum ExecutionStrategy {
  MARKET = 'market',
  LIMIT = 'limit',
  TWAP = 'twap', // Time-Weighted Average Price
  VWAP = 'vwap', // Volume-Weighted Average Price
  CONDITIONAL = 'conditional',
  BATCHED = 'batched',
  MEV_PROTECTED = 'mev_protected'
}

/**
 * Result of a trade execution
 */
export interface TradeResult {
  success: boolean;
  order: TradeOrder;
  txHash?: string;
  blockNumber?: number;
  executionPrice?: string;
  amountOut?: string;
  fees?: {
    networkFee: string;
    protocolFee?: string;
    otherFees?: Record<string, string>;
  };
  timestamp: number;
  failureReason?: string;
  route?: string[]; // DEX route that was used
  priceImpact?: number; // Price impact as a percentage
  executionTime?: number; // Time from submission to confirmation in ms
  mevProtectionApplied?: boolean; // Whether MEV protection was applied
}

/**
 * Gas fee estimation
 */
export interface GasEstimate {
  slow: {
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    gasPrice?: string; // Legacy
    estimatedTimeMs: number;
  };
  average: {
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    gasPrice?: string; // Legacy
    estimatedTimeMs: number;
  };
  fast: {
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    gasPrice?: string; // Legacy
    estimatedTimeMs: number;
  };
  baseFee?: string;
  isEip1559Supported: boolean;
  lastUpdated: number;
}

/**
 * Chain-specific adapter status
 */
export interface ChainAdapterStatus extends AdapterStatus {
  chainId: number;
  networkName: string;
  blockHeight?: number;
  gasPrice?: string;
  baseFeePerGas?: string;
  isMainnet: boolean;
  peers?: number;
  connectedNode?: string;
  protocolVersion?: string;
  syncStatus?: 'synced' | 'syncing' | 'stalled';
  pendingTransactions?: number;
}

/**
 * MEV protection configuration
 */
export interface MevProtectionConfig {
  enabled: boolean;
  providerUrl?: string; // MEV protection RPC URL
  useFlashbots?: boolean;
  maxTipCap?: string; // Max priority fee for Flashbots bundles
  blockDelay?: number; // Number of blocks to delay for analysis
  apiKey?: string; // API key for MEV protection service
}

/**
 * Transaction receipt with additional information
 */
export interface TransactionReceipt {
  txHash: string;
  blockNumber: number;
  blockHash: string;
  from: string;
  to: string;
  status: 'success' | 'failure';
  gasUsed: string;
  effectiveGasPrice: string;
  logs: any[]; // Transaction logs
  confirmations: number;
  timestamp?: number;
  nonce?: number;
  rawReceipt?: any; // Raw receipt from the blockchain
}

/**
 * Execution result
 */
export interface ExecutionResult {
  success: boolean;
  error?: string;
  timestamp: number;
  executionTimeMs: number;
  feeCost: number;
  transactionId?: string;
  actualSlippage?: number;
  blockHeight?: number;
  chainData?: any;
  // Performance metrics
  pendingTransactions?: number;
  confirmedTransactions?: number;
  failedTransactions?: number;
  gasPrice?: number;
}

/**
 * Execution parameters
 */
export interface ExecutionParams {
  chainId?: string;
  market: string;
  amount: string;
  slippageTolerance: number;
  deadline?: number;
  maxRetries?: number;
  retryDelay?: number;
  mevProtection?: boolean;
  regime?: MarketRegime;
}

/**
 * IChainAdapter - Interface for blockchain-specific adapters
 * 
 * Extends the base IAdapter with methods specific to blockchain interactions
 */
export interface IChainAdapter extends IAdapter {
  /**
   * Human-readable name of the chain/network (e.g., 'zkSync', 'StarkNet', 'Manta')
   */
  readonly name: string;

  /**
   * Unique chain/network identifier (e.g., chainId, network slug)
   */
  readonly chainId: string;

  /**
   * Initialize the adapter (connect, authenticate, etc.)
   */
  initialize(): Promise<void>;

  /**
   * Fetch normalized market data for a given symbol/pair
   * @param symbol Trading pair or asset symbol (e.g., 'ETH/USDT')
   */
  getMarketData(symbol: string): Promise<UnifiedMarketData>;

  /**
   * Optional: Fetch historical data, orderbook, etc.
   */
  getHistoricalData?(symbol: string, timeframe: string, start: number, end: number): Promise<UnifiedMarketData[]>;

  /**
   * Optional: Clean up resources, close connections
   */
  close?(): Promise<void>;

  /**
   * Connect to the blockchain network
   * @returns A promise that resolves when connected
   */
  connect(): Promise<void>;
  
  /**
   * Disconnect from the blockchain network
   * @returns A promise that resolves when disconnected
   */
  disconnect(): Promise<void>;
  
  /**
   * Get the balance of an address for a specific asset
   * @param address The wallet address to check
   * @param asset Optional asset to check balance for (defaults to native token)
   * @returns A promise that resolves with the balance as a string
   */
  getBalance(address: string, asset?: Asset): Promise<string>;
  
  /**
   * Execute a trade on the blockchain
   * @param order The trade order to execute
   * @returns A promise that resolves with the trade result
   */
  executeTrade(order: TradeOrder): Promise<TradeResult>;

  /**
   * Get the current status of the chain adapter
   * @returns A promise that resolves with chain-specific status
   */
  getStatus(): Promise<ChainAdapterStatus>;

  /**
   * Get a quote for a potential trade
   * @param fromAsset The source asset
   * @param toAsset The target asset
   * @param amount The amount to trade
   * @returns A promise that resolves with the expected output amount and price impact
   */
  getQuote(fromAsset: Asset, toAsset: Asset, amount: string): Promise<{
    expectedOutput: string;
    priceImpact: number;
    route?: string[];
  }>;

  /**
   * Get the transaction status
   * @param txHash The transaction hash to check
   * @returns A promise that resolves with the transaction status
   */
  getTransactionStatus(txHash: string): Promise<{
    status: 'pending' | 'confirmed' | 'failed';
    confirmations?: number;
    receipt?: TransactionReceipt;
  }>;
  
  /**
   * Get detailed information about an asset
   * @param asset The basic asset to get information for
   * @returns A promise that resolves with detailed asset information
   */
  getAssetInfo(asset: Asset): Promise<AssetInfo>;
  
  /**
   * Get current gas price estimate
   * @returns A promise that resolves with current gas prices
   */
  getGasPrice(): Promise<GasEstimate>;
  
  /**
   * Estimate gas for a transaction
   * @param fromAddress From address
   * @param toAddress To address
   * @param data Transaction data
   * @param value Optional value in native currency
   * @returns A promise that resolves with the estimated gas
   */
  estimateGas(fromAddress: string, toAddress: string, data: string, value?: string): Promise<string>;
  
  /**
   * Configure MEV protection
   * @param config MEV protection configuration
   * @returns A promise that resolves when configuration is complete
   */
  configureMevProtection(config: MevProtectionConfig): Promise<void>;
  
  /**
   * Check if chain is healthy
   * @returns A promise that resolves with the health status
   */
  checkHealth(): Promise<{
    healthy: boolean;
    latency: number;
    blockDelay: number; // Delay behind canonical chain in seconds
    errors?: string[];
  }>;
  
  /**
   * Submit a raw transaction
   * @param signedTx The signed transaction to submit
   * @param mevProtection Whether to use MEV protection
   * @returns A promise that resolves with the transaction hash
   */
  submitTransaction(signedTx: string, mevProtection?: boolean): Promise<string>;
  
  /**
   * Get the chain ID
   * @returns The chain ID
   */
  getChainId(): number;
  
  /**
   * Check if the adapter supports a specific capability
   * @param capability The capability to check
   * @returns True if supported
   */
  hasCapability(capability: AdapterCapability): boolean;
  
  /**
   * Get network status
   * @returns A promise that resolves with the network status
   */
  getNetworkStatus(): Promise<NetworkStatus>;
  
  /**
   * Submit a trade transaction
   * @param request Trade request
   * @param options Trade options
   * @returns Transaction response
   */
  submitTrade(request: TradeRequest, options?: TradeOptions): Promise<TransactionResponse>;
  
  /**
   * Sign a transaction
   * @param transaction Transaction to sign
   * @returns Signed transaction
   */
  signTransaction(transaction: TransactionRequest): Promise<string>;
  
  /**
   * Send a transaction
   * @param transaction Transaction to send
   * @returns Transaction response
   */
  sendTransaction(transaction: TransactionRequest): Promise<TransactionResponse>;
  
  /**
   * Get the current block number
   * @returns Current block number
   */
  getBlockNumber(): Promise<number>;
  
  /**
   * Get the wallet address
   * @returns Wallet address
   */
  getWalletAddress(): Promise<string>;
  
  /**
   * Get the provider instance for this chain
   * @returns The chain's provider instance
   */
  getProvider(): any; // Using any for now, would be properly typed in production
}

export { AdapterCapability }; 