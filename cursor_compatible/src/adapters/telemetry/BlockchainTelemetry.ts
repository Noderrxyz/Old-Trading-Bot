/**
 * Blockchain Telemetry Handler for the Noderr Protocol
 * 
 * This module provides specialized telemetry functions for blockchain adapters,
 * integrating with the metrics system to ensure comprehensive
 * monitoring and observability.
 */

// Import metrics functions from the telemetry module
import {
  recordRpcMetrics,
  recordBlockchainOperation,
  updateBlockchainConnectionStatus,
  updateCircuitBreakerState,
  recordTradeExecution,
  recordRetryAttempt
} from '../../telemetry/metrics';

// Import adapter types
import { 
  IChainAdapter, 
  ChainAdapterStatus, 
  Asset, 
  TradeOrder, 
  TradeResult 
} from '../IChainAdapter';
import { ChainId } from '../index';

import { CircuitBreaker, CircuitBreakerState, CircuitBreakerConfig, CircuitBreakerStatus } from './CircuitBreaker';

/**
 * Error category types
 */
export type BlockchainErrorCategory = 
  | 'network'
  | 'rpc'
  | 'transaction'
  | 'validation'
  | 'circuit_breaker'
  | 'rate_limit'
  | 'unknown';

/**
 * Telemetry operation types
 */
export enum TelemetryOperationType {
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  GET_BALANCE = 'getBalance',
  EXECUTE_TRADE = 'executeTrade',
  GET_QUOTE = 'getQuote',
  GET_STATUS = 'getStatus',
  GET_TX_STATUS = 'getTransactionStatus',
  ESTIMATE_GAS = 'estimateGas',
  SUBMIT_TX = 'submitTransaction',
  CHECK_HEALTH = 'checkHealth',
  GET_ASSET_INFO = 'getAssetInfo',
  GET_GAS_PRICE = 'getGasPrice',
  RPC_CALL = 'rpc_call'
}

/**
 * Types of blockchain transactions
 */
export enum TransactionType {
  TRADE = 'trade',
  TRANSFER = 'transfer',
  APPROVAL = 'approval',
  SWAP = 'swap',
  LIQUIDITY = 'liquidity',
  FARMING = 'farming',
  OTHER = 'other'
}

/**
 * Types of execution protection
 */
export enum ProtectionType {
  NONE = 'none',
  FLASHBOTS = 'flashbots',
  EDEN = 'eden',
  BLOXROUTE = 'bloXroute',
  CUSTOM = 'custom'
}

/**
 * Telemetry configuration
 */
export interface TelemetryConfig {
  enabled: boolean;
  detailedLogging?: boolean;
  metricsInterval?: number;
  circuitBreakers?: {
    enabled: boolean;
    config?: Partial<CircuitBreakerConfig>;
  };
  exportMetrics?: {
    enabled: boolean;
    prometheusEndpoint?: string;
    datadog?: {
      enabled: boolean;
      apiKey?: string;
    };
  };
}

/**
 * Execution metrics for a chain
 */
export interface ChainMetrics {
  // Success/failure counts
  successCount: number;
  failureCount: number;
  
  // Gas metrics
  totalGasUsed: bigint;
  totalGasCost: bigint;
  maxGasPrice: bigint;
  
  // Transaction metrics
  transactionCount: {
    [key in TransactionType]: number;
  };
  
  // Protection metrics
  protectionCount: {
    [key in ProtectionType]: number;
  };
  protectionSuccess: {
    [key in ProtectionType]: number;
  };
  
  // Performance metrics
  avgConfirmationTime: number;
  confirmationSamples: number;
  
  // Error tracking
  errorCounts: Record<string, number>;
  
  // Cross-chain metrics
  crossChainInitiated: number;
  crossChainCompleted: number;
  
  // Rate limiting
  rateLimitHits: number;
  
  // Circuit breaker status
  circuitBreaker?: CircuitBreaker;
  
  // Last updated
  lastUpdated: number;
  
  // Enhanced latency tracking
  latencyMetrics: {
    operationLatencies: Map<string, number[]>; // Operation type -> array of latencies
    crossChainLatencies: Map<string, number[]>; // Chain pair -> array of latencies
    avgLatencyByOperation: Map<string, number>;
    avgCrossChainLatency: Map<string, number>;
    p95LatencyByOperation: Map<string, number>;
    p95CrossChainLatency: Map<string, number>;
  };
  
  // Chain health metrics
  healthMetrics: {
    lastBlockTime: number;
    blockTimeAverage: number;
    blockTimeSamples: number[];
    gasPriceHistory: number[];
    errorRate: number;
    consecutiveErrors: number;
    lastErrorTimestamp: number;
    lastErrorType: string;
  };
  
  // Performance metrics
  performanceMetrics: {
    tps: number; // Transactions per second
    pendingTransactions: number;
    confirmedTransactions: number;
    failedTransactions: number;
    avgConfirmationTime: number;
    confirmationTimeSamples: number[];
  };
}

/**
 * Internal implementation of missing metrics functions
 * These should be moved to the actual metrics module later
 */
// Gauge metrics
function incrementGauge(name: string, value: number, labels: Record<string, string>): void {
  console.log(`METRIC [${name}] increment: ${value}, labels: ${JSON.stringify(labels)}`);
  // Actual implementation would set a Prometheus gauge
}

function decrementGauge(name: string, value: number, labels: Record<string, string>): void {
  console.log(`METRIC [${name}] decrement: ${value}, labels: ${JSON.stringify(labels)}`);
  // Actual implementation would set a Prometheus gauge
}

// Histogram metrics
function observeHistogram(name: string, value: number, labels: Record<string, string>): void {
  console.log(`METRIC [${name}] observe: ${value}, labels: ${JSON.stringify(labels)}`);
  // Actual implementation would record a Prometheus histogram observation
}

// Counter metrics
function recordCounter(name: string, value: number, labels: Record<string, string>): void {
  console.log(`METRIC [${name}] increment: ${value}, labels: ${JSON.stringify(labels)}`);
  // Actual implementation would increment a Prometheus counter
}

/**
 * BlockchainTelemetry class handles all telemetry for blockchain adapters
 */
export class BlockchainTelemetry {
  private config: TelemetryConfig;
  private metrics: Map<string, ChainMetrics> = new Map();
  private metricsInterval?: NodeJS.Timeout;
  
  // Internal metrics
  private startTime: number;
  private totalTransactions: number = 0;
  private totalSuccessful: number = 0;
  private totalFailed: number = 0;
  
  // Chain information
  private chainId: number = 0;
  private isMainnet: boolean = false;
  private networkName: string = 'unknown';
  
  // Internal metrics
  private operationCounts: {
    total: number;
    success: number;
    failure: number;
  } = { total: 0, success: 0, failure: 0 };
  
  // Last error and latency
  private lastError: BlockchainErrorCategory | null = null;
  private lastLatency: number | null = null;
  
  /**
   * Constructor
   */
  constructor(config: TelemetryConfig) {
    this.config = {
      enabled: true,
      detailedLogging: false,
      metricsInterval: 60000, // 1 minute default
      circuitBreakers: {
        enabled: false
      },
      ...config
    };
    
    this.startTime = Date.now();
    
    // Initialize metrics reporting if enabled
    if (this.config.enabled && this.config.metricsInterval) {
      this.startMetricsReporting();
    }
  }

  /**
   * Set chain information
   */
  public setChainInfo(chainId: number, isMainnet: boolean, networkName: string): void {
    this.chainId = chainId;
    this.isMainnet = isMainnet;
    this.networkName = networkName;
  }
  
  /**
   * Initialize metrics for a chain
   * @param chain Chain identifier
   */
  public initializeChain(chain: string): void {
    if (!this.config.enabled) return;
    
    if (!this.metrics.has(chain)) {
      const newMetrics: ChainMetrics = {
        successCount: 0,
        failureCount: 0,
        totalGasUsed: BigInt(0),
        totalGasCost: BigInt(0),
        maxGasPrice: BigInt(0),
        transactionCount: {
          [TransactionType.TRADE]: 0,
          [TransactionType.TRANSFER]: 0,
          [TransactionType.APPROVAL]: 0,
          [TransactionType.SWAP]: 0,
          [TransactionType.LIQUIDITY]: 0,
          [TransactionType.FARMING]: 0,
          [TransactionType.OTHER]: 0
        },
        protectionCount: {
          [ProtectionType.NONE]: 0,
          [ProtectionType.FLASHBOTS]: 0,
          [ProtectionType.EDEN]: 0,
          [ProtectionType.BLOXROUTE]: 0,
          [ProtectionType.CUSTOM]: 0
        },
        protectionSuccess: {
          [ProtectionType.NONE]: 0,
          [ProtectionType.FLASHBOTS]: 0,
          [ProtectionType.EDEN]: 0,
          [ProtectionType.BLOXROUTE]: 0,
          [ProtectionType.CUSTOM]: 0
        },
        avgConfirmationTime: 0,
        confirmationSamples: 0,
        errorCounts: {},
        crossChainInitiated: 0,
        crossChainCompleted: 0,
        rateLimitHits: 0,
        lastUpdated: Date.now(),
        latencyMetrics: {
          operationLatencies: new Map(),
          crossChainLatencies: new Map(),
          avgLatencyByOperation: new Map(),
          avgCrossChainLatency: new Map(),
          p95LatencyByOperation: new Map(),
          p95CrossChainLatency: new Map()
        },
        healthMetrics: {
          lastBlockTime: 0,
          blockTimeAverage: 0,
          blockTimeSamples: [],
          gasPriceHistory: [],
          errorRate: 0,
          consecutiveErrors: 0,
          lastErrorTimestamp: 0,
          lastErrorType: ''
        },
        performanceMetrics: {
          tps: 0,
          pendingTransactions: 0,
          confirmedTransactions: 0,
          failedTransactions: 0,
          avgConfirmationTime: 0,
          confirmationTimeSamples: []
        }
      };
      
      // Initialize circuit breaker if enabled
      if (this.config.circuitBreakers?.enabled) {
        newMetrics.circuitBreaker = new CircuitBreaker(
          this.config.circuitBreakers.config || {}
        );
      }
      
      this.metrics.set(chain, newMetrics);
      
      if (this.config.detailedLogging) {
        console.log(`Initialized telemetry for chain: ${chain}`);
      }
    }
  }
  
  /**
   * Start periodic metrics reporting
   */
  private startMetricsReporting(): void {
    this.metricsInterval = setInterval(() => {
      this.reportMetrics();
    }, this.config.metricsInterval);
  }
  
  /**
   * Stop metrics reporting
   */
  public stopMetricsReporting(): void {
    if (this.metricsInterval) {
      clearTimeout(this.metricsInterval);
      this.metricsInterval = undefined;
    }
  }
  
  /**
   * Report metrics to configured endpoints
   */
  private reportMetrics(): void {
    if (!this.config.enabled) return;
    
    const now = Date.now();
    const uptimeSeconds = Math.floor((now - this.startTime) / 1000);
    
    const report = {
      timestamp: now,
      uptime: uptimeSeconds,
      totalTransactions: this.totalTransactions,
      totalSuccessful: this.totalSuccessful,
      totalFailed: this.totalFailed,
      successRate: this.totalTransactions > 0 
        ? (this.totalSuccessful / this.totalTransactions) * 100 
        : 0,
      chains: {} as Record<string, any>
    };
    
    // Add chain-specific metrics
    for (const [chain, metrics] of this.metrics.entries()) {
      report.chains[chain] = {
        successCount: metrics.successCount,
        failureCount: metrics.failureCount,
        successRate: (metrics.successCount + metrics.failureCount) > 0
          ? (metrics.successCount / (metrics.successCount + metrics.failureCount)) * 100
          : 0,
        totalGasUsed: metrics.totalGasUsed.toString(),
        totalGasCost: metrics.totalGasCost.toString(),
        avgConfirmationTime: metrics.avgConfirmationTime,
        transactionTypes: metrics.transactionCount,
        protectionUsage: metrics.protectionCount,
        protectionSuccess: metrics.protectionSuccess,
        crossChainSuccess: metrics.crossChainCompleted > 0 && metrics.crossChainInitiated > 0
          ? (metrics.crossChainCompleted / metrics.crossChainInitiated) * 100
          : 0,
        rateLimitHits: metrics.rateLimitHits,
        circuitBreakerStatus: metrics.circuitBreaker
          ? CircuitBreakerState[metrics.circuitBreaker.getState()]
          : 'DISABLED',
        lastUpdated: metrics.lastUpdated
      };
    }
    
    // Log report for debugging
    if (this.config.detailedLogging) {
      console.log('Blockchain Telemetry Report:', JSON.stringify(report, null, 2));
    }
    
    // Export metrics if configured
    if (this.config.exportMetrics?.enabled) {
      this.exportMetricsToEndpoints(report);
    }
  }
  
  /**
   * Export metrics to configured endpoints
   * @param report Metrics report
   */
  private exportMetricsToEndpoints(report: any): void {
    // Placeholder for actual metrics export implementation
    if (this.config.exportMetrics?.prometheusEndpoint) {
      // Export to Prometheus
      // This would be implemented with a proper Prometheus client
    }
    
    if (this.config.exportMetrics?.datadog?.enabled && this.config.exportMetrics.datadog.apiKey) {
      // Export to Datadog
      // This would be implemented with Datadog client
    }
  }
  
  /**
   * Record a successful execution
   * @param chain Chain identifier
   * @param txType Optional transaction type
   */
  public recordSuccessfulExecution(chain: string, txType: TransactionType = TransactionType.OTHER): void {
    if (!this.config.enabled) return;
    
    this.initializeChain(chain);
    const metrics = this.metrics.get(chain)!;
    
    metrics.successCount++;
    metrics.transactionCount[txType]++;
    metrics.lastUpdated = Date.now();
    
    this.totalTransactions++;
    this.totalSuccessful++;
    
    // Update circuit breaker
    metrics.circuitBreaker?.recordSuccess();
  }
  
  /**
   * Record a failed execution
   * @param chain Chain identifier
   * @param error Error message or code
   * @param txType Optional transaction type
   */
  public recordFailedExecution(
    chain: string, 
    error: string = 'unknown_error',
    txType: TransactionType = TransactionType.OTHER
  ): void {
    if (!this.config.enabled) return;
    
    this.initializeChain(chain);
    const metrics = this.metrics.get(chain)!;
    
    metrics.failureCount++;
    metrics.lastUpdated = Date.now();
    
    // Record error type
    if (!metrics.errorCounts[error]) {
      metrics.errorCounts[error] = 0;
    }
    metrics.errorCounts[error]++;
    
    this.totalTransactions++;
    this.totalFailed++;
    
    // Update circuit breaker
    metrics.circuitBreaker?.recordFailure();
  }
  
  /**
   * Record a gas estimation
   * @param chain Chain identifier
   * @param contract Contract address
   * @param gasEstimate Gas estimate
   * @param durationMs Duration of the estimation in milliseconds
   */
  public recordGasEstimation(
    chain: string,
    contract: string,
    gasEstimate: bigint,
    durationMs: number
  ): void {
    if (!this.config.enabled) return;
    
    this.initializeChain(chain);
    // Additional metrics could be recorded here if needed
  }
  
  /**
   * Record a failed gas estimation
   * @param chain Chain identifier
   * @param contract Contract address
   * @param error Error message
   */
  public recordFailedGasEstimation(
    chain: string,
    contract: string,
    error: string
  ): void {
    if (!this.config.enabled) return;
    
    this.initializeChain(chain);
    const metrics = this.metrics.get(chain)!;
    
    // Record error
    if (!metrics.errorCounts[`gas_estimation:${error}`]) {
      metrics.errorCounts[`gas_estimation:${error}`] = 0;
    }
    metrics.errorCounts[`gas_estimation:${error}`]++;
    
    metrics.lastUpdated = Date.now();
  }
  
  /**
   * Record the start of a trade
   * @param chain Chain identifier
   * @param fromToken Source token
   * @param toToken Destination token
   * @param protocol Trading protocol used
   */
  public recordTradeStart(
    chain: string,
    fromToken: string,
    toToken: string,
    protocol: string
  ): void {
    if (!this.config.enabled) return;
    
    this.initializeChain(chain);
    // This could track pending trades in a production implementation
  }
  
  /**
   * Record a submitted trade
   * @param chain Chain identifier
   * @param fromToken Source token
   * @param toToken Destination token
   * @param protocol Trading protocol used
   * @param txHash Transaction hash
   * @param durationMs Duration from trade start to submission
   */
  public recordTradeSubmitted(
    chain: string,
    fromToken: string,
    toToken: string,
    protocol: string,
    txHash: string,
    durationMs: number
  ): void {
    if (!this.config.enabled) return;
    
    this.initializeChain(chain);
    const metrics = this.metrics.get(chain)!;
    
    metrics.transactionCount[TransactionType.TRADE]++;
    metrics.lastUpdated = Date.now();
    
    // Additional metrics specific to trades could be recorded here
  }
  
  /**
   * Record a failed trade
   * @param chain Chain identifier
   * @param fromToken Source token
   * @param toToken Destination token
   * @param protocol Trading protocol used
   * @param txHash Transaction hash if available
   * @param error Error message
   * @param durationMs Duration from trade start to failure
   */
  public recordTradeFailed(
    chain: string,
    fromToken: string,
    toToken: string,
    protocol: string,
    txHash: string | undefined,
    error: string,
    durationMs: number
  ): void {
    if (!this.config.enabled) return;
    
    this.initializeChain(chain);
    const metrics = this.metrics.get(chain)!;
    
    // Record error
    if (!metrics.errorCounts[`trade:${error}`]) {
      metrics.errorCounts[`trade:${error}`] = 0;
    }
    metrics.errorCounts[`trade:${error}`]++;
    
    metrics.lastUpdated = Date.now();
  }
  
  /**
   * Record gas usage for a transaction
   * @param chain Chain identifier
   * @param gasUsed Gas used
   * @param gasPrice Gas price
   * @param txType Transaction type
   */
  public recordGasUsage(
    chain: string,
    gasUsed: bigint,
    gasPrice: bigint,
    txType: TransactionType = TransactionType.OTHER
  ): void {
    if (!this.config.enabled) return;
    
    this.initializeChain(chain);
    const metrics = this.metrics.get(chain)!;
    
    // Update gas metrics
    metrics.totalGasUsed += gasUsed;
    metrics.totalGasCost += gasUsed * gasPrice;
    
    if (gasPrice > metrics.maxGasPrice) {
      metrics.maxGasPrice = gasPrice;
    }
    
    metrics.lastUpdated = Date.now();
  }
  
  /**
   * Record confirmation time for a transaction
   * @param chain Chain identifier
   * @param confirmationTimeMs Time to confirmation in milliseconds
   */
  public recordConfirmationTime(
    chain: string,
    confirmationTimeMs: number
  ): void {
    if (!this.config.enabled) return;
    
    this.initializeChain(chain);
    const metrics = this.metrics.get(chain)!;
    
    // Update average confirmation time
    const newTotal = metrics.avgConfirmationTime * metrics.confirmationSamples + confirmationTimeMs;
    metrics.confirmationSamples++;
    metrics.avgConfirmationTime = newTotal / metrics.confirmationSamples;
    
    metrics.lastUpdated = Date.now();
  }
  
  /**
   * Record an attempt to use MEV protection
   * @param chain Chain identifier
   * @param contract Contract address
   * @param protectionType Type of protection used
   */
  public recordMevProtectionAttempt(
    chain: string,
    contract: string,
    protectionType: string
  ): void {
    if (!this.config.enabled) return;
    
    this.initializeChain(chain);
    const metrics = this.metrics.get(chain)!;
    
    // Record protection attempt
    const type = protectionType as ProtectionType;
    if (metrics.protectionCount[type] !== undefined) {
      metrics.protectionCount[type]++;
    } else {
      metrics.protectionCount[ProtectionType.CUSTOM]++;
    }
    
    metrics.lastUpdated = Date.now();
  }
  
  /**
   * Record a successful MEV-protected transaction
   * @param chain Chain identifier
   * @param contract Contract address
   * @param protectionType Type of protection used
   * @param txHash Transaction hash
   * @param durationMs Duration of the protection process
   */
  public recordMevProtectionSuccess(
    chain: string,
    contract: string,
    protectionType: string,
    txHash: string,
    durationMs: number
  ): void {
    if (!this.config.enabled) return;
    
    this.initializeChain(chain);
    const metrics = this.metrics.get(chain)!;
    
    // Record protection success
    const type = protectionType as ProtectionType;
    if (metrics.protectionSuccess[type] !== undefined) {
      metrics.protectionSuccess[type]++;
    } else {
      metrics.protectionSuccess[ProtectionType.CUSTOM]++;
    }
    
    metrics.lastUpdated = Date.now();
  }
  
  /**
   * Record a failed MEV protection attempt
   * @param chain Chain identifier
   * @param contract Contract address
   * @param protectionType Type of protection used
   * @param error Error message
   * @param durationMs Duration of the protection attempt
   */
  public recordMevProtectionFailure(
    chain: string,
    contract: string,
    protectionType: string,
    error: string,
    durationMs: number
  ): void {
    if (!this.config.enabled) return;
    
    this.initializeChain(chain);
    const metrics = this.metrics.get(chain)!;
    
    // Record error
    if (!metrics.errorCounts[`mev_protection:${error}`]) {
      metrics.errorCounts[`mev_protection:${error}`] = 0;
    }
    metrics.errorCounts[`mev_protection:${error}`]++;
    
    metrics.lastUpdated = Date.now();
  }
  
  /**
   * Record a cross-chain operation initiation
   * @param sourceChain Source chain identifier
   * @param targetChain Target chain identifier
   * @param operation Operation type
   */
  public recordCrossChainStart(
    sourceChain: string,
    targetChain: string,
    operation: string
  ): void {
    if (!this.config.enabled) return;
    
    this.initializeChain(sourceChain);
    this.initializeChain(targetChain);
    
    const sourceMetrics = this.metrics.get(sourceChain)!;
    sourceMetrics.crossChainInitiated++;
    sourceMetrics.lastUpdated = Date.now();
  }
  
  /**
   * Record a completed cross-chain operation
   * @param sourceChain Source chain identifier
   * @param targetChain Target chain identifier
   * @param operation Operation type
   * @param sourceTxHash Source transaction hash
   * @param targetTxHash Target transaction hash
   * @param durationMs Duration of the complete operation
   */
  public recordCrossChainComplete(
    sourceChain: string,
    targetChain: string,
    operation: string,
    sourceTxHash: string,
    targetTxHash: string,
    durationMs: number
  ): void {
    if (!this.config.enabled) return;
    
    this.initializeChain(sourceChain);
    this.initializeChain(targetChain);
    
    const sourceMetrics = this.metrics.get(sourceChain)!;
    const targetMetrics = this.metrics.get(targetChain)!;
    
    sourceMetrics.crossChainCompleted++;
    targetMetrics.successCount++;
    
    sourceMetrics.lastUpdated = Date.now();
    targetMetrics.lastUpdated = Date.now();
  }
  
  /**
   * Record a rate limit hit
   * @param chain Chain identifier
   * @param limitType Type of rate limit
   */
  public recordRateLimitHit(
    chain: string,
    limitType: string
  ): void {
    if (!this.config.enabled) return;
    
    this.initializeChain(chain);
    const metrics = this.metrics.get(chain)!;
    
    metrics.rateLimitHits++;
    metrics.lastUpdated = Date.now();
    
    // Record error
    if (!metrics.errorCounts[`rate_limit:${limitType}`]) {
      metrics.errorCounts[`rate_limit:${limitType}`] = 0;
    }
    metrics.errorCounts[`rate_limit:${limitType}`]++;
  }
  
  /**
   * Get the circuit breaker status for a chain
   * @param chain Chain identifier
   * @returns Circuit breaker status
   */
  public getCircuitBreakerStatus(chain: string): CircuitBreakerStatus {
    this.initializeChain(chain);
    const metrics = this.metrics.get(chain)!;
    
    if (!metrics.circuitBreaker) {
      return {
        state: CircuitBreakerState.CLOSED,
        failureCount: 0,
        lastFailure: 0,
        lastSuccess: 0
      };
    }
    
    return metrics.circuitBreaker.getStatus();
  }
  
  /**
   * Reset the circuit breaker for a chain
   * @param chain Chain identifier
   */
  public resetCircuitBreaker(chain: string): void {
    if (!this.config.enabled) return;
    
    this.initializeChain(chain);
    const metrics = this.metrics.get(chain)!;
    
    if (metrics.circuitBreaker) {
      metrics.circuitBreaker.reset();
    }
  }
  
  /**
   * Get metrics for a specific chain
   * @param chain Chain identifier
   * @returns Chain metrics or undefined if not found
   */
  public getChainMetrics(chain: string): ChainMetrics | undefined {
    return this.metrics.get(chain);
  }
  
  /**
   * Get aggregate metrics across all chains
   * @returns Aggregate metrics
   */
  public getAggregateMetrics(): {
    uptime: number;
    totalTransactions: number;
    totalSuccessful: number;
    totalFailed: number;
    successRate: number;
    chains: string[];
  } {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    
    return {
      uptime,
      totalTransactions: this.totalTransactions,
      totalSuccessful: this.totalSuccessful,
      totalFailed: this.totalFailed,
      successRate: this.totalTransactions > 0 
        ? (this.totalSuccessful / this.totalTransactions) * 100 
        : 0,
      chains: Array.from(this.metrics.keys())
    };
  }

  /**
   * Track an operation with timing
   */
  public async trackOperation<T>(
    operationType: TelemetryOperationType,
    operation: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      this.operationCounts.total++;
      
      // Execute the operation
      const result = await operation();
      
      // Record success
      this.operationCounts.success++;
      this.lastLatency = Date.now() - startTime;
      
      return result;
    } catch (error) {
      // Record failure
      this.operationCounts.failure++;
      this.lastLatency = Date.now() - startTime;
      this.lastError = this.categorizeError(error);
      
      throw error;
    }
  }
  
  /**
   * Record a trade with all metrics
   */
  public recordTrade(
    startTime: number,
    volumeUsd: number,
    success: boolean,
    txType: TransactionType = TransactionType.TRADE,
    error?: string
  ): void {
    const durationMs = Date.now() - startTime;
    
    if (success) {
      this.totalSuccessful++;
      this.recordSuccessfulExecution(this.networkName, txType);
    } else {
      this.totalFailed++;
      this.recordFailedExecution(this.networkName, error || 'unknown_error', txType);
    }
    
    this.totalTransactions++;
    
    // Log the trade if detailed logging is enabled
    if (this.config.detailedLogging) {
      console.log(`[BlockchainTelemetry] Trade ${success ? 'succeeded' : 'failed'} in ${durationMs}ms, volume: $${volumeUsd}`);
    }
  }
  
  /**
   * Update chain status metrics
   */
  public updateStatus(
    isConnected: boolean,
    blockHeight?: number,
    gasPrice?: bigint,
    baseFeePerGas?: bigint
  ): void {
    // Get chain metrics or create if not exists
    const metrics = this.getOrCreateChainMetrics(this.networkName);
    
    // Update relevant fields
    if (blockHeight) {
      this._lastBlockHeight = blockHeight;
    }
    
    // Record the update time
    metrics.lastUpdated = Date.now();
  }
  
  /**
   * Get or create chain metrics
   */
  private getOrCreateChainMetrics(chain: string): ChainMetrics {
    if (!this.metrics.has(chain)) {
      this.metrics.set(chain, {
        successCount: 0,
        failureCount: 0,
        totalGasUsed: BigInt(0),
        totalGasCost: BigInt(0),
        maxGasPrice: BigInt(0),
        transactionCount: {
          [TransactionType.TRADE]: 0,
          [TransactionType.TRANSFER]: 0,
          [TransactionType.APPROVAL]: 0,
          [TransactionType.SWAP]: 0,
          [TransactionType.LIQUIDITY]: 0,
          [TransactionType.FARMING]: 0,
          [TransactionType.OTHER]: 0
        },
        protectionCount: {
          [ProtectionType.NONE]: 0,
          [ProtectionType.FLASHBOTS]: 0,
          [ProtectionType.EDEN]: 0,
          [ProtectionType.BLOXROUTE]: 0,
          [ProtectionType.CUSTOM]: 0
        },
        protectionSuccess: {
          [ProtectionType.NONE]: 0,
          [ProtectionType.FLASHBOTS]: 0,
          [ProtectionType.EDEN]: 0,
          [ProtectionType.BLOXROUTE]: 0,
          [ProtectionType.CUSTOM]: 0
        },
        avgConfirmationTime: 0,
        confirmationSamples: 0,
        errorCounts: {},
        crossChainInitiated: 0,
        crossChainCompleted: 0,
        rateLimitHits: 0,
        lastUpdated: Date.now(),
        latencyMetrics: {
          operationLatencies: new Map(),
          crossChainLatencies: new Map(),
          avgLatencyByOperation: new Map(),
          avgCrossChainLatency: new Map(),
          p95LatencyByOperation: new Map(),
          p95CrossChainLatency: new Map()
        },
        healthMetrics: {
          lastBlockTime: 0,
          blockTimeAverage: 0,
          blockTimeSamples: [],
          gasPriceHistory: [],
          errorRate: 0,
          consecutiveErrors: 0,
          lastErrorTimestamp: 0,
          lastErrorType: ''
        },
        performanceMetrics: {
          tps: 0,
          pendingTransactions: 0,
          confirmedTransactions: 0,
          failedTransactions: 0,
          avgConfirmationTime: 0,
          confirmationTimeSamples: []
        }
      });
    }
    
    return this.metrics.get(chain)!;
  }
  
  /**
   * Categorize an error
   */
  private categorizeError(error: any): BlockchainErrorCategory {
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    if (errorMsg.includes('rate limit') || errorMsg.includes('too many requests')) {
      return 'rate_limit';
    } else if (errorMsg.includes('circuit breaker')) {
      return 'circuit_breaker';
    } else if (errorMsg.includes('network') || errorMsg.includes('connection')) {
      return 'network';
    } else if (errorMsg.includes('rpc') || errorMsg.includes('provider')) {
      return 'rpc';
    } else if (errorMsg.includes('transaction') || errorMsg.includes('gas')) {
      return 'transaction';
    } else if (errorMsg.includes('validation') || errorMsg.includes('invalid')) {
      return 'validation';
    } else {
      return 'unknown';
    }
  }
  
  // Internal variable to track block height
  private _lastBlockHeight?: number;

  /**
   * Record operation latency
   */
  public recordOperationLatency(
    chain: string,
    operation: string,
    latencyMs: number
  ): void {
    if (!this.config.enabled) return;
    
    const metrics = this.getOrCreateChainMetrics(chain);
    
    // Initialize operation latencies if needed
    if (!metrics.latencyMetrics.operationLatencies.has(operation)) {
      metrics.latencyMetrics.operationLatencies.set(operation, []);
    }
    
    // Record latency
    const latencies = metrics.latencyMetrics.operationLatencies.get(operation)!;
    latencies.push(latencyMs);
    
    // Keep only last 1000 samples
    if (latencies.length > 1000) {
      latencies.shift();
    }
    
    // Update average latency
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    metrics.latencyMetrics.avgLatencyByOperation.set(operation, avg);
    
    // Calculate p95 latency
    const sorted = [...latencies].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    metrics.latencyMetrics.p95LatencyByOperation.set(operation, sorted[p95Index]);
    
    metrics.lastUpdated = Date.now();
  }
  
  /**
   * Record cross-chain operation latency
   */
  public recordCrossChainLatency(
    sourceChain: string,
    targetChain: string,
    latencyMs: number
  ): void {
    if (!this.config.enabled) return;
    
    const chainPair = `${sourceChain}-${targetChain}`;
    const metrics = this.getOrCreateChainMetrics(sourceChain);
    
    // Initialize cross-chain latencies if needed
    if (!metrics.latencyMetrics.crossChainLatencies.has(chainPair)) {
      metrics.latencyMetrics.crossChainLatencies.set(chainPair, []);
    }
    
    // Record latency
    const latencies = metrics.latencyMetrics.crossChainLatencies.get(chainPair)!;
    latencies.push(latencyMs);
    
    // Keep only last 1000 samples
    if (latencies.length > 1000) {
      latencies.shift();
    }
    
    // Update average latency
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    metrics.latencyMetrics.avgCrossChainLatency.set(chainPair, avg);
    
    // Calculate p95 latency
    const sorted = [...latencies].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    metrics.latencyMetrics.p95CrossChainLatency.set(chainPair, sorted[p95Index]);
    
    metrics.lastUpdated = Date.now();
  }
  
  /**
   * Update chain health metrics
   */
  public updateChainHealth(
    chain: string,
    blockTime: number,
    gasPrice: number,
    error?: Error
  ): void {
    if (!this.config.enabled) return;
    
    const metrics = this.getOrCreateChainMetrics(chain);
    const health = metrics.healthMetrics;
    
    // Update block time metrics
    health.lastBlockTime = blockTime;
    health.blockTimeSamples.push(blockTime);
    if (health.blockTimeSamples.length > 100) {
      health.blockTimeSamples.shift();
    }
    health.blockTimeAverage = health.blockTimeSamples.reduce((a, b) => a + b, 0) / health.blockTimeSamples.length;
    
    // Update gas price history
    health.gasPriceHistory.push(gasPrice);
    if (health.gasPriceHistory.length > 100) {
      health.gasPriceHistory.shift();
    }
    
    // Update error metrics
    if (error) {
      health.consecutiveErrors++;
      health.lastErrorTimestamp = Date.now();
      health.lastErrorType = error.name;
    } else {
      health.consecutiveErrors = 0;
    }
    
    // Calculate error rate
    const totalOperations = metrics.successCount + metrics.failureCount;
    health.errorRate = totalOperations > 0 ? metrics.failureCount / totalOperations : 0;
    
    metrics.lastUpdated = Date.now();
  }
  
  /**
   * Update performance metrics
   */
  public updatePerformanceMetrics(
    chain: string,
    pendingTx: number,
    confirmedTx: number,
    failedTx: number,
    confirmationTimeMs: number
  ): void {
    if (!this.config.enabled) return;
    
    const metrics = this.getOrCreateChainMetrics(chain);
    const perf = metrics.performanceMetrics;
    
    // Update transaction counts
    perf.pendingTransactions = pendingTx;
    perf.confirmedTransactions = confirmedTx;
    perf.failedTransactions = failedTx;
    
    // Update confirmation time metrics
    perf.confirmationTimeSamples.push(confirmationTimeMs);
    if (perf.confirmationTimeSamples.length > 100) {
      perf.confirmationTimeSamples.shift();
    }
    perf.avgConfirmationTime = perf.confirmationTimeSamples.reduce((a, b) => a + b, 0) / perf.confirmationTimeSamples.length;
    
    // Calculate TPS (transactions per second)
    const timeWindow = 60 * 1000; // 1 minute
    const recentSamples = perf.confirmationTimeSamples.filter(
      time => time > Date.now() - timeWindow
    );
    perf.tps = recentSamples.length / (timeWindow / 1000);
    
    metrics.lastUpdated = Date.now();
  }
  
  /**
   * Get detailed metrics for a chain
   */
  public getDetailedMetrics(chain: string): ChainMetrics | undefined {
    return this.metrics.get(chain);
  }
  
  /**
   * Get cross-chain latency statistics
   */
  public getCrossChainLatencyStats(sourceChain: string, targetChain: string): {
    avgLatency: number;
    p95Latency: number;
    samples: number;
  } {
    const metrics = this.metrics.get(sourceChain);
    if (!metrics) {
      return { avgLatency: 0, p95Latency: 0, samples: 0 };
    }
    
    const chainPair = `${sourceChain}-${targetChain}`;
    const latencies = metrics.latencyMetrics.crossChainLatencies.get(chainPair) || [];
    
    return {
      avgLatency: metrics.latencyMetrics.avgCrossChainLatency.get(chainPair) || 0,
      p95Latency: metrics.latencyMetrics.p95CrossChainLatency.get(chainPair) || 0,
      samples: latencies.length
    };
  }
  
  /**
   * Get operation latency statistics
   */
  public getOperationLatencyStats(chain: string, operation: string): {
    avgLatency: number;
    p95Latency: number;
    samples: number;
  } {
    const metrics = this.metrics.get(chain);
    if (!metrics) {
      return { avgLatency: 0, p95Latency: 0, samples: 0 };
    }
    
    const latencies = metrics.latencyMetrics.operationLatencies.get(operation) || [];
    
    return {
      avgLatency: metrics.latencyMetrics.avgLatencyByOperation.get(operation) || 0,
      p95Latency: metrics.latencyMetrics.p95LatencyByOperation.get(operation) || 0,
      samples: latencies.length
    };
  }
  
  /**
   * Get chain health status
   */
  public getChainHealthStatus(chain: string): {
    isHealthy: boolean;
    errorRate: number;
    consecutiveErrors: number;
    avgBlockTime: number;
    lastError: string;
    lastErrorTime: number;
  } {
    const metrics = this.metrics.get(chain);
    if (!metrics) {
      return {
        isHealthy: false,
        errorRate: 1,
        consecutiveErrors: 0,
        avgBlockTime: 0,
        lastError: '',
        lastErrorTime: 0
      };
    }
    
    const health = metrics.healthMetrics;
    
    return {
      isHealthy: health.errorRate < 0.1 && health.consecutiveErrors < 3,
      errorRate: health.errorRate,
      consecutiveErrors: health.consecutiveErrors,
      avgBlockTime: health.blockTimeAverage,
      lastError: health.lastErrorType,
      lastErrorTime: health.lastErrorTimestamp
    };
  }
  
  /**
   * Get performance statistics
   */
  public getPerformanceStats(chain: string): {
    tps: number;
    pendingTx: number;
    confirmedTx: number;
    failedTx: number;
    avgConfirmationTime: number;
  } {
    const metrics = this.metrics.get(chain);
    if (!metrics) {
      return {
        tps: 0,
        pendingTx: 0,
        confirmedTx: 0,
        failedTx: 0,
        avgConfirmationTime: 0
      };
    }
    
    const perf = metrics.performanceMetrics;
    
    return {
      tps: perf.tps,
      pendingTx: perf.pendingTransactions,
      confirmedTx: perf.confirmedTransactions,
      failedTx: perf.failedTransactions,
      avgConfirmationTime: perf.avgConfirmationTime
    };
  }
}

/**
 * Enhance an adapter with telemetry
 * 
 * This function wraps adapter methods to automatically record telemetry
 * 
 * @param adapter The adapter to enhance
 * @param telemetry The telemetry instance to use
 * @returns Enhanced adapter with telemetry
 */
export function enhanceAdapterWithTelemetry(
  adapter: IChainAdapter,
  telemetry: BlockchainTelemetry
): IChainAdapter {
  // Skip if already enhanced
  if ((adapter as any)._telemetryEnhanced) {
    return adapter;
  }

  // Create proxy to intercept method calls
  const enhancedAdapter = new Proxy(adapter, {
    get(target, prop, receiver) {
      const originalMethod = Reflect.get(target, prop, receiver);
      
      // Only proxy methods
      if (typeof originalMethod !== 'function' || prop === 'constructor') {
        return originalMethod;
      }

      // Map prop to telemetry operation type if possible
      let operationType: TelemetryOperationType | string;
      switch (prop) {
        case 'connect':
          operationType = TelemetryOperationType.CONNECT;
          break;
        case 'disconnect':
          operationType = TelemetryOperationType.DISCONNECT;
          break;
        case 'getBalance':
          operationType = TelemetryOperationType.GET_BALANCE;
          break;
        case 'executeTrade':
          operationType = TelemetryOperationType.EXECUTE_TRADE;
          break;
        case 'getQuote':
          operationType = TelemetryOperationType.GET_QUOTE;
          break;
        case 'getStatus':
          operationType = TelemetryOperationType.GET_STATUS;
          break;
        case 'getTransactionStatus':
          operationType = TelemetryOperationType.GET_TX_STATUS;
          break;
        case 'estimateGas':
          operationType = TelemetryOperationType.ESTIMATE_GAS;
          break;
        case 'submitTransaction':
          operationType = TelemetryOperationType.SUBMIT_TX;
          break;
        case 'checkHealth':
          operationType = TelemetryOperationType.CHECK_HEALTH;
          break;
        case 'getAssetInfo':
          operationType = TelemetryOperationType.GET_ASSET_INFO;
          break;
        case 'getGasPrice':
          operationType = TelemetryOperationType.GET_GAS_PRICE;
          break;
        default:
          operationType = `method_${String(prop)}`;
      }

      // Return wrapped method
      return async function(...args: any[]) {
        // Special handling for certain methods
        if (prop === 'executeTrade') {
          return handleTradeExecution(telemetry, originalMethod, args, target);
        }
        
        if (prop === 'getStatus') {
          return handleGetStatus(telemetry, originalMethod, target);
        }
        
        // Default handling for most methods
        return telemetry.trackOperation(operationType, 
          () => originalMethod.apply(target, args)
        );
      };
    }
  });

  // Mark as enhanced to prevent double enhancement
  (enhancedAdapter as any)._telemetryEnhanced = true;
  
  return enhancedAdapter;
}

/**
 * Special handler for trade execution telemetry
 */
async function handleTradeExecution(
  telemetry: BlockchainTelemetry,
  originalMethod: Function,
  args: any[],
  target: any
): Promise<TradeResult> {
  const startTime = Date.now();
  const order: TradeOrder = args[0];
  
  try {
    // Track the operation
    const result = await telemetry.trackOperation<TradeResult>(
      TelemetryOperationType.EXECUTE_TRADE,
      () => originalMethod.apply(target, args)
    );
    
    // Get trading pair symbols
    const tradingPair = `${order.fromAsset.symbol}/${order.toAsset.symbol}`;
    
    // Estimate USD volume (if we have price data)
    let volumeUsd = 0;
    if (order.fromAsset.usdPrice) {
      volumeUsd = parseFloat(order.amount) * order.fromAsset.usdPrice;
    }
    
    // Calculate slippage from priceImpact if available
    let slippagePercent: number | undefined;
    if (result.priceImpact !== undefined) {
      slippagePercent = result.priceImpact;
    }
    
    // Calculate fees in USD if possible
    let feesUsd: number | undefined;
    if (result.fees?.networkFee && order.fromAsset.usdPrice) {
      const networkFee = parseFloat(result.fees.networkFee);
      feesUsd = networkFee * order.fromAsset.usdPrice;
      
      // Add protocol fee if present
      if (result.fees.protocolFee) {
        const protocolFee = parseFloat(result.fees.protocolFee);
        feesUsd += protocolFee * order.fromAsset.usdPrice;
      }
    }
    
    // Record trade metrics
    telemetry.recordTrade(
      startTime,
      volumeUsd,
      result.success,
      slippagePercent,
      feesUsd,
      tradingPair
    );
    
    return result;
  } catch (error) {
    // For failures, still record the trade with success=false
    telemetry.recordTrade(
      startTime,
      0, // Unknown volume on failure
      false,
      undefined,
      undefined,
      `${order.fromAsset.symbol}/${order.toAsset.symbol}`
    );
    
    throw error;
  }
}

/**
 * Special handler for get status telemetry
 */
async function handleGetStatus(
  telemetry: BlockchainTelemetry,
  originalMethod: Function,
  target: any
): Promise<ChainAdapterStatus> {
  // Track the operation
  const status = await telemetry.trackOperation<ChainAdapterStatus>(
    TelemetryOperationType.GET_STATUS,
    () => originalMethod.apply(target, [])
  );
  
  // Update status metrics
  telemetry.updateStatus(
    status.isConnected,
    status.blockHeight,
    status.gasPrice,
    status.baseFeePerGas
  );
  
  return status;
}

/**
 * Create a telemetry instance for a chain adapter
 * 
 * @param adapter The adapter to create telemetry for
 * @returns A telemetry instance
 */
export function createTelemetryForAdapter(adapter: IChainAdapter): BlockchainTelemetry {
  // Extract chain information from adapter
  const getChainId = () => adapter.getChainId();
  const isMainnet = adapter.getStatus().then(status => status.isMainnet);
  const networkName = adapter.getStatus().then(status => status.networkName);
  
  // Create telemetry with basic configuration
  const telemetry = new BlockchainTelemetry({
    enabled: true,
    detailedLogging: true,
    metricsInterval: 60000,
    circuitBreakers: {
      enabled: true
    }
  });
  
  // Set chain info when available
  Promise.all([
    Promise.resolve(getChainId()),
    isMainnet,
    networkName
  ]).then(([chainId, isMainnet, networkName]) => {
    telemetry.setChainInfo(
      chainId,
      isMainnet instanceof Promise ? true : isMainnet,
      typeof networkName === 'string' ? networkName : 'unknown'
    );
  });
  
  return telemetry;
}

/**
 * Create an enhanced adapter with telemetry
 * 
 * @param adapter The adapter to enhance
 * @returns Enhanced adapter with telemetry
 */
export function createEnhancedAdapter(adapter: IChainAdapter): IChainAdapter {
  const telemetry = createTelemetryForAdapter(adapter);
  return enhanceAdapterWithTelemetry(adapter, telemetry);
} 