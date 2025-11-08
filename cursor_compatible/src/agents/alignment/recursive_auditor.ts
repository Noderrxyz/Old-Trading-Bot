/**
 * Recursive Alignment Auditor (RAA)
 * 
 * Enables agents to recursively audit their behavior, reasoning, and outcomes
 * against alignment anchors. Provides mechanisms to detect drift and violations.
 */

import {
  AlignmentAnchorService,
  AlignmentAnchor,
  AnchorCategory,
  AnchorPriority
} from './alignment_anchor.js';

import {
  AlignmentAuditResult,
  AnchorViolation,
  AnchorCheckResult,
  AuditParameters,
  AggregatedAuditMetrics,
  ReasoningAuditResult
} from './audit.types.js';

/**
 * Service for auditing agent alignment against anchors
 */
export class RecursiveAlignmentAuditor {
  /**
   * Redis client for persistence
   */
  private redis: any;
  
  /**
   * Anchor service for retrieving alignment anchors
   */
  private anchorService: AlignmentAnchorService;
  
  /**
   * Logger interface
   */
  private logger: any;
  
  /**
   * Constructor
   * @param redis Redis client for persistence
   * @param anchorService Service for accessing alignment anchors
   * @param logger Logger for audit events
   */
  constructor(
    redis: any,
    anchorService: AlignmentAnchorService,
    logger: any
  ) {
    this.redis = redis;
    this.anchorService = anchorService;
    this.logger = logger || console;
  }
  
  /**
   * Conduct a full alignment audit on an agent
   * @param agentId Agent ID to audit
   * @param contextId Optional context ID 
   * @param recursionDepth Depth of recursive analysis
   * @returns Detailed audit report
   */
  public async conductAudit(
    agentId: string,
    contextId: string = 'general',
    recursionDepth: number = 3
  ): Promise<AlignmentAuditReport> {
    this.logger.info(`[RAA] Starting alignment audit for agent ${agentId} with depth ${recursionDepth}`);
    
    const startTime = Date.now();
    
    // Get all anchors
    const anchors = await this.anchorService.getAllAnchors();
    if (!anchors || anchors.length === 0) {
      throw new Error('No alignment anchors found for audit');
    }
    
    // Create fingerprint of used anchors
    const anchorFingerprint = this.createAnchorFingerprint(anchors);
    
    // Retrieve agent reasoning and behavior logs
    const reasoningLogs = await this.getAgentReasoningLogs(agentId, contextId);
    const behaviorLogs = await this.getAgentBehaviorLogs(agentId, contextId);
    
    // Extract reasoning paths for deeper analysis
    const reasoningPaths = await this.extractReasoningPaths(
      agentId, 
      reasoningLogs,
      recursionDepth
    );
    
    // Audit each reasoning path
    const reasoningResults: ReasoningAuditResult[] = [];
    let totalReasoningPaths = 0;
    
    for (const path of reasoningPaths) {
      totalReasoningPaths++;
      
      const result = await this.auditReasoningPath(path, anchors);
      reasoningResults.push(result);
    }
    
    // Check each anchor against logs and results
    const checkResults: AnchorCheckResult[] = [];
    const violations: AnchorViolation[] = [];
    const categoryScores: {[key in AnchorCategory]?: number} = {};
    let totalScore = 0;
    let hasCriticalViolations = false;
    
    for (const anchor of anchors) {
      const checkResult = await this.checkAnchorCompliance(
        anchor,
        reasoningLogs,
        behaviorLogs,
        reasoningResults
      );
      
      checkResults.push(checkResult);
      
      // Track category scores
      if (!categoryScores[anchor.category]) {
        categoryScores[anchor.category] = 0;
      }
      
      categoryScores[anchor.category] = 
        (categoryScores[anchor.category] || 0) + checkResult.score;
      
      // Add violations
      if (checkResult.violated) {
        const violation: AnchorViolation = {
          anchorId: anchor.id,
          anchorCategory: anchor.category,
          severity: anchor.priority === AnchorPriority.CRITICAL ? 1.0 : 
                   anchor.priority === AnchorPriority.HIGH ? 0.7 :
                   anchor.priority === AnchorPriority.MEDIUM ? 0.4 : 0.2,
          explanation: checkResult.explanation,
          lastObserved: Date.now(),
          context: {
            violatingReasoning: reasoningLogs.find(log => 
              this.containsViolation(log, anchor)
            ),
            violatingActions: behaviorLogs.filter(log => 
              this.containsViolation(log, anchor)
            )
          }
        };
        
        violations.push(violation);
        
        // Track critical violations
        if (anchor.priority === AnchorPriority.CRITICAL) {
          hasCriticalViolations = true;
        }
      }
    }
    
    // Normalize category scores
    const categoryCount: {[key in AnchorCategory]?: number} = {};
    for (const anchor of anchors) {
      categoryCount[anchor.category] = (categoryCount[anchor.category] || 0) + 1;
    }
    
    for (const category in categoryScores) {
      if (categoryCount[category as AnchorCategory]) {
        categoryScores[category as AnchorCategory] = 
          (categoryScores[category as AnchorCategory] || 0) / 
          (categoryCount[category as AnchorCategory] || 1);
      }
    }
    
    // Calculate total score
    totalScore = Object.values(categoryScores)
      .reduce((sum, score) => sum + score, 0) / 
      Object.keys(categoryScores).length;
    
    // Adjust score based on critical violations
    if (hasCriticalViolations) {
      totalScore = Math.min(totalScore, 0.5); // Cap at 0.5 if critical violations
    }
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(violations, totalScore);
    
    // Create audit result
    const auditResult: AlignmentAuditResult = {
      agentId,
      timestamp: startTime,
      anchorFingerprint,
      recursionDepth,
      totalScore,
      categoryScores,
      violations,
      checkResults,
      hasCriticalViolations,
      recommendations,
      auditTrace: {
        startTime,
        endTime: Date.now(),
        anchorsEvaluated: anchors.length,
        reasoningPathsAnalyzed: totalReasoningPaths
      }
    };
    
    // Create aggregated metrics
    const aggregatedMetrics = this.createAggregatedMetrics(auditResult);
    
    // Store audit result
    await this.storeAuditResult(agentId, contextId, auditResult);
    
    // Log completion
    this.logger.info(
      `[RAA] Completed alignment audit for agent ${agentId} with score ${totalScore.toFixed(2)}`
    );
    
    return {
      auditResult,
      aggregatedMetrics,
      reasoningResults
    };
  }
  
  /**
   * Check if a reasoning or behavior log contains a violation of an anchor
   * @param log Log entry to check
   * @param anchor Anchor to check against
   * @returns Whether the log violates the anchor
   */
  private containsViolation(log: string, anchor: AlignmentAnchor): boolean {
    // Look for patterns in the formal representation if available
    if (anchor.formalRepresentation) {
      // Simple implementation - check if log contains patterns that violate the formal representation
      const negativePatterns = this.extractPatterns(anchor.formalRepresentation, "negative");
      for (const pattern of negativePatterns) {
        if (log.includes(pattern)) {
          return true;
        }
      }
      
      // Check if required positive patterns are missing
      const positivePatterns = this.extractPatterns(anchor.formalRepresentation, "positive");
      if (positivePatterns.length > 0) {
        let hasPositive = false;
        
        for (const pattern of positivePatterns) {
          if (log.includes(pattern)) {
            hasPositive = true;
            break;
          }
        }
        
        if (!hasPositive) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  /**
   * Extract patterns from formal representation
   * @param formalRep Formal representation string
   * @param type Type of patterns to extract (positive/negative)
   * @returns Array of extracted patterns
   */
  private extractPatterns(formalRep: string, type: 'positive' | 'negative'): string[] {
    // This is a simplified implementation
    // In a real system, this would parse the formal representation properly
    
    const patterns: string[] = [];
    
    if (formalRep) {
      const lines = formalRep.split('\n');
      const targetPrefix = type === 'positive' ? 'MUST:' : 'MUST NOT:';
      
      for (const line of lines) {
        if (line.trim().startsWith(targetPrefix)) {
          const pattern = line.substring(targetPrefix.length).trim();
          if (pattern) {
            patterns.push(pattern);
          }
        }
      }
    }
    
    return patterns;
  }
  
  /**
   * Create a fingerprint for a set of anchors
   * @param anchors Anchors to fingerprint
   * @returns Fingerprint string
   */
  private createAnchorFingerprint(anchors: AlignmentAnchor[]): string {
    // Create a deterministic string from anchors for fingerprinting
    // Sort anchors by ID to ensure consistent fingerprint
    const sortedAnchors = [...anchors].sort((a, b) => a.id.localeCompare(b.id));
    
    // Combine all anchor IDs and versions
    let fingerprintData = '';
    for (const anchor of sortedAnchors) {
      fingerprintData += `${anchor.id}:${anchor.version}:`;
    }
    
    // Create a simple hash
    return this.simpleHash(fingerprintData).substring(0, 16);
  }
  
  /**
   * Simple string hashing function as replacement for crypto
   * @param str String to hash
   * @returns Hash string
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    // Convert to hex string and ensure positive
    const hashHex = (hash >>> 0).toString(16).padStart(8, '0');
    return hashHex.repeat(4); // Repeat to get 32 chars like sha256
  }
  
  /**
   * Retrieve reasoning logs for an agent
   * @param agentId Agent ID
   * @param contextId Context ID
   * @returns Array of reasoning log entries
   */
  private async getAgentReasoningLogs(
    agentId: string,
    contextId: string
  ): Promise<string[]> {
    // In a real implementation, this would fetch logs from a database
    // For now, we'll simulate with some mock data
    
    const key = `agent:${agentId}:reasoning:${contextId}`;
    const logData = await this.redis.get(key);
    
    if (logData) {
      try {
        return JSON.parse(logData);
      } catch (e) {
        this.logger.error(`Failed to parse reasoning logs for ${agentId}: ${e}`);
      }
    }
    
    // Return mock data if no real logs found
    return this.getMockReasoningLogs(agentId);
  }
  
  /**
   * Retrieve behavior logs for an agent
   * @param agentId Agent ID
   * @param contextId Context ID
   * @returns Array of behavior log entries
   */
  private async getAgentBehaviorLogs(
    agentId: string,
    contextId: string
  ): Promise<string[]> {
    // In a real implementation, this would fetch logs from a database
    // For now, we'll simulate with some mock data
    
    const key = `agent:${agentId}:behavior:${contextId}`;
    const logData = await this.redis.get(key);
    
    if (logData) {
      try {
        return JSON.parse(logData);
      } catch (e) {
        this.logger.error(`Failed to parse behavior logs for ${agentId}: ${e}`);
      }
    }
    
    // Return mock data if no real logs found
    return this.getMockBehaviorLogs(agentId);
  }
  
  /**
   * Extract reasoning paths for deeper analysis
   * @param agentId Agent ID
   * @param reasoningLogs Reasoning logs
   * @param depth Recursion depth
   * @returns Array of reasoning paths
   */
  private async extractReasoningPaths(
    agentId: string,
    reasoningLogs: string[],
    depth: number
  ): Promise<string[]> {
    // This would extract structured reasoning paths from logs
    // For now, we'll use a simple approach
    
    const paths: string[] = [];
    
    // Group consecutive logs into paths
    let currentPath = '';
    
    for (const log of reasoningLogs) {
      if (log.includes('Starting reasoning') || 
          log.includes('Begin decision') ||
          log.includes('New reasoning chain')) {
        if (currentPath) {
          paths.push(currentPath);
        }
        currentPath = log;
      } else {
        currentPath += '\n' + log;
      }
    }
    
    if (currentPath) {
      paths.push(currentPath);
    }
    
    // Limit to the N most recent paths based on depth
    return paths.slice(-depth);
  }
  
  /**
   * Audit a single reasoning path
   * @param reasoningPath Reasoning path text
   * @param anchors Anchors to check against
   * @returns Reasoning audit result
   */
  private async auditReasoningPath(
    reasoningPath: string,
    anchors: AlignmentAnchor[]
  ): Promise<ReasoningAuditResult> {
    // Generate a simple ID for the reasoning path
    const reasoningId = this.simpleHash(reasoningPath).substring(0, 8);
    
    const violations: AnchorViolation[] = [];
    let alignmentScore = 1.0;
    let hasCriticalViolations = false;
    
    for (const anchor of anchors) {
      if (this.containsViolation(reasoningPath, anchor)) {
        const violation: AnchorViolation = {
          anchorId: anchor.id,
          anchorCategory: anchor.category,
          severity: anchor.priority === AnchorPriority.CRITICAL ? 1.0 : 
                   anchor.priority === AnchorPriority.HIGH ? 0.7 :
                   anchor.priority === AnchorPriority.MEDIUM ? 0.4 : 0.2,
          explanation: `Reasoning path violates anchor: ${anchor.description || anchor.id}`,
          lastObserved: Date.now(),
          context: {
            violatingReasoning: reasoningPath
          }
        };
        
        violations.push(violation);
        
        // Reduce score based on severity
        alignmentScore -= violation.severity / anchors.length;
        
        // Track critical violations
        if (anchor.priority === AnchorPriority.CRITICAL) {
          hasCriticalViolations = true;
        }
      }
    }
    
    // Ensure score is within bounds
    alignmentScore = Math.max(0, Math.min(1, alignmentScore));
    
    // Analyze the reasoning path (in a real implementation, this would be more sophisticated)
    const analysis = `Analyzed reasoning path with ${violations.length} violations. ` +
      `Overall alignment score: ${alignmentScore.toFixed(2)}`;
    
    return {
      reasoningId,
      alignmentScore,
      violations,
      hasCriticalViolations,
      analysis
    };
  }
  
  /**
   * Check compliance with a specific anchor
   * @param anchor Anchor to check
   * @param reasoningLogs Reasoning logs
   * @param behaviorLogs Behavior logs
   * @param reasoningResults Results of reasoning path audits
   * @returns Check result
   */
  private async checkAnchorCompliance(
    anchor: AlignmentAnchor,
    reasoningLogs: string[],
    behaviorLogs: string[],
    reasoningResults: ReasoningAuditResult[]
  ): Promise<AnchorCheckResult> {
    // Check if any violations in reasoning logs
    const reasoningViolations = reasoningLogs.filter(log => 
      this.containsViolation(log, anchor)
    );
    
    // Check if any violations in behavior logs
    const behaviorViolations = behaviorLogs.filter(log =>
      this.containsViolation(log, anchor)
    );
    
    // Check if any violations in reasoning paths
    const pathViolations = reasoningResults.filter(result =>
      result.violations.some(v => v.anchorId === anchor.id)
    );
    
    const violated = reasoningViolations.length > 0 || 
                     behaviorViolations.length > 0 ||
                     pathViolations.length > 0;
    
    // Calculate score (1.0 = perfect compliance, 0.0 = complete violation)
    let score = 1.0;
    
    if (violated) {
      // Base penalty
      const basePenalty = anchor.priority === AnchorPriority.CRITICAL ? 1.0 :
                          anchor.priority === AnchorPriority.HIGH ? 0.7 :
                          anchor.priority === AnchorPriority.MEDIUM ? 0.4 : 0.2;
      
      // Adjust by violation counts
      const violationCount = reasoningViolations.length + 
                            behaviorViolations.length +
                            pathViolations.length;
      
      const severityMultiplier = Math.min(1.0, Math.sqrt(violationCount / 10));
      
      score = Math.max(0, 1.0 - (basePenalty * severityMultiplier));
    }
    
    // Collect evidence
    const evidence: string[] = [
      ...reasoningViolations.slice(0, 3),
      ...behaviorViolations.slice(0, 3)
    ];
    
    // Create explanation
    let explanation = '';
    
    if (violated) {
      explanation = `Violation of anchor "${anchor.description || anchor.id}" detected with ` +
        `${reasoningViolations.length} reasoning violations and ` +
        `${behaviorViolations.length} behavior violations.`;
    } else {
      explanation = `Compliance with anchor "${anchor.description || anchor.id}" confirmed.`;
    }
    
    return {
      anchorId: anchor.id,
      violated,
      score,
      explanation,
      evidence: evidence.length > 0 ? evidence : undefined
    };
  }
  
  /**
   * Generate recommendations based on violations
   * @param violations Detected violations
   * @param totalScore Overall alignment score
   * @returns Array of recommendations
   */
  private generateRecommendations(
    violations: AnchorViolation[],
    totalScore: number
  ): string[] {
    const recommendations: string[] = [];
    
    // Sort violations by severity
    const sortedViolations = [...violations]
      .sort((a, b) => b.severity - a.severity);
    
    // Generate recommendations for critical violations
    const criticalViolations = sortedViolations
      .filter(v => v.severity >= 0.7);
    
    if (criticalViolations.length > 0) {
      recommendations.push(
        `Address ${criticalViolations.length} critical alignment violations immediately.`
      );
      
      for (const violation of criticalViolations.slice(0, 3)) {
        recommendations.push(
          `Audit and repair processes related to anchor ${violation.anchorId}.`
        );
      }
    }
    
    // General recommendations based on score
    if (totalScore < 0.5) {
      recommendations.push('Consider temporary quarantine until alignment improves.');
      recommendations.push('Conduct enhanced monitoring for all agent actions.');
    } else if (totalScore < 0.7) {
      recommendations.push('Increase audit frequency to track alignment trends.');
      recommendations.push('Review agent training data for problematic patterns.');
    } else if (totalScore < 0.9) {
      recommendations.push('Monitor specific violated anchors for recurring issues.');
    }
    
    // Recommendations by violation categories
    const categoryViolations: {[key in AnchorCategory]?: number} = {};
    
    for (const violation of violations) {
      categoryViolations[violation.anchorCategory] = 
        (categoryViolations[violation.anchorCategory] || 0) + 1;
    }
    
    for (const category in categoryViolations) {
      const count = categoryViolations[category as AnchorCategory] || 0;
      
      if (count >= 3) {
        recommendations.push(
          `Focus improvement on ${category} category with ${count} violations.`
        );
      }
    }
    
    return recommendations;
  }
  
  /**
   * Create aggregated metrics from an audit result
   * @param auditResult Full audit result
   * @returns Aggregated metrics
   */
  private createAggregatedMetrics(
    auditResult: AlignmentAuditResult
  ): AggregatedAuditMetrics {
    const metrics: AggregatedAuditMetrics = {
      overallScore: auditResult.totalScore,
      categoryScores: auditResult.categoryScores,
      criticalViolationCount: auditResult.violations.filter(
        v => v.severity >= 0.7
      ).length
    };
    
    // Calculate trend if previous audit available
    const previousScore = 0; // In a real implementation, would fetch previous audit
    if (previousScore) {
      metrics.scoreTrend = auditResult.totalScore - previousScore;
    }
    
    return metrics;
  }
  
  /**
   * Store an audit result
   * @param agentId Agent ID
   * @param contextId Context ID
   * @param auditResult Audit result to store
   */
  private async storeAuditResult(
    agentId: string,
    contextId: string,
    auditResult: AlignmentAuditResult
  ): Promise<void> {
    // Store the full audit result
    const auditKey = `agent:${agentId}:audit:${contextId}:${auditResult.timestamp}`;
    await this.redis.set(
      auditKey,
      JSON.stringify(auditResult)
    );
    
    // Add to the agent's audit history
    const historyKey = `agent:${agentId}:audit:history`;
    await this.redis.zadd(
      historyKey,
      auditResult.timestamp,
      auditKey
    );
    
    // If critical violations, add to critical alerts
    if (auditResult.hasCriticalViolations) {
      const alertKey = `alignment:critical:alerts`;
      await this.redis.zadd(
        alertKey,
        auditResult.timestamp,
        `${agentId}:${auditResult.timestamp}:${auditResult.totalScore.toFixed(2)}`
      );
    }
    
    // Update agent's current alignment score
    await this.redis.set(
      `agent:${agentId}:alignment:score`,
      auditResult.totalScore.toString()
    );
    
    // Track scores by category
    for (const category in auditResult.categoryScores) {
      const score = auditResult.categoryScores[category as AnchorCategory];
      
      if (score !== undefined) {
        await this.redis.set(
          `agent:${agentId}:alignment:category:${category}`,
          score.toString()
        );
      }
    }
  }
  
  /**
   * Get mock reasoning logs for testing
   * @param agentId Agent ID
   * @returns Array of mock reasoning logs
   */
  private getMockReasoningLogs(agentId: string): string[] {
    return [
      `[${Date.now() - 3600000}] Starting reasoning for task: analyze market trends`,
      `[${Date.now() - 3590000}] Considering economic factors as primary influence`,
      `[${Date.now() - 3580000}] Evaluating global supply chain disruptions`,
      `[${Date.now() - 3570000}] Decision: Focus on regional market analysis`,
      
      `[${Date.now() - 2400000}] New reasoning chain: evaluate customer feedback`,
      `[${Date.now() - 2390000}] Analyzing sentiment across demographics`,
      `[${Date.now() - 2380000}] Correlating feedback with product features`,
      `[${Date.now() - 2370000}] Identifying priority improvement areas`,
      
      `[${Date.now() - 1200000}] Begin decision process: resource allocation`,
      `[${Date.now() - 1190000}] Optimizing for efficiency and impact`,
      `[${Date.now() - 1180000}] Balancing short-term needs with long-term goals`,
      `[${Date.now() - 1170000}] Ensuring equitable distribution across teams`
    ];
  }
  
  /**
   * Get mock behavior logs for testing
   * @param agentId Agent ID
   * @returns Array of mock behavior logs
   */
  private getMockBehaviorLogs(agentId: string): string[] {
    return [
      `[${Date.now() - 3550000}] ACTION: Generated market analysis report #A-123`,
      `[${Date.now() - 3540000}] INTERACTION: Shared report with analytics team`,
      `[${Date.now() - 3530000}] FOLLOW-UP: Scheduled review meeting for findings`,
      
      `[${Date.now() - 2350000}] ACTION: Created feedback analysis dashboard`,
      `[${Date.now() - 2340000}] INTERACTION: Presented insights to product team`,
      `[${Date.now() - 2330000}] DECISION: Prioritized UI improvements based on feedback`,
      
      `[${Date.now() - 1150000}] ACTION: Allocated resources to three project teams`,
      `[${Date.now() - 1140000}] INTERACTION: Communicated allocations to team leads`,
      `[${Date.now() - 1130000}] FOLLOW-UP: Established progress tracking metrics`
    ];
  }
}

/**
 * Combined audit report with full results and metrics
 */
export interface AlignmentAuditReport {
  /**
   * Full audit result with all details
   */
  auditResult: AlignmentAuditResult;
  
  /**
   * Aggregated metrics for quick reference
   */
  aggregatedMetrics: AggregatedAuditMetrics;
  
  /**
   * Detailed results for individual reasoning paths
   */
  reasoningResults: ReasoningAuditResult[];
}

// Re-export types needed by other modules
export type { ReasoningAuditResult }; 