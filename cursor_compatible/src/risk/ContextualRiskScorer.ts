/**
 * Contextual Risk Scorer
 * 
 * Evaluates the risk level of alpha signals based on market conditions,
 * execution history, signal attributes, and other contextual factors.
 */

import { v4 as uuidv4 } from 'uuid';
import { FusedAlphaFrame } from '../alphasources/fusion-engine.js';
import { RiskScore, RiskTier, MarketClass, RiskScorerConfig, DEFAULT_RISK_SCORER_CONFIG } from './risk.types.js';
import { MicrostructureAnalyzer, MicrostructureMetrics } from '../infra/marketdata/MicrostructureAnalyzer.js';
import { createLogger } from '../common/logger.js';
import { TrustEngine } from '../infra/risk/TrustEngine.js';
import { AlphaCacheManager } from '../alphasources/cache/alpha-cache-manager.js';
import { VolatilityCalculator } from '../alphasources/volatility-calculator.js';

/**
 * Manages contextual risk scoring for alpha trading signals
 */
export class ContextualRiskScorer {
  private readonly logger = createLogger('ContextualRiskScorer');
  private readonly config: RiskScorerConfig;
  private readonly recentScores: Map<string, RiskScore[]> = new Map();
  private readonly maxScoreHistory = 100; // Maximum number of scores to keep per symbol
  private lastMarketClassifications: Map<string, { class: MarketClass; timestamp: number }> = new Map();
  
  /**
   * Create a new contextual risk scorer
   * @param microAnalyzer Microstructure analyzer for market data
   * @param trustEngine Trust engine for execution history
   * @param volatilityCalculator Volatility calculator for price volatility
   * @param alphaCache Optional alpha cache for historical alpha signals
   * @param config Configuration for risk scoring
   */
  constructor(
    private readonly microAnalyzer?: MicrostructureAnalyzer,
    private readonly trustEngine?: TrustEngine,
    private readonly volatilityCalculator?: VolatilityCalculator,
    private readonly alphaCache?: AlphaCacheManager,
    config: Partial<RiskScorerConfig> = {}
  ) {
    this.config = { ...DEFAULT_RISK_SCORER_CONFIG, ...config };
    
    if (!this.config.enabled) {
      this.logger.warn('Contextual risk scoring is disabled');
    } else {
      this.logger.info('Contextual risk scorer initialized');
    }
  }
  
  /**
   * Score a fused alpha signal for risk
   * @param signal Alpha signal to score
   * @returns Risk score
   */
  public async scoreSignal(signal: FusedAlphaFrame): Promise<RiskScore> {
    if (!this.config.enabled) {
      return this.createDefaultRiskScore(signal);
    }
    
    try {
      // Gather risk contexts
      const [
        microMetrics,
        alphaVolatility,
        executionTrust
      ] = await Promise.all([
        this.getMicrostructureMetrics(signal.symbol),
        this.getAlphaVolatility(signal.symbol),
        this.getExecutionTrust(signal.symbol)
      ]);
      
      // Determine market class
      const marketClass = this.classifyMarket(signal.symbol, microMetrics);
      
      // Calculate signal staleness
      const signalAgeSec = (Date.now() - signal.timestamp) / 1000;
      
      // Calculate individual component scores
      const volatilityScore = this.calculateVolatilityScore(alphaVolatility);
      const spreadScore = this.calculateSpreadScore(microMetrics?.spreadPressure || 0, signal.symbol);
      const stalenessScore = this.calculateStalenessScore(signalAgeSec);
      const executionTrustScore = this.calculateExecutionTrustScore(executionTrust);
      const liquidityScore = this.calculateLiquidityScore(microMetrics, signal.symbol);
      
      // Apply market classification adjustment
      const marketClassAdjustment = this.getMarketClassAdjustment(marketClass);
      
      // Calculate weighted score
      let score = (
        volatilityScore * this.config.volatilityWeight +
        spreadScore * this.config.spreadWeight +
        stalenessScore * this.config.stalenessWeight +
        executionTrustScore * this.config.routeTrustWeight +
        liquidityScore * this.config.liquidityWeight
      );
      
      // Apply market class adjustment
      score = Math.max(0, Math.min(1, score + marketClassAdjustment));
      
      // Determine risk tier
      const tier = this.determineRiskTier(score);
      
      // Create final risk score
      const riskScore: RiskScore = {
        id: uuidv4(),
        symbol: signal.symbol,
        signalId: signal.id,
        score,
        tier,
        timestamp: Date.now(),
        components: {
          volatilityScore,
          liquidityScore,
          spreadScore,
          stalenessScore,
          executionTrustScore,
          marketClassAdjustment
        },
        metadata: {
          marketClass,
          alphaVolatility,
          spreadBps: microMetrics?.spreadPressure || 0,
          signalAgeSec,
          estimatedLiquidityUsd: this.estimateLiquidity(microMetrics, signal.symbol),
          venueTrustScores: executionTrust,
          signalConfidence: signal.confidence,
          signalDirection: signal.direction,
          signalSize: signal.size
        }
      };
      
      // Log the score
      this.logScore(riskScore.id, riskScore);
      
      return riskScore;
    } catch (error) {
      this.logger.error(`Error scoring signal for ${signal.symbol}: ${error instanceof Error ? error.message : String(error)}`);
      return this.createDefaultRiskScore(signal);
    }
  }
  
  /**
   * Log a risk score for tracking
   * @param scoreId Risk score ID
   * @param score Risk score to log
   */
  public logScore(scoreId: string, score: RiskScore): void {
    const { symbol } = score;
    
    // Initialize array for this symbol if needed
    if (!this.recentScores.has(symbol)) {
      this.recentScores.set(symbol, []);
    }
    
    // Add new score
    const scores = this.recentScores.get(symbol)!;
    scores.push(score);
    
    // Trim to max history
    if (scores.length > this.maxScoreHistory) {
      scores.splice(0, scores.length - this.maxScoreHistory);
    }
    
    this.logger.debug(`Logged risk score ${scoreId} for ${symbol}: ${score.score.toFixed(2)} (${score.tier})`);
  }
  
  /**
   * Export latest risk scores as an array
   * @returns Array of risk scores
   */
  public exportLatestScores(): RiskScore[] {
    const result: RiskScore[] = [];
    
    for (const [, scores] of this.recentScores.entries()) {
      if (scores.length > 0) {
        // Get the most recent score
        result.push(scores[scores.length - 1]);
      }
    }
    
    return result;
  }
  
  /**
   * Get historical risk scores for a symbol
   * @param symbol Asset symbol
   * @param limit Optional limit on number of scores to return
   * @returns Array of historical risk scores
   */
  public getHistoricalScores(symbol: string, limit?: number): RiskScore[] {
    const scores = this.recentScores.get(symbol) || [];
    
    // Sort by timestamp (newest first)
    const sorted = [...scores].sort((a, b) => b.timestamp - a.timestamp);
    
    // Apply limit if specified
    if (limit && limit > 0) {
      return sorted.slice(0, limit);
    }
    
    return sorted;
  }
  
  /**
   * Get the most recent risk score for a symbol
   * @param symbol Asset symbol
   * @returns Most recent risk score or null if none exists
   */
  public getLatestScore(symbol: string): RiskScore | null {
    const scores = this.recentScores.get(symbol) || [];
    
    if (scores.length === 0) {
      return null;
    }
    
    // Find the most recent score
    return scores.reduce((latest, current) => 
      current.timestamp > latest.timestamp ? current : latest, scores[0]);
  }
  
  /**
   * Generate a default risk score with neutral values
   * @param signal Alpha signal
   * @returns Default risk score
   */
  private createDefaultRiskScore(signal: FusedAlphaFrame): RiskScore {
    const score = 0.5; // Neutral score
    const tier = this.determineRiskTier(score);
    
    return {
      id: uuidv4(),
      symbol: signal.symbol,
      signalId: signal.id,
      score,
      tier,
      timestamp: Date.now(),
      components: {
        volatilityScore: 0.5,
        liquidityScore: 0.5,
        spreadScore: 0.5,
        stalenessScore: 0.5,
        executionTrustScore: 0.5,
        marketClassAdjustment: 0
      },
      metadata: {
        marketClass: MarketClass.UNKNOWN,
        alphaVolatility: 0,
        spreadBps: 0,
        signalAgeSec: (Date.now() - signal.timestamp) / 1000,
        estimatedLiquidityUsd: 0,
        signalConfidence: signal.confidence,
        signalDirection: signal.direction,
        signalSize: signal.size
      }
    };
  }
  
  /**
   * Get microstructure metrics for a symbol
   * @param symbol Asset symbol
   * @returns Microstructure metrics or null if not available
   */
  private async getMicrostructureMetrics(symbol: string): Promise<MicrostructureMetrics | null> {
    if (!this.microAnalyzer) {
      return null;
    }
    
    try {
      // Convert symbol format if needed (e.g., BTC/USDC -> binance_spot)
      const venue = this.symbolToVenue(symbol);
      return await this.microAnalyzer.analyze(venue);
    } catch (error) {
      this.logger.error(`Error getting microstructure metrics for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Get alpha volatility for a symbol
   * @param symbol Asset symbol
   * @returns Alpha volatility (0-1) or default value if not available
   */
  private async getAlphaVolatility(symbol: string): Promise<number> {
    if (this.volatilityCalculator) {
      try {
        return this.volatilityCalculator.getVolatility(symbol);
      } catch (error) {
        this.logger.error(`Error getting alpha volatility for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    if (this.alphaCache) {
      try {
        // Try to derive volatility from recent alpha signals
        const recentSignals = await this.alphaCache.getRecentSignals(symbol, 3600); // Last hour
        
        if (recentSignals.length >= 3) {
          // Calculate standard deviation of confidence scores
          const confidences = recentSignals.map(s => s.confidence);
          const avg = confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length;
          const variance = confidences.reduce((sum, confidence) => sum + Math.pow(confidence - avg, 2), 0) / confidences.length;
          
          return Math.sqrt(variance);
        }
      } catch (error) {
        this.logger.error(`Error calculating alpha volatility from cache for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Return default volatility
    return 0.2; // Moderate volatility
  }
  
  /**
   * Get execution trust scores for a symbol
   * @param symbol Asset symbol
   * @returns Map of venues to trust scores or null if not available
   */
  private async getExecutionTrust(symbol: string): Promise<Record<string, number> | null> {
    if (!this.trustEngine) {
      return null;
    }
    
    try {
      return this.trustEngine.getRouteTrustScores(symbol);
    } catch (error) {
      this.logger.error(`Error getting execution trust for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Classify market conditions for a symbol
   * @param symbol Asset symbol
   * @param metrics Microstructure metrics if available
   * @returns Market classification
   */
  private classifyMarket(symbol: string, metrics: MicrostructureMetrics | null): MarketClass {
    // If no metrics, try to get the cached classification
    if (!metrics) {
      const cached = this.lastMarketClassifications.get(symbol);
      if (cached && Date.now() - cached.timestamp < 300000) { // 5 minutes
        return cached.class;
      }
      return MarketClass.UNKNOWN;
    }
    
    // Classify based on microstructure metrics
    let classification: MarketClass;
    
    if (metrics.sweepRisk > 0.7 && Math.abs(metrics.topImbalance) > 0.7) {
      // High sweep risk and strong imbalance indicates trending market
      classification = MarketClass.TRENDING;
    } else if (metrics.quoteVolatility > 0.5) {
      // High quote volatility indicates volatile market
      classification = MarketClass.VOLATILE;
    } else if (Math.abs(metrics.spreadPressure) < 0.1 && metrics.quoteVolatility < 0.2) {
      // Low spread pressure and low volatility indicates ranging market
      classification = MarketClass.RANGING;
    } else if (metrics.topImbalance > 0 && metrics.topImbalance < 0.3) {
      // Balanced book with moderate imbalance suggests mean reversion
      classification = MarketClass.MEAN_REVERTING;
    } else {
      // Default classification
      classification = MarketClass.UNKNOWN;
    }
    
    // Cache the classification
    this.lastMarketClassifications.set(symbol, {
      class: classification,
      timestamp: Date.now()
    });
    
    return classification;
  }
  
  /**
   * Calculate volatility-based score
   * @param volatility Volatility value (0-1)
   * @returns Score (0-1) where 1 is safest
   */
  private calculateVolatilityScore(volatility: number): number {
    const { highRisk, lowRisk } = this.config.volatility;
    
    if (volatility >= highRisk) return 0;
    if (volatility <= lowRisk) return 1;
    
    // Linear interpolation between low and high risk thresholds
    return 1 - ((volatility - lowRisk) / (highRisk - lowRisk));
  }
  
  /**
   * Calculate spread-based score
   * @param spreadBps Spread in basis points
   * @param symbol Asset symbol
   * @returns Score (0-1) where 1 is safest
   */
  private calculateSpreadScore(spreadBps: number, symbol: string): number {
    const { highRisk, lowRisk } = this.config.spread;
    
    // Adjust for asset-specific spread norms (could be expanded)
    let adjustedHighRisk = highRisk;
    let adjustedLowRisk = lowRisk;
    
    // Example asset-specific adjustments
    if (symbol.includes('BTC')) {
      adjustedHighRisk = highRisk * 0.8; // BTC typically has tighter spreads
      adjustedLowRisk = lowRisk * 0.8;
    } else if (symbol.includes('ETH')) {
      adjustedHighRisk = highRisk * 0.9;
      adjustedLowRisk = lowRisk * 0.9;
    }
    
    if (spreadBps >= adjustedHighRisk) return 0;
    if (spreadBps <= adjustedLowRisk) return 1;
    
    // Linear interpolation between low and high risk thresholds
    return 1 - ((spreadBps - adjustedLowRisk) / (adjustedHighRisk - adjustedLowRisk));
  }
  
  /**
   * Calculate staleness-based score
   * @param ageSec Age of signal in seconds
   * @returns Score (0-1) where 1 is freshest
   */
  private calculateStalenessScore(ageSec: number): number {
    const maxAge = this.config.maxSignalAgeSec;
    
    if (ageSec >= maxAge) return 0;
    if (ageSec <= 0) return 1;
    
    // Exponential decay for staleness
    return Math.pow(1 - (ageSec / maxAge), 1.5);
  }
  
  /**
   * Calculate execution trust score
   * @param trustScores Trust scores by venue
   * @returns Score (0-1) where 1 is highest trust
   */
  private calculateExecutionTrustScore(trustScores: Record<string, number> | null): number {
    if (!trustScores || Object.keys(trustScores).length === 0) {
      return 0.5; // Default to medium trust if no data
    }
    
    // Get the average trust score across all venues
    const totalTrust = Object.values(trustScores).reduce((sum, score) => sum + score, 0);
    const avgTrust = totalTrust / Object.values(trustScores).length;
    
    return avgTrust;
  }
  
  /**
   * Calculate liquidity-based score
   * @param metrics Microstructure metrics
   * @param symbol Asset symbol
   * @returns Score (0-1) where 1 is highest liquidity
   */
  private calculateLiquidityScore(metrics: MicrostructureMetrics | null, symbol: string): number {
    const estimatedLiquidity = this.estimateLiquidity(metrics, symbol);
    const { highRisk, lowRisk } = this.config.liquidity;
    
    if (estimatedLiquidity <= highRisk) return 0;
    if (estimatedLiquidity >= lowRisk) return 1;
    
    // Linear interpolation between low and high risk thresholds
    return (estimatedLiquidity - highRisk) / (lowRisk - highRisk);
  }
  
  /**
   * Estimate liquidity available for a symbol
   * @param metrics Microstructure metrics
   * @param symbol Asset symbol
   * @returns Estimated liquidity in USD
   */
  private estimateLiquidity(metrics: MicrostructureMetrics | null, symbol: string): number {
    if (!metrics) {
      // Default estimates by asset type
      if (symbol.includes('BTC')) return 500000;
      if (symbol.includes('ETH')) return 300000;
      return 100000; // Default for other assets
    }
    
    // In a real implementation, this would use actual liquidity data
    // This is a placeholder that uses microstructure metrics as a proxy
    const baseEstimate = 500000 * (1 - metrics.quoteVolatility) * (1 - metrics.sweepRisk);
    
    // Adjust for asset type
    if (symbol.includes('BTC')) return baseEstimate * 1.5;
    if (symbol.includes('ETH')) return baseEstimate * 1.2;
    
    return baseEstimate;
  }
  
  /**
   * Get adjustment based on market classification
   * @param marketClass Market classification
   * @returns Score adjustment (-1 to 1)
   */
  private getMarketClassAdjustment(marketClass: MarketClass): number {
    switch (marketClass) {
      case MarketClass.TRENDING:
        return this.config.marketClassAdjustments.trending;
      case MarketClass.MEAN_REVERTING:
        return this.config.marketClassAdjustments.meanReverting;
      case MarketClass.VOLATILE:
        return this.config.marketClassAdjustments.volatile;
      case MarketClass.RANGING:
        return this.config.marketClassAdjustments.ranging;
      default:
        return 0;
    }
  }
  
  /**
   * Determine risk tier based on score
   * @param score Risk score (0-1)
   * @returns Risk tier
   */
  private determineRiskTier(score: number): RiskTier {
    if (score >= this.config.tiers.safe) {
      return RiskTier.SAFE;
    } else if (score >= this.config.tiers.cautious) {
      return RiskTier.CAUTIOUS;
    } else {
      return RiskTier.RISKY;
    }
  }
  
  /**
   * Convert symbol to venue identifier for microstructure analyzer
   * @param symbol Asset symbol (e.g., BTC/USDC)
   * @returns Venue identifier (e.g., binance_spot)
   */
  private symbolToVenue(symbol: string): string {
    // In a real implementation, this would map symbols to appropriate venues
    // This is a placeholder implementation
    const base = symbol.split('/')[0]?.toLowerCase() || '';
    return `${base}_market`;
  }
  
  /**
   * Plot risk surface for visualization
   * @param dimensions Dimensions to vary (e.g., 'volatility', 'spread')
   * @param symbol Optional symbol to customize plot for
   * @returns Serialized plot data
   */
  public plotRiskSurface(
    dimensions: ['volatility', 'spread'] | ['volatility', 'staleness'] | ['spread', 'liquidity'],
    symbol?: string
  ): any {
    // This would produce data for plotting risk surfaces in a UI
    // In a real implementation, this would generate data for a 3D visualization
    
    // Create grid points for selected dimensions
    const [dim1, dim2] = dimensions;
    
    // Generate a grid of values for each dimension
    const grid = {
      dim1: Array.from({ length: 10 }, (_, i) => i / 9),  // 0 to 1 in 10 steps
      dim2: Array.from({ length: 10 }, (_, i) => i / 9)   // 0 to 1 in 10 steps
    };
    
    // Calculate score at each grid point
    const scores = [];
    
    for (const x of grid.dim1) {
      const row = [];
      for (const y of grid.dim2) {
        // Placeholder score calculation based on dimensions
        let score = 0;
        
        if (dim1 === 'volatility' && dim2 === 'spread') {
          const volatilityScore = this.calculateVolatilityScore(x * this.config.volatility.highRisk);
          const spreadScore = this.calculateSpreadScore(y * this.config.spread.highRisk, symbol || 'BTC/USDC');
          score = (volatilityScore * this.config.volatilityWeight + 
                  spreadScore * this.config.spreadWeight) / 
                  (this.config.volatilityWeight + this.config.spreadWeight);
        } else if (dim1 === 'volatility' && dim2 === 'staleness') {
          const volatilityScore = this.calculateVolatilityScore(x * this.config.volatility.highRisk);
          const stalenessScore = this.calculateStalenessScore(y * this.config.maxSignalAgeSec);
          score = (volatilityScore * this.config.volatilityWeight + 
                  stalenessScore * this.config.stalenessWeight) / 
                  (this.config.volatilityWeight + this.config.stalenessWeight);
        } else if (dim1 === 'spread' && dim2 === 'liquidity') {
          const spreadScore = this.calculateSpreadScore(x * this.config.spread.highRisk, symbol || 'BTC/USDC');
          const liquidityScore = y; // Simplified liquidity score
          score = (spreadScore * this.config.spreadWeight + 
                  liquidityScore * this.config.liquidityWeight) / 
                  (this.config.spreadWeight + this.config.liquidityWeight);
        }
        
        row.push(score);
      }
      scores.push(row);
    }
    
    // Return plot data
    return {
      dimensions,
      x: {
        label: dim1,
        values: grid.dim1,
        unit: this.getDimensionUnit(dim1)
      },
      y: {
        label: dim2,
        values: grid.dim2,
        unit: this.getDimensionUnit(dim2)
      },
      z: {
        label: 'risk_score',
        values: scores
      },
      symbol
    };
  }
  
  /**
   * Get unit for a dimension
   * @param dimension Dimension name
   * @returns Unit string
   */
  private getDimensionUnit(dimension: string): string {
    switch (dimension) {
      case 'volatility': return 'ratio';
      case 'spread': return 'bps';
      case 'staleness': return 'seconds';
      case 'liquidity': return 'USD';
      default: return '';
    }
  }
} 