import { logger } from '../../utils/logger';
import { TelemetryBus } from '../../telemetry/TelemetryBus';
import { StrategyGenome } from '../../evolution/StrategyGenome';
import { 
  IExecutionAdapter, 
  ExecutionParams, 
  ExecutionResult, 
  FeeEstimation,
  ChainHealthStatus
} from '../interfaces/IExecutionAdapter';

/**
 * Base configuration for all chain adapters
 */
export interface BaseChainAdapterConfig {
  /**
   * RPC endpoint URLs (primary and fallbacks)
   */
  rpcUrls: string[];
  
  /**
   * Network name or identifier
   */
  networkName: string;
  
  /**
   * Maximum wait time for transaction confirmation in ms
   */
  maxConfirmTimeMs: number;
  
  /**
   * Whether to emit detailed telemetry
   */
  emitDetailedTelemetry: boolean;
  
  /**
   * Maximum retries for RPC failures
   */
  rpcRetries: number;
}

/**
 * Abstract base class for all chain adapters
 * Implements common functionality to reduce duplication
 */
export abstract class BaseChainAdapter<TConfig extends BaseChainAdapterConfig> implements IExecutionAdapter {
  protected config: TConfig;
  protected telemetryBus: TelemetryBus;
  protected isInitialized: boolean = false;
  protected healthCheckTimestamp: number = 0;
  protected healthStatus: ChainHealthStatus | null = null;
  
  // [FIX][CRITICAL] - Add timer references for cleanup
  protected congestionMonitorTimer?: NodeJS.Timeout;
  protected bridgeMetricsTimer?: NodeJS.Timeout;
  protected healthCheckTimer?: NodeJS.Timeout;
  
  /**
   * Constructor
   */
  constructor(defaultConfig: TConfig, userConfig: Partial<TConfig> = {}) {
    this.config = { ...defaultConfig, ...userConfig } as TConfig;
    this.telemetryBus = TelemetryBus.getInstance();
    
    logger.info(`${this.constructor.name} created for ${this.config.networkName}`);
  }
  
  /**
   * Get chain identifier
   * Must be implemented by each adapter
   */
  public abstract getChainId(): string;
  
  /**
   * Initialize the adapter
   */
  public async initialize(config: Record<string, any> = {}): Promise<boolean> {
    try {
      // Apply configuration if provided
      if (Object.keys(config).length > 0) {
        this.config = { ...this.config, ...config } as TConfig;
      }
      
      // Perform adapter-specific initialization
      const success = await this.initializeAdapter();
      
      if (success) {
        this.isInitialized = true;
        logger.info(`${this.constructor.name} initialized for ${this.config.networkName}`);
        
        // Emit telemetry
        this.telemetryBus.emit(`${this.getTelemetryPrefix()}_adapter_initialized`, {
          chainId: this.getChainId(),
          networkName: this.config.networkName,
          timestamp: Date.now()
        });
      } else {
        logger.error(`Failed to initialize ${this.constructor.name}`);
      }
      
      return success;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error initializing ${this.constructor.name}: ${errorMsg}`, error);
      
      // Emit telemetry
      this.telemetryBus.emit(`${this.getTelemetryPrefix()}_adapter_initialization_failed`, {
        chainId: this.getChainId(),
        error: errorMsg,
        timestamp: Date.now()
      });
      
      return false;
    }
  }
  
  /**
   * Execute a strategy
   */
  public async executeStrategy(
    genome: StrategyGenome, 
    market: string, 
    params: ExecutionParams
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    try {
      this.validateInitialized();
      
      logger.info(`Executing strategy ${genome.id} on ${this.config.networkName} for market ${market}`);
      
      // Emit telemetry for execution start
      this.telemetryBus.emit(`${this.getTelemetryPrefix()}_execution_started`, {
        strategyId: genome.id,
        market,
        chainId: this.getChainId(),
        timestamp: startTime
      });
      
      // Perform the actual execution (implemented by derived classes)
      const result = await this.executeStrategyInternal(genome, market, params);
      
      // Calculate execution time
      const executionTimeMs = Date.now() - startTime;
      
      // Add common fields to result
      const completeResult: ExecutionResult = {
        ...result,
        timestamp: Date.now(),
        executionTimeMs
      };
      
      // Emit telemetry for execution completion
      if (completeResult.success) {
        this.telemetryBus.emit(`${this.getTelemetryPrefix()}_execution_completed`, {
          strategyId: genome.id,
          market,
          chainId: this.getChainId(),
          transactionId: completeResult.transactionId,
          blockHeight: completeResult.blockHeight,
          executionTimeMs,
          feeCost: completeResult.feeCost,
          success: true,
          timestamp: Date.now()
        });
        
        logger.info(`Strategy ${genome.id} executed successfully on ${this.config.networkName}: ${completeResult.transactionId}`);
      } else {
        this.telemetryBus.emit(`${this.getTelemetryPrefix()}_execution_failed`, {
          strategyId: genome.id,
          market,
          chainId: this.getChainId(),
          error: completeResult.error,
          executionTimeMs,
          timestamp: Date.now()
        });
        
        logger.error(`Strategy ${genome.id} execution failed on ${this.config.networkName}: ${completeResult.error}`);
      }
      
      return completeResult;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error executing strategy ${genome.id} on ${this.config.networkName}: ${errorMsg}`, error);
      
      // Emit telemetry for execution failure
      this.telemetryBus.emit(`${this.getTelemetryPrefix()}_execution_failed`, {
        strategyId: genome.id,
        market,
        chainId: this.getChainId(),
        error: errorMsg,
        executionTimeMs: Date.now() - startTime,
        timestamp: Date.now()
      });
      
      return {
        success: false,
        error: errorMsg,
        timestamp: Date.now(),
        executionTimeMs: Date.now() - startTime,
        feeCost: 0
      };
    }
  }
  
  /**
   * Estimate fees for an execution
   */
  public async estimateFees(
    genome: StrategyGenome,
    market: string,
    params: ExecutionParams
  ): Promise<FeeEstimation> {
    try {
      this.validateInitialized();
      
      // Call adapter-specific implementation
      return await this.estimateFeesInternal(genome, market, params);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error estimating fees for ${genome.id} on ${this.config.networkName}: ${errorMsg}`, error);
      
      // Return default values in case of error
      return this.getDefaultFeeEstimation();
    }
  }
  
  /**
   * Check status of a transaction
   */
  public async checkTransactionStatus(transactionId: string): Promise<ExecutionResult> {
    try {
      this.validateInitialized();
      
      // Call adapter-specific implementation
      return await this.checkTransactionStatusInternal(transactionId);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error checking transaction status ${transactionId} on ${this.config.networkName}: ${errorMsg}`, error);
      
      return {
        success: false,
        transactionId,
        error: errorMsg,
        timestamp: Date.now(),
        executionTimeMs: 0,
        feeCost: 0
      };
    }
  }
  
  /**
   * Get chain health status
   */
  public async getChainHealthStatus(): Promise<ChainHealthStatus> {
    try {
      // Check if we have a recent health check (within 30 seconds)
      if (this.healthStatus && Date.now() - this.healthCheckTimestamp < 30000) {
        return this.healthStatus;
      }
      
      const startTime = Date.now();
      
      // Call adapter-specific implementation
      this.healthStatus = await this.getChainHealthStatusInternal();
      this.healthCheckTimestamp = Date.now();
      
      // Emit telemetry
      this.telemetryBus.emit(`${this.getTelemetryPrefix()}_health_check`, {
        chainId: this.getChainId(),
        blockHeight: this.healthStatus.currentBlockHeight,
        averageBlockTimeMs: this.healthStatus.averageBlockTimeMs,
        networkCongestion: this.healthStatus.networkCongestion,
        rpcResponseTimeMs: this.healthStatus.rpcResponseTimeMs,
        timestamp: Date.now()
      });
      
      return this.healthStatus;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error getting chain health status for ${this.config.networkName}: ${errorMsg}`, error);
      
      // Create a degraded health status
      const degradedStatus: ChainHealthStatus = {
        isOperational: false,
        currentBlockHeight: 0,
        latestBlockTimestamp: 0,
        averageBlockTimeMs: 0,
        networkCongestion: 1, // Maximum congestion
        currentTps: 0,
        rpcResponseTimeMs: 0,
        isConfigured: this.isInitialized,
        chainSpecific: {
          networkName: this.config.networkName,
          error: errorMsg
        }
      };
      
      // Emit telemetry
      this.telemetryBus.emit(`${this.getTelemetryPrefix()}_health_check_failed`, {
        chainId: this.getChainId(),
        error: errorMsg,
        timestamp: Date.now()
      });
      
      return degradedStatus;
    }
  }
  
  /**
   * Validate if a strategy can be executed by this adapter
   */
  public async validateStrategy(genome: StrategyGenome): Promise<{
    isValid: boolean;
    errors?: string[];
  }> {
    try {
      // Basic validation
      if (!genome || !genome.id) {
        return {
          isValid: false,
          errors: ['Invalid strategy genome']
        };
      }
      
      // Call adapter-specific implementation
      return await this.validateStrategyInternal(genome);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error validating strategy ${genome?.id} for ${this.config.networkName}: ${errorMsg}`, error);
      
      return {
        isValid: false,
        errors: [errorMsg]
      };
    }
  }
  
  /**
   * Abstract methods to be implemented by derived classes
   */
  protected abstract initializeAdapter(): Promise<boolean>;
  protected abstract executeStrategyInternal(genome: StrategyGenome, market: string, params: ExecutionParams): Promise<ExecutionResult>;
  protected abstract estimateFeesInternal(genome: StrategyGenome, market: string, params: ExecutionParams): Promise<FeeEstimation>;
  protected abstract checkTransactionStatusInternal(transactionId: string): Promise<ExecutionResult>;
  protected abstract getChainHealthStatusInternal(): Promise<ChainHealthStatus>;
  protected abstract validateStrategyInternal(genome: StrategyGenome): Promise<{ isValid: boolean; errors?: string[] }>;
  
  /**
   * [FIX][CRITICAL] - Add missing getMarketData method for bridge-related functionality
   */
  public async getMarketData(symbol: string): Promise<any> {
    try {
      this.validateInitialized();
      
      // Call adapter-specific implementation
      return await this.getMarketDataInternal(symbol);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error getting market data for ${symbol} on ${this.config.networkName}: ${errorMsg}`, error);
      
      // Return minimal market data structure
      return {
        symbol,
        price: 0,
        timestamp: Date.now(),
        error: errorMsg
      };
    }
  }
  
  /**
   * [FIX][CRITICAL] - Add monitoring methods for congestion and bridge metrics
   */
  public startCongestionMonitoring(): void {
    if (this.congestionMonitorTimer) {
      clearInterval(this.congestionMonitorTimer);
    }
    
    this.congestionMonitorTimer = setInterval(async () => {
      try {
        await this.monitorCongestion();
      } catch (error) {
        logger.error(`Error monitoring congestion for ${this.config.networkName}:`, error);
      }
    }, 30000); // Monitor every 30 seconds
  }
  
  public startBridgeMetricsCollection(): void {
    if (this.bridgeMetricsTimer) {
      clearInterval(this.bridgeMetricsTimer);
    }
    
    this.bridgeMetricsTimer = setInterval(async () => {
      try {
        await this.collectBridgeMetrics();
      } catch (error) {
        logger.error(`Error collecting bridge metrics for ${this.config.networkName}:`, error);
      }
    }, 60000); // Collect every minute
  }
  
  /**
   * [FIX][CRITICAL] - Add cleanup method for timer management and resource cleanup
   */
  public async shutdownImpl(): Promise<void> {
    logger.info(`Shutting down ${this.constructor.name} for ${this.config.networkName}`);
    
    // Clear all timers
    if (this.congestionMonitorTimer) {
      clearInterval(this.congestionMonitorTimer);
      this.congestionMonitorTimer = undefined;
    }
    
    if (this.bridgeMetricsTimer) {
      clearInterval(this.bridgeMetricsTimer);
      this.bridgeMetricsTimer = undefined;
    }
    
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
    
    // Call adapter-specific cleanup
    await this.shutdownAdapterInternal();
    
    // Reset state
    this.isInitialized = false;
    this.healthStatus = null;
    this.healthCheckTimestamp = 0;
    
    // Emit telemetry
    this.telemetryBus.emit(`${this.getTelemetryPrefix()}_adapter_shutdown`, {
      chainId: this.getChainId(),
      networkName: this.config.networkName,
      timestamp: Date.now()
    });
  }
  
  /**
   * Protected helper methods
   */
  
  /**
   * Get default fee estimation for fallback
   */
  protected abstract getDefaultFeeEstimation(): FeeEstimation;
  
  /**
   * Get telemetry prefix for this adapter
   */
  protected abstract getTelemetryPrefix(): string;
  
  /**
   * [FIX][CRITICAL] - Add missing abstract methods for complete implementation
   */
  protected abstract getMarketDataInternal(symbol: string): Promise<any>;
  protected abstract monitorCongestion(): Promise<void>;
  protected abstract collectBridgeMetrics(): Promise<void>;
  protected abstract shutdownAdapterInternal(): Promise<void>;
  
  /**
   * Validate that the adapter is initialized
   */
  protected validateInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Adapter not initialized. Call initialize() first.');
    }
  }
} 