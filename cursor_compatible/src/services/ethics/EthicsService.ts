import { RedisService } from '../redis/RedisService.js';
import { 
  EthicsRule, 
  EthicsViolation, 
  ValueAlignmentProfile, 
  EthicsSystemConfig, 
  EthicsPriority,
  EthicsMutation,
  EthicsMutationRequest
} from '../../types/agent.ethics.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';

/**
 * Service for managing agent ethics, violations, and alignment
 */
export class EthicsService {
  private readonly redis: RedisService;
  private readonly keyPrefix: string = 'ethics:';
  private config: EthicsSystemConfig;
  private rules: Map<string, EthicsRule> = new Map();
  
  constructor(redis: RedisService, config: EthicsSystemConfig) {
    this.redis = redis;
    this.config = config;
    this.loadRules();
  }
  
  /**
   * Load all ethics rules from storage
   */
  private async loadRules(): Promise<void> {
    try {
      const rulesJson = await this.redis.get(`${this.keyPrefix}rules`);
      if (rulesJson) {
        const rules = JSON.parse(rulesJson) as EthicsRule[];
        rules.forEach(rule => this.rules.set(rule.id, rule));
      } else {
        logger.warn('No ethics rules found in storage, using default rules');
        // Load default rules if needed
      }
    } catch (error) {
      logger.error('Failed to load ethics rules', { error });
    }
  }
  
  /**
   * Get a specific ethics rule by ID
   */
  public getRule(ruleId: string): EthicsRule | undefined {
    return this.rules.get(ruleId);
  }
  
  /**
   * Get all ethics rules
   */
  public getAllRules(): EthicsRule[] {
    return Array.from(this.rules.values());
  }
  
  /**
   * Add or update an ethics rule
   */
  public async updateRule(rule: EthicsRule): Promise<void> {
    this.rules.set(rule.id, rule);
    await this.saveRules();
  }
  
  /**
   * Save all ethics rules to storage
   */
  private async saveRules(): Promise<void> {
    try {
      const rules = Array.from(this.rules.values());
      await this.redis.set(`${this.keyPrefix}rules`, JSON.stringify(rules));
    } catch (error) {
      logger.error('Failed to save ethics rules', { error });
    }
  }
  
  /**
   * Record an ethics violation for an agent
   */
  public async recordViolation(violation: Omit<EthicsViolation, 'id' | 'timestamp'>): Promise<EthicsViolation> {
    const rule = this.getRule(violation.ruleId);
    if (!rule) {
      throw new Error(`Ethics rule ${violation.ruleId} not found`);
    }
    
    const fullViolation: EthicsViolation = {
      ...violation,
      id: uuidv4(),
      timestamp: Date.now(),
    };
    
    const violationKey = `${this.keyPrefix}violations:${violation.agentId}:${fullViolation.id}`;
    await this.redis.set(violationKey, JSON.stringify(fullViolation), this.config.violationTTL);
    
    // Add to time series for analytics
    await this.redis.timeSeries.add(
      `${this.keyPrefix}violations:ts`,
      fullViolation.timestamp,
      1,
      { 
        agentId: fullViolation.agentId,
        ruleId: fullViolation.ruleId,
        priority: fullViolation.priority
      }
    );
    
    // Update agent's violation count
    await this.updateViolationStats(violation.agentId, fullViolation);
    
    // Update agent's trust score if configured
    if (this.config.autoEnforcement) {
      await this.updateTrustScore(violation.agentId, fullViolation.trustScoreImpact);
    }
    
    return fullViolation;
  }
  
  /**
   * Update violation statistics for an agent
   */
  private async updateViolationStats(agentId: string, violation: EthicsViolation): Promise<void> {
    try {
      const profileKey = `${this.keyPrefix}profile:${agentId}`;
      const profileJson = await this.redis.get(profileKey);
      
      if (profileJson) {
        const profile = JSON.parse(profileJson) as ValueAlignmentProfile;
        profile.violationCount += 1;
        profile.lastViolationTimestamp = violation.timestamp;
        
        // Recalculate alignment score
        profile.alignmentScore = await this.calculateAlignmentScore(agentId);
        
        await this.redis.set(profileKey, JSON.stringify(profile));
      }
    } catch (error) {
      logger.error('Failed to update violation stats', { error, agentId });
    }
  }
  
  /**
   * Get all violations for an agent
   */
  public async getViolations(agentId: string, limit: number = 100, offset: number = 0): Promise<EthicsViolation[]> {
    const keys = await this.redis.keys(`${this.keyPrefix}violations:${agentId}:*`);
    const sortedKeys = keys.sort().reverse().slice(offset, offset + limit);
    
    const violations: EthicsViolation[] = [];
    for (const key of sortedKeys) {
      const violationJson = await this.redis.get(key);
      if (violationJson) {
        violations.push(JSON.parse(violationJson));
      }
    }
    
    return violations;
  }
  
  /**
   * Get an agent's alignment profile
   */
  public async getAlignmentProfile(agentId: string): Promise<ValueAlignmentProfile | null> {
    const profileJson = await this.redis.get(`${this.keyPrefix}profile:${agentId}`);
    return profileJson ? JSON.parse(profileJson) : null;
  }
  
  /**
   * Update an agent's alignment profile
   */
  public async updateAlignmentProfile(profile: ValueAlignmentProfile): Promise<void> {
    profile.updatedAt = Date.now();
    await this.redis.set(`${this.keyPrefix}profile:${profile.agentId}`, JSON.stringify(profile));
  }
  
  /**
   * Calculate alignment score for an agent
   */
  private async calculateAlignmentScore(agentId: string): Promise<number> {
    const params = this.config.alignmentScoreParams;
    const profile = await this.getAlignmentProfile(agentId);
    
    if (!profile) return 0;
    
    // Get recent violations (last 30 days)
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentViolations = await this.getViolationsSince(agentId, thirtyDaysAgo);
    
    // Base score
    let score = 100;
    
    // Deduct for violations, weighted by severity
    recentViolations.forEach(v => {
      const severityMultiplier = params.severityMultiplier[v.priority] || 1;
      score -= params.violationPenalty * severityMultiplier;
    });
    
    // Add bonus for time since last violation
    if (profile.lastViolationTimestamp) {
      const daysSinceViolation = (Date.now() - profile.lastViolationTimestamp) / (24 * 60 * 60 * 1000);
      score += Math.min(params.timeSinceViolationBonus * daysSinceViolation, 20);
    }
    
    // Cap score between 0-100
    return Math.max(0, Math.min(100, score));
  }
  
  /**
   * Get violations since a specific timestamp
   */
  private async getViolationsSince(agentId: string, timestamp: number): Promise<EthicsViolation[]> {
    const allViolations = await this.getViolations(agentId, 1000);
    return allViolations.filter(v => v.timestamp >= timestamp);
  }
  
  /**
   * Update an agent's trust score based on ethics violations
   */
  private async updateTrustScore(agentId: string, impact: number): Promise<void> {
    // TODO: Integrate with TrustScoreService once available
    logger.info('Trust score update would be applied', { agentId, impact });
  }
  
  /**
   * Process a mutation request for an agent's ethical alignment
   */
  public async processMutationRequest(request: EthicsMutationRequest): Promise<EthicsMutation> {
    // Validate the request
    if (!request.agentId || !request.requestedChanges) {
      throw new Error('Invalid mutation request');
    }
    
    // Check if we should automatically approve this request based on urgency/history
    const shouldAutoApprove = await this.shouldAutoApproveMutation(request);
    
    const mutation: EthicsMutation = {
      id: uuidv4(),
      timestamp: Date.now(),
      agentId: request.agentId,
      description: request.justification,
      affectedValues: Object.keys(request.requestedChanges),
      magnitude: this.calculateMutationMagnitude(request),
      source: 'self',
      approved: shouldAutoApprove
    };
    
    // Save the mutation
    await this.redis.set(
      `${this.keyPrefix}mutations:${request.agentId}:${mutation.id}`,
      JSON.stringify(mutation)
    );
    
    // If auto-approved, apply the changes
    if (shouldAutoApprove) {
      await this.applyMutation(mutation, request.requestedChanges);
    }
    
    return mutation;
  }
  
  /**
   * Calculate the magnitude of a mutation request
   */
  private calculateMutationMagnitude(request: EthicsMutationRequest): number {
    // A simple implementation - could be more sophisticated
    const changeCount = Object.keys(request.requestedChanges).length;
    return Math.min(changeCount * 0.2, 1.0);
  }
  
  /**
   * Determine if a mutation request should be auto-approved
   */
  private async shouldAutoApproveMutation(request: EthicsMutationRequest): Promise<boolean> {
    // Example logic - this could be more sophisticated
    const profile = await this.getAlignmentProfile(request.agentId);
    
    if (!profile) return false;
    
    // Auto-approve for agents with high alignment scores and low magnitude changes
    if (profile.alignmentScore > 90 && this.calculateMutationMagnitude(request) < 0.3) {
      return true;
    }
    
    // Auto-approve low urgency requests from agents with good standing
    if (request.urgency === 'low' && profile.violationCount < 5) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Apply an approved mutation to an agent's alignment profile
   */
  private async applyMutation(
    mutation: EthicsMutation, 
    changes: Partial<ValueAlignmentProfile>
  ): Promise<void> {
    const profile = await this.getAlignmentProfile(mutation.agentId);
    
    if (!profile) {
      throw new Error(`No alignment profile found for agent ${mutation.agentId}`);
    }
    
    // Apply the changes
    const updatedProfile = {
      ...profile,
      ...changes,
      updatedAt: Date.now()
    };
    
    await this.updateAlignmentProfile(updatedProfile);
    
    logger.info('Applied ethics mutation', { 
      agentId: mutation.agentId, 
      mutationId: mutation.id 
    });
  }
  
  /**
   * Generate an ethics report for an agent
   */
  public async generateReport(agentId: string): Promise<any> {
    const profile = await this.getAlignmentProfile(agentId);
    const recentViolations = await this.getViolations(agentId, 10);
    
    // Calculate trends and statistics
    const violationsByCategory = this.categorizeViolations(recentViolations);
    const trends = await this.calculateTrends(agentId);
    
    return {
      agentId,
      timestamp: Date.now(),
      alignmentProfile: profile,
      alignmentScore: profile?.alignmentScore || 0,
      recentViolations,
      violationsByCategory,
      trends,
      recommendations: this.generateRecommendations(profile, recentViolations, trends)
    };
  }
  
  /**
   * Categorize violations by their rule category
   */
  private categorizeViolations(violations: EthicsViolation[]): Record<string, number> {
    const categories: Record<string, number> = {};
    
    violations.forEach(violation => {
      const rule = this.getRule(violation.ruleId);
      if (rule) {
        const category = rule.category;
        categories[category] = (categories[category] || 0) + 1;
      }
    });
    
    return categories;
  }
  
  /**
   * Calculate trends in ethical behavior
   */
  private async calculateTrends(agentId: string): Promise<any> {
    // Get violations for different time periods
    const now = Date.now();
    const last7Days = now - (7 * 24 * 60 * 60 * 1000);
    const last30Days = now - (30 * 24 * 60 * 60 * 1000);
    const last90Days = now - (90 * 24 * 60 * 60 * 1000);
    
    const violations7Days = await this.getViolationsSince(agentId, last7Days);
    const violations30Days = await this.getViolationsSince(agentId, last30Days);
    const violations90Days = await this.getViolationsSince(agentId, last90Days);
    
    // Calculate rates
    const rate7Days = violations7Days.length / 7;
    const rate30Days = violations30Days.length / 30;
    const rate90Days = violations90Days.length / 90;
    
    // Calculate trend (improving or worsening)
    const trend = rate7Days < rate30Days ? 'improving' : 'worsening';
    
    return {
      violationsLast7Days: violations7Days.length,
      violationsLast30Days: violations30Days.length,
      violationsLast90Days: violations90Days.length,
      rate7Days,
      rate30Days,
      rate90Days,
      trend
    };
  }
  
  /**
   * Generate recommendations based on ethics profile and violations
   */
  private generateRecommendations(
    profile: ValueAlignmentProfile | null,
    violations: EthicsViolation[],
    trends: any
  ): string[] {
    const recommendations: string[] = [];
    
    if (!profile) return ['Create an ethics alignment profile'];
    
    // Check for concerning trends
    if (trends.trend === 'worsening' && trends.rate7Days > 0.5) {
      recommendations.push('Implement stricter monitoring to address increasing violation rate');
    }
    
    // Check for repeat violations
    const violationCounts = new Map<string, number>();
    violations.forEach(v => {
      violationCounts.set(v.ruleId, (violationCounts.get(v.ruleId) || 0) + 1);
    });
    
    // Find repeat violations
    violationCounts.forEach((count, ruleId) => {
      if (count >= 3) {
        const rule = this.getRule(ruleId);
        if (rule) {
          recommendations.push(`Address repeated violations of rule: ${rule.name}`);
        }
      }
    });
    
    // Profile-based recommendations
    if (profile.alignmentScore < 70) {
      recommendations.push('Consider ethics training to improve alignment score');
    }
    
    if (profile.violationCount > 20) {
      recommendations.push('Review historical violations and implement preventative measures');
    }
    
    return recommendations;
  }
} 