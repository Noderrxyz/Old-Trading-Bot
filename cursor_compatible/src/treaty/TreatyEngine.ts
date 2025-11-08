import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { 
  AgentTreaty,
  TreatyClause,
  TreatyStatus,
  TreatyViolation,
  TreatyProposal,
  TreatyHistoryEntry,
  TreatyProposalResponse
} from '../types/treaty.types.js';
import { FileSystemService } from '../services/FileSystemService.js';

interface TreatyVerificationResult {
  isValid: boolean;
  errors: string[];
}

interface TreatyClauseEvaluationResult {
  clauseId: string;
  compliant: boolean;
  evidence?: Record<string, any>;
  description?: string;
}

/**
 * TreatyEngine manages the lifecycle of treaties
 * including creation, negotiation, signing, monitoring, and enforcement
 */
export class TreatyEngine extends EventEmitter {
  private treaties: Map<string, AgentTreaty> = new Map();
  private violations: Map<string, TreatyViolation> = new Map();
  private proposals: Map<string, TreatyProposal> = new Map();
  private fs: FileSystemService;
  private treatiesPath: string = 'src/data/treaty/treaties.memory.json';
  private violationsPath: string = 'src/data/treaty/treaty_violations.json';
  
  private clauseEvaluators: Map<string, (clause: TreatyClause, context: any) => TreatyClauseEvaluationResult> = new Map();

  constructor() {
    super();
    this.fs = new FileSystemService();
    this.loadPersistedData();
    this.registerDefaultClauseEvaluators();
  }

  /**
   * Loads treaty data from persistent storage
   */
  private async loadPersistedData(): Promise<void> {
    try {
      // Load treaties
      const treatiesData = await this.fs.readFile(this.treatiesPath);
      if (treatiesData) {
        const parsed = JSON.parse(treatiesData);
        if (parsed.treaties && Array.isArray(parsed.treaties)) {
          parsed.treaties.forEach((treaty: AgentTreaty) => {
            this.treaties.set(treaty.treatyId, treaty);
          });
        }
      }

      // Load violations
      const violationsData = await this.fs.readFile(this.violationsPath);
      if (violationsData) {
        const parsed = JSON.parse(violationsData);
        if (parsed.violations && Array.isArray(parsed.violations)) {
          parsed.violations.forEach((violation: TreatyViolation) => {
            this.violations.set(violation.id, violation);
          });
        }
      }
    } catch (error: any) {
      console.error('Failed to load treaty data:', error.message);
    }
  }

  /**
   * Saves treaty data to persistent storage
   */
  private async persistData(): Promise<void> {
    try {
      // Save treaties
      const treatiesData = {
        treaties: Array.from(this.treaties.values()),
        updatedAt: Date.now(),
        schema: {
          version: "1.0",
          description: "Storage for agent treaties and negotiations"
        }
      };
      await this.fs.writeFile(this.treatiesPath, JSON.stringify(treatiesData, null, 2));

      // Save violations
      const violationsData = {
        violations: Array.from(this.violations.values()),
        updatedAt: Date.now(),
        schema: {
          version: "1.0",
          description: "Storage for treaty violations and enforcement actions"
        }
      };
      await this.fs.writeFile(this.violationsPath, JSON.stringify(violationsData, null, 2));
    } catch (error: any) {
      console.error('Failed to persist treaty data:', error.message);
    }
  }

  /**
   * Registers default evaluators for standard treaty clause types
   */
  private registerDefaultClauseEvaluators(): void {
    // Trade limit evaluator
    this.clauseEvaluators.set('trade_limit', (clause, context) => {
      // Simplified example implementation
      const { maxTransactions, timeWindow } = clause.conditions;
      const { transactions, timestamp } = context;
      
      const relevantTransactions = transactions.filter(
        (tx: any) => tx.timestamp > timestamp - timeWindow
      );

      const compliant = relevantTransactions.length <= maxTransactions;
      
      return {
        clauseId: clause.id,
        compliant,
        evidence: { 
          relevantTransactions, 
          limit: maxTransactions,
          actual: relevantTransactions.length
        },
        description: compliant 
          ? 'Trade limits respected' 
          : `Trade limit exceeded: ${relevantTransactions.length} transactions in period, limit is ${maxTransactions}`
      };
    });

    // Data sharing evaluator
    this.clauseEvaluators.set('data_sharing', (clause, context) => {
      // Example implementation
      const { sharedDataTypes, recipientIds } = clause.conditions;
      const { sharedData, recipientId } = context;
      
      const isAuthorizedRecipient = recipientIds.includes(recipientId);
      const isAuthorizedDataType = sharedDataTypes.includes(sharedData.type);
      const compliant = isAuthorizedRecipient && isAuthorizedDataType;
      
      return {
        clauseId: clause.id,
        compliant,
        evidence: { sharedData, recipientId },
        description: compliant 
          ? 'Data sharing complies with treaty terms' 
          : `Unauthorized data sharing: ${isAuthorizedRecipient ? '' : 'unauthorized recipient, '}${isAuthorizedDataType ? '' : 'unauthorized data type'}`
      };
    });

    // Add more default evaluators for other clause types...
  }

  /**
   * Registers a custom evaluator for a specific clause type
   */
  public registerClauseEvaluator(
    clauseType: string, 
    evaluator: (clause: TreatyClause, context: any) => TreatyClauseEvaluationResult
  ): void {
    this.clauseEvaluators.set(clauseType, evaluator);
  }

  /**
   * Creates a new treaty proposal
   */
  public proposeTreaty(
    initiatorId: string,
    title: string,
    parties: string[],
    terms: TreatyClause[],
    domain?: string,
    isPublic: boolean = false,
    description?: string,
  ): AgentTreaty {
    const now = Date.now();
    const treatyId = uuidv4();

    // Ensure each clause has an ID
    terms = terms.map(term => ({
      ...term,
      id: term.id || uuidv4()
    }));

    const treaty: AgentTreaty = {
      treatyId,
      title,
      initiator: initiatorId,
      parties,
      terms,
      signatures: {},
      status: 'proposed',
      createdAt: now,
      updatedAt: now,
      domain,
      isPublic,
      description,
      history: [{
        timestamp: now,
        agentId: initiatorId,
        changeType: 'created',
        description: 'Treaty proposed',
        newStateHash: this.computeTreatyHash({ treatyId, title, parties, terms })
      }]
    };

    this.treaties.set(treatyId, treaty);
    this.persistData();

    this.emit('treaty:proposed', { treaty });
    return treaty;
  }

  /**
   * Computes a hash of the treaty for verification purposes
   */
  private computeTreatyHash(treaty: Partial<AgentTreaty>): string {
    // In a real implementation, this would be a cryptographic hash
    // For simplicity, we're just creating a string representation
    return Buffer.from(JSON.stringify({
      treatyId: treaty.treatyId,
      title: treaty.title,
      parties: treaty.parties,
      terms: treaty.terms
    })).toString('base64');
  }

  /**
   * Signs a treaty on behalf of an agent
   */
  public signTreaty(
    treatyId: string, 
    agentId: string, 
    notes?: string, 
    domainAuthority: boolean = false
  ): AgentTreaty | null {
    const treaty = this.treaties.get(treatyId);
    if (!treaty) {
      console.error(`Treaty ${treatyId} not found`);
      return null;
    }

    if (!treaty.parties.includes(agentId)) {
      console.error(`Agent ${agentId} is not a party to treaty ${treatyId}`);
      return null;
    }

    if (treaty.signatures[agentId]) {
      console.error(`Agent ${agentId} has already signed treaty ${treatyId}`);
      return null;
    }

    const now = Date.now();
    const treatyHash = this.computeTreatyHash(treaty);
    
    // Create signature
    treaty.signatures[agentId] = {
      agentId,
      signedAt: now,
      digitalSignature: `sig:${agentId}:${treatyHash}:${now}`, // Mock signature
      notes,
      domainAuthority,
      treatyHash
    };

    // Add history entry
    treaty.history = treaty.history || [];
    treaty.history.push({
      timestamp: now,
      agentId,
      changeType: 'signed',
      description: `Treaty signed by ${agentId}`,
      previousStateHash: treatyHash,
      newStateHash: treatyHash
    });

    // Check if all parties have signed
    const allSigned = treaty.parties.every(party => treaty.signatures[party]);
    if (allSigned && treaty.status === 'proposed') {
      treaty.status = 'active';
      treaty.history.push({
        timestamp: now,
        agentId: 'system',
        changeType: 'modified',
        description: 'Treaty activated after all parties signed',
        previousStateHash: treatyHash,
        newStateHash: treatyHash
      });
      this.emit('treaty:activated', { treaty });
    }

    treaty.updatedAt = now;
    this.persistData();
    this.emit('treaty:signed', { treaty, signerId: agentId });
    
    return treaty;
  }

  /**
   * Retrieves a treaty by its ID
   */
  public getTreaty(treatyId: string): AgentTreaty | null {
    return this.treaties.get(treatyId) || null;
  }

  /**
   * Lists treaties involving a specific agent
   */
  public getTreatiesForAgent(agentId: string): AgentTreaty[] {
    return Array.from(this.treaties.values())
      .filter(treaty => treaty.parties.includes(agentId));
  }

  /**
   * Evaluates an agent's actions against applicable treaties
   */
  public evaluateCompliance(
    agentId: string, 
    action: string, 
    context: any
  ): TreatyViolation[] {
    const violations: TreatyViolation[] = [];
    const relevantTreaties = this.getTreatiesForAgent(agentId)
      .filter(treaty => treaty.status === 'active');

    // Nothing to evaluate if no active treaties
    if (relevantTreaties.length === 0) {
      return [];
    }

    // For each relevant treaty, evaluate clauses
    for (const treaty of relevantTreaties) {
      for (const clause of treaty.terms) {
        // Skip if no evaluator for this clause type
        if (!this.clauseEvaluators.has(clause.type)) {
          continue;
        }

        const evaluator = this.clauseEvaluators.get(clause.type)!;
        const result = evaluator(clause, {
          ...context,
          action,
          agentId,
          treaty
        });

        // If non-compliant, record a violation
        if (!result.compliant) {
          const violation: TreatyViolation = {
            id: uuidv4(),
            treatyId: treaty.treatyId,
            clauseId: clause.id,
            violatorId: agentId,
            timestamp: Date.now(),
            evidence: result.evidence || {},
            description: result.description || 'Treaty clause violated',
            severity: clause.penalty?.severity || 5,
            status: 'reported',
            remediated: false,
            resolved: false
          };

          violations.push(violation);
          this.violations.set(violation.id, violation);

          // Update treaty status
          if (treaty.status !== 'violated') {
            treaty.status = 'violated';
            treaty.updatedAt = Date.now();
            
            // Add history entry
            treaty.history = treaty.history || [];
            treaty.history.push({
              timestamp: Date.now(),
              agentId: 'system',
              changeType: 'violated',
              description: `Treaty violated by ${agentId}: ${result.description}`,
              previousStateHash: this.computeTreatyHash(treaty),
              newStateHash: this.computeTreatyHash(treaty)
            });
          }

          // Emit event
          this.emit('treaty:violated', { 
            treaty,
            violation,
            agent: agentId,
            clause
          });
        }
      }
    }

    if (violations.length > 0) {
      this.persistData();
    }

    return violations;
  }

  /**
   * Proposes changes to an existing treaty
   */
  public proposeAmendment(
    treatyId: string,
    proposerId: string,
    changes: TreatyProposal['changes'],
    rationale: string
  ): TreatyProposal | null {
    const treaty = this.treaties.get(treatyId);
    if (!treaty) {
      console.error(`Treaty ${treatyId} not found`);
      return null;
    }

    if (!treaty.parties.includes(proposerId)) {
      console.error(`Agent ${proposerId} is not a party to treaty ${treatyId}`);
      return null;
    }

    if (treaty.status !== 'active' && treaty.status !== 'negotiating') {
      console.error(`Treaty ${treatyId} is not in a state that can be amended (${treaty.status})`);
      return null;
    }

    const proposal: TreatyProposal = {
      id: uuidv4(),
      treatyId,
      proposerId,
      timestamp: Date.now(),
      type: 'amendment',
      changes,
      rationale,
      status: 'pending',
      responses: {}
    };

    this.proposals.set(proposal.id, proposal);
    
    if (treaty.status === 'active') {
      treaty.status = 'negotiating';
      treaty.updatedAt = Date.now();
      treaty.history?.push({
        timestamp: Date.now(),
        agentId: proposerId,
        changeType: 'modified',
        description: `Amendment proposed by ${proposerId}`,
        previousStateHash: this.computeTreatyHash(treaty),
        newStateHash: this.computeTreatyHash(treaty)
      });
    }

    this.persistData();
    this.emit('treaty:amendment_proposed', { treaty, proposal, proposerId });
    
    return proposal;
  }

  /**
   * Responds to a treaty proposal
   */
  public respondToProposal(
    proposalId: string,
    agentId: string,
    response: TreatyProposalResponse['response'],
    reasoning: string,
    counterProposalId?: string
  ): boolean {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      console.error(`Proposal ${proposalId} not found`);
      return false;
    }

    const treaty = this.treaties.get(proposal.treatyId);
    if (!treaty) {
      console.error(`Treaty ${proposal.treatyId} not found`);
      return false;
    }

    if (!treaty.parties.includes(agentId)) {
      console.error(`Agent ${agentId} is not a party to treaty ${proposal.treatyId}`);
      return false;
    }

    // Record the response
    proposal.responses = proposal.responses || {};
    proposal.responses[agentId] = {
      agentId,
      timestamp: Date.now(),
      response,
      reasoning,
      counterProposalId
    };

    // Check if all parties have responded
    const allResponded = treaty.parties.every(
      party => party === proposal.proposerId || proposal.responses?.[party]
    );

    if (allResponded) {
      // Check if all responses are 'accept'
      const allAccepted = Object.values(proposal.responses).every(
        r => r.response === 'accept'
      );

      if (allAccepted) {
        // Apply the changes to the treaty
        this.applyProposalChanges(proposal);
        proposal.status = 'accepted';
      } else {
        // At least one rejection
        proposal.status = 'rejected';
        
        // If treaty was previously active, revert to active state
        if (treaty.status === 'negotiating') {
          treaty.status = 'active';
          treaty.updatedAt = Date.now();
          treaty.history?.push({
            timestamp: Date.now(),
            agentId: 'system',
            changeType: 'modified',
            description: 'Treaty reverted to active state after proposal rejection',
            previousStateHash: this.computeTreatyHash(treaty),
            newStateHash: this.computeTreatyHash(treaty)
          });
        }
      }
    }

    this.persistData();
    this.emit('treaty:proposal_response', { 
      treaty, 
      proposal, 
      responder: agentId,
      response 
    });
    
    return true;
  }

  /**
   * Applies accepted changes to a treaty
   */
  private applyProposalChanges(proposal: TreatyProposal): void {
    const treaty = this.treaties.get(proposal.treatyId);
    if (!treaty) return;

    const changes = proposal.changes;
    
    // Remove clauses
    if (changes.removeClauses?.length) {
      treaty.terms = treaty.terms.filter(
        clause => !changes.removeClauses?.includes(clause.id)
      );
    }
    
    // Add new clauses
    if (changes.addClauses?.length) {
      treaty.terms.push(...changes.addClauses);
    }
    
    // Modify existing clauses
    if (changes.modifyClauses?.length) {
      changes.modifyClauses.forEach(modifiedClause => {
        const index = treaty.terms.findIndex(c => c.id === modifiedClause.id);
        if (index >= 0) {
          treaty.terms[index] = modifiedClause;
        }
      });
    }
    
    // Apply other changes
    if (changes.otherChanges) {
      for (const [key, value] of Object.entries(changes.otherChanges)) {
        // Apply only to allowed fields
        if (['title', 'description', 'isPublic', 'expiresAt', 'domain'].includes(key)) {
          (treaty as any)[key] = value;
        }
      }
    }
    
    // Update treaty metadata
    treaty.updatedAt = Date.now();
    treaty.status = 'active';
    
    // Add history entry
    treaty.history = treaty.history || [];
    treaty.history.push({
      timestamp: Date.now(),
      agentId: proposal.proposerId,
      changeType: 'modified',
      description: `Treaty amended based on proposal ${proposal.id}`,
      previousStateHash: this.computeTreatyHash(treaty),
      newStateHash: this.computeTreatyHash(treaty)
    });
    
    // Reset signatures if treaty terms changed substantively
    if (changes.addClauses?.length || changes.removeClauses?.length || changes.modifyClauses?.length) {
      treaty.signatures = {};
      treaty.status = 'proposed';
      
      treaty.history.push({
        timestamp: Date.now(),
        agentId: 'system',
        changeType: 'modified',
        description: 'Treaty reset to proposed state after substantial amendment',
        previousStateHash: this.computeTreatyHash(treaty),
        newStateHash: this.computeTreatyHash(treaty)
      });
    }
    
    this.emit('treaty:amended', { treaty, proposal });
  }

  /**
   * Terminates a treaty
   */
  public terminateTreaty(
    treatyId: string, 
    terminatorId: string, 
    reason: string
  ): boolean {
    const treaty = this.treaties.get(treatyId);
    if (!treaty) {
      console.error(`Treaty ${treatyId} not found`);
      return false;
    }

    if (!treaty.parties.includes(terminatorId)) {
      console.error(`Agent ${terminatorId} is not a party to treaty ${treatyId}`);
      return false;
    }

    if (treaty.status !== 'active' && treaty.status !== 'violated') {
      console.error(`Treaty ${treatyId} is not in an active state that can be terminated (${treaty.status})`);
      return false;
    }

    treaty.status = 'terminated';
    treaty.updatedAt = Date.now();
    
    // Add history entry
    treaty.history = treaty.history || [];
    treaty.history.push({
      timestamp: Date.now(),
      agentId: terminatorId,
      changeType: 'terminated',
      description: `Treaty terminated by ${terminatorId}: ${reason}`,
      previousStateHash: this.computeTreatyHash(treaty),
      newStateHash: this.computeTreatyHash(treaty)
    });

    this.persistData();
    this.emit('treaty:terminated', { 
      treaty, 
      terminatorId, 
      reason 
    });
    
    return true;
  }

  /**
   * Reports a treaty violation
   */
  public reportViolation(
    treatyId: string,
    clauseId: string,
    violatorId: string,
    reporterId: string,
    evidence: Record<string, any>,
    description: string,
    severity: number = 5
  ): TreatyViolation | null {
    const treaty = this.treaties.get(treatyId);
    if (!treaty) {
      console.error(`Treaty ${treatyId} not found`);
      return null;
    }

    if (!treaty.parties.includes(violatorId)) {
      console.error(`Agent ${violatorId} is not a party to treaty ${treatyId}`);
      return null;
    }

    if (!treaty.parties.includes(reporterId)) {
      console.error(`Reporter ${reporterId} is not a party to treaty ${treatyId}`);
      return null;
    }

    const clause = treaty.terms.find(c => c.id === clauseId);
    if (!clause) {
      console.error(`Clause ${clauseId} not found in treaty ${treatyId}`);
      return null;
    }

    const violation: TreatyViolation = {
      id: uuidv4(),
      treatyId,
      clauseId,
      violatorId,
      reporterId,
      timestamp: Date.now(),
      evidence,
      description,
      severity,
      status: 'reported',
      remediated: false,
      resolved: false
    };

    this.violations.set(violation.id, violation);

    // Update treaty status
    if (treaty.status === 'active') {
      treaty.status = 'violated';
      treaty.updatedAt = Date.now();
      
      // Add history entry
      treaty.history = treaty.history || [];
      treaty.history.push({
        timestamp: Date.now(),
        agentId: reporterId,
        changeType: 'violated',
        description: `Treaty violation reported by ${reporterId} against ${violatorId}`,
        previousStateHash: this.computeTreatyHash(treaty),
        newStateHash: this.computeTreatyHash(treaty)
      });
    }

    this.persistData();
    this.emit('treaty:violation_reported', { 
      treaty,
      violation,
      violator: violatorId,
      reporter: reporterId,
      clause
    });
    
    return violation;
  }

  /**
   * Updates the status of a violation
   */
  public updateViolationStatus(
    violationId: string,
    newStatus: TreatyViolation['status'],
    agentId: string
  ): TreatyViolation | null {
    const violation = this.violations.get(violationId);
    if (!violation) {
      console.error(`Violation ${violationId} not found`);
      return null;
    }

    const treaty = this.treaties.get(violation.treatyId);
    if (!treaty) {
      console.error(`Treaty ${violation.treatyId} not found`);
      return null;
    }

    if (!treaty.parties.includes(agentId)) {
      console.error(`Agent ${agentId} is not a party to treaty ${violation.treatyId}`);
      return null;
    }

    // Update the violation
    violation.status = newStatus;
    
    // If dismissed or resolved, check if any other active violations
    if (newStatus === 'dismissed' || newStatus === 'resolved') {
      violation.remediated = true;
      
      // Check if any other active violations for this treaty
      const hasActiveViolations = Array.from(this.violations.values()).some(v => 
        v.treatyId === violation.treatyId && 
        v.id !== violationId &&
        !v.remediated &&
        ['reported', 'confirmed', 'disputed'].includes(v.status)
      );
      
      // If no other active violations, revert treaty to active status
      if (!hasActiveViolations && treaty.status === 'violated') {
        treaty.status = 'active';
        treaty.updatedAt = Date.now();
        
        // Add history entry
        treaty.history = treaty.history || [];
        treaty.history.push({
          timestamp: Date.now(),
          agentId,
          changeType: 'reinstated',
          description: 'Treaty reinstated after all violations remediated',
          previousStateHash: this.computeTreatyHash(treaty),
          newStateHash: this.computeTreatyHash(treaty)
        });
      }
    }

    this.persistData();
    this.emit('treaty:violation_updated', { 
      treaty,
      violation,
      updatedBy: agentId,
      newStatus
    });
    
    return violation;
  }

  /**
   * Verifies a treaty's integrity
   */
  public verifyTreaty(treatyId: string): TreatyVerificationResult {
    const treaty = this.treaties.get(treatyId);
    if (!treaty) {
      return {
        isValid: false,
        errors: [`Treaty ${treatyId} not found`]
      };
    }

    const errors: string[] = [];
    
    // Check signatures match current treaty state
    const currentHash = this.computeTreatyHash(treaty);
    
    for (const [agentId, signature] of Object.entries(treaty.signatures)) {
      if (signature.treatyHash && signature.treatyHash !== currentHash) {
        errors.push(`Signature for ${agentId} was for a different treaty state`);
      }
    }
    
    // Check treaty history for consistency
    if (treaty.history && treaty.history.length > 1) {
      for (let i = 1; i < treaty.history.length; i++) {
        const prevEntry = treaty.history[i - 1];
        const currEntry = treaty.history[i];
        
        if (
          prevEntry.newStateHash && 
          currEntry.previousStateHash && 
          prevEntry.newStateHash !== currEntry.previousStateHash
        ) {
          errors.push(`History chain broken between entries ${i-1} and ${i}`);
        }
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Lists all active treaties
   */
  public listActiveTreaties(): AgentTreaty[] {
    return Array.from(this.treaties.values())
      .filter(treaty => ['active', 'negotiating', 'violated'].includes(treaty.status));
  }

  /**
   * Lists all treaties in a domain
   */
  public listTreatiesByDomain(domain: string): AgentTreaty[] {
    return Array.from(this.treaties.values())
      .filter(treaty => treaty.domain === domain);
  }

  /**
   * Lists all violations for a treaty
   */
  public listViolationsForTreaty(treatyId: string): TreatyViolation[] {
    return Array.from(this.violations.values())
      .filter(violation => violation.treatyId === treatyId);
  }

  /**
   * Lists all proposals for a treaty
   */
  public listProposalsForTreaty(treatyId: string): TreatyProposal[] {
    return Array.from(this.proposals.values())
      .filter(proposal => proposal.treatyId === treatyId);
  }
}

// Create singleton instance
let treatyEngineInstance: TreatyEngine | null = null;

export function getTreatyEngine(): TreatyEngine {
  if (!treatyEngineInstance) {
    treatyEngineInstance = new TreatyEngine();
  }
  return treatyEngineInstance;
} 