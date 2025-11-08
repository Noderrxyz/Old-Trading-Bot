/**
 * Reward Eligibility Service
 * 
 * Checks if agents are eligible to receive or grant rewards.
 */

import { type RedisClientType } from 'redis';
import Logger from '../../../utils/logger.js';
import type { IRewardEligibility } from './types.js';

interface TrustScoreService {
  getAgentTrustScore(agentId: string): Promise<number>;
}

export class RewardEligibility implements IRewardEligibility {
  private AGENT_COOLDOWN_KEY = 'agent:meta:rewards:cooldown:';
  private AGENT_DAILY_TOTAL_KEY = 'agent:meta:rewards:daily:';
  private logger: Logger;
  
  // These should be loaded from configuration
  private minimumTrustToReceiveRewards = 0.3;
  private minimumTrustToGrantRewards = 0.5;
  private dailyRewardCap = 250;
  
  constructor(
    private redisClient: RedisClientType,
    private trustScoreService: TrustScoreService,
    private findRewardRule: (ruleId: string) => any
  ) {
    this.logger = Logger.getInstance('RewardEligibility');
  }
  
  /**
   * Check if an agent is eligible to receive a reward
   */
  public async checkAgentEligibility(
    agentId: string, 
    ruleId: string,
    grantedBy: string | null
  ): Promise<boolean> {
    try {
      // Get the rule for this reward
      const rule = this.findRewardRule(ruleId);
      if (!rule) {
        this.logger.error(`Reward rule not found: ${ruleId}`);
        return false;
      }
      
      // Check agent trust score
      const trustScore = await this.trustScoreService.getAgentTrustScore(agentId);
      if (trustScore < this.minimumTrustToReceiveRewards) {
        this.logger.warn(`Agent ${agentId} has insufficient trust (${trustScore}) to receive rewards`);
        return false;
      }
      
      // Check if agent is on cooldown for this rule type
      if (rule.cooldownHours) {
        const cooldownKey = `${this.AGENT_COOLDOWN_KEY}${agentId}:${rule.id}`;
        const onCooldown = await this.redisClient.exists(cooldownKey);
        
        if (onCooldown) {
          this.logger.info(`Agent ${agentId} is on cooldown for rule ${rule.id}`);
          return false;
        }
      }
      
      // Check daily reward cap (except for human-granted rewards)
      if (!grantedBy || !grantedBy.startsWith('human:')) {
        const dailyKey = `${this.AGENT_DAILY_TOTAL_KEY}${agentId}:${new Date().toISOString().split('T')[0]}`;
        const dailyTotal = parseInt(await this.redisClient.get(dailyKey) || '0', 10);
        
        if (dailyTotal >= this.dailyRewardCap) {
          this.logger.info(`Agent ${agentId} has reached daily reward cap (${dailyTotal}/${this.dailyRewardCap})`);
          return false;
        }
      }
      
      // Check role restrictions if applicable
      if (rule.appliesToRoles && rule.appliesToRoles.length > 0) {
        // Get agent role (implementation depends on your system)
        const agentRole = await this.getAgentRole(agentId);
        
        if (!rule.appliesToRoles.includes(agentRole)) {
          this.logger.info(`Rule ${rule.id} doesn't apply to agent ${agentId} with role ${agentRole}`);
          return false;
        }
      }
      
      return true;
    } catch (err) {
      this.logger.error(`Error checking agent eligibility for ${agentId}:`, err);
      return false;
    }
  }
  
  /**
   * Get an agent's role
   * Placeholder implementation
   */
  private async getAgentRole(agentId: string): Promise<string> {
    // This is a placeholder - implement based on your system
    return 'default';
  }
  
  /**
   * Check if a grantor is eligible to grant rewards
   */
  public async checkGrantorEligibility(grantorId: string): Promise<boolean> {
    // Human grantors can always grant rewards
    if (grantorId.startsWith('human:')) {
      return true;
    }
    
    // Check agent trust score
    const trustScore = await this.trustScoreService.getAgentTrustScore(grantorId);
    if (trustScore < this.minimumTrustToGrantRewards) {
      this.logger.warn(`Grantor ${grantorId} has insufficient trust (${trustScore}) to grant rewards`);
      return false;
    }
    
    return true;
  }
} 