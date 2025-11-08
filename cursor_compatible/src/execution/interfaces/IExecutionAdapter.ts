import { StrategyGenome } from '../../evolution/StrategyGenome';

/**
 * Execution parameters common across all chains
 */
export interface ExecutionParams {
  /**
   * Amount to trade (base currency)
   */
  amount: number;
  
  /**
   * Maximum slippage tolerance as percentage (0-100)
   */
  slippageTolerance: number;
  
  /**
   * Maximum time to wait for execution (in ms)
   */
  timeoutMs: number;
  
  /**
   * Whether this is a simulation or real execution
   */
  isSimulation: boolean;
  
  /**
   * Optional custom gas/fee parameters
   */
  feeParams?: Record<string, any>;
  
  /**
   * Optional chain-specific parameters
   */
  chainSpecific?: Record<string, any>;
}

/**
 * Result of a strategy execution
 */
export interface ExecutionResult {
  /**
   * Whether the execution was successful
   */
  success: boolean;
  
  /**
   * Transaction hash/ID if available
   */
  transactionId?: string;
  
  /**
   * Error message if unsuccessful
   */
  error?: string;
  
  /**
   * Execution timestamp
   */
  timestamp: number;
  
  /**
   * Time taken for execution in ms
   */
  executionTimeMs: number;
  
  /**
   * Total fee cost (in chain's native currency)
   */
  feeCost: number;
  
  /**
   * Actual slippage experienced as percentage
   */
  actualSlippage?: number;
  
  /**
   * Block height/number when transaction was included
   */
  blockHeight?: number;
  
  /**
   * Chain-specific result data
   */
  chainData?: Record<string, any>;
}

/**
 * Fee estimation result
 */
export interface FeeEstimation {
  /**
   * Estimated fee in chain's native currency
   */
  estimatedFee: number;
  
  /**
   * Current network congestion level (0-1)
   */
  networkCongestion: number;
  
  /**
   * Recommended fee levels
   */
  recommendedFees: {
    slow: number;
    average: number;
    fast: number;
  };
  
  /**
   * Estimated time to confirmation at different fee levels (ms)
   */
  estimatedTimeToConfirmation: {
    slow: number;
    average: number;
    fast: number;
  };
  
  /**
   * Chain-specific fee data
   */
  chainSpecific?: Record<string, any>;
}

/**
 * Chain health status
 */
export interface ChainHealthStatus {
  /**
   * Whether the chain is currently operational
   */
  isOperational: boolean;
  
  /**
   * Current block height
   */
  currentBlockHeight: number;
  
  /**
   * Latest block timestamp
   */
  latestBlockTimestamp: number;
  
  /**
   * Average block time in ms
   */
  averageBlockTimeMs: number;
  
  /**
   * Current network congestion (0-1)
   */
  networkCongestion: number;
  
  /**
   * Current TPS (transactions per second)
   */
  currentTps: number;
  
  /**
   * Response time to the RPC node in ms
   */
  rpcResponseTimeMs: number;
  
  /**
   * Whether this adapter is configured properly
   */
  isConfigured: boolean;
  
  /**
   * Chain-specific health data
   */
  chainSpecific?: Record<string, any>;
}

/**
 * Execution adapter interface
 * All chain-specific adapters must implement this interface
 */
export interface IExecutionAdapter {
  /**
   * Get the chain identifier for this adapter
   */
  getChainId(): string;
  
  /**
   * Execute a strategy on the target chain
   * @param genome Strategy genome containing execution parameters
   * @param market Market to execute on (e.g. "BTC/USD")
   * @param params Execution parameters
   */
  executeStrategy(
    genome: StrategyGenome, 
    market: string, 
    params: ExecutionParams
  ): Promise<ExecutionResult>;
  
  /**
   * Estimate fees for a potential execution
   * @param genome Strategy genome to execute
   * @param market Market to execute on
   * @param params Execution parameters
   */
  estimateFees(
    genome: StrategyGenome,
    market: string,
    params: ExecutionParams
  ): Promise<FeeEstimation>;
  
  /**
   * Check status of a previous execution
   * @param transactionId Transaction hash/ID
   */
  checkTransactionStatus(transactionId: string): Promise<ExecutionResult>;
  
  /**
   * Get chain health status
   */
  getChainHealthStatus(): Promise<ChainHealthStatus>;
  
  /**
   * Initialize the adapter with configuration
   * @param config Adapter-specific configuration
   */
  initialize(config: Record<string, any>): Promise<boolean>;
  
  /**
   * Validate if a strategy can be executed by this adapter
   * @param genome Strategy genome to validate
   */
  validateStrategy(genome: StrategyGenome): Promise<{
    isValid: boolean;
    errors?: string[];
  }>;
} 