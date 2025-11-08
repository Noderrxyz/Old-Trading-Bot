/**
 * Agent Court
 * 
 * Provides a dispute resolution mechanism for conduct violations.
 * Allows agents to appeal decisions and have violations reviewed by
 * other agents or human operators.
 */

import { v4 as uuidv4 } from 'uuid';
import { 
  ConductDispute, 
  ConductViolation,
  AgentConductProfile,
  DisputeVote
} from '../types/agent.conduct.js';
import { RedisService, FileSystemService } from '../services/infrastructure/index.js';
import { EventEmitter } from '../utils/EventEmitter.js';
import { ConductEngine } from './ConductEngine.js';
import logger from '../utils/logger.js';

/**
 * Configuration for the AgentCourt
 */
interface AgentCourtConfig {
  /** Redis key prefix for court data */
  keyPrefix: string;
  
  /** Path to persistence file */
  persistencePath: string;
  
  /** How often to persist dispute data (ms) */
  persistenceInterval: number;
  
  /** Required votes to resolve a dispute */
  requiredVotes: number;
  
  /** Whether voting is enabled */
  votingEnabled: boolean;
  
  /** Whether to use filesystem persistence */
  usePersistence: boolean;
  
  /** Whether to notify about dispute events */
  notifyEvents: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: AgentCourtConfig = {
  keyPrefix: 'agent:court:',
  persistencePath: 'src/data/legal/agent_court.memory.json',
  persistenceInterval: 60 * 60 * 1000, // 1 hour
  requiredVotes: 3,
  votingEnabled: true,
  usePersistence: true,
  notifyEvents: true
};

/**
 * Agent court for resolving disputes
 */
export class AgentCourt {
  private redis: RedisService;
  private fileSystem?: FileSystemService;
  private eventEmitter: EventEmitter;
  private conductEngine: ConductEngine;
  private config: AgentCourtConfig;
  private persistenceIntervalId?: NodeJS.Timeout;
  private trustScoreProvider?: any; // Optional trust score provider
  
  /**
   * Create a new AgentCourt
   * 
   * @param redis Redis service for data persistence
   * @param eventEmitter Event emitter for notifications
   * @param conductEngine Conduct engine service
   * @param fileSystem Optional filesystem service for persistence
   * @param config Configuration options
   * @param trustScoreProvider Optional trust score provider
   */
  constructor(
    redis: RedisService,
    eventEmitter: EventEmitter,
    conductEngine: ConductEngine,
    fileSystem?: FileSystemService,
    config: Partial<AgentCourtConfig> = {},
    trustScoreProvider?: any
  ) {
    this.redis = redis;
    this.fileSystem = fileSystem;
    this.eventEmitter = eventEmitter;
    this.conductEngine = conductEngine;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.trustScoreProvider = trustScoreProvider;
    
    // Start persistence if enabled
    if (this.config.usePersistence && this.fileSystem) {
      this.startPersistence();
    }
    
    // Subscribe to violation events
    this.eventEmitter.on('conduct:violation', (data) => {
      logger.info(`Court notified of violation: ${data.ruleId} by agent ${data.agentId}`);
    });
  }
  
  /**
   * File a dispute against a conduct violation
   * 
   * @param violationId ID of the violation being disputed
   * @param agentId Agent filing the dispute
   * @param justification Justification for the dispute
   * @returns The created dispute
   */
  public async fileDispute(
    violationId: string,
    agentId: string,
    justification: string
  ): Promise<ConductDispute> {
    // Get the violation details
    const violation = await this.getViolation(violationId);
    
    if (!violation) {
      throw new Error(`Violation ${violationId} not found`);
    }
    
    // Create dispute object
    const now = Date.now();
    const dispute: ConductDispute = {
      id: uuidv4(),
      violationId,
      filedBy: agentId,
      filedAt: now,
      status: 'pending',
      justification,
      votes: []
    };
    
    // Store dispute
    const key = `${this.config.keyPrefix}dispute:${dispute.id}`;
    await this.redis.set(key, JSON.stringify(dispute));
    
    // Add to pending disputes list
    await this.redis.sadd(`${this.config.keyPrefix}pending_disputes`, dispute.id);
    
    // Link dispute to violation
    await this.redis.set(`${this.config.keyPrefix}violation:${violationId}:dispute`, dispute.id);
    
    // Emit event
    if (this.config.notifyEvents) {
      this.eventEmitter.emit('court:dispute_filed', {
        disputeId: dispute.id,
        violationId,
        agentId,
        timestamp: now
      });
    }
    
    logger.info(`Agent ${agentId} filed dispute ${dispute.id} against violation ${violationId}`);
    
    return dispute;
  }
  
  /**
   * Vote on a dispute
   * 
   * @param disputeId ID of the dispute
   * @param voterId ID of the voting agent
   * @param vote Vote decision
   * @param reason Optional reasoning for the vote
   * @returns Updated dispute
   */
  public async voteOnDispute(
    disputeId: string,
    voterId: string,
    vote: 'uphold' | 'overturn' | 'modify',
    reason?: string
  ): Promise<ConductDispute | null> {
    if (!this.config.votingEnabled) {
      logger.warn(`Voting is disabled, rejected vote from ${voterId} on dispute ${disputeId}`);
      return null;
    }
    
    // Get the dispute
    const dispute = await this.getDispute(disputeId);
    
    if (!dispute) {
      logger.warn(`Dispute ${disputeId} not found for vote by ${voterId}`);
      return null;
    }
    
    if (dispute.status !== 'pending' && dispute.status !== 'under_review') {
      logger.warn(`Dispute ${disputeId} is already ${dispute.status}, cannot vote`);
      return null;
    }
    
    // Determine vote weight based on voter's trust score and role
    let weight = 1.0;
    
    if (this.trustScoreProvider) {
      try {
        const trustScore = await this.trustScoreProvider.getAgentTrustScore(voterId);
        weight = trustScore > 0.5 ? trustScore : 0.5; // Minimum weight of 0.5
      } catch (error: any) {
        logger.error(`Error getting trust score for voter ${voterId}:`, error);
      }
    }
    
    // Create vote object
    const voteObj: DisputeVote = {
      voterId,
      vote,
      reason,
      timestamp: Date.now(),
      weight
    };
    
    // Check if voter has already voted
    const existingVoteIndex = dispute.votes?.findIndex(v => v.voterId === voterId);
    
    if (existingVoteIndex !== undefined && existingVoteIndex >= 0 && dispute.votes) {
      // Update existing vote
      dispute.votes[existingVoteIndex] = voteObj;
    } else {
      // Add new vote
      if (!dispute.votes) {
        dispute.votes = [];
      }
      dispute.votes.push(voteObj);
    }
    
    // Update status if still pending
    if (dispute.status === 'pending' && dispute.votes.length > 0) {
      dispute.status = 'under_review';
    }
    
    // Check if we have enough votes to resolve
    if (dispute.votes.length >= this.config.requiredVotes) {
      await this.resolveDispute(dispute);
    } else {
      // Save updated dispute
      const key = `${this.config.keyPrefix}dispute:${dispute.id}`;
      await this.redis.set(key, JSON.stringify(dispute));
    }
    
    // Emit event
    if (this.config.notifyEvents) {
      this.eventEmitter.emit('court:vote_cast', {
        disputeId: dispute.id,
        voterId,
        vote,
        timestamp: voteObj.timestamp
      });
    }
    
    logger.info(`Agent ${voterId} voted to ${vote} dispute ${disputeId}`);
    
    return dispute;
  }
  
  /**
   * Manually resolve a dispute
   * 
   * @param disputeId ID of the dispute
   * @param outcome Resolution outcome
   * @param resolvedBy Entity resolving the dispute
   * @param notes Resolution notes
   * @returns Updated dispute
   */
  public async manualResolveDispute(
    disputeId: string,
    outcome: 'upheld' | 'overturned' | 'modified',
    resolvedBy: string,
    notes: string
  ): Promise<ConductDispute | null> {
    // Get the dispute
    const dispute = await this.getDispute(disputeId);
    
    if (!dispute) {
      logger.warn(`Dispute ${disputeId} not found for manual resolution`);
      return null;
    }
    
    if (dispute.status === 'resolved' || dispute.status === 'rejected') {
      logger.warn(`Dispute ${disputeId} is already ${dispute.status}, cannot resolve`);
      return null;
    }
    
    // Update dispute with resolution
    dispute.status = 'resolved';
    dispute.resolution = {
      outcome,
      resolvedBy,
      resolvedAt: Date.now(),
      notes
    };
    
    // Apply the outcome
    await this.applyDisputeOutcome(dispute, outcome);
    
    // Remove from pending disputes
    await this.redis.srem(`${this.config.keyPrefix}pending_disputes`, dispute.id);
    
    // Add to resolved disputes
    await this.redis.sadd(`${this.config.keyPrefix}resolved_disputes`, dispute.id);
    
    // Save updated dispute
    const key = `${this.config.keyPrefix}dispute:${dispute.id}`;
    await this.redis.set(key, JSON.stringify(dispute));
    
    // Emit event
    if (this.config.notifyEvents) {
      this.eventEmitter.emit('court:dispute_resolved', {
        disputeId: dispute.id,
        outcome,
        resolvedBy,
        timestamp: dispute.resolution.resolvedAt
      });
    }
    
    logger.info(`Dispute ${disputeId} manually resolved with outcome: ${outcome} by ${resolvedBy}`);
    
    return dispute;
  }
  
  /**
   * Automatically resolve a dispute based on votes
   * 
   * @param dispute Dispute to resolve
   */
  private async resolveDispute(dispute: ConductDispute): Promise<void> {
    if (!dispute.votes || dispute.votes.length === 0) {
      logger.warn(`Cannot resolve dispute ${dispute.id} without votes`);
      return;
    }
    
    // Calculate weighted votes for each outcome
    const voteWeights = {
      uphold: 0,
      overturn: 0,
      modify: 0
    };
    
    for (const vote of dispute.votes) {
      // Ensure vote has weight property
      const weight = vote.weight || 1.0;
      voteWeights[vote.vote] += weight;
    }
    
    // Determine winning outcome
    let outcome: 'upheld' | 'overturned' | 'modified' = 'upheld'; // Default
    let highestWeight = 0;
    
    if (voteWeights.uphold > highestWeight) {
      outcome = 'upheld';
      highestWeight = voteWeights.uphold;
    }
    
    if (voteWeights.overturn > highestWeight) {
      outcome = 'overturned';
      highestWeight = voteWeights.overturn;
    }
    
    if (voteWeights.modify > highestWeight) {
      outcome = 'modified';
      highestWeight = voteWeights.modify;
    }
    
    // Update dispute with resolution
    dispute.status = 'resolved';
    dispute.resolution = {
      outcome,
      resolvedBy: 'vote',
      resolvedAt: Date.now(),
      notes: `Resolved by vote: uphold=${voteWeights.uphold.toFixed(2)}, overturn=${voteWeights.overturn.toFixed(2)}, modify=${voteWeights.modify.toFixed(2)}`
    };
    
    // Apply the outcome
    await this.applyDisputeOutcome(dispute, outcome);
    
    // Remove from pending disputes
    await this.redis.srem(`${this.config.keyPrefix}pending_disputes`, dispute.id);
    
    // Add to resolved disputes
    await this.redis.sadd(`${this.config.keyPrefix}resolved_disputes`, dispute.id);
    
    // Save updated dispute
    const key = `${this.config.keyPrefix}dispute:${dispute.id}`;
    await this.redis.set(key, JSON.stringify(dispute));
    
    // Emit event
    if (this.config.notifyEvents) {
      this.eventEmitter.emit('court:dispute_resolved', {
        disputeId: dispute.id,
        outcome,
        resolvedBy: 'vote',
        timestamp: dispute.resolution.resolvedAt
      });
    }
    
    logger.info(`Dispute ${dispute.id} resolved by vote with outcome: ${outcome}`);
  }
  
  /**
   * Apply the outcome of a dispute
   * 
   * @param dispute Resolved dispute
   * @param outcome Dispute outcome
   */
  private async applyDisputeOutcome(
    dispute: ConductDispute,
    outcome: 'upheld' | 'overturned' | 'modified'
  ): Promise<void> {
    // Get the violation and agent profile
    const violation = await this.getViolation(dispute.violationId);
    
    if (!violation) {
      logger.error(`Violation ${dispute.violationId} not found when applying dispute outcome`);
      return;
    }
    
    // Get agent profile
    const agentProfile = await this.conductEngine.getConductProfile(violation.context?.agentId || '');
    
    if (!agentProfile) {
      logger.error(`Agent profile not found for violation ${dispute.violationId}`);
      return;
    }
    
    switch (outcome) {
      case 'overturned':
        // Remove the violation from the agent's profile
        await this.removeViolationFromAgent(agentProfile, violation);
        
        // If there was a penalty, try to reverse it
        if (violation.penaltyApplied) {
          await this.reversePenalty(agentProfile.agentId, violation);
        }
        break;
      
      case 'modified':
        // Mark violation as reviewed
        violation.reviewed = true;
        
        // Update the violation in Redis
        const violationKey = `${this.config.keyPrefix}violation:${violation.id}`;
        await this.redis.set(violationKey, JSON.stringify(violation));
        
        // Update the violation in the agent's profile
        const violationIndex = agentProfile.violations.findIndex(v => v.id === violation.id);
        if (violationIndex >= 0) {
          agentProfile.violations[violationIndex] = violation;
          
          // Save the updated profile
          await this.conductEngine.getConductProfile(agentProfile.agentId);
        }
        break;
      
      case 'upheld':
      default:
        // Just mark the violation as reviewed
        violation.reviewed = true;
        
        // Update the violation in Redis
        const upheldViolationKey = `${this.config.keyPrefix}violation:${violation.id}`;
        await this.redis.set(upheldViolationKey, JSON.stringify(violation));
        
        // Update in agent profile
        const upheldViolationIndex = agentProfile.violations.findIndex(v => v.id === violation.id);
        if (upheldViolationIndex >= 0) {
          agentProfile.violations[upheldViolationIndex] = violation;
          
          // Save the updated profile
          await this.conductEngine.getConductProfile(agentProfile.agentId);
        }
        break;
    }
  }
  
  /**
   * Remove a violation from an agent's profile
   * 
   * @param profile Agent profile
   * @param violation Violation to remove
   */
  private async removeViolationFromAgent(
    profile: AgentConductProfile,
    violation: ConductViolation
  ): Promise<void> {
    // Remove the violation
    profile.violations = profile.violations.filter(v => v.id !== violation.id);
    
    // Update revoked status if applicable
    if (profile.revoked) {
      // Count remaining critical and high violations
      const criticalViolations = profile.violations.filter(v => {
        const rule = this.getConductRuleById(v.ruleId);
        return rule?.severity === 'critical';
      });
      
      const highViolations = profile.violations.filter(v => {
        const rule = this.getConductRuleById(v.ruleId);
        return rule?.severity === 'high';
      });
      
      // Only auto-restore if violation counts are below thresholds
      if (criticalViolations.length < 3 && highViolations.length < 5) {
        profile.revoked = false;
        
        // Emit event
        if (this.config.notifyEvents) {
          this.eventEmitter.emit('conduct:agent_restored', {
            agentId: profile.agentId,
            reason: 'Dispute resulted in acceptable violation count',
            timestamp: Date.now()
          });
        }
        
        logger.info(`Agent ${profile.agentId} automatically restored after dispute`);
      }
    }
    
    // Save updated profile
    await this.conductEngine.getConductProfile(profile.agentId);
  }
  
  /**
   * Try to reverse a penalty
   * 
   * @param agentId Agent ID
   * @param violation Violation with penalty to reverse
   */
  private async reversePenalty(agentId: string, violation: ConductViolation): Promise<void> {
    if (!violation.penaltyApplied) return;
    
    try {
      if (violation.penaltyApplied.startsWith('Revoked license ')) {
        // Extract license ID
        const licenseId = violation.penaltyApplied.replace('Revoked license ', '');
        
        // TODO: Implement license restoration logic via LicenseIssuer
        logger.info(`Should restore license ${licenseId} for agent ${agentId} after overturned violation`);
      } else if (violation.penaltyApplied.startsWith('Suspended ')) {
        // Extract capability
        const parts = violation.penaltyApplied.split(' ');
        if (parts.length >= 2) {
          const capability = parts[1];
          
          // Remove suspension
          const suspensionKey = `agent:conduct:${agentId}:suspension:${capability}`;
          await this.redis.del(suspensionKey);
          
          logger.info(`Removed suspension of ${capability} for agent ${agentId} after overturned violation`);
        }
      } else if (violation.penaltyApplied.startsWith('Throttled ')) {
        // Extract resource
        const parts = violation.penaltyApplied.split(' ');
        if (parts.length >= 2) {
          const resource = parts[1];
          
          // Remove throttling
          const throttleKey = `agent:conduct:${agentId}:throttle:${resource}`;
          await this.redis.del(throttleKey);
          
          logger.info(`Removed throttling of ${resource} for agent ${agentId} after overturned violation`);
        }
      } else if (violation.penaltyApplied === 'Quarantined agent and flagged for review') {
        // Remove quarantine
        const quarantineKey = `agent:conduct:${agentId}:quarantined`;
        await this.redis.del(quarantineKey);
        
        logger.info(`Removed quarantine for agent ${agentId} after overturned violation`);
      } else if (violation.penaltyApplied.startsWith('Flagged as ')) {
        // Extract flag type
        const flagType = violation.penaltyApplied.replace('Flagged as ', '');
        
        // Remove flag
        const flagKey = `agent:conduct:${agentId}:flag:${flagType}`;
        await this.redis.del(flagKey);
        
        logger.info(`Removed flag ${flagType} for agent ${agentId} after overturned violation`);
      }
    } catch (error) {
      logger.error(`Error reversing penalty for agent ${agentId}:`, error);
    }
  }
  
  /**
   * Get a conduct rule by ID
   * 
   * @param ruleId Rule ID
   * @returns Conduct rule or undefined
   */
  private getConductRuleById(ruleId: string): any {
    // Import would create circular dependency, so we use a more flexible approach
    try {
      const { findConductRule } = require('../config/conduct_rules.js');
      return findConductRule(ruleId);
    } catch (error) {
      logger.error(`Error finding conduct rule ${ruleId}:`, error);
      return undefined;
    }
  }
  
  /**
   * Get a dispute by ID
   * 
   * @param disputeId Dispute ID
   * @returns Dispute or null if not found
   */
  public async getDispute(disputeId: string): Promise<ConductDispute | null> {
    const key = `${this.config.keyPrefix}dispute:${disputeId}`;
    const disputeJson = await this.redis.get(key);
    
    if (!disputeJson) {
      return null;
    }
    
    return JSON.parse(disputeJson);
  }
  
  /**
   * Get a violation by ID
   * 
   * @param violationId Violation ID
   * @returns Violation or null if not found
   */
  private async getViolation(violationId: string): Promise<ConductViolation | null> {
    // First check direct storage
    const directKey = `${this.config.keyPrefix}violation:${violationId}`;
    const directJson = await this.redis.get(directKey);
    
    if (directJson) {
      return JSON.parse(directJson);
    }
    
    // If not found, search in agent profiles
    const profileKeys = await this.redis.keys('agent:conduct:*:profile');
    
    for (const key of profileKeys) {
      const profileJson = await this.redis.get(key);
      if (profileJson) {
        const profile: AgentConductProfile = JSON.parse(profileJson);
        const violation = profile.violations.find(v => v.id === violationId);
        
        if (violation) {
          // Store for faster access next time
          await this.redis.set(directKey, JSON.stringify(violation));
          return violation;
        }
      }
    }
    
    return null;
  }
  
  /**
   * Get all pending disputes
   * 
   * @returns Array of pending disputes
   */
  public async getPendingDisputes(): Promise<ConductDispute[]> {
    const pendingIds = await this.redis.smembers(`${this.config.keyPrefix}pending_disputes`);
    const disputes: ConductDispute[] = [];
    
    for (const id of pendingIds) {
      const dispute = await this.getDispute(id);
      if (dispute) {
        disputes.push(dispute);
      }
    }
    
    return disputes;
  }
  
  /**
   * Get all resolved disputes
   * 
   * @returns Array of resolved disputes
   */
  public async getResolvedDisputes(): Promise<ConductDispute[]> {
    const resolvedIds = await this.redis.smembers(`${this.config.keyPrefix}resolved_disputes`);
    const disputes: ConductDispute[] = [];
    
    for (const id of resolvedIds) {
      const dispute = await this.getDispute(id);
      if (dispute) {
        disputes.push(dispute);
      }
    }
    
    return disputes;
  }
  
  /**
   * Get all disputes for an agent
   * 
   * @param agentId Agent ID
   * @returns Array of disputes filed by or against the agent
   */
  public async getDisputesForAgent(agentId: string): Promise<ConductDispute[]> {
    const allDisputes = [
      ...(await this.getPendingDisputes()),
      ...(await this.getResolvedDisputes())
    ];
    
    // Use a synchronous filter here instead of awaiting in the filter function
    const result: ConductDispute[] = [];
    
    for (const dispute of allDisputes) {
      // Disputes filed by this agent
      if (dispute.filedBy === agentId) {
        result.push(dispute);
        continue;
      }
      
      // Disputes against this agent - we need to fetch the violation separately
      const violation = await this.getViolation(dispute.violationId);
      if (violation?.context?.agentId === agentId) {
        result.push(dispute);
      }
    }
    
    return result;
  }
  
  /**
   * Start persistence loop
   */
  private startPersistence(): void {
    if (this.persistenceIntervalId) {
      clearInterval(this.persistenceIntervalId);
    }
    
    this.persistenceIntervalId = setInterval(() => {
      this.persistDisputes().catch(err => {
        logger.error('Error persisting disputes:', err);
      });
    }, this.config.persistenceInterval);
    
    logger.info(`Court dispute persistence started (interval: ${this.config.persistenceInterval / 1000 / 60} minutes)`);
  }
  
  /**
   * Persist all disputes to filesystem
   */
  private async persistDisputes(): Promise<void> {
    if (!this.fileSystem) {
      return;
    }
    
    try {
      // Get all disputes
      const disputes = [
        ...(await this.getPendingDisputes()),
        ...(await this.getResolvedDisputes())
      ];
      
      // Write to file
      await this.fileSystem.writeFile(
        this.config.persistencePath,
        JSON.stringify({ disputes, updatedAt: Date.now() }, null, 2)
      );
      
      logger.info(`Persisted ${disputes.length} disputes to ${this.config.persistencePath}`);
    } catch (error: any) {
      logger.error('Failed to persist disputes:', error);
    }
  }
  
  /**
   * Load persisted disputes
   */
  public async loadPersistedDisputes(): Promise<void> {
    if (!this.fileSystem) {
      return;
    }
    
    try {
      // Check if file exists
      if (!(await this.fileSystem.exists(this.config.persistencePath))) {
        logger.info(`No disputes file found at ${this.config.persistencePath}, skipping load`);
        return;
      }
      
      // Read file
      const data = await this.fileSystem.readFile(this.config.persistencePath);
      const { disputes } = JSON.parse(data);
      
      // Store disputes in Redis
      for (const dispute of disputes) {
        const key = `${this.config.keyPrefix}dispute:${dispute.id}`;
        await this.redis.set(key, JSON.stringify(dispute));
        
        // Add to appropriate set
        if (dispute.status === 'pending' || dispute.status === 'under_review') {
          await this.redis.sadd(`${this.config.keyPrefix}pending_disputes`, dispute.id);
        } else {
          await this.redis.sadd(`${this.config.keyPrefix}resolved_disputes`, dispute.id);
        }
      }
      
      logger.info(`Loaded ${disputes.length} disputes from ${this.config.persistencePath}`);
    } catch (error: any) {
      logger.error('Failed to load persisted disputes:', error);
    }
  }
  
  /**
   * Clean up resources
   */
  public dispose(): void {
    if (this.persistenceIntervalId) {
      clearInterval(this.persistenceIntervalId);
      this.persistenceIntervalId = undefined;
    }
  }
} 