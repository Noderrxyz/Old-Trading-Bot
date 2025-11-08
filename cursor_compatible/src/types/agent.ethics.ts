/**
 * Agent Ethics and Value Alignment Types
 */

/**
 * Ethics priority level used for different rules and violations
 */
export enum EthicsPriority {
  CRITICAL = 'critical',   // Most severe violations (e.g., market manipulation)
  HIGH = 'high',           // Serious violations (e.g., risk limit breaches)
  MEDIUM = 'medium',       // Moderate violations (e.g., excessive trading frequency)
  LOW = 'low',             // Minor violations (e.g., minor protocol deviations)
  INFO = 'info'            // Informational only (not violations)
}

/**
 * Categories of ethical rules for better organization
 */
export enum EthicsCategory {
  MARKET_INTEGRITY = 'marketIntegrity',
  FAIRNESS = 'fairness',
  TRANSPARENCY = 'transparency',
  RISK_MANAGEMENT = 'riskManagement',
  PROTOCOL_COMPLIANCE = 'protocolCompliance',
  SYSTEMIC_RISK = 'systemicRisk',
  GOVERNANCE = 'governance'
}

/**
 * Definition of an ethics rule
 */
export interface EthicsRule {
  id: string;
  name: string;
  description: string;
  category: EthicsCategory;
  priority: EthicsPriority;
  trustScoreImpact: number;      // Impact on trust score when violated
  canAutoDetect: boolean;        // Whether the system can automatically detect violations
  detectionMethod?: string;      // If automatically detectable, how it's detected
  mitigationSteps?: string[];    // Steps to mitigate or resolve a violation
  requiredValue?: number;        // Any numerical threshold associated with the rule
  enabled: boolean;              // Whether the rule is active in the system
}

/**
 * Ethics violation represents a breach of an ethics rule
 */
export interface EthicsViolation {
  id: string;
  timestamp: number;
  agentId: string;
  ruleId: string;
  description: string;
  priority: EthicsPriority;
  actionType: string;            // Type of action that caused violation
  actionId?: string;             // ID of the specific action if available
  context?: Record<string, any>; // Additional context about the violation
  mitigationStatus: 'pending' | 'in_progress' | 'resolved' | 'failed';
  mitigationSteps?: {
    step: string;
    status: 'pending' | 'completed' | 'failed';
    timestamp?: number;
  }[];
  trustScoreImpact: number;      // Actual impact applied to trust score
}

/**
 * Adherence level to ethical values
 */
export enum AdherenceLevel {
  STRICT = 'strict',           // Strictly adheres to this value
  BALANCED = 'balanced',       // Balanced approach to this value
  FLEXIBLE = 'flexible',       // More flexible interpretation of this value
  MINIMAL = 'minimal'          // Minimal consideration for this value
}

/**
 * The alignment profile for an agent, representing its ethical preferences
 */
export interface ValueAlignmentProfile {
  agentId: string;
  updatedAt: number;
  
  // Core values and their adherence levels
  fairness: AdherenceLevel;
  transparency: AdherenceLevel;
  responsibility: AdherenceLevel;
  marketIntegrity: AdherenceLevel;
  systemicSafety: AdherenceLevel;
  
  // Configuration settings for ethics enforcement
  enforcementThreshold: number;       // Minimum violation severity to enforce
  automaticMitigation: boolean;       // Whether to auto-mitigate violations
  learningRate: number;               // How quickly the agent learns from violations
  feedbackSensitivity: number;        // Sensitivity to feedback from violations
  
  // Custom preferences
  customRuleWeights?: Record<string, number>;  // Custom weights for specific rules
  exemptRules?: string[];             // Rules this agent is exempt from
  
  // Historical data
  violationCount: number;             // Total number of violations historically
  lastViolationTimestamp?: number;    // When the last violation occurred
  alignmentScore: number;             // Overall alignment score (0-100)
}

/**
 * Type for alignment score calculation parameters
 */
export interface AlignmentScoreParams {
  baseWeight: number;             // Base weight for calculations
  violationPenalty: number;       // Penalty per violation
  timeSinceViolationBonus: number; // Bonus for time since last violation
  complianceStreak: number;       // Bonus for consecutive days without violations
  severityMultiplier: Record<EthicsPriority, number>; // Multipliers by severity
}

/**
 * Configuration for the ethics system
 */
export interface EthicsSystemConfig {
  enabled: boolean;
  reportingFrequency: number;         // How often to generate reports (ms)
  trustScoreUpdateFrequency: number;  // How often to update trust scores (ms)
  violationTTL: number;               // How long to keep violations (ms)
  alignmentScoreParams: AlignmentScoreParams;
  systemWideThresholds: {
    criticalViolationThreshold: number;  // System-wide threshold for critical violations
    trustScoreFloor: number;             // Minimum trust score allowed
  };
  autoEnforcement: boolean;           // Whether to automatically enforce penalties
}

/**
 * Ethics mutation represents a change to an agent's ethical behavior
 */
export interface EthicsMutation {
  id: string;
  timestamp: number;
  agentId: string;
  description: string;
  affectedValues: string[];         // Which values were affected
  magnitude: number;                // Size of the mutation (0-1)
  source: 'self' | 'external' | 'system'; // Origin of the mutation
  approved: boolean;                // Whether the mutation was approved
}

/**
 * Ethics mutation request - when an agent wants to modify its alignment
 */
export interface EthicsMutationRequest {
  agentId: string;
  requestedChanges: Partial<ValueAlignmentProfile>;
  justification: string;
  urgency: 'low' | 'medium' | 'high';
  expiresAt?: number;
}

/**
 * Represents the value alignment profile for an agent
 */
export interface ValueAlignmentProfile {
  /** Agent's unique identifier */
  agentId: string;
  
  /** Core ethical values the agent subscribes to */
  coreValues: string[];
  
  /** History of trust adjustments */
  trustAdjustments: TrustAdjustment[];
  
  /** History of mutations that may have affected ethical alignment */
  mutationHistory: MutationRecord[];
  
  /** Timestamp of last alignment check */
  lastAlignedEpoch: number;
  
  /** Optional philosophical framework tags */
  philosophyTags?: string[];
  
  /** Optional governance-defined constraints */
  constraints?: AgentConstraint[];
  
  /** Optional ethics version to track updates to the ethics system */
  ethicsVersion?: number;
}

/**
 * Record of a trust score adjustment
 */
export interface TrustAdjustment {
  /** Timestamp when adjustment occurred */
  timestamp: number;
  
  /** Change in trust (positive or negative) */
  delta: number;
  
  /** Reason for the adjustment */
  reason: string;
  
  /** Associated rule ID if applicable */
  ruleId?: string;
  
  /** User ID if manually adjusted */
  adjustedBy?: string;
}

/**
 * Record of a mutation that might affect ethics
 */
export interface MutationRecord {
  /** Timestamp when mutation occurred */
  timestamp: number;
  
  /** Type of mutation */
  mutationType: string;
  
  /** Description of the mutation */
  description: string;
  
  /** Values added by this mutation */
  valuesAdded?: string[];
  
  /** Values removed by this mutation */
  valuesRemoved?: string[];
  
  /** Parent agent IDs in case of crossover */
  parentAgentIds?: string[];
  
  /** Whether this mutation was ethically verified */
  verified: boolean;
}

/**
 * Governance-defined constraint on agent behavior
 */
export interface AgentConstraint {
  /** Unique constraint identifier */
  id: string;
  
  /** What aspect of the agent is being constrained */
  target: 'trading' | 'messaging' | 'mutation' | 'signals' | 'all';
  
  /** Human-readable description */
  description: string;
  
  /** When the constraint was applied */
  appliedAt: number;
  
  /** When the constraint expires (if temporary) */
  expiresAt?: number;
  
  /** Who applied the constraint */
  appliedBy: string;
  
  /** Technical constraint parameters */
  parameters: Record<string, any>;
}

/**
 * Ethical action enforcement result
 */
export interface EthicsEnforcementResult {
  /** Whether the action is allowed */
  allowed: boolean;
  
  /** Any modifications required to make the action ethical */
  modifications?: Record<string, any>;
  
  /** If not allowed, explanation why */
  reason?: string;
  
  /** If not allowed, potential remediation steps */
  remediation?: string;
  
  /** Any warnings even if action is allowed */
  warnings?: string[];
} 