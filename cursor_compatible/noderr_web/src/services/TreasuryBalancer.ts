/**
 * Treasury Balancer Service
 * 
 * Service for balancing treasury funds between federation clusters
 */

import { RedisService, GovernanceProposal } from './RedisService';
import { WebSocketService } from './WebSocketService';

// Constants for treasury balancing
const MIN_IMBALANCE_THRESHOLD = 0.15; // 15% imbalance required to trigger rebalance
const MAX_TRANSFER_PER_EPOCH = 500000; // Maximum transfer amount per rebalance
const MIN_TRANSFER_AMOUNT = 10000; // Minimum transfer amount to avoid tiny transfers

/**
 * Treasury Balancer Service
 */
export class TreasuryBalancer {
  private static instance: TreasuryBalancer;
  private redisService: RedisService;
  private wsService: WebSocketService;
  private balancerInterval: number | null = null;
  private intervalMs: number = 3600000; // Default to 1 hour
  
  /**
   * Create a new Treasury Balancer
   */
  private constructor() {
    this.redisService = RedisService.getInstance();
    this.wsService = WebSocketService.getInstance();
  }

  /**
   * Get the Treasury Balancer instance (singleton)
   */
  public static getInstance(): TreasuryBalancer {
    if (!TreasuryBalancer.instance) {
      TreasuryBalancer.instance = new TreasuryBalancer();
    }
    return TreasuryBalancer.instance;
  }

  /**
   * Start the balancer daemon
   * @param intervalMs Interval in milliseconds (default: 1 hour)
   */
  public start(intervalMs: number = this.intervalMs): void {
    // Clear any existing interval
    if (this.balancerInterval) {
      clearInterval(this.balancerInterval);
    }
    
    this.intervalMs = intervalMs;
    
    // Run once immediately
    this.checkAndBalanceTreasuries();
    
    // Start interval
    this.balancerInterval = window.setInterval(() => {
      this.checkAndBalanceTreasuries();
    }, this.intervalMs);
    
    console.log(`Treasury Balancer started with ${this.intervalMs}ms interval`);
  }

  /**
   * Stop the balancer daemon
   */
  public stop(): void {
    if (this.balancerInterval) {
      clearInterval(this.balancerInterval);
      this.balancerInterval = null;
      console.log('Treasury Balancer stopped');
    }
  }

  /**
   * Check and balance treasuries
   */
  public async checkAndBalanceTreasuries(): Promise<void> {
    try {
      // Get all treasury balances
      const balances = await this.redisService.getAllTreasuryBalances();
      const clusterIds = Object.keys(balances);
      
      if (clusterIds.length < 2) {
        console.log('Not enough clusters for treasury balancing');
        return;
      }
      
      // Calculate median balance
      const balanceValues = Object.values(balances);
      const medianBalance = this.getMedian(balanceValues);
      
      // Find clusters with surplus and deficit
      const surplusClusters: Array<{ id: string; surplus: number; trustScore: number }> = [];
      const deficitClusters: Array<{ id: string; deficit: number; trustScore: number }> = [];
      
      // Calculate imbalances
      for (const clusterId of clusterIds) {
        const balance = balances[clusterId];
        const trustScore = await this.redisService.getTrustScore(clusterId);
        
        const imbalance = balance - medianBalance;
        const imbalanceRatio = Math.abs(imbalance) / medianBalance;
        
        // Only consider significant imbalances
        if (imbalanceRatio > MIN_IMBALANCE_THRESHOLD) {
          if (imbalance > 0) {
            surplusClusters.push({ id: clusterId, surplus: imbalance, trustScore });
          } else {
            deficitClusters.push({ id: clusterId, deficit: Math.abs(imbalance), trustScore });
          }
        }
      }
      
      // Sort clusters by imbalance amount (weighted by trust score)
      surplusClusters.sort((a, b) => (b.surplus * b.trustScore) - (a.surplus * a.trustScore));
      deficitClusters.sort((a, b) => (b.deficit * b.trustScore) - (a.deficit * a.trustScore));
      
      // Generate rebalance proposals
      for (const deficitCluster of deficitClusters) {
        // Find suitable surplus cluster
        for (const surplusCluster of surplusClusters) {
          // Skip if this surplus cluster doesn't have enough surplus left
          if (surplusCluster.surplus < MIN_TRANSFER_AMOUNT) continue;
          
          // Calculate amounts based on our formula
          const imbalanceScore = deficitCluster.trustScore * (deficitCluster.deficit / medianBalance);
          
          // Use a mock value for governance participation (in production this would come from actual data)
          const governanceParticipation = 0.8 + (Math.random() * 0.2); // 80-100% participation
          
          const priority = imbalanceScore * governanceParticipation;
          const amountToSend = Math.min(
            MAX_TRANSFER_PER_EPOCH,
            Math.min(surplusCluster.surplus, deficitCluster.deficit) * priority
          );
          
          // Apply minimum transfer threshold
          if (amountToSend < MIN_TRANSFER_AMOUNT) continue;
          
          // Round amount to whole number
          const finalAmount = Math.floor(amountToSend);
          
          // Create rebalance proposal
          await this.createRebalanceProposal(
            surplusCluster.id,
            deficitCluster.id,
            finalAmount,
            `Trust-weighted imbalance (${(imbalanceScore * 100).toFixed(1)}%) with priority ${(priority * 100).toFixed(1)}%`
          );
          
          // Update surplus for this cluster
          surplusCluster.surplus -= finalAmount;
          
          // Update deficit for the deficit cluster
          deficitCluster.deficit -= finalAmount;
          
          // Break if the deficit is resolved
          if (deficitCluster.deficit < MIN_TRANSFER_AMOUNT) break;
        }
      }
    } catch (error) {
      console.error('Error in treasury balancing:', error);
    }
  }

  /**
   * Create a rebalance proposal
   * @param sourceCluster Source cluster ID
   * @param targetCluster Target cluster ID
   * @param amount Amount to transfer
   * @param reason Reason for transfer
   */
  private async createRebalanceProposal(
    sourceCluster: string,
    targetCluster: string,
    amount: number,
    reason: string
  ): Promise<void> {
    try {
      // Create governance proposal
      const proposal: GovernanceProposal = {
        title: `Treasury Rebalance: ${sourceCluster} → ${targetCluster}`,
        description: `Transfer ${amount.toLocaleString()} from ${sourceCluster} to ${targetCluster} for treasury rebalancing.`,
        category: 'treasury',
        proposerId: 'meta-agent-treasury',
        proposerName: 'Treasury Meta-Agent',
        deadline: new Date(Date.now() + 86400000).toISOString(), // 24 hours
        details: {
          sourceCluster,
          targetCluster,
          amount,
          reason,
          type: 'rebalance'
        }
      };
      
      const proposalId = await this.redisService.createProposal(proposal);
      
      // Emit WebSocket event
      if (this.wsService.isConnected()) {
        // Broadcasting is handled by the server, but we can emit the event here for UI updates
        console.log('Emitted rebalance proposal:', {
          type: 'REBALANCE_PROPOSAL',
          source: sourceCluster,
          target: targetCluster,
          amount,
          reason
        });
      }
      
      console.log(`Created rebalance proposal ${proposalId} from ${sourceCluster} to ${targetCluster} for ${amount}`);
    } catch (error) {
      console.error('Error creating rebalance proposal:', error);
    }
  }

  /**
   * Calculate median of array of numbers
   * @param values Array of numbers
   * @returns Median value
   */
  private getMedian(values: number[]): number {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }
} 