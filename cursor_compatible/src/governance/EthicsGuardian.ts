import { RedisService } from '../services/redis/RedisService.js';
import { Logger } from '../utils/logger.js';
import { EventEmitter } from '../utils/EventEmitter.js';
import { ETHICS_RULES, ETHICS_THRESHOLDS } from '../config/ethics.rules.js';
import { ValueAlignmentProfile } from '../types/agent.ethics.js';

/**
 * Action type being evaluated for ethical compliance
 */
export interface AgentAction {
  agentId: string;
  actionType: 'trade' | 'signal' | 'recommendation' | 'message' | 'mutation';
  actionId: string; 
  timestamp: number;
  payload: Record<string, any>;
  contextData?: {
    marketImpact?: number;
    assetConcentration?: number;
    signalStrength?: number;
    inversionRate?: number;
    targetAudience?: string[];
    recentActions?: string[];
    [key: string]: any;
  };
}

/**
 * Violation details when ethics check fails
 */
export interface EthicsViolation {
  ruleId: string;
  severity: 'warn' | 'block' | 'ban';
  description: string;
  violatedValue: string;
  timestamp: number;
  actionId: string;
  contextData?: Record<string, any>;
  remediation?: string;
}

/**
 * Configuration for the Ethics Guardian
 */
export interface EthicsGuardianConfig {
  enforcementEnabled: boolean;
  keyPrefix: string;
  notifyAdmin: boolean;
  logViolations: boolean;
  historyRetentionDays: number;
  autoBlockThreshold: number;
  autoBanThreshold: number;
}

/**
 * Default ethics guardian configuration
 */
const DEFAULT_CONFIG: EthicsGuardianConfig = {
  enforcementEnabled: true,
  keyPrefix: 'ethics:',
  notifyAdmin: true,
  logViolations: true,
  historyRetentionDays: 90,
  autoBlockThreshold: 0.85,
  autoBanThreshold: 0.95,
};

/**
 * The EthicsGuardian evaluates agent actions against ethical rules
 * and enforces value alignment across the agent ecosystem.
 */
export class EthicsGuardian {
  private redis: RedisService;
  private logger: Logger;
  private eventEmitter: EventEmitter;
  private config: EthicsGuardianConfig;

  constructor(
    redis: RedisService,
    eventEmitter: EventEmitter,
    config: Partial<EthicsGuardianConfig> = {}
  ) {
    this.redis = redis;
    this.eventEmitter = eventEmitter;
    this.logger = new Logger('EthicsGuardian');
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Evaluate an agent action against ethical rules
   * @returns EthicsViolation or null if no violation detected
   */
  public async evaluateEthics(action: AgentAction): Promise<EthicsViolation | null> {
    try {
      // Skip evaluation if enforcement is disabled
      if (!this.config.enforcementEnabled) {
        return null;
      }

      // Get agent's alignment profile
      const alignmentProfile = await this.getAlignmentProfile(action.agentId);
      
      // Check each rule against the action
      for (const rule of ETHICS_RULES) {
        const violation = await this.checkRule(rule, action, alignmentProfile);
        
        if (violation) {
          // Log and store violation
          if (this.config.logViolations) {
            this.logger.warn(
              `Ethics violation detected: ${violation.ruleId} - ${violation.description}`,
              { agentId: action.agentId, actionId: action.actionId, severity: violation.severity }
            );
          }
          
          // Store violation in history
          await this.recordViolation(action.agentId, violation);
          
          // Emit event
          this.eventEmitter.emit('ethics:violation', {
            violation,
            agentId: action.agentId,
            actionId: action.actionId,
            timestamp: Date.now(),
          });
          
          // Notify admin if needed
          if (this.config.notifyAdmin && (violation.severity === 'block' || violation.severity === 'ban')) {
            this.notifyAdmin(action.agentId, violation);
          }
          
          return violation;
        }
      }
      
      // Record compliance
      await this.recordCompliance(action.agentId, action.actionId);
      
      return null;
    } catch (error) {
      this.logger.error('Error evaluating ethics', error);
      
      // Fail safe - block action on evaluation error
      return {
        ruleId: 'E999',
        severity: 'block',
        description: 'Ethics evaluation failed, blocking action as a precaution',
        violatedValue: 'system_integrity',
        timestamp: Date.now(),
        actionId: action.actionId,
        remediation: 'Contact system administrator',
      };
    }
  }

  /**
   * Check a specific rule against an action
   */
  private async checkRule(
    rule: any, 
    action: AgentAction,
    profile: ValueAlignmentProfile
  ): Promise<EthicsViolation | null> {
    // Skip rules that don't apply to this action type
    if (rule.applicableActions && !rule.applicableActions.includes(action.actionType)) {
      return null;
    }

    // Check threshold-based rules
    if (rule.thresholdCheck && action.contextData) {
      const contextValue = action.contextData[rule.thresholdCheck.field];
      
      if (contextValue !== undefined) {
        const threshold = ETHICS_THRESHOLDS[rule.thresholdCheck.threshold];
        
        if (rule.thresholdCheck.operator === '>' && contextValue > threshold) {
          return this.createViolation(rule, action);
        } else if (rule.thresholdCheck.operator === '<' && contextValue < threshold) {
          return this.createViolation(rule, action);
        } else if (rule.thresholdCheck.operator === '=' && contextValue === threshold) {
          return this.createViolation(rule, action);
        }
      }
    }
    
    // Check for value alignment violations
    if (rule.valueCheck && profile.coreValues) {
      if (rule.valueCheck.requiresValue && !profile.coreValues.includes(rule.valueCheck.value)) {
        return this.createViolation(rule, action);
      }
      
      if (rule.valueCheck.prohibitsValue && profile.coreValues.includes(rule.valueCheck.value)) {
        return this.createViolation(rule, action);
      }
    }
    
    // Check for pattern-based rules (e.g., action sequences)
    if (rule.patternCheck && action.contextData?.recentActions) {
      const pattern = rule.patternCheck.pattern;
      const recentActions = action.contextData.recentActions;
      
      // Simple pattern matching, can be enhanced for more complex patterns
      if (rule.patternCheck.type === 'sequence' && this.matchesSequence(recentActions, pattern)) {
        return this.createViolation(rule, action);
      }
    }
    
    // Custom rule evaluation (for more complex rules)
    if (rule.customEval && typeof rule.customEval === 'function') {
      const result = await rule.customEval(action, profile);
      if (result) {
        return this.createViolation(rule, action, result.contextData);
      }
    }
    
    return null;
  }

  /**
   * Create a violation object from a rule match
   */
  private createViolation(
    rule: any, 
    action: AgentAction,
    additionalContext?: Record<string, any>
  ): EthicsViolation {
    return {
      ruleId: rule.id,
      severity: rule.severity,
      description: rule.description,
      violatedValue: rule.violatedValue,
      timestamp: Date.now(),
      actionId: action.actionId,
      contextData: { ...action.contextData, ...additionalContext },
      remediation: rule.remediation,
    };
  }

  /**
   * Check if a sequence of actions matches a pattern
   */
  private matchesSequence(actions: string[], pattern: string[]): boolean {
    if (pattern.length > actions.length) return false;
    
    for (let i = 0; i <= actions.length - pattern.length; i++) {
      let matches = true;
      
      for (let j = 0; j < pattern.length; j++) {
        if (actions[i + j] !== pattern[j]) {
          matches = false;
          break;
        }
      }
      
      if (matches) return true;
    }
    
    return false;
  }

  /**
   * Record a violation in the agent's history
   */
  private async recordViolation(agentId: string, violation: EthicsViolation): Promise<void> {
    const key = `${this.config.keyPrefix}violations:${agentId}`;
    const data = JSON.stringify(violation);
    
    // Store in time series
    await this.redis.zadd(key, violation.timestamp, data);
    
    // Set expiry
    await this.redis.expire(key, this.config.historyRetentionDays * 24 * 60 * 60);
    
    // Increment violation counter
    const countKey = `${this.config.keyPrefix}violation_count:${agentId}`;
    await this.redis.incr(countKey);
    await this.redis.expire(countKey, this.config.historyRetentionDays * 24 * 60 * 60);
  }

  /**
   * Record compliance for auditing purposes
   */
  private async recordCompliance(agentId: string, actionId: string): Promise<void> {
    const key = `${this.config.keyPrefix}compliance:${agentId}`;
    const data = JSON.stringify({
      actionId,
      timestamp: Date.now(),
    });
    
    // Store in time series
    await this.redis.zadd(key, Date.now(), data);
    
    // Set expiry
    await this.redis.expire(key, this.config.historyRetentionDays * 24 * 60 * 60);
  }

  /**
   * Notify administrators of serious violations
   */
  private notifyAdmin(agentId: string, violation: EthicsViolation): void {
    // This could send an email, Slack message, or trigger an alert
    this.eventEmitter.emit('admin:notification', {
      type: 'ethics_violation',
      agentId,
      violation,
      timestamp: Date.now(),
    });
  }

  /**
   * Get an agent's alignment profile
   */
  public async getAlignmentProfile(agentId: string): Promise<ValueAlignmentProfile> {
    const key = `${this.config.keyPrefix}alignment:${agentId}`;
    const data = await this.redis.get(key);
    
    if (!data) {
      // Create default profile if none exists
      const defaultProfile: ValueAlignmentProfile = {
        agentId,
        coreValues: ['do_no_harm', 'fair_access', 'transparency'],
        trustAdjustments: [],
        mutationHistory: [],
        lastAlignedEpoch: Date.now(),
      };
      
      await this.saveAlignmentProfile(defaultProfile);
      return defaultProfile;
    }
    
    return JSON.parse(data);
  }

  /**
   * Save an agent's alignment profile
   */
  public async saveAlignmentProfile(profile: ValueAlignmentProfile): Promise<void> {
    const key = `${this.config.keyPrefix}alignment:${profile.agentId}`;
    await this.redis.set(key, JSON.stringify(profile));
    await this.redis.expire(key, this.config.historyRetentionDays * 24 * 60 * 60);
  }

  /**
   * Update an agent's alignment profile
   */
  public async updateAlignmentProfile(
    agentId: string,
    updates: Partial<ValueAlignmentProfile>
  ): Promise<ValueAlignmentProfile> {
    const profile = await this.getAlignmentProfile(agentId);
    
    const updatedProfile: ValueAlignmentProfile = {
      ...profile,
      ...updates,
      lastAlignedEpoch: Date.now(),
    };
    
    await this.saveAlignmentProfile(updatedProfile);
    
    // Emit event
    this.eventEmitter.emit('ethics:alignment_updated', {
      agentId,
      timestamp: Date.now(),
      updates,
    });
    
    return updatedProfile;
  }

  /**
   * Get recent violations for an agent
   */
  public async getRecentViolations(
    agentId: string,
    limit: number = 10
  ): Promise<EthicsViolation[]> {
    const key = `${this.config.keyPrefix}violations:${agentId}`;
    
    // Get most recent violations
    const data = await this.redis.zrevrange(key, 0, limit - 1);
    
    return data.map(item => JSON.parse(item));
  }

  /**
   * Check if an agent is in good standing
   */
  public async isAgentInGoodStanding(agentId: string): Promise<boolean> {
    const countKey = `${this.config.keyPrefix}violation_count:${agentId}`;
    const count = await this.redis.get(countKey);
    
    return !count || parseInt(count) < 5; // Arbitrary threshold
  }

  /**
   * Get alignment reports for all agents
   */
  public async getAllAgentAlignmentReports(): Promise<Record<string, any>[]> {
    const keys = await this.redis.keys(`${this.config.keyPrefix}alignment:*`);
    
    const reports = [];
    for (const key of keys) {
      const agentId = key.split(':').pop() as string;
      const profile = await this.getAlignmentProfile(agentId);
      const violationCount = await this.getViolationCount(agentId);
      
      reports.push({
        agentId,
        coreValues: profile.coreValues,
        violationCount,
        lastAligned: profile.lastAlignedEpoch,
        inGoodStanding: violationCount < 5,
      });
    }
    
    return reports;
  }

  /**
   * Get violation count for an agent
   */
  private async getViolationCount(agentId: string): Promise<number> {
    const countKey = `${this.config.keyPrefix}violation_count:${agentId}`;
    const count = await this.redis.get(countKey);
    
    return count ? parseInt(count) : 0;
  }

  /**
   * Reset violation count for an agent (admin function)
   */
  public async resetViolations(agentId: string): Promise<void> {
    const countKey = `${this.config.keyPrefix}violation_count:${agentId}`;
    await this.redis.del(countKey);
    
    this.logger.info(`Reset violations for agent ${agentId}`);
  }

  /**
   * Check if agent should be automatically sanctioned based on violation count
   */
  public async checkForAutoSanctions(agentId: string): Promise<{ block: boolean; ban: boolean }> {
    const violations = await this.getRecentViolations(agentId, 100);
    
    if (!violations.length) {
      return { block: false, ban: false };
    }
    
    // Calculate severity score (0-1) based on recent violations
    const totalSeverity = violations.reduce((sum, v) => {
      switch (v.severity) {
        case 'warn': return sum + 0.2;
        case 'block': return sum + 0.5;
        case 'ban': return sum + 1.0;
        default: return sum;
      }
    }, 0);
    
    const severityScore = Math.min(1, totalSeverity / 10); // Normalize to 0-1
    
    return {
      block: severityScore >= this.config.autoBlockThreshold,
      ban: severityScore >= this.config.autoBanThreshold,
    };
  }
} 