import { StrategyEngineRust } from '../execution/StrategyEngineRust';
import { AlphaMemory } from '../memory/AlphaMemory';
import { RegimeClassifier, MarketRegime, MarketFeatures } from '../regime/RegimeClassifier';
import { logger } from '../utils/logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { StrategyMutationEngine } from '../evolution/StrategyMutationEngine';
import { KnowledgeAggregator, AggregatedKnowledge } from '../knowledge/KnowledgeAggregator';
import { KnowledgeContext } from '../knowledge/interfaces/IKnowledgeProvider';

/**
 * Signal interface representing a trading signal
 */
export interface Signal {
  id: string;
  strategyId: string;
  symbol: string;
  timestamp: Date;
  direction: 'buy' | 'sell' | 'hold';
  strength?: number;
  confidence?: number;
  regimeType: string;
  regimeConfidence: number;
  trustVector: {
    signal_quality: number;
    regime_confidence: number;
  };
  metadata?: Record<string, any>;
}

/**
 * Signal metrics interface
 */
export interface SignalMetrics {
  success: boolean;
  pnl?: number;
  executionTime?: number;
  entryPrice?: number;
  exitPrice?: number;
  slippage?: number;
  latency?: number;
}

/**
 * Strategy parameters interface
 * Key-value pairs of parameters used by strategy implementations
 */
export interface StrategyParameters extends Record<string, any> {
  // Common parameters that all strategies should implement
  riskLevel?: 'low' | 'medium' | 'high';
  positionSizePercent?: number;
  maxDrawdownPercent?: number;
  
  // Cross-chain execution parameters
  useUniversalX?: boolean; // Whether to use UniversalX for cross-chain execution
  preferredExecutionPath?: 'universalx' | 'legacy' | 'auto'; // Execution path preference
  crossChainEnabled?: boolean; // Whether cross-chain trading is enabled
  maxCrossChainLatency?: number; // Maximum acceptable latency for cross-chain trades (ms)
}

/**
 * Strategy context provided to strategy implementations
 */
export interface StrategyContext {
  // Symbol being traded
  symbol: string;
  
  // Current market features
  features: MarketFeatures;
  
  // Current market regime
  regime: MarketRegime;
  
  // Regime classification confidence
  regimeConfidence: number;
  
  // Strategy parameters (possibly regime-specific)
  parameters: StrategyParameters;
  
  // Additional metadata
  metadata?: Record<string, any>;
}

/**
 * Base class for all adaptive strategy implementations
 * Provides common functionality for strategy identification,
 * signal generation, and regime adaptation
 */
export abstract class AdaptiveStrategy {
  protected id: string;
  protected name: string;
  protected symbol: string;
  protected regimeClassifier: RegimeClassifier;
  protected memory: AlphaMemory;
  protected strategyEngine: StrategyEngineRust;
  protected telemetryBus: TelemetryBus;
  protected mutationEngine: StrategyMutationEngine;
  protected knowledgeAggregator: KnowledgeAggregator | null = null;
  protected defaultConfidence: number = 0.75;
  protected defaultStrength: number = 0.5;
  protected isEnabled: boolean = true;
  protected currentSignal: Signal | null = null;
  protected currentRegime: MarketRegime = MarketRegime.Unknown;
  protected lastRegimeCheck: number = 0;
  protected regimeCheckIntervalMs: number = 60000; // 1 minute
  protected regimeAdaptive: boolean = true;
  protected lastPerformanceUpdate: number = 0;
  protected performanceUpdateIntervalMs: number = 3600000; // 1 hour
  protected enableKnowledgeEnhancement: boolean = true;
  protected lastKnowledgeEnhancement: AggregatedKnowledge | null = null;
  
  // Regime-specific parameter sets
  protected regimeParameters: Map<MarketRegime, StrategyParameters> = new Map();
  protected currentParameters: StrategyParameters;
  protected defaultParameters: StrategyParameters;
  
  /**
   * Constructor for the AdaptiveStrategy base class
   * @param id The strategy ID
   * @param name The strategy name
   * @param symbol The trading pair symbol
   * @param regimeClassifier The regime classifier instance
   * @param memory The memory instance
   * @param defaultParameters Default strategy parameters
   */
  constructor(
    id: string,
    name: string,
    symbol: string,
    regimeClassifier: RegimeClassifier,
    memory: AlphaMemory,
    defaultParameters: StrategyParameters = {}
  ) {
    this.id = id;
    this.name = name;
    this.symbol = symbol;
    this.regimeClassifier = regimeClassifier;
    this.memory = memory;
    this.strategyEngine = StrategyEngineRust.getInstance();
    this.telemetryBus = TelemetryBus.getInstance();
    this.mutationEngine = StrategyMutationEngine.getInstance();
    this.defaultParameters = defaultParameters;
    this.currentParameters = { ...defaultParameters };
    
    // Try to get KnowledgeAggregator if available
    try {
      this.knowledgeAggregator = KnowledgeAggregator.getInstance();
    } catch (error) {
      logger.debug(`KnowledgeAggregator not available for strategy ${this.id}`);
      this.enableKnowledgeEnhancement = false;
    }
    
    // Initialize with current regime
    this.checkRegimeChange();
    
    logger.info(`AdaptiveStrategy initialized: ${this.name} (${this.id}) for ${this.symbol}`);
  }
  
  /**
   * Generate a trading signal based on market features
   * @param marketFeatures The market features to generate a signal from
   * @param params Additional parameters for signal generation
   * @returns The generated signal or null if no signal is generated
   */
  public async generateSignal(
    marketFeatures: MarketFeatures,
    params?: Record<string, any>
  ): Promise<Signal | null> {
    if (!this.isEnabled) {
      logger.debug(`Strategy ${this.id}: is disabled, skipping signal generation`);
      return null;
    }
    
    try {
      // Check for regime change
      this.checkRegimeChange();
      
      // Get current regime
      const regimeClassification = this.regimeClassifier.getCurrentRegime(this.symbol);
      if (!regimeClassification) {
        logger.warn(`Strategy ${this.id}: Cannot generate signal, no current regime classified`);
        return null;
      }

      const regime = regimeClassification.primaryRegime;
      
      // Create strategy context for the execution
      const context: StrategyContext = {
        symbol: this.symbol,
        features: marketFeatures,
        regime: regime,
        regimeConfidence: regimeClassification.confidence,
        parameters: this.currentParameters,
        metadata: {
          secondaryRegime: regimeClassification.secondaryRegime,
          regimeScores: regimeClassification.scores,
          regimeDurationMs: this.getRegimeDurationMs()
        }
      };
      
      // Get knowledge enhancement if enabled
      let knowledgeEnhancement: AggregatedKnowledge | null = null;
      if (this.enableKnowledgeEnhancement && this.knowledgeAggregator) {
        try {
          const knowledgeContext: KnowledgeContext = {
            symbol: this.symbol,
            regime: regime,
            timeframe: params?.timeframe || '1h',
            assets: [this.symbol.split('/')[0], this.symbol.split('/')[1]].filter(Boolean),
            volatility: marketFeatures.volatility20d,
            metadata: {
              strategyId: this.id,
              features: marketFeatures
            }
          };
          
          knowledgeEnhancement = await this.knowledgeAggregator.getAggregatedKnowledge(knowledgeContext);
          
          if (knowledgeEnhancement) {
            // Apply parameter hints if available
            if (knowledgeEnhancement.parameterHints && Object.keys(knowledgeEnhancement.parameterHints).length > 0) {
              const enhancedParams = { ...this.currentParameters, ...knowledgeEnhancement.parameterHints };
              context.parameters = enhancedParams;
              logger.debug(`Strategy ${this.id}: Applied parameter hints from knowledge providers`);
            }
            
            // Add enhanced features to context
            if (knowledgeEnhancement.mergedFeatures && Object.keys(knowledgeEnhancement.mergedFeatures).length > 0) {
              context.features = {
                ...context.features,
                ...knowledgeEnhancement.mergedFeatures
              };
              logger.debug(`Strategy ${this.id}: Added ${Object.keys(knowledgeEnhancement.mergedFeatures).length} enhanced features`);
            }
          }
        } catch (error) {
          logger.error(`Strategy ${this.id}: Error getting knowledge enhancement:`, error);
          // Continue without enhancement
        }
      }
      
      // Generate raw signal 
      const rawSignal = await this.executeStrategy(context);
      if (!rawSignal) {
        return null;
      }
      
      // Complete signal with additional metadata
      const signal: Signal = {
        ...rawSignal,
        id: this.generateSignalId(),
        strategyId: this.id,
        symbol: this.symbol,
        timestamp: new Date(),
        regimeType: regime,
        regimeConfidence: regimeClassification.confidence,
        direction: rawSignal.direction || 'hold', // Ensure direction is defined
        confidence: rawSignal.confidence || this.defaultConfidence,
        strength: rawSignal.strength || this.defaultStrength,
        trustVector: {
          signal_quality: rawSignal.confidence || this.defaultConfidence,
          regime_confidence: regimeClassification.confidence
        },
        metadata: {
          ...(rawSignal.metadata || {}),
          regime: {
            primaryRegime: regime,
            secondaryRegime: regimeClassification.secondaryRegime,
            durationMs: this.getRegimeDurationMs(),
            top3Regimes: this.getTopRegimes(regimeClassification.scores, 3)
          },
          parameters: this.currentParameters,
          knowledgeEnhanced: knowledgeEnhancement !== null,
          knowledgeSources: knowledgeEnhancement?.contributingSources || []
        }
      };
      
      // Enhance signal with knowledge if available
      if (knowledgeEnhancement && this.knowledgeAggregator) {
        const enhancedSignal = await this.knowledgeAggregator.enhanceSignal(signal, knowledgeEnhancement);
        Object.assign(signal, enhancedSignal);
        this.lastKnowledgeEnhancement = knowledgeEnhancement;
      }
      
      // Emit telemetry for signal generation
      this.telemetryBus.emit('strategy_signal_generated', {
        timestamp: Date.now(),
        strategyId: this.id,
        signalId: signal.id,
        regime: regime,
        signalType: signal.direction,
        confidence: signal.confidence,
        knowledgeEnhanced: signal.metadata?.knowledgeEnhanced || false
      });
      
      // Evaluate signal with the strategy engine
      const evaluation = await this.strategyEngine.evaluateSignal(signal);
      
      if (!evaluation.passed) {
        logger.info(`Strategy ${this.id}: Signal rejected by strategy engine: ${JSON.stringify(evaluation.riskViolations)}`);
        
        this.telemetryBus.emit('strategy_signal_rejected', {
          timestamp: Date.now(),
          strategyId: this.id,
          signalId: signal.id,
          violations: evaluation.riskViolations
        });
        
        return null;
      }
      
      // Store current signal
      this.currentSignal = signal;
      
      // Emit telemetry for accepted signal
      this.telemetryBus.emit('strategy_signal_accepted', {
        timestamp: Date.now(),
        strategyId: this.id,
        signalId: signal.id,
        regime: regime,
        signalType: signal.direction
      });
      
      // Check if it's time to update performance metrics
      this.updatePerformanceMetrics();
      
      return signal;
    } catch (error) {
      logger.error(`Strategy ${this.id}: Error generating signal:`, error);
      
      this.telemetryBus.emit('strategy_error', {
        timestamp: Date.now(),
        strategyId: this.id,
        errorType: 'signal_generation',
        error: error instanceof Error ? error.message : String(error)
      });
      
      return null;
    }
  }
  
  /**
   * Process a generated signal to produce an execution
   * @param signal The signal to process
   * @returns True if execution was successful
   */
  public async processSignal(signal: Signal): Promise<boolean> {
    try {
      logger.info(`Strategy ${this.id}: Processing signal ${signal.id}`);
      
      // Execute signal through strategy engine
      const result = await this.strategyEngine.executeStrategy(signal);
      
      // Calculate metrics
      const metrics = this.strategyEngine.calculateSignalMetrics(signal, result);
      
      // Calculate performance delta for knowledge feedback
      const performanceDelta = metrics.pnl || 0;
      
      // Provide feedback to knowledge providers if signal was enhanced
      if (signal.metadata?.knowledgeEnhanced && 
          signal.metadata?.knowledgeSources?.length > 0 && 
          this.knowledgeAggregator && 
          this.lastKnowledgeEnhancement) {
        
        const enhancementIds = this.lastKnowledgeEnhancement.enhancements.map(e => e.id);
        await this.knowledgeAggregator.provideFeedback(signal.id, enhancementIds, performanceDelta);
      }
      
      // Record execution information in memory
      const recordResult = this.memory.addRecord({
        strategyId: this.id,
        symbol: this.symbol,
        regime: signal.regimeType as MarketRegime,
        parameters: this.currentParameters,
        performance: {
          totalReturn: metrics.pnl || 0,
          sharpeRatio: 0, // Not available in single execution metrics
          maxDrawdown: 0, // Not available in single execution metrics
          winRate: metrics.success ? 1 : 0,
          tradeCount: 1,
          avgProfitPerTrade: metrics.pnl || 0,
          profitFactor: (metrics.pnl || 0) > 0 ? 1 : 0
        },
        period: {
          start: new Date(Date.now() - 3600000), // Placeholder: 1 hour ago
          end: new Date(),
          durationMs: 3600000
        },
        metadata: {
          created: new Date(),
          strategyType: this.name,
          tags: [signal.regimeType, signal.direction],
          signalId: signal.id,
          knowledgeEnhanced: signal.metadata?.knowledgeEnhanced || false
        }
      });
      
      // Emit telemetry for signal execution
      this.telemetryBus.emit('strategy_signal_executed', {
        timestamp: Date.now(),
        strategyId: this.id,
        signalId: signal.id,
        success: metrics.success,
        pnl: metrics.pnl || 0,
        executionTime: metrics.executionTime || 0,
        knowledgeEnhanced: signal.metadata?.knowledgeEnhanced || false
      });
      
      return metrics.success;
    } catch (error) {
      logger.error(`Strategy ${this.id}: Failed to process signal ${signal.id}:`, error);
      
      this.telemetryBus.emit('strategy_error', {
        timestamp: Date.now(),
        strategyId: this.id,
        errorType: 'signal_execution',
        signalId: signal?.id,
        error: error instanceof Error ? error.message : String(error)
      });
      
      return false;
    }
  }
  
  /**
   * Check for regime change and update parameters if needed
   */
  private checkRegimeChange(): void {
    const now = Date.now();
    
    // Only check periodically to avoid excessive updates
    if (now - this.lastRegimeCheck < this.regimeCheckIntervalMs) {
      return;
    }
    
    this.lastRegimeCheck = now;
    
    const regimeClassification = this.regimeClassifier.getCurrentRegime(this.symbol);
    if (!regimeClassification) return;
    
    const newRegime = regimeClassification.primaryRegime;
    
    if (newRegime !== this.currentRegime) {
      // Regime has changed
      const oldRegime = this.currentRegime;
      this.currentRegime = newRegime;
      
      logger.info(`Strategy ${this.id}: Regime changed from ${oldRegime} to ${newRegime}`);
      
      // Emit telemetry for regime change
      this.telemetryBus.emit('strategy_regime_change', {
        timestamp: now,
        strategyId: this.id,
        symbol: this.symbol,
        previousRegime: oldRegime,
        newRegime: newRegime,
        confidence: regimeClassification.confidence
      });
      
      if (this.regimeAdaptive) {
        // Update parameters for new regime
        this.updateParameters(newRegime);
        
        // Pull optimized parameters from memory
        this.pullParametersFromMemory(newRegime);
      }
    }
  }
  
  /**
   * Pull optimized parameters from memory for current regime
   */
  private pullParametersFromMemory(regime: MarketRegime): void {
    try {
      // Find best parameters for this strategy+symbol+regime combination
      const bestParams = this.memory.findBestParameters(this.id, this.symbol, regime);
      
      if (bestParams) {
        logger.info(`Strategy ${this.id}: Found optimized parameters for regime ${regime}`);
        
        // Cache the regime-specific parameters
        this.regimeParameters.set(regime, bestParams);
        
        // Apply parameters
        this.currentParameters = { ...this.defaultParameters, ...bestParams };
        
        // Emit telemetry for parameter update
        this.telemetryBus.emit('strategy_parameters_updated', {
          timestamp: Date.now(),
          strategyId: this.id,
          source: 'memory',
          regime: regime,
          parameterCount: Object.keys(bestParams).length
        });
      } else {
        logger.info(`Strategy ${this.id}: No optimized parameters found for regime ${regime}, generating default regime parameters`);
        
        // Generate default parameters for this regime if not already cached
        if (!this.regimeParameters.has(regime)) {
          const regimeSpecificParams = this.generateRegimeParameters(regime);
          this.regimeParameters.set(regime, regimeSpecificParams);
          this.currentParameters = { ...this.defaultParameters, ...regimeSpecificParams };
        }
      }
    } catch (error) {
      logger.error(`Strategy ${this.id}: Error pulling parameters from memory:`, error);
    }
  }
  
  /**
   * Generate default parameters for a specific regime
   * @param regime Market regime
   * @returns Parameters optimized for the regime
   */
  protected generateRegimeParameters(regime: MarketRegime): StrategyParameters {
    // Base implementation provides some common adjustments based on regime
    const params: StrategyParameters = { ...this.defaultParameters };
    
    // Adjust risk level based on regime
    switch (regime) {
      case MarketRegime.BullishTrend:
        // Increase position size in bullish trends
        params.positionSizePercent = Math.min(100, (params.positionSizePercent || 50) * 1.2);
        params.riskLevel = 'medium';
        break;
        
      case MarketRegime.BearishTrend:
        // Reduce position size in bearish trends
        params.positionSizePercent = Math.max(10, (params.positionSizePercent || 50) * 0.8);
        params.riskLevel = 'high';
        break;
        
      case MarketRegime.HighVolatility:
        // Reduce position size in high volatility
        params.positionSizePercent = Math.max(10, (params.positionSizePercent || 50) * 0.6);
        params.riskLevel = 'high';
        break;
        
      case MarketRegime.LowVolatility:
        // Increase position size in low volatility
        params.positionSizePercent = Math.min(100, (params.positionSizePercent || 50) * 1.3);
        params.riskLevel = 'low';
        break;
        
      case MarketRegime.Rangebound:
      case MarketRegime.MeanReverting:
        // Default parameters for mean-reverting environments
        params.positionSizePercent = (params.positionSizePercent || 50);
        params.riskLevel = 'medium';
        break;
        
      case MarketRegime.MarketStress:
        // Minimal position size during market stress
        params.positionSizePercent = Math.max(5, (params.positionSizePercent || 50) * 0.3);
        params.riskLevel = 'high';
        break;
        
      default:
        // No changes for unknown regimes
        break;
    }
    
    return params;
  }
  
  /**
   * Get the current duration of the regime in milliseconds
   */
  protected getRegimeDurationMs(): number {
    const history = this.regimeClassifier.getRegimeHistory(this.symbol);
    return history?.currentRegimeDurationMs || 0;
  }
  
  /**
   * Get the top N regimes based on scores
   * @param scores Regime scores
   * @param n Number of top regimes to return
   * @returns Array of top regime types and scores
   */
  protected getTopRegimes(scores: Record<MarketRegime, number>, n: number = 3): Array<{regime: MarketRegime, score: number}> {
    return Object.entries(scores)
      .sort(([, a], [, b]) => b - a)
      .slice(0, n)
      .map(([regime, score]) => ({
        regime: regime as MarketRegime,
        score
      }));
  }
  
  /**
   * Update parameters for given regime
   * Implementations should override this to provide custom regime-specific parameters
   * @param regimeType Regime type
   */
  public updateParameters(regimeType: MarketRegime): void {
    // Get cached parameters for this regime if available
    const cachedParams = this.regimeParameters.get(regimeType);
    
    if (cachedParams) {
      this.currentParameters = { ...this.defaultParameters, ...cachedParams };
      logger.info(`Strategy ${this.id}: Applied cached parameters for regime ${regimeType}`);
      return;
    }
    
    // Generate default parameters for this regime
    const generatedParams = this.generateRegimeParameters(regimeType);
    this.regimeParameters.set(regimeType, generatedParams);
    this.currentParameters = { ...this.defaultParameters, ...generatedParams };
    
    logger.info(`Strategy ${this.id}: Generated default parameters for regime ${regimeType}`);
  }
  
  /**
   * Update performance metrics and push to mutation engine
   */
  private updatePerformanceMetrics(): void {
    const now = Date.now();
    
    // Only update periodically
    if (now - this.lastPerformanceUpdate < this.performanceUpdateIntervalMs) {
      return;
    }
    
    this.lastPerformanceUpdate = now;
    
    try {
      // Get performance data from memory
      const records = this.memory.getRecords({
        strategyId: this.id,
        symbol: this.symbol
      });
      
      if (records.length === 0) return;
      
      // Calculate metrics
      const pnlValues = records.map(r => r.performance.totalReturn);
      const avgPnl = pnlValues.reduce((sum, val) => sum + val, 0) / pnlValues.length;
      const variance = pnlValues.reduce((sum, val) => sum + Math.pow(val - avgPnl, 2), 0) / pnlValues.length;
      const volatility = Math.sqrt(variance);
      
      const sharpeRatio = volatility > 0 ? avgPnl / volatility : 0;
      const maxDrawdown = Math.max(...records.map(r => r.performance.maxDrawdown));
      const winRate = records.reduce((sum, r) => sum + (r.performance.totalReturn > 0 ? 1 : 0), 0) / records.length;
      
      // Push metrics to mutation engine
      this.mutationEngine.updateStrategyMetrics(this.id, {
        sharpeRatio,
        pnlStability: 1 - volatility,
        maxDrawdown,
        winRate
      });
      
      // Emit telemetry for performance update
      this.telemetryBus.emit('strategy_performance_update', {
        timestamp: now,
        strategyId: this.id,
        metrics: {
          sharpeRatio,
          pnlStability: 1 - volatility,
          maxDrawdown,
          winRate,
          recordCount: records.length
        }
      });
      
      logger.debug(`Strategy ${this.id}: Updated performance metrics (Sharpe: ${sharpeRatio.toFixed(2)})`);
    } catch (error) {
      logger.error(`Strategy ${this.id}: Error updating performance metrics:`, error);
    }
  }
  
  /**
   * Get the current active signal if any
   * @returns The current signal or null
   */
  public getCurrentSignal(): Signal | null {
    return this.currentSignal;
  }
  
  /**
   * Get the strategy ID
   * @returns The strategy ID
   */
  public getId(): string {
    return this.id;
  }
  
  /**
   * Get the strategy name
   * @returns The strategy name
   */
  public getName(): string {
    return this.name;
  }
  
  /**
   * Get the trading pair symbol
   * @returns The symbol
   */
  public getSymbol(): string {
    return this.symbol;
  }
  
  /**
   * Enable the strategy
   */
  public enable(): void {
    this.isEnabled = true;
    logger.info(`Strategy ${this.id} enabled`);
    
    this.telemetryBus.emit('strategy_enabled', {
      timestamp: Date.now(),
      strategyId: this.id
    });
  }
  
  /**
   * Disable the strategy
   */
  public disable(): void {
    this.isEnabled = false;
    logger.info(`Strategy ${this.id} disabled`);
    
    this.telemetryBus.emit('strategy_disabled', {
      timestamp: Date.now(),
      strategyId: this.id
    });
  }
  
  /**
   * Check if the strategy is enabled
   * @returns True if enabled
   */
  public isStrategyEnabled(): boolean {
    return this.isEnabled;
  }
  
  /**
   * Get current regime
   * @returns Current market regime
   */
  public getCurrentRegime(): MarketRegime {
    return this.currentRegime;
  }
  
  /**
   * Set whether the strategy is regime-adaptive
   */
  public setRegimeAdaptive(adaptive: boolean): void {
    this.regimeAdaptive = adaptive;
    
    logger.info(`Strategy ${this.id}: Regime adaptivity set to ${adaptive}`);
  }
  
  /**
   * Generate a unique signal ID
   * @returns Signal ID
   */
  protected generateSignalId(): string {
    // Critical: use secure random for IDs to avoid predictability
    const timestamp = Date.now();
    const { randomId } = require('../utils/secureRandom');
    return `${this.id}_${timestamp}_${randomId('sig_', 8)}`;
  }
  
  /**
   * Execute strategy logic based on market context
   * @param context Strategy execution context
   * @returns Partial signal or null
   */
  protected abstract executeStrategy(
    context: StrategyContext
  ): Promise<Partial<Signal> | null>;
  
  /**
   * Enable/disable knowledge enhancement
   */
  public setKnowledgeEnhancement(enabled: boolean): void {
    this.enableKnowledgeEnhancement = enabled;
    logger.info(`Strategy ${this.id}: Knowledge enhancement set to ${enabled}`);
  }
  
  /**
   * Check if knowledge enhancement is enabled
   */
  public isKnowledgeEnhancementEnabled(): boolean {
    return this.enableKnowledgeEnhancement && this.knowledgeAggregator !== null;
  }
} 