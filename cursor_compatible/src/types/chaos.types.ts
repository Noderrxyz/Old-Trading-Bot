/**
 * Chaos Regression Simulation Types
 * 
 * Type definitions for the agent stress testing framework that simulates
 * high-pressure market conditions and adversarial scenarios.
 */

/**
 * Parameters for configuring a chaos simulation round
 */
export interface ChaosParams {
  // Intensity of market price movements (0-100)
  marketVolatility: number;
  
  // Probability of corrupted data (0-1)
  corruptionRate: number;
  
  // Maximum simulated signal latency in milliseconds
  maxLatencyMs: number;
  
  // Whether to force trust score degradation
  forceTrustLoss: boolean;
  
  // Probability of conflicting signals between agents (0-1)
  conflictRate: number;
  
  // Intensity of API failures to simulate (0-1)
  apiFailureRate: number;
  
  // Probability of extreme outlier events (0-1)
  blackSwanProbability: number;
  
  // Maximum duration of a single round in milliseconds
  roundDurationMs: number;
}

/**
 * Simulated market shock for chaos testing
 */
export interface MarketShock {
  // Direction of price movement
  direction: 'up' | 'down';
  
  // Size of the price movement as a percentage
  magnitude: string;
  
  // Duration of the shock in milliseconds
  durationMs: number;
}

/**
 * Conflicting signal from different sources
 */
export interface SignalConflict {
  // Source of the signal
  source: string;
  
  // Confidence score (0-100)
  score: number;
}

/**
 * Stimuli applied to agents during chaos testing
 */
export interface AgentStimuli {
  // Simulated market shock
  marketShock: MarketShock;
  
  // Artificially generated conflicting signals
  conflictingSignals: SignalConflict[];
  
  // Whether inputs are corrupted in this round
  corruptedInputs: boolean;
  
  // Simulated latency for signal processing in milliseconds
  signalLatency: number;
  
  // Forced trust score adjustment
  trustDrop: number;
}

/**
 * Agent state during/after chaos simulation
 */
export interface ChaosAgentState {
  // Agent identifier
  id: string;
  
  // Current trust score (0-100)
  score: number;
  
  // Whether the agent is quarantined
  quarantined: boolean;
  
  // Agent's current health mode
  healthMode: string;
  
  // Time when agent entered current state
  enteredStateAt?: number;
  
  // Performance metrics during chaos
  metrics?: {
    responseTimeMs: number;
    errorRate: number;
    adaptationScore: number;
  };
}

/**
 * Report generated after a chaos simulation round
 */
export interface ChaosReport {
  // Timestamp when report was generated
  timestamp: number;
  
  // Agents with trust scores below 50
  degraded: ChaosAgentState[];
  
  // Agents that were quarantined
  quarantined: ChaosAgentState[];
  
  // Agents with trust scores above 80
  survivors: ChaosAgentState[];
  
  // Agents that improved during chaos
  adapted?: ChaosAgentState[];
  
  // Overall system stability metric (0-100)
  systemStability?: number;
  
  // Time taken for the simulation round
  roundDurationMs?: number;
}

/**
 * Event types emitted during chaos simulation
 */
export type ChaosEventType = 
  | 'round:start'
  | 'round:end'
  | 'agent:stimulated'
  | 'agent:responded'
  | 'trust:degraded'
  | 'trust:improved'
  | 'agent:quarantined'
  | 'agent:released'; 