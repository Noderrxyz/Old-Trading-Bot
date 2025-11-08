/**
 * Type declarations for @noderr/core package
 */

declare module '@noderr/core' {
  /**
   * SharedMemoryManager native bindings
   */
  export class NapiSharedMemoryManager {
    constructor();
    create_market_data_buffer(name: string, config: any): boolean;
    push_market_data(bufferName: string, data: any): number;
    push_market_data_batch(bufferName: string, dataBatch: any[]): number[];
    get_recent_market_data(bufferName: string, limit: number): any[];
    get_market_data_after_sequence(bufferName: string, sequence: number): any[];
    get_market_data_after_timestamp(bufferName: string, timestamp: number): any[];
    clear_buffer(bufferName: string): boolean;
    list_buffers(): string[];
    remove_buffer(bufferName: string): boolean;
  }

  /**
   * BatchProcessor native bindings
   */
  export class NapiBatchProcessor {
    static create(
      processorCallback: (batch: any[]) => any,
      maxBatchSize?: number
    ): NapiBatchProcessor;
    add_item(item: any): boolean;
    process_batch(): any;
    pending_count(): number;
    clear_pending(): void;
  }

  /**
   * OrderBookManager native bindings
   */
  export class NapiOrderBookManager {
    constructor();
    process_update(symbol: string, price: number, size: number, side: number, update_id: number): number;
    process_updates(symbol: string, updates: [number, number, number, number][]): number[];
    get_snapshot(symbol: string, depth: number): [NapiPriceLevel[], NapiPriceLevel[]] | null;
    get_mid_price(symbol: string): number | null;
    calculate_imbalance(symbol: string, depth: number): number | null;
    get_vwap(symbol: string, size: number, side: number): number | null;
    list_symbols(): string[];
    remove_order_book(symbol: string): boolean;
  }

  /**
   * Order book price level
   */
  export interface NapiPriceLevel {
    price: number;
    size: number;
    order_count: number;
    timestamp: number;
  }

  /**
   * Order side enum for order book
   */
  export enum NapiOrderSide {
    Bid = 0,
    Ask = 1
  }

  /**
   * Order book update type
   */
  export enum NapiUpdateType {
    New = 0,
    Update = 1,
    Delete = 2
  }

  /**
   * StrategyEngine native bindings
   */
  export class NapiStrategyEngine {
    constructor(router: any, riskCalculator: any, config?: any);
    execute_strategy(
      signal_id: string,
      strategy_id: string,
      symbol: string,
      action: number,
      direction: number,
      confidence: number,
      strength: number,
      price: number | null,
      quantity: number | null,
      timestamp: number,
      expiration: number | null,
      metadata: string | null,
      risk_grade: number | null,
      execution_horizon: number | null
    ): Promise<string>;
    evaluate_signal(
      signal_id: string,
      strategy_id: string,
      symbol: string,
      action: number,
      direction: number,
      confidence: number,
      strength: number,
      price: number | null,
      timestamp: number,
      risk_grade: number | null,
      execution_horizon: number | null
    ): Promise<any>;
    calculate_signal_metrics(
      signal_id: string,
      strategy_id: string,
      symbol: string,
      action: number,
      direction: number,
      confidence: number,
      strength: number,
      price: number | null,
      timestamp: number,
      execution_result_json: string | null
    ): any;
    get_signal_metrics(signal_id: string): any | null;
    update_config(config: any): boolean;
    get_config(): any;
  }

  /**
   * MarketDataProcessor native bindings
   */
  export class NapiMarketDataProcessor {
    constructor(shared_memory_manager?: NapiSharedMemoryManager, config?: any);
    process_tick(tick: any): void;
    calculate_features(symbol: string): any;
    detect_anomalies(): any[];
    get_recent_anomalies(limit: number): any[];
    get_latest_features(symbol: string): any | null;
  }

  /**
   * SmartOrderRouter native bindings
   */
  export class NapiSmartOrderRouter {
    constructor();
    static with_trust_scores(trustScores: Record<string, number>): NapiSmartOrderRouter;
    execute_order(params: any): Promise<any>;
    get_venue_trust_score(venue: string): Promise<number>;
    set_venue_trust_score(venue: string, score: number): Promise<void>;
  }

  /**
   * RiskCalculator native bindings
   */
  export class NapiRiskCalculator {
    constructor(configParams: any, portfolioValue: number);
    validate_position(params: any): Promise<boolean>;
    fast_risk_check(params: any, strategyId?: string): Promise<any>;
    update_portfolio_value(value: number): Promise<void>;
    get_symbol_exposure(symbol: string): Promise<number>;
    set_trust_score(venue: string, score: number): Promise<void>;
  }

  /**
   * DynamicTradeSizer native bindings
   */
  export class NapiDynamicTradeSizer {
    constructor();
    static with_config(configParams: any): NapiDynamicTradeSizer;
    calculate_position_size(symbol: string, baseSize: number): Promise<number>;
    update_volatility(symbol: string, price: number): Promise<number>;
    get_volatility(symbol: string): Promise<number>;
    clear_symbol_data(symbol: string): Promise<void>;
    get_tracked_symbols(): Promise<string[]>;
  }

  /**
   * DrawdownMonitor native bindings
   */
  export class NapiDrawdownMonitor {
    static create(configParams: any, killSwitchCallback: any): NapiDrawdownMonitor;
    record_trade(params: any): Promise<void>;
    get_current_drawdown(agentId: string): Promise<number>;
    is_agent_active(agentId: string): Promise<boolean>;
    reset_agent(agentId: string): Promise<void>;
    get_all_states(): Promise<any>;
  }
} 