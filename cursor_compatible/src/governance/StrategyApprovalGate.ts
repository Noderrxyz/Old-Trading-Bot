import { logger } from '../utils/logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { StrategyGenome } from '../evolution/StrategyGenome';
import { ConductEngine } from './ConductEngine';

/**
 * Strategy approval status enum
 */
export enum StrategyApprovalStatus {
  /**
   * Strategy is pending approval
   */
  PENDING = 'pending',
  
  /**
   * Strategy has been approved
   */
  APPROVED = 'approved',
  
  /**
   * Strategy has been rejected
   */
  REJECTED = 'rejected',
  
  /**
   * Strategy approval has expired
   */
  EXPIRED = 'expired',
  
  /**
   * Strategy is being reviewed
   */
  IN_REVIEW = 'in_review'
}

/**
 * Strategy approval metadata
 */
export interface StrategyApprovalMetadata {
  /**
   * Unique ID for this approval process
   */
  approvalId: string;
  
  /**
   * Strategy ID being approved
   */
  strategyId: string;
  
  /**
   * Current approval status
   */
  status: StrategyApprovalStatus;
  
  /**
   * Timestamp when the approval was requested
   */
  requestedAt: number;
  
  /**
   * Timestamp when the approval was last updated
   */
  updatedAt: number;
  
  /**
   * Timestamp when the approval expires
   */
  expiresAt: number;
  
  /**
   * Number of votes in favor
   */
  votesFor: number;
  
  /**
   * Number of votes against
   */
  votesAgainst: number;
  
  /**
   * Voting weight required for approval
   */
  requiredWeight: number;
  
  /**
   * Comments from reviewers
   */
  comments: Array<{
    author: string;
    text: string;
    timestamp: number;
  }>;
  
  /**
   * Tags applied to this strategy
   */
  tags: string[];
}

/**
 * Strategy approval configuration
 */
export interface StrategyApprovalGateConfig {
  /**
   * Whether to require approval for all strategies
   */
  requireApprovalForAll: boolean;
  
  /**
   * Whether to auto-approve strategies in development mode
   */
  autoApproveInDevMode: boolean;
  
  /**
   * Maximum time to wait for approval (ms)
   */
  approvalTimeoutMs: number;
  
  /**
   * Minimum required voting weight for approval
   */
  minRequiredVotingWeight: number;
  
  /**
   * Risk thresholds that require additional scrutiny
   */
  riskThresholds: {
    /**
     * Strategies with allocation above this amount require additional approval
     */
    highAllocationThresholdUsd: number;
    
    /**
     * Strategies with volatility above this threshold require additional approval
     */
    highVolatilityThreshold: number;
  };
  
  /**
   * Auto-reject untrusted strategies
   */
  rejectUntrustedStrategies: boolean;
  
  /**
   * Enable detailed telemetry
   */
  emitDetailedTelemetry: boolean;
}

/**
 * Default approval gate configuration
 */
const DEFAULT_CONFIG: StrategyApprovalGateConfig = {
  requireApprovalForAll: true,
  autoApproveInDevMode: process.env.NODE_ENV !== 'production',
  approvalTimeoutMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  minRequiredVotingWeight: 100,
  riskThresholds: {
    highAllocationThresholdUsd: 50000, // $50k
    highVolatilityThreshold: 0.5 // 50%
  },
  rejectUntrustedStrategies: true,
  emitDetailedTelemetry: true
};

/**
 * Strategy Approval Gate
 * 
 * This class provides DAO governance integration for strategy approval.
 * It gates strategies from being deployed until they receive sufficient
 * approval votes from governance participants.
 */
export class StrategyApprovalGate {
  private static instance: StrategyApprovalGate | null = null;
  private config: StrategyApprovalGateConfig;
  private telemetry: TelemetryBus;
  private conductEngine: ConductEngine;
  
  // Track approvals by strategy ID
  private approvals: Map<string, StrategyApprovalMetadata> = new Map();
  
  // Track strategies waiting for approval
  private pendingStrategies: Map<string, StrategyGenome> = new Map();
  
  // Callbacks for approval events
  private approvalCallbacks: Map<string, (
    status: StrategyApprovalStatus,
    metadata: StrategyApprovalMetadata
  ) => void> = new Map();
  
  /**
   * Private constructor for singleton
   */
  private constructor(config: Partial<StrategyApprovalGateConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetry = TelemetryBus.getInstance();
    this.conductEngine = ConductEngine.getInstance();
    
    // Set up event handlers
    this.setupEventHandlers();
    
    // Start approval expiration checker
    this.startExpirationChecker();
    
    logger.info('StrategyApprovalGate initialized', {
      requireApprovalForAll: this.config.requireApprovalForAll,
      autoApproveInDevMode: this.config.autoApproveInDevMode
    });
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config: Partial<StrategyApprovalGateConfig> = {}): StrategyApprovalGate {
    if (!StrategyApprovalGate.instance) {
      StrategyApprovalGate.instance = new StrategyApprovalGate(config);
    }
    return StrategyApprovalGate.instance;
  }
  
  /**
   * Request approval for a strategy
   * @param strategy Strategy genome to approve
   * @param callback Optional callback for approval result
   * @returns Promise that resolves with approval status
   */
  public async requestApproval(
    strategy: StrategyGenome,
    callback?: (status: StrategyApprovalStatus, metadata: StrategyApprovalMetadata) => void
  ): Promise<StrategyApprovalStatus> {
    const strategyId = strategy.getId();
    
    // Check if already in process
    if (this.approvals.has(strategyId)) {
      const existing = this.approvals.get(strategyId)!;
      
      if (callback) {
        this.approvalCallbacks.set(strategyId, callback);
      }
      
      return existing.status;
    }
    
    // Auto-approve in dev mode if configured
    if (this.config.autoApproveInDevMode && process.env.NODE_ENV !== 'production') {
      logger.info(`Auto-approving strategy ${strategyId} in dev mode`);
      
      const approval = this.createApprovalMetadata(strategyId, StrategyApprovalStatus.APPROVED);
      this.approvals.set(strategyId, approval);
      
      if (callback) {
        callback(StrategyApprovalStatus.APPROVED, approval);
      }
      
      this.emitApprovalEvent(strategyId, approval);
      
      return StrategyApprovalStatus.APPROVED;
    }
    
    // Store callback if provided
    if (callback) {
      this.approvalCallbacks.set(strategyId, callback);
    }
    
    // Store for reference
    this.pendingStrategies.set(strategyId, strategy);
    
    // Create approval metadata
    const approval = this.createApprovalMetadata(strategyId);
    this.approvals.set(strategyId, approval);
    
    // Submit to governance
    await this.submitToGovernance(strategy, approval);
    
    // Emit telemetry
    this.emitApprovalEvent(strategyId, approval);
    
    return approval.status;
  }
  
  /**
   * Check if a strategy is approved
   * @param strategyId Strategy ID to check
   * @returns True if approved
   */
  public isApproved(strategyId: string): boolean {
    const approval = this.approvals.get(strategyId);
    return approval?.status === StrategyApprovalStatus.APPROVED;
  }
  
  /**
   * Get approval status for a strategy
   * @param strategyId Strategy ID to check
   * @returns Approval status or PENDING if not found
   */
  public getApprovalStatus(strategyId: string): StrategyApprovalStatus {
    const approval = this.approvals.get(strategyId);
    return approval?.status || StrategyApprovalStatus.PENDING;
  }
  
  /**
   * Get approval metadata for a strategy
   * @param strategyId Strategy ID to check
   * @returns Approval metadata or null if not found
   */
  public getApprovalMetadata(strategyId: string): StrategyApprovalMetadata | null {
    return this.approvals.get(strategyId) || null;
  }
  
  /**
   * Get all pending strategies
   * @returns Array of pending strategy IDs
   */
  public getPendingStrategyIds(): string[] {
    return Array.from(this.approvals.entries())
      .filter(([_, metadata]) => metadata.status === StrategyApprovalStatus.PENDING)
      .map(([id, _]) => id);
  }
  
  /**
   * Manually approve a strategy (admin function)
   * @param strategyId Strategy ID to approve
   * @param adminId ID of the admin performing approval
   * @param comment Optional comment
   * @returns True if successful
   */
  public approveStrategy(
    strategyId: string, 
    adminId: string,
    comment?: string
  ): boolean {
    const approval = this.approvals.get(strategyId);
    
    if (!approval) {
      logger.warn(`Cannot approve non-existent strategy: ${strategyId}`);
      return false;
    }
    
    if (approval.status === StrategyApprovalStatus.APPROVED) {
      return true; // Already approved
    }
    
    // Update metadata
    approval.status = StrategyApprovalStatus.APPROVED;
    approval.updatedAt = Date.now();
    approval.votesFor = approval.requiredWeight; // Force required votes
    
    if (comment) {
      approval.comments.push({
        author: adminId,
        text: comment,
        timestamp: Date.now()
      });
    }
    
    this.approvals.set(strategyId, approval);
    
    // Notify via callback if registered
    if (this.approvalCallbacks.has(strategyId)) {
      const callback = this.approvalCallbacks.get(strategyId)!;
      callback(StrategyApprovalStatus.APPROVED, approval);
    }
    
    // Emit telemetry
    this.emitApprovalEvent(strategyId, approval);
    
    logger.info(`Strategy ${strategyId} manually approved by ${adminId}`);
    return true;
  }
  
  /**
   * Manually reject a strategy (admin function)
   * @param strategyId Strategy ID to reject
   * @param adminId ID of the admin performing rejection
   * @param reason Reason for rejection
   * @returns True if successful
   */
  public rejectStrategy(
    strategyId: string, 
    adminId: string,
    reason: string
  ): boolean {
    const approval = this.approvals.get(strategyId);
    
    if (!approval) {
      logger.warn(`Cannot reject non-existent strategy: ${strategyId}`);
      return false;
    }
    
    if (approval.status === StrategyApprovalStatus.REJECTED) {
      return true; // Already rejected
    }
    
    // Update metadata
    approval.status = StrategyApprovalStatus.REJECTED;
    approval.updatedAt = Date.now();
    approval.votesAgainst = approval.requiredWeight; // Force required votes
    
    approval.comments.push({
      author: adminId,
      text: `Rejected: ${reason}`,
      timestamp: Date.now()
    });
    
    this.approvals.set(strategyId, approval);
    
    // Notify via callback if registered
    if (this.approvalCallbacks.has(strategyId)) {
      const callback = this.approvalCallbacks.get(strategyId)!;
      callback(StrategyApprovalStatus.REJECTED, approval);
    }
    
    // Emit telemetry
    this.emitApprovalEvent(strategyId, approval);
    
    logger.info(`Strategy ${strategyId} manually rejected by ${adminId}: ${reason}`);
    return true;
  }
  
  /**
   * Submit a strategy for governance review
   */
  private async submitToGovernance(
    strategy: StrategyGenome, 
    approval: StrategyApprovalMetadata
  ): Promise<void> {
    try {
      // Create a formal governance proposal
      const proposal = await this.conductEngine.createStrategyProposal({
        title: `Strategy Approval: ${strategy.getName()}`,
        description: `Approval requested for strategy: ${strategy.getId()}`,
        strategyId: strategy.getId(),
        approvalId: approval.approvalId,
        expiresAt: approval.expiresAt,
        requiredWeight: approval.requiredWeight,
        genome: strategy,
        metadata: {
          risk: this.calculateStrategyRisk(strategy),
          isHighRisk: this.isHighRiskStrategy(strategy),
          tags: approval.tags
        }
      });
      
      logger.info(`Created governance proposal for strategy ${strategy.getId()}`, {
        proposalId: proposal.id
      });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to create governance proposal for strategy ${strategy.getId()}: ${errorMessage}`, error);
      
      // Still keep as pending, but log the error
      this.telemetry.emit('governance.proposal_creation_error', {
        strategyId: strategy.getId(),
        approvalId: approval.approvalId,
        error: errorMessage,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Set up event handlers for governance events
   */
  private setupEventHandlers(): void {
    // Listen for vote events from governance system
    this.conductEngine.on('proposal.vote', (event: any) => {
      if (!event.metadata?.strategyId) return;
      
      const strategyId = event.metadata.strategyId;
      const approval = this.approvals.get(strategyId);
      
      if (!approval) return;
      
      // Update vote counts
      if (event.voteType === 'for') {
        approval.votesFor += event.weight;
      } else if (event.voteType === 'against') {
        approval.votesAgainst += event.weight;
      }
      
      approval.updatedAt = Date.now();
      this.approvals.set(strategyId, approval);
      
      // Check if we've reached decision threshold
      this.checkVoteThresholds(strategyId, approval);
    });
    
    // Listen for proposal completion events
    this.conductEngine.on('proposal.completed', (event: any) => {
      if (!event.metadata?.strategyId) return;
      
      const strategyId = event.metadata.strategyId;
      const approval = this.approvals.get(strategyId);
      
      if (!approval) return;
      
      // Update status based on governance outcome
      if (event.outcome === 'passed') {
        approval.status = StrategyApprovalStatus.APPROVED;
      } else {
        approval.status = StrategyApprovalStatus.REJECTED;
      }
      
      approval.updatedAt = Date.now();
      this.approvals.set(strategyId, approval);
      
      // Notify callback
      if (this.approvalCallbacks.has(strategyId)) {
        const callback = this.approvalCallbacks.get(strategyId)!;
        callback(approval.status, approval);
      }
      
      // Clean up
      this.pendingStrategies.delete(strategyId);
      this.approvalCallbacks.delete(strategyId);
      
      // Emit telemetry
      this.emitApprovalEvent(strategyId, approval);
    });
  }
  
  /**
   * Check if vote thresholds have been reached
   */
  private checkVoteThresholds(strategyId: string, approval: StrategyApprovalMetadata): void {
    // If already decided, do nothing
    if (approval.status !== StrategyApprovalStatus.PENDING) {
      return;
    }
    
    // Check for approval threshold
    if (approval.votesFor >= approval.requiredWeight) {
      approval.status = StrategyApprovalStatus.APPROVED;
      approval.updatedAt = Date.now();
      
      logger.info(`Strategy ${strategyId} approved via voting threshold`);
      
      // Notify callback
      if (this.approvalCallbacks.has(strategyId)) {
        const callback = this.approvalCallbacks.get(strategyId)!;
        callback(StrategyApprovalStatus.APPROVED, approval);
      }
      
      // Clean up
      this.pendingStrategies.delete(strategyId);
      this.approvalCallbacks.delete(strategyId);
      
      // Emit telemetry
      this.emitApprovalEvent(strategyId, approval);
    }
    
    // Check for rejection threshold
    if (approval.votesAgainst >= approval.requiredWeight) {
      approval.status = StrategyApprovalStatus.REJECTED;
      approval.updatedAt = Date.now();
      
      logger.info(`Strategy ${strategyId} rejected via voting threshold`);
      
      // Notify callback
      if (this.approvalCallbacks.has(strategyId)) {
        const callback = this.approvalCallbacks.get(strategyId)!;
        callback(StrategyApprovalStatus.REJECTED, approval);
      }
      
      // Clean up
      this.pendingStrategies.delete(strategyId);
      this.approvalCallbacks.delete(strategyId);
      
      // Emit telemetry
      this.emitApprovalEvent(strategyId, approval);
    }
  }
  
  /**
   * Create a new approval metadata object
   */
  private createApprovalMetadata(
    strategyId: string,
    initialStatus: StrategyApprovalStatus = StrategyApprovalStatus.PENDING
  ): StrategyApprovalMetadata {
    const now = Date.now();
    return {
      approvalId: `approval_${strategyId}_${now}`,
      strategyId,
      status: initialStatus,
      requestedAt: now,
      updatedAt: now,
      expiresAt: now + this.config.approvalTimeoutMs,
      votesFor: 0,
      votesAgainst: 0,
      requiredWeight: this.config.minRequiredVotingWeight,
      comments: [],
      tags: []
    };
  }
  
  /**
   * Emit telemetry event for strategy approval status
   */
  private emitApprovalEvent(strategyId: string, approval: StrategyApprovalMetadata): void {
    if (!this.config.emitDetailedTelemetry) return;
    
    this.telemetry.emit('governance.strategy_approval', {
      strategyId,
      approvalId: approval.approvalId,
      status: approval.status,
      votesFor: approval.votesFor,
      votesAgainst: approval.votesAgainst,
      timestamp: Date.now()
    });
  }
  
  /**
   * Start the expiration checker interval
   */
  private startExpirationChecker(): void {
    // Check every hour
    setInterval(() => {
      const now = Date.now();
      
      // Find expired approvals
      for (const [strategyId, approval] of this.approvals.entries()) {
        if (
          approval.status === StrategyApprovalStatus.PENDING &&
          approval.expiresAt < now
        ) {
          // Mark as expired
          approval.status = StrategyApprovalStatus.EXPIRED;
          approval.updatedAt = now;
          this.approvals.set(strategyId, approval);
          
          logger.info(`Strategy approval for ${strategyId} expired`);
          
          // Notify callback
          if (this.approvalCallbacks.has(strategyId)) {
            const callback = this.approvalCallbacks.get(strategyId)!;
            callback(StrategyApprovalStatus.EXPIRED, approval);
            this.approvalCallbacks.delete(strategyId);
          }
          
          // Clean up
          this.pendingStrategies.delete(strategyId);
          
          // Emit telemetry
          this.emitApprovalEvent(strategyId, approval);
        }
      }
    }, 60 * 60 * 1000); // 1 hour
  }
  
  /**
   * Calculate risk metrics for a strategy
   */
  private calculateStrategyRisk(strategy: StrategyGenome): number {
    // Simplified risk calculation - would be more complex in real implementation
    // This would use strategy volatility, max drawdown, and other risk metrics
    return 0.5; // Medium risk
  }
  
  /**
   * Check if a strategy is considered high risk
   */
  private isHighRiskStrategy(strategy: StrategyGenome): boolean {
    return this.calculateStrategyRisk(strategy) > 0.7;
  }
} 