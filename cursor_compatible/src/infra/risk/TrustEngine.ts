/**
 * Trust Engine
 * 
 * Manages trust scores for execution venues based on historical performance
 * and reliability metrics.
 */

/**
 * Trust record for a venue
 */
export interface TrustRecord {
  // Current trust score (0-1)
  score: number;
  
  // Total number of executions
  executionCount: number;
  
  // Failed execution count
  failureCount: number;
  
  // Average slippage in basis points
  avgSlippageBps: number;
  
  // Average latency in ms
  avgLatencyMs: number;
  
  // Last updated timestamp
  updatedAt: number;
  
  // Venue reliability factor (0-1)
  reliabilityFactor: number;
}

/**
 * TrustEngine configuration
 */
export interface TrustEngineConfig {
  // Default trust score for new venues
  defaultTrustScore: number;
  
  // Minimum trust score
  minTrustScore: number;
  
  // Maximum trust score
  maxTrustScore: number;
  
  // Weight factors for scoring
  weights: {
    reliability: number;
    slippage: number;
    latency: number;
    history: number;
  };
  
  // Penalty for failed executions
  failurePenalty: number;
  
  // History decay factor (how quickly old data loses importance)
  historyDecayFactor: number;
}

/**
 * Trust Engine interface
 * 
 * The core interface required for venue trust scoring.
 * Other implementation-specific methods should be added in concrete implementations.
 */
export interface TrustEngine {
  // Get trust score for a venue (0-1)
  getVenueTrust(venueId: string): Promise<number>;
  
  // Update trust score for a venue
  updateVenueTrust(venueId: string, score: number): Promise<void>;
}

/**
 * Trust score configuration
 */
export interface TrustConfig {
  // Maximum trust score
  maxTrustScore: number;
  
  // Minimum trust score
  minTrustScore: number;
  
  // Default trust score for new venues
  defaultTrustScore: number;
  
  // How quickly trust scores decay over time (0-1)
  decayRate: number;
  
  // Maximum penalty for a single incident
  maxPenalty: number;
  
  // Maximum reward for a single success
  maxReward: number;
  
  // Whether to persist trust scores
  persistScores: boolean;
}

/**
 * Default trust configuration
 */
const DEFAULT_TRUST_CONFIG: TrustConfig = {
  maxTrustScore: 1.0,
  minTrustScore: 0.0,
  defaultTrustScore: 0.7,
  decayRate: 0.01,
  maxPenalty: 0.2,
  maxReward: 0.1,
  persistScores: true
};

/**
 * Trust Engine for managing venue trust scores
 */
export class TrustEngine {
  // Map of venue IDs to trust records
  private trustScores: Map<string, TrustRecord> = new Map();
  
  /**
   * Create a new trust engine
   * @param config Trust configuration
   */
  constructor(private readonly config: TrustConfig = DEFAULT_TRUST_CONFIG) {}
  
  /**
   * Get the trust score for a venue
   * @param venueId Venue identifier
   * @returns Trust score between 0 and 1
   */
  async getVenueTrust(venueId: string): Promise<number> {
    // Get current trust record
    const record = this.getTrustRecord(venueId);
    
    // Apply time decay
    const daysSinceLastUpdate = 
      (Date.now() - record.updatedAt) / (1000 * 60 * 60 * 24);
    
    if (daysSinceLastUpdate > 0) {
      // Apply decay based on time elapsed
      record.score = Math.max(
        this.config.minTrustScore,
        record.score - (this.config.decayRate * daysSinceLastUpdate)
      );
      record.updatedAt = Date.now();
    }
    
    return record.score;
  }
  
  /**
   * Penalize a venue for failures or issues
   * @param venueId Venue identifier
   * @param reason Reason for penalty
   * @param severity Severity of the issue (0-1)
   */
  async penalizeVenue(
    venueId: string, 
    reason: string,
    severity: number = 0.5
  ): Promise<void> {
    const record = this.getTrustRecord(venueId);
    
    // Calculate penalty (capped by max penalty)
    const penalty = Math.min(severity * 0.2, this.config.maxPenalty);
    
    // Apply penalty
    record.score = Math.max(
      this.config.minTrustScore,
      record.score - penalty
    );
    
    // Record incident
    record.incidents.push({
      timestamp: Date.now(),
      type: reason,
      severity,
      description: `Penalized for ${reason} with severity ${severity}`
    });
    
    // Update failure count
    record.failureCount += 1;
    
    // Update timestamp
    record.updatedAt = Date.now();
    
    // Persist if enabled
    if (this.config.persistScores) {
      this.persistTrustScores();
    }
  }
  
  /**
   * Reward a venue for successful execution
   * @param venueId Venue identifier
   * @param reason Reason for reward
   * @param magnitude Magnitude of the success (0-1)
   */
  async rewardVenue(
    venueId: string,
    reason: string,
    magnitude: number = 0.5
  ): Promise<void> {
    const record = this.getTrustRecord(venueId);
    
    // Calculate reward (capped by max reward)
    const reward = Math.min(magnitude * 0.1, this.config.maxReward);
    
    // Apply reward
    record.score = Math.min(
      this.config.maxTrustScore,
      record.score + reward
    );
    
    // Update success count
    record.executionCount += 1;
    
    // Update timestamp
    record.updatedAt = Date.now();
    
    // Persist if enabled
    if (this.config.persistScores) {
      this.persistTrustScores();
    }
  }
  
  /**
   * Reset trust score for a venue to default
   * @param venueId Venue identifier
   */
  resetVenueTrust(venueId: string): void {
    this.trustScores.set(venueId, this.createDefaultTrustRecord());
    
    // Persist if enabled
    if (this.config.persistScores) {
      this.persistTrustScores();
    }
  }
  
  /**
   * Get all venue trust scores
   * @returns Map of venue IDs to trust scores
   */
  getAllVenueTrustScores(): Map<string, number> {
    const result = new Map<string, number>();
    
    for (const [venueId, record] of this.trustScores.entries()) {
      result.set(venueId, record.score);
    }
    
    return result;
  }
  
  /**
   * Get venue incidents
   * @param venueId Venue identifier
   * @returns Array of incidents
   */
  getVenueIncidents(venueId: string): Array<{
    timestamp: number;
    type: string;
    severity: number;
    description: string;
  }> {
    const record = this.getTrustRecord(venueId);
    return [...record.incidents];
  }
  
  /**
   * Get venue success rate
   * @param venueId Venue identifier
   * @returns Success rate between 0 and 1
   */
  getVenueSuccessRate(venueId: string): number {
    const record = this.getTrustRecord(venueId);
    const total = record.executionCount + record.failureCount;
    
    if (total === 0) return 0;
    return record.executionCount / total;
  }
  
  /**
   * Get trust record for a venue, creating it if it doesn't exist
   * @param venueId Venue identifier
   * @returns Trust record
   */
  private getTrustRecord(venueId: string): TrustRecord {
    if (!this.trustScores.has(venueId)) {
      this.trustScores.set(venueId, this.createDefaultTrustRecord());
    }
    
    return this.trustScores.get(venueId)!;
  }
  
  /**
   * Create a default trust record
   * @returns New trust record with default values
   */
  private createDefaultTrustRecord(): TrustRecord {
    return {
      score: this.config.defaultTrustScore,
      executionCount: 0,
      failureCount: 0,
      avgSlippageBps: 0,
      avgLatencyMs: 0,
      updatedAt: Date.now(),
      reliabilityFactor: 1.0
    };
  }
  
  /**
   * Save trust scores to storage (placeholder for persistence)
   */
  private persistTrustScores(): void {
    // This would typically save to a database or file
    // For now, just log that we would persist
    console.log('Would persist trust scores:', 
      JSON.stringify(Object.fromEntries(
        Array.from(this.trustScores.entries())
          .map(([key, value]) => [key, value.score])
      ))
    );
  }
  
  /**
   * Load trust scores from storage (placeholder for persistence)
   */
  private loadTrustScores(): void {
    // This would typically load from a database or file
    // For now, just a placeholder
    console.log('Would load trust scores from storage');
  }
} 