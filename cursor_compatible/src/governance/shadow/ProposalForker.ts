/**
 * Proposal Forker
 * 
 * Utility for duplicating a live proposal with modified inputs
 * to create alternative simulation tracks
 */

import { v4 as uuidv4 } from 'uuid';
import { ProposalService } from '../proposalService.js';
import { 
  ForkedProposalTrack,
  SimulationMode,
  AgentID
} from '../../types/governance-shadow.types.js';

export class ProposalForker {
  private proposalService: ProposalService | null = null;
  
  /**
   * Initialize with an optional proposal service
   */
  constructor(proposalService?: ProposalService) {
    if (proposalService) {
      this.proposalService = proposalService;
    }
  }
  
  /**
   * Set the proposal service if not provided in constructor
   */
  public setProposalService(service: ProposalService): void {
    this.proposalService = service;
  }
  
  /**
   * Fork an existing proposal to create a parallel track with modified parameters
   * 
   * @param originalId Original proposal ID
   * @param cabinetId ID of the shadow cabinet creating this fork
   * @param overrides Parameter changes to apply to the original proposal
   * @param simulationMode Mode to use for simulation
   * @param isPublic Whether this fork is publicly visible
   */
  public async forkProposal(
    originalId: string,
    cabinetId: string,
    overrides: Record<string, any> = {},
    simulationMode: SimulationMode = SimulationMode.READ_ONLY,
    isPublic: boolean = false
  ): Promise<ForkedProposalTrack> {
    if (!this.proposalService) {
      throw new Error('ProposalService not initialized');
    }
    
    // Get the original proposal
    const original = await this.proposalService.getProposal(originalId);
    if (!original) {
      throw new Error(`Original proposal ${originalId} not found`);
    }
    
    // Create a fork ID
    const forkId = uuidv4();
    
    // Create the forked track
    const forkedTrack: ForkedProposalTrack = {
      id: forkId,
      originProposalId: originalId,
      initiatingCabinetId: cabinetId,
      changes: structuredClone(overrides),
      createdAt: Date.now(),
      status: 'pending',
      simulationMode,
      isPublic
    };
    
    // Apply overrides to create a full shadow copy in metadata
    // This helps preserve the complete shadow proposal for reference
    const shadowProposal = structuredClone(original);
    
    // Apply overrides to the shadow proposal
    if (overrides.title) shadowProposal.title = overrides.title;
    if (overrides.description) shadowProposal.description = overrides.description;
    
    // Handle data object overrides (deeply merge)
    if (overrides.data) {
      shadowProposal.data = this.deepMerge(shadowProposal.data, overrides.data);
    }
    
    // Store full shadow proposal in metadata
    forkedTrack.metadata = {
      shadowProposal
    };
    
    return forkedTrack;
  }
  
  /**
   * Deep merge two objects
   */
  private deepMerge(target: any, source: any): any {
    const output = { ...target };
    
    if (isObject(target) && isObject(source)) {
      Object.keys(source).forEach(key => {
        if (isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    
    return output;
  }
}

// Helper function to check if value is an object
function isObject(item: any): boolean {
  return (item && typeof item === 'object' && !Array.isArray(item));
} 