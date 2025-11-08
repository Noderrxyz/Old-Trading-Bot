/**
 * Governance Enforcement Types
 * 
 * Defines the types used for governance rule enforcement and violations.
 */

/**
 * Represents a rule violation in the governance system
 */
export interface RuleViolation {
  /**
   * Human-readable reason for the violation
   */
  reason: string;
  
  /**
   * Severity level of the violation
   */
  severity: 'mild' | 'moderate' | 'critical';
  
  /**
   * Code for programmatic identification (optional)
   */
  code?: string;
  
  /**
   * Additional context for the violation
   */
  context?: Record<string, any>;
}

/**
 * Types of actions that can be governed
 */
export type GovernanceActionType = 'vote' | 'propose' | 'execute' | 'override' | 'treasury';

/**
 * Defines a governance rule that can be checked and enforced
 */
export interface GovernanceRule {
  /**
   * Unique identifier for the rule
   */
  id: string;
  
  /**
   * Human-readable label for the rule
   */
  label: string;
  
  /**
   * Types of actions this rule applies to
   */
  appliesTo: GovernanceActionType[];
  
  /**
   * Function to check if the rule passes or fails
   * @param agentId Agent ID making the action
   * @param actionType Type of action being performed
   * @param context Additional context for the action
   * @returns Result of the rule check
   */
  check: (
    agentId: string,
    actionType: GovernanceActionType,
    context: Record<string, any>
  ) => Promise<{ 
    allowed: boolean; 
    violation?: RuleViolation 
  }>;
}

/**
 * Result of enforcing governance rules
 */
export interface EnforcementResult {
  /**
   * Whether the action is allowed to proceed
   */
  allowed: boolean;
  
  /**
   * List of rule violations (if any)
   */
  violations: RuleViolation[];
  
  /**
   * Warnings that don't block the action but should be logged
   */
  warnings?: RuleViolation[];
  
  /**
   * Timestamp when the enforcement check was performed
   */
  timestamp: number;
} 