/**
 * Redis Service
 * 
 * Service for interacting with Redis data through the API
 * This is a mock implementation for frontend use
 */

/**
 * Redis Service for federation data
 */
export class RedisService {
  private static instance: RedisService;
  private apiBase: string;
  
  /**
   * Create a new Redis service
   * @param apiBase Base URL for API
   */
  private constructor(apiBase: string = '/api') {
    this.apiBase = apiBase;
  }

  /**
   * Get the Redis service instance (singleton)
   */
  public static getInstance(apiBase?: string): RedisService {
    if (!RedisService.instance) {
      RedisService.instance = new RedisService(apiBase);
    }
    return RedisService.instance;
  }

  /**
   * Get treasury balance for a cluster
   * @param clusterId Cluster ID
   * @returns Treasury balance
   */
  public async getTreasuryBalance(clusterId: string): Promise<number> {
    try {
      const response = await fetch(`${this.apiBase}/federation/treasury/${clusterId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch treasury balance: ${response.statusText}`);
      }
      const data = await response.json();
      return data.balance;
    } catch (error) {
      console.error(`Error fetching treasury balance for ${clusterId}:`, error);
      throw error;
    }
  }

  /**
   * Get trust score for a cluster
   * @param clusterId Cluster ID
   * @returns Trust score
   */
  public async getTrustScore(clusterId: string): Promise<number> {
    try {
      const response = await fetch(`${this.apiBase}/federation/trust/${clusterId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch trust score: ${response.statusText}`);
      }
      const data = await response.json();
      return data.score;
    } catch (error) {
      console.error(`Error fetching trust score for ${clusterId}:`, error);
      throw error;
    }
  }

  /**
   * Get trust violations for a cluster
   * @param clusterId Cluster ID
   * @returns Trust violations
   */
  public async getTrustViolations(clusterId: string): Promise<TrustViolation[]> {
    try {
      const response = await fetch(`${this.apiBase}/federation/trust/violations/${clusterId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch trust violations: ${response.statusText}`);
      }
      const data = await response.json();
      return data.violations;
    } catch (error) {
      console.error(`Error fetching trust violations for ${clusterId}:`, error);
      throw error;
    }
  }

  /**
   * Get all clusters' treasury balances
   * @returns Map of cluster IDs to treasury balances
   */
  public async getAllTreasuryBalances(): Promise<Record<string, number>> {
    try {
      const response = await fetch(`${this.apiBase}/federation/treasury/all`);
      if (!response.ok) {
        throw new Error(`Failed to fetch all treasury balances: ${response.statusText}`);
      }
      const data = await response.json();
      return data.balances;
    } catch (error) {
      console.error('Error fetching all treasury balances:', error);
      throw error;
    }
  }

  /**
   * Create a governance proposal
   * @param proposal Governance proposal
   * @returns Proposal ID
   */
  public async createProposal(proposal: GovernanceProposal): Promise<string> {
    try {
      const response = await fetch(`${this.apiBase}/federation/governance/proposals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(proposal),
      });
      if (!response.ok) {
        throw new Error(`Failed to create proposal: ${response.statusText}`);
      }
      const data = await response.json();
      return data.proposalId;
    } catch (error) {
      console.error('Error creating proposal:', error);
      throw error;
    }
  }
}

/**
 * Trust violation interface
 */
export interface TrustViolation {
  id: string;
  clusterId: string;
  violationType: string;
  description: string;
  severity: number;
  timestamp: string;
  resolved: boolean;
}

/**
 * Governance proposal interface
 */
export interface GovernanceProposal {
  title: string;
  description: string;
  category: 'parameter' | 'governance' | 'resource' | 'network' | 'treasury' | 'slash';
  proposerId: string;
  proposerName: string;
  deadline: string;
  details: any;
} 