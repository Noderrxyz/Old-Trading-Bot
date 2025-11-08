import { RedisClient } from '../../../common/redis.js';
import { createLogger } from '../../../common/logger.js';
import { AgentRegistry } from '../../agentRegistry.js';
import { AgentFitnessScoring, AgentFitnessScore } from '../agentFitnessScoring.js';
import { MutationRegistry, MutationTrial, MutationConfig } from '../mutationRegistry.js';
import { EvolutionEngine, TrialResult } from '../evolutionEngine.js';
import { EvoVotingSystem, EvoVoteProposal, EvoVote, VoteTally } from '../evolutionVoting.js';

const logger = createLogger('EvolutionDashboardAPI');

/**
 * Evolution Dashboard API results
 */
export interface EvolutionDashboardData {
  // Status summary
  summary: {
    mutatingAgentsCount: number;
    activeTrialsCount: number;
    completedTrialsCount: number;
    promotedMutationsCount: number;
    rejectedMutationsCount: number;
    blacklistedMutationsCount: number;
    pendingVotesCount: number;
  };
  
  // Active trials
  activeTrials: {
    trialId: string;
    agentId: string;
    mutationId: string;
    mutationName: string;
    startTimestamp: number;
    duration: number; // in hours
    baselineFitness: number;
    currentFitness: number;
    fitnessDelta: number;
  }[];
  
  // Recent trial results
  recentTrialResults: TrialResult[];
  
  // Agent fitness rankings
  agentFitnessRankings: {
    agentId: string;
    fitnessScore: number;
    rank: number;
    eligibleForMutation: boolean;
  }[];
  
  // Pending votes
  pendingVotes: {
    proposalId: string;
    type: string;
    summary: string;
    agentId: string;
    mutationId: string;
    approveCount: number;
    rejectCount: number;
    quorumReached: boolean;
    deadline: number;
  }[];
}

/**
 * Evolution agent detail
 */
export interface EvolutionAgentDetail {
  // Agent information
  agentId: string;
  fitnessScore: AgentFitnessScore;
  
  // Mutation history
  mutationHistory: MutationTrial[];
  
  // Blacklisted mutations
  blacklistedMutations: {
    mutationId: string;
    name: string;
    reason: string;
  }[];
  
  // Recommended mutations
  recommendedMutations: {
    mutationId: string;
    name: string;
    description: string;
    expectedFitnessDelta: number;
    confidence: number;
  }[];
  
  // Fitness trend data for charting
  fitnessTrend: {
    timestamp: number;
    fitnessScore: number;
  }[];
}

/**
 * Mutation detail
 */
export interface MutationDetail {
  // Mutation information
  mutationId: string;
  name: string;
  description: string;
  version: string;
  function: string;
  parameters: Record<string, any>;
  
  // Application stats
  applicationStats: {
    totalApplications: number;
    successRate: number;
    averageFitnessDelta: number;
    agentTypeBreakdown: Record<string, number>;
  };
  
  // Recent applications
  recentApplications: {
    trialId: string;
    agentId: string;
    startTimestamp: number;
    result: string;
    fitnessDelta: number;
  }[];
}

/**
 * Evolution Dashboard API
 * 
 * Provides data access and aggregation for the evolution dashboard,
 * showing agent mutations, trial progress, and fitness metrics.
 */
export class EvolutionDashboardAPI {
  private redis: RedisClient;
  private agentRegistry: AgentRegistry;
  private fitnessScoring: AgentFitnessScoring;
  private mutationRegistry: MutationRegistry;
  private evolutionEngine: EvolutionEngine;
  private votingSystem: EvoVotingSystem;
  
  /**
   * Create a new evolution dashboard API
   * @param redis Redis client for persistence
   * @param agentRegistry Agent registry for accessing agents
   * @param fitnessScoring Fitness scoring system
   * @param mutationRegistry Mutation registry
   * @param evolutionEngine Evolution engine
   * @param votingSystem Voting system
   */
  constructor(
    redis: RedisClient,
    agentRegistry: AgentRegistry,
    fitnessScoring: AgentFitnessScoring,
    mutationRegistry: MutationRegistry,
    evolutionEngine: EvolutionEngine,
    votingSystem: EvoVotingSystem
  ) {
    this.redis = redis;
    this.agentRegistry = agentRegistry;
    this.fitnessScoring = fitnessScoring;
    this.mutationRegistry = mutationRegistry;
    this.evolutionEngine = evolutionEngine;
    this.votingSystem = votingSystem;
  }
  
  /**
   * Get dashboard overview data
   * @returns Dashboard data
   */
  public async getDashboardData(): Promise<EvolutionDashboardData> {
    logger.debug('Fetching evolution dashboard data');
    
    // Get active trials
    const activeTrials = this.mutationRegistry.getActiveTrials();
    
    // Get recent trial results
    const recentTrialResults = await this.getRecentTrialResults();
    
    // Get agent fitness rankings
    const fitnessScores = this.fitnessScoring.getAllFitnessScores();
    const agentFitnessRankings = await this.getAgentFitnessRankings(fitnessScores);
    
    // Get pending votes
    const pendingVotes = await this.getPendingVotes();
    
    // Count blacklisted mutations
    const blacklistedMutationsCount = await this.countBlacklistedMutations();
    
    // Build dashboard data
    const dashboard: EvolutionDashboardData = {
      summary: {
        mutatingAgentsCount: activeTrials.size,
        activeTrialsCount: activeTrials.size,
        completedTrialsCount: recentTrialResults.length,
        promotedMutationsCount: recentTrialResults.filter(r => r.promoted).length,
        rejectedMutationsCount: recentTrialResults.filter(r => !r.promoted).length,
        blacklistedMutationsCount,
        pendingVotesCount: pendingVotes.length
      },
      activeTrials: await this.formatActiveTrials(activeTrials),
      recentTrialResults,
      agentFitnessRankings,
      pendingVotes
    };
    
    return dashboard;
  }
  
  /**
   * Get detailed information about an agent's evolution
   * @param agentId Agent ID
   * @returns Agent evolution details
   */
  public async getAgentEvolutionDetail(agentId: string): Promise<EvolutionAgentDetail | null> {
    logger.debug(`Fetching evolution detail for agent ${agentId}`);
    
    // Check if agent exists
    const agent = this.agentRegistry.getAgent(agentId);
    if (!agent) {
      logger.warn(`Agent ${agentId} not found`);
      return null;
    }
    
    // Get agent fitness
    const fitnessScore = this.fitnessScoring.getAgentFitness(agentId);
    if (!fitnessScore) {
      logger.warn(`No fitness score found for agent ${agentId}`);
      return null;
    }
    
    // Get mutation history
    const mutationHistory = await this.mutationRegistry.getTrialHistoryForAgent(agentId);
    
    // Get blacklisted mutations
    const blacklistedMutations = await this.getBlacklistedMutations(agentId);
    
    // Get recommended mutations
    const recommendedMutations = await this.getRecommendedMutations(agentId, fitnessScore);
    
    // Get fitness trend
    const fitnessTrend = await this.getFitnessTrend(agentId);
    
    return {
      agentId,
      fitnessScore,
      mutationHistory,
      blacklistedMutations,
      recommendedMutations,
      fitnessTrend
    };
  }
  
  /**
   * Get detailed information about a specific mutation
   * @param mutationId Mutation ID
   * @returns Mutation details
   */
  public async getMutationDetail(mutationId: string): Promise<MutationDetail | null> {
    logger.debug(`Fetching detail for mutation ${mutationId}`);
    
    // Get mutation config
    const mutation = this.mutationRegistry.getMutation(mutationId);
    if (!mutation) {
      logger.warn(`Mutation ${mutationId} not found`);
      return null;
    }
    
    // Get application stats
    const applicationStats = await this.getMutationApplicationStats(mutationId);
    
    // Get recent applications
    const recentApplications = await this.getRecentMutationApplications(mutationId);
    
    return {
      mutationId,
      name: mutation.name,
      description: mutation.description,
      version: mutation.version,
      function: mutation.mutationFunction,
      parameters: mutation.parameters,
      applicationStats,
      recentApplications
    };
  }
  
  /**
   * Start a new evolution trial
   * @param agentId Agent ID
   * @param mutationId Mutation ID
   * @returns Result of the trial start operation
   */
  public async startTrial(
    agentId: string,
    mutationId: string
  ): Promise<{ success: boolean; message: string; trialId?: string }> {
    logger.info(`Dashboard API: Starting trial for agent ${agentId} with mutation ${mutationId}`);
    
    const result = await this.evolutionEngine.startEvolutionTrial(agentId, mutationId);
    
    return {
      success: result.success,
      message: result.message,
      trialId: result.trialId
    };
  }
  
  /**
   * Cast a vote on an evolution proposal
   * @param proposalId Proposal ID
   * @param voterAgentId Agent ID casting the vote
   * @param approve Whether to approve the proposal
   * @param reason Optional reason for the vote
   * @returns Success status and message
   */
  public async castVote(
    proposalId: string,
    voterAgentId: string,
    approve: boolean,
    reason?: string
  ): Promise<{ success: boolean; message: string }> {
    logger.info(`Dashboard API: Casting vote from ${voterAgentId} on proposal ${proposalId}: ${approve ? 'YES' : 'NO'}`);
    
    return this.votingSystem.castVote(proposalId, voterAgentId, approve, reason);
  }
  
  /**
   * Get information about active trials formatted for dashboard
   * @param activeTrials Map of trial ID to trial metadata
   * @returns Formatted active trials for dashboard
   */
  private async formatActiveTrials(
    activeTrials: Map<string, MutationTrial>
  ): Promise<EvolutionDashboardData['activeTrials']> {
    const formattedTrials: EvolutionDashboardData['activeTrials'] = [];
    
    for (const [trialId, trial] of activeTrials) {
      // Get mutation name
      const mutation = this.mutationRegistry.getMutation(trial.mutationId);
      if (!mutation) continue;
      
      // Get current fitness
      const currentFitness = this.fitnessScoring.getAgentFitness(trial.agentId);
      
      formattedTrials.push({
        trialId,
        agentId: trial.agentId,
        mutationId: trial.mutationId,
        mutationName: mutation.name,
        startTimestamp: trial.startTimestamp,
        duration: (Date.now() - trial.startTimestamp) / (60 * 60 * 1000), // hours
        baselineFitness: trial.baselineFitness,
        currentFitness: currentFitness?.fitnessScore || trial.baselineFitness,
        fitnessDelta: (currentFitness?.fitnessScore || trial.baselineFitness) - trial.baselineFitness
      });
    }
    
    return formattedTrials;
  }
  
  /**
   * Get recent trial results
   * @returns Array of recent trial results
   */
  private async getRecentTrialResults(): Promise<TrialResult[]> {
    try {
      // In a real implementation, would query trial history from Redis
      
      const results = await this.redis.lrange('evolution:trial-results', 0, 19);
      
      return results
        .map(r => JSON.parse(r) as TrialResult)
        .sort((a, b) => b.trialDurationHours - a.trialDurationHours);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to get recent trial results', { error });
      return [];
    }
  }
  
  /**
   * Get agent fitness rankings
   * @param fitnessScores Map of agent ID to fitness score
   * @returns Sorted array of agent fitness rankings
   */
  private async getAgentFitnessRankings(
    fitnessScores: Map<string, AgentFitnessScore>
  ): Promise<EvolutionDashboardData['agentFitnessRankings']> {
    // Convert to array and sort by fitness score (descending)
    const sortedScores = Array.from(fitnessScores.values())
      .sort((a, b) => b.fitnessScore - a.fitnessScore);
    
    // Format as rankings
    return sortedScores.map((score, index) => ({
      agentId: score.agentId,
      fitnessScore: score.fitnessScore,
      rank: index + 1,
      eligibleForMutation: score.fitnessScore > 0.3 && score.anomalyCount <= 2
    }));
  }
  
  /**
   * Get pending votes for dashboard
   * @returns Array of pending votes
   */
  private async getPendingVotes(): Promise<EvolutionDashboardData['pendingVotes']> {
    const pendingVotes: EvolutionDashboardData['pendingVotes'] = [];
    
    // Get active proposals
    const activeProposals = this.votingSystem.getActiveProposals();
    
    for (const [proposalId, proposal] of activeProposals) {
      // Get vote tally
      const tally = await this.votingSystem.tallyVotes(proposalId);
      
      pendingVotes.push({
        proposalId,
        type: proposal.type,
        summary: proposal.summary,
        agentId: proposal.targetAgentId || '',
        mutationId: proposal.mutationId,
        approveCount: tally.approveCount,
        rejectCount: tally.rejectCount,
        quorumReached: tally.quorumReached,
        deadline: proposal.votingCloseTimestamp
      });
    }
    
    return pendingVotes;
  }
  
  /**
   * Count blacklisted mutations across all agents
   * @returns Count of blacklisted mutations
   */
  private async countBlacklistedMutations(): Promise<number> {
    try {
      // In a real implementation, would count distinct blacklisted mutations
      
      const blacklistKeys = await this.redis.keys('agent:mutation:blacklist:*');
      
      let count = 0;
      for (const key of blacklistKeys) {
        const members = await this.redis.smembers(key);
        count += members.length;
      }
      
      return count;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to count blacklisted mutations', { error });
      return 0;
    }
  }
  
  /**
   * Get blacklisted mutations for an agent
   * @param agentId Agent ID
   * @returns Blacklisted mutations
   */
  private async getBlacklistedMutations(
    agentId: string
  ): Promise<EvolutionAgentDetail['blacklistedMutations']> {
    try {
      const blacklistKey = `agent:mutation:blacklist:${agentId}`;
      const blacklistedIds = await this.redis.smembers(blacklistKey);
      
      const blacklisted: EvolutionAgentDetail['blacklistedMutations'] = [];
      
      for (const mutationId of blacklistedIds) {
        const mutation = this.mutationRegistry.getMutation(mutationId);
        if (mutation) {
          blacklisted.push({
            mutationId,
            name: mutation.name,
            reason: 'Reduced fitness or caused anomalies'
          });
        }
      }
      
      return blacklisted;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get blacklisted mutations for agent ${agentId}`, { error });
      return [];
    }
  }
  
  /**
   * Get recommended mutations for an agent
   * @param agentId Agent ID
   * @param fitness Agent fitness
   * @returns Recommended mutations
   */
  private async getRecommendedMutations(
    agentId: string,
    fitness: AgentFitnessScore
  ): Promise<EvolutionAgentDetail['recommendedMutations']> {
    // This would be implemented with a recommendation algorithm
    // that analyzes agent performance and suggests appropriate mutations
    
    const recommendations: EvolutionAgentDetail['recommendedMutations'] = [];
    
    // Get all mutations
    const allMutations = this.mutationRegistry.getAllMutations();
    
    // Get blacklisted mutations
    const blacklistedKey = `agent:mutation:blacklist:${agentId}`;
    const blacklisted = await this.redis.smembers(blacklistedKey);
    
    // Filter and transform mutations
    for (const mutation of allMutations.values()) {
      // Skip if blacklisted or not enabled
      if (blacklisted.includes(mutation.mutationId) || !mutation.enabled) {
        continue;
      }
      
      // Skip if agent doesn't meet conditions
      if (
        fitness.fitnessScore < mutation.conditions.minFitness ||
        fitness.anomalyCount > mutation.conditions.maxAnomalies
      ) {
        continue;
      }
      
      // Add recommendation with mocked expected improvement
      recommendations.push({
        mutationId: mutation.mutationId,
        name: mutation.name,
        description: mutation.description,
        expectedFitnessDelta: Math.random() * 0.2 + 0.05, // 5-25% improvement (mock)
        confidence: Math.random() * 0.5 + 0.5 // 50-100% confidence (mock)
      });
    }
    
    // Sort by expected fitness delta (descending)
    recommendations.sort((a, b) => b.expectedFitnessDelta - a.expectedFitnessDelta);
    
    // Return top 5
    return recommendations.slice(0, 5);
  }
  
  /**
   * Get fitness trend for an agent
   * @param agentId Agent ID
   * @returns Fitness trend data
   */
  private async getFitnessTrend(agentId: string): Promise<EvolutionAgentDetail['fitnessTrend']> {
    try {
      const historyKey = `agent:fitness:history:${agentId}`;
      const fitnessHistory = await this.redis.zrange(historyKey, 0, -1, 'WITHSCORES');
      
      const trend: EvolutionAgentDetail['fitnessTrend'] = [];
      
      for (let i = 0; i < fitnessHistory.length; i += 2) {
        const fitnessData = JSON.parse(fitnessHistory[i]) as AgentFitnessScore;
        const timestamp = parseInt(fitnessHistory[i + 1]);
        
        trend.push({
          timestamp,
          fitnessScore: fitnessData.fitnessScore
        });
      }
      
      // Sort by timestamp (ascending)
      trend.sort((a, b) => a.timestamp - b.timestamp);
      
      return trend;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get fitness trend for agent ${agentId}`, { error });
      return [];
    }
  }
  
  /**
   * Get application stats for a mutation
   * @param mutationId Mutation ID
   * @returns Application stats
   */
  private async getMutationApplicationStats(
    mutationId: string
  ): Promise<MutationDetail['applicationStats']> {
    try {
      // This would query trial history to calculate stats
      // Mock implementation for now
      
      return {
        totalApplications: Math.floor(Math.random() * 50) + 5,
        successRate: Math.random() * 0.5 + 0.5, // 50-100%
        averageFitnessDelta: Math.random() * 0.15 + 0.05, // 5-20%
        agentTypeBreakdown: {
          'crypto': Math.floor(Math.random() * 20),
          'equity': Math.floor(Math.random() * 15),
          'sentiment': Math.floor(Math.random() * 10)
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get application stats for mutation ${mutationId}`, { error });
      
      return {
        totalApplications: 0,
        successRate: 0,
        averageFitnessDelta: 0,
        agentTypeBreakdown: {}
      };
    }
  }
  
  /**
   * Get recent applications of a mutation
   * @param mutationId Mutation ID
   * @returns Recent applications
   */
  private async getRecentMutationApplications(
    mutationId: string
  ): Promise<MutationDetail['recentApplications']> {
    try {
      // This would query trial history to get recent applications
      // Mock implementation for now
      
      const recentApplications: MutationDetail['recentApplications'] = [];
      
      // Generate 5 mock applications
      for (let i = 0; i < 5; i++) {
        const isSuccess = Math.random() > 0.3;
        
        recentApplications.push({
          trialId: `trial:${Date.now() - i * 86400000}:${Math.floor(Math.random() * 10000)}`,
          agentId: `agent:${Math.floor(Math.random() * 100)}`,
          startTimestamp: Date.now() - i * 86400000,
          result: isSuccess ? 'promoted' : 'rejected',
          fitnessDelta: isSuccess ? Math.random() * 0.2 + 0.05 : Math.random() * 0.05 - 0.1
        });
      }
      
      return recentApplications;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get recent applications for mutation ${mutationId}`, { error });
      return [];
    }
  }
} 