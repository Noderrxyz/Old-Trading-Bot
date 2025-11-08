/**
 * Evaluation Result Types
 * 
 * Type definitions for strategy evaluation results in the evolution system.
 */

import { MutationType } from '../types.js';

/**
 * Result of evaluating a mutated trading strategy
 */
export interface EvaluationResult {
  /** ID of the agent that owns this strategy */
  agentId: string;
  
  /** ID of the strategy being evaluated */
  strategyId: string;
  
  /** Sharpe ratio - risk-adjusted return metric */
  sharpe: number;
  
  /** Maximum drawdown percentage (0-1) */
  maxDrawdown: number;
  
  /** Win rate (percentage of winning trades) (0-1) */
  winRate: number;
  
  /** Volatility resilience score (0-1) */
  volatilityResilience: number;
  
  /** Regret index - measure of how suboptimal decisions were (0-1) */
  regretIndex: number;
  
  /** Overall fitness score calculated from combined metrics */
  fitnessScore: number;
  
  /** Whether this strategy passed evaluation thresholds */
  passed: boolean;
  
  /** Timestamp when evaluation was completed */
  timestamp: number;
  
  /** ID of the generation this strategy belongs to */
  generationId: string;
  
  /** Additional notes or explanations about the evaluation */
  notes?: string;
  
  /** Type of mutation that created this strategy */
  mutationType?: MutationType;
  
  /** Raw performance metrics from the evaluation */
  rawMetrics?: {
    /** Total return percentage */
    totalReturn: number;
    
    /** Number of trades executed */
    tradeCount: number;
    
    /** Average profit per trade */
    avgProfit: number;
    
    /** Profit factor (gross profit / gross loss) */
    profitFactor: number;
    
    /** Percentage of time in market */
    marketExposure: number;
    
    /** Recovery factor (net profit / max drawdown) */
    recoveryFactor: number;
    
    /** Additional metrics */
    [key: string]: number;
  };
}

/**
 * Status of an evaluation job
 */
export enum EvaluationStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

/**
 * Request for strategy evaluation
 */
export interface EvaluationRequest {
  /** ID of the agent that owns this strategy */
  agentId: string;
  
  /** ID of the strategy to evaluate */
  strategyId: string;
  
  /** ID of the generation this strategy belongs to */
  generationId: string;
  
  /** Type of mutation that created this strategy */
  mutationType: MutationType;
  
  /** Unique ID for this evaluation job */
  evaluationId: string;
  
  /** Timestamp when evaluation was requested */
  requestedAt: number;
  
  /** Priority of this evaluation (higher = more important) */
  priority?: number;
}

/**
 * Status update for an evaluation job
 */
export interface EvaluationStatusUpdate {
  /** ID of the evaluation job */
  evaluationId: string;
  
  /** Current status */
  status: EvaluationStatus;
  
  /** Timestamp of the update */
  timestamp: number;
  
  /** Current progress (0-1) if running */
  progress?: number;
  
  /** Error message if failed */
  error?: string;
  
  /** Evaluation result if completed */
  result?: EvaluationResult;
} 