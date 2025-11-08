import { logger } from '../utils/logger';
import { 
  ExecutionHorizon, 
  RiskGrade, 
  SignalEvaluation, 
  SignalMetrics, 
  SignalStatus, 
  StrategyEngineConfig 
} from './StrategyEngineRust';
import { ExecutionResult, ExecutionStatus } from '../types/execution';
import { Signal } from '../types/strategy';
import { SmartOrderRouterJs } from './SmartOrderRouterJs';
import { RiskCalculatorJs } from '../risk/RiskCalculatorJs';
import { v4 as uuidv4 } from 'uuid';

/**
 * JavaScript fallback implementation of StrategyEngine
 * Used when the Rust implementation is not available
 */
export class StrategyEngineJs {
  private config: StrategyEngineConfig;
  private router: SmartOrderRouterJs;
  private riskCalculator: RiskCalculatorJs;
  private metricsStore: Map<string, SignalMetrics> = new Map();
  
  /**
   * Constructor
   * @param config The configuration
   */
  constructor(config: StrategyEngineConfig) {
    this.config = { ...config };
    
    try {
      // Initialize dependencies
      this.router = SmartOrderRouterJs.getInstance();
      this.riskCalculator = RiskCalculatorJs.getInstance();
      
      logger.info('StrategyEngineJs initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize StrategyEngineJs:', error);
      throw new Error(`Failed to initialize StrategyEngineJs: ${error}`);
    }
  }
  
  /**
   * Execute a strategy based on a signal
   * @param signal The signal to execute
   * @returns Execution result
   */
  public async executeStrategy(signal: Signal): Promise<ExecutionResult> {
    logger.info(`StrategyEngineJs: Executing strategy for signal ${signal.id}`);
    
    try {
      // Check if signal has expired
      if (this.hasSignalExpired(signal)) {
        throw new Error('Signal has expired');
      }
      
      // Evaluate signal
      const evaluation = await this.evaluateSignal(signal);
      
      // Check if evaluation passed
      if (!evaluation.passed) {
        throw new Error('Signal did not pass evaluation checks');
      }
      
      // Create order from signal
      const order = this.createOrderFromSignal(signal, evaluation);
      
      // Execute order
      const executionStart = Date.now();
      const executionResult = await this.router.executeOrder(order);
      
      // Calculate latency
      const executionLatency = Date.now() - executionStart;
      
      // Update metrics
      this.updateMetricsForExecution(signal, evaluation, executionResult, executionLatency);
      
      return executionResult;
    } catch (error) {
      logger.error(`StrategyEngineJs: Failed to execute strategy for signal ${signal.id}:`, error);
      
      // Create a failed execution result
      const failedResult: ExecutionResult = {
        id: uuidv4(),
        signalId: signal.id,
        status: ExecutionStatus.Failed,
        timestamp: new Date(),
        executionTimeMs: 0,
        realizedPnl: 0,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      
      // Update metrics with failure
      this.updateMetricsForFailedExecution(signal, failedResult);
      
      return failedResult;
    }
  }
  
  /**
   * Evaluate a signal
   * @param signal The signal to evaluate
   * @returns Signal evaluation
   */
  public async evaluateSignal(signal: Signal): Promise<SignalEvaluation> {
    logger.info(`StrategyEngineJs: Evaluating signal ${signal.id}`);
    
    try {
      // Perform basic validation
      this.validateSignal(signal);
      
      // Calculate trust score
      const trustScore = signal.trustVector ? 
        this.calculateAverageTrustScore(signal.trustVector) : 0.75;
      
      // Apply risk checks if enabled
      let riskViolations: any[] = [];
      if (this.config.applyRiskChecks) {
        riskViolations = await this.applyRiskChecks(signal);
      }
      
      // Check minimum trust score
      const passedTrustCheck = trustScore >= this.config.minTrustScore;
      
      // Calculate execution probability based on confidence and trust score
      const executionProbability = signal.confidence * trustScore;
      
      // Calculate expected impact
      const expectedImpact = signal.strength * this.calculateEntropySusceptibility(signal);
      
      // Calculate expected slippage
      const expectedSlippagePct = this.calculateExpectedSlippage(signal);
      
      // Check if the signal is latency critical
      const isLatencyCritical = signal.executionHorizon === ExecutionHorizon.Immediate;
      
      // Calculate recommended position size based on confidence and risk grade
      const recommendedPositionSizePct = this.calculatePositionSizePct(signal);
      
      // Get latency budget based on execution horizon
      const latencyBudgetMs = this.getLatencyBudgetMs(signal.executionHorizon);
      
      // Create evaluation result
      const evaluation: SignalEvaluation = {
        signalId: signal.id,
        passed: riskViolations.length === 0 && passedTrustCheck,
        executionProbability,
        expectedImpact,
        expectedSlippagePct,
        trustScore,
        riskViolations,
        isLatencyCritical,
        recommendedPositionSizePct,
        latencyBudgetMs,
        timestamp: new Date()
      };
      
      return evaluation;
    } catch (error) {
      logger.error(`StrategyEngineJs: Failed to evaluate signal ${signal.id}:`, error);
      throw error;
    }
  }
  
  /**
   * Calculate signal metrics
   * @param signal The signal to calculate metrics for
   * @param executionResult Optional execution result
   * @returns Signal metrics
   */
  public calculateSignalMetrics(signal: Signal, executionResult?: ExecutionResult): SignalMetrics {
    const metrics: SignalMetrics = {
      signalId: signal.id,
      strategyId: signal.strategyId,
      symbol: signal.symbol,
      generationTime: signal.timestamp,
      executionTime: undefined,
      executionLatencyMs: undefined,
      confidence: signal.confidence,
      strength: signal.strength,
      success: false,
      price: signal.price,
      executionPrice: undefined,
      slippagePct: undefined,
      direction: signal.direction,
      positionSize: undefined,
      trustScore: signal.trustVector ? 
        this.calculateAverageTrustScore(signal.trustVector) : undefined,
      status: this.getSignalStatus(signal),
      riskGrade: signal.riskGrade ?? RiskGrade.Medium,
      executionHorizon: signal.executionHorizon ?? ExecutionHorizon.ShortTerm,
      pnl: undefined,
      additionalMetrics: {}
    };
    
    // Update with execution result if available
    if (executionResult) {
      metrics.executionTime = executionResult.timestamp;
      
      // Calculate latency
      if (metrics.executionTime) {
        metrics.executionLatencyMs = 
          metrics.executionTime.getTime() - signal.timestamp.getTime();
      }
      
      metrics.success = executionResult.status === ExecutionStatus.Completed;
      metrics.executionPrice = executionResult.averagePrice;
      
      // Calculate slippage if we have both prices
      if (signal.price !== undefined && executionResult.averagePrice !== undefined) {
        const slippagePct = this.calculateSlippage(
          signal.price, 
          executionResult.averagePrice, 
          signal.direction
        );
        metrics.slippagePct = slippagePct;
      }
      
      metrics.positionSize = executionResult.executedQuantity;
      metrics.pnl = executionResult.realizedPnl;
      
      // Add execution specific metrics
      metrics.additionalMetrics['execution_time_ms'] = executionResult.executionTimeMs;
      
      if (executionResult.trustScore !== undefined) {
        metrics.additionalMetrics['venue_trust'] = executionResult.trustScore;
      }
    }
    
    return metrics;
  }
  
  /**
   * Get stored metrics for a signal
   * @param signalId The signal ID
   * @returns Signal metrics or undefined if not found
   */
  public getSignalMetrics(signalId: string): SignalMetrics | undefined {
    return this.metricsStore.get(signalId);
  }
  
  /**
   * Update configuration
   * @param config The configuration to update
   */
  public updateConfig(config: Partial<StrategyEngineConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * Get current configuration
   * @returns The current configuration
   */
  public getConfig(): StrategyEngineConfig {
    return { ...this.config };
  }
  
  /**
   * Check if a signal has expired
   * @param signal The signal to check
   * @returns True if expired
   */
  private hasSignalExpired(signal: Signal): boolean {
    if (!signal.expiration) {
      return false;
    }
    
    return new Date() > signal.expiration;
  }
  
  /**
   * Validate basic signal properties
   * @param signal The signal to validate
   */
  private validateSignal(signal: Signal): void {
    // Check if price is required but missing
    if (this.config.requirePrice && signal.price === undefined) {
      throw new Error('Signal price is required but missing');
    }
    
    // Check confidence within range
    if (signal.confidence < 0 || signal.confidence > 1) {
      throw new Error(`Invalid confidence value: ${signal.confidence}`);
    }
    
    // Check strength within range
    if (signal.strength < 0 || signal.strength > 1) {
      throw new Error(`Invalid strength value: ${signal.strength}`);
    }
  }
  
  /**
   * Apply risk checks to a signal
   * @param signal The signal to check
   * @returns Array of risk violations
   */
  private async applyRiskChecks(signal: Signal): Promise<any[]> {
    try {
      // Call risk calculator
      const result = await this.riskCalculator.checkSignal(signal);
      return result?.violations || [];
    } catch (error) {
      logger.error(`StrategyEngineJs: Risk check failed for signal ${signal.id}:`, error);
      return [{ reason: 'Risk check failed', details: String(error) }];
    }
  }
  
  /**
   * Calculate average trust score from trust vector
   * @param trustVector The trust vector
   * @returns Average trust score
   */
  private calculateAverageTrustScore(trustVector: Record<string, number>): number {
    if (!trustVector || Object.keys(trustVector).length === 0) {
      return 0.75; // Default trust score
    }
    
    const sum = Object.values(trustVector).reduce((acc, val) => acc + val, 0);
    return sum / Object.keys(trustVector).length;
  }
  
  /**
   * Calculate entropy susceptibility
   * @param signal The signal
   * @returns Entropy susceptibility score
   */
  private calculateEntropySusceptibility(signal: Signal): number {
    // Simple implementation - could be more sophisticated in real system
    const baseScore = 0.5;
    
    // Adjust based on risk grade
    const riskAdjustment = signal.riskGrade !== undefined ? {
      [RiskGrade.Low]: -0.1,
      [RiskGrade.Medium]: 0,
      [RiskGrade.High]: 0.1,
      [RiskGrade.Exceptional]: 0.2
    }[signal.riskGrade] : 0;
    
    // Adjust based on execution horizon
    const horizonAdjustment = signal.executionHorizon !== undefined ? {
      [ExecutionHorizon.Immediate]: 0.2,
      [ExecutionHorizon.ShortTerm]: 0.1,
      [ExecutionHorizon.MediumTerm]: 0,
      [ExecutionHorizon.LongTerm]: -0.1
    }[signal.executionHorizon] : 0;
    
    return Math.min(Math.max(baseScore + riskAdjustment + horizonAdjustment, 0), 1);
  }
  
  /**
   * Calculate expected slippage percentage
   * @param signal The signal
   * @returns Expected slippage percentage
   */
  private calculateExpectedSlippage(signal: Signal): number {
    // Simple implementation - could be more sophisticated in real system
    const baseSlippage = 0.05; // 0.05%
    
    // Adjust based on risk grade
    const riskAdjustment = signal.riskGrade !== undefined ? {
      [RiskGrade.Low]: 0,
      [RiskGrade.Medium]: 0.05,
      [RiskGrade.High]: 0.1,
      [RiskGrade.Exceptional]: 0.2
    }[signal.riskGrade] : 0;
    
    // Adjust based on execution horizon
    const horizonAdjustment = signal.executionHorizon !== undefined ? {
      [ExecutionHorizon.Immediate]: 0.1,
      [ExecutionHorizon.ShortTerm]: 0.05,
      [ExecutionHorizon.MediumTerm]: 0,
      [ExecutionHorizon.LongTerm]: -0.02
    }[signal.executionHorizon] : 0;
    
    return baseSlippage + riskAdjustment + horizonAdjustment;
  }
  
  /**
   * Calculate position size as percentage of available capital
   * @param signal The signal
   * @returns Position size percentage
   */
  private calculatePositionSizePct(signal: Signal): number {
    // Base position size varies by risk grade
    const baseSize = signal.riskGrade !== undefined ? {
      [RiskGrade.Low]: 0.1, // 10%
      [RiskGrade.Medium]: 0.05, // 5%
      [RiskGrade.High]: 0.025, // 2.5%
      [RiskGrade.Exceptional]: 0.01 // 1%
    }[signal.riskGrade] : 0.05;
    
    // Scale by confidence
    const confidenceFactor = signal.confidence;
    
    // Scale by strength
    const strengthFactor = signal.strength;
    
    // Calculate final position size
    const positionSize = baseSize * confidenceFactor * strengthFactor;
    
    // Cap at 20% maximum
    return Math.min(positionSize, 0.2);
  }
  
  /**
   * Get latency budget based on execution horizon
   * @param horizon The execution horizon
   * @returns Latency budget in milliseconds
   */
  private getLatencyBudgetMs(horizon?: ExecutionHorizon): number {
    if (horizon === undefined) {
      horizon = this.config.defaultExecutionHorizon;
    }
    
    switch (horizon) {
      case ExecutionHorizon.Immediate:
        return 100; // 100ms
      case ExecutionHorizon.ShortTerm:
        return 500; // 500ms
      case ExecutionHorizon.MediumTerm:
        return 2000; // 2 seconds
      case ExecutionHorizon.LongTerm:
        return 5000; // 5 seconds
      default:
        return 500; // Default
    }
  }
  
  /**
   * Create an order from a signal
   * @param signal The signal
   * @param evaluation The signal evaluation
   * @returns The created order
   */
  private createOrderFromSignal(signal: Signal, evaluation: SignalEvaluation): any {
    // Calculate position size
    const positionSize = this.config.confidenceBasedSizing ? 
      evaluation.recommendedPositionSizePct : 0.05; // 5% default position size
    
    // Create order
    return {
      id: uuidv4(),
      symbol: signal.symbol,
      price: signal.price,
      amount: positionSize, // This will need to be scaled by available capital
      direction: signal.direction,
      signalId: signal.id,
      strategyId: signal.strategyId,
      maxSlippagePct: this.config.maxSlippagePct,
      isDryrun: this.config.dryrunMode,
      latencyBudgetMs: evaluation.latencyBudgetMs,
      additionalParams: {}
    };
  }
  
  /**
   * Calculate slippage percentage
   * @param signalPrice The signal price
   * @param executionPrice The execution price
   * @param direction The position direction
   * @returns Slippage percentage
   */
  private calculateSlippage(
    signalPrice: number, 
    executionPrice: number, 
    direction: number
  ): number {
    return direction === 1 ? // Long
      (executionPrice - signalPrice) / signalPrice * 100 : 
      (signalPrice - executionPrice) / signalPrice * 100;
  }
  
  /**
   * Get signal status
   * @param signal The signal
   * @returns Signal status
   */
  private getSignalStatus(signal: Signal): SignalStatus {
    if (signal.status !== undefined) {
      return signal.status as unknown as SignalStatus;
    }
    
    return SignalStatus.Created;
  }
  
  /**
   * Update metrics for successful execution
   * @param signal The signal
   * @param evaluation The signal evaluation
   * @param executionResult The execution result
   * @param executionLatency The execution latency in milliseconds
   */
  private updateMetricsForExecution(
    signal: Signal,
    evaluation: SignalEvaluation,
    executionResult: ExecutionResult,
    executionLatency: number
  ): void {
    // Calculate metrics
    const metrics = this.calculateSignalMetrics(signal, executionResult);
    
    // Add evaluation specific metrics
    metrics.additionalMetrics['evaluation_trust_score'] = evaluation.trustScore;
    metrics.additionalMetrics['evaluation_execution_probability'] = evaluation.executionProbability;
    
    // Add latency metrics
    metrics.additionalMetrics['engine_execution_latency_ms'] = executionLatency;
    
    // Store metrics
    this.metricsStore.set(signal.id, metrics);
  }
  
  /**
   * Update metrics for failed execution
   * @param signal The signal
   * @param executionResult The failed execution result
   */
  private updateMetricsForFailedExecution(
    signal: Signal,
    executionResult: ExecutionResult
  ): void {
    // Calculate metrics
    const metrics = this.calculateSignalMetrics(signal, executionResult);
    
    // Update success and status
    metrics.success = false;
    metrics.status = SignalStatus.Failed;
    
    // Store metrics
    this.metricsStore.set(signal.id, metrics);
  }
} 