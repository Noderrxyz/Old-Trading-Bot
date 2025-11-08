// Type definitions for @noderr/core
// Rust-powered high-performance trading components

export interface OrderParams {
  symbol: string;
  side: string;
  amount: number;
  price: number;
  venues: string[];
  id: string;
  max_slippage?: number;
  max_retries?: number;
  additional_params: Record<string, any>;
}

export class NapiSmartOrderRouter {
  constructor();
  static withTrustScores(trustScores: Record<string, number>): NapiSmartOrderRouter;
  execute_order(params: OrderParams): Promise<any>;
  get_venue_trust_score(venue: string): Promise<number>;
  set_venue_trust_score(venue: string, score: number): Promise<void>;
}

export interface RiskConfigParams {
  max_position_size_pct: number;
  max_leverage: number;
  max_drawdown_pct: number;
  min_trust_score: number;
  max_exposure_per_symbol: number;
  max_exposure_per_venue: number;
  exempt_strategies: string[];
  fast_risk_mode: boolean;
}

export interface PositionExposureParams {
  symbol: string;
  venue: string;
  size: number;
  value: number;
  leverage: number;
  trust_score: number;
  direction: string;
}

export class NapiRiskCalculator {
  constructor(config: RiskConfigParams, portfolioValue: number);
  validate_position(params: PositionExposureParams): Promise<boolean>;
  fast_risk_check(params: PositionExposureParams, strategyId?: string): Promise<any>;
  update_portfolio_value(value: number): Promise<void>;
  get_symbol_exposure(symbol: string): Promise<number>;
  set_trust_score(venue: string, score: number): Promise<void>;
}

export interface TradeSizerConfigParams {
  base_size: number;
  max_volatility_threshold: number;
  volatility_window_size: number;
  min_size_factor: number;
  max_size_factor: number;
  enable_logging: boolean;
  symbol_scale_factors: Record<string, number>;
}

export class NapiDynamicTradeSizer {
  constructor();
  static with_config(config: TradeSizerConfigParams): NapiDynamicTradeSizer;
  calculate_position_size(symbol: string, baseSize: number): Promise<number>;
  update_volatility(symbol: string, price: number): Promise<number>;
  get_volatility(symbol: string): Promise<number>;
  clear_symbol_data(symbol: string): Promise<void>;
  get_tracked_symbols(): Promise<string[]>;
}

export interface DrawdownConfigParams {
  max_drawdown_pct: number;
  alert_threshold_pct: number;
  rolling_window_size: number;
  min_trades_for_drawdown: number;
  cooldown_period_ms: number;
}

export interface TradeDataPointParams {
  agent_id: string;
  symbol: string;
  amount: number;
  price: number;
  trade_type: string;
  equity: number;
  trade_id: string;
  pnl: number;
}

export class NapiDrawdownMonitor {
  static create(
    config: DrawdownConfigParams, 
    killSwitchCallback: (agentId: string, reason: string, message: string) => boolean
  ): NapiDrawdownMonitor;
  record_trade(params: TradeDataPointParams): Promise<void>;
  get_current_drawdown(agentId: string): Promise<number>;
  is_agent_active(agentId: string): Promise<boolean>;
  reset_agent(agentId: string): Promise<void>;
  get_all_states(): Promise<Record<string, any>>;
}

// Execution Strategy Router bindings
export enum ExecutionAlgorithm {
  TWAP = 'TWAP',
  VWAP = 'VWAP',
  ImplementationShortfall = 'ImplementationShortfall',
  Iceberg = 'Iceberg',
  Pegged = 'Pegged',
  DMA = 'DMA',
  SmartOrderRouting = 'SmartOrderRouting'
}

export interface TWAPConfigParams {
  slices: number;
  interval_ms: number;
  max_interval_deviation_ms: number;
  min_execution_pct: number;
  randomize_sizes: boolean;
  size_deviation_pct: number;
}

export interface VWAPConfigParams {
  start_time_offset_ms: number;
  end_time_offset_ms: number;
  max_participation_rate: number;
  min_execution_pct: number;
  use_historical_profile: boolean;
  volume_profile?: number[];
}

export interface ExecutionStrategyConfigParams {
  default_strategy: ExecutionAlgorithm;
  min_order_size_for_twap: number;
  min_order_size_for_vwap: number;
  twap_config?: TWAPConfigParams;
  vwap_config?: VWAPConfigParams;
  max_execution_time_ms: number;
  symbol_strategy_map: Record<string, ExecutionAlgorithm>;
}

export class NapiExecutionStrategyRouter {
  constructor(config: ExecutionStrategyConfigParams);
  execute_order(order: OrderParams, callback: (result: any) => void): Promise<void>;
  estimate_impact(order: OrderParams): Promise<number>;
  get_cost_estimate(order: OrderParams): Promise<number>;
  cancel_execution(orderId: string): Promise<void>;
  update_config(config: ExecutionStrategyConfigParams): Promise<void>;
}

// Venue Latency Tracker bindings
export interface VenueLatencyStatsParams {
  avg_ns: number;
  p50_ns: number;
  p90_ns: number;
  p95_ns: number;
  p99_ns: number;
  min_ns: number;
  max_ns: number;
  recent_avg_ns: number;
  sample_count: number;
}

export class NapiVenueLatencyTracker {
  constructor();
  record_latency(venue: string, duration_ns: number): void;
  get_latency_stats(venue: string): VenueLatencyStatsParams | null;
  get_avg_latency(venue: string): number | null;
  get_p99_latency(venue: string): number | null;
  get_recent_avg_latency(venue: string): number | null;
  reset(venue: string): void;
  reset_all(): void;
  get_tracked_venues(): string[];
}

// SharedMemoryManager declarations

export interface BufferConfigParams {
  capacity: number;
  buffer_type: string;
  allow_overwrites: boolean;
  auto_compact: boolean;
}

export class NapiSharedMemoryManager {
  constructor();
  create_market_data_buffer(name: string, config: BufferConfigParams): boolean;
  push_market_data(buffer_name: string, data: any): number;
  push_market_data_batch(buffer_name: string, data_batch: any[]): number[];
  get_recent_market_data(buffer_name: string, limit: number): any[];
  get_market_data_after_sequence(buffer_name: string, sequence: number): any[];
  get_market_data_after_timestamp(buffer_name: string, timestamp: number): any[];
  clear_buffer(buffer_name: string): boolean;
  list_buffers(): string[];
  remove_buffer(buffer_name: string): boolean;
}

// BatchProcessor declarations

export class NapiBatchProcessor {
  static create(processor_callback: Function, max_batch_size?: number): NapiBatchProcessor;
  add_item(item: any): boolean;
  process_batch(): any;
  pending_count(): number;
  clear_pending(): void;
}

// OrderBook definitions
export enum NapiOrderSide {
  Bid = 0,
  Ask = 1
}

export enum NapiUpdateType {
  New = 0,
  Update = 1,
  Delete = 2
}

export interface NapiPriceLevel {
  price: number;
  size: number;
  order_count: number;
  timestamp: number;
}

export class NapiOrderBookManager {
  constructor();
  process_update(symbol: string, price: number, size: number, side: NapiOrderSide, update_id: number): NapiUpdateType;
  process_updates(symbol: string, updates: Array<[number, number, number, number]>): NapiUpdateType[];
  get_snapshot(symbol: string, depth: number): Promise<[NapiPriceLevel[], NapiPriceLevel[]] | null>;
  get_mid_price(symbol: string): number | null;
  calculate_imbalance(symbol: string, depth: number): number | null;
  get_vwap(symbol: string, size: number, side: NapiOrderSide): number | null;
  list_symbols(): string[];
  remove_order_book(symbol: string): boolean;
} 