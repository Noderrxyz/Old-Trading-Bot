/**
 * Slashing Engine Service
 * 
 * Service for processing trust violations and creating slashing proposals
 */

import { RedisService, GovernanceProposal, TrustViolation } from './RedisService';
import { WebSocketService } from './WebSocketService';

// Constants for slashing calculations
const MIN_TRUST_THRESHOLD = 60; // Minimum trust score before slashing is considered
const MIN_VIOLATIONS_FOR_SLASH = 2; // Minimum number of violations required for slashing
const BASE_SLASH_AMOUNT = 10000; // Base amount for slashing
const GOVERNANCE_VIOLATION_MULTIPLIER = 2.0; // Multiplier for governance violations
const MALICIOUS_OVERRIDE_MULTIPLIER = 3.0; // Multiplier for malicious overrides
const REPEAT_OFFENSE_MULTIPLIER = 1.5; // Multiplier for repeat offenses

/**
 * Violation types and their severity
 */
enum ViolationType {
  GOVERNANCE_ABSTENTION = 'governance_abstention',
  MALICIOUS_OVERRIDE = 'malicious_override',
  CONSENSUS_VIOLATION = 'consensus_violation',
  RESOURCE_MISUSE = 'resource_misuse',
  PARAMETER_MANIPULATION = 'parameter_manipulation',
  TRUST_DECAY = 'trust_decay'
}

/**
 * Violation severity mapping
 */
const VIOLATION_SEVERITY: Record<ViolationType, number> = {
  [ViolationType.GOVERNANCE_ABSTENTION]: 1.0,
  [ViolationType.MALICIOUS_OVERRIDE]: 3.0,
  [ViolationType.CONSENSUS_VIOLATION]: 2.5,
  [ViolationType.RESOURCE_MISUSE]: 1.5,
  [ViolationType.PARAMETER_MANIPULATION]: 2.0,
  [ViolationType.TRUST_DECAY]: 1.0
};

/**
 * Slashing Engine Service
 */
export class SlashingEngine {
  private static instance: SlashingEngine;
  private redisService: RedisService;
  private wsService: WebSocketService;
  private slashingInterval: number | null = null;
  private intervalMs: number = 3600000; // Default to 1 hour
  
  /**
   * Create a new Slashing Engine
   */
  private constructor() {
    this.redisService = RedisService.getInstance();
    this.wsService = WebSocketService.getInstance();
  }

  /**
   * Get the Slashing Engine instance (singleton)
   */
  public static getInstance(): SlashingEngine {
    if (!SlashingEngine.instance) {
      SlashingEngine.instance = new SlashingEngine();
    }
    return SlashingEngine.instance;
  }

  /**
   * Start the slashing engine
   * @param intervalMs Interval in milliseconds (default: 1 hour)
   */
  public start(intervalMs: number = this.intervalMs): void {
    // Clear any existing interval
    if (this.slashingInterval) {
      clearInterval(this.slashingInterval);
    }
    
    this.intervalMs = intervalMs;
    
    // Run once immediately
    this.scanViolationsAndSlash();
    
    // Start interval
    this.slashingInterval = window.setInterval(() => {
      this.scanViolationsAndSlash();
    }, this.intervalMs);
    
    console.log(`Slashing Engine started with ${this.intervalMs}ms interval`);
  }

  /**
   * Stop the slashing engine
   */
  public stop(): void {
    if (this.slashingInterval) {
      clearInterval(this.slashingInterval);
      this.slashingInterval = null;
      console.log('Slashing Engine stopped');
    }
  }

  /**
   * Scan for violations and create slashing proposals
   */
  public async scanViolationsAndSlash(): Promise<void> {
    try {
      // Get all clusters
      const balances = await this.redisService.getAllTreasuryBalances();
      const clusterIds = Object.keys(balances);
      
      // Process each cluster
      for (const clusterId of clusterIds) {
        await this.processClusterViolations(clusterId, balances[clusterId]);
      }
    } catch (error) {
      console.error('Error in violation scanning:', error);
    }
  }

  /**
   * Process violations for a specific cluster
   * @param clusterId Cluster ID
   * @param treasuryBalance Treasury balance
   */
  private async processClusterViolations(clusterId: string, treasuryBalance: number): Promise<void> {
    try {
      // Get trust score
      const trustScore = await this.redisService.getTrustScore(clusterId);
      
      // Skip if trust score is above threshold
      if (trustScore >= MIN_TRUST_THRESHOLD) {
        return;
      }
      
      // Get recent violations
      const violations = await this.redisService.getTrustViolations(clusterId);
      
      // Filter for unresolved violations only
      const unresolvedViolations = violations.filter(v => !v.resolved);
      
      // Skip if not enough violations
      if (unresolvedViolations.length < MIN_VIOLATIONS_FOR_SLASH) {
        return;
      }
      
      // Group violations by type
      const violationsByType = this.groupViolationsByType(unresolvedViolations);
      const violationTypes = Object.keys(violationsByType);
      
      // Calculate total severity and reason
      let totalSeverity = 0;
      const reasons: string[] = [];
      
      for (const type of violationTypes) {
        const count = violationsByType[type].length;
        if (count > 0) {
          const severity = VIOLATION_SEVERITY[type as ViolationType] || 1.0;
          totalSeverity += severity * count;
          reasons.push(`${count}x ${this.formatViolationType(type)}`);
        }
      }
      
      // Apply repeat offense multiplier if this isn't the first offense
      // In production, we'd check historical data to see if this cluster had previous slashes
      const hasRecentSlashes = Math.random() > 0.7; // Mock implementation
      const repeatMultiplier = hasRecentSlashes ? REPEAT_OFFENSE_MULTIPLIER : 1.0;
      
      // Calculate penalty amount
      const penalty = Math.min(
        treasuryBalance * 0.2, // Cap at 20% of treasury
        BASE_SLASH_AMOUNT * totalSeverity * repeatMultiplier
      );
      
      // Only slash if penalty is significant
      if (penalty < BASE_SLASH_AMOUNT) {
        return;
      }
      
      // Calculate confidence score
      const confidence = 0.7 + Math.min(0.3, (totalSeverity * 0.1));
      
      // Create slashing proposal
      await this.createSlashProposal(
        clusterId,
        Math.floor(penalty),
        reasons.join(' + '),
        confidence
      );
      
    } catch (error) {
      console.error(`Error processing violations for cluster ${clusterId}:`, error);
    }
  }

  /**
   * Group violations by type
   * @param violations Violations
   * @returns Map of violation types to violations
   */
  private groupViolationsByType(violations: TrustViolation[]): Record<string, TrustViolation[]> {
    const result: Record<string, TrustViolation[]> = {};
    
    for (const violation of violations) {
      if (!result[violation.violationType]) {
        result[violation.violationType] = [];
      }
      result[violation.violationType].push(violation);
    }
    
    return result;
  }

  /**
   * Format violation type for display
   * @param type Violation type
   * @returns Formatted type
   */
  private formatViolationType(type: string): string {
    return type
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Create a slashing proposal
   * @param clusterId Cluster ID
   * @param amount Amount to slash
   * @param reason Reason for slashing
   * @param confidence Confidence score
   */
  private async createSlashProposal(
    clusterId: string,
    amount: number,
    reason: string,
    confidence: number
  ): Promise<void> {
    try {
      // Create governance proposal
      const proposal: GovernanceProposal = {
        title: `Treasury Slash: ${clusterId}`,
        description: `Slash ${amount.toLocaleString()} from ${clusterId} due to trust violations.`,
        category: 'slash',
        proposerId: 'meta-agent-security',
        proposerName: 'Security Meta-Agent',
        deadline: new Date(Date.now() + 86400000).toISOString(), // 24 hours
        details: {
          clusterId,
          amount,
          reason,
          confidence,
          type: 'slash',
          trustAdjustment: -15 // Trust score penalty
        }
      };
      
      const proposalId = await this.redisService.createProposal(proposal);
      
      // Emit WebSocket event
      if (this.wsService.isConnected()) {
        // Broadcasting is handled by the server, but we emit the event for UI updates
        console.log('Emitted slash proposal:', {
          type: 'SLASH_ENFORCED',
          cluster: clusterId,
          amount,
          reason,
          confidence
        });
      }
      
      console.log(`Created slash proposal ${proposalId} for ${clusterId} for ${amount}`);
    } catch (error) {
      console.error('Error creating slash proposal:', error);
    }
  }
} 