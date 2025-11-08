import { logger } from '../utils/logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { StrategyGenome } from '../evolution/StrategyGenome';
import { ExecutionResult } from './interfaces/IExecutionAdapter';
import * as crypto from 'crypto';

/**
 * Strategy deployment information
 */
export interface StrategyDeployment {
  /**
   * Strategy ID
   */
  strategyId: string;
  
  /**
   * Chain ID where deployed
   */
  chainId: string;
  
  /**
   * Deployed contract address or identifier
   */
  deploymentAddress: string;
  
  /**
   * Deployment timestamp
   */
  deploymentTimestamp: number;
  
  /**
   * Content hash of deployed bytecode
   */
  contentHash: string;
  
  /**
   * Whether the deployment is currently active
   */
  isActive: boolean;
  
  /**
   * ABI version used
   */
  abiVersion: string;
  
  /**
   * Most recent strategy genome snapshot
   */
  genomeSnapshot: string;
  
  /**
   * Metadata about the deployment
   */
  metadata: Record<string, any>;
}

/**
 * Strategy execution history entry
 */
export interface StrategyExecutionRecord {
  /**
   * Strategy ID
   */
  strategyId: string;
  
  /**
   * Chain ID where executed
   */
  chainId: string;
  
  /**
   * Market symbol (e.g., "BTC/USD")
   */
  market: string;
  
  /**
   * Transaction ID/hash
   */
  transactionId: string;
  
  /**
   * Execution timestamp
   */
  timestamp: number;
  
  /**
   * Fee cost in chain's native currency
   */
  feeCost: number;
  
  /**
   * Execution time in milliseconds
   */
  executionTimeMs: number;
  
  /**
   * Whether the execution was successful
   */
  success: boolean;
  
  /**
   * Error message if unsuccessful
   */
  error?: string;
  
  /**
   * Actual slippage experienced in percentage
   */
  slippage?: number;
  
  /**
   * Block height/number when the transaction was included
   */
  blockHeight?: number;
  
  /**
   * Additional execution details
   */
  details?: Record<string, any>;
}

/**
 * Statistics about a chain for a particular strategy and market
 */
export interface ChainExecutionStats {
  /**
   * Total number of executions
   */
  totalExecutions: number;
  
  /**
   * Number of successful executions
   */
  successfulExecutions: number;
  
  /**
   * Average execution time in milliseconds
   */
  averageExecutionTimeMs: number;
  
  /**
   * Average fee cost in chain's native currency
   */
  averageFeeCost: number;
  
  /**
   * Average slippage in percentage
   */
  averageSlippage?: number;
  
  /**
   * Most recent execution timestamp
   */
  lastExecutionTimestamp: number;
  
  /**
   * Success rate (0-1)
   */
  successRate: number;
}

/**
 * Registry configuration
 */
export interface CrossChainStrategyRegistryConfig {
  /**
   * Maximum execution history entries to retain per strategy
   */
  maxExecutionHistoryPerStrategy: number;
  
  /**
   * Whether to validate bytecode on deployments
   */
  validateBytecode: boolean;
  
  /**
   * How long to consider execution stats relevant for decision making (ms)
   */
  statsRelevancePeriodMs: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: CrossChainStrategyRegistryConfig = {
  maxExecutionHistoryPerStrategy: 100,
  validateBytecode: true,
  statsRelevancePeriodMs: 24 * 60 * 60 * 1000 // 24 hours
};

/**
 * CrossChainStrategyRegistry
 * 
 * Tracks which strategies are deployed on which chains and maintains
 * execution history and statistics for routing decisions.
 */
export class CrossChainStrategyRegistry {
  private static instance: CrossChainStrategyRegistry | null = null;
  private config: CrossChainStrategyRegistryConfig;
  private deployments: Map<string, StrategyDeployment[]> = new Map();
  private executionHistory: Map<string, StrategyExecutionRecord[]> = new Map();
  private executionStats: Map<string, Map<string, ChainExecutionStats>> = new Map();
  private telemetryBus: TelemetryBus;
  
  /**
   * Private constructor
   */
  private constructor(config: Partial<CrossChainStrategyRegistryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    logger.info('CrossChainStrategyRegistry initialized');
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<CrossChainStrategyRegistryConfig>): CrossChainStrategyRegistry {
    if (!CrossChainStrategyRegistry.instance) {
      CrossChainStrategyRegistry.instance = new CrossChainStrategyRegistry(config);
    } else if (config) {
      CrossChainStrategyRegistry.instance.updateConfig(config);
    }
    return CrossChainStrategyRegistry.instance;
  }
  
  /**
   * Register a deployed strategy
   */
  public async registerDeployment(
    strategyId: string,
    chainId: string,
    deploymentAddress: string,
    genome: StrategyGenome,
    bytecodeHash: string,
    abiVersion: string,
    metadata: Record<string, any> = {}
  ): Promise<boolean> {
    try {
      // Generate a genome snapshot
      const genomeSnapshot = JSON.stringify(genome);
      
      // Create deployment record
      const deployment: StrategyDeployment = {
        strategyId,
        chainId,
        deploymentAddress,
        deploymentTimestamp: Date.now(),
        contentHash: bytecodeHash,
        isActive: true,
        abiVersion,
        genomeSnapshot,
        metadata
      };
      
      // Add to deployments map
      if (!this.deployments.has(strategyId)) {
        this.deployments.set(strategyId, []);
      }
      
      // Check if this deployment already exists
      const existingDeployments = this.deployments.get(strategyId)!;
      const existingIndex = existingDeployments.findIndex(
        d => d.chainId === chainId && d.deploymentAddress === deploymentAddress
      );
      
      if (existingIndex >= 0) {
        // Update existing deployment
        existingDeployments[existingIndex] = deployment;
        logger.info(`Updated deployment for strategy ${strategyId} on chain ${chainId} at ${deploymentAddress}`);
      } else {
        // Add new deployment
        existingDeployments.push(deployment);
        logger.info(`Registered new deployment for strategy ${strategyId} on chain ${chainId} at ${deploymentAddress}`);
      }
      
      // Emit telemetry
      this.telemetryBus.emit('strategy_deployment_registered', {
        strategyId,
        chainId,
        deploymentAddress,
        timestamp: deployment.deploymentTimestamp,
        abiVersion
      });
      
      return true;
    } catch (error) {
      logger.error(`Error registering deployment for strategy ${strategyId}:`, error);
      return false;
    }
  }
  
  /**
   * Get all deployments for a strategy
   */
  public async getDeployedStrategies(strategyId: string): Promise<StrategyDeployment[]> {
    return this.deployments.get(strategyId) || [];
  }
  
  /**
   * Find a deployment by chain and address
   */
  public async findDeployment(
    chainId: string,
    deploymentAddress: string
  ): Promise<StrategyDeployment | null> {
    for (const deployments of this.deployments.values()) {
      const deployment = deployments.find(
        d => d.chainId === chainId && d.deploymentAddress === deploymentAddress
      );
      
      if (deployment) {
        return deployment;
      }
    }
    
    return null;
  }
  
  /**
   * Get all deployments across all strategies
   */
  public async getAllDeployments(): Promise<StrategyDeployment[]> {
    const allDeployments: StrategyDeployment[] = [];
    
    for (const deployments of this.deployments.values()) {
      allDeployments.push(...deployments);
    }
    
    return allDeployments;
  }
  
  /**
   * Deactivate a deployment
   */
  public async deactivateDeployment(
    strategyId: string,
    chainId: string,
    deploymentAddress: string
  ): Promise<boolean> {
    const deployments = this.deployments.get(strategyId);
    if (!deployments) return false;
    
    const deploymentIndex = deployments.findIndex(
      d => d.chainId === chainId && d.deploymentAddress === deploymentAddress
    );
    
    if (deploymentIndex < 0) return false;
    
    deployments[deploymentIndex].isActive = false;
    
    // Emit telemetry
    this.telemetryBus.emit('strategy_deployment_deactivated', {
      strategyId,
      chainId,
      deploymentAddress,
      timestamp: Date.now()
    });
    
    logger.info(`Deactivated deployment for strategy ${strategyId} on chain ${chainId} at ${deploymentAddress}`);
    return true;
  }
  
  /**
   * Reactivate a deployment
   */
  public async reactivateDeployment(
    strategyId: string,
    chainId: string,
    deploymentAddress: string
  ): Promise<boolean> {
    const deployments = this.deployments.get(strategyId);
    if (!deployments) return false;
    
    const deploymentIndex = deployments.findIndex(
      d => d.chainId === chainId && d.deploymentAddress === deploymentAddress
    );
    
    if (deploymentIndex < 0) return false;
    
    deployments[deploymentIndex].isActive = true;
    
    // Emit telemetry
    this.telemetryBus.emit('strategy_deployment_reactivated', {
      strategyId,
      chainId,
      deploymentAddress,
      timestamp: Date.now()
    });
    
    logger.info(`Reactivated deployment for strategy ${strategyId} on chain ${chainId} at ${deploymentAddress}`);
    return true;
  }
  
  /**
   * Record a strategy execution
   */
  public async recordExecution(
    strategyId: string,
    chainId: string,
    market: string,
    transactionId: string,
    result: ExecutionResult
  ): Promise<boolean> {
    try {
      // Create execution record
      const record: StrategyExecutionRecord = {
        strategyId,
        chainId,
        market,
        transactionId,
        timestamp: Date.now(),
        feeCost: result.feeCost,
        executionTimeMs: result.executionTimeMs,
        success: result.success,
        error: result.error,
        slippage: result.actualSlippage,
        blockHeight: result.blockHeight,
        details: result.chainData
      };
      
      // Add to execution history
      const historyKey = `${strategyId}:${market}`;
      if (!this.executionHistory.has(historyKey)) {
        this.executionHistory.set(historyKey, []);
      }
      
      const history = this.executionHistory.get(historyKey)!;
      history.unshift(record); // Add to beginning (most recent first)
      
      // Trim history if needed
      if (history.length > this.config.maxExecutionHistoryPerStrategy) {
        history.splice(this.config.maxExecutionHistoryPerStrategy);
      }
      
      // Update execution stats
      this.updateExecutionStats(strategyId, chainId, market, record);
      
      // Emit telemetry
      this.telemetryBus.emit('strategy_execution_recorded', {
        strategyId,
        chainId,
        market,
        transactionId,
        success: result.success,
        timestamp: record.timestamp,
        executionTimeMs: record.executionTimeMs,
        feeCost: record.feeCost
      });
      
      logger.info(`Recorded execution for strategy ${strategyId} on chain ${chainId} for market ${market}`);
      return true;
    } catch (error) {
      logger.error(`Error recording execution for strategy ${strategyId}:`, error);
      return false;
    }
  }
  
  /**
   * Get execution history for a strategy and market
   */
  public async getExecutionHistory(
    strategyId: string,
    market: string,
    limit: number = 50
  ): Promise<StrategyExecutionRecord[]> {
    const historyKey = `${strategyId}:${market}`;
    const history = this.executionHistory.get(historyKey) || [];
    return history.slice(0, limit);
  }
  
  /**
   * Get execution statistics for a strategy, market, and chain
   */
  public async getExecutionStats(
    strategyId: string,
    market: string,
    chainId: string
  ): Promise<ChainExecutionStats | null> {
    const statsKey = `${strategyId}:${market}`;
    const chainStats = this.executionStats.get(statsKey);
    
    if (!chainStats) return null;
    
    return chainStats.get(chainId) || null;
  }
  
  /**
   * Get execution statistics for a strategy and market across all chains
   */
  public async getAllChainStats(
    strategyId: string,
    market: string
  ): Promise<Map<string, ChainExecutionStats>> {
    const statsKey = `${strategyId}:${market}`;
    return this.executionStats.get(statsKey) || new Map();
  }
  
  /**
   * Calculate optimal chain for a strategy and market based on historical performance
   */
  public async calculateOptimalChain(
    strategyId: string,
    market: string
  ): Promise<{ chainId: string; score: number } | null> {
    const statsKey = `${strategyId}:${market}`;
    const chainStats = this.executionStats.get(statsKey);
    
    if (!chainStats || chainStats.size === 0) {
      return null;
    }
    
    let bestChain: string | null = null;
    let bestScore = -Infinity;
    
    // Calculate scores for each chain
    for (const [chainId, stats] of chainStats.entries()) {
      // Only consider recent stats
      if (Date.now() - stats.lastExecutionTimestamp > this.config.statsRelevancePeriodMs) {
        continue;
      }
      
      // Only consider chains with at least 5 executions
      if (stats.totalExecutions < 5) {
        continue;
      }
      
      // Calculate score based on success rate, execution time, and fee cost
      // Higher score is better
      const successWeight = 0.5;
      const timeWeight = 0.3;
      const feeWeight = 0.2;
      
      // Normalize times (lower is better, max 10 seconds)
      const normalizedTime = Math.max(0, 1 - stats.averageExecutionTimeMs / 10000);
      
      // Fee score (inverted so lower fee is better)
      // This is chain-specific, so we normalize differently per chain
      // For simplicity, assuming fee < 0.01 is best (1.0), fee > 0.1 is worst (0.0)
      const normalizedFee = Math.max(0, 1 - stats.averageFeeCost / 0.1);
      
      const score = (
        (stats.successRate * successWeight) +
        (normalizedTime * timeWeight) +
        (normalizedFee * feeWeight)
      );
      
      if (score > bestScore) {
        bestScore = score;
        bestChain = chainId;
      }
    }
    
    if (!bestChain) {
      return null;
    }
    
    return {
      chainId: bestChain,
      score: bestScore
    };
  }
  
  /**
   * Verify deployed bytecode against expected hash
   */
  public async verifyDeployment(
    strategyId: string,
    chainId: string,
    deploymentAddress: string,
    bytecode: string
  ): Promise<boolean> {
    try {
      // Find deployment
      const deployments = this.deployments.get(strategyId);
      if (!deployments) return false;
      
      const deployment = deployments.find(
        d => d.chainId === chainId && d.deploymentAddress === deploymentAddress
      );
      
      if (!deployment) return false;
      
      // Calculate hash of provided bytecode
      const bytecodeHash = crypto
        .createHash('sha256')
        .update(bytecode)
        .digest('hex');
      
      // Compare hashes
      const isValid = bytecodeHash === deployment.contentHash;
      
      // Emit telemetry
      this.telemetryBus.emit('strategy_bytecode_verification', {
        strategyId,
        chainId,
        deploymentAddress,
        isValid,
        timestamp: Date.now()
      });
      
      if (!isValid) {
        logger.warn(`Bytecode verification failed for strategy ${strategyId} on chain ${chainId} at ${deploymentAddress}`);
      }
      
      return isValid;
    } catch (error) {
      logger.error(`Error verifying bytecode for strategy ${strategyId}:`, error);
      return false;
    }
  }
  
  /**
   * Update execution statistics with a new execution record
   */
  private updateExecutionStats(
    strategyId: string,
    chainId: string,
    market: string,
    record: StrategyExecutionRecord
  ): void {
    const statsKey = `${strategyId}:${market}`;
    
    if (!this.executionStats.has(statsKey)) {
      this.executionStats.set(statsKey, new Map());
    }
    
    const chainStats = this.executionStats.get(statsKey)!;
    
    if (!chainStats.has(chainId)) {
      // Initialize stats for this chain
      chainStats.set(chainId, {
        totalExecutions: 0,
        successfulExecutions: 0,
        averageExecutionTimeMs: 0,
        averageFeeCost: 0,
        averageSlippage: 0,
        lastExecutionTimestamp: 0,
        successRate: 0
      });
    }
    
    const stats = chainStats.get(chainId)!;
    
    // Update stats
    stats.totalExecutions++;
    if (record.success) {
      stats.successfulExecutions++;
    }
    
    // Update averages
    stats.averageExecutionTimeMs = this.updateAverage(
      stats.averageExecutionTimeMs,
      record.executionTimeMs,
      stats.totalExecutions
    );
    
    stats.averageFeeCost = this.updateAverage(
      stats.averageFeeCost,
      record.feeCost,
      stats.totalExecutions
    );
    
    if (record.slippage !== undefined) {
      stats.averageSlippage = this.updateAverage(
        stats.averageSlippage || 0,
        record.slippage,
        stats.totalExecutions
      );
    }
    
    stats.lastExecutionTimestamp = record.timestamp;
    stats.successRate = stats.successfulExecutions / stats.totalExecutions;
  }
  
  /**
   * Helper method to update average values
   */
  private updateAverage(
    currentAvg: number,
    newValue: number,
    count: number
  ): number {
    if (count <= 1) {
      return newValue;
    }
    
    // Calculate weighted average to account for data age
    // More recent executions should have more weight
    const previousWeight = (count - 1) / count;
    const newWeight = 1 / count;
    
    return (currentAvg * previousWeight) + (newValue * newWeight);
  }
  
  /**
   * Update registry configuration
   */
  private updateConfig(config: Partial<CrossChainStrategyRegistryConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('CrossChainStrategyRegistry configuration updated');
  }
} 