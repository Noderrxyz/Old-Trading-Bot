import { RedisClient } from '../../common/redis.js';
import { createLogger } from '../../common/logger.js';
import { AgentRegistry } from '../agentRegistry.js';
import { TrustScoreEngine } from '../../strategy-engine/index.js';

const logger = createLogger('EvolutionVoting');

/**
 * Evolution vote proposal types
 */
export enum EvoVoteType {
  // Propose to promote a mutation
  MUTATION_PROMOTE = 'EVO_MUTATION_PROMOTE',
  
  // Propose to reject a mutation
  MUTATION_REJECT = 'EVO_MUTATION_REJECT',
  
  // Propose to blacklist a mutation
  MUTATION_BLACKLIST = 'EVO_MUTATION_BLACKLIST',
  
  // Propose a new common mutation for multiple agents
  COMMON_MUTATION_PROPOSAL = 'EVO_COMMON_MUTATION_PROPOSAL'
}

/**
 * Vote Proposal structure
 */
export interface EvoVoteProposal {
  // Unique proposal ID
  proposalId: string;
  
  // Type of proposal
  type: EvoVoteType;
  
  // Mutation ID this proposal is about
  mutationId: string;
  
  // Target agent ID (if applicable)
  targetAgentId?: string;
  
  // Summary description of the proposal
  summary: string;
  
  // Additional metadata about the proposal
  metadata: {
    // Fitness gain percentage (for promotions)
    fitnessGain?: number;
    
    // Reason for rejection or blacklisting
    reason?: string;
    
    // Other mutation-specific data
    [key: string]: any;
  };
  
  // Agent ID that created this proposal
  proposerAgentId: string;
  
  // Timestamp when proposal was created
  proposalTimestamp: number;
  
  // Timestamp when voting closes
  votingCloseTimestamp: number;
  
  // Status of the proposal
  status: 'pending' | 'passed' | 'rejected' | 'canceled';
}

/**
 * Vote cast by an agent
 */
export interface EvoVote {
  // Vote ID
  voteId: string;
  
  // Proposal ID being voted on
  proposalId: string;
  
  // Agent casting the vote
  voterAgentId: string;
  
  // The vote: true = approve, false = reject
  approve: boolean;
  
  // Optional reason for the vote
  reason?: string;
  
  // Trust score of voting agent (for weighting)
  trustScore: number;
  
  // Timestamp when vote was cast
  voteTimestamp: number;
}

/**
 * Tally of votes on a proposal
 */
export interface VoteTally {
  // Proposal ID
  proposalId: string;
  
  // Count of approve votes
  approveCount: number;
  
  // Count of reject votes
  rejectCount: number;
  
  // Weighted sum of approve votes
  weightedApprove: number;
  
  // Weighted sum of reject votes
  weightedReject: number;
  
  // Total count of votes
  totalVotes: number;
  
  // Total voting power cast
  totalVotingPower: number;
  
  // Whether quorum has been reached
  quorumReached: boolean;
  
  // Whether consensus has been reached
  consensusReached: boolean;
  
  // Whether proposal has passed
  passed: boolean;
}

/**
 * Vote result
 */
export interface VoteResult {
  // Status of the vote
  status: 'pending' | 'passed' | 'rejected';
  
  // Reason for the status
  reason: string;
  
  // Proposal ID
  proposalId: string;
  
  // Vote tally (if available)
  tally?: VoteTally;
}

/**
 * Voting system configuration
 */
export interface EvoVotingConfig {
  // Minimum number of votes required for quorum
  minVotesForQuorum: number;
  
  // Minimum percentage of total trust weight required for quorum
  minQuorumPct: number;
  
  // Minimum percentage of weighted votes needed to pass (of those cast)
  minConsensusThresholdPct: number;
  
  // Voting duration in milliseconds
  votingDurationMs: number;
}

/**
 * Default voting system configuration
 */
const DEFAULT_VOTING_CONFIG: EvoVotingConfig = {
  minVotesForQuorum: 3,
  minQuorumPct: 0.30,     // 30% of total trust weight
  minConsensusThresholdPct: 0.67, // 67% of cast votes
  votingDurationMs: 12 * 60 * 60 * 1000 // 12 hours
};

/**
 * Evolution Voting System
 * 
 * Enables agents to vote on mutation promotions and other evolution decisions
 * with votes weighted by trust scores.
 */
export class EvoVotingSystem {
  private redis: RedisClient;
  private agentRegistry: AgentRegistry;
  private trustScoreEngine: TrustScoreEngine;
  private config: EvoVotingConfig;
  private proposals: Map<string, EvoVoteProposal> = new Map();
  private votes: Map<string, EvoVote[]> = new Map();
  
  /**
   * Create a new evolution voting system
   * @param redis Redis client for persistence
   * @param agentRegistry Agent registry for accessing agents
   * @param trustScoreEngine Trust score engine for vote weighting
   * @param config Voting system configuration
   */
  constructor(
    redis: RedisClient,
    agentRegistry: AgentRegistry,
    trustScoreEngine: TrustScoreEngine,
    config: Partial<EvoVotingConfig> = {}
  ) {
    this.redis = redis;
    this.agentRegistry = agentRegistry;
    this.trustScoreEngine = trustScoreEngine;
    this.config = { ...DEFAULT_VOTING_CONFIG, ...config };
  }
  
  /**
   * Initialize the voting system
   */
  public async initialize(): Promise<void> {
    // Load active proposals and votes from Redis
    await Promise.all([
      this.loadProposalsFromRedis(),
      this.loadVotesFromRedis()
    ]);
    
    logger.info(`Initialized evolution voting system with ${this.proposals.size} active proposals`);
    
    // Check if any proposals need to be closed due to time
    await this.checkExpiredProposals();
  }
  
  /**
   * Submit a mutation for vote
   * @param agentId Agent ID being mutated
   * @param mutationId Mutation ID
   * @param mutationName Name of the mutation
   * @param fitnessGainPct Fitness gain percentage
   * @returns Vote result status
   */
  public async submitMutationForVote(
    agentId: string,
    mutationId: string,
    mutationName: string,
    fitnessGainPct: number
  ): Promise<VoteResult> {
    // Check if this mutation is already up for vote
    for (const proposal of this.proposals.values()) {
      if (
        proposal.status === 'pending' &&
        proposal.type === EvoVoteType.MUTATION_PROMOTE &&
        proposal.mutationId === mutationId &&
        proposal.targetAgentId === agentId
      ) {
        // Already being voted on, return current status
        const tally = await this.tallyVotes(proposal.proposalId);
        
        return {
          status: 'pending',
          reason: 'Voting in progress',
          proposalId: proposal.proposalId,
          tally
        };
      }
    }
    
    // Create a new proposal
    const proposalId = `proposal:${Date.now()}:${Math.floor(Math.random() * 10000)}`;
    
    const proposal: EvoVoteProposal = {
      proposalId,
      type: EvoVoteType.MUTATION_PROMOTE,
      mutationId,
      targetAgentId: agentId,
      summary: `Switch to ${mutationName} strategy for agent ${agentId}`,
      metadata: {
        fitnessGain: fitnessGainPct,
        mutationName
      },
      proposerAgentId: agentId, // Self-proposed
      proposalTimestamp: Date.now(),
      votingCloseTimestamp: Date.now() + this.config.votingDurationMs,
      status: 'pending'
    };
    
    // Store and publish
    this.proposals.set(proposalId, proposal);
    await this.saveProposalToRedis(proposal);
    await this.publishProposal(proposal);
    
    logger.info(`Submitted mutation ${mutationId} for agent ${agentId} to evolution vote`, {
      proposalId,
      fitnessGain: fitnessGainPct
    });
    
    return {
      status: 'pending',
      reason: 'Voting started',
      proposalId
    };
  }
  
  /**
   * Cast a vote on a proposal
   * @param proposalId Proposal ID to vote on
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
    // Check if proposal exists
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      return { success: false, message: `Proposal ${proposalId} not found` };
    }
    
    // Check if proposal is still open for voting
    if (proposal.status !== 'pending') {
      return { success: false, message: `Proposal ${proposalId} is not open for voting` };
    }
    
    if (proposal.votingCloseTimestamp < Date.now()) {
      return { success: false, message: `Voting has closed for proposal ${proposalId}` };
    }
    
    // Check if agent has already voted
    const existingVotes = this.votes.get(proposalId) || [];
    const existingVote = existingVotes.find(v => v.voterAgentId === voterAgentId);
    
    if (existingVote) {
      return { success: false, message: `Agent ${voterAgentId} has already voted on this proposal` };
    }
    
    // Get agent's trust score for weighting
    const trustScore = await this.getTrustScore(voterAgentId);
    
    // Create vote
    const voteId = `vote:${Date.now()}:${Math.floor(Math.random() * 10000)}`;
    
    const vote: EvoVote = {
      voteId,
      proposalId,
      voterAgentId,
      approve,
      reason,
      trustScore,
      voteTimestamp: Date.now()
    };
    
    // Store vote
    if (!this.votes.has(proposalId)) {
      this.votes.set(proposalId, []);
    }
    
    this.votes.get(proposalId)!.push(vote);
    
    // Save to Redis
    await this.saveVoteToRedis(vote);
    
    // Publish vote event
    await this.publishVote(vote);
    
    logger.info(`Agent ${voterAgentId} voted ${approve ? 'YES' : 'NO'} on proposal ${proposalId}`, {
      trustScore,
      reason
    });
    
    // Check if vote has reached quorum and consensus
    const tally = await this.tallyVotes(proposalId);
    
    if (tally.quorumReached && tally.consensusReached) {
      // Update proposal status
      await this.finalizeProposal(proposalId, tally.passed);
    }
    
    return { 
      success: true, 
      message: `Vote cast successfully. Proposal ${tally.quorumReached ? 'has' : 'has not'} reached quorum.` 
    };
  }
  
  /**
   * Get the status of a proposal
   * @param proposalId Proposal ID
   * @returns Vote result with status
   */
  public async getProposalStatus(proposalId: string): Promise<VoteResult> {
    // Check if proposal exists
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      return { 
        status: 'rejected', 
        reason: `Proposal ${proposalId} not found`,
        proposalId
      };
    }
    
    // If already finalized, return status
    if (proposal.status === 'passed') {
      return { 
        status: 'passed', 
        reason: 'Proposal approved by vote',
        proposalId
      };
    }
    
    if (proposal.status === 'rejected') {
      return { 
        status: 'rejected', 
        reason: 'Proposal rejected by vote',
        proposalId
      };
    }
    
    // Calculate current vote tally
    const tally = await this.tallyVotes(proposalId);
    
    // Check if voting has closed due to time
    if (proposal.votingCloseTimestamp < Date.now()) {
      // Finalize the proposal
      await this.finalizeProposal(proposalId, tally.passed);
      
      return { 
        status: tally.passed ? 'passed' : 'rejected',
        reason: `Voting period has ended. Proposal ${tally.passed ? 'passed' : 'rejected'}.`,
        proposalId,
        tally
      };
    }
    
    // Still pending
    return { 
      status: 'pending',
      reason: 'Voting in progress',
      proposalId,
      tally
    };
  }
  
  /**
   * Get all active proposals
   * @returns Map of proposal ID to proposal
   */
  public getActiveProposals(): Map<string, EvoVoteProposal> {
    const activeProposals = new Map<string, EvoVoteProposal>();
    
    for (const [id, proposal] of this.proposals) {
      if (proposal.status === 'pending') {
        activeProposals.set(id, proposal);
      }
    }
    
    return activeProposals;
  }
  
  /**
   * Get votes for a specific proposal
   * @param proposalId Proposal ID
   * @returns Array of votes
   */
  public getVotesForProposal(proposalId: string): EvoVote[] {
    return this.votes.get(proposalId) || [];
  }
  
  /**
   * Tally votes for a proposal
   * @param proposalId Proposal ID
   * @returns Vote tally result
   */
  public async tallyVotes(proposalId: string): Promise<VoteTally> {
    const votes = this.votes.get(proposalId) || [];
    
    let approveCount = 0;
    let rejectCount = 0;
    let weightedApprove = 0;
    let weightedReject = 0;
    let totalVotingPower = 0;
    
    // Count votes
    for (const vote of votes) {
      if (vote.approve) {
        approveCount++;
        weightedApprove += vote.trustScore;
      } else {
        rejectCount++;
        weightedReject += vote.trustScore;
      }
    }
    
    const totalVotes = approveCount + rejectCount;
    const weightedTotal = weightedApprove + weightedReject;
    
    // Calculate total potential voting power (sum of all agent trust scores)
    totalVotingPower = await this.getTotalVotingPower();
    
    // Check quorum requirements
    const quorumReached = 
      totalVotes >= this.config.minVotesForQuorum && 
      (weightedTotal / totalVotingPower) >= this.config.minQuorumPct;
    
    // Check consensus threshold
    const consensusReached = 
      quorumReached && 
      (totalVotes > 0) && 
      ((weightedApprove / weightedTotal) >= this.config.minConsensusThresholdPct ||
       (weightedReject / weightedTotal) >= this.config.minConsensusThresholdPct);
    
    // Determine if passed
    const passed = quorumReached && consensusReached && (weightedApprove > weightedReject);
    
    return {
      proposalId,
      approveCount,
      rejectCount,
      weightedApprove,
      weightedReject,
      totalVotes,
      totalVotingPower,
      quorumReached,
      consensusReached,
      passed
    };
  }
  
  /**
   * Check for and handle expired proposals
   */
  public async checkExpiredProposals(): Promise<void> {
    const now = Date.now();
    
    for (const [proposalId, proposal] of this.proposals) {
      if (proposal.status === 'pending' && proposal.votingCloseTimestamp < now) {
        logger.info(`Closing expired proposal ${proposalId}`);
        
        // Tally votes
        const tally = await this.tallyVotes(proposalId);
        
        // Finalize proposal
        await this.finalizeProposal(proposalId, tally.passed);
      }
    }
  }
  
  /**
   * Finalize a proposal by updating its status
   * @param proposalId Proposal ID
   * @param passed Whether the proposal passed
   */
  private async finalizeProposal(proposalId: string, passed: boolean): Promise<void> {
    // Check if proposal exists
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'pending') {
      return;
    }
    
    // Update status
    proposal.status = passed ? 'passed' : 'rejected';
    
    // Save to Redis
    await this.saveProposalToRedis(proposal);
    
    // Publish result
    await this.publishProposalResult(proposal);
    
    logger.info(`Finalized proposal ${proposalId}: ${proposal.status}`, {
      type: proposal.type,
      mutationId: proposal.mutationId,
      targetAgentId: proposal.targetAgentId
    });
  }
  
  /**
   * Get the trust score for an agent
   * @param agentId Agent ID
   * @returns Trust score (0-1)
   */
  private async getTrustScore(agentId: string): Promise<number> {
    try {
      // In a production system, this would query the trust score engine
      const trustScore = await this.trustScoreEngine.getTrustScore(agentId);
      return trustScore;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get trust score for agent ${agentId}`, { error });
      return 0.5; // Default mid-level trust score
    }
  }
  
  /**
   * Get the total voting power (sum of all agent trust scores)
   * @returns Total voting power
   */
  private async getTotalVotingPower(): Promise<number> {
    try {
      // In a production system, this would sum all agent trust scores
      
      // Get all agent registrations
      const registrations = this.agentRegistry.getAllRegistrations();
      
      let totalPower = 0;
      
      // Sum trust scores of all active agents
      for (const [agentId, registration] of registrations) {
        if (registration.enabled) {
          const trustScore = await this.getTrustScore(agentId);
          totalPower += trustScore;
        }
      }
      
      return totalPower || 1; // Avoid division by zero
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to calculate total voting power', { error });
      return 1; // Default fallback
    }
  }
  
  /**
   * Load proposals from Redis
   */
  private async loadProposalsFromRedis(): Promise<void> {
    try {
      const keys = await this.redis.keys('evolution:proposal:*');
      
      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const proposal = JSON.parse(data) as EvoVoteProposal;
          this.proposals.set(proposal.proposalId, proposal);
        }
      }
      
      logger.debug(`Loaded ${this.proposals.size} proposals from Redis`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to load proposals from Redis', { error });
    }
  }
  
  /**
   * Load votes from Redis
   */
  private async loadVotesFromRedis(): Promise<void> {
    try {
      // Get all proposal IDs
      const proposalIds = Array.from(this.proposals.keys());
      
      for (const proposalId of proposalIds) {
        const voteKeys = await this.redis.keys(`evolution:vote:${proposalId}:*`);
        
        for (const key of voteKeys) {
          const data = await this.redis.get(key);
          if (data) {
            const vote = JSON.parse(data) as EvoVote;
            
            if (!this.votes.has(vote.proposalId)) {
              this.votes.set(vote.proposalId, []);
            }
            
            this.votes.get(vote.proposalId)!.push(vote);
          }
        }
      }
      
      const voteCount = Array.from(this.votes.values()).reduce((acc, votes) => acc + votes.length, 0);
      logger.debug(`Loaded ${voteCount} votes from Redis`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to load votes from Redis', { error });
    }
  }
  
  /**
   * Save proposal to Redis
   * @param proposal Proposal to save
   */
  private async saveProposalToRedis(proposal: EvoVoteProposal): Promise<void> {
    try {
      const key = `evolution:proposal:${proposal.proposalId}`;
      await this.redis.set(key, JSON.stringify(proposal));
      
      // Also store in ledger for auditing
      await this.redis.lpush('ledger:evolution-votes', JSON.stringify({
        type: 'proposal',
        proposal,
        timestamp: Date.now()
      }));
      
      // Trim ledger to reasonable size
      await this.redis.ltrim('ledger:evolution-votes', 0, 999);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to save proposal ${proposal.proposalId}`, { error });
    }
  }
  
  /**
   * Save vote to Redis
   * @param vote Vote to save
   */
  private async saveVoteToRedis(vote: EvoVote): Promise<void> {
    try {
      const key = `evolution:vote:${vote.proposalId}:${vote.voteId}`;
      await this.redis.set(key, JSON.stringify(vote));
      
      // Also store in ledger for auditing
      await this.redis.lpush('ledger:evolution-votes', JSON.stringify({
        type: 'vote',
        vote,
        timestamp: Date.now()
      }));
      
      // Trim ledger to reasonable size
      await this.redis.ltrim('ledger:evolution-votes', 0, 999);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to save vote ${vote.voteId}`, { error });
    }
  }
  
  /**
   * Publish a new proposal to Redis channel
   * @param proposal Proposal to publish
   */
  private async publishProposal(proposal: EvoVoteProposal): Promise<void> {
    try {
      await this.redis.publish('pubsub:evolution:proposal', JSON.stringify(proposal));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to publish proposal ${proposal.proposalId}`, { error });
    }
  }
  
  /**
   * Publish a vote to Redis channel
   * @param vote Vote to publish
   */
  private async publishVote(vote: EvoVote): Promise<void> {
    try {
      await this.redis.publish('pubsub:evolution:vote', JSON.stringify(vote));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to publish vote ${vote.voteId}`, { error });
    }
  }
  
  /**
   * Publish proposal result to Redis channel
   * @param proposal Finalized proposal
   */
  private async publishProposalResult(proposal: EvoVoteProposal): Promise<void> {
    try {
      await this.redis.publish('pubsub:evolution:proposal-result', JSON.stringify(proposal));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to publish proposal result ${proposal.proposalId}`, { error });
    }
  }
} 