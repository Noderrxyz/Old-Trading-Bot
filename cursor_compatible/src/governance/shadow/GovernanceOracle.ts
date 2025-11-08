/**
 * Governance Oracle
 * 
 * Evaluates which proposal version (original or shadow) is more optimal
 * using hindsight, simulations, or other metrics
 */

import { ProposalService } from '../proposalService.js';
import { ShadowCabinetEngine } from './ShadowCabinetEngine.js';
import { 
  ForkedProposalTrack,
  CounterfactualOutcome,
  ProposalComparisonResult
} from '../../types/governance-shadow.types.js';

/**
 * Metrics for evaluating proposals
 */
interface ProposalMetrics {
  /** Overall score */
  overallScore: number;
  
  /** Risk level */
  risk: number;
  
  /** Estimated impact */
  impact: number;
  
  /** Community support */
  support: number;
  
  /** Resource efficiency */
  efficiency: number;
  
  /** Additional metrics */
  additionalMetrics: Record<string, number>;
}

export class GovernanceOracle {
  private proposalService: ProposalService | null = null;
  private shadowEngine: ShadowCabinetEngine | null = null;
  
  /**
   * Initialize with optional services
   */
  constructor(
    proposalService?: ProposalService,
    shadowEngine?: ShadowCabinetEngine
  ) {
    this.proposalService = proposalService || null;
    this.shadowEngine = shadowEngine || null;
  }
  
  /**
   * Set the required services
   */
  public setServices(
    proposalService: ProposalService,
    shadowEngine: ShadowCabinetEngine
  ): void {
    this.proposalService = proposalService;
    this.shadowEngine = shadowEngine;
  }
  
  /**
   * Evaluate which proposal is better - the original or the shadow fork
   */
  public async evaluateFork(
    originalId: string,
    shadowForkId: string
  ): Promise<ProposalComparisonResult> {
    if (!this.proposalService || !this.shadowEngine) {
      throw new Error('Required services not initialized');
    }
    
    // Get the original proposal
    const original = await this.proposalService.getProposal(originalId);
    if (!original) {
      throw new Error(`Original proposal ${originalId} not found`);
    }
    
    // Get the shadow fork
    const shadowFork = this.shadowEngine.getFork(shadowForkId);
    if (!shadowFork) {
      throw new Error(`Shadow fork ${shadowForkId} not found`);
    }
    
    if (!shadowFork.simulationResult) {
      throw new Error(`Shadow fork ${shadowForkId} has no simulation result`);
    }
    
    // Compare the actual outcome with the simulated outcome
    return this.compareProposals(original, shadowFork);
  }
  
  /**
   * Compare an original proposal with its shadow fork
   */
  private compareProposals(
    original: any,
    shadowFork: ForkedProposalTrack
  ): ProposalComparisonResult {
    if (!shadowFork.simulationResult) {
      return 'undecided';
    }
    
    // Extract simulation metrics
    const simulationResult = shadowFork.simulationResult;
    
    // Let's consider a simplified case where we just use the impact score
    // In a real implementation, this would be much more sophisticated
    
    // Original proposal was implemented, so let's assign it an arbitrary score
    // This would come from actual metrics in a real system
    const originalScore = this.calculateOriginalScore(original);
    
    // Get the simulated score
    const shadowScore = simulationResult.impactScore;
    
    console.log(`Original proposal score: ${originalScore}`);
    console.log(`Shadow proposal score: ${shadowScore}`);
    
    // Allow for a small margin to avoid frequent changes for minimal gains
    const margin = 1.0;
    
    if (shadowScore > originalScore + margin) {
      return 'shadow';
    } else if (originalScore > shadowScore + margin) {
      return 'original';
    } else {
      return 'undecided';
    }
  }
  
  /**
   * Calculate a score for the original proposal based on its outcome
   */
  private calculateOriginalScore(original: any): number {
    // In a real implementation, this would pull actual metrics
    // from the system to evaluate how well the proposal performed
    
    // For now, just return a random score in the same range as shadow scores
    return Math.random() * 20 - 10; // -10 to 10
  }
  
  /**
   * Extracts metrics from a proposal's results
   */
  public async getProposalMetrics(proposalId: string): Promise<ProposalMetrics> {
    if (!this.proposalService) {
      throw new Error('ProposalService not initialized');
    }
    
    const proposal = await this.proposalService.getProposal(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }
    
    // In a real implementation, this would extract actual metrics
    // based on the proposal's impact since implementation
    
    // For demonstration, return placeholder metrics
    return {
      overallScore: Math.random() * 10,
      risk: Math.random() * 10,
      impact: Math.random() * 10,
      support: Math.random() * 10,
      efficiency: Math.random() * 10,
      additionalMetrics: {
        stability: Math.random() * 10,
        innovation: Math.random() * 10,
        costEffectiveness: Math.random() * 10
      }
    };
  }
} 