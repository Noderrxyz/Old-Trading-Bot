/**
 * Regime-Adaptive Genome Controller
 * 
 * Adapts strategy evolution based on detected market regimes (bull, bear, chop).
 * Controls mutation intensity, crossover behavior, and generation pacing.
 */

import logger from '../utils/logger.js';
import { MarketRegimeState } from '../market/types/market.types.js';
import { TradingStrategy } from '../strategy/trading_strategy.js';

/**
 * Configuration for regime-adaptive genome control
 */
export interface RegimeAdaptiveConfig {
  enabled: boolean;
  mutationIntensity: {
    bull: number;  // 0.0-1.0
    bear: number;
    chop: number;
  };
  crossoverBias: {
    bull: number;  // 0.0-1.0
    bear: number;
    chop: number;
  };
  generationPacing: {
    bull: number;  // Days
    bear: number;
    chop: number;
  };
  updateIntervalMs: number;
}

/**
 * Default configuration
 */
export const DEFAULT_REGIME_ADAPTIVE_CONFIG: RegimeAdaptiveConfig = {
  enabled: true,
  mutationIntensity: {
    bull: 0.3,    // Mild mutations in bull markets
    bear: 0.5,    // Moderate mutations in bear markets
    chop: 0.7     // Aggressive mutations in choppy markets
  },
  crossoverBias: {
    bull: 0.8,    // Strong bias towards top performers
    bear: 0.6,    // Moderate bias towards defensive strategies
    chop: 0.4     // More random crossover in choppy markets
  },
  generationPacing: {
    bull: 7,      // Weekly generations in bull markets
    bear: 3,      // Faster generations in bear markets
    chop: 5       // Medium pacing in choppy markets
  },
  updateIntervalMs: 3600000 // 1 hour
};

/**
 * Regime-Adaptive Genome Controller class
 */
export class RegimeAdaptiveGenomeController {
  private static instance: RegimeAdaptiveGenomeController | null = null;
  private config: RegimeAdaptiveConfig;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => logger.debug(`[RegimeAdaptiveGenomeController] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => logger.info(`[RegimeAdaptiveGenomeController] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => logger.warn(`[RegimeAdaptiveGenomeController] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => logger.error(`[RegimeAdaptiveGenomeController] ${msg}`, ...args)
  };
  private currentRegime: MarketRegimeState;
  private lastUpdate: number;
  private updateInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * Get singleton instance
   */
  public static getInstance(): RegimeAdaptiveGenomeController {
    if (!RegimeAdaptiveGenomeController.instance) {
      RegimeAdaptiveGenomeController.instance = new RegimeAdaptiveGenomeController();
    }
    return RegimeAdaptiveGenomeController.instance;
  }

  private constructor(config: Partial<RegimeAdaptiveConfig> = {}) {
    this.config = { ...DEFAULT_REGIME_ADAPTIVE_CONFIG, ...config };
    this.currentRegime = MarketRegimeState.Unknown;
    this.lastUpdate = Date.now();
  }

  /**
   * Start the controller
   */
  public start(): void {
    if (!this.config.enabled) {
      this.logger.warn('Regime-adaptive genome control is disabled');
      return;
    }

    if (this.isRunning) {
      this.logger.warn('Regime-adaptive genome controller is already running');
      return;
    }

    this.isRunning = true;
    this.updateInterval = setInterval(() => this.update(), this.config.updateIntervalMs);
    this.logger.info('Regime-adaptive genome controller started');
  }

  /**
   * Stop the controller
   */
  public stop(): void {
    if (!this.isRunning) return;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    this.isRunning = false;
    this.logger.info('Regime-adaptive genome controller stopped');
  }

  /**
   * Update current regime
   */
  public setRegimeMode(regime: MarketRegimeState): void {
    if (this.currentRegime !== regime) {
      this.logger.info(`Market regime changed: ${this.currentRegime} -> ${regime}`);
      this.currentRegime = regime;
      this.lastUpdate = Date.now();
    }
  }

  /**
   * Get current mutation intensity based on regime
   */
  public getMutationIntensity(): number {
    switch (this.currentRegime) {
      case MarketRegimeState.Bull:
        return this.config.mutationIntensity.bull;
      case MarketRegimeState.Bear:
        return this.config.mutationIntensity.bear;
      case MarketRegimeState.Sideways:
        return this.config.mutationIntensity.chop;
      default:
        return 0.5; // Default intensity for unknown regime
    }
  }

  /**
   * Get current crossover bias based on regime
   */
  public getCrossoverBias(): number {
    switch (this.currentRegime) {
      case MarketRegimeState.Bull:
        return this.config.crossoverBias.bull;
      case MarketRegimeState.Bear:
        return this.config.crossoverBias.bear;
      case MarketRegimeState.Sideways:
        return this.config.crossoverBias.chop;
      default:
        return 0.5; // Default bias for unknown regime
    }
  }

  /**
   * Get current generation pacing based on regime
   */
  public getGenerationPacing(): number {
    switch (this.currentRegime) {
      case MarketRegimeState.Bull:
        return this.config.generationPacing.bull;
      case MarketRegimeState.Bear:
        return this.config.generationPacing.bear;
      case MarketRegimeState.Sideways:
        return this.config.generationPacing.chop;
      default:
        return 5; // Default pacing for unknown regime
    }
  }

  /**
   * Adjust mutation parameters for a strategy based on regime
   */
  public adjustStrategyMutation(strategy: TradingStrategy): void {
    const intensity = this.getMutationIntensity();
    
    // Adjust strategy parameters based on regime
    const params = strategy.parameters;
    
    switch (this.currentRegime) {
      case MarketRegimeState.Bull:
        // In bull markets, preserve aggressive parameters
        params.aggression = Math.min(params.aggression * (1 + intensity * 0.1), 1.0);
        params.riskTolerance = Math.min(params.riskTolerance * (1 + intensity * 0.1), 1.0);
        break;
        
      case MarketRegimeState.Bear:
        // In bear markets, increase defensive parameters
        params.defense = Math.min(params.defense * (1 + intensity * 0.2), 1.0);
        params.riskTolerance = Math.max(params.riskTolerance * (1 - intensity * 0.2), 0.1);
        break;
        
      case MarketRegimeState.Sideways:
        // In choppy markets, increase adaptability
        params.adaptability = Math.min(params.adaptability * (1 + intensity * 0.3), 1.0);
        params.volatilityTolerance = Math.min(params.volatilityTolerance * (1 + intensity * 0.2), 1.0);
        break;
    }
    
    this.logger.debug(`Adjusted strategy ${strategy.id} mutation parameters for ${this.currentRegime} regime`);
  }

  /**
   * Update controller state
   */
  private update(): void {
    if (!this.config.enabled || !this.isRunning) return;

    // Log current regime and parameters
    this.logger.debug(
      `Current regime: ${this.currentRegime}, ` +
      `Mutation intensity: ${this.getMutationIntensity().toFixed(2)}, ` +
      `Crossover bias: ${this.getCrossoverBias().toFixed(2)}, ` +
      `Generation pacing: ${this.getGenerationPacing()} days`
    );
  }

  /**
   * Reset controller state
   */
  public reset(): void {
    this.currentRegime = MarketRegimeState.Unknown;
    this.lastUpdate = Date.now();
    this.logger.info('Regime-adaptive genome controller reset');
  }
} 