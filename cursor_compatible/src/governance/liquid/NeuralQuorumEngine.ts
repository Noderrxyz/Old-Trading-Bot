import { injectable, inject } from 'inversify';
import { TYPES } from '../../types';
import { RedisClientType } from 'redis';
import { Logger } from '../../services/LogService';
import { FileSystemService } from '../../services/FileSystemService';
import { NeuralPathAnalyzer } from './NeuralPathAnalyzer';
import { Proposal } from '../../types/governance.types';

@injectable()
export class NeuralQuorumEngine {
  private config: any;
  private configPath = 'src/data/governance/liquid/neural_quorum.config.json';
  
  constructor(
    @inject(TYPES.RedisClient) private redisClient: RedisClientType,
    @inject(TYPES.Logger) private logger: Logger,
    @inject(TYPES.FileSystemService) private fs: FileSystemService,
    @inject(TYPES.NeuralPathAnalyzer) private neuralPathAnalyzer: NeuralPathAnalyzer
  ) {
    this.loadConfig();
  }

  private async loadConfig(): Promise<void> {
    try {
      const configData = await this.fs.readFile(this.configPath);
      this.config = JSON.parse(configData);
      this.logger.info('NeuralQuorumEngine: Configuration loaded successfully');
    } catch (error) {
      this.logger.error(`NeuralQuorumEngine: Failed to load configuration: ${error}`);
      // Set default configuration
      this.config = {
        quorumThreshold: 0.5,
        minParticipation: 0.3,
        trustWeightFactor: 0.7,
        influenceDecayRate: 0.15,
        maxPathLength: 5
      };
    }
  }

  /**
   * Determine if a proposal has reached neural quorum
   * @param proposalId The ID of the proposal to check
   * @returns Boolean indicating whether quorum has been reached
   */
  public async hasReachedQuorum(proposalId: string): Promise<boolean> {
    try {
      const proposal = await this.getProposal(proposalId);
      if (!proposal) {
        throw new Error(`Proposal with ID ${proposalId} not found`);
      }

      // Build neural influence map for this proposal
      const neuralMap = await this.neuralPathAnalyzer.buildNeuralInfluenceMap(proposalId);
      
      // Calculate total influence based on neural paths
      const totalInfluence = await this.calculateTotalInfluence(neuralMap);
      
      // Get total eligible participants (agents) for this proposal
      const totalParticipants = await this.getTotalParticipants(proposal);
      
      // Calculate participation rate
      const participationRate = Object.keys(neuralMap).length / totalParticipants;
      
      // Check if minimum participation threshold is met
      if (participationRate < this.config.minParticipation) {
        this.logger.info(`NeuralQuorumEngine: Proposal ${proposalId} has not reached minimum participation threshold`);
        return false;
      }
      
      // Check if influence threshold is met
      const quorumReached = totalInfluence >= this.config.quorumThreshold;
      
      await this.storeQuorumStatus(proposalId, quorumReached, totalInfluence, participationRate);
      
      return quorumReached;
    } catch (error) {
      this.logger.error(`NeuralQuorumEngine: Error determining quorum for proposal ${proposalId}: ${error}`);
      return false;
    }
  }

  private async calculateTotalInfluence(neuralMap: Record<string, any>): Promise<number> {
    let totalInfluence = 0;
    
    // Sum up the influence from each agent node in the neural map
    for (const agentId in neuralMap) {
      const node = neuralMap[agentId];
      totalInfluence += node.totalInfluence;
    }
    
    return totalInfluence;
  }

  private async getProposal(proposalId: string): Promise<Proposal | null> {
    try {
      const proposalData = await this.redisClient.get(`proposal:${proposalId}`);
      if (!proposalData) return null;
      return JSON.parse(proposalData);
    } catch (error) {
      this.logger.error(`NeuralQuorumEngine: Error fetching proposal ${proposalId}: ${error}`);
      return null;
    }
  }

  private async getTotalParticipants(proposal: Proposal): Promise<number> {
    // Get the total number of agents eligible to participate in this proposal
    try {
      const key = `governance:eligible:${proposal.governanceId}`;
      const count = await this.redisClient.sCard(key);
      return count > 0 ? count : 100; // Default fallback if no data available
    } catch (error) {
      this.logger.error(`NeuralQuorumEngine: Error getting total participants: ${error}`);
      return 100; // Default fallback
    }
  }

  private async storeQuorumStatus(
    proposalId: string, 
    quorumReached: boolean, 
    totalInfluence: number, 
    participationRate: number
  ): Promise<void> {
    try {
      const quorumStatus = {
        proposalId,
        quorumReached,
        totalInfluence,
        participationRate,
        timestamp: Date.now()
      };
      
      await this.redisClient.set(`quorum:status:${proposalId}`, JSON.stringify(quorumStatus));
      this.logger.info(`NeuralQuorumEngine: Stored quorum status for proposal ${proposalId}`);
    } catch (error) {
      this.logger.error(`NeuralQuorumEngine: Error storing quorum status: ${error}`);
    }
  }

  /**
   * Get detailed quorum analytics for a proposal
   * @param proposalId The ID of the proposal
   * @returns Detailed analytics about the quorum status
   */
  public async getQuorumAnalytics(proposalId: string): Promise<any> {
    try {
      // Build neural influence map
      const neuralMap = await this.neuralPathAnalyzer.buildNeuralInfluenceMap(proposalId);
      
      // Get top influencers (agents with highest influence)
      const topInfluencers = Object.entries(neuralMap)
        .sort(([, a]: any, [, b]: any) => b.totalInfluence - a.totalInfluence)
        .slice(0, 10)
        .map(([agentId, data]: any) => ({
          agentId,
          influence: data.totalInfluence,
          connections: Object.keys(data.connections).length
        }));
      
      // Get proposal status
      const proposal = await this.getProposal(proposalId);
      const totalParticipants = await this.getTotalParticipants(proposal!);
      const participationRate = Object.keys(neuralMap).length / totalParticipants;
      
      // Calculate total influence
      const totalInfluence = await this.calculateTotalInfluence(neuralMap);
      
      return {
        proposalId,
        quorumReached: totalInfluence >= this.config.quorumThreshold,
        totalInfluence,
        quorumThreshold: this.config.quorumThreshold,
        participationRate,
        minParticipationThreshold: this.config.minParticipation,
        participantCount: Object.keys(neuralMap).length,
        totalEligibleParticipants: totalParticipants,
        topInfluencers
      };
    } catch (error) {
      this.logger.error(`NeuralQuorumEngine: Error getting quorum analytics: ${error}`);
      throw new Error(`Failed to retrieve quorum analytics for proposal ${proposalId}`);
    }
  }
} 