import { AdaptiveStrategy, Signal, StrategyContext, StrategyParameters } from './AdaptiveStrategy';
import { MarketRegime } from '../regime/RegimeClassifier';
import { RegimeClassifier } from '../regime/RegimeClassifier';
import { AlphaMemory } from '../memory/AlphaMemory';

/**
 * Default parameters for the momentum strategy
 */
export const DEFAULT_MOMENTUM_PARAMETERS: StrategyParameters = {
  // Lookback periods
  shortPeriod: 10,
  mediumPeriod: 20,
  longPeriod: 50,
  
  // Signal thresholds (as percentages)
  buyThreshold: 2.0,   // 2% momentum for buy signal
  sellThreshold: -2.0, // -2% momentum for sell signal
  
  // Position sizing
  positionSize: 1.0, // Full position size (0.0-1.0)
  positionSizePercent: 50, // Default position size
  
  // Exit parameters
  stopLoss: 3.0,      // 3% stop loss
  takeProfit: 6.0,    // 6% take profit
  trailingStop: true, // Use trailing stop
  
  // Volatility adjustment
  volatilityScaling: true,
  targetVol: 15.0,    // Target 15% annualized volatility
  
  // Risk management
  maxPositions: 3,
  riskLevel: 'medium' as 'low' | 'medium' | 'high',
  correlationThreshold: 0.7 // Maximum correlation between positions
};

/**
 * Parameter ranges for optimization
 */
export const MOMENTUM_PARAMETER_RANGES = {
  shortPeriod: { min: 5, max: 20, step: 5 },
  mediumPeriod: { min: 15, max: 40, step: 5 },
  longPeriod: { min: 30, max: 100, step: 10 },
  buyThreshold: { min: 0.5, max: 5.0, step: 0.5 },
  sellThreshold: { min: -5.0, max: -0.5, step: 0.5 },
  stopLoss: { min: 2.0, max: 10.0, step: 1.0 },
  takeProfit: { min: 4.0, max: 20.0, step: 2.0 }
};

/**
 * Implementation of a momentum-based trading strategy that adapts
 * to different market regimes
 */
export class MomentumStrategy extends AdaptiveStrategy {
  /**
   * Constructor
   * @param id Strategy ID (optional, will generate UUID if not provided)
   * @param symbol Trading symbol
   * @param parameters Custom strategy parameters (optional)
   */
  constructor(
    id: string = `momentum-${Date.now()}`,
    symbol: string = 'DEFAULT',
    parameters: Partial<StrategyParameters> = {}
  ) {
    // Get singleton instances
    const regimeClassifier = RegimeClassifier.getInstance();
    const memory = AlphaMemory.getInstance();
    
    // Create merged parameters
    const strategyParams = {
      ...DEFAULT_MOMENTUM_PARAMETERS,
      ...parameters
    };
    
    // Initialize the base class
    super(
      id,
      'Momentum Strategy',
      symbol,
      regimeClassifier,
      memory,
      strategyParams
    );
  }
  
  /**
   * Generate trading signals based on momentum indicators
   * @param context The strategy execution context
   */
  protected async executeStrategy(context: StrategyContext): Promise<Partial<Signal> | null> {
    const { symbol, features, regime, parameters, regimeConfidence } = context;
    
    // Extract parameters (with type safety)
    const shortPeriod = parameters.shortPeriod as number;
    const mediumPeriod = parameters.mediumPeriod as number;
    const longPeriod = parameters.longPeriod as number;
    const buyThreshold = parameters.buyThreshold as number;
    const sellThreshold = parameters.sellThreshold as number;
    
    // Calculate momentum scores based on regime
    let momentumScore: number;
    
    switch (regime) {
      case MarketRegime.BullishTrend:
        // In bullish trends, focus on medium-term momentum
        momentumScore = this.calculateMomentumScore(features, mediumPeriod);
        break;
        
      case MarketRegime.BearishTrend:
        // In bearish trends, be more responsive (use shorter period)
        momentumScore = this.calculateMomentumScore(features, shortPeriod);
        break;
        
      case MarketRegime.Rangebound:
      case MarketRegime.MeanReverting:
        // In rangebound markets, potentially reverse momentum signals
        momentumScore = -this.calculateMomentumScore(features, shortPeriod);
        break;
        
      case MarketRegime.HighVolatility:
        // In high volatility, use longer periods for stability
        momentumScore = this.calculateMomentumScore(features, longPeriod);
        break;
        
      case MarketRegime.LowVolatility:
        // In low volatility, use shorter periods for responsiveness
        momentumScore = this.calculateMomentumScore(features, shortPeriod);
        break;
        
      default:
        // Default to medium-term momentum
        momentumScore = this.calculateMomentumScore(features, mediumPeriod);
    }
    
    // Generate signal based on momentum score
    let direction: 'buy' | 'sell' | 'hold' = 'hold';
    let strength = 0;
    
    if (momentumScore >= buyThreshold) {
      direction = 'buy';
      // Normalize strength between 0 and 1, capped at 2x the threshold
      strength = Math.min(momentumScore / (buyThreshold * 2), 1);
    } else if (momentumScore <= sellThreshold) {
      direction = 'sell';
      // Normalize strength between 0 and 1, capped at 2x the threshold
      strength = Math.min(Math.abs(momentumScore) / (Math.abs(sellThreshold) * 2), 1);
    }
    
    // Only return a signal if it's not neutral
    if (direction !== 'hold') {
      return {
        direction,
        strength,
        confidence: strength * regimeConfidence, // Adjust confidence by regime confidence
        metadata: {
          momentumScore,
          lookbackPeriod: this.getLookbackForRegime(regime, shortPeriod, mediumPeriod, longPeriod)
        }
      };
    }
    
    return null;
  }
  
  /**
   * Override the base updateParameters method to provide custom regime-specific parameters
   * @param regime Market regime
   */
  public updateParameters(regime: MarketRegime): void {
    // Get cached parameters for this regime if available
    const cachedParams = this.regimeParameters.get(regime);
    
    if (cachedParams) {
      this.currentParameters = { ...this.defaultParameters, ...cachedParams };
      return;
    }
    
    // Start with base parameter adjustments from parent class
    super.updateParameters(regime);
    
    // Add momentum-specific parameter adjustments
    const params = this.currentParameters;
    
    switch (regime) {
      case MarketRegime.BullishTrend:
        // In bullish trends, be more aggressive
        params.buyThreshold = (params.buyThreshold as number) * 0.8; // Lower threshold
        params.sellThreshold = (params.sellThreshold as number) * 1.2; // Higher threshold
        break;
        
      case MarketRegime.BearishTrend:
        // In bearish trends, be more conservative with buys
        params.buyThreshold = (params.buyThreshold as number) * 1.5; // Higher threshold
        params.sellThreshold = (params.sellThreshold as number) * 0.8; // Lower threshold
        break;
        
      case MarketRegime.Rangebound:
        // In rangebound markets, tighten thresholds
        params.buyThreshold = (params.buyThreshold as number) * 1.2;
        params.sellThreshold = (params.sellThreshold as number) * 1.2;
        break;
        
      case MarketRegime.HighVolatility:
        // In high volatility, widen thresholds to avoid noise
        params.buyThreshold = (params.buyThreshold as number) * 1.5;
        params.sellThreshold = (params.sellThreshold as number) * 1.5;
        break;
        
      case MarketRegime.LowVolatility:
        // In low volatility, tighten thresholds to catch smaller moves
        params.buyThreshold = (params.buyThreshold as number) * 0.7;
        params.sellThreshold = (params.sellThreshold as number) * 0.7;
        break;
    }
    
    // Cache the updated parameters
    this.regimeParameters.set(regime, { ...this.currentParameters });
  }
  
  /**
   * Calculate momentum score for a given lookback period
   * @param features Market features
   * @param period Lookback period
   * @returns Momentum score as a percentage
   */
  private calculateMomentumScore(features: any, period: number): number {
    // Use the appropriate returns based on the period
    if (period <= 10) {
      return features.returns5d * 100; // Convert to percentage
    } else if (period <= 30) {
      return features.returns20d * 100; // Convert to percentage
    } else {
      // For longer periods, weight the returns based on the specified period
      return (
        (features.returns5d * 0.2 + 
         features.returns20d * 0.3 + 
         features.returns20d * (period / 20) * 0.5) * 100
      );
    }
  }
  
  /**
   * Get the appropriate lookback period for the current regime
   */
  private getLookbackForRegime(
    regime: MarketRegime, 
    shortPeriod: number, 
    mediumPeriod: number, 
    longPeriod: number
  ): number {
    switch (regime) {
      case MarketRegime.BullishTrend:
        return mediumPeriod;
      case MarketRegime.BearishTrend:
        return shortPeriod;
      case MarketRegime.Rangebound:
      case MarketRegime.MeanReverting:
        return shortPeriod;
      case MarketRegime.HighVolatility:
        return longPeriod;
      case MarketRegime.LowVolatility:
        return shortPeriod;
      default:
        return mediumPeriod;
    }
  }
} 