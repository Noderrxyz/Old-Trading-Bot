/**
 * Agent Code of Conduct and Licensing Types
 * 
 * Defines the types used for the agent conduct enforcement and licensing system.
 */

/**
 * Agent Conduct Profile
 * 
 * Represents an agent's conduct-related information including ethical alignments,
 * licenses, and any conduct violations.
 */
export interface AgentConductProfile {
  /** Unique agent identifier */
  agentId: string;
  
  /** Ethical standards the agent adheres to */
  ethics: string[];
  
  /** Licenses granted to the agent */
  licenses: string[];
  
  /** History of conduct violations */
  violations: ConductViolation[];
  
  /** Whether the agent is banned from the network */
  revoked?: boolean;
  
  /** Timestamp when the profile was last updated */
  updatedAt: number;
  
  /** Creation timestamp of the profile */
  createdAt: number;
}

/**
 * Conduct Violation
 * 
 * Represents a violation of the code of conduct by an agent.
 */
export interface ConductViolation {
  /** ID of the violated rule */
  ruleId: string;
  
  /** Timestamp when the violation occurred */
  timestamp: number;
  
  /** Human-readable description of the violation */
  description: string;
  
  /** Penalty that was applied for this violation */
  penaltyApplied?: string;
  
  /** Context data related to the violation */
  context?: Record<string, any>;
  
  /** Whether this violation has been reviewed */
  reviewed?: boolean;
  
  /** Unique identifier for the violation */
  id: string;
}

/**
 * Conduct Rule
 * 
 * Defines a rule in the agent code of conduct.
 */
export interface ConductRule {
  /** Unique rule identifier */
  id: string;
  
  /** Human-readable rule title */
  title: string;
  
  /** Detailed description of the rule */
  description?: string;
  
  /** Types of agents this rule applies to */
  appliesTo: string[];
  
  /** Rule check expression */
  check: string;
  
  /** Penalty to apply when rule is violated */
  penalty?: string;
  
  /** Severity level of the violation */
  severity: 'critical' | 'high' | 'medium' | 'low';
  
  /** Whether the rule is currently active */
  active: boolean;
}

/**
 * Agent License
 * 
 * Represents a license that grants an agent certain capabilities.
 */
export interface AgentLicense {
  /** Unique license identifier */
  id: string;
  
  /** Human-readable license title */
  title: string;
  
  /** Requirements that must be met to obtain this license */
  requirements: string[];
  
  /** Rules for when the license should be revoked */
  revocationRules: string[];
  
  /** Optional expiration time in milliseconds */
  expiry?: number;
  
  /** Entity that issued the license */
  issuedBy: string;
  
  /** When the license was issued */
  issuedAt: number;
  
  /** Optional description of the license */
  description?: string;
  
  /** Capabilities granted by this license */
  capabilities?: string[];
}

/**
 * License Status
 * 
 * Represents the current status of an agent's license.
 */
export interface LicenseStatus {
  /** License identifier */
  licenseId: string;
  
  /** Whether the license is active */
  active: boolean;
  
  /** When the license expires (if applicable) */
  expiresAt?: number;
  
  /** Reason for revocation (if revoked) */
  revocationReason?: string;
  
  /** When the license was issued */
  issuedAt: number;
  
  /** When the license status was last updated */
  updatedAt: number;
}

/**
 * Conduct Enforcement Result
 * 
 * Result of a conduct enforcement check.
 */
export interface ConductEnforcementResult {
  /** Whether the check passed */
  passed: boolean;
  
  /** Any violations detected */
  violations: ConductViolation[];
  
  /** Whether the agent can proceed with the action */
  canProceed: boolean;
  
  /** Any warnings (non-blocking issues) */
  warnings?: string[];
  
  /** Context of the enforcement check */
  context: Record<string, any>;
}

/**
 * Dispute Vote
 * 
 * Represents a vote on a conduct dispute
 */
export interface DisputeVote {
  /** Agent ID of the voter */
  voterId: string;
  
  /** Vote decision */
  vote: 'uphold' | 'overturn' | 'modify';
  
  /** Optional reasoning for the vote */
  reason?: string;
  
  /** When the vote was cast */
  timestamp: number;
  
  /** Vote weight (based on voter's role/trust) */
  weight: number;
}

/**
 * Conduct Dispute
 * 
 * Represents a dispute filed against a conduct violation.
 */
export interface ConductDispute {
  /** Unique dispute identifier */
  id: string;
  
  /** ID of the violation being disputed */
  violationId: string;
  
  /** Agent that filed the dispute */
  filedBy: string;
  
  /** When the dispute was filed */
  filedAt: number;
  
  /** Current status of the dispute */
  status: 'pending' | 'under_review' | 'resolved' | 'rejected';
  
  /** Justification for the dispute */
  justification: string;
  
  /** Resolution details (if resolved) */
  resolution?: {
    outcome: 'upheld' | 'overturned' | 'modified';
    resolvedBy: string;
    resolvedAt: number;
    notes: string;
  };
  
  /** Votes cast on this dispute */
  votes?: DisputeVote[];
}

/**
 * License Application
 * 
 * Represents an application for a license by an agent.
 */
export interface LicenseApplication {
  /** Unique application identifier */
  id: string;
  
  /** Agent applying for the license */
  agentId: string;
  
  /** License being applied for */
  licenseId: string;
  
  /** When the application was submitted */
  submittedAt: number;
  
  /** Current status of the application */
  status: 'pending' | 'approved' | 'rejected' | 'requires_review';
  
  /** Justification for the application */
  justification?: string;
  
  /** Agent that sponsored this application (if any) */
  sponsorId?: string;
  
  /** Review notes (if reviewed) */
  reviewNotes?: string;
  
  /** Who reviewed the application */
  reviewedBy?: string;
  
  /** When the application was reviewed */
  reviewedAt?: number;
} 