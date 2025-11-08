import { RedisClient } from '../../common/redis.js';
import { createLogger } from '../../common/logger.js';
import { AgentFitnessScore } from './agentFitnessScoring.js';

const logger = createLogger('MutationRegistry');

/**
 * Mutation configuration structure
 */
export interface MutationConfig {
  // Unique identifier for this mutation
  mutationId: string;
  
  // Name of the mutation
  name: string;
  
  // Description of what this mutation does
  description: string;
  
  // The actual mutation function identifier
  mutationFunction: string;
  
  // Parameters for the mutation
  parameters: Record<string, any>;
  
  // Version of this mutation
  version: string;
  
  // Conditions under which this mutation can be applied
  conditions: MutationConditions;
  
  // Cooldown period in days before this mutation can be applied again
  cooldownDays: number;
  
  // Tags for categorizing mutations
  tags: string[];
  
  // Whether this mutation is enabled
  enabled: boolean;
}

/**
 * Mutation trial metadata
 */
export interface MutationTrial {
  // Trial ID
  trialId: string;
  
  // Agent ID
  agentId: string;
  
  // Mutation config ID
  mutationId: string;
  
  // Timestamp when trial started
  startTimestamp: number;
  
  // Timestamp when trial ended (if completed)
  endTimestamp?: number;
  
  // Baseline fitness before mutation
  baselineFitness: number;
  
  // Current/final fitness with mutation
  trialFitness?: number;
  
  // Whether the mutation was promoted to production
  promoted: boolean;
  
  // Whether the trial is still active
  active: boolean;
  
  // Reason for success or failure
  outcome?: string;
}

/**
 * Conditions that must be met for a mutation to be applicable
 */
export interface MutationConditions {
  // Minimum agent fitness score required
  minFitness: number;
  
  // Maximum number of anomalies allowed
  maxAnomalies: number;
  
  // Minimum trust score required
  minTrustScore?: number;
  
  // Minimum agent age in days
  minAgeDays?: number;
  
  // Other custom conditions
  custom?: Record<string, any>;
}

/**
 * Mutation application result
 */
export interface MutationResult {
  success: boolean;
  trialId?: string;
  message: string;
  timestamp: number;
}

/**
 * Mutation Strategy Registry
 * 
 * Manages the catalog of available mutations and their application to agents.
 */
export class MutationRegistry {
  private redis: RedisClient;
  private mutations: Map<string, MutationConfig> = new Map();
  private activeTrials: Map<string, MutationTrial> = new Map();
  
  /**
   * Create a new mutation registry
   * @param redis Redis client for persistence
   */
  constructor(redis: RedisClient) {
    this.redis = redis;
  }
  
  /**
   * Initialize the mutation registry
   */
  public async initialize(): Promise<void> {
    // Load mutations and active trials from Redis
    await Promise.all([
      this.loadMutationsFromRedis(),
      this.loadActiveTrialsFromRedis()
    ]);
    
    logger.info(`Initialized mutation registry with ${this.mutations.size} mutations and ${this.activeTrials.size} active trials`);
  }
  
  /**
   * Register a new mutation
   * @param mutation Mutation configuration
   * @returns Success with mutation ID or error message
   */
  public async registerMutation(mutation: Omit<MutationConfig, 'mutationId'>): Promise<{ success: boolean, mutationId?: string, message: string }> {
    // Generate mutation ID
    const mutationId = `mutation:${Date.now()}:${Math.floor(Math.random() * 10000)}`;
    
    // Create complete mutation config
    const mutationConfig: MutationConfig = {
      ...mutation,
      mutationId,
      enabled: true
    };
    
    // Store in memory
    this.mutations.set(mutationId, mutationConfig);
    
    // Persist to Redis
    try {
      await this.saveMutationToRedis(mutationConfig);
      logger.info(`Registered new mutation: ${mutationId}`, { name: mutation.name });
      return { success: true, mutationId, message: 'Mutation registered successfully' };
    } catch (error) {
      logger.error('Failed to register mutation', { error });
      return { success: false, message: `Failed to register mutation: ${error.message}` };
    }
  }
  
  /**
   * Get a mutation by ID
   * @param mutationId Mutation ID
   * @returns Mutation configuration or undefined if not found
   */
  public getMutation(mutationId: string): MutationConfig | undefined {
    return this.mutations.get(mutationId);
  }
  
  /**
   * Get all registered mutations
   * @returns Map of mutation ID to configuration
   */
  public getAllMutations(): Map<string, MutationConfig> {
    return new Map(this.mutations);
  }
  
  /**
   * Get mutations matching specific tags
   * @param tags Tags to match (any match will be included)
   * @returns Array of mutation configurations
   */
  public getMutationsByTags(tags: string[]): MutationConfig[] {
    const matchingMutations: MutationConfig[] = [];
    
    for (const mutation of this.mutations.values()) {
      // Include if any tag matches
      if (mutation.tags.some(tag => tags.includes(tag))) {
        matchingMutations.push(mutation);
      }
    }
    
    return matchingMutations;
  }
  
  /**
   * Apply a mutation to an agent
   * @param agentId Agent ID to apply mutation to
   * @param mutationId Mutation ID to apply
   * @param agentFitness Current agent fitness score
   * @returns Result of the mutation application
   */
  public async applyMutation(
    agentId: string,
    mutationId: string,
    agentFitness: AgentFitnessScore
  ): Promise<MutationResult> {
    // Check if mutation exists
    const mutation = this.mutations.get(mutationId);
    if (!mutation) {
      return { 
        success: false, 
        message: `Mutation ${mutationId} not found`,
        timestamp: Date.now()
      };
    }
    
    // Check if mutation is enabled
    if (!mutation.enabled) {
      return { 
        success: false, 
        message: `Mutation ${mutationId} is disabled`,
        timestamp: Date.now()
      };
    }
    
    // Check if agent is already in trial mode
    const existingTrial = this.getActiveTrialForAgent(agentId);
    if (existingTrial) {
      return { 
        success: false, 
        message: `Agent ${agentId} is already in an active trial: ${existingTrial.trialId}`,
        timestamp: Date.now()
      };
    }
    
    // Check fitness conditions
    if (agentFitness.fitnessScore < mutation.conditions.minFitness) {
      return { 
        success: false, 
        message: `Agent fitness (${agentFitness.fitnessScore.toFixed(2)}) below required minimum (${mutation.conditions.minFitness})`,
        timestamp: Date.now()
      };
    }
    
    // Check anomaly count
    if (agentFitness.anomalyCount > mutation.conditions.maxAnomalies) {
      return { 
        success: false, 
        message: `Agent anomaly count (${agentFitness.anomalyCount}) exceeds maximum allowed (${mutation.conditions.maxAnomalies})`,
        timestamp: Date.now()
      };
    }
    
    // Check cooldown period
    const canApplyMutation = await this.checkCooldownPeriod(agentId, mutationId);
    if (!canApplyMutation) {
      return { 
        success: false, 
        message: `Cooldown period for mutation ${mutationId} is still active for agent ${agentId}`,
        timestamp: Date.now()
      };
    }
    
    // Create trial ID
    const trialId = `trial:${agentId}:${Date.now()}`;
    
    // Create trial record
    const trial: MutationTrial = {
      trialId,
      agentId,
      mutationId,
      startTimestamp: Date.now(),
      baselineFitness: agentFitness.fitnessScore,
      promoted: false,
      active: true
    };
    
    // Store in memory and Redis
    this.activeTrials.set(trialId, trial);
    await this.saveTrialToRedis(trial);
    
    // Publish trial start event
    await this.publishTrialEvent(trial, 'start');
    
    return { 
      success: true,
      trialId, 
      message: `Mutation ${mutation.name} applied to agent ${agentId} in trial mode`,
      timestamp: Date.now()
    };
  }
  
  /**
   * Update the status of a mutation trial
   * @param trialId Trial ID to update
   * @param updates Updates to apply to the trial
   * @returns Success status and message
   */
  public async updateTrial(
    trialId: string,
    updates: Partial<Omit<MutationTrial, 'trialId' | 'agentId' | 'mutationId' | 'startTimestamp'>>
  ): Promise<{ success: boolean, message: string }> {
    // Check if trial exists
    const trial = this.activeTrials.get(trialId);
    if (!trial) {
      return { success: false, message: `Trial ${trialId} not found` };
    }
    
    // Apply updates
    const updatedTrial: MutationTrial = {
      ...trial,
      ...updates
    };
    
    // Store in memory
    this.activeTrials.set(trialId, updatedTrial);
    
    // Persist to Redis
    try {
      await this.saveTrialToRedis(updatedTrial);
      
      // If trial is no longer active, publish completion event
      if (trial.active && !updatedTrial.active) {
        await this.publishTrialEvent(updatedTrial, updatedTrial.promoted ? 'promoted' : 'rejected');
        
        // If no longer active, remove from active trials
        if (!updatedTrial.active) {
          this.activeTrials.delete(trialId);
        }
      }
      
      logger.info(`Updated trial ${trialId}`, { agentId: trial.agentId, promoted: updatedTrial.promoted });
      return { success: true, message: 'Trial updated successfully' };
    } catch (error) {
      logger.error('Failed to update trial', { error, trialId });
      return { success: false, message: `Failed to update trial: ${error.message}` };
    }
  }
  
  /**
   * Complete a mutation trial - either promoting or rejecting it
   * @param trialId Trial ID to complete
   * @param promote Whether to promote the mutation to production
   * @param finalFitness Final fitness score with the mutation
   * @param reason Reason for success or failure
   * @returns Success status and message
   */
  public async completeTrial(
    trialId: string,
    promote: boolean,
    finalFitness: number,
    reason: string
  ): Promise<{ success: boolean, message: string }> {
    return this.updateTrial(trialId, {
      active: false,
      promoted: promote,
      trialFitness: finalFitness,
      endTimestamp: Date.now(),
      outcome: reason
    });
  }
  
  /**
   * Get all active trials
   * @returns Map of trial ID to trial metadata
   */
  public getActiveTrials(): Map<string, MutationTrial> {
    return new Map(this.activeTrials);
  }
  
  /**
   * Get active trial for a specific agent
   * @param agentId Agent ID
   * @returns Trial metadata or undefined if agent has no active trial
   */
  public getActiveTrialForAgent(agentId: string): MutationTrial | undefined {
    for (const trial of this.activeTrials.values()) {
      if (trial.agentId === agentId && trial.active) {
        return trial;
      }
    }
    
    return undefined;
  }
  
  /**
   * Get trial history for a specific agent
   * @param agentId Agent ID
   * @returns Array of trial history records
   */
  public async getTrialHistoryForAgent(agentId: string): Promise<MutationTrial[]> {
    try {
      const historyKey = `agent:evolution:history:${agentId}`;
      const history = await this.redis.lrange(historyKey, 0, -1);
      
      return history.map(item => JSON.parse(item) as MutationTrial);
    } catch (error) {
      logger.error(`Failed to get trial history for agent ${agentId}`, { error });
      return [];
    }
  }
  
  /**
   * Enable or disable a mutation
   * @param mutationId Mutation ID
   * @param enabled Whether the mutation should be enabled
   * @returns Success status and message
   */
  public async setMutationEnabled(
    mutationId: string,
    enabled: boolean
  ): Promise<{ success: boolean, message: string }> {
    // Check if mutation exists
    const mutation = this.mutations.get(mutationId);
    if (!mutation) {
      return { success: false, message: `Mutation ${mutationId} not found` };
    }
    
    // Update in memory
    mutation.enabled = enabled;
    this.mutations.set(mutationId, mutation);
    
    // Persist to Redis
    try {
      await this.saveMutationToRedis(mutation);
      logger.info(`${enabled ? 'Enabled' : 'Disabled'} mutation ${mutationId}`);
      return { success: true, message: `Mutation ${enabled ? 'enabled' : 'disabled'} successfully` };
    } catch (error) {
      logger.error(`Failed to ${enabled ? 'enable' : 'disable'} mutation`, { error, mutationId });
      return { success: false, message: `Failed to update mutation: ${error.message}` };
    }
  }
  
  /**
   * Check if a mutation can be applied to an agent (cooldown period)
   * @param agentId Agent ID
   * @param mutationId Mutation ID
   * @returns Whether the mutation can be applied
   */
  private async checkCooldownPeriod(agentId: string, mutationId: string): Promise<boolean> {
    try {
      // Get mutation config
      const mutation = this.mutations.get(mutationId);
      if (!mutation) return false;
      
      // Get agent's trial history
      const trialHistory = await this.getTrialHistoryForAgent(agentId);
      
      // Find most recent trial with this mutation
      const mostRecentTrial = trialHistory
        .filter(trial => trial.mutationId === mutationId)
        .sort((a, b) => b.endTimestamp || 0 - (a.endTimestamp || 0))
        [0];
      
      if (!mostRecentTrial || !mostRecentTrial.endTimestamp) {
        return true; // No previous trial or it didn't complete
      }
      
      // Calculate days since last trial
      const daysSinceLastTrial = (Date.now() - mostRecentTrial.endTimestamp) / (24 * 60 * 60 * 1000);
      
      // Check against cooldown period
      return daysSinceLastTrial >= mutation.cooldownDays;
    } catch (error) {
      logger.error('Error checking cooldown period', { error, agentId, mutationId });
      return false;
    }
  }
  
  /**
   * Load mutations from Redis
   */
  private async loadMutationsFromRedis(): Promise<void> {
    try {
      const keys = await this.redis.keys('mutation:config:*');
      
      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const mutation = JSON.parse(data) as MutationConfig;
          this.mutations.set(mutation.mutationId, mutation);
        }
      }
      
      logger.debug(`Loaded ${this.mutations.size} mutations from Redis`);
    } catch (error) {
      logger.error('Failed to load mutations from Redis', { error });
    }
  }
  
  /**
   * Load active trials from Redis
   */
  private async loadActiveTrialsFromRedis(): Promise<void> {
    try {
      const keys = await this.redis.keys('agent:evolution:trial:*');
      
      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const trial = JSON.parse(data) as MutationTrial;
          
          // Only add to active trials if still active
          if (trial.active) {
            this.activeTrials.set(trial.trialId, trial);
          }
        }
      }
      
      logger.debug(`Loaded ${this.activeTrials.size} active trials from Redis`);
    } catch (error) {
      logger.error('Failed to load active trials from Redis', { error });
    }
  }
  
  /**
   * Save mutation to Redis
   * @param mutation Mutation configuration to save
   */
  private async saveMutationToRedis(mutation: MutationConfig): Promise<void> {
    try {
      const key = `mutation:config:${mutation.mutationId}`;
      await this.redis.set(key, JSON.stringify(mutation));
    } catch (error) {
      logger.error(`Failed to save mutation ${mutation.mutationId}`, { error });
      throw error;
    }
  }
  
  /**
   * Save trial to Redis
   * @param trial Trial metadata to save
   */
  private async saveTrialToRedis(trial: MutationTrial): Promise<void> {
    try {
      // Save current state
      const key = `agent:evolution:trial:${trial.trialId}`;
      await this.redis.set(key, JSON.stringify(trial));
      
      // If trial is complete, add to history
      if (!trial.active && trial.endTimestamp) {
        const historyKey = `agent:evolution:history:${trial.agentId}`;
        await this.redis.lpush(historyKey, JSON.stringify(trial));
        
        // Trim history to reasonable size
        await this.redis.ltrim(historyKey, 0, 99);
        
        // Remove from active trials key if it's complete
        if (trial.endTimestamp) {
          await this.redis.del(key);
        }
      }
    } catch (error) {
      logger.error(`Failed to save trial ${trial.trialId}`, { error });
      throw error;
    }
  }
  
  /**
   * Publish trial event to Redis channel
   * @param trial Trial metadata
   * @param eventType Type of event (start, update, promoted, rejected)
   */
  private async publishTrialEvent(trial: MutationTrial, eventType: string): Promise<void> {
    try {
      const event = {
        type: eventType,
        timestamp: Date.now(),
        trial
      };
      
      await this.redis.publish(`pubsub:evolve-trial:${trial.agentId}`, JSON.stringify(event));
    } catch (error) {
      logger.error(`Failed to publish trial event for ${trial.trialId}`, { error });
    }
  }
} 