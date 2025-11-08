import { RedisClient } from '../../common/redis.js';
import { createLogger } from '../../common/logger.js';
import { AgentRegistry } from '../agentRegistry.js';
import { AgentFitnessScoring, AgentFitnessScore } from './agentFitnessScoring.js';
import { MutationRegistry, MutationTrial, MutationConfig } from './mutationRegistry.js';
import { AgentLifecycleState } from '../base/AgentContext.js';
import { EvoVotingSystem, VoteResult } from './evolutionVoting.js';
import { LongTermAgentMemory } from '../../services/memory/LongTermAgentMemory.js';
import { EvaluationResult } from '../../services/evolution/evaluation/EvaluationResult.js';
import { TradingStrategy } from '../../services/evolution/mutation/strategy-model.js';

const logger = createLogger('EvolutionEngine');

/**
 * Fitness delta threshold for promoting a mutation
 * Mutation must improve fitness by at least this percentage
 */
const DEFAULT_FITNESS_DELTA_THRESHOLD = 0.10; // 10%

/**
 * Minimum hours a trial must run to be eligible for promotion
 */
const DEFAULT_MIN_TRIAL_HOURS = 24;

/**
 * Trial result with fitness comparison
 */
export interface TrialResult {
  trialId: string;
  agentId: string;
  mutationId: string;
  mutationName: string;
  baselineFitness: number;
  trialFitness: number;
  fitnessDelta: number;
  fitnessDeltaPct: number;
  trialDurationHours: number;
  promoted: boolean;
  reason: string;
}

/**
 * Evolution Engine options
 */
export interface EvolutionEngineOptions {
  // Minimum fitness delta (as a percentage) for promotion
  minFitnessDeltaPct?: number;
  
  // Minimum trial duration in hours before eligibility
  minTrialHours?: number;
  
  // Whether to archive old configs when promoting
  archiveOldConfigs?: boolean;
  
  // Whether to use voting for promotion
  enableVoting?: boolean;
  
  // Auto-rollback on negative fitness delta
  autoRollbackThreshold?: number;
  
  // Whether to persist top performing agents to long-term memory
  enableMemoryPersistence?: boolean;
  
  // Minimum fitness score for agent memory persistence
  memoryPersistenceThreshold?: number;
  
  // Number of top performers to persist per agent
  topPerformersToPersist?: number;
}

/**
 * Mutation executor function type
 */
export type MutationExecutor = (
  agentId: string,
  mutationFunction: string,
  parameters: Record<string, any>
) => Promise<boolean>;

/**
 * Evolution Engine
 * 
 * Manages the evolution trial loop for agents, applying mutations
 * in sandbox mode and promoting successful ones.
 */
export class EvolutionEngine {
  private redis: RedisClient;
  private agentRegistry: AgentRegistry;
  private fitnessScoring: AgentFitnessScoring;
  private mutationRegistry: MutationRegistry;
  private votingSystem: EvoVotingSystem;
  private mutationExecutors: Map<string, MutationExecutor> = new Map();
  private options: Required<EvolutionEngineOptions>;
  private longTermMemory: LongTermAgentMemory | null = null;
  
  /**
   * Create a new evolution engine
   * @param redis Redis client for persistence
   * @param agentRegistry Agent registry for accessing agents
   * @param fitnessScoring Fitness scoring system
   * @param mutationRegistry Mutation registry
   * @param votingSystem Evolution voting system
   * @param longTermMemory Optional long-term memory service
   * @param options Engine options
   */
  constructor(
    redis: RedisClient,
    agentRegistry: AgentRegistry,
    fitnessScoring: AgentFitnessScoring,
    mutationRegistry: MutationRegistry,
    votingSystem: EvoVotingSystem,
    longTermMemory: LongTermAgentMemory | null = null,
    options: EvolutionEngineOptions = {}
  ) {
    this.redis = redis;
    this.agentRegistry = agentRegistry;
    this.fitnessScoring = fitnessScoring;
    this.mutationRegistry = mutationRegistry;
    this.votingSystem = votingSystem;
    this.longTermMemory = longTermMemory;
    
    // Set default options
    this.options = {
      minFitnessDeltaPct: options.minFitnessDeltaPct ?? DEFAULT_FITNESS_DELTA_THRESHOLD,
      minTrialHours: options.minTrialHours ?? DEFAULT_MIN_TRIAL_HOURS,
      archiveOldConfigs: options.archiveOldConfigs ?? true,
      enableVoting: options.enableVoting ?? true,
      autoRollbackThreshold: options.autoRollbackThreshold ?? -0.05, // -5%
      enableMemoryPersistence: options.enableMemoryPersistence ?? false,
      memoryPersistenceThreshold: options.memoryPersistenceThreshold ?? 0.85,
      topPerformersToPersist: options.topPerformersToPersist ?? 5
    };
  }
  
  /**
   * Initialize the evolution engine
   */
  public async initialize(): Promise<void> {
    // Register built-in mutation executors
    this.registerMutationExecutor('adjustRisk', this.executeRiskAdjustment.bind(this));
    this.registerMutationExecutor('switchModel', this.executeModelSwitch.bind(this));
    this.registerMutationExecutor('disableAlphaPathway', this.executeDisablePathway.bind(this));
    this.registerMutationExecutor('enableSentinel', this.executeEnableSentinel.bind(this));
    
    // Start monitoring active trials
    await this.checkActiveTrials();
    
    logger.info('Evolution engine initialized');
    logger.info('Evolution engine configuration:', {
      minFitnessDeltaPct: this.options.minFitnessDeltaPct,
      minTrialHours: this.options.minTrialHours,
      archiveOldConfigs: this.options.archiveOldConfigs,
      enableVoting: this.options.enableVoting,
      autoRollbackThreshold: this.options.autoRollbackThreshold,
      enableMemoryPersistence: this.options.enableMemoryPersistence,
      memoryPersistenceThreshold: this.options.memoryPersistenceThreshold,
      topPerformersToPersist: this.options.topPerformersToPersist
    });
  }
  
  /**
   * Start a new evolution trial
   * @param agentId Agent ID to evolve
   * @param mutationId Mutation ID to apply
   * @returns Result of the trial start operation
   */
  public async startEvolutionTrial(
    agentId: string,
    mutationId: string
  ): Promise<{ success: boolean; trialId?: string; message: string }> {
    logger.info(`Starting evolution trial for agent ${agentId} with mutation ${mutationId}`);
    
    // Check if agent exists
    const agent = this.agentRegistry.getAgent(agentId);
    if (!agent) {
      return { success: false, message: `Agent ${agentId} not found` };
    }
    
    // Get current fitness score
    const fitnessScore = await this.fitnessScoring.calculateAgentFitness(agentId);
    if (!fitnessScore) {
      return { success: false, message: `Failed to calculate fitness for agent ${agentId}` };
    }
    
    // Apply the mutation in trial mode
    const result = await this.mutationRegistry.applyMutation(agentId, mutationId, fitnessScore);
    if (!result.success) {
      return { success: false, message: result.message };
    }
    
    // Get mutation config
    const mutation = this.mutationRegistry.getMutation(mutationId);
    if (!mutation) {
      return { success: false, message: `Mutation ${mutationId} not found` };
    }
    
    // Execute the mutation function
    const executor = this.mutationExecutors.get(mutation.mutationFunction);
    if (!executor) {
      logger.error(`No executor found for mutation function ${mutation.mutationFunction}`);
      await this.mutationRegistry.completeTrial(
        result.trialId!,
        false,
        fitnessScore.fitnessScore,
        `No executor found for mutation function ${mutation.mutationFunction}`
      );
      return { success: false, message: `Mutation function ${mutation.mutationFunction} not implemented` };
    }
    
    // Execute the mutation
    try {
      const executed = await executor(agentId, mutation.mutationFunction, mutation.parameters);
      
      if (!executed) {
        await this.mutationRegistry.completeTrial(
          result.trialId!,
          false,
          fitnessScore.fitnessScore,
          `Failed to execute mutation ${mutation.name}`
        );
        return { success: false, message: `Failed to execute mutation ${mutation.name}` };
      }
      
      // Set agent to canary evolution mode
      await this.setAgentToCanaryMode(agentId);
      
      logger.info(`Evolution trial ${result.trialId} started successfully for agent ${agentId}`);
      return { 
        success: true, 
        trialId: result.trialId, 
        message: `Evolution trial started successfully with mutation ${mutation.name}` 
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error executing mutation ${mutation.name}`, { error });
      
      await this.mutationRegistry.completeTrial(
        result.trialId!,
        false,
        fitnessScore.fitnessScore,
        `Error executing mutation: ${errorMessage}`
      );
      
      return { success: false, message: `Error executing mutation: ${errorMessage}` };
    }
  }
  
  /**
   * Check active trials and promote or rollback as needed
   */
  public async checkActiveTrials(): Promise<void> {
    logger.debug('Checking active evolution trials...');
    
    const activeTrials = this.mutationRegistry.getActiveTrials();
    if (activeTrials.size === 0) {
      logger.debug('No active evolution trials');
      return;
    }
    
    logger.info(`Checking ${activeTrials.size} active evolution trials`);
    
    for (const [trialId, trial] of activeTrials) {
      await this.evaluateTrial(trialId, trial);
    }
  }
  
  /**
   * Evaluate an active trial
   * @param trialId Trial ID
   * @param trial Trial metadata
   */
  private async evaluateTrial(trialId: string, trial: MutationTrial): Promise<void> {
    // Check trial duration
    const trialDurationHours = (Date.now() - trial.startTimestamp) / (60 * 60 * 1000);
    
    if (trialDurationHours < this.options.minTrialHours) {
      logger.debug(`Trial ${trialId} for agent ${trial.agentId} has not met minimum duration (${trialDurationHours.toFixed(1)}/${this.options.minTrialHours} hours)`);
      return;
    }
    
    // Get mutation config
    const mutation = this.mutationRegistry.getMutation(trial.mutationId);
    if (!mutation) {
      logger.error(`Mutation ${trial.mutationId} not found for trial ${trialId}`);
      await this.mutationRegistry.completeTrial(
        trialId,
        false,
        trial.baselineFitness,
        `Mutation config not found`
      );
      return;
    }
    
    // Get current fitness score
    const currentFitness = await this.fitnessScoring.calculateAgentFitness(trial.agentId);
    if (!currentFitness) {
      logger.error(`Failed to calculate fitness for agent ${trial.agentId}`);
      return;
    }
    
    // Calculate fitness delta
    const fitnessDelta = currentFitness.fitnessScore - trial.baselineFitness;
    const fitnessDeltaPct = (fitnessDelta / trial.baselineFitness) * 100;
    
    // Prepare trial result
    const trialResult: TrialResult = {
      trialId,
      agentId: trial.agentId,
      mutationId: trial.mutationId,
      mutationName: mutation.name,
      baselineFitness: trial.baselineFitness,
      trialFitness: currentFitness.fitnessScore,
      fitnessDelta,
      fitnessDeltaPct,
      trialDurationHours,
      promoted: false,
      reason: ''
    };
    
    // Check if fitness has declined beyond auto-rollback threshold
    if (fitnessDeltaPct < this.options.autoRollbackThreshold * 100) {
      logger.warn(`Trial ${trialId} for agent ${trial.agentId} is being auto-rolled back due to negative fitness impact: ${fitnessDeltaPct.toFixed(2)}%`);
      
      trialResult.promoted = false;
      trialResult.reason = `Auto-rollback due to negative fitness impact (${fitnessDeltaPct.toFixed(2)}%)`;
      
      await this.rollbackTrial(trial);
      await this.mutationRegistry.completeTrial(
        trialId,
        false,
        currentFitness.fitnessScore,
        trialResult.reason
      );
      
      // Add to blacklist to avoid retry
      await this.blacklistMutation(trial.agentId, trial.mutationId);
      
      await this.publishTrialResult(trialResult);
      return;
    }
    
    // Check if fitness has improved sufficiently
    if (fitnessDeltaPct < this.options.minFitnessDeltaPct * 100) {
      logger.info(`Trial ${trialId} for agent ${trial.agentId} did not meet fitness improvement threshold: ${fitnessDeltaPct.toFixed(2)}% < ${(this.options.minFitnessDeltaPct * 100).toFixed(2)}%`);
      
      trialResult.promoted = false;
      trialResult.reason = `Insufficient fitness improvement: ${fitnessDeltaPct.toFixed(2)}% (required: ${(this.options.minFitnessDeltaPct * 100).toFixed(2)}%)`;
      
      await this.rollbackTrial(trial);
      await this.mutationRegistry.completeTrial(
        trialId,
        false,
        currentFitness.fitnessScore,
        trialResult.reason
      );
      
      await this.publishTrialResult(trialResult);
      return;
    }
    
    // If voting is enabled, submit for vote
    if (this.options.enableVoting) {
      // Submit for vote
      const voteResult = await this.votingSystem.submitMutationForVote(
        trial.agentId,
        trial.mutationId,
        mutation.name,
        fitnessDeltaPct
      );
      
      // Wait for vote outcome
      if (voteResult.status === 'pending') {
        logger.info(`Trial ${trialId} submitted for vote, waiting for quorum`);
        return;
      }
      
      // If rejected, roll back
      if (voteResult.status === 'rejected') {
        logger.info(`Trial ${trialId} rejected by vote: ${voteResult.reason}`);
        
        trialResult.promoted = false;
        trialResult.reason = `Rejected by vote: ${voteResult.reason}`;
        
        await this.rollbackTrial(trial);
        await this.mutationRegistry.completeTrial(
          trialId,
          false,
          currentFitness.fitnessScore,
          trialResult.reason
        );
        
        await this.publishTrialResult(trialResult);
        return;
      }
    }
    
    // Promote the mutation
    logger.info(`Promoting trial ${trialId} for agent ${trial.agentId}: fitness improved by ${fitnessDeltaPct.toFixed(2)}%`);
    
    trialResult.promoted = true;
    trialResult.reason = `Fitness improved by ${fitnessDeltaPct.toFixed(2)}%`;
    
    await this.promoteTrial(trial);
    await this.mutationRegistry.completeTrial(
      trialId,
      true,
      currentFitness.fitnessScore,
      trialResult.reason
    );
    
    await this.publishTrialResult(trialResult);
  }
  
  /**
   * Promote a trial by merging sandbox and production configurations
   * @param trial Trial to promote
   */
  private async promoteTrial(trial: MutationTrial): Promise<void> {
    try {
      const agent = this.agentRegistry.getAgent(trial.agentId);
      if (!agent) {
        logger.error(`Agent ${trial.agentId} not found during promotion`);
        return;
      }
      
      // Archive old configuration if enabled
      if (this.options.archiveOldConfigs) {
        await this.archiveAgentConfig(trial.agentId);
      }
      
      // Set agent back to normal running state
      await this.agentRegistry.updateAgentState(trial.agentId, AgentLifecycleState.RUNNING);
      
      logger.info(`Promoted trial ${trial.trialId} for agent ${trial.agentId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error promoting trial ${trial.trialId}`, { error });
    }
  }
  
  /**
   * Roll back a trial by restoring the original configuration
   * @param trial Trial to roll back
   */
  private async rollbackTrial(trial: MutationTrial): Promise<void> {
    try {
      const agent = this.agentRegistry.getAgent(trial.agentId);
      if (!agent) {
        logger.error(`Agent ${trial.agentId} not found during rollback`);
        return;
      }
      
      // Restore from archive
      await this.restoreAgentConfig(trial.agentId);
      
      // Set agent back to normal running state
      await this.agentRegistry.updateAgentState(trial.agentId, AgentLifecycleState.RUNNING);
      
      logger.info(`Rolled back trial ${trial.trialId} for agent ${trial.agentId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error rolling back trial ${trial.trialId}`, { error });
    }
  }
  
  /**
   * Set an agent to canary evolution mode
   * @param agentId Agent ID
   */
  private async setAgentToCanaryMode(agentId: string): Promise<void> {
    try {
      // Set lifecycle state to indicate evolution trial
      await this.agentRegistry.updateAgentState(agentId, AgentLifecycleState.DECAYING);
      
      // This is a mock implementation - in a real system, would fork the agent
      // and run it in parallel with the original
      
      logger.info(`Set agent ${agentId} to canary evolution mode`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error setting agent ${agentId} to canary mode`, { error });
      throw new Error(`Failed to set agent to canary mode: ${errorMessage}`);
    }
  }
  
  /**
   * Archive agent configuration before applying mutation
   * @param agentId Agent ID
   */
  private async archiveAgentConfig(agentId: string): Promise<void> {
    try {
      // In a real implementation, this would:
      // 1. Get the current agent config
      // 2. Store it in an archive with version
      
      const registration = this.agentRegistry.getAgentRegistration(agentId);
      if (registration) {
        const timestamp = Date.now();
        const archiveKey = `agent:config:archive:${agentId}:${timestamp}`;
        
        await this.redis.set(archiveKey, JSON.stringify(registration.config));
        logger.debug(`Archived config for agent ${agentId}`, { archiveKey });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error archiving agent ${agentId} config`, { error });
    }
  }
  
  /**
   * Restore agent configuration from archive
   * @param agentId Agent ID
   */
  private async restoreAgentConfig(agentId: string): Promise<void> {
    try {
      // In a real implementation, this would:
      // 1. Get the latest archived config
      // 2. Restore it to the agent
      
      const keys = await this.redis.keys(`agent:config:archive:${agentId}:*`);
      
      if (keys.length === 0) {
        logger.warn(`No archived config found for agent ${agentId}`);
        return;
      }
      
      // Sort keys by timestamp (descending)
      keys.sort((a, b) => {
        const timeA = parseInt(a.split(':').pop() || '0');
        const timeB = parseInt(b.split(':').pop() || '0');
        return timeB - timeA;
      });
      
      // Get latest archive
      const latestArchiveKey = keys[0];
      const archiveData = await this.redis.get(latestArchiveKey);
      
      if (!archiveData) {
        logger.warn(`Failed to retrieve archived config for agent ${agentId}`);
        return;
      }
      
      const archivedConfig = JSON.parse(archiveData);
      
      // Update agent config
      const registration = this.agentRegistry.getAgentRegistration(agentId);
      if (registration) {
        await this.agentRegistry.updateRegistration(agentId, {
          config: archivedConfig
        });
        
        logger.info(`Restored archived config for agent ${agentId}`, { archiveKey: latestArchiveKey });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error restoring agent ${agentId} config`, { error });
    }
  }
  
  /**
   * Register a mutation executor function
   * @param mutationFunction Mutation function identifier
   * @param executor Executor function
   */
  public registerMutationExecutor(
    mutationFunction: string,
    executor: MutationExecutor
  ): void {
    this.mutationExecutors.set(mutationFunction, executor);
    logger.debug(`Registered mutation executor for ${mutationFunction}`);
  }
  
  /**
   * Blacklist a mutation for an agent
   * @param agentId Agent ID
   * @param mutationId Mutation ID
   */
  private async blacklistMutation(agentId: string, mutationId: string): Promise<void> {
    try {
      const blacklistKey = `agent:mutation:blacklist:${agentId}`;
      await this.redis.sadd(blacklistKey, mutationId);
      logger.info(`Blacklisted mutation ${mutationId} for agent ${agentId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error blacklisting mutation ${mutationId} for agent ${agentId}`, { error });
    }
  }
  
  /**
   * Check if a mutation is blacklisted for an agent
   * @param agentId Agent ID
   * @param mutationId Mutation ID
   * @returns Whether the mutation is blacklisted
   */
  public async isMutationBlacklisted(agentId: string, mutationId: string): Promise<boolean> {
    try {
      const blacklistKey = `agent:mutation:blacklist:${agentId}`;
      const isMember = await this.redis.sismember(blacklistKey, mutationId);
      return isMember === 1;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error checking blacklist for agent ${agentId}, mutation ${mutationId}`, { error });
      return false;
    }
  }
  
  /**
   * Publish trial result
   * @param result Trial result
   */
  private async publishTrialResult(result: TrialResult): Promise<void> {
    try {
      await this.redis.publish('pubsub:evolution:trial-result', JSON.stringify(result));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to publish trial result for ${result.trialId}`, { error });
    }
  }
  
  /**
   * --- Mutation Executor Implementations ---
   */
  
  /**
   * Execute a risk adjustment mutation
   * @param agentId Agent ID
   * @param mutationFunction Mutation function name
   * @param parameters Mutation parameters
   * @returns Whether execution was successful
   */
  private async executeRiskAdjustment(
    agentId: string,
    mutationFunction: string,
    parameters: Record<string, any>
  ): Promise<boolean> {
    // In a real implementation, this would update the agent's risk parameters
    
    // Get current registration
    const registration = this.agentRegistry.getAgentRegistration(agentId);
    if (!registration) {
      logger.error(`Agent ${agentId} not found`);
      return false;
    }
    
    // Extract adjustment percentage
    const adjustmentPct = parameters.adjustmentPct ?? 0;
    
    // Mock implementation: update config with adjusted risk
    const updatedConfig = {
      ...registration.config,
      riskAdjustment: adjustmentPct
    };
    
    // Update registration
    await this.agentRegistry.updateRegistration(agentId, {
      config: updatedConfig
    });
    
    logger.info(`Applied risk adjustment of ${adjustmentPct}% to agent ${agentId}`);
    return true;
  }
  
  /**
   * Execute a model switch mutation
   * @param agentId Agent ID
   * @param mutationFunction Mutation function name
   * @param parameters Mutation parameters
   * @returns Whether execution was successful
   */
  private async executeModelSwitch(
    agentId: string,
    mutationFunction: string,
    parameters: Record<string, any>
  ): Promise<boolean> {
    // In a real implementation, this would switch the agent's model version
    
    // Get current registration
    const registration = this.agentRegistry.getAgentRegistration(agentId);
    if (!registration) {
      logger.error(`Agent ${agentId} not found`);
      return false;
    }
    
    // Extract model version
    const newModel = parameters.targetModel ?? 'v2.0';
    
    // Mock implementation: update config with new model
    const updatedConfig = {
      ...registration.config,
      modelVersion: newModel
    };
    
    // Update registration
    await this.agentRegistry.updateRegistration(agentId, {
      config: updatedConfig
    });
    
    logger.info(`Switched agent ${agentId} to model ${newModel}`);
    return true;
  }
  
  /**
   * Execute a pathway disable mutation
   * @param agentId Agent ID
   * @param mutationFunction Mutation function name
   * @param parameters Mutation parameters
   * @returns Whether execution was successful
   */
  private async executeDisablePathway(
    agentId: string,
    mutationFunction: string,
    parameters: Record<string, any>
  ): Promise<boolean> {
    // In a real implementation, this would disable a specific signal pathway
    
    // Get current registration
    const registration = this.agentRegistry.getAgentRegistration(agentId);
    if (!registration) {
      logger.error(`Agent ${agentId} not found`);
      return false;
    }
    
    // Extract pathway name
    const pathwayName = parameters.pathway ?? 'social';
    
    // Mock implementation: update config with disabled pathway
    const updatedConfig = {
      ...registration.config,
      disabledPathways: [
        ...(registration.config.disabledPathways || []),
        pathwayName
      ]
    };
    
    // Update registration
    await this.agentRegistry.updateRegistration(agentId, {
      config: updatedConfig
    });
    
    logger.info(`Disabled pathway ${pathwayName} for agent ${agentId}`);
    return true;
  }
  
  /**
   * Execute a sentinel enable mutation
   * @param agentId Agent ID
   * @param mutationFunction Mutation function name
   * @param parameters Mutation parameters
   * @returns Whether execution was successful
   */
  private async executeEnableSentinel(
    agentId: string,
    mutationFunction: string,
    parameters: Record<string, any>
  ): Promise<boolean> {
    // In a real implementation, this would enable a specific sentinel
    
    // Get current registration
    const registration = this.agentRegistry.getAgentRegistration(agentId);
    if (!registration) {
      logger.error(`Agent ${agentId} not found`);
      return false;
    }
    
    // Extract sentinel name
    const sentinelName = parameters.sentinel ?? 'anomalyFilterV3';
    
    // Mock implementation: update config with enabled sentinel
    const updatedConfig = {
      ...registration.config,
      enabledSentinels: [
        ...(registration.config.enabledSentinels || []),
        sentinelName
      ]
    };
    
    // Update registration
    await this.agentRegistry.updateRegistration(agentId, {
      config: updatedConfig
    });
    
    logger.info(`Enabled sentinel ${sentinelName} for agent ${agentId}`);
    return true;
  }

  /**
   * Persist top performing agents to long-term memory
   * 
   * @param agentIds Optional list of agent IDs to persist (otherwise persists all agents)
   * @returns Number of agents successfully persisted
   */
  public async persistTopPerformers(agentIds?: string[]): Promise<number> {
    if (!this.longTermMemory || !this.options.enableMemoryPersistence) {
      logger.warn('Long-term memory persistence is not enabled');
      return 0;
    }
    
    try {
      // Get list of agents to process
      const targetAgents = agentIds || this.agentRegistry.listAgentIds();
      
      if (targetAgents.length === 0) {
        logger.info('No agents to persist');
        return 0;
      }
      
      logger.info(`Persisting top performers for ${targetAgents.length} agents`);
      
      // Collect evaluation results and strategies for each agent
      const agentEvaluations = new Map<string, EvaluationResult[]>();
      const agentStrategies = new Map<string, TradingStrategy>();
      
      for (const agentId of targetAgents) {
        try {
          // Get agent's fitness scores over time
          const fitnessScores = await this.fitnessScoring.getAgentFitnessHistory(agentId);
          
          if (!fitnessScores || fitnessScores.length === 0) {
            logger.info(`No fitness history found for agent ${agentId}, skipping`);
            continue;
          }
          
          // Convert fitness scores to evaluation results
          const evaluations: EvaluationResult[] = [];
          
          for (const score of fitnessScores) {
            if (score.fitnessScore < this.options.memoryPersistenceThreshold) {
              continue; // Skip scores below threshold
            }
            
            // Get agent's strategy configuration
            const strategyId = `${agentId}-strategy-${score.timestamp}`;
            let strategy = agentStrategies.get(strategyId);
            
            if (!strategy) {
              // Create strategy object from agent config
              const agentConfig = await this.getAgentConfig(agentId, score.timestamp);
              
              if (!agentConfig) {
                logger.debug(`No configuration found for agent ${agentId} at timestamp ${score.timestamp}`);
                continue;
              }
              
              strategy = this.createStrategyFromAgentConfig(agentId, strategyId, agentConfig);
              agentStrategies.set(strategyId, strategy);
            }
            
            // Create evaluation result
            const evaluation: EvaluationResult = {
              agentId,
              strategyId,
              sharpe: score.metrics?.sharpe || 0,
              maxDrawdown: score.metrics?.maxDrawdown || 0.2,
              winRate: score.metrics?.winRate || 0.5,
              volatilityResilience: score.metrics?.volatility || 0.5,
              regretIndex: 0.1, // Default value if not available
              fitnessScore: score.fitnessScore,
              passed: true,
              timestamp: score.timestamp,
              generationId: score.generationId || `gen-${score.timestamp}`,
              mutationType: score.mutationType || undefined,
              rawMetrics: score.metrics || undefined
            };
            
            evaluations.push(evaluation);
          }
          
          if (evaluations.length > 0) {
            agentEvaluations.set(agentId, evaluations);
          }
        } catch (error) {
          logger.error(`Error processing agent ${agentId} for persistence: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // Persist top performers
      const persistedCount = await this.longTermMemory.persistTopPerformers(
        agentEvaluations,
        agentStrategies
      );
      
      logger.info(`Successfully persisted ${persistedCount} agent snapshots to long-term memory`);
      
      return persistedCount;
    } catch (error) {
      logger.error(`Error persisting top performers: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }
  
  /**
   * Get agent configuration at a specific timestamp
   * 
   * @param agentId Agent ID
   * @param timestamp Timestamp to get configuration for
   * @returns Agent configuration or null if not found
   */
  private async getAgentConfig(agentId: string, timestamp: number): Promise<Record<string, any> | null> {
    try {
      // Try to get archived config
      const archiveKey = `agent:${agentId}:config:archive:${timestamp}`;
      const archivedConfig = await this.redis.get(archiveKey);
      
      if (archivedConfig) {
        return JSON.parse(archivedConfig);
      }
      
      // If not found, get current config
      const configKey = `agent:${agentId}:config`;
      const currentConfig = await this.redis.get(configKey);
      
      if (currentConfig) {
        return JSON.parse(currentConfig);
      }
      
      return null;
    } catch (error) {
      logger.error(`Error getting agent config: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Create a trading strategy from agent configuration
   * 
   * @param agentId Agent ID
   * @param strategyId Strategy ID
   * @param agentConfig Agent configuration
   * @returns Trading strategy
   */
  private createStrategyFromAgentConfig(
    agentId: string,
    strategyId: string,
    agentConfig: Record<string, any>
  ): TradingStrategy {
    // Create a trading strategy from agent configuration
    // This would need to be customized based on your agent config structure
    return {
      id: strategyId,
      name: agentConfig.name || `Agent ${agentId} Strategy`,
      version: agentConfig.version || '1.0.0',
      description: agentConfig.description || `Strategy for agent ${agentId}`,
      indicators: {
        rsi: agentConfig.indicators?.rsi || {
          enabled: true,
          weight: 1.0,
          period: 14,
          overboughtThreshold: 70,
          oversoldThreshold: 30
        },
        macd: agentConfig.indicators?.macd || {
          enabled: true,
          weight: 1.0,
          fastPeriod: 12,
          slowPeriod: 26,
          signalPeriod: 9
        },
        bollingerBands: agentConfig.indicators?.bollingerBands || {
          enabled: true,
          weight: 1.0,
          period: 20,
          stdDev: 2
        }
      },
      riskParameters: {
        maxPositionSize: agentConfig.risk?.maxPositionSize || 0.1,
        stopLoss: agentConfig.risk?.stopLoss || 0.02,
        takeProfit: agentConfig.risk?.takeProfit || 0.04,
        maxDrawdown: agentConfig.risk?.maxDrawdown || 0.15,
        maxOpenPositions: agentConfig.risk?.maxOpenPositions || 5
      },
      signalSettings: {
        threshold: agentConfig.signal?.threshold || 0.5,
        minConfidence: agentConfig.signal?.minConfidence || 0.6,
        combinationMethod: agentConfig.signal?.combinationMethod || 'weighted',
        entryConditions: agentConfig.signal?.entryConditions || [],
        exitConditions: agentConfig.signal?.exitConditions || []
      },
      timeSettings: {
        tradingHours: agentConfig.time?.tradingHours || {
          start: '00:00',
          end: '23:59'
        },
        tradingDays: agentConfig.time?.tradingDays || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        timeframe: agentConfig.time?.timeframe || '1h'
      },
      assetClasses: agentConfig.assetClasses || ['crypto'],
      marketConditions: agentConfig.marketConditions || ['trending', 'volatile', 'sideways'],
      customParameters: agentConfig.customParameters || {},
      createdAt: agentConfig.createdAt || Date.now(),
      updatedAt: agentConfig.updatedAt || Date.now(),
      parentId: agentConfig.parentId
    };
  }
} 