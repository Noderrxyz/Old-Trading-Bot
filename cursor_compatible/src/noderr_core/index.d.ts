export class NapiStrategyEngine {
  constructor();
  
  executeStrategy(
    signal_id: string,
    strategy_id: string,
    symbol: string,
    action: number,
    direction: number,
    price?: number,
    confidence: number,
    strength: number,
    timestamp: number,
    expiration?: number,
    risk_grade?: number,
    execution_horizon?: number,
    trust_vector?: string
  ): Promise<{
    id: string;
    signal_id: string;
    status: number;
    timestamp: number;
    execution_time_ms: number;
    average_price?: number;
    executed_quantity?: number;
    realized_pnl: number;
    error_message?: string;
  }>;
  
  evaluateSignal(
    signal_id: string,
    strategy_id: string,
    symbol: string,
    action: number,
    direction: number,
    price?: number,
    confidence: number,
    strength: number,
    timestamp: number,
    expiration?: number,
    risk_grade?: number,
    execution_horizon?: number,
    trust_vector?: string
  ): Promise<{
    signal_id: string;
    passed: boolean;
    execution_probability: number;
    expected_impact: number;
    expected_slippage_pct: number;
    trust_score: number;
    risk_violations: string;
    is_latency_critical: boolean;
    recommended_position_size_pct: number;
    latency_budget_ms: number;
    timestamp: number;
  }>;
  
  calculateSignalMetrics(
    signal_id: string,
    strategy_id: string,
    symbol: string,
    action: number,
    direction: number,
    price?: number,
    confidence: number,
    strength: number,
    timestamp: number,
    expiration?: number,
    risk_grade?: number,
    execution_horizon?: number,
    trust_vector?: string,
    execution_id?: string,
    execution_status?: number,
    execution_timestamp?: number,
    execution_time_ms?: number,
    execution_price?: number,
    executed_quantity?: number,
    realized_pnl?: number
  ): {
    signal_id: string;
    strategy_id: string;
    symbol: string;
    generation_time: number;
    execution_time?: number;
    execution_latency_ms?: number;
    confidence: number;
    strength: number;
    success: boolean;
    price?: number;
    execution_price?: number;
    slippage_pct?: number;
    direction: number;
    position_size?: number;
    trust_score?: number;
    status: number;
    risk_grade: number;
    execution_horizon: number;
    pnl?: number;
    additional_metrics: string;
  };
  
  updateConfig(
    dryrun_mode?: boolean,
    apply_risk_checks?: boolean,
    min_trust_score?: number,
    max_slippage_pct?: number,
    engine_mode?: number,
    confidence_based_sizing?: boolean,
    require_price?: boolean,
    default_execution_horizon?: number
  ): void;
  
  getConfig(): {
    dryrun_mode: boolean;
    apply_risk_checks: boolean;
    min_trust_score: number;
    max_slippage_pct: number;
    engine_mode: number;
    confidence_based_sizing: boolean;
    require_price: boolean;
    default_execution_horizon: number;
  };
} 