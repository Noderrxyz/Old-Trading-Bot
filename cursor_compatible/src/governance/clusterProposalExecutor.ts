/**
 * Cluster Proposal Executor
 * 
 * Handles proposal execution within a governance cluster,
 * applying cluster-specific quorum rules and decision protocols.
 */

import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../common/logger.js';
import { VoteRecord } from '../../types/governance/provenance.types.js';
import { verifyVoteSignature } from './votes.js';
import { GovernanceCluster } from '../../types/governance/cluster.types.js';

// Logger for proposal execution
const logger = createLogger('ClusterProposalExecutor');

// Types for proposal handling
export interface ProposalVote {
  agentDid: string;
  vote: 'yes' | 'no' | 'abstain';
  signature: string;
  timestamp: number;
  weight: number;
}

export interface ProposalExecutionContext {
  clusterId: string;
  proposalType: string;
}

export interface ProposalHandler {
  execute: (proposalData: Record<string, any>, votes: ProposalVote[]) => Promise<void>;
}

export class ClusterProposalExecutor {
  private redis: Redis.Redis;
  private clusterId: string;
  private decisionProtocol: GovernanceCluster['decisionProtocol'];
  private quorumThreshold: number;
  private executionDelay: number;
  private context: ProposalExecutionContext | null = null;
  private handlers: Map<string, ProposalHandler> = new Map();
  
  constructor(
    redis: Redis.Redis,
    clusterId: string,
    decisionProtocol: GovernanceCluster['decisionProtocol'],
    quorumThreshold: number,
    executionDelay: number
  ) {
    this.redis = redis;
    this.clusterId = clusterId;
    this.decisionProtocol = decisionProtocol;
    this.quorumThreshold = quorumThreshold;
    this.executionDelay = executionDelay;
  }
  
  /**
   * Set context for proposal handling
   * 
   * @param context Proposal execution context
   */
  setContext(context: ProposalExecutionContext): void {
    this.context = context;
  }
  
  /**
   * Register a handler for a specific proposal type
   * 
   * @param proposalType Type of proposal to handle
   * @param handler Handler for the proposal type
   */
  registerHandler(proposalType: string, handler: ProposalHandler): void {
    this.handlers.set(proposalType, handler);
    logger.info(`Registered handler for ${proposalType} proposals in cluster ${this.clusterId}`);
  }
  
  /**
   * Submit a new proposal to the cluster
   * 
   * @param proposalType Type of proposal
   * @param proposalData Proposal data
   * @returns Proposal ID
   */
  async submitProposal(
    proposalType: string,
    proposalData: Record<string, any>
  ): Promise<string> {
    const proposalId = `proposal:${uuidv4()}`;
    const now = Date.now();
    
    // Create proposal record
    const proposal = {
      id: proposalId,
      type: proposalType,
      clusterId: this.clusterId,
      data: proposalData,
      createdAt: now,
      status: 'active',
      votes: [],
      executedAt: null
    };
    
    // Store proposal
    await this.redis.set(
      `governance:proposals:${proposalId}`,
      JSON.stringify(proposal)
    );
    
    // Add to cluster's active proposals
    await this.redis.sadd(
      `governance:clusters:${this.clusterId}:proposals`,
      proposalId
    );
    
    // Set expiration for automatic execution
    const executionTime = now + this.executionDelay;
    await this.redis.zadd(
      'governance:proposals:execution-queue',
      executionTime,
      proposalId
    );
    
    logger.info(`Submitted proposal ${proposalId} to cluster ${this.clusterId}`);
    return proposalId;
  }
  
  /**
   * Vote on a proposal in the cluster
   * 
   * @param proposalId Proposal ID
   * @param vote Vote data
   */
  async vote(proposalId: string, vote: ProposalVote): Promise<void> {
    // Get proposal
    const proposalData = await this.redis.get(`governance:proposals:${proposalId}`);
    if (!proposalData) {
      throw new Error(`Proposal ${proposalId} not found`);
    }
    
    const proposal = JSON.parse(proposalData);
    
    // Check if proposal is active
    if (proposal.status !== 'active') {
      throw new Error(`Cannot vote on ${proposal.status} proposal ${proposalId}`);
    }
    
    // Verify vote signature
    const voteRecord: VoteRecord = {
      agentDid: vote.agentDid,
      signature: vote.signature,
      vote: vote.vote,
      role: 'validator', // This will be set from agent data
      weight: vote.weight,
      timestamp: vote.timestamp
    };
    
    const signatureValid = verifyVoteSignature(voteRecord);
    if (!signatureValid) {
      throw new Error(`Invalid vote signature from ${vote.agentDid}`);
    }
    
    // Check if agent has already voted
    const existingVoteIndex = proposal.votes.findIndex(
      (v: ProposalVote) => v.agentDid === vote.agentDid
    );
    
    if (existingVoteIndex >= 0) {
      // Update existing vote
      proposal.votes[existingVoteIndex] = vote;
    } else {
      // Add new vote
      proposal.votes.push(vote);
    }
    
    // Update proposal
    await this.redis.set(
      `governance:proposals:${proposalId}`,
      JSON.stringify(proposal)
    );
    
    // Check if quorum is reached
    const quorumReached = this.checkQuorum(proposal.votes);
    if (quorumReached) {
      logger.info(`Quorum reached for proposal ${proposalId}`);
      
      // If execution delay is 0, execute immediately
      if (this.executionDelay === 0) {
        await this.executeProposal(proposalId);
      }
    }
  }
  
  /**
   * Check if quorum is reached for a proposal
   * 
   * @param votes Votes cast on the proposal
   * @returns Whether quorum is reached
   */
  private checkQuorum(votes: ProposalVote[]): boolean {
    if (votes.length === 0) {
      return false;
    }
    
    // Filter out abstentions
    const activeVotes = votes.filter(v => v.vote !== 'abstain');
    if (activeVotes.length === 0) {
      return false;
    }
    
    // Calculate total weight
    const totalWeight = activeVotes.reduce((sum, vote) => sum + vote.weight, 0);
    
    // For reputation-weighted, calculate the expected total weight
    // This requires additional context from the cluster about total reputation
    let expectedWeight = 100; // Default value
    
    // Calculate positive weight ratio
    const positiveWeight = activeVotes
      .filter(v => v.vote === 'yes')
      .reduce((sum, vote) => sum + vote.weight, 0);
    
    const approvalPercentage = (positiveWeight / totalWeight) * 100;
    
    return approvalPercentage >= this.quorumThreshold;
  }
  
  /**
   * Execute a proposal that has reached quorum
   * 
   * @param proposalId Proposal ID
   */
  async executeProposal(proposalId: string): Promise<void> {
    // Get proposal
    const proposalData = await this.redis.get(`governance:proposals:${proposalId}`);
    if (!proposalData) {
      throw new Error(`Proposal ${proposalId} not found for execution`);
    }
    
    const proposal = JSON.parse(proposalData);
    
    // Check if already executed
    if (proposal.status === 'executed') {
      logger.info(`Proposal ${proposalId} already executed`);
      return;
    }
    
    // Check if quorum is reached
    const quorumReached = this.checkQuorum(proposal.votes);
    if (!quorumReached) {
      logger.warn(`Cannot execute proposal ${proposalId} - quorum not reached`);
      
      // Update status to failed
      proposal.status = 'failed';
      proposal.executedAt = Date.now();
      
      await this.redis.set(
        `governance:proposals:${proposalId}`,
        JSON.stringify(proposal)
      );
      
      return;
    }
    
    // Get the appropriate handler
    const handler = this.handlers.get(proposal.type);
    if (!handler) {
      logger.error(`No handler registered for proposal type ${proposal.type}`);
      
      // Update status to failed
      proposal.status = 'failed';
      proposal.executedAt = Date.now();
      
      await this.redis.set(
        `governance:proposals:${proposalId}`,
        JSON.stringify(proposal)
      );
      
      return;
    }
    
    try {
      // Execute the proposal
      await handler.execute(proposal.data, proposal.votes);
      
      // Update status
      proposal.status = 'executed';
      proposal.executedAt = Date.now();
      
      // Update proposal
      await this.redis.set(
        `governance:proposals:${proposalId}`,
        JSON.stringify(proposal)
      );
      
      // Remove from active proposals
      await this.redis.srem(
        `governance:clusters:${this.clusterId}:proposals`,
        proposalId
      );
      
      // Remove from execution queue
      await this.redis.zrem(
        'governance:proposals:execution-queue',
        proposalId
      );
      
      logger.info(`Successfully executed proposal ${proposalId}`);
    } catch (error) {
      logger.error(`Failed to execute proposal ${proposalId}: ${error}`);
      
      // Update status to failed
      proposal.status = 'failed';
      proposal.executedAt = Date.now();
      proposal.error = String(error);
      
      await this.redis.set(
        `governance:proposals:${proposalId}`,
        JSON.stringify(proposal)
      );
    }
  }
  
  /**
   * Process the execution queue for proposals ready to execute
   */
  async processExecutionQueue(): Promise<void> {
    const now = Date.now();
    
    // Get proposals ready for execution
    const readyProposals = await this.redis.zrangebyscore(
      'governance:proposals:execution-queue',
      0,
      now
    );
    
    if (readyProposals.length === 0) {
      return;
    }
    
    logger.info(`Processing ${readyProposals.length} proposals ready for execution`);
    
    // Execute each proposal
    for (const proposalId of readyProposals) {
      try {
        await this.executeProposal(proposalId);
      } catch (error) {
        logger.error(`Error processing proposal ${proposalId}: ${error}`);
      }
    }
  }
} 