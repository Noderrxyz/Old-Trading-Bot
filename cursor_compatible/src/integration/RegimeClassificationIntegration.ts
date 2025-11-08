import { logger } from '../utils/logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { MarketRegimeClassifier } from '../regime/MarketRegimeClassifier';
import { RegimeTransitionEngine } from '../regime/RegimeTransitionEngine';
import { RegimeCapitalAllocator } from '../capital/RegimeCapitalAllocator';
import { StrategyPortfolioOptimizer } from '../optimizer/StrategyPortfolioOptimizer';
import { AdaptiveIntelligenceSystem } from './AdaptiveIntelligenceSystem';
import {
  MarketRegime,
  RegimeTransition,
  RegimeClassification
} from '../regime/MarketRegimeTypes';

/**
 * Configuration for regime classification integration
 */
export interface RegimeClassificationIntegrationConfig {
  /**
   * Default market symbol to track
   */
  defaultMarketSymbol: string;
  
  /**
   * Additional market symbols to track
   */
  additionalMarketSymbols: string[];
  
  /**
   * Classification interval in milliseconds
   */
  classificationIntervalMs: number;
  
  /**
   * Force reallocation on regime changes
   */
  forceReallocationOnRegimeChange: boolean;
  
  /**
   * Force optimization on regime changes
   */
  forceOptimizationOnRegimeChange: boolean;
  
  /**
   * Emit detailed telemetry
   */
  emitDetailedTelemetry: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: RegimeClassificationIntegrationConfig = {
  defaultMarketSymbol: 'BTC/USD',
  additionalMarketSymbols: ['ETH/USD', 'SOL/USD'],
  classificationIntervalMs: 3600000, // 1 hour
  forceReallocationOnRegimeChange: true,
  forceOptimizationOnRegimeChange: true,
  emitDetailedTelemetry: true
};

/**
 * Integration class that connects the regime classification system
 * with capital allocation, portfolio optimization, and adaptive intelligence
 */
export class RegimeClassificationIntegration {
  private static instance: RegimeClassificationIntegration | null = null;
  private config: RegimeClassificationIntegrationConfig;
  private classifier: MarketRegimeClassifier;
  private transitionEngine: RegimeTransitionEngine;
  private capitalAllocator: RegimeCapitalAllocator;
  private portfolioOptimizer: StrategyPortfolioOptimizer;
  private adaptiveSystem: AdaptiveIntelligenceSystem;
  private telemetry: TelemetryBus;
  
  private isRunning: boolean = false;
  private classificationInterval: NodeJS.Timeout | null = null;
  
  /**
   * Private constructor for singleton pattern
   */
  private constructor(config: Partial<RegimeClassificationIntegrationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Get component instances
    this.classifier = MarketRegimeClassifier.getInstance();
    this.transitionEngine = RegimeTransitionEngine.getInstance();
    this.capitalAllocator = RegimeCapitalAllocator.getInstance();
    this.portfolioOptimizer = StrategyPortfolioOptimizer.getInstance();
    this.adaptiveSystem = AdaptiveIntelligenceSystem.getInstance();
    this.telemetry = TelemetryBus.getInstance();
    
    // Set up regime transition listener
    this.setupTransitionListener();
    
    logger.info('RegimeClassificationIntegration initialized', {
      defaultMarket: this.config.defaultMarketSymbol,
      additionalMarkets: this.config.additionalMarketSymbols
    });
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config: Partial<RegimeClassificationIntegrationConfig> = {}): RegimeClassificationIntegration {
    if (!RegimeClassificationIntegration.instance) {
      RegimeClassificationIntegration.instance = new RegimeClassificationIntegration(config);
    }
    return RegimeClassificationIntegration.instance;
  }
  
  /**
   * Start automatic classification cycle
   */
  public start(): void {
    if (this.isRunning) {
      logger.warn('RegimeClassificationIntegration is already running');
      return;
    }
    
    // Start classification cycle
    this.classificationInterval = setInterval(
      () => this.runClassificationCycle(),
      this.config.classificationIntervalMs
    );
    
    this.isRunning = true;
    logger.info(`RegimeClassificationIntegration started with interval ${this.config.classificationIntervalMs}ms`);
    
    // Run initial classification
    this.runClassificationCycle();
  }
  
  /**
   * Stop automatic classification cycle
   */
  public stop(): void {
    if (!this.isRunning) {
      logger.warn('RegimeClassificationIntegration is not running');
      return;
    }
    
    if (this.classificationInterval) {
      clearInterval(this.classificationInterval);
      this.classificationInterval = null;
    }
    
    this.isRunning = false;
    logger.info('RegimeClassificationIntegration stopped');
  }
  
  /**
   * Run classification cycle
   */
  public runClassificationCycle(): void {
    const startTime = Date.now();
    
    try {
      // Classify default market
      this.classifyMarket(this.config.defaultMarketSymbol);
      
      // Classify additional markets
      for (const symbol of this.config.additionalMarketSymbols) {
        this.classifyMarket(symbol);
      }
      
      // Emit telemetry
      if (this.config.emitDetailedTelemetry) {
        this.telemetry.emit('regime.classification_cycle', {
          durationMs: Date.now() - startTime,
          marketsClassified: 1 + this.config.additionalMarketSymbols.length,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error in classification cycle: ${errorMessage}`, error);
      
      this.telemetry.emit('regime.classification_cycle_error', {
        error: errorMessage,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Classify a specific market
   * @param symbol Market symbol
   * @returns Classification result
   */
  public classifyMarket(symbol: string): RegimeClassification {
    try {
      // Get market features
      const features = this.getMarketFeatures(symbol);
      
      // Classify regime
      const classification = this.classifier.classifyRegime(symbol, features);
      
      // Process through transition engine
      this.transitionEngine.processClassification(classification, symbol);
      
      return classification;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error classifying market ${symbol}: ${errorMessage}`, error);
      
      this.telemetry.emit('regime.market_classification_error', {
        symbol,
        error: errorMessage,
        timestamp: Date.now()
      });
      
      // Return an unknown classification with zero confidence
      return {
        primaryRegime: MarketRegime.Unknown,
        secondaryRegime: null,
        confidence: 0,
        transitionState: 'ambiguous',
        scores: { [MarketRegime.Unknown]: 1 } as Record<MarketRegime, number>,
        timestamp: Date.now(),
        features: {} as any
      };
    }
  }
  
  /**
   * Get the current regime for a market
   * @param symbol Market symbol
   * @returns Current regime classification
   */
  public getCurrentRegime(symbol: string = this.config.defaultMarketSymbol): RegimeClassification {
    return this.transitionEngine.getSmoothRegime(symbol);
  }
  
  /**
   * Reset all classification history
   */
  public reset(): void {
    this.classifier.resetAllHistory();
    this.transitionEngine.resetAll();
    logger.info('Reset all regime classification history');
  }
  
  /**
   * Set up regime transition listener
   */
  private setupTransitionListener(): void {
    this.transitionEngine.onTransition((transition, symbol) => {
      // Log the transition
      logger.info(`Market regime transition: ${symbol} ${transition.fromRegime} -> ${transition.toRegime}`, {
        confidence: transition.confidence,
        durationMs: transition.transitionDurationMs
      });
      
      // Check if this is the default market
      if (symbol === this.config.defaultMarketSymbol) {
        // Trigger actions based on the regime change
        this.handleDefaultMarketTransition(transition);
      }
    });
  }
  
  /**
   * Handle regime transition for the default market
   */
  private handleDefaultMarketTransition(transition: RegimeTransition): void {
    // Force reallocation if configured
    if (this.config.forceReallocationOnRegimeChange) {
      logger.info(`Forcing capital reallocation due to regime change: ${transition.fromRegime} -> ${transition.toRegime}`);
      
      try {
        this.capitalAllocator.reallocate();
      } catch (error) {
        logger.error('Error during forced reallocation', error);
      }
    }
    
    // Force optimization if configured
    if (this.config.forceOptimizationOnRegimeChange) {
      logger.info(`Forcing portfolio optimization due to regime change: ${transition.fromRegime} -> ${transition.toRegime}`);
      
      try {
        this.portfolioOptimizer.runOptimization();
      } catch (error) {
        logger.error('Error during forced optimization', error);
      }
    }
    
    // Emit telemetry
    this.telemetry.emit('regime.integration_actions', {
      transition: {
        from: transition.fromRegime,
        to: transition.toRegime
      },
      actions: {
        reallocation: this.config.forceReallocationOnRegimeChange,
        optimization: this.config.forceOptimizationOnRegimeChange
      },
      timestamp: Date.now()
    });
  }
  
  /**
   * Get market features for a symbol
   * This would fetch real-time data in a production system
   */
  private getMarketFeatures(symbol: string): any {
    // In a real implementation, this would pull data from price feeds,
    // calculate technical indicators, etc.
    
    // For now, return simulated features
    const randomReturn = (min: number, max: number) => 
      Math.random() * (max - min) + min;
    
    const simulateReturns = () => {
      // Simulate different regimes for testing
      const now = Date.now();
      const hour = new Date().getHours();
      
      // Before noon: bullish
      if (hour < 12) {
        return {
          returns1d: randomReturn(0.01, 0.05),
          returns5d: randomReturn(0.05, 0.15),
          returns20d: randomReturn(0.1, 0.3),
          volatility1d: randomReturn(0.01, 0.03),
          rsi14: randomReturn(60, 80)
        };
      }
      // Afternoon: rangebound
      else if (hour < 18) {
        return {
          returns1d: randomReturn(-0.01, 0.01),
          returns5d: randomReturn(-0.03, 0.03),
          returns20d: randomReturn(-0.05, 0.05),
          volatility1d: randomReturn(0.005, 0.02),
          rsi14: randomReturn(40, 60)
        };
      }
      // Evening: bearish
      else {
        return {
          returns1d: randomReturn(-0.05, -0.01),
          returns5d: randomReturn(-0.15, -0.05),
          returns20d: randomReturn(-0.3, -0.1),
          volatility1d: randomReturn(0.02, 0.04),
          rsi14: randomReturn(20, 40)
        };
      }
    };
    
    const returns = simulateReturns();
    
    return {
      price: 100 + Math.random() * 10,
      ...returns,
      volatility5d: returns.volatility1d * 0.9,
      volatility20d: returns.volatility1d * 0.8,
      volumeRatio1d: 1 + (Math.random() - 0.5) * 0.6,
      volumeRatio5d: 1 + (Math.random() - 0.5) * 0.4,
      atr14: 2 + Math.random() * 2,
      bbWidth: 0.5 + Math.random() * 0.8,
      macdHistogram: returns.returns5d * 10,
      advanceDeclineRatio: 1 + returns.returns1d * 10,
      marketCap: 1000000000 * (1 + returns.returns20d)
    };
  }
} 