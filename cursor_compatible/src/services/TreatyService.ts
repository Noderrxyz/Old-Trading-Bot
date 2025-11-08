import { 
  AgentTreaty, 
  TreatyClause, 
  TreatyProposal, 
  TreatyViolation, 
  TreatyStatus 
} from '../types/treaty.types.js';
import { FileSystemService } from './FileSystemService.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Service for managing treaties between agents
 */
export class TreatyService {
  private dataPath: string;
  private fileSystem: FileSystemService;
  
  // In-memory caches
  private treaties: Map<string, AgentTreaty> = new Map();
  private proposals: Map<string, TreatyProposal> = new Map();
  private violations: Map<string, TreatyViolation> = new Map();
  
  constructor(dataPath: string) {
    this.dataPath = dataPath;
    this.fileSystem = new FileSystemService();
    this.initialize();
  }
  
  /**
   * Initialize the service by loading data from disk
   */
  private async initialize(): Promise<void> {
    await this.fileSystem.ensureDirectoryExists(this.dataPath);
    await this.fileSystem.ensureDirectoryExists(`${this.dataPath}/treaties`);
    await this.fileSystem.ensureDirectoryExists(`${this.dataPath}/proposals`);
    await this.fileSystem.ensureDirectoryExists(`${this.dataPath}/violations`);
    
    await this.loadTreaties();
    await this.loadProposals();
    await this.loadViolations();
  }
  
  /**
   * Load all treaties from disk
   */
  private async loadTreaties(): Promise<void> {
    const treatiesDir = `${this.dataPath}/treaties`;
    const fileNames = await this.getFilesInDirectory(treatiesDir);
    
    for (const fileName of fileNames) {
      if (fileName.endsWith('.json')) {
        const treatyData = await this.fileSystem.readFile(`${treatiesDir}/${fileName}`);
        if (treatyData) {
          const treaty = JSON.parse(treatyData) as AgentTreaty;
          this.treaties.set(treaty.treatyId, treaty);
        }
      }
    }
  }
  
  /**
   * Load all proposals from disk
   */
  private async loadProposals(): Promise<void> {
    const proposalsDir = `${this.dataPath}/proposals`;
    const fileNames = await this.getFilesInDirectory(proposalsDir);
    
    for (const fileName of fileNames) {
      if (fileName.endsWith('.json')) {
        const proposalData = await this.fileSystem.readFile(`${proposalsDir}/${fileName}`);
        if (proposalData) {
          const proposal = JSON.parse(proposalData) as TreatyProposal;
          this.proposals.set(proposal.id, proposal);
        }
      }
    }
  }
  
  /**
   * Load all violations from disk
   */
  private async loadViolations(): Promise<void> {
    const violationsDir = `${this.dataPath}/violations`;
    const fileNames = await this.getFilesInDirectory(violationsDir);
    
    for (const fileName of fileNames) {
      if (fileName.endsWith('.json')) {
        const violationData = await this.fileSystem.readFile(`${violationsDir}/${fileName}`);
        if (violationData) {
          const violation = JSON.parse(violationData) as TreatyViolation;
          this.violations.set(violation.id, violation);
        }
      }
    }
  }
  
  /**
   * Helper method to get files in a directory
   */
  private async getFilesInDirectory(dir: string): Promise<string[]> {
    try {
      const fs = require('fs').promises;
      return await fs.readdir(dir);
    } catch (error) {
      console.error(`Error reading directory ${dir}:`, error);
      return [];
    }
  }
  
  /**
   * Save a treaty to disk
   */
  private async saveTreaty(treaty: AgentTreaty): Promise<boolean> {
    try {
      const filePath = `${this.dataPath}/treaties/${treaty.treatyId}.json`;
      await this.fileSystem.writeFile(filePath, JSON.stringify(treaty, null, 2));
      this.treaties.set(treaty.treatyId, treaty);
      return true;
    } catch (error) {
      console.error('Error saving treaty:', error);
      return false;
    }
  }
  
  /**
   * Save a proposal to disk
   */
  private async saveProposal(proposal: TreatyProposal): Promise<boolean> {
    try {
      const filePath = `${this.dataPath}/proposals/${proposal.id}.json`;
      await this.fileSystem.writeFile(filePath, JSON.stringify(proposal, null, 2));
      this.proposals.set(proposal.id, proposal);
      return true;
    } catch (error) {
      console.error('Error saving proposal:', error);
      return false;
    }
  }
  
  /**
   * Save a violation to disk
   */
  private async saveViolation(violation: TreatyViolation): Promise<boolean> {
    try {
      const filePath = `${this.dataPath}/violations/${violation.id}.json`;
      await this.fileSystem.writeFile(filePath, JSON.stringify(violation, null, 2));
      this.violations.set(violation.id, violation);
      return true;
    } catch (error) {
      console.error('Error saving violation:', error);
      return false;
    }
  }
  
  /**
   * Create a new treaty proposal
   */
  async createTreatyProposal(
    proposerId: string,
    title: string,
    parties: string[],
    terms: TreatyClause[],
    description?: string,
    expiresAt?: number
  ): Promise<TreatyProposal> {
    // Generate unique IDs
    const treatyId = uuidv4();
    const proposalId = uuidv4();
    
    // Create a new treaty
    const treaty: AgentTreaty = {
      treatyId,
      title,
      initiator: proposerId,
      parties,
      terms,
      signatures: {},
      status: 'proposed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isPublic: false,
      description: description || '',
      expiresAt
    };
    
    // Create a proposal
    const proposal: TreatyProposal = {
      id: proposalId,
      treatyId,
      proposerId,
      timestamp: Date.now(),
      type: 'initial',
      changes: {
        addClauses: terms
      },
      rationale: description || 'Initial treaty proposal',
      status: 'pending'
    };
    
    // Save both to disk
    await this.saveTreaty(treaty);
    await this.saveProposal(proposal);
    
    return proposal;
  }
  
  /**
   * Get a treaty by ID
   */
  async getTreaty(treatyId: string): Promise<AgentTreaty | null> {
    return this.treaties.get(treatyId) || null;
  }
  
  /**
   * Get all treaties
   */
  async getAllTreaties(): Promise<AgentTreaty[]> {
    return Array.from(this.treaties.values());
  }
  
  /**
   * Get all treaties for a specific agent
   */
  async getAgentTreaties(agentId: string): Promise<AgentTreaty[]> {
    return Array.from(this.treaties.values())
      .filter(treaty => treaty.parties.includes(agentId));
  }
  
  /**
   * Get active treaties for a specific agent
   */
  async getAgentActiveTreaties(agentId: string): Promise<AgentTreaty[]> {
    return Array.from(this.treaties.values())
      .filter(treaty => 
        treaty.parties.includes(agentId) && 
        treaty.status === 'active'
      );
  }
  
  /**
   * Sign a treaty
   */
  async signTreaty(
    treatyId: string, 
    agentId: string, 
    signature: string, 
    notes?: string
  ): Promise<boolean> {
    const treaty = this.treaties.get(treatyId);
    
    if (!treaty) {
      return false;
    }
    
    if (!treaty.parties.includes(agentId)) {
      return false;
    }
    
    // Create signature
    treaty.signatures[agentId] = {
      agentId,
      signedAt: Date.now(),
      digitalSignature: signature,
      notes: notes || ''
    };
    
    // Check if all parties have signed
    const allSigned = treaty.parties.every((partyId: string) => 
      Object.keys(treaty.signatures).includes(partyId)
    );
    
    if (allSigned) {
      treaty.status = 'active';
    }
    
    treaty.updatedAt = Date.now();
    
    // Add history entry
    if (!treaty.history) {
      treaty.history = [];
    }
    
    treaty.history.push({
      timestamp: Date.now(),
      agentId,
      changeType: 'signed',
      description: `Treaty signed by ${agentId}`,
      newStateHash: this.calculateStateHash(treaty)
    });
    
    return this.saveTreaty(treaty);
  }
  
  /**
   * Generate a simple hash for treaty state
   */
  private calculateStateHash(treaty: AgentTreaty): string {
    const treatyString = JSON.stringify(treaty);
    // Simple hash function for demonstration
    let hash = 0;
    for (let i = 0; i < treatyString.length; i++) {
      const char = treatyString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }
  
  /**
   * Report a treaty violation
   */
  async reportViolation(
    treatyId: string,
    clauseId: string,
    violatorId: string,
    reporterId: string,
    description: string,
    evidence: Record<string, any>,
    severity: number
  ): Promise<TreatyViolation | null> {
    const treaty = this.treaties.get(treatyId);
    
    if (!treaty || treaty.status !== 'active') {
      return null;
    }
    
    // Verify that the clause exists
    const clause = treaty.terms.find((term: TreatyClause) => term.id === clauseId);
    if (!clause) {
      return null;
    }
    
    // Create violation report
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
    
    await this.saveViolation(violation);
    
    // Update treaty status
    treaty.status = 'violated';
    treaty.updatedAt = Date.now();
    
    // Add to history
    if (!treaty.history) {
      treaty.history = [];
    }
    
    treaty.history.push({
      timestamp: Date.now(),
      agentId: reporterId,
      changeType: 'violated',
      description: `Violation reported by ${reporterId} against ${violatorId}`,
      newStateHash: this.calculateStateHash(treaty)
    });
    
    await this.saveTreaty(treaty);
    
    return violation;
  }
  
  /**
   * Resolve a treaty violation
   */
  async resolveViolation(
    violationId: string,
    resolverId: string,
    resolution: string
  ): Promise<boolean> {
    const violation = this.violations.get(violationId);
    
    if (!violation) {
      return false;
    }
    
    violation.status = 'resolved';
    violation.resolved = true;
    violation.resolution = resolution;
    
    const treaty = this.treaties.get(violation.treatyId);
    
    if (treaty) {
      // Check if there are any unresolved violations
      const unresolvedViolations = Array.from(this.violations.values())
        .filter(v => 
          v.treatyId === treaty.treatyId && 
          v.status !== 'resolved' && 
          v.status !== 'dismissed'
        );
      
      // If no unresolved violations, set treaty back to active
      if (unresolvedViolations.length === 0) {
        treaty.status = 'active';
        treaty.updatedAt = Date.now();
        
        // Add to history
        if (!treaty.history) {
          treaty.history = [];
        }
        
        treaty.history.push({
          timestamp: Date.now(),
          agentId: resolverId,
          changeType: 'reinstated',
          description: `Treaty reinstated after violation resolution`,
          newStateHash: this.calculateStateHash(treaty)
        });
        
        await this.saveTreaty(treaty);
      }
    }
    
    return this.saveViolation(violation);
  }
  
  /**
   * Terminate a treaty
   */
  async terminateTreaty(
    treatyId: string,
    terminatorId: string,
    reason: string
  ): Promise<boolean> {
    const treaty = this.treaties.get(treatyId);
    
    if (!treaty || treaty.status !== 'active') {
      return false;
    }
    
    // Verify that the terminator is a party to the treaty
    if (!treaty.parties.includes(terminatorId)) {
      return false;
    }
    
    treaty.status = 'terminated';
    treaty.updatedAt = Date.now();
    
    // Add to history
    if (!treaty.history) {
      treaty.history = [];
    }
    
    treaty.history.push({
      timestamp: Date.now(),
      agentId: terminatorId,
      changeType: 'terminated',
      description: `Treaty terminated by ${terminatorId}: ${reason}`,
      previousStateHash: this.calculateStateHash(treaty),
      newStateHash: ''
    });
    
    return this.saveTreaty(treaty);
  }
  
  /**
   * Create an amendment proposal for an existing treaty
   */
  async proposeAmendment(
    treatyId: string,
    proposerId: string,
    addClauses: TreatyClause[] = [],
    removeClauses: string[] = [],
    modifyClauses: TreatyClause[] = [],
    rationale: string
  ): Promise<TreatyProposal | null> {
    const treaty = this.treaties.get(treatyId);
    
    if (!treaty || treaty.status !== 'active') {
      return null;
    }
    
    // Verify that the proposer is a party to the treaty
    if (!treaty.parties.includes(proposerId)) {
      return null;
    }
    
    // Create proposal
    const proposal: TreatyProposal = {
      id: uuidv4(),
      treatyId,
      proposerId,
      timestamp: Date.now(),
      type: 'amendment',
      changes: {
        addClauses,
        removeClauses,
        modifyClauses
      },
      rationale,
      status: 'pending'
    };
    
    await this.saveProposal(proposal);
    return proposal;
  }
  
  /**
   * Get all proposals for a treaty
   */
  async getTreatyProposals(treatyId: string): Promise<TreatyProposal[]> {
    return Array.from(this.proposals.values())
      .filter(proposal => proposal.treatyId === treatyId);
  }
  
  /**
   * Get all violations for a treaty
   */
  async getTreatyViolations(treatyId: string): Promise<TreatyViolation[]> {
    return Array.from(this.violations.values())
      .filter(violation => violation.treatyId === treatyId);
  }
} 