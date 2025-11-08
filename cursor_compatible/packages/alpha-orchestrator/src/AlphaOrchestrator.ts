/**
 * AlphaOrchestrator - Central signal intelligence fusion system
 * 
 * Unifies signals from all alpha sources, scores them based on performance,
 * resolves conflicts, and publishes normalized AlphaEvents
 */

import { EventEmitter } from 'events';
import {
  SignalType,
  SignalSource,
  MarketRegime,
  RawSignal,
  SignalMetrics,
  AlphaEvent,
  ConflictResolution,
  SignalSubscription,
  OrchestratorConfig,
  SignalPerformance,
  OrchestratorMetrics
} from './types';

const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => console.log(`[${name}] INFO:`, message, meta || ''),
  error: (message: string, error?: any) => console.error(`[${name}] ERROR:`, message, error || ''),
  debug: (message: string, meta?: any) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
  warn: (message: string, meta?: any) => console.warn(`[${name}] WARN:`, message, meta || '')
});

export class AlphaOrchestrator extends EventEmitter {
  private static instance: AlphaOrchestrator;
  private logger: ReturnType<typeof createLogger>;
  private config: OrchestratorConfig;
  
  // Signal tracking
  private activeSignals: Map<string, RawSignal> = new Map();
  private signalHistory: Map<string, SignalPerformance[]> = new Map();
  private signalMetrics: Map<string, SignalMetrics> = new Map();
  
  // Subscriptions
  private subscriptions: Map<string, SignalSubscription> = new Map();
  
  // Performance tracking
  private sourceReliability: Map<SignalSource, number> = new Map();
  private currentRegime: MarketRegime = MarketRegime.RANGING;
  private metrics: OrchestratorMetrics;
  
  // Processing
  private processingTimer?: NodeJS.Timeout;
  private regimeDetectionTimer?: NodeJS.Timeout;
  private metricsUpdateTimer?: NodeJS.Timeout;
  
  private constructor(config?: Partial<OrchestratorConfig>) {
    super();
    this.logger = createLogger('AlphaOrchestrator');
    
    this.config = {
      // Signal processing
      signalDecayRate: 0.95, // 5% decay per minute
      maxSignalAge: 300000, // 5 minutes
      
      // Conflict resolution
      conflictResolutionMethod: 'WEIGHTED_AVERAGE',
      minSignalsForEnsemble: 3,
      
      // Scoring weights
      weights: {
        historicalAccuracy: 0.4,
        regimeAlignment: 0.3,
        signalFreshness: 0.2,
        sourceReliability: 0.1
      },
      
      // Performance tracking
      metricsWindow: 86400000, // 24 hours
      minDataPoints: 10,
      
      // Regime detection
      regimeDetectionInterval: 60000, // 1 minute
      regimeChangeThreshold: 0.7,
      
      ...config
    };
    
    this.metrics = this.initializeMetrics();
    this.initializeSourceReliability();
    this.startProcessing();
  }
  
  public static getInstance(config?: Partial<OrchestratorConfig>): AlphaOrchestrator {
    if (!AlphaOrchestrator.instance) {
      AlphaOrchestrator.instance = new AlphaOrchestrator(config);
    }
    return AlphaOrchestrator.instance;
  }
  
  private initializeMetrics(): OrchestratorMetrics {
    return {
      totalSignalsProcessed: 0,
      totalAlphaEvents: 0,
      conflictsResolved: 0,
      avgConfidence: 0,
      topPerformingSources: [],
      currentRegime: MarketRegime.RANGING,
      signalDistribution: new Map()
    };
  }
  
  private initializeSourceReliability(): void {
    // Initialize with baseline reliability scores
    Object.values(SignalSource).forEach(source => {
      this.sourceReliability.set(source as SignalSource, 0.5);
    });
  }
  
  private startProcessing(): void {
    // Start signal processing loop
    this.processingTimer = setInterval(() => {
      this.processActiveSignals();
    }, 1000); // Process every second
    
    // Start regime detection
    this.regimeDetectionTimer = setInterval(() => {
      this.detectMarketRegime();
    }, this.config.regimeDetectionInterval);
    
    // Start metrics update
    this.metricsUpdateTimer = setInterval(() => {
      this.updateMetrics();
    }, 30000); // Update every 30 seconds
    
    this.logger.info('AlphaOrchestrator started', {
      config: this.config
    });
  }
  
  /**
   * Submit a raw signal for processing
   */
  public submitSignal(signal: RawSignal): void {
    try {
      // Validate signal
      if (!this.validateSignal(signal)) {
        this.logger.warn('Invalid signal rejected', { signal });
        return;
      }
      
      // Add expiry time if not set
      if (!signal.expiryTime) {
        signal.expiryTime = signal.timestamp + this.config.maxSignalAge;
      }
      
      // Store signal
      this.activeSignals.set(signal.id, signal);
      this.metrics.totalSignalsProcessed++;
      
      // Update signal type distribution
      const count = this.metrics.signalDistribution.get(signal.type) || 0;
      this.metrics.signalDistribution.set(signal.type, count + 1);
      
      this.logger.debug('Signal submitted', {
        id: signal.id,
        type: signal.type,
        source: signal.source,
        symbol: signal.symbol
      });
      
      // Emit telemetry
      this.emit('telemetry:signal_submitted', {
        source: signal.source,
        type: signal.type,
        symbol: signal.symbol,
        strength: signal.strength,
        timestamp: Date.now()
      });
      
      // Process immediately
      this.processSignalGroup(signal.symbol);
      
    } catch (error) {
      this.logger.error('Failed to submit signal', error);
      this.emit('telemetry:error', {
        type: 'signal_submission_failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  /**
   * Subscribe to alpha events
   */
  public subscribe(subscription: SignalSubscription): string {
    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    subscription.subscriberId = subscriptionId;
    
    this.subscriptions.set(subscriptionId, subscription);
    
    this.logger.info('New subscription registered', {
      subscriberId: subscriptionId,
      strategyId: subscription.strategyId,
      filters: subscription.filters
    });
    
    return subscriptionId;
  }
  
  /**
   * Unsubscribe from alpha events
   */
  public unsubscribe(subscriptionId: string): void {
    if (this.subscriptions.delete(subscriptionId)) {
      this.logger.info('Subscription removed', { subscriptionId });
    }
  }
  
  /**
   * Process active signals and generate alpha events
   */
  private processActiveSignals(): void {
    const now = Date.now();
    const symbolGroups = new Map<string, RawSignal[]>();
    
    // Clean expired signals and group by symbol
    for (const [id, signal] of this.activeSignals) {
      if (signal.expiryTime && signal.expiryTime < now) {
        this.activeSignals.delete(id);
        continue;
      }
      
      const signals = symbolGroups.get(signal.symbol) || [];
      signals.push(signal);
      symbolGroups.set(signal.symbol, signals);
    }
    
    // Process each symbol group
    for (const [symbol, signals] of symbolGroups) {
      if (signals.length > 0) {
        this.processSignalGroup(symbol, signals);
      }
    }
  }
  
  /**
   * Process signals for a specific symbol
   */
  private processSignalGroup(symbol: string, signals?: RawSignal[]): void {
    // Get signals for symbol if not provided
    if (!signals) {
      signals = Array.from(this.activeSignals.values())
        .filter(s => s.symbol === symbol);
    }
    
    if (signals.length === 0) return;
    
    // Check for conflicts
    const conflicts = this.detectConflicts(signals);
    
    let alphaEvent: AlphaEvent;
    
    if (conflicts.length > 0) {
      // Resolve conflicts
      const resolution = this.resolveConflicts(conflicts);
      alphaEvent = resolution.resolution;
      this.metrics.conflictsResolved++;
      
      this.logger.debug('Conflicts resolved', {
        symbol,
        method: resolution.method,
        conflictCount: conflicts.length
      });
    } else if (signals.length === 1) {
      // Single signal, convert directly
      alphaEvent = this.convertToAlphaEvent(signals[0]);
    } else {
      // Multiple aligned signals, ensemble
      alphaEvent = this.createEnsembleEvent(signals);
    }
    
    // Publish alpha event
    this.publishAlphaEvent(alphaEvent);
  }
  
  /**
   * Detect conflicting signals
   */
  private detectConflicts(signals: RawSignal[]): RawSignal[][] {
    const conflicts: RawSignal[][] = [];
    const groups = new Map<string, RawSignal[]>();
    
    // Group by direction
    for (const signal of signals) {
      const key = signal.direction;
      const group = groups.get(key) || [];
      group.push(signal);
      groups.set(key, group);
    }
    
    // If multiple directions, we have conflicts
    if (groups.size > 1) {
      conflicts.push(signals);
    }
    
    return conflicts;
  }
  
  /**
   * Resolve conflicting signals
   */
  private resolveConflicts(conflictGroups: RawSignal[][]): ConflictResolution {
    const allSignals = conflictGroups.flat();
    
    switch (this.config.conflictResolutionMethod) {
      case 'HIGHEST_CONFIDENCE':
        return this.resolveByHighestConfidence(allSignals);
        
      case 'WEIGHTED_AVERAGE':
        return this.resolveByWeightedAverage(allSignals);
        
      case 'ENSEMBLE':
        return this.resolveByEnsemble(allSignals);
        
      default:
        return this.resolveByHighestConfidence(allSignals);
    }
  }
  
  /**
   * Resolve conflicts by selecting highest confidence signal
   */
  private resolveByHighestConfidence(signals: RawSignal[]): ConflictResolution {
    // Score each signal
    const scoredSignals = signals.map(signal => ({
      signal,
      score: this.scoreSignal(signal)
    }));
    
    // Sort by score
    scoredSignals.sort((a, b) => b.score - a.score);
    
    const winner = scoredSignals[0].signal;
    const alphaEvent = this.convertToAlphaEvent(winner, scoredSignals[0].score);
    
    return {
      method: 'HIGHEST_CONFIDENCE',
      conflictingSignals: signals,
      resolution: alphaEvent,
      reason: `Selected signal with highest score: ${scoredSignals[0].score.toFixed(3)}`
    };
  }
  
  /**
   * Resolve conflicts by weighted average
   */
  private resolveByWeightedAverage(signals: RawSignal[]): ConflictResolution {
    // Group by direction and calculate weighted strengths
    const directionScores = new Map<string, number>();
    const directionWeights = new Map<string, number>();
    
    for (const signal of signals) {
      const score = this.scoreSignal(signal);
      const weight = score * signal.strength;
      
      const currentScore = directionScores.get(signal.direction) || 0;
      const currentWeight = directionWeights.get(signal.direction) || 0;
      
      directionScores.set(signal.direction, currentScore + weight);
      directionWeights.set(signal.direction, currentWeight + score);
    }
    
    // Find winning direction
    let bestDirection = 'NEUTRAL';
    let bestScore = 0;
    
    for (const [direction, totalScore] of directionScores) {
      const avgScore = totalScore / (directionWeights.get(direction) || 1);
      if (avgScore > bestScore) {
        bestScore = avgScore;
        bestDirection = direction;
      }
    }
    
    // Create synthetic alpha event
    const alphaEvent: AlphaEvent = {
      id: `alpha_${Date.now()}_weighted`,
      strategyId: 'orchestrator',
      signal: this.inferSignalType(signals),
      symbol: signals[0].symbol,
      direction: bestDirection as 'LONG' | 'SHORT' | 'NEUTRAL',
      confidence: Math.min(bestScore / 100, 1),
      weight: this.calculateWeight(bestScore),
      priority: this.calculatePriority(bestScore),
      source: SignalSource.ALPHA_EXPLOITATION,
      metadata: {
        originalSignals: signals,
        conflictResolution: 'WEIGHTED_AVERAGE',
        regimeAlignment: this.checkRegimeAlignment(signals[0].type)
      },
      timestamp: Date.now(),
      expiryTime: Math.min(...signals.map(s => s.expiryTime || Infinity))
    };
    
    return {
      method: 'WEIGHTED_AVERAGE',
      conflictingSignals: signals,
      resolution: alphaEvent,
      reason: `Weighted average selected ${bestDirection} with score ${bestScore.toFixed(2)}`
    };
  }
  
  /**
   * Resolve conflicts by ensemble
   */
  private resolveByEnsemble(signals: RawSignal[]): ConflictResolution {
    if (signals.length < this.config.minSignalsForEnsemble) {
      return this.resolveByWeightedAverage(signals);
    }
    
    // Create ensemble by combining all signals
    const ensembleStrength = signals.reduce((sum, s) => sum + s.strength, 0) / signals.length;
    const ensembleScore = signals.reduce((sum, s) => sum + this.scoreSignal(s), 0) / signals.length;
    
    // Majority vote for direction
    const directionVotes = new Map<string, number>();
    for (const signal of signals) {
      const votes = directionVotes.get(signal.direction) || 0;
      directionVotes.set(signal.direction, votes + 1);
    }
    
    let majorityDirection = 'NEUTRAL';
    let maxVotes = 0;
    for (const [direction, votes] of directionVotes) {
      if (votes > maxVotes) {
        maxVotes = votes;
        majorityDirection = direction;
      }
    }
    
    const alphaEvent: AlphaEvent = {
      id: `alpha_${Date.now()}_ensemble`,
      strategyId: 'orchestrator',
      signal: this.inferSignalType(signals),
      symbol: signals[0].symbol,
      direction: majorityDirection as 'LONG' | 'SHORT' | 'NEUTRAL',
      confidence: Math.min(ensembleScore / 100, 1),
      weight: this.calculateWeight(ensembleScore),
      priority: this.calculatePriority(ensembleScore),
      source: SignalSource.ALPHA_EXPLOITATION,
      metadata: {
        originalSignals: signals,
        conflictResolution: 'ENSEMBLE',
        regimeAlignment: this.checkRegimeAlignment(signals[0].type),
        ensembleSize: signals.length
      },
      timestamp: Date.now(),
      expiryTime: Math.min(...signals.map(s => s.expiryTime || Infinity))
    };
    
    return {
      method: 'ENSEMBLE',
      conflictingSignals: signals,
      resolution: alphaEvent,
      reason: `Ensemble of ${signals.length} signals voted ${majorityDirection}`
    };
  }
  
  /**
   * Convert raw signal to alpha event
   */
  private convertToAlphaEvent(signal: RawSignal, score?: number): AlphaEvent {
    if (!score) {
      score = this.scoreSignal(signal);
    }
    
    return {
      id: `alpha_${signal.id}`,
      strategyId: 'orchestrator',
      signal: signal.type,
      symbol: signal.symbol,
      direction: signal.direction,
      confidence: Math.min(score / 100, 1),
      weight: this.calculateWeight(score),
      priority: this.calculatePriority(score),
      source: signal.source,
      metadata: {
        originalSignals: [signal],
        regimeAlignment: this.checkRegimeAlignment(signal.type),
        ...signal.metadata
      },
      timestamp: Date.now(),
      expiryTime: signal.expiryTime || signal.timestamp + this.config.maxSignalAge
    };
  }
  
  /**
   * Create ensemble event from aligned signals
   */
  private createEnsembleEvent(signals: RawSignal[]): AlphaEvent {
    const avgStrength = signals.reduce((sum, s) => sum + s.strength, 0) / signals.length;
    const avgScore = signals.reduce((sum, s) => sum + this.scoreSignal(s), 0) / signals.length;
    
    return {
      id: `alpha_${Date.now()}_ensemble`,
      strategyId: 'orchestrator',
      signal: this.inferSignalType(signals),
      symbol: signals[0].symbol,
      direction: signals[0].direction, // All aligned
      confidence: Math.min(avgScore / 100, 1),
      weight: this.calculateWeight(avgScore),
      priority: this.calculatePriority(avgScore),
      source: SignalSource.ALPHA_EXPLOITATION,
      metadata: {
        originalSignals: signals,
        ensembleSize: signals.length,
        regimeAlignment: this.checkRegimeAlignment(signals[0].type)
      },
      timestamp: Date.now(),
      expiryTime: Math.min(...signals.map(s => s.expiryTime || Infinity))
    };
  }
  
  /**
   * Score a signal based on multiple factors
   */
  private scoreSignal(signal: RawSignal): number {
    const metrics = this.signalMetrics.get(`${signal.source}_${signal.type}`) || {
      historicalAccuracy: 0.5,
      profitFactor: 1.0,
      sharpeRatio: 0,
      winRate: 0.5,
      avgReturn: 0,
      totalSignals: 0,
      regime: this.currentRegime,
      lastUpdated: Date.now()
    };
    
    // Calculate component scores
    const accuracyScore = metrics.historicalAccuracy * 100;
    const regimeScore = this.checkRegimeAlignment(signal.type) ? 100 : 50;
    const freshnessScore = this.calculateFreshnessScore(signal.timestamp);
    const reliabilityScore = (this.sourceReliability.get(signal.source) || 0.5) * 100;
    
    // Apply weights
    const weightedScore = 
      accuracyScore * this.config.weights.historicalAccuracy +
      regimeScore * this.config.weights.regimeAlignment +
      freshnessScore * this.config.weights.signalFreshness +
      reliabilityScore * this.config.weights.sourceReliability;
    
    // Apply signal strength
    return weightedScore * (signal.strength / 100);
  }
  
  /**
   * Calculate freshness score based on signal age
   */
  private calculateFreshnessScore(timestamp: number): number {
    const age = Date.now() - timestamp;
    const ageRatio = age / this.config.maxSignalAge;
    
    // Exponential decay
    return 100 * Math.pow(this.config.signalDecayRate, ageRatio * 10);
  }
  
  /**
   * Calculate weight from score
   */
  private calculateWeight(score: number): number {
    // Normalize to 0-1 range with sigmoid
    return 1 / (1 + Math.exp(-0.1 * (score - 50)));
  }
  
  /**
   * Calculate priority from score
   */
  private calculatePriority(score: number): number {
    // Map score to 1-10 priority
    return Math.min(Math.max(Math.round(score / 10), 1), 10);
  }
  
  /**
   * Check if signal type aligns with current regime
   */
  private checkRegimeAlignment(signalType: SignalType): boolean {
    const alignmentMap: Record<MarketRegime, SignalType[]> = {
      [MarketRegime.BULL_TREND]: [
        SignalType.MOMENTUM_SURGE,
        SignalType.SUPPORT_BREAK,
        SignalType.WHALE_ACCUMULATION
      ],
      [MarketRegime.BEAR_TREND]: [
        SignalType.RESISTANCE_BREAK,
        SignalType.SMART_MONEY_FLOW,
        SignalType.VOLATILITY_SPIKE
      ],
      [MarketRegime.RANGING]: [
        SignalType.SUPPORT_BREAK,
        SignalType.RESISTANCE_BREAK,
        SignalType.LIQUIDITY_IMBALANCE
      ],
      [MarketRegime.HIGH_VOLATILITY]: [
        SignalType.VOLATILITY_SPIKE,
        SignalType.ANOMALY_DETECTED,
        SignalType.EXCHANGE_ARBITRAGE
      ],
      [MarketRegime.LOW_VOLATILITY]: [
        SignalType.PATTERN_FORMATION,
        SignalType.CORRELATION_BREAK,
        SignalType.REGIME_CHANGE
      ],
      [MarketRegime.RISK_OFF]: [
        SignalType.SMART_MONEY_FLOW,
        SignalType.BRIDGE_CONGESTION,
        SignalType.DEFI_ROTATION
      ],
      [MarketRegime.RISK_ON]: [
        SignalType.MOMENTUM_SURGE,
        SignalType.WHALE_ACCUMULATION,
        SignalType.CHAIN_MOMENTUM
      ]
    };
    
    return alignmentMap[this.currentRegime]?.includes(signalType) || false;
  }
  
  /**
   * Infer signal type from multiple signals
   */
  private inferSignalType(signals: RawSignal[]): SignalType {
    // Count occurrences of each type
    const typeCounts = new Map<SignalType, number>();
    for (const signal of signals) {
      const count = typeCounts.get(signal.type) || 0;
      typeCounts.set(signal.type, count + 1);
    }
    
    // Return most common type
    let maxCount = 0;
    let dominantType = signals[0].type;
    
    for (const [type, count] of typeCounts) {
      if (count > maxCount) {
        maxCount = count;
        dominantType = type;
      }
    }
    
    return dominantType;
  }
  
  /**
   * Publish alpha event to subscribers
   */
  private publishAlphaEvent(event: AlphaEvent): void {
    this.metrics.totalAlphaEvents++;
    
    // Update average confidence
    this.metrics.avgConfidence = 
      (this.metrics.avgConfidence * (this.metrics.totalAlphaEvents - 1) + event.confidence) / 
      this.metrics.totalAlphaEvents;
    
    // Notify subscribers
    const sortedSubscriptions = Array.from(this.subscriptions.values())
      .sort((a, b) => b.priority - a.priority);
    
    for (const subscription of sortedSubscriptions) {
      if (this.matchesFilters(event, subscription.filters)) {
        try {
          subscription.callback(event);
        } catch (error) {
          this.logger.error(`Subscriber ${subscription.subscriberId} callback failed`, error);
        }
      }
    }
    
    // Emit public event
    this.emit('alpha-event', event);
    
    // Emit telemetry
    this.emit('telemetry:alpha_event', {
      id: event.id,
      signal: event.signal,
      symbol: event.symbol,
      direction: event.direction,
      confidence: event.confidence,
      weight: event.weight,
      priority: event.priority,
      source: event.source,
      timestamp: event.timestamp
    });
    
    this.logger.debug('Alpha event published', {
      id: event.id,
      symbol: event.symbol,
      signal: event.signal,
      confidence: event.confidence
    });
  }
  
  /**
   * Check if event matches subscription filters
   */
  private matchesFilters(
    event: AlphaEvent, 
    filters: SignalSubscription['filters']
  ): boolean {
    if (filters.sources && !filters.sources.includes(event.source)) {
      return false;
    }
    
    if (filters.types && !filters.types.includes(event.signal)) {
      return false;
    }
    
    if (filters.symbols && !filters.symbols.includes(event.symbol)) {
      return false;
    }
    
    if (filters.minConfidence && event.confidence < filters.minConfidence) {
      return false;
    }
    
    if (filters.regimes && !filters.regimes.includes(this.currentRegime)) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Validate raw signal
   */
  private validateSignal(signal: RawSignal): boolean {
    if (!signal.id || !signal.source || !signal.type || !signal.symbol) {
      return false;
    }
    
    if (signal.strength < 0 || signal.strength > 100) {
      return false;
    }
    
    if (!['LONG', 'SHORT', 'NEUTRAL'].includes(signal.direction)) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Detect current market regime
   */
  private detectMarketRegime(): void {
    // This would integrate with market data to detect regime
    // For now, emit telemetry
    this.emit('telemetry:regime_detection', {
      currentRegime: this.currentRegime,
      timestamp: Date.now()
    });
  }
  
  /**
   * Update performance metrics
   */
  private updateMetrics(): void {
    // Calculate top performing sources
    const sourcePerformance: Array<{
      source: SignalSource;
      accuracy: number;
      profitFactor: number;
    }> = [];
    
    for (const [source, reliability] of this.sourceReliability) {
      sourcePerformance.push({
        source,
        accuracy: reliability,
        profitFactor: 1.0 + (reliability - 0.5) * 2 // Mock calculation
      });
    }
    
    sourcePerformance.sort((a, b) => b.accuracy - a.accuracy);
    this.metrics.topPerformingSources = sourcePerformance.slice(0, 5);
    this.metrics.currentRegime = this.currentRegime;
    
    // Emit metrics
    this.emit('metrics-updated', this.metrics);
    this.emit('telemetry:orchestrator_metrics', {
      ...this.metrics,
      signalDistribution: Array.from(this.metrics.signalDistribution.entries()),
      timestamp: Date.now()
    });
  }
  
  /**
   * Record signal performance feedback
   */
  public recordPerformance(performance: SignalPerformance): void {
    // Find the original signal
    const alphaEvent = this.findAlphaEventById(performance.signalId);
    if (!alphaEvent) return;
    
    // Update metrics for each original signal
    for (const signal of alphaEvent.metadata.originalSignals) {
      const key = `${signal.source}_${signal.type}`;
      const history = this.signalHistory.get(key) || [];
      history.push(performance);
      this.signalHistory.set(key, history);
      
      // Update aggregated metrics
      this.updateSignalMetrics(signal.source, signal.type);
    }
    
    // Update source reliability
    this.updateSourceReliability(alphaEvent.source, performance);
    
    this.logger.debug('Performance recorded', {
      signalId: performance.signalId,
      outcome: performance.actualOutcome,
      return: performance.returnPercentage
    });
  }
  
  /**
   * Update signal metrics based on performance history
   */
  private updateSignalMetrics(source: SignalSource, type: SignalType): void {
    const key = `${source}_${type}`;
    const history = this.signalHistory.get(key) || [];
    
    if (history.length < this.config.minDataPoints) return;
    
    // Calculate metrics from recent history
    const recentHistory = history.slice(-100); // Last 100 signals
    
    const wins = recentHistory.filter(p => p.actualOutcome === 'WIN').length;
    const losses = recentHistory.filter(p => p.actualOutcome === 'LOSS').length;
    const totalTrades = wins + losses;
    
    const winRate = totalTrades > 0 ? wins / totalTrades : 0.5;
    const avgReturn = recentHistory.reduce((sum, p) => sum + p.returnPercentage, 0) / recentHistory.length;
    
    // Calculate profit factor
    const totalProfit = recentHistory
      .filter(p => p.returnPercentage > 0)
      .reduce((sum, p) => sum + p.returnPercentage, 0);
    const totalLoss = Math.abs(recentHistory
      .filter(p => p.returnPercentage < 0)
      .reduce((sum, p) => sum + p.returnPercentage, 0));
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 999 : 1;
    
    // Simple Sharpe approximation
    const returns = recentHistory.map(p => p.returnPercentage);
    const avgRet = avgReturn;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgRet, 2), 0) / returns.length
    );
    const sharpeRatio = stdDev > 0 ? (avgRet * Math.sqrt(252)) / stdDev : 0;
    
    const metrics: SignalMetrics = {
      historicalAccuracy: winRate,
      profitFactor,
      sharpeRatio,
      winRate,
      avgReturn,
      totalSignals: history.length,
      regime: this.currentRegime,
      lastUpdated: Date.now()
    };
    
    this.signalMetrics.set(key, metrics);
  }
  
  /**
   * Update source reliability based on performance
   */
  private updateSourceReliability(source: SignalSource, performance: SignalPerformance): void {
    const current = this.sourceReliability.get(source) || 0.5;
    
    // Adjust reliability based on outcome
    let adjustment = 0;
    if (performance.actualOutcome === 'WIN') {
      adjustment = 0.01 * (1 + Math.abs(performance.returnPercentage) / 100);
    } else if (performance.actualOutcome === 'LOSS') {
      adjustment = -0.01 * (1 + Math.abs(performance.returnPercentage) / 100);
    }
    
    // Apply adjustment with bounds
    const newReliability = Math.max(0.1, Math.min(0.9, current + adjustment));
    this.sourceReliability.set(source, newReliability);
  }
  
  /**
   * Find alpha event by ID (for performance tracking)
   */
  private findAlphaEventById(eventId: string): AlphaEvent | null {
    // In production, would maintain a history cache
    // For now, return null
    return null;
  }
  
  /**
   * Get current metrics
   */
  public getMetrics(): OrchestratorMetrics {
    return { ...this.metrics };
  }
  
  /**
   * Get signal metrics for a source/type combination
   */
  public getSignalMetrics(source: SignalSource, type: SignalType): SignalMetrics | null {
    return this.signalMetrics.get(`${source}_${type}`) || null;
  }
  
  /**
   * Set market regime manually (for testing)
   */
  public setMarketRegime(regime: MarketRegime): void {
    this.currentRegime = regime;
    this.logger.info('Market regime updated', { regime });
    
    this.emit('regime-changed', { 
      oldRegime: this.metrics.currentRegime,
      newRegime: regime,
      timestamp: Date.now()
    });
    
    this.metrics.currentRegime = regime;
  }
  
  /**
   * Cleanup
   */
  public destroy(): void {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
    }
    
    if (this.regimeDetectionTimer) {
      clearInterval(this.regimeDetectionTimer);
    }
    
    if (this.metricsUpdateTimer) {
      clearInterval(this.metricsUpdateTimer);
    }
    
    this.activeSignals.clear();
    this.subscriptions.clear();
    
    this.logger.info('AlphaOrchestrator destroyed');
  }
} 