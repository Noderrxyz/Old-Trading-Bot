import { v4 as uuidv4 } from 'uuid';
// @ts-ignore
import Logger from '@noderr/logger';
import { RedisService } from '../infrastructure/RedisService.js';
import { EventEmitter } from '../../utils/EventEmitter.js';
import { TrustScoreService } from '../agent/TrustScoreService.js';
// Define the AgentInfluenceService interface since we can't find it
interface AgentInfluenceService {
  getAgentInfluence(agentId: string): Promise<number>;
}
import { MetaRewardEngine } from './rewards/MetaRewardEngine.js';
import { ReinforcementVote } from '../../types/metaAgent.types.js';

/**
 * Configuration for the AgentReinforcementService
 */
interface AgentReinforcementConfig {
  // Minimum trust score required to cast a reinforcement vote
  minimumTrustToVote: number;
  
  // Cooldown between votes in milliseconds
  voteCooldownMs: number;
  
  // Duration that votes remain active before expiring
  voteExpirationMs: number;
  
  // Maximum votes an agent can cast per day
  maxDailyVotes: number;
  
  // Strength multiplier based on voter influence
  influenceMultiplier: number;
  
  // Minimum agreement threshold for reinforcement (0-1)
  minimumAgreementThreshold: number;
}

/**
 * Service that manages agent reinforcement voting and cooperation
 */
export class AgentReinforcementService {
  private logger = new Logger('AgentReinforcementService');
  private redisKeyVotes = 'noderr:agent-reinforcement:votes';
  private redisKeyDailyLimits = 'noderr:agent-reinforcement:daily-limits';
  private redisKeyAgreement = 'noderr:agent-reinforcement:agreement';
  
  private config: AgentReinforcementConfig = {
    minimumTrustToVote: 60,
    voteCooldownMs: 3600000, // 1 hour
    voteExpirationMs: 2592000000, // 30 days
    maxDailyVotes: 20,
    influenceMultiplier: 0.3,
    minimumAgreementThreshold: 0.7
  };

  constructor(
    private redisService: RedisService,
    private eventEmitter: EventEmitter,
    private trustScoreService: TrustScoreService,
    private agentInfluenceService: AgentInfluenceService,
    private metaRewardEngine: MetaRewardEngine
  ) {
    // Schedule cleanup of expired votes
    this.scheduleVoteCleanup();
    
    // Subscribe to relevant events
    this.eventEmitter.on('signal:published', (data) => {
      this.handleSignalPublished(data);
    });
    
    this.eventEmitter.on('insight:published', (data) => {
      this.handleInsightPublished(data);
    });
  }

  /**
   * Cast a reinforcement vote from one agent to another
   * 
   * @param sourceAgentId The agent casting the vote
   * @param targetAgentId The agent receiving the reinforcement
   * @param contextType Type of context (signal, insight, strategy)
   * @param contextId ID of the relevant context object
   * @param strength Strength of the reinforcement (0-1)
   * @param reason Optional reason for the reinforcement
   * @returns Success status and vote ID if successful
   */
  public async castReinforcementVote(
    sourceAgentId: string,
    targetAgentId: string,
    contextType: 'signal' | 'insight' | 'strategy' | 'decision',
    contextId: string,
    strength: number,
    reason?: string
  ): Promise<{ success: boolean, voteId?: string }> {
    // Prevent self-voting
    if (sourceAgentId === targetAgentId) {
      this.logger.warn(`Agent ${sourceAgentId} attempted to vote for itself`);
      return { success: false };
    }
    
    // Check if source agent has sufficient trust
    const sourceTrust = await this.trustScoreService.getAgentTrustScore(sourceAgentId);
    if (sourceTrust < this.config.minimumTrustToVote) {
      this.logger.warn(`Agent ${sourceAgentId} has insufficient trust (${sourceTrust}) to cast reinforcement votes`);
      return { success: false };
    }
    
    // Check daily vote limit
    const now = Date.now();
    const today = new Date(now).setHours(0, 0, 0, 0);
    const dailyVoteKey = `${this.redisKeyDailyLimits}:${sourceAgentId}:${today}`;
    const dailyVotes = parseInt(await this.redisService.get(dailyVoteKey) || '0', 10);
    
    if (dailyVotes >= this.config.maxDailyVotes) {
      this.logger.warn(`Agent ${sourceAgentId} has reached daily vote limit`);
      return { success: false };
    }
    
    // Check cooldown period
    const recentVotes = await this.getRecentVotesByAgent(sourceAgentId, targetAgentId);
    if (recentVotes.length > 0) {
      const latestVote = recentVotes[0];
      const timeSinceLastVote = now - latestVote.timestamp;
      
      if (timeSinceLastVote < this.config.voteCooldownMs) {
        this.logger.warn(`Agent ${sourceAgentId} is in cooldown period for voting on ${targetAgentId}`);
        return { success: false };
      }
    }
    
    // Get source agent influence to determine vote strength
    const sourceInfluence = await this.agentInfluenceService.getAgentInfluence(sourceAgentId);
    const normalizedStrength = Math.max(0, Math.min(1, strength));
    const effectiveStrength = normalizedStrength * (1 + sourceInfluence * this.config.influenceMultiplier);
    
    // Create the vote
    const voteId = uuidv4();
    const vote: ReinforcementVote = {
      id: voteId,
      sourceAgentId,
      targetAgentId,
      contextType,
      contextId,
      strength: effectiveStrength,
      timestamp: now,
      expiresAt: now + this.config.voteExpirationMs,
      reason: reason || ''
    };
    
    // Store the vote
    const voteObj = vote as unknown as Record<string, string>;
    const voteKey = `${this.redisKeyVotes}:${voteId}`;
    
    for (const [field, value] of Object.entries(voteObj)) {
      await this.redisService.hset(voteKey, field, String(value));
    }
    
    // Set expiry
    await this.redisService.expire(
      `${this.redisKeyVotes}:${voteId}`,
      Math.floor(this.config.voteExpirationMs / 1000)
    );
    
    // Increment daily vote counter
    await this.redisService.incr(dailyVoteKey);
    await this.redisService.expire(dailyVoteKey, 86400); // Expire after 24 hours
    
    // Record agreement score between agents
    await this.updateAgentAgreement(sourceAgentId, targetAgentId, effectiveStrength);
    
    // Grant reward through meta-reward engine
    await this.metaRewardEngine.grantReward({
      agentId: sourceAgentId,
      ruleId: 'insight_reinforcement', 
      grantedBy: targetAgentId,
      metadata: {
        voteId,
        contextType,
        contextId,
        strength: effectiveStrength
      }
    });
    
    // Emit event for the reinforcement
    this.eventEmitter.emit('agent:reinforced', {
      sourceAgentId,
      targetAgentId,
      contextType,
      contextId,
      strength: effectiveStrength,
      voteId
    });
    
    return { success: true, voteId };
  }

  /**
   * Get all active reinforcement votes for a specific agent
   * 
   * @param agentId The agent to get votes for
   * @returns Array of active votes
   */
  public async getActiveVotesForAgent(agentId: string): Promise<ReinforcementVote[]> {
    const votes: ReinforcementVote[] = [];
    const now = Date.now();
    
    // TODO: Implement more efficient search with Redis sorted sets
    const keys = await this.redisService.keys(`${this.redisKeyVotes}:*`);
    
    for (const key of keys) {
      const voteData = await this.redisService.hgetall(key);
      
      if (voteData && voteData.targetAgentId === agentId) {
        const vote = voteData as unknown as ReinforcementVote;
        
        // Only include votes that haven't expired
        if (vote.expiresAt > now) {
          votes.push(vote);
        }
      }
    }
    
    return votes;
  }

  /**
   * Calculate the total reinforcement score for an agent based on active votes
   * 
   * @param agentId The agent to calculate reinforcement for
   * @returns The total reinforcement score and count of votes
   */
  public async calculateAgentReinforcement(agentId: string): Promise<{ score: number, voteCount: number }> {
    const activeVotes = await this.getActiveVotesForAgent(agentId);
    
    let totalScore = 0;
    
    for (const vote of activeVotes) {
      // Get current trust of the voter to ensure it's still valid
      const voterTrust = await this.trustScoreService.getAgentTrustScore(vote.sourceAgentId);
      
      // Only count votes from agents that still have sufficient trust
      if (voterTrust >= this.config.minimumTrustToVote) {
        totalScore += vote.strength;
      }
    }
    
    return {
      score: totalScore,
      voteCount: activeVotes.length
    };
  }

  /**
   * Get recent votes cast by an agent
   * 
   * @param sourceAgentId The agent that cast the votes
   * @param targetAgentId Optional target agent to filter by
   * @returns Array of recent votes
   */
  private async getRecentVotesByAgent(
    sourceAgentId: string,
    targetAgentId?: string
  ): Promise<ReinforcementVote[]> {
    const votes: ReinforcementVote[] = [];
    
    // TODO: Implement more efficient search with Redis sorted sets
    const keys = await this.redisService.keys(`${this.redisKeyVotes}:*`);
    
    for (const key of keys) {
      const voteData = await this.redisService.hgetall(key);
      
      if (voteData && voteData.sourceAgentId === sourceAgentId) {
        if (!targetAgentId || voteData.targetAgentId === targetAgentId) {
          votes.push(voteData as unknown as ReinforcementVote);
        }
      }
    }
    
    // Sort by timestamp descending (most recent first)
    return votes.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Update the agreement score between two agents
   * 
   * @param agentA First agent
   * @param agentB Second agent
   * @param agreementValue Current agreement value (0-1)
   */
  private async updateAgentAgreement(agentA: string, agentB: string, agreementValue: number): Promise<void> {
    const sortedAgents = [agentA, agentB].sort().join(':');
    const key = `${this.redisKeyAgreement}:${sortedAgents}`;
    
    // Get current agreement data
    const currentData = await this.redisService.get(key);
    let count = 1;
    let total = agreementValue;
    
    if (currentData) {
      try {
        const data = JSON.parse(currentData);
        count = data.count + 1;
        total = data.total + agreementValue;
      } catch (err) {
        this.logger.error(`Failed to parse agreement data for ${sortedAgents}:`, err);
      }
    }
    
    // Store updated agreement data
    const newData = JSON.stringify({
      count,
      total,
      average: total / count,
      updated: Date.now()
    });
    
    await this.redisService.set(key, newData);
    
    // Set a 90-day expiry
    await this.redisService.expire(key, 7776000); // 90 days
  }

  /**
   * Get the agreement score between two agents
   * 
   * @param agentA First agent
   * @param agentB Second agent
   * @returns Agreement score between 0-1 or null if no data
   */
  public async getAgentAgreement(agentA: string, agentB: string): Promise<number | null> {
    // Ensure consistent key order
    const [firstAgent, secondAgent] = [agentA, agentB].sort();
    const agreementKey = `${this.redisKeyAgreement}:${firstAgent}:${secondAgent}`;
    
    const data = await this.redisService.hgetall(agreementKey);
    
    if (data && data.agreementScore) {
      return parseFloat(data.agreementScore);
    }
    
    return null;
  }

  /**
   * Find agents that have high agreement with a given agent
   * 
   * @param agentId The agent to find agreements for
   * @param threshold Minimum agreement threshold (0-1)
   * @returns Array of agent IDs with high agreement
   */
  public async findHighAgreementAgents(agentId: string, threshold = 0.8): Promise<string[]> {
    const agreementAgents: string[] = [];
    
    // Find all agreement keys involving this agent
    const keys = await this.redisService.keys(`${this.redisKeyAgreement}:${agentId}:*`);
    const keysPart2 = await this.redisService.keys(`${this.redisKeyAgreement}:*:${agentId}`);
    
    const allKeys = [...keys, ...keysPart2];
    
    for (const key of allKeys) {
      const data = await this.redisService.hgetall(key);
      
      if (data && data.agreementScore && parseFloat(data.agreementScore) >= threshold) {
        // Extract the other agent ID from the key
        const keyParts = key.split(':');
        const otherAgentId = keyParts[2] === agentId ? keyParts[3] : keyParts[2];
        
        agreementAgents.push(otherAgentId);
      }
    }
    
    return agreementAgents;
  }

  /**
   * Schedule cleanup of expired votes
   */
  private scheduleVoteCleanup(): void {
    // Run cleanup daily
    setInterval(async () => {
      try {
        await this.cleanupExpiredVotes();
      } catch (error) {
        this.logger.error('Error in vote cleanup process', { error });
      }
    }, 24 * 60 * 60 * 1000); // Daily
  }

  /**
   * Clean up expired reinforcement votes
   */
  private async cleanupExpiredVotes(): Promise<void> {
    const now = Date.now();
    let expiredCount = 0;
    
    const keys = await this.redisService.keys(`${this.redisKeyVotes}:*`);
    
    for (const key of keys) {
      try {
        const voteData = await this.redisService.hgetall(key);
        
        if (voteData && voteData.expiresAt && parseInt(voteData.expiresAt, 10) < now) {
          await this.redisService.del(key);
          expiredCount++;
        }
      } catch (error) {
        this.logger.error(`Error cleaning up vote ${key}`, { error });
      }
    }
    
    if (expiredCount > 0) {
      this.logger.info(`Cleaned up ${expiredCount} expired reinforcement votes`);
    }
  }

  /**
   * Handle signal published events
   * 
   * @param data Signal data
   */
  private async handleSignalPublished(data: any): Promise<void> {
    // This could automatically suggest votes for aligned signals
    // Implement auto-voting logic for highly aligned signals
  }

  /**
   * Handle insight published events
   * 
   * @param data Insight data
   */
  private async handleInsightPublished(data: any): Promise<void> {
    // This could notify agents with similar interests
    // Implement insight notification logic
  }
} 