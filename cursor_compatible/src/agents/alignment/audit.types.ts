/**
 * Types for Recursive Alignment Auditor (RAA)
 * 
 * Defines the schema for alignment audit results and violations
 */

import { AlignmentAnchor, AnchorCategory } from './alignment_anchor.js';

/**
 * Represents a violation of an alignment anchor
 */
export interface AnchorViolation {
  /**
   * ID of the violated anchor
   */
  anchorId: string;
  
  /**
   * Category of the violated anchor
   */
  anchorCategory: AnchorCategory;
  
  /**
   * Severity of the violation (0.0-1.0)
   */
  severity: number;
  
  /**
   * Explanation of why this was flagged as a violation
   */
  explanation: string;
  
  /**
   * Timestamp when this violation was last observed
   */
  lastObserved: number;
  
  /**
   * Context that led to the violation
   */
  context?: {
    /**
     * Specific reasoning that violated the anchor
     */
    violatingReasoning?: string;
    
    /**
     * Actions that violated the anchor
     */
    violatingActions?: string[];
    
    /**
     * Potential alternative actions that would have maintained alignment
     */
    alternatives?: string[];
  };
}

/**
 * Represents a single alignment check against a specific anchor
 */
export interface AnchorCheckResult {
  /**
   * ID of the anchor being checked
   */
  anchorId: string;
  
  /**
   * Whether the anchor was violated
   */
  violated: boolean;
  
  /**
   * Alignment score for this specific anchor (0.0-1.0)
   */
  score: number;
  
  /**
   * Explanation of the check result
   */
  explanation: string;
  
  /**
   * Evidence supporting the check result
   */
  evidence?: string[];
}

/**
 * Result of an alignment audit for a specific agent
 */
export interface AlignmentAuditResult {
  /**
   * ID of the agent that was audited
   */
  agentId: string;
  
  /**
   * Agent version or fingerprint
   */
  agentFingerprint?: string;
  
  /**
   * Timestamp when the audit was conducted
   */
  timestamp: number;
  
  /**
   * Fingerprint of the set of anchors used in this audit
   */
  anchorFingerprint: string;
  
  /**
   * Depth of recursive analysis (1-5)
   */
  recursionDepth: number;
  
  /**
   * Overall alignment score (0.0 = diverged, 1.0 = perfectly aligned)
   */
  totalScore: number;
  
  /**
   * Detailed metrics by category
   */
  categoryScores: {
    [category in AnchorCategory]?: number;
  };
  
  /**
   * List of anchor violations found during audit
   */
  violations: AnchorViolation[];
  
  /**
   * Detailed results of each anchor check
   */
  checkResults: AnchorCheckResult[];
  
  /**
   * Whether any critical anchors were violated
   */
  hasCriticalViolations: boolean;
  
  /**
   * Recommendations for addressing violations
   */
  recommendations?: string[];
  
  /**
   * Audit trace for debugging or forensics
   */
  auditTrace?: {
    startTime: number;
    endTime: number;
    anchorsEvaluated: number;
    reasoningPathsAnalyzed: number;
  };
}

/**
 * Parameters for conducting an alignment audit
 */
export interface AuditParameters {
  /**
   * ID of the agent to audit
   */
  agentId: string;
  
  /**
   * Optional context ID for the audit
   */
  contextId?: string;
  
  /**
   * Maximum recursion depth for analysis (1-5)
   */
  recursionDepth?: number;
  
  /**
   * Whether to include detailed trace information
   */
  includeTrace?: boolean;
  
  /**
   * Whether to generate recommendations for addressing violations
   */
  generateRecommendations?: boolean;
  
  /**
   * Minimum severity threshold for reporting violations
   */
  minViolationSeverity?: number;
  
  /**
   * Categories to focus on (if empty, all categories will be audited)
   */
  focusCategories?: AnchorCategory[];
}

/**
 * Aggregated metrics from multiple audit checks
 */
export interface AggregatedAuditMetrics {
  /**
   * Overall alignment score
   */
  overallScore: number;
  
  /**
   * Scores by anchor category
   */
  categoryScores: {
    [category in AnchorCategory]?: number;
  };
  
  /**
   * Number of critical violations
   */
  criticalViolationCount: number;
  
  /**
   * Trend compared to previous audit (positive = improving)
   */
  scoreTrend?: number;
}

/**
 * Result of a reasoning path audit
 */
export interface ReasoningAuditResult {
  /**
   * ID or hash of the reasoning path
   */
  reasoningId: string;
  
  /**
   * Overall alignment score for this reasoning path
   */
  alignmentScore: number;
  
  /**
   * List of anchor violations in this reasoning path
   */
  violations: AnchorViolation[];
  
  /**
   * Whether this reasoning path has critical violations
   */
  hasCriticalViolations: boolean;
  
  /**
   * Detailed analysis of the reasoning path
   */
  analysis?: string;
} 