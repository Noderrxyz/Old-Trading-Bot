/**
 * Vote Weight Calculator
 * 
 * Utility for calculating vote weights based on agent trust, participation,
 * recency, and delegations.
 */

import { FileSystemService } from '../../services/FileSystemService.js';
import { RedisClient } from '../../common/redis.js';
import {
  VoteDecayModel,
  VoteDecayConfig,
  LiquidVote,
  AgentID
} from '../../types/governance-liquid.types.js';
import { createLogger } from '../../common/logger.js';

const logger = createLogger('VoteWeightCalculator');

export class VoteWeightCalculator {
  private fs: FileSystemService;
  private redisClient: RedisClient;
  private decayConfigPath: string = 'src/data/governance/liquid/vote_decay.config.json';
  private neuralConfigPath: string = 'src/data/governance/liquid/neural_quorum.config.json';
  
  // Cached configurations
  private decayConfig: any;
  private neuralConfig: any;
  
  constructor(redisClient: RedisClient, fs?: FileSystemService) {
    this.redisClient = redisClient;
    this.fs = fs || new FileSystemService();
    
    // Initialize configurations
    this.initialize();
  }
  
  /**
   * Initialize the calculator by loading configurations
   */
  private async initialize(): Promise<void> {
    await this.loadConfigurations();
  }
  
  /**
   * Load configurations from file system
   */
  private async loadConfigurations(): Promise<void> {
    try {
      // Load decay configuration
      const decayConfigData = await this.fs.readFile(this.decayConfigPath);
      if (decayConfigData) {
        this.decayConfig = JSON.parse(decayConfigData);
      } else {
        logger.warn(`Decay configuration file not found at ${this.decayConfigPath}`);
        this.decayConfig = this.getDefaultDecayConfig();
      }
      
      // Load neural configuration
      const neuralConfigData = await this.fs.readFile(this.neuralConfigPath);
      if (neuralConfigData) {
        this.neuralConfig = JSON.parse(neuralConfigData);
      } else {
        logger.warn(`Neural configuration file not found at ${this.neuralConfigPath}`);
        this.neuralConfig = this.getDefaultNeuralConfig();
      }
    } catch (error: any) {
      logger.error(`Failed to load configurations: ${error.message}`);
      
      // Use defaults as fallback
      this.decayConfig = this.getDefaultDecayConfig();
      this.neuralConfig = this.getDefaultNeuralConfig();
    }
  }
  
  /**
   * Get default decay configuration
   */
  private getDefaultDecayConfig(): any {
    return {
      defaultDecay: {
        model: "exponential",
        halfLifeMs: 259200000, // 3 days
        minWeight: 0.1,
        parameters: {
          decayRate: 0.0000025
        }
      }
    };
  }
  
  /**
   * Get default neural configuration
   */
  private getDefaultNeuralConfig(): any {
    return {
      trustScoreWeight: 0.4,
      participationWeight: 0.3,
      recencyWeight: 0.2,
      delegationWeight: 0.1,
      minimumQuorum: 0.25
    };
  }
  
  /**
   * Calculate the current weight of a vote considering all factors
   * 
   * @param vote The vote to calculate weight for
   * @param currentTime Current timestamp in ms
   * @returns Updated vote with new weight
   */
  public async calculateVoteWeight(vote: LiquidVote, currentTime: number = Date.now()): Promise<LiquidVote> {
    // Clone vote to avoid modifying the original
    const updatedVote = { ...vote };
    
    // Skip inactive votes
    if (!updatedVote.active) {
      updatedVote.currentWeight = 0;
      return updatedVote;
    }
    
    // Start with the base weight (original)
    let weight = updatedVote.originalWeight;
    
    // Apply time decay
    weight = this.applyTimeDecay(weight, updatedVote.timestamp, currentTime);
    
    // Apply trust score multiplier
    const trustScore = await this.getAgentTrustScore(updatedVote.agentId);
    weight *= (trustScore * this.neuralConfig.trustScoreWeight + (1 - this.neuralConfig.trustScoreWeight));
    
    // Apply participation score multiplier
    const participationScore = await this.getAgentParticipationScore(updatedVote.agentId);
    weight *= (participationScore * this.neuralConfig.participationWeight + (1 - this.neuralConfig.participationWeight));
    
    // Apply recency multiplier (separate from time decay)
    const recencyScore = this.calculateRecencyScore(updatedVote.timestamp, currentTime);
    weight *= (recencyScore * this.neuralConfig.recencyWeight + (1 - this.neuralConfig.recencyWeight));
    
    // Update the vote weight
    updatedVote.currentWeight = weight;
    updatedVote.lastUpdated = currentTime;
    
    return updatedVote;
  }
  
  /**
   * Apply time-based decay to a vote weight
   * 
   * @param weight Starting weight
   * @param timestamp When the vote was cast
   * @param currentTime Current time
   * @returns Decayed weight
   */
  private applyTimeDecay(weight: number, timestamp: number, currentTime: number): number {
    const ageMs = currentTime - timestamp;
    if (ageMs <= 0) return weight; // No decay for votes just cast
    
    const decayConfig = this.decayConfig.defaultDecay;
    
    switch (decayConfig.model) {
      case VoteDecayModel.LINEAR: {
        const decayRate = decayConfig.parameters?.decayRate || 0.00001;
        const decayedWeight = weight * (1 - (ageMs * decayRate));
        return Math.max(decayedWeight, decayConfig.minWeight);
      }
      
      case VoteDecayModel.EXPONENTIAL: {
        const decayRate = decayConfig.parameters?.decayRate || 0.0000025;
        const decayedWeight = weight * Math.exp(-decayRate * ageMs);
        return Math.max(decayedWeight, decayConfig.minWeight);
      }
      
      case VoteDecayModel.STEP: {
        const steps = decayConfig.parameters?.steps || [];
        if (steps.length === 0) return weight;
        
        // Find the applicable step
        let multiplier = 1.0;
        for (const step of steps) {
          if (ageMs >= step.timeMs) {
            multiplier = step.multiplier;
          } else {
            break;
          }
        }
        
        const decayedWeight = weight * multiplier;
        return Math.max(decayedWeight, decayConfig.minWeight);
      }
      
      case VoteDecayModel.CLIFF: {
        const cliffTimeMs = decayConfig.parameters?.cliffTimeMs || 172800000; // 2 days default
        const cliffDropMultiplier = decayConfig.parameters?.cliffDropMultiplier || 0.5;
        const postCliffDecayRate = decayConfig.parameters?.postCliffDecayRate || 0.000001;
        
        let decayedWeight = weight;
        
        // Apply cliff drop
        if (ageMs >= cliffTimeMs) {
          decayedWeight *= cliffDropMultiplier;
          
          // Apply post-cliff exponential decay
          const postCliffAge = ageMs - cliffTimeMs;
          decayedWeight *= Math.exp(-postCliffDecayRate * postCliffAge);
        }
        
        return Math.max(decayedWeight, decayConfig.minWeight);
      }
      
      case VoteDecayModel.NONE:
      default:
        return weight;
    }
  }
  
  /**
   * Calculate a recency score (0-1) based on how recently the vote was cast
   * This is separate from time decay and represents a "freshness" factor
   * 
   * @param timestamp When the vote was cast
   * @param currentTime Current time
   * @returns Recency score (0-1)
   */
  private calculateRecencyScore(timestamp: number, currentTime: number): number {
    const ageMs = currentTime - timestamp;
    if (ageMs <= 0) return 1.0;
    
    const maxAgeMs = this.neuralConfig.recencyScoring?.maxAgeMs || 2592000000; // 30 days default
    const halfLifeMs = this.neuralConfig.recencyScoring?.halfLifeMs || 604800000; // 7 days default
    const decayModel = this.neuralConfig.recencyScoring?.decayModel || 'exponential';
    
    if (ageMs >= maxAgeMs) return 0.1; // Minimum recency score
    
    if (decayModel === 'exponential') {
      const decayRate = Math.log(2) / halfLifeMs;
      return 0.1 + 0.9 * Math.exp(-decayRate * ageMs);
    } else {
      // Linear decay as fallback
      return 0.1 + 0.9 * (1 - (ageMs / maxAgeMs));
    }
  }
  
  /**
   * Get an agent's trust score from the system
   * 
   * @param agentId Agent ID
   * @returns Trust score (0-1)
   */
  private async getAgentTrustScore(agentId: AgentID): Promise<number> {
    try {
      const trustScore = await this.redisClient.get(`agent:${agentId}:trust_score`);
      if (trustScore) {
        const score = parseFloat(trustScore);
        const min = this.neuralConfig.trustScoring?.minTrustScore || 0.1;
        const max = this.neuralConfig.trustScoring?.maxTrustScore || 1.0;
        return Math.min(Math.max(score, min), max);
      }
    } catch (error) {
      logger.error(`Error getting trust score for agent ${agentId}: ${error}`);
    }
    
    return this.neuralConfig.trustScoring?.defaultTrustScore || 0.5;
  }
  
  /**
   * Get an agent's participation score based on their governance activity
   * 
   * @param agentId Agent ID
   * @returns Participation score (0-1)
   */
  private async getAgentParticipationScore(agentId: AgentID): Promise<number> {
    try {
      const participationData = await this.redisClient.get(`governance:liquid:agent:${agentId}:participation`);
      if (participationData) {
        const data = JSON.parse(participationData);
        return data.participationRate || 0.5;
      }
    } catch (error) {
      logger.error(`Error getting participation score for agent ${agentId}: ${error}`);
    }
    
    return 0.5; // Default participation score
  }
  
  /**
   * Calculate delegation factor for an agent
   * 
   * @param agentId Agent ID
   * @param proposalId Proposal ID
   * @returns Delegation factor
   */
  public async calculateDelegationFactor(agentId: AgentID, proposalId: string): Promise<number> {
    try {
      // Get delegations to this agent
      const delegationsData = await this.redisClient.get(`governance:liquid:delegations:to:${agentId}:${proposalId}`);
      if (!delegationsData) return 1.0;
      
      const delegations = JSON.parse(delegationsData);
      if (!Array.isArray(delegations) || delegations.length === 0) return 1.0;
      
      // Calculate additional weight from delegations
      const delegationWeight = delegations.reduce((total, delegation) => total + delegation.weight, 0);
      
      // Apply delegation weight based on configuration
      return 1.0 + (delegationWeight * this.neuralConfig.delegationWeight);
    } catch (error) {
      logger.error(`Error calculating delegation factor: ${error}`);
      return 1.0;
    }
  }
  
  /**
   * Update the cached configuration
   */
  public async refreshConfiguration(): Promise<void> {
    await this.loadConfigurations();
  }
} 