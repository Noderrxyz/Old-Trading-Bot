/**
 * Meta-Reward Engine
 * 
 * Central service for managing agent rewards, verification, and processing reward events.
 * This engine is responsible for:
 * - Granting rewards based on events, metrics, or manual triggers
 * - Handling verification of high-value rewards
 * - Computing reward decay and cleanup
 * - Managing the effect of rewards on trust scores and influence
 */

import { type RedisClientType } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import Logger from '../../../utils/logger.js';
import { ReinforcementLog, type ReinforcementEvent } from '../ReinforcementLog.js';
import type { AgentInfluenceService } from '../../agent/AgentInfluenceService.js';
import type { TrustScoreService } from '../../agent/TrustScoreService.js';
import { 
  META_REWARD_RULES, 
  META_REWARD_CONFIG, 
  hoursToMs, 
  findRewardRule 
} from '../../../config/agent_meta_rewards.config.js';

import { RewardStorage } from './RewardStorage.js';
import { VerificationService } from './VerificationService.js';
import { RewardEligibility } from './RewardEligibility.js';
import { RewardProcessor } from './RewardProcessor.js';
import { RewardPropagator } from './RewardPropagator.js';

import type { 
  RewardEvent, 
  RewardGrantParams,
  VerificationRequest,
  VerificationVoteParams,
  PropagationConfig
} from './types.js';

type EventEmitter = {
  on(event: string, listener: (data: any) => void): void;
  emit(event: string, data: any): boolean;
};

/**
 * Meta-Reward Engine
 * Main entry point for the reward system
 */
export class MetaRewardEngine {
  private rewardStorage: RewardStorage;
  private verificationService: VerificationService;
  private rewardEligibility: RewardEligibility;
  private rewardProcessor: RewardProcessor;
  private rewardPropagator: RewardPropagator;
  private reinforcementLog: ReinforcementLog;
  private logger: Logger;
  private isInitialized = false;

  constructor(
    redisClient: RedisClientType,
    private events: EventEmitter,
    private trustScoreService: TrustScoreService,
    private influenceService: AgentInfluenceService,
    reinforcementLog?: ReinforcementLog,
    propagationConfig?: Partial<PropagationConfig>
  ) {
    this.logger = Logger.getInstance('MetaRewardEngine');
    this.reinforcementLog = reinforcementLog || new ReinforcementLog();
    
    // Initialize sub-services
    this.rewardStorage = new RewardStorage(redisClient);
    this.verificationService = new VerificationService(redisClient);
    this.rewardEligibility = new RewardEligibility(redisClient, trustScoreService, findRewardRule);
    
    // Initialize reward propagator
    this.rewardPropagator = new RewardPropagator(
      this.reinforcementLog,
      propagationConfig || {
        decayFactor: 0.85,
        maxDepth: 3,
        minWeightThreshold: 0.02,
        reasonPrefix: 'meta-reward',
        maxBreadth: 3
      }
    );
    
    // Initialize reward processor
    this.rewardProcessor = new RewardProcessor(
      redisClient,
      this.rewardStorage,
      this.verificationService,
      this.rewardPropagator,
      this.reinforcementLog,
      trustScoreService,
      influenceService,
      events,
      findRewardRule,
      hoursToMs
    );
    
    // Schedule reward decay
    setInterval(() => this.processRewardDecay(), 24 * 60 * 60 * 1000); // Daily
    
    // Schedule verification cleanup
    setInterval(() => this.cleanupExpiredVerifications(), 60 * 60 * 1000); // Hourly
    
    // Schedule reinforcement log pruning
    setInterval(() => this.reinforcementLog.pruneExpired(), 24 * 60 * 60 * 1000); // Daily
    
    // Register listeners for automated rewards
    this.setupEventHandlers();
    
    this.isInitialized = true;
  }
  
  /**
   * Register event listeners for automated rewards
   */
  private setupEventHandlers(): void {
    const eventRules = META_REWARD_RULES.filter(rule => rule.triggerType === 'event');
    
    for (const rule of eventRules) {
      this.events.on(rule.triggerKey, async (data: any) => {
        try {
          if (!data.agentId) {
            this.logger.warn(`Event ${rule.triggerKey} triggered without agentId`);
            return;
          }
          
          await this.grantReward({
            agentId: data.agentId,
            ruleId: rule.id,
            grantedBy: null, // System granted
            metadata: data
          });
        } catch (err) {
          this.logger.error(`Error processing event reward for ${rule.triggerKey}:`, err);
        }
      });
    }
  }
  
  /**
   * Grant a reward to an agent
   */
  public async grantReward(params: RewardGrantParams): Promise<RewardEvent | null> {
    try {
      const { agentId, ruleId, grantedBy = null, metadata = {} } = params;
      
      // Get the reward rule
      const rule = findRewardRule(ruleId);
      if (!rule) {
        this.logger.error(`Reward rule not found: ${ruleId}`);
        return null;
      }
      
      // Check agent eligibility
      const isEligible = await this.rewardEligibility.checkAgentEligibility(agentId, ruleId, grantedBy);
      if (!isEligible) {
        return null;
      }
      
      // Check grantor eligibility if not system
      if (grantedBy) {
        const canGrant = await this.rewardEligibility.checkGrantorEligibility(grantedBy);
        if (!canGrant) {
          return null;
        }
      }
      
      // Calculate reward points
      let points = rule.weight;
      
      // Apply human multiplier if granted by human
      if (grantedBy && grantedBy.startsWith('human:')) {
        points *= META_REWARD_CONFIG.humanRewardMultiplier;
      }
      
      // Create reward event
      const rewardEvent: RewardEvent = {
        id: `reward_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        agentId,
        ruleId,
        timestamp: Date.now(),
        points,
        grantedBy,
        metadata,
        verified: false
      };
      
      // Check if verification is required
      if (points >= META_REWARD_CONFIG.requireVerificationThreshold) {
        // Create verification request
        const verificationId = await this.verificationService.createVerificationRequest(rewardEvent);
        rewardEvent.verificationId = verificationId;
        
        // Store reward event but don't apply it yet
        await this.rewardStorage.storeRewardEvent(rewardEvent);
        
        this.logger.info(`Created verification request ${verificationId} for reward ${rewardEvent.id}`);
        return rewardEvent;
      }
      
      // No verification needed, apply reward immediately
      await this.rewardStorage.storeRewardEvent(rewardEvent);
      await this.rewardProcessor.processReward(rewardEvent);
      
      return rewardEvent;
    } catch (err) {
      this.logger.error('Error granting reward:', err);
      return null;
    }
  }
  
  /**
   * Submit a verification vote
   */
  public async submitVerificationVote(params: VerificationVoteParams): Promise<boolean> {
    return this.rewardProcessor.submitVerificationVote(params);
  }
  
  /**
   * Process reward decay
   */
  public async processRewardDecay(): Promise<void> {
    return this.rewardProcessor.processRewardDecay();
  }
  
  /**
   * Clean up expired verification requests
   */
  public async cleanupExpiredVerifications(): Promise<void> {
    return this.verificationService.cleanupExpiredVerifications();
  }
  
  /**
   * Get all pending verification requests
   */
  public async getPendingVerifications(): Promise<VerificationRequest[]> {
    return this.verificationService.getPendingVerifications();
  }
  
  /**
   * Get an agent's reward events
   */
  public async getAgentRewards(agentId: string): Promise<RewardEvent[]> {
    return this.rewardStorage.getAgentRewards(agentId);
  }
  
  /**
   * Get an agent's total reward points
   */
  public async getAgentTotalRewards(agentId: string): Promise<number> {
    return this.rewardStorage.getAgentTotalRewards(agentId);
  }
  
  /**
   * Get the reinforcement log
   */
  public getReinforcementLog(): ReinforcementLog {
    return this.reinforcementLog;
  }
  
  /**
   * Get the reward propagator
   */
  public getRewardPropagator(): RewardPropagator {
    return this.rewardPropagator;
  }
  
  /**
   * Update the reward propagation configuration
   */
  public updatePropagationConfig(config: Partial<PropagationConfig>): void {
    this.rewardPropagator.updateConfig(config);
  }
} 