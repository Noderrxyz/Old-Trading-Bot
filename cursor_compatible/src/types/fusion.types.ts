/**
 * Types for the Agent Fusion Layer
 * 
 * This provides a shared context layer between strategy and execution agents
 * to ensure bidirectional coherence and feedback.
 */

/**
 * Fusion state for a specific asset
 */
export interface FusionState {
  /**
   * Strategic intent from alpha generation
   */
  strategyIntent: {
    // Long or short directional bias
    direction: 'long' | 'short' | 'neutral';
    
    // Confidence level of the signal (0-1)
    confidence: number;
    
    // Expected trading horizon
    horizon: 'scalp' | 'swing' | 'macro';
    
    // Execution urgency level
    urgency: 'low' | 'medium' | 'high';
    
    // Timestamp when this intent was established
    timestamp: number;
    
    // Optional strategy-specific metadata
    metadata?: Record<string, any>;
  };
  
  /**
   * Execution feedback for strategy adaptation
   */
  executionFeedback?: {
    // Last venue used for execution
    lastVenueUsed: string;
    
    // Slippage experienced in basis points
    slippage: number;
    
    // Fill rate (0-1, where 1 means fully filled)
    fillRate: number;
    
    // Risk of adverse selection (0-1)
    adverseSelectionRisk: number;
    
    // Execution latency in milliseconds
    latencyMs: number;
    
    // Execution timestamp
    timestamp: number;
    
    // Optional execution-specific metadata
    metadata?: Record<string, any>;
  };
  
  /**
   * Historical metrics for learning and adaptation
   */
  history?: {
    // Average slippage over last N executions
    averageSlippage: number;
    
    // Fill rate success over last N executions
    averageFillRate: number;
    
    // Strategy P&L metrics
    pnl: {
      // Realized P&L
      realized: number;
      
      // Unrealized P&L
      unrealized: number;
      
      // Currency for P&L values
      currency: string;
    };
    
    // Number of executions tracked
    executionCount: number;
  };
  
  /**
   * Learning parameters for strategy adaptation
   */
  learning?: {
    // Learning rate for strategy adaptation
    learningRate: number;
    
    // Exploration vs exploitation balance (0-1)
    explorationRate: number;
    
    // Feature importance weights
    featureWeights: Record<string, number>;
  };
} 