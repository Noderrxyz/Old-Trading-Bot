import { RedisClient } from '../../common/redis.js';
import { createLogger } from '../../common/logger.js';
import { TradingAgent } from '../base/TradingAgent.js';
import { AgentLifecycleState } from '../base/AgentContext.js';
import { AgentRegistry } from '../agentRegistry.js';

const logger = createLogger('AgentFitness');

/**
 * Agent Fitness Score data structure
 */
export interface AgentFitnessScore {
  // Agent identifier
  agentId: string;
  
  // Profit & Loss over 7 days, as a decimal percentage
  pnl7d: number;
  
  // Strategy accuracy (hit rate as a percentage)
  strategyHitRate: number;
  
  // Number of anomalies detected for this agent
  anomalyCount: number;
  
  // Trust score decay slope (negative means decaying)
  decaySlope: number;
  
  // Percentage of votes aligned with the quorum
  votesAligned: number;
  
  // Aggregated fitness score (0-1)
  fitnessScore: number;
  
  // Timestamp when this fitness score was calculated
  timestamp: number;
  
  // Additional metrics for specific agent types
  additionalMetrics?: Record<string, number>;
}

/**
 * Weights for different fitness components
 */
export interface FitnessWeights {
  pnl7d: number;
  strategyHitRate: number;
  anomalyCount: number;
  decaySlope: number;
  votesAligned: number;
}

/**
 * Default weights for fitness scoring
 */
export const DEFAULT_FITNESS_WEIGHTS: FitnessWeights = {
  pnl7d: 0.35,
  strategyHitRate: 0.25,
  anomalyCount: 0.15,
  decaySlope: 0.15,
  votesAligned: 0.10,
};

/**
 * Agent Fitness Scoring System
 * 
 * Calculates and manages fitness scores for agents based on their performance,
 * behavior, and alignment with the system.
 */
export class AgentFitnessScoring {
  private redis: RedisClient;
  private agentRegistry: AgentRegistry;
  private fitnessScores: Map<string, AgentFitnessScore> = new Map();
  private fitnessWeights: FitnessWeights;
  
  /**
   * Create a new agent fitness scoring system
   * @param redis Redis client for persistence
   * @param agentRegistry Agent registry for accessing agent data
   * @param weights Optional custom weights for fitness components
   */
  constructor(
    redis: RedisClient,
    agentRegistry: AgentRegistry,
    weights: Partial<FitnessWeights> = {}
  ) {
    this.redis = redis;
    this.agentRegistry = agentRegistry;
    this.fitnessWeights = { ...DEFAULT_FITNESS_WEIGHTS, ...weights };
  }
  
  /**
   * Initialize the fitness scoring system
   */
  public async initialize(): Promise<void> {
    // Load existing fitness scores from Redis
    await this.loadFitnessScoresFromRedis();
    logger.info(`Initialized agent fitness scoring with ${this.fitnessScores.size} agent scores`);
  }
  
  /**
   * Calculate fitness score for a specific agent
   * @param agentId Agent ID to calculate for
   * @returns The calculated fitness score or null if agent not found
   */
  public async calculateAgentFitness(agentId: string): Promise<AgentFitnessScore | null> {
    const agent = this.agentRegistry.getAgent(agentId);
    if (!agent) {
      logger.warn(`Cannot calculate fitness for agent ${agentId}: not found in registry`);
      return null;
    }
    
    // Get agent data needed for calculations
    const agentMetrics = agent.agentMetrics;
    
    // Get historical data from Redis
    const pnl7d = await this.getPnlForTimeframe(agentId, 7 * 24 * 60 * 60 * 1000);
    const strategyHitRate = await this.getStrategyHitRate(agentId);
    const anomalyCount = await this.getAnomalyCount(agentId);
    const decaySlope = await this.getDecaySlope(agentId);
    const votesAligned = await this.getVoteAlignment(agentId);
    
    // Calculate combined fitness score
    const fitnessScore = this.calculateFitnessScore({
      pnl7d,
      strategyHitRate,
      anomalyCount,
      decaySlope,
      votesAligned
    });
    
    const agentFitness: AgentFitnessScore = {
      agentId,
      pnl7d,
      strategyHitRate,
      anomalyCount,
      decaySlope,
      votesAligned,
      fitnessScore,
      timestamp: Date.now(),
      additionalMetrics: this.getAdditionalMetrics(agent)
    };
    
    // Store and publish
    this.fitnessScores.set(agentId, agentFitness);
    await this.saveFitnessScoreToRedis(agentFitness);
    await this.publishFitnessUpdate(agentFitness);
    
    return agentFitness;
  }
  
  /**
   * Calculate fitness scores for all registered agents
   */
  public async calculateAllAgentFitness(): Promise<Map<string, AgentFitnessScore>> {
    logger.info('Calculating fitness scores for all agents');
    const agents = this.agentRegistry.getAllAgents();
    
    for (const [agentId, _] of agents) {
      await this.calculateAgentFitness(agentId);
    }
    
    return this.fitnessScores;
  }
  
  /**
   * Get the fitness score for a specific agent
   * @param agentId Agent ID
   * @returns The agent's fitness score or undefined if not found
   */
  public getAgentFitness(agentId: string): AgentFitnessScore | undefined {
    return this.fitnessScores.get(agentId);
  }
  
  /**
   * Get all fitness scores
   * @returns Map of agent ID to fitness score
   */
  public getAllFitnessScores(): Map<string, AgentFitnessScore> {
    return new Map(this.fitnessScores);
  }
  
  /**
   * Get agents with fitness scores above a threshold
   * @param threshold Minimum fitness score (0-1)
   * @returns Array of agent IDs with fitness above threshold
   */
  public getAgentsAboveThreshold(threshold: number): string[] {
    const qualifiedAgents: string[] = [];
    
    for (const [agentId, fitness] of this.fitnessScores) {
      if (fitness.fitnessScore >= threshold) {
        qualifiedAgents.push(agentId);
      }
    }
    
    return qualifiedAgents;
  }
  
  /**
   * Update fitness weights
   * @param weights New weights to apply
   */
  public updateFitnessWeights(weights: Partial<FitnessWeights>): void {
    this.fitnessWeights = { ...this.fitnessWeights, ...weights };
    logger.info('Updated fitness weights', { weights: this.fitnessWeights });
  }
  
  /**
   * Calculate the combined fitness score from individual components
   * @param components Fitness components
   * @returns Combined fitness score (0-1)
   */
  private calculateFitnessScore(components: {
    pnl7d: number;
    strategyHitRate: number;
    anomalyCount: number;
    decaySlope: number;
    votesAligned: number;
  }): number {
    // Normalize PnL to 0-1 range (assuming range from -0.2 to 0.2)
    const normalizedPnl = Math.max(0, Math.min(1, (components.pnl7d + 0.2) / 0.4));
    
    // Normalize hit rate (already 0-100)
    const normalizedHitRate = components.strategyHitRate / 100;
    
    // Normalize anomaly count (inverse relationship, 0 is best)
    // Assume more than 10 anomalies means 0 score
    const normalizedAnomalyCount = Math.max(0, 1 - components.anomalyCount / 10);
    
    // Normalize decay slope (convert -0.1 to 0.1 to 0-1 range)
    const normalizedDecaySlope = Math.max(0, Math.min(1, (components.decaySlope + 0.1) / 0.2));
    
    // Normalize vote alignment (already 0-100)
    const normalizedVoteAlignment = components.votesAligned / 100;
    
    // Apply weights and sum
    const weightedScore = 
      this.fitnessWeights.pnl7d * normalizedPnl +
      this.fitnessWeights.strategyHitRate * normalizedHitRate +
      this.fitnessWeights.anomalyCount * normalizedAnomalyCount +
      this.fitnessWeights.decaySlope * normalizedDecaySlope +
      this.fitnessWeights.votesAligned * normalizedVoteAlignment;
    
    // Ensure result is in 0-1 range
    return Math.max(0, Math.min(1, weightedScore));
  }
  
  /**
   * Get agent's PnL for a specified timeframe
   * @param agentId Agent ID
   * @param timeframeMs Timeframe in milliseconds
   * @returns PnL as a decimal percentage
   */
  private async getPnlForTimeframe(agentId: string, timeframeMs: number): Promise<number> {
    // In a production implementation, this would:
    // 1. Query trade history from Redis for this agent
    // 2. Calculate cumulative PnL over the timeframe
    // 3. Return as a decimal percentage
    
    // Mock implementation for now
    const agent = this.agentRegistry.getAgent(agentId);
    if (!agent) return 0;
    
    const mockPnl = (Math.random() * 0.3) - 0.1; // -10% to +20%
    return Number(mockPnl.toFixed(4));
  }
  
  /**
   * Get agent's strategy hit rate
   * @param agentId Agent ID
   * @returns Hit rate as a percentage (0-100)
   */
  private async getStrategyHitRate(agentId: string): Promise<number> {
    // In a production implementation, this would:
    // 1. Query signal history from Redis
    // 2. Calculate percentage of signals that led to profitable trades
    
    // Mock implementation for now
    const mockHitRate = 40 + Math.random() * 50; // 40-90%
    return Number(mockHitRate.toFixed(1));
  }
  
  /**
   * Get count of anomalies for an agent
   * @param agentId Agent ID
   * @returns Number of anomalies
   */
  private async getAnomalyCount(agentId: string): Promise<number> {
    // In a production implementation, this would query anomaly records
    
    // Mock implementation for now
    const mockAnomalyCount = Math.floor(Math.random() * 5); // 0-4
    return mockAnomalyCount;
  }
  
  /**
   * Get trust decay slope for an agent
   * @param agentId Agent ID
   * @returns Decay slope as a percentage per day
   */
  private async getDecaySlope(agentId: string): Promise<number> {
    // In a production implementation, this would:
    // 1. Query trust score history
    // 2. Calculate the slope of decay/growth
    
    // Mock implementation for now
    const mockDecaySlope = (Math.random() * 0.14) - 0.07; // -7% to +7%
    return Number(mockDecaySlope.toFixed(4));
  }
  
  /**
   * Get percentage of votes aligned with quorum
   * @param agentId Agent ID
   * @returns Alignment percentage (0-100)
   */
  private async getVoteAlignment(agentId: string): Promise<number> {
    // In a production implementation, this would:
    // 1. Query vote history from governance system
    // 2. Calculate percentage aligned with majority
    
    // Mock implementation for now
    const mockAlignment = 50 + Math.random() * 45; // 50-95%
    return Number(mockAlignment.toFixed(1));
  }
  
  /**
   * Get additional metrics specific to agent type
   * @param agent Agent instance
   * @returns Custom metrics record
   */
  private getAdditionalMetrics(agent: TradingAgent): Record<string, number> {
    return agent.agentMetrics?.custom || {};
  }
  
  /**
   * Load fitness scores from Redis
   */
  private async loadFitnessScoresFromRedis(): Promise<void> {
    try {
      const keys = await this.redis.keys('agent:fitness:*');
      
      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const fitness = JSON.parse(data) as AgentFitnessScore;
          this.fitnessScores.set(fitness.agentId, fitness);
        }
      }
      
      logger.debug(`Loaded ${this.fitnessScores.size} fitness scores from Redis`);
    } catch (error) {
      logger.error('Failed to load fitness scores from Redis', { error });
    }
  }
  
  /**
   * Save fitness score to Redis
   * @param fitness Fitness score to save
   */
  private async saveFitnessScoreToRedis(fitness: AgentFitnessScore): Promise<void> {
    try {
      const key = `agent:fitness:${fitness.agentId}`;
      await this.redis.set(key, JSON.stringify(fitness));
      
      // Also store in time series for historical tracking
      const historyKey = `agent:fitness:history:${fitness.agentId}`;
      await this.redis.zadd(historyKey, fitness.timestamp, JSON.stringify(fitness));
      
      // Trim history to keep last 90 days
      const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
      await this.redis.zremrangebyscore(historyKey, 0, ninetyDaysAgo);
    } catch (error) {
      logger.error(`Failed to save fitness score for agent ${fitness.agentId}`, { error });
    }
  }
  
  /**
   * Publish fitness update to Redis channel
   * @param fitness Fitness score to publish
   */
  private async publishFitnessUpdate(fitness: AgentFitnessScore): Promise<void> {
    try {
      await this.redis.publish('pubsub:agent-fitness', JSON.stringify(fitness));
    } catch (error) {
      logger.error(`Failed to publish fitness update for agent ${fitness.agentId}`, { error });
    }
  }
} 