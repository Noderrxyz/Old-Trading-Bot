import { 
  NapiStrategyEngine, 
  StrategyEngineConfigParams, 
  SignalEvaluationParams, 
  SignalMetricsParams 
} from '../../noderr_core';
import { SmartOrderRouterRust } from './SmartOrderRouterRust';
import { RiskCalculatorRust } from '../risk/RiskCalculatorRust';
import { logger } from '../utils/logger';
import { tryNativeOrFallback } from '../utils/fallback';
import { StrategyEngineJs } from './StrategyEngineJs';
import { ExecutionResult } from '../types/execution';
import { Signal, SignalAction } from '../types/strategy';
import { PositionDirection } from '../types/risk';

/**
 * Execution risk grade
 */
export enum RiskGrade {
  Low = 0,
  Medium = 1,
  High = 2,
  Exceptional = 3
}

/**
 * Execution horizon
 */
export enum ExecutionHorizon {
  Immediate = 0,
  ShortTerm = 1,
  MediumTerm = 2,
  LongTerm = 3
}

/**
 * Signal status
 */
export enum SignalStatus {
  Created = 0,
  Validated = 1,
  Rejected = 2,
  Executed = 3,
  Failed = 4,
  InProgress = 5,
  Expired = 6,
  ReadyForExecution = 7,
  TrustBlocked = 8,
  AwaitingMarketConditions = 9
}

/**
 * Configuration for the strategy engine
 */
export interface StrategyEngineConfig {
  /** Whether to execute signals in dryrun mode (no real orders) */
  dryrunMode: boolean;
  
  /** Whether to apply risk checks */
  applyRiskChecks: boolean;
  
  /** Minimum trust score required for automatic execution (0.0-1.0) */
  minTrustScore: number;
  
  /** Default execution horizon if not specified */
  defaultExecutionHorizon: ExecutionHorizon;
  
  /** Default risk grade if not specified */
  defaultRiskGrade: RiskGrade;
  
  /** Whether to apply confidence-based position sizing */
  confidenceBasedSizing: boolean;
  
  /** Whether to require signals to have explicit price */
  requirePrice: boolean;
  
  /** Maximum allowed slippage percentage */
  maxSlippagePct: number;
  
  /** Engine mode (0 = sync, 1 = async) */
  engineMode: number;
  
  /** Whether to enforce latency budgets */
  enforceLatencyBudgets: boolean;
}

/**
 * Default configuration for the strategy engine
 */
export const DEFAULT_STRATEGY_ENGINE_CONFIG: StrategyEngineConfig = {
  dryrunMode: false,
  applyRiskChecks: true,
  minTrustScore: 0.65,
  defaultExecutionHorizon: ExecutionHorizon.ShortTerm,
  defaultRiskGrade: RiskGrade.Medium,
  confidenceBasedSizing: true,
  requirePrice: false,
  maxSlippagePct: 0.5,
  engineMode: 1, // Async
  enforceLatencyBudgets: true
};

/**
 * Signal evaluation result
 */
export interface SignalEvaluation {
  /** Signal ID */
  signalId: string;
  
  /** Whether the signal passed evaluation */
  passed: boolean;
  
  /** Execution probability (0.0-1.0) */
  executionProbability: number;
  
  /** Expected impact score (0.0-1.0, higher means more impact) */
  expectedImpact: number;
  
  /** Expected slippage percentage */
  expectedSlippagePct: number;
  
  /** Trust score (0.0-1.0) */
  trustScore: number;
  
  /** Whether the signal is latency critical */
  isLatencyCritical: boolean;
  
  /** Recommended position size as percentage of available capital */
  recommendedPositionSizePct: number;
  
  /** Latency budget in milliseconds */
  latencyBudgetMs: number;
  
  /** Timestamp of evaluation */
  timestamp: Date;
  
  /** Any risk violations detected */
  riskViolations: any[];
}

/**
 * Signal metrics for performance analysis
 */
export interface SignalMetrics {
  /** Signal ID */
  signalId: string;
  
  /** Strategy ID */
  strategyId: string;
  
  /** Symbol */
  symbol: string;
  
  /** Signal generation time */
  generationTime: Date;
  
  /** Signal execution time (if executed) */
  executionTime?: Date;
  
  /** Latency from generation to execution in milliseconds */
  executionLatencyMs?: number;
  
  /** Signal confidence */
  confidence: number;
  
  /** Signal strength */
  strength: number;
  
  /** Execution success (true if successfully executed) */
  success: boolean;
  
  /** Order price */
  price?: number;
  
  /** Actual execution price (if executed) */
  executionPrice?: number;
  
  /** Slippage percentage (positive means worse than expected) */
  slippagePct?: number;
  
  /** Position direction */
  direction: PositionDirection;
  
  /** Position size */
  positionSize?: number;
  
  /** Trust score */
  trustScore?: number;
  
  /** Execution status */
  status: SignalStatus;
  
  /** Risk grade */
  riskGrade: RiskGrade;
  
  /** Execution horizon */
  executionHorizon: ExecutionHorizon;
  
  /** PnL if known */
  pnl?: number;
  
  /** Additional metrics */
  additionalMetrics: Record<string, number>;
}

/**
 * StrategyEngine class - singleton wrapper for the Rust StrategyEngine
 * with JavaScript fallback support
 */
export class StrategyEngineRust {
  private static instance: StrategyEngineRust | null = null;
  private nativeEngine: NapiStrategyEngine | null = null;
  private fallbackEngine: StrategyEngineJs | null = null;
  private config: StrategyEngineConfig;
  
  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor(config: Partial<StrategyEngineConfig> = {}) {
    this.config = { ...DEFAULT_STRATEGY_ENGINE_CONFIG, ...config };
    
    try {
      // Get instances of dependencies
      const router = SmartOrderRouterRust.getInstance();
      const riskCalculator = RiskCalculatorRust.getInstance();
      
      // Create the native engine
      this.nativeEngine = new NapiStrategyEngine(
        router.getNativeRouter(),
        riskCalculator.getNativeCalculator(),
        this.convertConfigToNative(this.config)
      );
      
      logger.info('StrategyEngineRust initialized successfully');
    } catch (error) {
      logger.warn('Failed to initialize Rust StrategyEngine, falling back to JS implementation:', error);
      this.nativeEngine = null;
    }
    
    // Always create the fallback engine for resilience
    try {
      this.fallbackEngine = new StrategyEngineJs(this.config);
    } catch (error) {
      logger.error('Failed to initialize fallback StrategyEngineJs:', error);
      this.fallbackEngine = null;
    }
    
    // If both engines failed, throw error
    if (!this.nativeEngine && !this.fallbackEngine) {
      throw new Error('Failed to initialize both native and fallback StrategyEngine');
    }
  }
  
  /**
   * Get the singleton instance
   */
  public static getInstance(config?: Partial<StrategyEngineConfig>): StrategyEngineRust {
    if (!StrategyEngineRust.instance) {
      StrategyEngineRust.instance = new StrategyEngineRust(config);
    } else if (config) {
      // Update config if provided
      StrategyEngineRust.instance.updateConfig(config);
    }
    return StrategyEngineRust.instance;
  }
  
  /**
   * Reset the singleton instance
   */
  public static resetInstance(): void {
    StrategyEngineRust.instance = null;
  }
  
  /**
   * Execute a strategy based on a signal
   * @param signal The signal to execute
   * @returns Execution result
   */
  public async executeStrategy(signal: Signal): Promise<ExecutionResult> {
    return tryNativeOrFallback({
      name: 'executeStrategy',
      native: async () => {
        if (!this.nativeEngine) throw new Error('Native engine not available');
        
        // Convert the signal to parameters for the native engine
        const actionValue = this.getActionValue(signal.action);
        const directionValue = this.getDirectionValue(signal.direction);
        const riskGradeValue = signal.riskGrade !== undefined ? 
          this.getRiskGradeValue(signal.riskGrade) : undefined;
        const executionHorizonValue = signal.executionHorizon !== undefined ? 
          this.getExecutionHorizonValue(signal.executionHorizon) : undefined;
        
        // Convert metadata to JSON if present
        const metadataJson = signal.metadata ? 
          JSON.stringify(signal.metadata) : undefined;
        
        // Convert timestamp to milliseconds
        const timestampMs = signal.timestamp.getTime();
        
        // Convert expiration to milliseconds if present
        const expirationMs = signal.expiration ? 
          signal.expiration.getTime() : undefined;
        
        // Execute the strategy
        const resultJson = await this.nativeEngine.execute_strategy(
          signal.id,
          signal.strategyId,
          signal.symbol,
          actionValue,
          directionValue,
          signal.confidence,
          signal.strength,
          signal.price,
          signal.quantity,
          timestampMs,
          expirationMs,
          metadataJson,
          riskGradeValue,
          executionHorizonValue
        );
        
        // Parse the result
        return JSON.parse(resultJson) as ExecutionResult;
      },
      fallback: async () => {
        if (!this.fallbackEngine) throw new Error('Fallback engine not available');
        return this.fallbackEngine.executeStrategy(signal);
      },
      context: {
        signalId: signal.id,
        strategyId: signal.strategyId,
        symbol: signal.symbol
      }
    });
  }
  
  /**
   * Evaluate a signal
   * @param signal The signal to evaluate
   * @returns Signal evaluation
   */
  public async evaluateSignal(signal: Signal): Promise<SignalEvaluation> {
    return tryNativeOrFallback({
      name: 'evaluateSignal',
      native: async () => {
        if (!this.nativeEngine) throw new Error('Native engine not available');
        
        // Convert the signal to parameters for the native engine
        const actionValue = this.getActionValue(signal.action);
        const directionValue = this.getDirectionValue(signal.direction);
        const riskGradeValue = signal.riskGrade !== undefined ? 
          this.getRiskGradeValue(signal.riskGrade) : undefined;
        const executionHorizonValue = signal.executionHorizon !== undefined ? 
          this.getExecutionHorizonValue(signal.executionHorizon) : undefined;
        
        // Convert timestamp to milliseconds
        const timestampMs = signal.timestamp.getTime();
        
        // Evaluate the signal
        const params = await this.nativeEngine.evaluate_signal(
          signal.id,
          signal.strategyId,
          signal.symbol,
          actionValue,
          directionValue,
          signal.confidence,
          signal.strength,
          signal.price,
          timestampMs,
          riskGradeValue,
          executionHorizonValue
        );
        
        // Convert from native params to SignalEvaluation
        return this.convertFromNativeEvaluation(params);
      },
      fallback: async () => {
        if (!this.fallbackEngine) throw new Error('Fallback engine not available');
        return this.fallbackEngine.evaluateSignal(signal);
      },
      context: {
        signalId: signal.id,
        strategyId: signal.strategyId,
        symbol: signal.symbol
      }
    });
  }
  
  /**
   * Calculate signal metrics
   * @param signal The signal to calculate metrics for
   * @param executionResult Optional execution result
   * @returns Signal metrics
   */
  public calculateSignalMetrics(signal: Signal, executionResult?: ExecutionResult): SignalMetrics {
    return tryNativeOrFallback({
      name: 'calculateSignalMetrics',
      native: () => {
        if (!this.nativeEngine) throw new Error('Native engine not available');
        
        // Convert the signal to parameters for the native engine
        const actionValue = this.getActionValue(signal.action);
        const directionValue = this.getDirectionValue(signal.direction);
        
        // Convert timestamp to milliseconds
        const timestampMs = signal.timestamp.getTime();
        
        // Convert execution result to JSON if present
        const executionResultJson = executionResult ? 
          JSON.stringify(executionResult) : undefined;
        
        // Calculate metrics
        const params = this.nativeEngine.calculate_signal_metrics(
          signal.id,
          signal.strategyId,
          signal.symbol,
          actionValue,
          directionValue,
          signal.confidence,
          signal.strength,
          signal.price,
          timestampMs,
          executionResultJson
        );
        
        // Convert from native params to SignalMetrics
        return this.convertFromNativeMetrics(params);
      },
      fallback: () => {
        if (!this.fallbackEngine) throw new Error('Fallback engine not available');
        return this.fallbackEngine.calculateSignalMetrics(signal, executionResult);
      },
      context: {
        signalId: signal.id,
        strategyId: signal.strategyId,
        symbol: signal.symbol
      },
      syncFallback: true
    });
  }
  
  /**
   * Get stored metrics for a signal
   * @param signalId The signal ID
   * @returns Signal metrics or undefined if not found
   */
  public getSignalMetrics(signalId: string): SignalMetrics | undefined {
    return tryNativeOrFallback({
      name: 'getSignalMetrics',
      native: () => {
        if (!this.nativeEngine) throw new Error('Native engine not available');
        
        // Get metrics
        const params = this.nativeEngine.get_signal_metrics(signalId);
        
        // Convert from native params to SignalMetrics if found
        return params ? this.convertFromNativeMetrics(params) : undefined;
      },
      fallback: () => {
        if (!this.fallbackEngine) throw new Error('Fallback engine not available');
        return this.fallbackEngine.getSignalMetrics(signalId);
      },
      context: { signalId },
      syncFallback: true
    });
  }
  
  /**
   * Update configuration
   * @param config The configuration to update
   */
  public updateConfig(config: Partial<StrategyEngineConfig>): void {
    // Update local config
    this.config = { ...this.config, ...config };
    
    // Update native engine if available
    if (this.nativeEngine) {
      try {
        this.nativeEngine.update_config(this.convertConfigToNative(this.config));
      } catch (error) {
        logger.warn('Failed to update native engine config:', error);
      }
    }
    
    // Update fallback engine if available
    if (this.fallbackEngine) {
      try {
        this.fallbackEngine.updateConfig(this.config);
      } catch (error) {
        logger.warn('Failed to update fallback engine config:', error);
      }
    }
  }
  
  /**
   * Get current configuration
   * @returns The current configuration
   */
  public getConfig(): StrategyEngineConfig {
    if (this.nativeEngine) {
      try {
        // Get config from native engine
        const nativeConfig = this.nativeEngine.get_config();
        return this.convertFromNativeConfig(nativeConfig);
      } catch (error) {
        logger.warn('Failed to get native engine config:', error);
      }
    }
    
    // Return local config if native engine is not available or failed
    return { ...this.config };
  }
  
  /**
   * Convert to native configuration
   * @param config The configuration to convert
   * @returns Native configuration parameters
   */
  private convertConfigToNative(config: StrategyEngineConfig): StrategyEngineConfigParams {
    return {
      dryrun_mode: config.dryrunMode,
      apply_risk_checks: config.applyRiskChecks,
      min_trust_score: config.minTrustScore,
      default_execution_horizon: config.defaultExecutionHorizon,
      default_risk_grade: config.defaultRiskGrade,
      confidence_based_sizing: config.confidenceBasedSizing,
      require_price: config.requirePrice,
      max_slippage_pct: config.maxSlippagePct,
      engine_mode: config.engineMode,
      enforce_latency_budgets: config.enforceLatencyBudgets
    };
  }
  
  /**
   * Convert from native configuration
   * @param nativeConfig The native configuration parameters
   * @returns Configuration
   */
  private convertFromNativeConfig(nativeConfig: StrategyEngineConfigParams): StrategyEngineConfig {
    return {
      dryrunMode: nativeConfig.dryrun_mode,
      applyRiskChecks: nativeConfig.apply_risk_checks,
      minTrustScore: nativeConfig.min_trust_score,
      defaultExecutionHorizon: nativeConfig.default_execution_horizon as ExecutionHorizon,
      defaultRiskGrade: nativeConfig.default_risk_grade as RiskGrade,
      confidenceBasedSizing: nativeConfig.confidence_based_sizing,
      requirePrice: nativeConfig.require_price,
      maxSlippagePct: nativeConfig.max_slippage_pct,
      engineMode: nativeConfig.engine_mode,
      enforceLatencyBudgets: nativeConfig.enforce_latency_budgets
    };
  }
  
  /**
   * Convert from native evaluation parameters
   * @param params The native evaluation parameters
   * @returns Signal evaluation
   */
  private convertFromNativeEvaluation(params: SignalEvaluationParams): SignalEvaluation {
    // Parse risk violations
    const riskViolations = JSON.parse(params.risk_violations) as any[];
    
    return {
      signalId: params.signal_id,
      passed: params.passed,
      executionProbability: params.execution_probability,
      expectedImpact: params.expected_impact,
      expectedSlippagePct: params.expected_slippage_pct,
      trustScore: params.trust_score,
      isLatencyCritical: params.is_latency_critical,
      recommendedPositionSizePct: params.recommended_position_size_pct,
      latencyBudgetMs: params.latency_budget_ms,
      timestamp: new Date(params.timestamp),
      riskViolations
    };
  }
  
  /**
   * Convert from native metrics parameters
   * @param params The native metrics parameters
   * @returns Signal metrics
   */
  private convertFromNativeMetrics(params: SignalMetricsParams): SignalMetrics {
    // Parse additional metrics
    const additionalMetrics = JSON.parse(params.additional_metrics) as Record<string, number>;
    
    return {
      signalId: params.signal_id,
      strategyId: params.strategy_id,
      symbol: params.symbol,
      generationTime: new Date(params.generation_time),
      executionTime: params.execution_time ? new Date(params.execution_time) : undefined,
      executionLatencyMs: params.execution_latency_ms,
      confidence: params.confidence,
      strength: params.strength,
      success: params.success,
      price: params.price,
      executionPrice: params.execution_price,
      slippagePct: params.slippage_pct,
      direction: this.getDirectionFromValue(params.direction),
      positionSize: params.position_size,
      trustScore: params.trust_score,
      status: params.status as SignalStatus,
      riskGrade: params.risk_grade as RiskGrade,
      executionHorizon: params.execution_horizon as ExecutionHorizon,
      pnl: params.pnl,
      additionalMetrics
    };
  }
  
  /**
   * Get action value for native code
   * @param action The signal action
   * @returns Action value
   */
  private getActionValue(action: SignalAction): number {
    switch (action) {
      case SignalAction.Enter:
        return 0;
      case SignalAction.Exit:
        return 1;
      case SignalAction.Hold:
        return 2;
      default:
        return 0;
    }
  }
  
  /**
   * Get direction value for native code
   * @param direction The position direction
   * @returns Direction value
   */
  private getDirectionValue(direction: PositionDirection): number {
    switch (direction) {
      case PositionDirection.None:
        return 0;
      case PositionDirection.Long:
        return 1;
      case PositionDirection.Short:
        return 2;
      default:
        return 0;
    }
  }
  
  /**
   * Get direction from value
   * @param value The direction value
   * @returns Position direction
   */
  private getDirectionFromValue(value: number): PositionDirection {
    switch (value) {
      case 0:
        return PositionDirection.None;
      case 1:
        return PositionDirection.Long;
      case 2:
        return PositionDirection.Short;
      default:
        return PositionDirection.None;
    }
  }
  
  /**
   * Get risk grade value for native code
   * @param riskGrade The risk grade
   * @returns Risk grade value
   */
  private getRiskGradeValue(riskGrade: RiskGrade): number {
    return riskGrade;
  }
  
  /**
   * Get execution horizon value for native code
   * @param executionHorizon The execution horizon
   * @returns Execution horizon value
   */
  private getExecutionHorizonValue(executionHorizon: ExecutionHorizon): number {
    return executionHorizon;
  }
} 