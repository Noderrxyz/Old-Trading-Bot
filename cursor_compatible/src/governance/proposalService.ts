/**
 * Governance Proposal Service
 * 
 * Handles the creation, management, and voting on governance proposals
 */

import { createLogger } from '../common/logger.js';
import { RedisClient } from '../common/redis.js';
import { 
  castVote, 
  getVoteStatus, 
  VoteOption, 
  VoteSummary,
  hasRequiredRole,
  computeWeightedScore
} from './voteWeighting.js';
import { resolveConflict } from './arbitrationEngine.js';
import { getShadowCabinetEngine } from './shadow/index.js';

const logger = createLogger('ProposalService');

// Generate a UUID v4
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Types of proposals
export enum ProposalType {
  STRATEGY_APPROVAL = 'strategy_approval',
  PARAMETER_CHANGE = 'parameter_change',
  AGENT_ROLE_CHANGE = 'agent_role_change',
  SYSTEM_UPGRADE = 'system_upgrade',
  EMERGENCY_ACTION = 'emergency_action'
}

// Proposal interface
export interface Proposal {
  id: string;
  title: string;
  description: string;
  type: ProposalType;
  data: Record<string, any>;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  status: 'open' | 'approved' | 'rejected' | 'expired';
  requiredQuorum: number;
  requiredApprovalThreshold: number;
}

export class ProposalService {
  private redisClient: RedisClient;
  private shadowEnabled: boolean = false;
  
  constructor(redisClient: RedisClient) {
    this.redisClient = redisClient;
  }
  
  /**
   * Enable or disable shadow cabinet functionality
   */
  public enableShadowCabinet(enabled: boolean = true): void {
    this.shadowEnabled = enabled;
    logger.info(`Shadow cabinet functionality ${enabled ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Create a new proposal
   * 
   * @param agentId Agent ID creating the proposal
   * @param title Proposal title
   * @param description Proposal description
   * @param type Type of proposal
   * @param data Proposal data
   * @param options Optional settings
   * @returns The created proposal
   */
  async createProposal(
    agentId: string,
    title: string,
    description: string,
    type: ProposalType,
    data: Record<string, any>,
    options: {
      expiryHours?: number;
      requiredQuorum?: number;
      requiredApprovalThreshold?: number;
    } = {}
  ): Promise<Proposal> {
    // Check if agent has required role to create this type of proposal
    const canPropose = await this.canCreateProposal(agentId, type);
    if (!canPropose) {
      throw new Error(`Agent ${agentId} does not have sufficient role/trust to create ${type} proposals`);
    }
    
    // Generate proposal ID
    const proposalId = generateUUID();
    
    // Set default values
    const expiryHours = options.expiryHours || 48; // Default 48-hour voting period
    const requiredQuorum = options.requiredQuorum || 2.5; // Default quorum
    const requiredApprovalThreshold = options.requiredApprovalThreshold || 2.0; // Default approval threshold
    
    // Create proposal object
    const proposal: Proposal = {
      id: proposalId,
      title,
      description,
      type,
      data,
      createdBy: agentId,
      createdAt: Date.now(),
      expiresAt: Date.now() + (expiryHours * 60 * 60 * 1000),
      status: 'open',
      requiredQuorum,
      requiredApprovalThreshold
    };
    
    // Store proposal in Redis
    await this.redisClient.set(
      `governance:proposal:${proposalId}`,
      JSON.stringify(proposal)
    );
    
    // Add to active proposals list using rpush instead of lpush
    await this.redisClient.rpush(
      'governance:active_proposals',
      proposalId
    );
    
    // Also add to proposal type list
    await this.redisClient.rpush(
      `governance:proposals:${type}`,
      proposalId
    );
    
    // Automatically cast a 'yes' vote from the creator
    await castVote(
      this.redisClient,
      agentId,
      proposalId,
      'yes'
    );
    
    logger.info(`Proposal ${proposalId} created by agent ${agentId}: ${title}`);
    
    // After creating the proposal, notify the shadow cabinet system if enabled
    if (this.shadowEnabled) {
      try {
        const shadowEngine = getShadowCabinetEngine();
        shadowEngine.emit('proposal:created', proposalId);
        logger.info(`Shadow cabinet notified of new proposal ${proposalId}`);
      } catch (error) {
        // Don't fail if shadow cabinet system is not initialized
        logger.warn(`Failed to notify shadow cabinet system: ${error}`);
      }
    }
    
    return proposal;
  }
  
  /**
   * Check if an agent can create a proposal of a specific type
   * 
   * @param agentId Agent ID
   * @param type Proposal type
   * @returns Boolean indicating if agent can create this type of proposal
   */
  async canCreateProposal(
    agentId: string,
    type: ProposalType
  ): Promise<boolean> {
    // Get agent's role
    const role = await this.redisClient.get(`agent:${agentId}:role`);
    
    // Different proposal types have different role requirements
    switch (type) {
      case ProposalType.STRATEGY_APPROVAL:
        // Any agent can propose strategies, no special role needed
        return true;
        
      case ProposalType.PARAMETER_CHANGE:
        // Need at least auditor role for parameter changes
        return await hasRequiredRole(this.redisClient, agentId, 'auditor');
        
      case ProposalType.AGENT_ROLE_CHANGE:
        // Need at least watcher role to propose agent role changes
        return await hasRequiredRole(this.redisClient, agentId, 'watcher');
        
      case ProposalType.SYSTEM_UPGRADE:
        // Need at least watcher role for system upgrades
        return await hasRequiredRole(this.redisClient, agentId, 'watcher');
        
      case ProposalType.EMERGENCY_ACTION:
        // Only leader can propose emergency actions
        return await hasRequiredRole(this.redisClient, agentId, 'leader');
        
      default:
        // For unrecognized types, require at least auditor
        return await hasRequiredRole(this.redisClient, agentId, 'auditor');
    }
  }
  
  /**
   * Vote on a proposal
   * 
   * @param agentId Agent ID voting
   * @param proposalId Proposal ID
   * @param vote Vote option
   * @returns Vote summary after the vote is cast
   */
  async vote(
    agentId: string,
    proposalId: string,
    vote: VoteOption
  ): Promise<VoteSummary> {
    // Check if proposal exists and is open
    const proposal = await this.getProposal(proposalId);
    
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} does not exist`);
    }
    
    if (proposal.status !== 'open') {
      throw new Error(`Proposal ${proposalId} is not open for voting (status: ${proposal.status})`);
    }
    
    if (Date.now() > proposal.expiresAt) {
      // Automatically expire the proposal
      await this.expireProposal(proposalId);
      throw new Error(`Proposal ${proposalId} has expired`);
    }
    
    // Cast the vote
    await castVote(this.redisClient, agentId, proposalId, vote);
    
    // Get updated vote status
    const voteStatus = await getVoteStatus(this.redisClient, proposalId);
    
    if (voteStatus) {
      // Check if proposal can be immediately approved or rejected
      await this.checkProposalStatus(proposalId, voteStatus);
      return voteStatus;
    } else {
      throw new Error(`Failed to get vote status for proposal ${proposalId}`);
    }
  }
  
  /**
   * Check if a proposal should be approved, rejected, or left open
   * 
   * @param proposalId Proposal ID
   * @param status Vote summary (optional, will be fetched if not provided)
   * @returns Updated proposal
   */
  async checkProposalStatus(
    proposalId: string,
    status?: VoteSummary
  ): Promise<Proposal> {
    // Get proposal
    const proposal = await this.getProposal(proposalId);
    
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} does not exist`);
    }
    
    // If proposal is not open, no need to check
    if (proposal.status !== 'open') {
      return proposal;
    }
    
    // Get vote status if not provided
    if (!status) {
      const voteStatus = await getVoteStatus(this.redisClient, proposalId);
      if (!voteStatus) {
        return proposal; // No votes yet
      }
      status = voteStatus;
    }
    
    // Check if proposal has expired
    if (Date.now() > proposal.expiresAt) {
      return this.expireProposal(proposalId);
    }
    
    // Check if quorum is reached
    if (status.quorumReached) {
      // Check if proposal is clearly approved or rejected
      if (status.yesScore >= proposal.requiredApprovalThreshold) {
        return this.approveProposal(proposalId);
      } else if (status.noScore >= proposal.requiredApprovalThreshold) {
        return this.rejectProposal(proposalId);
      } else {
        // If the decision is not clear (close vote), use arbitration
        const closeVoteThreshold = 1.0; // Define what constitutes a "close" vote
        const scoreDifference = Math.abs(status.yesScore - status.noScore);
        
        if (scoreDifference <= closeVoteThreshold) {
          logger.info(`Close vote detected for proposal ${proposalId}, using arbitration to resolve`);
          
          // Use arbitration to resolve the conflict
          const arbitrationResult = await resolveConflict(this.redisClient, proposalId);
          
          if (arbitrationResult) {
            const winningOption = arbitrationResult.winning_option;
            
            logger.info(`Arbitration result for proposal ${proposalId}: ${winningOption}`, {
              reason: arbitrationResult.reason,
              score: arbitrationResult.total_trust
            });
            
            // Apply the arbitration result
            if (winningOption === 'yes') {
              return this.approveProposal(proposalId);
            } else if (winningOption === 'no') {
              return this.rejectProposal(proposalId);
            }
            // If winningOption is 'abstain', we keep the proposal open
          }
        }
      }
    }
    
    // If we reach here, proposal remains open
    return proposal;
  }
  
  /**
   * Get a proposal by ID
   * 
   * @param proposalId Proposal ID
   * @returns Proposal or null if not found
   */
  async getProposal(proposalId: string): Promise<Proposal | null> {
    const data = await this.redisClient.get(`governance:proposal:${proposalId}`);
    
    if (!data) {
      return null;
    }
    
    return JSON.parse(data);
  }
  
  /**
   * Get active proposals
   * 
   * @param limit Number of proposals to return
   * @param offset Offset for pagination
   * @returns Array of active proposals
   */
  async getActiveProposals(
    limit: number = 20,
    offset: number = 0
  ): Promise<Proposal[]> {
    const proposalIds = await this.redisClient.lrange(
      'governance:active_proposals',
      offset,
      offset + limit - 1
    );
    
    const proposals: Proposal[] = [];
    
    for (const id of proposalIds) {
      const proposal = await this.getProposal(id);
      if (proposal) {
        proposals.push(proposal);
      }
    }
    
    return proposals;
  }
  
  /**
   * Get proposals by type
   * 
   * @param type Proposal type
   * @param limit Number of proposals to return
   * @param offset Offset for pagination
   * @returns Array of proposals of the specified type
   */
  async getProposalsByType(
    type: ProposalType,
    limit: number = 20,
    offset: number = 0
  ): Promise<Proposal[]> {
    const proposalIds = await this.redisClient.lrange(
      `governance:proposals:${type}`,
      offset,
      offset + limit - 1
    );
    
    const proposals: Proposal[] = [];
    
    for (const id of proposalIds) {
      const proposal = await this.getProposal(id);
      if (proposal) {
        proposals.push(proposal);
      }
    }
    
    return proposals;
  }
  
  /**
   * Approve a proposal
   * 
   * @param proposalId Proposal ID
   * @returns Updated proposal
   */
  private async approveProposal(proposalId: string): Promise<Proposal> {
    const proposal = await this.getProposal(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }
    
    proposal.status = 'approved';
    
    // Update in Redis
    await this.redisClient.set(
      `governance:proposal:${proposalId}`,
      JSON.stringify(proposal)
    );
    
    // Remove from active proposals list
    await this.removeFromList('governance:active_proposals', proposalId);
    
    // Execute the proposal
    await this.executeProposal(proposal);
    
    // Notify shadow cabinet of proposal completion
    if (this.shadowEnabled) {
      try {
        const shadowEngine = getShadowCabinetEngine();
        shadowEngine.emit('proposal:completed', proposalId);
      } catch (error) {
        logger.warn(`Failed to notify shadow cabinet of completion: ${error}`);
      }
    }
    
    logger.info(`Proposal ${proposalId} approved and executed`);
    
    return proposal;
  }
  
  /**
   * Reject a proposal
   * 
   * @param proposalId Proposal ID
   * @returns Updated proposal
   */
  private async rejectProposal(proposalId: string): Promise<Proposal> {
    // Get proposal
    const proposal = await this.getProposal(proposalId);
    
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} does not exist`);
    }
    
    // Update proposal status
    proposal.status = 'rejected';
    
    // Save updated proposal
    await this.redisClient.set(
      `governance:proposal:${proposalId}`,
      JSON.stringify(proposal)
    );
    
    // Remove from active proposals list
    await this.removeFromList('governance:active_proposals', proposalId);
    
    // Add to rejected proposals list
    await this.redisClient.rpush('governance:rejected_proposals', proposalId);
    
    logger.info(`Proposal ${proposalId} rejected: ${proposal.title}`);
    
    return proposal;
  }
  
  /**
   * Expire a proposal
   * 
   * @param proposalId Proposal ID
   * @returns Updated proposal
   */
  private async expireProposal(proposalId: string): Promise<Proposal> {
    // Get proposal
    const proposal = await this.getProposal(proposalId);
    
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} does not exist`);
    }
    
    // Update proposal status
    proposal.status = 'expired';
    
    // Save updated proposal
    await this.redisClient.set(
      `governance:proposal:${proposalId}`,
      JSON.stringify(proposal)
    );
    
    // Remove from active proposals list
    await this.removeFromList('governance:active_proposals', proposalId);
    
    // Add to expired proposals list
    await this.redisClient.rpush('governance:expired_proposals', proposalId);
    
    logger.info(`Proposal ${proposalId} expired: ${proposal.title}`);
    
    return proposal;
  }
  
  /**
   * Helper method to remove an item from a Redis list
   * Since RedisClient doesn't have lrem, we'll use a workaround
   * 
   * @param listKey Redis list key
   * @param value Value to remove
   */
  private async removeFromList(listKey: string, value: string): Promise<void> {
    // Get all items in the list
    const items = await this.redisClient.lrange(listKey, 0, -1);
    
    // Remove the old list
    await this.redisClient.del(listKey);
    
    // Add back all items except the one we want to remove
    for (const item of items) {
      if (item !== value) {
        await this.redisClient.rpush(listKey, item);
      }
    }
  }
  
  /**
   * Execute an approved proposal
   * 
   * @param proposal Approved proposal
   */
  private async executeProposal(proposal: Proposal): Promise<void> {
    // Different execution logic based on proposal type
    switch (proposal.type) {
      case ProposalType.STRATEGY_APPROVAL:
        // Logic to approve a strategy
        await this.executeStrategyApproval(proposal);
        break;
        
      case ProposalType.PARAMETER_CHANGE:
        // Logic to change system parameters
        await this.executeParameterChange(proposal);
        break;
        
      case ProposalType.AGENT_ROLE_CHANGE:
        // Logic to change an agent's role
        await this.executeAgentRoleChange(proposal);
        break;
        
      case ProposalType.SYSTEM_UPGRADE:
        // Logic to trigger a system upgrade
        await this.executeSystemUpgrade(proposal);
        break;
        
      case ProposalType.EMERGENCY_ACTION:
        // Logic to execute emergency action
        await this.executeEmergencyAction(proposal);
        break;
        
      default:
        logger.warn(`Unknown proposal type: ${proposal.type}`);
        break;
    }
  }
  
  /**
   * Execute strategy approval
   * 
   * @param proposal Approved proposal for strategy approval
   */
  private async executeStrategyApproval(proposal: Proposal): Promise<void> {
    const { strategyId } = proposal.data;
    
    if (!strategyId) {
      logger.error(`Strategy approval proposal ${proposal.id} missing strategyId`);
      return;
    }
    
    // Set strategy as approved
    await this.redisClient.hset(`strategy:${strategyId}:metadata`, {
      approved: 'true',
      approvedBy: 'governance',
      approvedAt: Date.now().toString(),
      approvalProposalId: proposal.id
    });
    
    logger.info(`Strategy ${strategyId} approved via governance proposal ${proposal.id}`);
  }
  
  /**
   * Execute parameter change
   * 
   * @param proposal Approved proposal for parameter change
   */
  private async executeParameterChange(proposal: Proposal): Promise<void> {
    const { parameterKey, parameterValue } = proposal.data;
    
    if (!parameterKey) {
      logger.error(`Parameter change proposal ${proposal.id} missing parameterKey`);
      return;
    }
    
    // Update the system parameter
    await this.redisClient.set(
      `system:parameters:${parameterKey}`,
      JSON.stringify(parameterValue)
    );
    
    logger.info(`System parameter ${parameterKey} updated via governance proposal ${proposal.id}`);
  }
  
  /**
   * Execute agent role change
   * 
   * @param proposal Approved proposal for agent role change
   */
  private async executeAgentRoleChange(proposal: Proposal): Promise<void> {
    const { agentId, role } = proposal.data;
    
    if (!agentId || !role) {
      logger.error(`Agent role change proposal ${proposal.id} missing agentId or role`);
      return;
    }
    
    // Update agent role
    await this.redisClient.hset(`agent:${agentId}:metadata`, { 
      role,
      roleAssignedAt: Date.now().toString(),
      roleAssignedReason: `Governance proposal ${proposal.id}`,
      roleAssignedSource: 'governance'
    });
    
    logger.info(`Agent ${agentId} role changed to ${role} via governance proposal ${proposal.id}`);
  }
  
  /**
   * Execute system upgrade
   * 
   * @param proposal Approved proposal for system upgrade
   */
  private async executeSystemUpgrade(proposal: Proposal): Promise<void> {
    const { version, upgradeType } = proposal.data;
    
    if (!version || !upgradeType) {
      logger.error(`System upgrade proposal ${proposal.id} missing version or upgradeType`);
      return;
    }
    
    // Schedule system upgrade
    await this.redisClient.set(
      'system:pending_upgrade',
      JSON.stringify({
        version,
        upgradeType,
        scheduledAt: Date.now(),
        proposalId: proposal.id
      })
    );
    
    logger.info(`System upgrade to version ${version} scheduled via governance proposal ${proposal.id}`);
  }
  
  /**
   * Execute emergency action
   * 
   * @param proposal Approved proposal for emergency action
   */
  private async executeEmergencyAction(proposal: Proposal): Promise<void> {
    const { action, target } = proposal.data;
    
    if (!action) {
      logger.error(`Emergency action proposal ${proposal.id} missing action`);
      return;
    }
    
    // Different emergency actions
    switch (action) {
      case 'pause_trading':
        await this.redisClient.set('system:trading_paused', 'true');
        logger.info(`Trading paused via emergency proposal ${proposal.id}`);
        break;
        
      case 'disable_strategy':
        if (!target) {
          logger.error(`Emergency action proposal ${proposal.id} missing target strategy`);
          return;
        }
        
        await this.redisClient.hset(`strategy:${target}:metadata`, {
          disabled: 'true',
          disabledReason: `Emergency governance action from proposal ${proposal.id}`,
          disabledAt: Date.now().toString()
        });
        
        logger.info(`Strategy ${target} disabled via emergency proposal ${proposal.id}`);
        break;
        
      case 'suspend_agent':
        if (!target) {
          logger.error(`Emergency action proposal ${proposal.id} missing target agent`);
          return;
        }
        
        await this.redisClient.hset(`agent:${target}:metadata`, {
          suspended: 'true',
          suspendedReason: `Emergency governance action from proposal ${proposal.id}`,
          suspendedAt: Date.now().toString()
        });
        
        logger.info(`Agent ${target} suspended via emergency proposal ${proposal.id}`);
        break;
        
      default:
        logger.warn(`Unknown emergency action: ${action}`);
        break;
    }
  }

  /**
   * Check for conflicting block proposals and select one through arbitration
   * 
   * @param proposalIds Array of conflicting proposal IDs
   * @returns The proposal ID selected through arbitration
   */
  async resolveConflictingProposals(proposalIds: string[]): Promise<string | null> {
    if (proposalIds.length <= 1) {
      return proposalIds[0] || null;
    }
    
    logger.info(`Resolving conflicting proposals: ${proposalIds.join(', ')}`);
    
    // Record votes for each proposal
    const proposalVotes: Record<string, {
      yes: number;
      no: number;
      total: number;
      agents: string[];
    }> = {};
    
    // Get votes for each proposal
    for (const proposalId of proposalIds) {
      const voteStatus = await getVoteStatus(this.redisClient, proposalId);
      
      if (voteStatus) {
        proposalVotes[proposalId] = {
          yes: voteStatus.yesScore,
          no: voteStatus.noScore,
          total: voteStatus.totalScore,
          agents: voteStatus.votes.map(v => v.agentId)
        };
      } else {
        proposalVotes[proposalId] = { yes: 0, no: 0, total: 0, agents: [] };
      }
    }
    
    // Create a fake "proposal" that contains all the conflicting proposals
    // This allows us to use the arbitration engine
    const metaProposalId = `conflict:${Date.now()}`;
    
    // Store votes for this meta proposal based on which proposal each agent supports
    for (const [proposalId, voteData] of Object.entries(proposalVotes)) {
      for (const agentId of voteData.agents) {
        // Get agent's role and trust score
        const [role, trustScore] = await Promise.all([
          this.redisClient.get(`agent:${agentId}:role`),
          this.redisClient.get(`agent:${agentId}:trust_score`)
        ]);
        
        // Create a vote record that votes for this proposal
        const voteRecord = {
          agentId,
          vote: proposalId, // We use the proposalId as the vote option
          timestamp: Date.now(),
          role: role || 'member',
          trustScore: parseFloat(trustScore || '0'),
          score: await computeWeightedScore(this.redisClient, agentId)
        };
        
        // Store this vote
        await this.redisClient.set(
          `agent:${agentId}:vote:${metaProposalId}`,
          JSON.stringify(voteRecord)
        );
      }
    }
    
    // Use arbitration to resolve which proposal wins
    const result = await resolveConflict(this.redisClient, metaProposalId);
    
    // Clean up the temporary votes
    const tempVoteKeys = await this.redisClient.keys(`agent:*:vote:${metaProposalId}`);
    for (const key of tempVoteKeys) {
      await this.redisClient.del(key);
    }
    
    // Return the winning proposal ID
    if (result && result.winning_option) {
      logger.info(`Arbitration selected proposal ${result.winning_option} among conflicting options`);
      return result.winning_option;
    }
    
    logger.warn('Arbitration failed to resolve conflicting proposals');
    return null;
  }

  /**
   * Check if a proposal has alternative shadow versions
   */
  async getShadowProposals(proposalId: string): Promise<any[]> {
    if (!this.shadowEnabled) {
      return [];
    }
    
    try {
      const shadowEngine = getShadowCabinetEngine();
      return shadowEngine.getForksForProposal(proposalId);
    } catch (error) {
      logger.warn(`Failed to get shadow proposals: ${error}`);
      return [];
    }
  }
} 