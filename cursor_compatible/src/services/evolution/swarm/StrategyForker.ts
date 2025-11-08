/**
 * Strategy Forker
 * 
 * Handles forking existing strategies with mutations to create new variants
 * for different agent specializations.
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../../../utils/logger.js';
import { MutationEngine } from '../mutation/MutationEngine.js';
import { MutationGeneratorOptions } from '../mutation/types.js';
import { MutationType } from '../types.js';
import { TradingStrategy } from '../mutation/strategy-model.js';
import { AgentLineage } from '../../../types/agent.types.js';

/**
 * Reasons for strategy forking
 */
export enum ForkReason {
  /** Performance optimization */
  PERFORMANCE_OPTIMIZATION = 'performance_optimization',
  
  /** Specialization for different market conditions */
  MARKET_SPECIALIZATION = 'market_specialization',
  
  /** Risk adjustment */
  RISK_ADJUSTMENT = 'risk_adjustment',
  
  /** Response to new instrument or data */
  NEW_INSTRUMENT_ADAPTATION = 'new_instrument_adaptation',
  
  /** Remediation after poor performance */
  UNDERPERFORMANCE_REMEDIATION = 'underperformance_remediation',
  
  /** Specialization for specific time frames */
  TIMEFRAME_SPECIALIZATION = 'timeframe_specialization',
  
  /** Initial divergence in a new cluster */
  CLUSTER_DIVERGENCE = 'cluster_divergence',
  
  /** Hybrid strategy combining elements of multiple parents */
  HYBRID_FORMATION = 'hybrid_formation'
}

/**
 * Options for forking a strategy
 */
export interface StrategyForkOptions {
  /** Mutation type to apply */
  mutationType: MutationType;
  
  /** Reason for the fork */
  forkReason: ForkReason;
  
  /** Cluster ID for the new agent */
  clusterId: string;
  
  /** Additional mutation options */
  mutationOptions?: MutationGeneratorOptions;
  
  /** Agent lineage information */
  lineage?: Partial<AgentLineage>;
  
  /** Custom traits to consider in the mutation */
  customTraits?: Record<string, any>;
}

/**
 * Result of a strategy fork operation
 */
export interface StrategyForkResult {
  /** New strategy created by the fork */
  strategy: TradingStrategy;
  
  /** New strategy ID */
  strategyId: string;
  
  /** Original strategy ID */
  parentStrategyId: string;
  
  /** Mutation type that was applied */
  mutationType: MutationType;
  
  /** Reason for the fork */
  forkReason: ForkReason;
  
  /** Agent lineage record */
  lineage: AgentLineage;
  
  /** Timestamp when the fork was executed */
  timestamp: number;
}

/**
 * Strategy forking service
 * Responsible for creating new strategy variants through mutation
 */
export class StrategyForker {
  private mutationEngine: MutationEngine;
  
  /**
   * Create a new strategy forker
   */
  constructor() {
    this.mutationEngine = MutationEngine.getInstance();
  }
  
  /**
   * Fork a strategy to create a new variant
   * 
   * @param parentStrategy Parent strategy to fork
   * @param agentId Agent ID that will use the new strategy
   * @param parentAgentId Parent agent ID
   * @param options Forking options
   * @returns Fork result with new strategy
   */
  public async forkStrategy(
    parentStrategy: TradingStrategy,
    agentId: string,
    parentAgentId: string,
    options: StrategyForkOptions
  ): Promise<StrategyForkResult> {
    logger.info(`Forking strategy ${parentStrategy.id} for agent ${agentId} with reason: ${options.forkReason}`);
    
    // Apply mutation to create new strategy
    const mutationResult = await this.mutationEngine.mutateStrategy(
      parentStrategy,
      options.mutationType,
      options.mutationOptions
    );
    
    // Generate lineage information
    const timestamp = Date.now();
    const generation = (options.lineage?.generation ?? 0) + 1;
    
    const lineage: AgentLineage = {
      agentId,
      parentId: parentAgentId,
      generation,
      mutationReason: options.forkReason,
      clusterId: options.clusterId,
      createdAt: timestamp,
      strategyId: mutationResult.strategyId,
      ...options.lineage
    };
    
    // Update strategy metadata
    const strategy = mutationResult.strategy as TradingStrategy;
    
    // Incorporate custom traits if provided
    if (options.customTraits && strategy.customParameters) {
      strategy.customParameters = {
        ...strategy.customParameters,
        ...options.customTraits
      };
    }
    
    // Add specialization notes to strategy description
    strategy.description = `${strategy.description} (Specialized for ${options.forkReason})`;
    
    logger.info(`Successfully forked strategy ${parentStrategy.id} to ${strategy.id} for agent ${agentId}`, { 
      mutationType: options.mutationType, 
      generation 
    });
    
    return {
      strategy,
      strategyId: strategy.id,
      parentStrategyId: parentStrategy.id,
      mutationType: options.mutationType,
      forkReason: options.forkReason,
      lineage,
      timestamp
    };
  }
  
  /**
   * Create a hybrid strategy by combining elements from multiple parent strategies
   * 
   * @param parentStrategies Array of parent strategies to combine
   * @param agentId Agent ID that will use the new strategy
   * @param parentAgentId Primary parent agent ID
   * @param options Forking options
   * @returns Fork result with new hybrid strategy
   */
  public async createHybridStrategy(
    parentStrategies: TradingStrategy[],
    agentId: string,
    parentAgentId: string,
    options: StrategyForkOptions
  ): Promise<StrategyForkResult> {
    if (parentStrategies.length < 2) {
      throw new Error('At least two parent strategies are required to create a hybrid');
    }
    
    // Use the first strategy as the base
    const baseStrategy = parentStrategies[0];
    const timestamp = Date.now();
    
    logger.info(`Creating hybrid strategy from ${parentStrategies.length} parents for agent ${agentId}`);
    
    // Clone the base strategy
    const hybridStrategy: TradingStrategy = JSON.parse(JSON.stringify(baseStrategy));
    hybridStrategy.id = uuidv4();
    hybridStrategy.name = `Hybrid-${hybridStrategy.id.substring(0, 8)}`;
    hybridStrategy.parentId = baseStrategy.id;
    hybridStrategy.updatedAt = timestamp;
    
    // Generate a description listing parent strategies
    const parentIds = parentStrategies.map(s => s.id.substring(0, 8)).join(', ');
    hybridStrategy.description = `Hybrid strategy combining elements from parents: ${parentIds}`;
    
    // Combine elements from different parents
    // For this simplified implementation, we'll take different components from different parents
    
    // Take risk parameters from the second parent if available
    if (parentStrategies.length > 1 && parentStrategies[1].riskParameters) {
      hybridStrategy.riskParameters = parentStrategies[1].riskParameters;
    }
    
    // Take time settings from the third parent if available
    if (parentStrategies.length > 2 && parentStrategies[2].timeSettings) {
      hybridStrategy.timeSettings = parentStrategies[2].timeSettings;
    }
    
    // Combine indicators by selecting the best from each parent
    // In a real implementation, this would involve more sophisticated selection logic
    const combinedIndicators: Record<string, any> = {};
    
    // Collect indicators from all parents
    parentStrategies.forEach(strategy => {
      if (strategy.indicators) {
        Object.entries(strategy.indicators).forEach(([indName, indicator]) => {
          // If we don't have this indicator yet, or the current one is not enabled and this one is,
          // use this indicator
          if (!combinedIndicators[indName] || 
             (!combinedIndicators[indName].enabled && indicator && indicator.enabled)) {
            combinedIndicators[indName] = indicator;
          }
        });
      }
    });
    
    hybridStrategy.indicators = combinedIndicators;
    
    // Generate lineage information
    const generation = (options.lineage?.generation ?? 0) + 1;
    
    const lineage: AgentLineage = {
      agentId,
      parentId: parentAgentId,
      generation,
      mutationReason: ForkReason.HYBRID_FORMATION,
      clusterId: options.clusterId,
      createdAt: timestamp,
      strategyId: hybridStrategy.id,
      ...options.lineage
    };
    
    logger.info(`Successfully created hybrid strategy ${hybridStrategy.id} for agent ${agentId}`);
    
    return {
      strategy: hybridStrategy,
      strategyId: hybridStrategy.id,
      parentStrategyId: baseStrategy.id,
      mutationType: MutationType.HYBRID,
      forkReason: ForkReason.HYBRID_FORMATION,
      lineage,
      timestamp
    };
  }
} 