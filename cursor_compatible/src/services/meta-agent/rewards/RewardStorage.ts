/**
 * Reward Storage Service
 * 
 * Handles persistence of reward events in Redis.
 */

import { type RedisClientType } from 'redis';
import { logger } from '../../../utils/logger';
import type { RewardEvent, IRewardStorage } from './types.js';

export class RewardStorage implements IRewardStorage {
  private REWARD_EVENTS_KEY = 'agent:meta:rewards';
  private AGENT_REWARDS_KEY = 'agent:meta:rewards:';
  
  constructor(private redisClient: RedisClientType) {
  }

  /**
   * Store a reward event
   */
  public async storeRewardEvent(event: RewardEvent): Promise<void> {
    try {
      // Add to global rewards list
      await this.redisClient.hSet(this.REWARD_EVENTS_KEY, event.id, JSON.stringify(event));
      
      // Add to agent's rewards list
      await this.redisClient.hSet(this.AGENT_REWARDS_KEY + event.agentId, event.id, JSON.stringify(event));
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      throw new Error(`Failed to store reward event: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Get a reward event by ID
   */
  public async getRewardById(rewardId: string): Promise<RewardEvent | null> {
    try {
      const rewardData = await this.redisClient.hGet(this.REWARD_EVENTS_KEY, rewardId);
      if (!rewardData) {
        return null;
      }
      
      return JSON.parse(rewardData) as RewardEvent;
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  /**
   * Update a reward's verification status
   */
  public async updateRewardVerification(rewardId: string, verified: boolean): Promise<void> {
    try {
      // Update in global rewards
      const rewardData = await this.redisClient.hGet(this.REWARD_EVENTS_KEY, rewardId);
      if (!rewardData) {
        throw new Error(`Reward not found: ${rewardId}`);
      }
      
      const reward: RewardEvent = JSON.parse(rewardData);
      reward.verified = verified;
      
      await this.redisClient.hSet(this.REWARD_EVENTS_KEY, rewardId, JSON.stringify(reward));
      
      // Also update in agent's rewards
      await this.redisClient.hSet(
        this.AGENT_REWARDS_KEY + reward.agentId, 
        rewardId, 
        JSON.stringify(reward)
      );
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      throw new Error(`Failed to update reward verification: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Get an agent's reward events
   */
  public async getAgentRewards(agentId: string): Promise<RewardEvent[]> {
    try {
      const agentRewards = await this.redisClient.hGetAll(this.AGENT_REWARDS_KEY + agentId);
      
      return Object.values(agentRewards).map(json => JSON.parse(json) as RewardEvent);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      return [];
    }
  }
  
  /**
   * Get an agent's total reward points
   */
  public async getAgentTotalRewards(agentId: string): Promise<number> {
    try {
      const rewards = await this.getAgentRewards(agentId);
      return rewards
        .filter(reward => reward.verified)
        .reduce((total, reward) => total + reward.points, 0);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      return 0;
    }
  }

  /**
   * Delete a reward event
   */
  public async deleteReward(rewardId: string): Promise<boolean> {
    try {
      // Get the reward to find its agent
      const rewardData = await this.redisClient.hGet(this.REWARD_EVENTS_KEY, rewardId);
      if (!rewardData) {
        return false;
      }
      
      const reward: RewardEvent = JSON.parse(rewardData);
      
      // Delete from global and agent-specific storage
      await this.redisClient.hDel(this.REWARD_EVENTS_KEY, rewardId);
      await this.redisClient.hDel(this.AGENT_REWARDS_KEY + reward.agentId, rewardId);
      
      return true;
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  /**
   * Get all reward events
   */
  public async getAllRewards(): Promise<Record<string, RewardEvent>> {
    try {
      const allRewards = await this.redisClient.hGetAll(this.REWARD_EVENTS_KEY);
      
      const result: Record<string, RewardEvent> = {};
      for (const [id, data] of Object.entries(allRewards)) {
        result[id] = JSON.parse(data) as RewardEvent;
      }
      
      return result;
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      return {};
    }
  }
} 