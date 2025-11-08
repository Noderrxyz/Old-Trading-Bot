import { MarketRegimeState } from '../market/types/market.types.js';
import { RegimeDetectionEngine } from '../market/regime_detection_engine.js';
import { TrustScoreEngine } from '../trust/trust_score_engine.js';
import { logger } from '../utils/logger.js';

// Create a logger for this module
const log = {
  info: (msg: string, ...args: any[]) => logger.info(`[AlphaResilienceEngine] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => logger.error(`[AlphaResilienceEngine] ${msg}`, ...args)
};

/**
 * Configuration for the Alpha Resilience Engine
 */
export interface AlphaResilienceConfig {
  enabled: boolean;
  checkIntervalMs: number;
  repairThreshold: number;
  trustBoostAmount: number;
  maxTrustBoost: number;
  regimeSpecificBoosts: Record<MarketRegimeState, number>;
  minConfidence: number;
  maxRepairsPerDay: number;
}

/**
 * Default configuration for the Alpha Resilience Engine
 */
export const DEFAULT_ALPHA_RESILIENCE_CONFIG: AlphaResilienceConfig = {
  enabled: true,
  checkIntervalMs: 60000, // 1 minute
  repairThreshold: 0.3, // 30% performance drop
  trustBoostAmount: 0.1, // 10% boost
  maxTrustBoost: 0.5, // Maximum 50% boost
  regimeSpecificBoosts: {
    [MarketRegimeState.Unknown]: 0.1,
    [MarketRegimeState.Bull]: 0.15,
    [MarketRegimeState.Bear]: 0.2,
    [MarketRegimeState.Sideways]: 0.1,
    [MarketRegimeState.Volatile]: 0.25
  },
  minConfidence: 0.7,
  maxRepairsPerDay: 3
};

/**
 * Metrics for tracking repair attempts
 */
interface RepairMetrics {
  lastRepairTime: number;
  repairsToday: number;
  totalRepairs: number;
  lastRegime: MarketRegimeState;
}

/**
 * Alpha Resilience Engine class
 */
export class AlphaResilienceEngine {
  private static instance: AlphaResilienceEngine | null = null;
  private config: AlphaResilienceConfig;
  private metrics: RepairMetrics;
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  private constructor() {
    this.config = DEFAULT_ALPHA_RESILIENCE_CONFIG;
    this.metrics = {
      lastRepairTime: 0,
      repairsToday: 0,
      totalRepairs: 0,
      lastRegime: MarketRegimeState.Unknown
    };
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): AlphaResilienceEngine {
    if (!AlphaResilienceEngine.instance) {
      AlphaResilienceEngine.instance = new AlphaResilienceEngine();
    }
    return AlphaResilienceEngine.instance;
  }

  /**
   * Start the resilience engine
   */
  public start(): void {
    if (!this.config.enabled) {
      log.info('Alpha Resilience Engine is disabled');
      return;
    }

    if (this.isRunning) {
      log.info('Alpha Resilience Engine is already running');
      return;
    }

    this.isRunning = true;
    this.checkInterval = setInterval(() => this.checkAndRepair(), this.config.checkIntervalMs);
    log.info('Alpha Resilience Engine started');
  }

  /**
   * Stop the resilience engine
   */
  public stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    log.info('Alpha Resilience Engine stopped');
  }

  /**
   * Check if repair is needed and apply if necessary
   */
  private async checkAndRepair(): Promise<void> {
    try {
      const currentRegime = RegimeDetectionEngine.getInstance().getCurrentRegime();
      const confidence = RegimeDetectionEngine.getInstance().getRegimeConfidence();

      // Check if we need to reset daily repairs
      this.resetDailyRepairsIfNeeded();

      // Check if we can perform a repair
      if (!this.canPerformRepair(currentRegime, confidence)) {
        return;
      }

      // Calculate trust boost based on regime
      const boostAmount = this.calculateRegimeSpecificBoost(currentRegime);

      // Apply trust boost
      await this.applyTrustBoost(boostAmount);

      // Update metrics
      this.updateRepairMetrics(currentRegime);

      log.info(`Applied trust boost of ${boostAmount} in ${currentRegime} regime`);
    } catch (error) {
      log.error('Error in checkAndRepair:', error);
    }
  }

  /**
   * Check if a repair can be performed
   */
  private canPerformRepair(
    currentRegime: MarketRegimeState,
    confidence: number
  ): boolean {
    // Check if we've hit the daily repair limit
    if (this.metrics.repairsToday >= this.config.maxRepairsPerDay) {
      return false;
    }

    // Check if confidence is high enough
    if (confidence < this.config.minConfidence) {
      return false;
    }

    // Check if enough time has passed since last repair
    const timeSinceLastRepair = Date.now() - this.metrics.lastRepairTime;
    if (timeSinceLastRepair < this.config.checkIntervalMs) {
      return false;
    }

    return true;
  }

  /**
   * Calculate regime-specific boost amount
   */
  private calculateRegimeSpecificBoost(regime: MarketRegimeState): number {
    const baseBoost = this.config.trustBoostAmount;
    const regimeBoost = this.config.regimeSpecificBoosts[regime];
    return Math.min(baseBoost + regimeBoost, this.config.maxTrustBoost);
  }

  /**
   * Apply trust boost to the system
   */
  private async applyTrustBoost(boostAmount: number): Promise<void> {
    const trustEngine = TrustScoreEngine.getInstance();
    
    // Update agent metrics with the boost
    trustEngine.updateAgentMetrics(
      'system', // Use 'system' as the agent ID for global boosts
      boostAmount, // alphaScore
      0, // drawdownScore
      0  // riskAdjustedReturnScore
    );
  }

  /**
   * Update repair metrics after a successful repair
   */
  private updateRepairMetrics(currentRegime: MarketRegimeState): void {
    this.metrics.lastRepairTime = Date.now();
    this.metrics.repairsToday++;
    this.metrics.totalRepairs++;
    this.metrics.lastRegime = currentRegime;
  }

  /**
   * Reset daily repairs if needed
   */
  private resetDailyRepairsIfNeeded(): void {
    const now = new Date();
    const lastRepairDate = new Date(this.metrics.lastRepairTime);
    
    if (
      now.getDate() !== lastRepairDate.getDate() ||
      now.getMonth() !== lastRepairDate.getMonth() ||
      now.getFullYear() !== lastRepairDate.getFullYear()
    ) {
      this.metrics.repairsToday = 0;
    }
  }
} 