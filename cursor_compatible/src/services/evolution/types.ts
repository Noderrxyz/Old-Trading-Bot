/**
 * Evolution Graph Engine Types
 * 
 * Type definitions for the Evolution Graph Engine.
 */

/**
 * Types of strategy mutations that can occur
 */
export enum MutationType {
  /** First version of a strategy */
  GENESIS = 'genesis',
  
  /** Minor parameter adjustments */
  PARAMETER_TUNING = 'parameter_tuning',
  
  /** Major structural changes */
  STRUCTURAL = 'structural',
  
  /** Merging techniques from multiple strategies */
  HYBRID = 'hybrid',
  
  /** Adapting to specific market conditions */
  SPECIALIZATION = 'specialization',
  
  /** Complete redesign */
  REWRITE = 'rewrite',
  
  /** Reversion to previous version */
  ROLLBACK = 'rollback'
}

/**
 * Performance metrics for a strategy
 */
export interface PerformanceMetrics {
  /** Sharpe ratio (risk-adjusted return) */
  sharpe?: number;
  
  /** Win rate (percentage) */
  winRate?: number;
  
  /** Return on investment (percentage) */
  roi?: number;
  
  /** Maximum drawdown (percentage) */
  maxDrawdown?: number;
  
  /** Profit factor (gross profit / gross loss) */
  profitFactor?: number;
  
  /** Total number of trades */
  tradeCount?: number;
  
  /** Average trade duration in minutes */
  avgTradeDuration?: number;
  
  /** Any other custom metrics specific to the strategy */
  [key: string]: number | undefined;
}

/**
 * Strategy evolution record representing a node in the evolution graph
 */
export interface EvolutionRecord {
  /** Unique identifier for the evolution record */
  id: string;
  
  /** Agent ID that owns the strategy */
  agentId: string;
  
  /** Strategy ID for this particular version */
  strategyId: string;
  
  /** Parent strategy ID (undefined for genesis strategies) */
  parentStrategyId?: string;
  
  /** Type of mutation that created this strategy version */
  mutationType: MutationType;
  
  /** Performance snapshot at time of mutation */
  performanceSnapshot: PerformanceMetrics;
  
  /** Timestamp when this strategy version was created */
  timestamp: number;
}

/**
 * Performance metric record for evolution tracking
 */
export interface MetricRecord {
  /** Unique identifier for the metric record */
  id: string;
  
  /** Agent ID associated with this metric */
  agentId: string;
  
  /** Strategy ID this metric relates to */
  strategyId: string;
  
  /** Type of metric being recorded */
  metricType: string;
  
  /** Current value */
  value: number;
  
  /** Previous value (if applicable) */
  prevValue?: number;
  
  /** Change from previous value (if applicable) */
  delta?: number;
  
  /** Timestamp when this metric was recorded */
  timestamp: number;
}

/**
 * Edge in the evolution graph connecting strategy versions
 */
export interface EvolutionEdge {
  /** Source strategy ID */
  source: string;
  
  /** Target strategy ID */
  target: string;
  
  /** Type of mutation that created the target strategy */
  mutationType: MutationType;
  
  /** Timestamp when the mutation occurred */
  timestamp: number;
}

/**
 * Structure representing a strategy lineage graph
 */
export interface EvolutionGraph {
  /** Agent ID this evolution graph belongs to */
  agentId: string;
  
  /** Nodes in the graph (strategy versions) */
  nodes: EvolutionRecord[];
  
  /** Edges connecting strategy versions */
  edges: EvolutionEdge[];
}

/**
 * Options for recording a new mutation
 */
export interface RecordMutationOptions {
  /** Whether to emit telemetry metrics */
  emitTelemetry?: boolean;
  
  /** Whether to publish a WebSocket event */
  publishEvent?: boolean;
} 