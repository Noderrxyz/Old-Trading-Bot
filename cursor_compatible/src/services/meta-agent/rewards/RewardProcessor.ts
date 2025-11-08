/**
 * Reward Processor Service
 * 
 * Handles the application of rewards and their propagation through the influence network.
 */

import { type RedisClientType } from 'redis';
import Logger from '../../../utils/logger.js';
import type { ReinforcementEvent } from '../ReinforcementLog.js';
import type { 
  RewardEvent, 
  IRewardProcessor, 
  IRewardStorage,
  IVerificationService,
  IRewardPropagator,
  VerificationRequest,
  VerificationVoteParams 
} from './types.js';

interface TrustScoreService {
  adjustTrustScore(agentId: string, delta: number, reason: string): Promise<boolean>;
  getAgentTrustScore(agentId: string): Promise<number>;
}

interface AgentInfluenceService {
  adjustInfluence(agentId: string, amount: number, reason: string): Promise<void>;
}

type EventEmitter = {
  emit(event: string, data: any): boolean;
};

export class RewardProcessor implements IRewardProcessor {
  private AGENT_DAILY_TOTAL_KEY = 'agent:meta:rewards:daily:';
  private AGENT_COOLDOWN_KEY = 'agent:meta:rewards:cooldown:';
  private logger: Logger;
  
  // Config values - these should be loaded from configuration
  private trustScoreMultiplier = 1.0;
  private influenceMultiplier = 0.5;
  private humanTrustDeltaMultiplier = 1.5;
  private verificationRequiredCount = 3;
  private verificationMinimumTrust = 0.6;

  constructor(
    private redisClient: RedisClientType,
    private rewardStorage: IRewardStorage,
    private verificationService: IVerificationService,
    private propagator: IRewardPropagator,
    private reinforcementLog: any, // ReinforcementLog
    private trustScoreService: TrustScoreService,
    private influenceService: AgentInfluenceService,
    private events: EventEmitter,
    private findRewardRule: (ruleId: string) => any,
    private hoursToMs: (hours: number) => number
  ) {
    this.logger = Logger.getInstance('RewardProcessor');
  }

  /**
   * Process a reward, applying it to the agent
   */
  public async processReward(event: RewardEvent): Promise<void> {
    try {
      // Mark reward as verified if needed
      if (event.verificationId) {
        await this.rewardStorage.updateRewardVerification(event.id, true);
      }
      
      // Update agent's daily total
      const dailyKey = `${this.AGENT_DAILY_TOTAL_KEY}${event.agentId}:${new Date().toISOString().split('T')[0]}`;
      await this.redisClient.incrBy(dailyKey, event.points);
      
      // Set expiry for daily key (36 hours to ensure we cover full day)
      await this.redisClient.expire(dailyKey, 36 * 60 * 60);
      
      // Apply trust score impact if defined in the rule
      const rule = this.findRewardRule(event.ruleId);
      if (rule?.trustScoreDelta) {
        let trustDelta = rule.trustScoreDelta;
        
        // Apply human multiplier if granted by human
        if (event.grantedBy && event.grantedBy.startsWith('human:')) {
          trustDelta *= this.humanTrustDeltaMultiplier;
        }
        
        await this.trustScoreService.adjustTrustScore(
          event.agentId, 
          trustDelta * this.trustScoreMultiplier,
          `Reward: ${rule.label}`
        );
      }
      
      // Apply influence impact
      await this.influenceService.adjustInfluence(
        event.agentId, 
        event.points * this.influenceMultiplier,
        `Reward: ${rule?.label || event.ruleId}`
      );
      
      // Record the reinforcement event
      const reinforcementEvent = this.recordReinforcementEvent(event, rule);
      
      // Propagate the reward through the agent network if this is not
      // already a propagated reward (to prevent cascading loops)
      if (reinforcementEvent && !event.metadata?.isPropagated) {
        this.propagator.propagate(reinforcementEvent);
      }
      
      // Set cooldown for this rule type if needed
      if (rule?.cooldownHours) {
        const cooldownKey = `${this.AGENT_COOLDOWN_KEY}${event.agentId}:${event.ruleId}`;
        await this.redisClient.set(cooldownKey, '1');
        await this.redisClient.expire(cooldownKey, this.hoursToMs(rule.cooldownHours) / 1000);
      }
      
      this.logger.info(`Applied reward ${event.id} to agent ${event.agentId}: ${event.points} points`);
      
      // Emit reward applied event
      this.events.emit('agent:reward:applied', {
        agentId: event.agentId,
        rewardId: event.id,
        ruleId: event.ruleId,
        points: event.points
      });
    } catch (err) {
      this.logger.error(`Error applying reward ${event.id}:`, err);
      throw new Error(`Failed to process reward: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Record a reinforcement event in the log
   */
  private recordReinforcementEvent(event: RewardEvent, rule: any): ReinforcementEvent | undefined {
    try {
      // Determine the source agent (system or the grantor)
      const sourceAgent = event.grantedBy || 'system';
      
      // Calculate the decay TTL based on the rule
      const decayTTL = rule?.decayHalfLifeHours 
        ? this.hoursToMs(rule.decayHalfLifeHours) * 2 // Use double the half-life as TTL
        : this.hoursToMs(168); // Default to 1 week
      
      // Record the reinforcement event
      return this.reinforcementLog.record({
        sourceAgent,
        targetAgent: event.agentId,
        reason: rule?.label || event.ruleId,
        weight: event.points * this.influenceMultiplier,
        decayTTL,
        tags: rule?.tags || []
      });
    } catch (err) {
      this.logger.error('Error recording reinforcement event:', err);
      return undefined;
    }
  }

  /**
   * Submit a verification vote
   */
  public async submitVerificationVote(params: VerificationVoteParams): Promise<boolean> {
    try {
      const { verificationId, voterId, approve } = params;
      
      // Validate verification ID
      const verification = await this.verificationService.getVerificationRequest(verificationId);
      if (!verification) {
        this.logger.error(`Verification request not found: ${verificationId}`);
        return false;
      }
      
      // Check voter eligibility
      const voterTrust = await this.trustScoreService.getAgentTrustScore(voterId);
      if (voterTrust < this.verificationMinimumTrust) {
        this.logger.warn(`Voter ${voterId} has insufficient trust (${voterTrust}) to verify rewards`);
        return false;
      }
      
      // Check if voter already voted
      if (verification.votes.some(v => v.voterId === voterId)) {
        this.logger.warn(`Voter ${voterId} already voted on verification ${verificationId}`);
        return false;
      }
      
      // Get the reward event
      const reward = await this.rewardStorage.getRewardById(verification.rewardEventId);
      if (!reward) {
        this.logger.error(`Reward not found for verification: ${verification.rewardEventId}`);
        return false;
      }
      
      // Calculate vote weight based on voter's trust score
      const weight = await this.calculateVoteWeight(voterId);
      
      // Add the vote
      verification.votes.push({
        voterId,
        timestamp: Date.now(),
        approve,
        weight
      });
      
      // Check for sufficient votes
      const approvalVotes = verification.votes
        .filter(v => v.approve)
        .reduce((sum, v) => sum + v.weight, 0);
      
      const rejectionVotes = verification.votes
        .filter(v => !v.approve)
        .reduce((sum, v) => sum + v.weight, 0);
      
      // Update verification status if thresholds reached
      if (approvalVotes >= verification.requiredVotes) {
        verification.status = 'approved';
        // Apply the reward
        await this.processReward(reward);
      } else if (rejectionVotes >= verification.requiredVotes) {
        verification.status = 'rejected';
        // Mark reward as rejected
        await this.rewardStorage.updateRewardVerification(reward.id, false);
      }
      
      // Save updated verification
      await this.verificationService.saveVerificationRequest(verification);
      
      return true;
    } catch (err) {
      this.logger.error(`Error processing verification vote:`, err);
      return false;
    }
  }

  /**
   * Calculate the weight of a vote based on the trust score of the voter
   */
  private async calculateVoteWeight(voterId: string): Promise<number> {
    const voterTrustScore = await this.trustScoreService.getAgentTrustScore(voterId);
    
    const boundedTrustScore = Math.max(0, Math.min(1, voterTrustScore));
    
    // Apply non-linear scaling to emphasize high trust scores
    return Math.pow(boundedTrustScore, 2);
  }

  /**
   * Process reward decay for all agents
   */
  public async processRewardDecay(): Promise<void> {
    try {
      this.logger.info('Processing reward decay');
      
      const allRewards = await this.rewardStorage.getAllRewards();
      
      const cutoffTime = Date.now() - (90 * 24 * 60 * 60 * 1000); // 90 days
      const rewardsToDecay: RewardEvent[] = [];
      const rewardsToDelete: string[] = [];
      
      // Process rewards
      for (const [rewardId, reward] of Object.entries(allRewards)) {
        // Skip unverified rewards
        if (!reward.verified) continue;
        
        // Delete very old rewards
        if (reward.timestamp < cutoffTime) {
          rewardsToDelete.push(rewardId);
          continue;
        }
        
        rewardsToDecay.push(reward);
      }
      
      // Delete old rewards
      if (rewardsToDelete.length > 0) {
        this.logger.info(`Deleting ${rewardsToDelete.length} old rewards`);
        
        for (const rewardId of rewardsToDelete) {
          await this.rewardStorage.deleteReward(rewardId);
        }
      }
      
      // Process decay for each agent
      const agentsToProcess = new Set(rewardsToDecay.map(r => r.agentId));
      
      for (const agentId of agentsToProcess) {
        await this.processAgentDecay(agentId);
      }
      
      this.logger.info('Reward decay processing complete');
    } catch (err) {
      this.logger.error('Error processing reward decay:', err);
    }
  }
  
  /**
   * Process reward decay for a specific agent
   */
  public async processAgentDecay(agentId: string): Promise<void> {
    try {
      const agentRewards = await this.rewardStorage.getAgentRewards(agentId);
      
      let totalInfluenceChange = 0;
      
      for (const reward of agentRewards) {
        // Skip unverified rewards
        if (!reward.verified) continue;
        
        // Get the rule for this reward
        const rule = this.findRewardRule(reward.ruleId);
        if (!rule) continue;
        
        // Calculate new reward value after decay
        const oldPoints = reward.points;
        reward.points = Math.floor(reward.points * 0.995); // 0.5% daily decay
        
        // Skip if no change
        if (reward.points === oldPoints) continue;
        
        // Calculate influence change
        const influenceChange = (reward.points - oldPoints) * this.influenceMultiplier;
        totalInfluenceChange += influenceChange;
        
        // Update the reward in storage
        await this.rewardStorage.storeRewardEvent(reward);
      }
      
      // Apply aggregate influence change
      if (totalInfluenceChange !== 0) {
        await this.influenceService.adjustInfluence(
          agentId,
          totalInfluenceChange,
          'Reward decay'
        );
      }
    } catch (err) {
      this.logger.error(`Error processing decay for agent ${agentId}:`, err);
    }
  }
} 