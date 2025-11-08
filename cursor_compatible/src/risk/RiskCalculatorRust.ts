import { NapiRiskCalculator, RiskConfigParams, PositionExposureParams } from '@noderr/core';
import { logger } from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';

/**
 * Risk configuration for the Rust-powered risk calculator
 */
export interface RiskConfig {
  maxPositionSizePct: number;
  maxLeverage: number;
  maxDrawdownPct: number;
  minTrustScore: number;
  maxExposurePerSymbol: number;
  maxExposurePerVenue: number;
  exemptStrategies: string[];
  fastRiskMode: boolean;
}

/**
 * Default risk configuration
 */
export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxPositionSizePct: 0.1, // 10% of portfolio
  maxLeverage: 3,
  maxDrawdownPct: 0.2, // 20% max drawdown
  minTrustScore: 0.7,
  maxExposurePerSymbol: 0.3, // 30% of portfolio per symbol
  maxExposurePerVenue: 0.4, // 40% of portfolio per venue
  exemptStrategies: [],
  fastRiskMode: true
};

/**
 * Position direction enum
 */
export enum PositionDirection {
  Long = 'long',
  Short = 'short',
  None = 'none'
}

/**
 * Position exposure interface
 */
export interface PositionExposure {
  symbol: string;
  venue: string;
  size: number;
  value: number;
  leverage: number;
  trustScore: number;
  direction: PositionDirection;
}

/**
 * Risk violation type enum
 */
export enum RiskViolationType {
  PositionSize = 'position_size',
  Leverage = 'leverage',
  TrustScore = 'trust_score',
  VenueExposure = 'venue_exposure',
  SymbolExposure = 'symbol_exposure',
  DrawdownLimit = 'drawdown_limit'
}

/**
 * Risk violation interface
 */
export interface RiskViolation {
  type: RiskViolationType;
  message: string;
  details: Record<string, any>;
  timestamp: number;
}

/**
 * Risk check result interface
 */
export interface RiskCheckResult {
  allowed: boolean;
  violations: RiskViolation[];
}

/**
 * Rust-powered Risk Calculator for high-performance risk management
 */
export class RiskCalculatorRust {
  private static instance: RiskCalculatorRust;
  private calculator: NapiRiskCalculator;
  private telemetryBus: TelemetryBus;
  private config: RiskConfig;
  private portfolioValue: number;

  private constructor(config: Partial<RiskConfig> = {}, portfolioValue: number = 0) {
    this.config = { ...DEFAULT_RISK_CONFIG, ...config };
    this.portfolioValue = portfolioValue;
    this.telemetryBus = TelemetryBus.getInstance();
    
    // Initialize Rust risk calculator with config
    const riskConfig: RiskConfigParams = {
      max_position_size_pct: this.config.maxPositionSizePct,
      max_leverage: this.config.maxLeverage,
      max_drawdown_pct: this.config.maxDrawdownPct,
      min_trust_score: this.config.minTrustScore,
      max_exposure_per_symbol: this.config.maxExposurePerSymbol,
      max_exposure_per_venue: this.config.maxExposurePerVenue,
      exempt_strategies: this.config.exemptStrategies,
      fast_risk_mode: this.config.fastRiskMode
    };
    
    this.calculator = new NapiRiskCalculator(riskConfig, this.portfolioValue);
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<RiskConfig>, portfolioValue?: number): RiskCalculatorRust {
    if (!RiskCalculatorRust.instance) {
      RiskCalculatorRust.instance = new RiskCalculatorRust(config, portfolioValue);
    }
    return RiskCalculatorRust.instance;
  }

  /**
   * Update portfolio value
   * @param value New portfolio value
   */
  public async updatePortfolioValue(value: number): Promise<void> {
    this.portfolioValue = value;
    await this.calculator.update_portfolio_value(value);
    this.telemetryBus.emit('portfolio_value_update', { value });
  }

  /**
   * Validate position against risk parameters
   * @param position Position to validate
   * @returns Whether position is allowed
   */
  public async validatePosition(position: PositionExposure): Promise<boolean> {
    try {
      const posParams: PositionExposureParams = {
        symbol: position.symbol,
        venue: position.venue,
        size: position.size,
        value: position.value,
        leverage: position.leverage,
        trust_score: position.trustScore,
        direction: position.direction
      };
      
      return await this.calculator.validate_position(posParams);
    } catch (error) {
      logger.error(`[RiskCalculatorRust] Error validating position: ${error}`);
      return false; // Default to rejecting position on error
    }
  }

  /**
   * Perform fast risk check (immediate with detailed results)
   * @param position Position to check
   * @param strategyId Optional strategy ID
   * @returns Detailed risk check result
   */
  public async fastRiskCheck(
    position: PositionExposure, 
    strategyId?: string
  ): Promise<RiskCheckResult> {
    try {
      const posParams: PositionExposureParams = {
        symbol: position.symbol,
        venue: position.venue,
        size: position.size,
        value: position.value,
        leverage: position.leverage,
        trust_score: position.trustScore,
        direction: position.direction
      };
      
      const result = await this.calculator.fast_risk_check(posParams, strategyId);
      
      // Convert results from Rust format to TypeScript format
      const checkResult: RiskCheckResult = {
        allowed: result.allowed,
        violations: result.violations.map((v: any) => ({
          type: v.type as RiskViolationType,
          message: v.message,
          details: v.details || {},
          timestamp: v.timestamp || Date.now()
        }))
      };
      
      return checkResult;
    } catch (error) {
      logger.error(`[RiskCalculatorRust] Error in fast risk check: ${error}`);
      return {
        allowed: false,
        violations: [{
          type: RiskViolationType.PositionSize,
          message: `Error performing risk check: ${error}`,
          details: {},
          timestamp: Date.now()
        }]
      };
    }
  }

  /**
   * Get symbol exposure
   * @param symbol Symbol to get exposure for
   * @returns Exposure as percentage of portfolio
   */
  public async getSymbolExposure(symbol: string): Promise<number> {
    try {
      return await this.calculator.get_symbol_exposure(symbol);
    } catch (error) {
      logger.error(`[RiskCalculatorRust] Error getting symbol exposure: ${error}`);
      return 0;
    }
  }

  /**
   * Set trust score for a venue
   * @param venue Venue to set trust score for
   * @param score Trust score (0.0-1.0)
   */
  public async setTrustScore(venue: string, score: number): Promise<void> {
    try {
      await this.calculator.set_trust_score(venue, score);
    } catch (error) {
      logger.error(`[RiskCalculatorRust] Error setting trust score: ${error}`);
    }
  }
} 