/**
 * Shadow Cabinet Engine
 * 
 * Manages the creation and coordination of alternative governance councils.
 * These shadow cabinets propose and simulate parallel outcomes that
 * could have occurred under different decision paths.
 */

import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { FileSystemService } from '../../services/FileSystemService.js';
import { 
  ShadowCabinet, 
  ForkedProposalTrack, 
  CounterfactualOutcome,
  SimulationMode,
  AgentID
} from '../../types/governance-shadow.types.js';
import { ProposalForker } from './ProposalForker.js';
import { GovernanceOracle } from './GovernanceOracle.js';
import { ProposalType, ProposalService } from '../proposalService.js';

/**
 * Main engine for creating and managing shadow cabinets
 * and alternative proposal tracks
 */
export class ShadowCabinetEngine extends EventEmitter {
  private cabinets: Map<string, ShadowCabinet> = new Map();
  private forks: Map<string, ForkedProposalTrack> = new Map();
  private fs: FileSystemService;
  private proposalForker: ProposalForker;
  private governanceOracle: GovernanceOracle;
  private proposalService: ProposalService;
  
  private cabinetPath: string = 'src/data/governance/shadow/cabinets.json';
  private forksPath: string = 'src/data/governance/shadow/forks.json';
  private outcomesPath: string = 'src/data/governance/shadow/outcomes.json';
  
  constructor(proposalService: ProposalService) {
    super();
    this.fs = new FileSystemService();
    this.proposalForker = new ProposalForker();
    this.governanceOracle = new GovernanceOracle();
    this.proposalService = proposalService;
    
    this.initialize();
  }
  
  /**
   * Initialize the engine by loading persistent data
   */
  private async initialize(): Promise<void> {
    await this.loadPersistedData();
    this.setupEventListeners();
    
    // Ensure data directories exist
    await this.fs.ensureDirectoryExists('src/data/governance/shadow');
  }
  
  /**
   * Load shadow cabinet data from persistent storage
   */
  private async loadPersistedData(): Promise<void> {
    try {
      // Load cabinets
      const cabinetsData = await this.fs.readFile(this.cabinetPath);
      if (cabinetsData) {
        const parsed = JSON.parse(cabinetsData);
        if (parsed.cabinets && Array.isArray(parsed.cabinets)) {
          parsed.cabinets.forEach((cabinet: ShadowCabinet) => {
            this.cabinets.set(cabinet.id, cabinet);
          });
        }
      }
      
      // Load forks
      const forksData = await this.fs.readFile(this.forksPath);
      if (forksData) {
        const parsed = JSON.parse(forksData);
        if (parsed.forks && Array.isArray(parsed.forks)) {
          parsed.forks.forEach((fork: ForkedProposalTrack) => {
            this.forks.set(fork.id, fork);
          });
        }
      }
    } catch (error: any) {
      console.error('Failed to load shadow cabinet data:', error.message);
    }
  }
  
  /**
   * Set up event listeners for governance events
   */
  private setupEventListeners(): void {
    // Listen for new proposals to potentially create shadows
    this.on('proposal:created', this.onProposalCreated.bind(this));
    
    // Listen for proposal outcomes to compare with shadow outcomes
    this.on('proposal:completed', this.onProposalCompleted.bind(this));
  }
  
  /**
   * Handle new proposal creation events
   */
  private async onProposalCreated(proposalId: string): Promise<void> {
    // Find relevant shadow cabinets that might want to fork this proposal
    const proposal = await this.proposalService.getProposal(proposalId);
    if (!proposal) return;
    
    // Find cabinets interested in this proposal type
    const relevantCabinets = Array.from(this.cabinets.values())
      .filter(cabinet => cabinet.active);
    
    for (const cabinet of relevantCabinets) {
      // Check if this cabinet should automatically fork this proposal
      // For now, just fork all active proposals
      await this.forkProposalTrack(proposalId, cabinet.id);
    }
  }
  
  /**
   * Handle proposal completion events
   */
  private async onProposalCompleted(proposalId: string): Promise<void> {
    // Find related forks to compare outcomes
    const relatedForks = Array.from(this.forks.values())
      .filter(fork => 
        fork.originProposalId === proposalId && 
        fork.status === 'completed'
      );
    
    for (const fork of relatedForks) {
      // Compare outcomes between original and forked proposals
      const result = await this.governanceOracle.evaluateFork(
        proposalId, 
        fork.id
      );
      
      // Log the result
      console.log(`Proposal ${proposalId} vs Fork ${fork.id} evaluation: ${result}`);
      
      // Emit an event with the comparison results
      this.emit('shadow:comparison', {
        originalId: proposalId,
        forkId: fork.id,
        result
      });
    }
  }
  
  /**
   * Save data to persistent storage
   */
  private async persistData(): Promise<void> {
    try {
      // Save cabinets
      const cabinetsData = {
        cabinets: Array.from(this.cabinets.values()),
        updatedAt: Date.now(),
        schema: {
          version: "1.0",
          description: "Shadow cabinet configurations"
        }
      };
      await this.fs.writeFile(this.cabinetPath, JSON.stringify(cabinetsData, null, 2));
      
      // Save forks
      const forksData = {
        forks: Array.from(this.forks.values()),
        updatedAt: Date.now(),
        schema: {
          version: "1.0",
          description: "Forked proposal tracks"
        }
      };
      await this.fs.writeFile(this.forksPath, JSON.stringify(forksData, null, 2));
    } catch (error: any) {
      console.error('Failed to persist shadow cabinet data:', error.message);
    }
  }
  
  /**
   * Create a new shadow cabinet that mirrors an existing governance council
   */
  public async createShadowCabinet(
    fromCouncilId: string,
    members: AgentID[],
    description: string = "Alternative perspective governance cabinet"
  ): Promise<ShadowCabinet> {
    const cabinetId = uuidv4();
    
    const cabinet: ShadowCabinet = {
      id: cabinetId,
      originCouncilId: fromCouncilId,
      members,
      createdAt: Date.now(),
      simulatedProposals: [],
      description,
      active: true,
      metadata: {}
    };
    
    this.cabinets.set(cabinetId, cabinet);
    await this.persistData();
    
    this.emit('shadow:cabinet_created', { cabinet });
    return cabinet;
  }
  
  /**
   * Fork an existing proposal to create a parallel track with modified parameters
   */
  public async forkProposalTrack(
    proposalId: string,
    cabinetId: string,
    changes: Record<string, any> = {},
    simulationMode: SimulationMode = SimulationMode.READ_ONLY,
    isPublic: boolean = false
  ): Promise<ForkedProposalTrack> {
    // Check if cabinet exists
    const cabinet = this.cabinets.get(cabinetId);
    if (!cabinet) {
      throw new Error(`Shadow cabinet ${cabinetId} not found`);
    }
    
    // Create forked track
    const fork = await this.proposalForker.forkProposal(
      proposalId,
      cabinetId,
      changes,
      simulationMode,
      isPublic
    );
    
    // Store in memory and track in cabinet
    this.forks.set(fork.id, fork);
    cabinet.simulatedProposals.push(fork.id);
    
    await this.persistData();
    
    this.emit('shadow:proposal_forked', { 
      originProposalId: proposalId,
      fork,
      cabinetId
    });
    
    // Start simulation
    this.simulateOutcome(fork.id);
    
    return fork;
  }
  
  /**
   * Simulate the outcome of a forked proposal track
   */
  public async simulateOutcome(trackId: string): Promise<CounterfactualOutcome | null> {
    const fork = this.forks.get(trackId);
    if (!fork) {
      throw new Error(`Forked track ${trackId} not found`);
    }
    
    // Update status
    fork.status = 'simulating';
    await this.persistData();
    
    try {
      // Run the simulation
      console.log(`Starting simulation for fork ${trackId}`);
      
      // Placeholder for actual simulation logic
      // In a real implementation, this would run a complex simulation based on the
      // fork's parameters and proposal type
      const outcome: CounterfactualOutcome = {
        impactScore: Math.random() * 20 - 10, // -10 to 10
        trustDelta: {},
        proposalSuccess: Math.random() > 0.3, // 70% chance of success for example
        metrics: {
          systemStability: Math.random() * 100,
          resourceUtilization: Math.random() * 100,
          agentSatisfaction: Math.random() * 100
        },
        notes: `Simulated outcome for fork ${trackId}`,
        completedAt: Date.now(),
        confidence: 0.7 + (Math.random() * 0.3) // 0.7 to 1.0
      };
      
      // Add trust delta for some agents
      const cabinet = this.cabinets.get(fork.initiatingCabinetId);
      if (cabinet) {
        cabinet.members.forEach(agentId => {
          outcome.trustDelta[agentId] = (Math.random() * 0.4) - 0.2; // -0.2 to 0.2
        });
      }
      
      // Update fork with simulation result
      fork.simulationResult = outcome;
      fork.status = 'completed';
      
      await this.persistData();
      
      this.emit('shadow:simulation_completed', {
        forkId: trackId,
        outcome
      });
      
      return outcome;
    } catch (error: any) {
      console.error(`Simulation failed for fork ${trackId}:`, error.message);
      
      // Update status
      fork.status = 'pending';
      await this.persistData();
      
      this.emit('shadow:simulation_failed', {
        forkId: trackId,
        error: error.message
      });
      
      return null;
    }
  }
  
  /**
   * Promote a shadow proposal to replace the original if approved
   */
  public async promoteShadowProposal(proposalId: string): Promise<boolean> {
    const fork = this.forks.get(proposalId);
    if (!fork) {
      throw new Error(`Forked track ${proposalId} not found`);
    }
    
    if (fork.status !== 'completed') {
      throw new Error(`Forked track ${proposalId} has not completed simulation`);
    }
    
    // In a real implementation, this would require a governance vote
    // For now, we'll just promote it directly
    
    try {
      // TODO: Replace the original proposal with this fork's version
      // This is a placeholder
      console.log(`Promoting shadow proposal ${proposalId} to replace original ${fork.originProposalId}`);
      
      // Update status
      fork.status = 'promoted';
      await this.persistData();
      
      this.emit('shadow:proposal_promoted', {
        forkId: proposalId,
        originalId: fork.originProposalId
      });
      
      return true;
    } catch (error: any) {
      console.error(`Failed to promote shadow proposal ${proposalId}:`, error.message);
      return false;
    }
  }
  
  /**
   * Get all shadow cabinets
   */
  public getAllCabinets(): ShadowCabinet[] {
    return Array.from(this.cabinets.values());
  }
  
  /**
   * Get all forked proposal tracks
   */
  public getAllForks(): ForkedProposalTrack[] {
    return Array.from(this.forks.values());
  }
  
  /**
   * Get a specific shadow cabinet by ID
   */
  public getCabinet(cabinetId: string): ShadowCabinet | null {
    return this.cabinets.get(cabinetId) || null;
  }
  
  /**
   * Get a specific forked track by ID
   */
  public getFork(forkId: string): ForkedProposalTrack | null {
    return this.forks.get(forkId) || null;
  }
  
  /**
   * Get all forks for a specific original proposal
   */
  public getForksForProposal(originalProposalId: string): ForkedProposalTrack[] {
    return Array.from(this.forks.values())
      .filter(fork => fork.originProposalId === originalProposalId);
  }
  
  /**
   * Get all forks created by a specific shadow cabinet
   */
  public getForksForCabinet(cabinetId: string): ForkedProposalTrack[] {
    return Array.from(this.forks.values())
      .filter(fork => fork.initiatingCabinetId === cabinetId);
  }
} 