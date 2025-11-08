/**
 * Risk-Aware Execution Modulator
 * 
 * Adapts trade execution parameters based on contextual risk scores
 * to optimize execution quality and minimize adverse selection.
 */

import { FusedAlphaFrame } from '../alphasources/fusion-engine.js';
import { RiskScore, RiskTier } from '../risk/risk.types.js';
import { createLogger } from '../common/logger.js';

/**
 * Execution parameters that can be modulated based on risk
 */
export interface ExecutionParameters {
  /** Position size multiplier (0-1) */
  sizeMultiplier: number;
  
  /** Maximum slippage tolerance in basis points */
  maxSlippageBps: number;
  
  /** Time-in-force setting in seconds */
  timeInForceSec: number;
  
  /** Cancel-if-not-filled timeout in seconds */
  cancelTimeoutSec: number;
  
  /** Additional metadata for audit/review */
  metadata: {
    originalSize: number;
    originalSlippageBps: number;
    riskTier: RiskTier;
    riskScore: number;
  };
}

/**
 * Configuration for risk-based execution modulation
 */
export interface RiskModulationConfig {
  /** Whether risk modulation is enabled */
  enabled: boolean;
  
  /** Parameters for safe trades (score > 0.8) */
  safe: {
    sizeMultiplier: number;
    slippageMultiplier: number;
    cancelTimeoutSec: number;
  };
  
  /** Parameters for cautious trades (0.5 < score <= 0.8) */
  cautious: {
    sizeMultiplier: number;
    slippageMultiplier: number;
    cancelTimeoutSec: number;
  };
  
  /** Parameters for risky trades (score <= 0.5) */
  risky: {
    sizeMultiplier: number;
    slippageMultiplier: number;
    cancelTimeoutSec: number;
  };
}

/**
 * Default configuration for risk modulation
 */
export const DEFAULT_RISK_MODULATION_CONFIG: RiskModulationConfig = {
  enabled: true,
  safe: {
    sizeMultiplier: 1.0,
    slippageMultiplier: 1.0,
    cancelTimeoutSec: 30
  },
  cautious: {
    sizeMultiplier: 0.6,
    slippageMultiplier: 0.8,
    cancelTimeoutSec: 15
  },
  risky: {
    sizeMultiplier: 0.3,
    slippageMultiplier: 0.5,
    cancelTimeoutSec: 5
  }
};

/**
 * Modulates execution parameters based on risk scores
 */
export class RiskExecutionModulator {
  private readonly logger = createLogger('RiskExecutionModulator');
  private readonly config: RiskModulationConfig;
  
  /**
   * Create a new risk execution modulator
   * @param config Optional configuration override
   */
  constructor(config: Partial<RiskModulationConfig> = {}) {
    this.config = { ...DEFAULT_RISK_MODULATION_CONFIG, ...config };
    
    if (!this.config.enabled) {
      this.logger.warn('Risk-based execution modulation is disabled');
    } else {
      this.logger.info('Risk execution modulator initialized');
    }
  }
  
  /**
   * Modulate execution parameters based on risk score
   * @param signal Original alpha signal
   * @param riskScore Risk assessment for the signal
   * @returns Modulated execution parameters
   */
  public modulateExecution(
    signal: FusedAlphaFrame,
    riskScore: RiskScore
  ): ExecutionParameters {
    if (!this.config.enabled) {
      return this.createDefaultParameters(signal, riskScore);
    }
    
    try {
      // Get base parameters based on risk tier
      const baseParams = this.getBaseParameters(riskScore);
      
      // Get original slippage from metrics or use default
      const originalSlippageBps = signal.details[0]?.metrics?.maxSlippageBps ?? 50;
      
      // Calculate modulated parameters
      const sizeMultiplier = baseParams.sizeMultiplier;
      const maxSlippageBps = Math.floor(originalSlippageBps * baseParams.slippageMultiplier);
      const timeInForceSec = baseParams.cancelTimeoutSec;
      const cancelTimeoutSec = baseParams.cancelTimeoutSec;
      
      // Create execution parameters
      const params: ExecutionParameters = {
        sizeMultiplier,
        maxSlippageBps,
        timeInForceSec,
        cancelTimeoutSec,
        metadata: {
          originalSize: signal.size,
          originalSlippageBps: originalSlippageBps,
          riskTier: riskScore.tier,
          riskScore: riskScore.score
        }
      };
      
      this.logger.debug(
        `Modulated execution for ${signal.symbol}: ` +
        `size ${signal.size} -> ${signal.size * sizeMultiplier}, ` +
        `slippage ${originalSlippageBps}bps -> ${maxSlippageBps}bps, ` +
        `cancel timeout ${cancelTimeoutSec}s (${riskScore.tier})`
      );
      
      return params;
    } catch (error) {
      this.logger.error(
        `Error modulating execution for ${signal.symbol}: ` +
        `${error instanceof Error ? error.message : String(error)}`
      );
      return this.createDefaultParameters(signal, riskScore);
    }
  }
  
  /**
   * Get base parameters based on risk tier
   * @param riskScore Risk score
   * @returns Base parameters for the risk tier
   */
  private getBaseParameters(riskScore: RiskScore): {
    sizeMultiplier: number;
    slippageMultiplier: number;
    cancelTimeoutSec: number;
  } {
    switch (riskScore.tier) {
      case RiskTier.SAFE:
        return this.config.safe;
      case RiskTier.CAUTIOUS:
        return this.config.cautious;
      case RiskTier.RISKY:
        return this.config.risky;
      default:
        return this.config.cautious; // Default to cautious
    }
  }
  
  /**
   * Create default parameters when modulation is disabled or fails
   * @param signal Original signal
   * @param riskScore Risk score
   * @returns Default execution parameters
   */
  private createDefaultParameters(
    signal: FusedAlphaFrame,
    riskScore: RiskScore
  ): ExecutionParameters {
    const originalSlippageBps = signal.details[0]?.metrics?.maxSlippageBps ?? 50;
    
    return {
      sizeMultiplier: 1.0,
      maxSlippageBps: originalSlippageBps,
      timeInForceSec: 30,
      cancelTimeoutSec: 30,
      metadata: {
        originalSize: signal.size,
        originalSlippageBps: originalSlippageBps,
        riskTier: riskScore.tier,
        riskScore: riskScore.score
      }
    };
  }
} 