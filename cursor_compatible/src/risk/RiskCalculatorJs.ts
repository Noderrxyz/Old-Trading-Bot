import { logger } from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';
import { telemetry } from '../telemetry';
import { SeverityLevel } from '../telemetry/types';

/**
 * Risk configuration for the JavaScript fallback risk calculator
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
 * JavaScript fallback implementation of RiskCalculator
 */
export class RiskCalculatorJs {
  private static instance: RiskCalculatorJs;
  private telemetryBus: TelemetryBus;
  private config: RiskConfig;
  private portfolioValue: number;
  private symbolExposures: Map<string, number> = new Map();
  private venueExposures: Map<string, number> = new Map();
  private trustScores: Map<string, number> = new Map();
  private positions: Map<string, PositionExposure> = new Map();

  private constructor(config: Partial<RiskConfig> = {}, portfolioValue: number = 0) {
    this.config = { ...DEFAULT_RISK_CONFIG, ...config };
    this.portfolioValue = portfolioValue;
    this.telemetryBus = TelemetryBus.getInstance();
    
    telemetry.recordMetric('risk_calculator.initialization', 1, {
      implementation: 'javascript'
    });
    
    logger.info('Initialized JavaScript fallback RiskCalculator');
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<RiskConfig>, portfolioValue?: number): RiskCalculatorJs {
    if (!RiskCalculatorJs.instance) {
      RiskCalculatorJs.instance = new RiskCalculatorJs(config, portfolioValue);
    }
    return RiskCalculatorJs.instance;
  }

  /**
   * Update portfolio value
   * @param value New portfolio value
   */
  public async updatePortfolioValue(value: number): Promise<void> {
    this.portfolioValue = value;
    this.telemetryBus.emit('portfolio_value_update', { value });
    telemetry.recordMetric('risk_calculator.portfolio_update', value, {
      implementation: 'javascript'
    });
  }

  /**
   * Validate position against risk parameters
   * @param position Position to validate
   * @returns Whether position is allowed
   */
  public async validatePosition(position: PositionExposure): Promise<boolean> {
    try {
      const startTime = performance.now();
      
      // Validate position data
      if (!position.symbol) {
        throw new Error('Position symbol is required');
      }
      
      if (!position.venue) {
        throw new Error('Position venue is required');
      }
      
      if (position.value <= 0) {
        throw new Error(`Invalid position value: ${position.value}`);
      }
      
      if (position.leverage <= 0) {
        throw new Error(`Invalid leverage: ${position.leverage}`);
      }
      
      // Get current exposure for this symbol
      const symbolExposure = this.symbolExposures.get(position.symbol) || 0;
      const venueExposure = this.venueExposures.get(position.venue) || 0;
      
      // Check position size
      const positionSizePct = position.value / this.portfolioValue;
      const positionSizeAllowed = positionSizePct <= this.config.maxPositionSizePct;
      
      telemetry.recordMetric('risk_calculator.position_size_check', positionSizePct, {
        symbol: position.symbol,
        venue: position.venue,
        allowed: positionSizeAllowed.toString(),
        implementation: 'javascript'
      });
      
      if (!positionSizeAllowed) {
        telemetry.recordEvent(
          'position_size_violation',
          'RiskCalculatorJs',
          {
            symbol: position.symbol,
            venue: position.venue,
            implementation: 'javascript'
          },
          {
            position_size_pct: positionSizePct,
            max_allowed_pct: this.config.maxPositionSizePct,
            position_value: position.value,
            portfolio_value: this.portfolioValue
          }
        );
        return false;
      }
      
      // Check leverage
      const leverageAllowed = position.leverage <= this.config.maxLeverage;
      
      telemetry.recordMetric('risk_calculator.leverage_check', position.leverage, {
        symbol: position.symbol,
        venue: position.venue,
        allowed: leverageAllowed.toString(),
        implementation: 'javascript'
      });
      
      if (!leverageAllowed) {
        telemetry.recordEvent(
          'leverage_violation',
          'RiskCalculatorJs',
          {
            symbol: position.symbol,
            venue: position.venue,
            implementation: 'javascript'
          },
          {
            leverage: position.leverage,
            max_allowed: this.config.maxLeverage,
            position_value: position.value
          }
        );
        return false;
      }
      
      // Check trust score
      const trustScoreAllowed = position.trustScore >= this.config.minTrustScore;
      
      telemetry.recordMetric('risk_calculator.trust_score_check', position.trustScore, {
        symbol: position.symbol,
        venue: position.venue,
        allowed: trustScoreAllowed.toString(),
        implementation: 'javascript'
      });
      
      if (!trustScoreAllowed) {
        telemetry.recordEvent(
          'trust_score_violation',
          'RiskCalculatorJs',
          {
            symbol: position.symbol,
            venue: position.venue,
            implementation: 'javascript'
          },
          {
            trust_score: position.trustScore,
            min_required: this.config.minTrustScore
          }
        );
        return false;
      }
      
      // Check symbol exposure
      const newSymbolExposure = symbolExposure + position.value;
      const maxSymbolExposure = this.config.maxExposurePerSymbol * this.portfolioValue;
      const symbolExposureAllowed = newSymbolExposure <= maxSymbolExposure;
      
      telemetry.recordMetric('risk_calculator.symbol_exposure_check', newSymbolExposure / this.portfolioValue, {
        symbol: position.symbol,
        allowed: symbolExposureAllowed.toString(),
        implementation: 'javascript'
      });
      
      if (!symbolExposureAllowed) {
        telemetry.recordEvent(
          'symbol_exposure_violation',
          'RiskCalculatorJs',
          {
            symbol: position.symbol,
            implementation: 'javascript'
          },
          {
            current_exposure: symbolExposure,
            new_exposure: newSymbolExposure,
            max_allowed: maxSymbolExposure,
            portfolio_value: this.portfolioValue
          }
        );
        return false;
      }
      
      // Check venue exposure
      const newVenueExposure = venueExposure + position.value;
      const maxVenueExposure = this.config.maxExposurePerVenue * this.portfolioValue;
      const venueExposureAllowed = newVenueExposure <= maxVenueExposure;
      
      telemetry.recordMetric('risk_calculator.venue_exposure_check', newVenueExposure / this.portfolioValue, {
        venue: position.venue,
        allowed: venueExposureAllowed.toString(),
        implementation: 'javascript'
      });
      
      if (!venueExposureAllowed) {
        telemetry.recordEvent(
          'venue_exposure_violation',
          'RiskCalculatorJs',
          {
            venue: position.venue,
            implementation: 'javascript'
          },
          {
            current_exposure: venueExposure,
            new_exposure: newVenueExposure,
            max_allowed: maxVenueExposure,
            portfolio_value: this.portfolioValue
          }
        );
        return false;
      }
      
      const endTime = performance.now();
      telemetry.recordMetric('risk_calculator.validation_time', endTime - startTime, {
        symbol: position.symbol,
        venue: position.venue,
        implementation: 'javascript'
      });
      
      // All checks passed
      return true;
    } catch (error) {
      logger.error(`[RiskCalculatorJs] Error validating position: ${error}`, {
        symbol: position?.symbol,
        venue: position?.venue,
        error_stack: (error as Error).stack
      });
      
      telemetry.recordError(
        'RiskCalculatorJs',
        `Error validating position: ${error}`,
        SeverityLevel.ERROR,
        { 
          method: 'validatePosition',
          symbol: position?.symbol || 'unknown',
          venue: position?.venue || 'unknown',
          error_type: (error as Error).name,
          stack: (error as Error).stack || '',
          position_data: JSON.stringify({
            value: position?.value,
            leverage: position?.leverage,
            direction: position?.direction
          })
        }
      );
      
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
      const startTime = performance.now();
      
      // Validate position data
      if (!position.symbol) {
        throw new Error('Position symbol is required');
      }
      
      if (!position.venue) {
        throw new Error('Position venue is required');
      }
      
      if (position.value <= 0) {
        throw new Error(`Invalid position value: ${position.value}`);
      }
      
      if (position.leverage <= 0) {
        throw new Error(`Invalid leverage: ${position.leverage}`);
      }
      
      const violations: RiskViolation[] = [];
      const symbolExposure = this.symbolExposures.get(position.symbol) || 0;
      const venueExposure = this.venueExposures.get(position.venue) || 0;
      
      // Check if strategy is exempt
      if (strategyId && this.config.exemptStrategies.includes(strategyId)) {
        telemetry.recordMetric('risk_calculator.exempt_strategy', 1, {
          strategy_id: strategyId,
          symbol: position.symbol,
          implementation: 'javascript'
        });
        
        return { allowed: true, violations: [] };
      }
      
      // Check position size
      const positionSizePct = position.value / this.portfolioValue;
      if (positionSizePct > this.config.maxPositionSizePct) {
        violations.push({
          type: RiskViolationType.PositionSize,
          message: `Position size (${(positionSizePct * 100).toFixed(2)}%) exceeds max (${(this.config.maxPositionSizePct * 100).toFixed(2)}%)`,
          details: {
            allowed: this.config.maxPositionSizePct,
            actual: positionSizePct,
            portfolioValue: this.portfolioValue,
            positionValue: position.value
          },
          timestamp: Date.now()
        });
        
        telemetry.recordMetric('risk_calculator.position_size_violation', positionSizePct, {
          symbol: position.symbol,
          venue: position.venue,
          implementation: 'javascript'
        });
      }
      
      // Check leverage
      if (position.leverage > this.config.maxLeverage) {
        violations.push({
          type: RiskViolationType.Leverage,
          message: `Leverage (${position.leverage}x) exceeds max (${this.config.maxLeverage}x)`,
          details: {
            allowed: this.config.maxLeverage,
            actual: position.leverage
          },
          timestamp: Date.now()
        });
        
        telemetry.recordMetric('risk_calculator.leverage_violation', position.leverage, {
          symbol: position.symbol,
          venue: position.venue,
          implementation: 'javascript'
        });
      }
      
      // Check trust score
      if (position.trustScore < this.config.minTrustScore) {
        violations.push({
          type: RiskViolationType.TrustScore,
          message: `Trust score (${position.trustScore.toFixed(2)}) below minimum (${this.config.minTrustScore.toFixed(2)})`,
          details: {
            required: this.config.minTrustScore,
            actual: position.trustScore,
            venue: position.venue
          },
          timestamp: Date.now()
        });
        
        telemetry.recordMetric('risk_calculator.trust_score_violation', position.trustScore, {
          symbol: position.symbol,
          venue: position.venue,
          implementation: 'javascript'
        });
      }
      
      // Check symbol exposure
      const newSymbolExposure = symbolExposure + position.value;
      const maxSymbolExposure = this.config.maxExposurePerSymbol * this.portfolioValue;
      if (newSymbolExposure > maxSymbolExposure) {
        violations.push({
          type: RiskViolationType.SymbolExposure,
          message: `Symbol exposure (${(newSymbolExposure / this.portfolioValue * 100).toFixed(2)}%) exceeds max (${(this.config.maxExposurePerSymbol * 100).toFixed(2)}%)`,
          details: {
            allowed: maxSymbolExposure,
            current: symbolExposure,
            new: newSymbolExposure,
            symbol: position.symbol
          },
          timestamp: Date.now()
        });
        
        telemetry.recordMetric('risk_calculator.symbol_exposure_violation', newSymbolExposure / this.portfolioValue, {
          symbol: position.symbol,
          implementation: 'javascript'
        });
      }
      
      // Check venue exposure
      const newVenueExposure = venueExposure + position.value;
      const maxVenueExposure = this.config.maxExposurePerVenue * this.portfolioValue;
      if (newVenueExposure > maxVenueExposure) {
        violations.push({
          type: RiskViolationType.VenueExposure,
          message: `Venue exposure (${(newVenueExposure / this.portfolioValue * 100).toFixed(2)}%) exceeds max (${(this.config.maxExposurePerVenue * 100).toFixed(2)}%)`,
          details: {
            allowed: maxVenueExposure,
            current: venueExposure,
            new: newVenueExposure,
            venue: position.venue
          },
          timestamp: Date.now()
        });
        
        telemetry.recordMetric('risk_calculator.venue_exposure_violation', newVenueExposure / this.portfolioValue, {
          venue: position.venue,
          implementation: 'javascript'
        });
      }
      
      const endTime = performance.now();
      const execTimeMs = endTime - startTime;
      
      // Record overall check results
      telemetry.recordMetric('risk_calculator.check_time', execTimeMs, {
        implementation: 'javascript',
        symbol: position.symbol,
        violations_count: violations.length.toString()
      });
      
      // If violations found, record a comprehensive event
      if (violations.length > 0) {
        telemetry.recordEvent(
          'risk_check_violations',
          'RiskCalculatorJs',
          {
            symbol: position.symbol,
            venue: position.venue,
            violations_count: violations.length.toString(),
            implementation: 'javascript'
          },
          {
            violations_types: violations.map(v => v.type),
            position_value: position.value,
            portfolio_value: this.portfolioValue,
            strategy_id: strategyId || 'none'
          }
        );
      }
      
      return {
        allowed: violations.length === 0,
        violations
      };
    } catch (error) {
      logger.error(`[RiskCalculatorJs] Error in fast risk check: ${error}`, {
        symbol: position?.symbol,
        venue: position?.venue,
        error_stack: (error as Error).stack
      });
      
      telemetry.recordError(
        'RiskCalculatorJs',
        `Error in fast risk check: ${error}`,
        SeverityLevel.ERROR,
        { 
          method: 'fastRiskCheck',
          symbol: position?.symbol || 'unknown',
          venue: position?.venue || 'unknown',
          strategy_id: strategyId || 'none',
          error_type: (error as Error).name,
          stack: (error as Error).stack || '',
          position_data: JSON.stringify({
            value: position?.value,
            leverage: position?.leverage,
            direction: position?.direction
          })
        }
      );
      
      // Create a violation for the error
      return {
        allowed: false,
        violations: [{
          type: RiskViolationType.PositionSize,
          message: `Error performing risk check: ${error}`,
          details: { 
            error: String(error),
            error_type: (error as Error).name
          },
          timestamp: Date.now()
        }]
      };
    }
  }

  /**
   * Get current symbol exposure
   * @param symbol Symbol to check
   * @returns Exposure amount
   */
  public async getSymbolExposure(symbol: string): Promise<number> {
    return this.symbolExposures.get(symbol) || 0;
  }

  /**
   * Set trust score for a venue
   * @param venue Venue
   * @param score Trust score (0-1)
   */
  public async setTrustScore(venue: string, score: number): Promise<void> {
    this.trustScores.set(venue, Math.max(0, Math.min(1, score)));
    telemetry.recordMetric('risk_calculator.trust_score', score, {
      venue,
      implementation: 'javascript'
    });
  }
} 