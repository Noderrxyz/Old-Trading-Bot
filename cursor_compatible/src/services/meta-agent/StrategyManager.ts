import { MemoryManager } from "./MemoryManager.js";
import { AgentMemoryEntry, StrategyHealth, StrategyStatus, StrategyLifecycleSnapshot } from "../../types/metaAgent.types.js";

/**
 * Configuration for a strategy
 */
interface StrategyConfig {
  id: string;
  name: string;
  assets: string[];
  parameters: Record<string, any>;
  decayRates: Record<string, number>;
  healthThresholds: {
    regret: { warning: number; critical: number };
    confidence: { warning: number; critical: number };
  };
}

/**
 * Manager for meta-agent strategies
 * 
 * Responsible for managing strategy lifecycle, health monitoring,
 * and coordination with the memory system.
 */
export class StrategyManager {
  private strategies: Map<string, StrategyConfig> = new Map();
  private strategySnapshots: Map<string, StrategyLifecycleSnapshot> = new Map();
  private memoryManager: MemoryManager;

  constructor(memoryManager: MemoryManager) {
    this.memoryManager = memoryManager;
  }

  /**
   * Register a new strategy
   * @param config Strategy configuration
   * @returns Success status
   */
  async registerStrategy(config: StrategyConfig): Promise<boolean> {
    // Check if strategy already exists
    if (this.strategies.has(config.id)) {
      console.error(`Strategy with ID ${config.id} already exists`);
      return false;
    }

    // Create initial snapshot
    const snapshot: StrategyLifecycleSnapshot = {
      id: config.id,
      name: config.name,
      status: StrategyStatus.ACTIVE,
      health: StrategyHealth.HEALTHY,
      metrics: {
        totalActions: 0,
        successRate: 0,
        averageConfidence: 0,
        averageRegret: 0,
        cumulativeReturn: 0
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      assets: config.assets,
      parameters: config.parameters,
      decayRates: config.decayRates
    };

    // Store strategy config and snapshot
    this.strategies.set(config.id, config);
    this.strategySnapshots.set(config.id, snapshot);

    return true;
  }

  /**
   * Record a strategy action in memory
   * @param entry Memory entry for the strategy action
   * @returns The stored memory entry
   */
  async recordStrategyAction(entry: Omit<AgentMemoryEntry, 'id'>): Promise<AgentMemoryEntry> {
    // Ensure strategy exists
    if (!this.strategies.has(entry.strategyId)) {
      throw new Error(`Strategy with ID ${entry.strategyId} does not exist`);
    }

    // Store memory entry
    const storedEntry = await this.memoryManager.storeMemory(entry as AgentMemoryEntry);
    
    // Update strategy metrics
    await this.updateStrategyMetrics(entry.strategyId);
    
    return storedEntry;
  }

  /**
   * Update strategy metrics based on memory data
   * @param strategyId Strategy identifier
   */
  async updateStrategyMetrics(strategyId: string): Promise<void> {
    // Get snapshot
    const snapshot = this.strategySnapshots.get(strategyId);
    if (!snapshot) {
      console.error(`Strategy snapshot not found for ID ${strategyId}`);
      return;
    }

    // Get strategy config
    const config = this.strategies.get(strategyId);
    if (!config) {
      console.error(`Strategy config not found for ID ${strategyId}`);
      return;
    }

    // Calculate regret statistics
    const regretStats = await this.memoryManager.calculateStrategyRegret(strategyId);
    
    // Calculate outcome analysis
    const outcomes = await this.memoryManager.analyzeStrategyOutcomes(strategyId);
    
    // Get memory count
    const totalActions = await this.memoryManager.getMemoryCount(strategyId);
    
    // Update metrics
    const updatedSnapshot: StrategyLifecycleSnapshot = {
      ...snapshot,
      updatedAt: Date.now(),
      metrics: {
        totalActions,
        successRate: totalActions > 0 ? 
          outcomes.positiveOutcomes / totalActions : 0,
        averageConfidence: 0, // Will be calculated below
        averageRegret: regretStats.averageRegret,
        cumulativeReturn: outcomes.averageOutcome * totalActions
      }
    };

    // Calculate average confidence from recent memories
    const recentMemories = await this.memoryManager.getMemoriesByStrategy(strategyId, 20);
    if (recentMemories.length > 0) {
      const confidenceValues = recentMemories
        .filter((m: AgentMemoryEntry) => m.confidence !== undefined)
        .map((m: AgentMemoryEntry) => m.confidence as number);
      
      if (confidenceValues.length > 0) {
        const avgConfidence = confidenceValues.reduce((sum: number, val: number) => sum + val, 0) / confidenceValues.length;
        updatedSnapshot.metrics.averageConfidence = avgConfidence;
      }
    }

    // Update health status based on metrics and thresholds
    this.updateStrategyHealth(updatedSnapshot, config);
    
    // Store updated snapshot
    this.strategySnapshots.set(strategyId, updatedSnapshot);
  }

  /**
   * Update a strategy's health status based on metrics
   * @param snapshot Strategy snapshot to update
   * @param config Strategy configuration
   */
  private updateStrategyHealth(snapshot: StrategyLifecycleSnapshot, config: StrategyConfig): void {
    // Start with healthy status
    let health = StrategyHealth.HEALTHY;
    
    // Check regret threshold
    if (snapshot.metrics.averageRegret >= config.healthThresholds.regret.critical) {
      health = StrategyHealth.CRITICAL;
    } else if (snapshot.metrics.averageRegret >= config.healthThresholds.regret.warning) {
      health = StrategyHealth.WARNING;
    }
    
    // Check confidence threshold (only downgrade health, never upgrade)
    if (health !== StrategyHealth.CRITICAL &&
        snapshot.metrics.averageConfidence <= config.healthThresholds.confidence.critical) {
      health = StrategyHealth.CRITICAL;
    } else if (health === StrategyHealth.HEALTHY &&
               snapshot.metrics.averageConfidence <= config.healthThresholds.confidence.warning) {
      health = StrategyHealth.WARNING;
    }
    
    // Update health
    snapshot.health = health;
    
    // If health is critical, update status to SUSPENDED
    if (health === StrategyHealth.CRITICAL && snapshot.status === StrategyStatus.ACTIVE) {
      snapshot.status = StrategyStatus.SUSPENDED;
    }
  }

  /**
   * Get the current lifecycle snapshot for a strategy
   * @param strategyId Strategy identifier
   * @returns Current strategy snapshot
   */
  getStrategySnapshot(strategyId: string): StrategyLifecycleSnapshot | undefined {
    return this.strategySnapshots.get(strategyId);
  }

  /**
   * Get all strategy snapshots
   * @returns All strategy snapshots
   */
  getAllStrategySnapshots(): StrategyLifecycleSnapshot[] {
    return Array.from(this.strategySnapshots.values());
  }

  /**
   * Update a strategy's status
   * @param strategyId Strategy identifier
   * @param status New status
   * @returns Success status
   */
  updateStrategyStatus(strategyId: string, status: StrategyStatus): boolean {
    const snapshot = this.strategySnapshots.get(strategyId);
    if (!snapshot) {
      return false;
    }
    
    snapshot.status = status;
    snapshot.updatedAt = Date.now();
    this.strategySnapshots.set(strategyId, snapshot);
    return true;
  }

  /**
   * Update a strategy's parameters
   * @param strategyId Strategy identifier
   * @param newParameters New parameter values
   * @returns Success status
   */
  updateStrategyParameters(strategyId: string, newParameters: Record<string, any>): boolean {
    // Update config
    const config = this.strategies.get(strategyId);
    if (!config) {
      return false;
    }
    
    config.parameters = {
      ...config.parameters,
      ...newParameters
    };
    this.strategies.set(strategyId, config);
    
    // Update snapshot
    const snapshot = this.strategySnapshots.get(strategyId);
    if (!snapshot) {
      return false;
    }
    
    snapshot.parameters = {
      ...snapshot.parameters,
      ...newParameters
    };
    snapshot.updatedAt = Date.now();
    this.strategySnapshots.set(strategyId, snapshot);
    
    return true;
  }

  /**
   * Check if a strategy should be activated based on current market conditions
   * @param strategyId Strategy identifier
   * @param currentState Current market state vector
   * @returns Whether the strategy should be activated
   */
  async shouldActivateStrategy(strategyId: string, currentState: number[]): Promise<{
    shouldActivate: boolean;
    confidence: number;
    similarSituations: Array<{
      memory: AgentMemoryEntry;
      similarity: number;
    }>;
  }> {
    // Get strategy config and snapshot
    const config = this.strategies.get(strategyId);
    const snapshot = this.strategySnapshots.get(strategyId);
    
    if (!config || !snapshot) {
      return {
        shouldActivate: false,
        confidence: 0,
        similarSituations: []
      };
    }
    
    // Check if strategy is already active
    if (snapshot.status === StrategyStatus.ACTIVE) {
      return {
        shouldActivate: true,
        confidence: 1.0,
        similarSituations: []
      };
    }
    
    // If strategy is disabled, don't activate
    if (snapshot.status === StrategyStatus.DISABLED) {
      return {
        shouldActivate: false,
        confidence: 0,
        similarSituations: []
      };
    }
    
    // Find similar situations
    const similarSituations = await this.memoryManager.findSimilarSituations(currentState, 10);
    
    // Calculate confidence based on similar situations
    let totalConfidence = 0;
    let weightSum = 0;
    
    for (const { memory, similarity } of similarSituations) {
      if (memory.outcome !== undefined && memory.outcome > 0 && similarity > 0.7) {
        totalConfidence += similarity * (memory.outcome as number);
        weightSum += similarity;
      }
    }
    
    const confidence = weightSum > 0 ? totalConfidence / weightSum : 0;
    
    // Decide whether to activate
    const shouldActivate = 
      confidence > 0.6 && 
      snapshot.health !== StrategyHealth.CRITICAL;
    
    return {
      shouldActivate,
      confidence,
      similarSituations
    };
  }

  /**
   * Delete a strategy
   * @param strategyId Strategy identifier
   * @returns Success status
   */
  deleteStrategy(strategyId: string): boolean {
    // Remove strategy config and snapshot
    const configRemoved = this.strategies.delete(strategyId);
    const snapshotRemoved = this.strategySnapshots.delete(strategyId);
    
    return configRemoved && snapshotRemoved;
  }

  /**
   * Evaluates the health of a strategy based on its metrics
   */
  private evaluateStrategyHealth(snapshot: StrategyLifecycleSnapshot): StrategyHealth {
    // Get strategy config (to access health thresholds)
    const config = this.strategies.get(snapshot.id);
    if (!config) {
      return StrategyHealth.GOOD;
    }

    // Check regret levels
    if (snapshot.metrics?.averageRegret !== undefined) {
      if (snapshot.metrics.averageRegret >= config.healthThresholds.regret.critical) {
        return StrategyHealth.CRITICAL;
      } else if (snapshot.metrics.averageRegret >= config.healthThresholds.regret.warning) {
        return StrategyHealth.WARNING;
      }
    }
    
    // Check confidence levels
    if (snapshot.metrics?.averageConfidence !== undefined) {
      if (snapshot.metrics.averageConfidence < config.healthThresholds.confidence.critical) {
        return StrategyHealth.CRITICAL;
      } else if (snapshot.metrics.averageConfidence < config.healthThresholds.confidence.warning) {
        return StrategyHealth.WARNING;
      }
    }
    
    // Default health assessment if no issues were found
    return StrategyHealth.HEALTHY;
  }
  
  /**
   * Suspends a strategy that's performing poorly or is unhealthy
   */
  private async suspendStrategy(strategyId: string): Promise<void> {
    const snapshot = this.strategySnapshots.get(strategyId);
    if (snapshot) {
      snapshot.status = StrategyStatus.PAUSED;
      snapshot.updatedAt = Date.now();
      this.strategySnapshots.set(strategyId, snapshot);
      
      console.log(`Strategy ${strategyId} has been suspended due to poor performance`);
    }
  }
} 