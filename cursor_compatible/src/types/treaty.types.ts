/**
 * Treaty System Types
 * 
 * Defines the core types used in the treaty negotiation and enforcement system.
 */

/**
 * Treaty clause types define the different kinds of agreements 
 * that can be established between agents
 */
export type TreatyClauseType = 
  | 'trade_limit'      // Limits on trading volume, frequency, or scope
  | 'data_sharing'     // Terms for sharing data between agents
  | 'non_interference' // Agreement not to interfere with each other's operations
  | 'joint_defense'    // Coordination to defend against attackers
  | 'resource_sharing' // Sharing computational or memory resources
  | 'market_access'    // Providing privileged access to markets
  | 'signal_sharing'   // Sharing trading or market signals
  | 'credit_guarantee' // Backing credit or collateral
  | 'vote_alignment'   // Agreement to vote similarly on governance matters
  | 'custom';          // Custom agreements

/**
 * Treaty penalty types define the consequences for treaty violations
 */
export type TreatyPenaltyType =
  | 'trust_reduction'   // Reduction in trust score
  | 'license_revocation' // Revocation of specific licenses
  | 'trade_restriction'  // Restrictions on trading
  | 'data_access_revocation' // Revocation of data access
  | 'monetary_penalty'   // Financial penalty
  | 'resource_restriction' // Restriction of resource usage
  | 'signal_blackout'    // Withholding of signals
  | 'custom';            // Custom penalty

/**
 * Treaty status tracks the lifecycle of a treaty
 */
export type TreatyStatus = 
  | 'proposed'  // Initial proposal, awaiting acceptance
  | 'negotiating' // Under active negotiation
  | 'active'    // Accepted and in force
  | 'expired'   // Reached end of term
  | 'terminated' // Ended early by agreement
  | 'rejected'  // Rejected by one or more parties
  | 'violated'  // Active but with violations
  | 'suspended'; // Temporarily not in force

/**
 * Treaty penalty defines the consequences for violating a treaty clause
 */
export interface TreatyPenalty {
  /** Type of penalty */
  type: TreatyPenaltyType;
  
  /** Human-readable description of the penalty */
  description: string;
  
  /** Custom logic or data for the penalty */
  data?: Record<string, any>;
  
  /** Severity level from 1 (minor) to 10 (severe) */
  severity: number;
  
  /** Whether the penalty is automatic or requires review */
  automatic: boolean;
}

/**
 * Treaty clause defines a specific agreement within a treaty
 */
export interface TreatyClause {
  /** Unique identifier for the clause */
  id: string;
  
  /** Type of the clause */
  type: TreatyClauseType;
  
  /** Human-readable description of the clause */
  description: string;
  
  /** Custom logic or data for the clause */
  conditions: Record<string, any>;
  
  /** Optional penalty for violating this clause */
  penalty?: TreatyPenalty;
  
  /** Optional expiry time for this specific clause */
  expiresAt?: number;
  
  /** Additional notes or context */
  notes?: string;
  
  /** Reference to the function that evaluates this clause */
  evaluator?: string;
}

/**
 * Treaty signature represents a party's agreement to the treaty
 */
export interface TreatySignature {
  /** Agent ID of the signing party */
  agentId: string;
  
  /** When the treaty was signed */
  signedAt: number;
  
  /** Digital signature (could be mock or actual cryptographic signature) */
  digitalSignature: string;
  
  /** Optional notes from the signing party */
  notes?: string;
  
  /** Whether this agent has authority to act for its entire domain */
  domainAuthority?: boolean;
  
  /** Hash of the treaty at time of signing (to detect tampering) */
  treatyHash?: string;
}

/**
 * Treaty represents an agreement between two or more agents
 */
export interface AgentTreaty {
  /** Unique treaty identifier */
  treatyId: string;
  
  /** Human-readable treaty title */
  title: string;
  
  /** ID of the agent that initiated the treaty */
  initiator: string;
  
  /** IDs of all parties to the treaty */
  parties: string[];
  
  /** Clauses that make up the treaty */
  terms: TreatyClause[];
  
  /** Signatures from all parties, keyed by agent ID */
  signatures: Record<string, TreatySignature>;
  
  /** Current status of the treaty */
  status: TreatyStatus;
  
  /** When the treaty was created */
  createdAt: number;
  
  /** When the treaty expires (if applicable) */
  expiresAt?: number;
  
  /** When the treaty was last modified */
  updatedAt: number;
  
  /** Optional chain or domain this treaty belongs to */
  domain?: string;
  
  /** Whether the treaty is public or private */
  isPublic: boolean;
  
  /** Optional human-readable description */
  description?: string;
  
  /** History of changes to the treaty */
  history?: TreatyHistoryEntry[];
}

/**
 * Treaty history entry tracks changes to the treaty
 */
export interface TreatyHistoryEntry {
  /** When the change occurred */
  timestamp: number;
  
  /** Agent that made the change */
  agentId: string;
  
  /** Type of change */
  changeType: 'created' | 'modified' | 'signed' | 'rejected' | 'terminated' | 'violated' | 'suspended' | 'reinstated';
  
  /** Human-readable description of the change */
  description: string;
  
  /** Previous treaty state hash (if applicable) */
  previousStateHash?: string;
  
  /** New treaty state hash */
  newStateHash?: string;
}

/**
 * Treaty violation represents a breach of treaty terms
 */
export interface TreatyViolation {
  /** Unique identifier for the violation */
  id: string;
  
  /** ID of the treaty that was violated */
  treatyId: string;
  
  /** ID of the clause that was violated */
  clauseId: string;
  
  /** Agent that committed the violation */
  violatorId: string;
  
  /** Agent that reported the violation (if different) */
  reporterId?: string;
  
  /** When the violation occurred */
  timestamp: number;
  
  /** Evidence of the violation */
  evidence: Record<string, any>;
  
  /** Human-readable description of the violation */
  description: string;
  
  /** Severity level from 1 (minor) to 10 (severe) */
  severity: number;
  
  /** Status of the violation */
  status: 'reported' | 'confirmed' | 'disputed' | 'resolved' | 'dismissed';
  
  /** Penalties applied for the violation */
  penalties?: TreatyPenalty[];
  
  /** Whether the violation has been remediated */
  remediated: boolean;
  
  /** Optional dispute ID if the violation is being contested */
  disputeId?: string;
  
  /** Whether the violation has been resolved */
  resolved: boolean;
  
  /** Optional resolution note if the violation is resolved */
  resolution?: string;
}

/**
 * Treaty negotiation proposal represents a suggestion during treaty negotiation
 */
export interface TreatyProposal {
  /** Unique identifier for the proposal */
  id: string;
  
  /** ID of the treaty this proposal relates to */
  treatyId: string;
  
  /** Agent making the proposal */
  proposerId: string;
  
  /** When the proposal was made */
  timestamp: number;
  
  /** Type of proposal */
  type: 'initial' | 'counter' | 'amendment' | 'termination';
  
  /** Changes proposed */
  changes: {
    /** Clauses to add */
    addClauses?: TreatyClause[];
    
    /** IDs of clauses to remove */
    removeClauses?: string[];
    
    /** Clauses to modify, with their new versions */
    modifyClauses?: TreatyClause[];
    
    /** Other changes to the treaty */
    otherChanges?: Record<string, any>;
  };
  
  /** Human-readable rationale for the proposal */
  rationale: string;
  
  /** Status of the proposal */
  status: 'pending' | 'accepted' | 'rejected' | 'counter_offered' | 'withdrawn';
  
  /** Responses from other parties */
  responses?: Record<string, TreatyProposalResponse>;
}

/**
 * Treaty proposal response represents an agent's response to a proposal
 */
export interface TreatyProposalResponse {
  /** Agent responding to the proposal */
  agentId: string;
  
  /** When the response was made */
  timestamp: number;
  
  /** Response type */
  response: 'accept' | 'reject' | 'counter' | 'need_more_info';
  
  /** Human-readable explanation for the response */
  reasoning: string;
  
  /** Counter-proposal ID (if applicable) */
  counterProposalId?: string;
}

/**
 * Types related to the Treaty system
 */

export interface ActionEvaluation {
  action: any;
  context: any;
  timestamp: number;
  agentId: string;
} 