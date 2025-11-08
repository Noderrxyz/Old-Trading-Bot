import { logger } from '../utils/logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { isPaperMode, logPaperModeCall, getSimulationConfig } from '../config/PaperModeConfig';

/**
 * MEV Protection Configuration
 */
export interface MEVProtectionConfig {
  enabled: boolean;
  antiSandwichEnabled: boolean;
  delayRandomizationEnabled: boolean;
  minDelayMs: number;
  maxDelayMs: number;
  priceImpactThreshold: number; // Threshold for MEV risk detection
  gasBufferMultiplier: number; // Gas buffer to avoid being frontrun
  maxSlippageProtection: number; // Maximum slippage protection
  bundleSubmissionEnabled: boolean; // Use private mempools/bundles
}

/**
 * MEV Risk Assessment
 */
export interface MEVRiskAssessment {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskFactors: string[];
  recommendedDelay: number;
  recommendedGasPrice: number;
  shouldUseBundles: boolean;
  priceImpactEstimate: number;
}

/**
 * MEV Protection Result
 */
export interface MEVProtectionResult {
  protected: boolean;
  strategy: string;
  delayApplied: number;
  gasPriceAdjustment: number;
  bundleUsed: boolean;
  riskMitigated: string[];
}

/**
 * MEV Protection Manager
 * Implements anti-sandwich attacks and timing randomization
 */
export class MEVProtectionManager {
  private static instance: MEVProtectionManager | null = null;
  private config: MEVProtectionConfig;
  private telemetryBus: TelemetryBus;
  private recentTransactions: Map<string, { timestamp: number; priceImpact: number }> = new Map();
  private readonly TRANSACTION_HISTORY_TTL = 300000; // 5 minutes

  private constructor(config: Partial<MEVProtectionConfig> = {}) {
    this.config = {
      enabled: true,
      antiSandwichEnabled: true,
      delayRandomizationEnabled: true,
      minDelayMs: 100,
      maxDelayMs: 5000,
      priceImpactThreshold: 0.005, // 0.5%
      gasBufferMultiplier: 1.2,
      maxSlippageProtection: 0.02, // 2%
      bundleSubmissionEnabled: true,
      ...config
    };
    
    this.telemetryBus = TelemetryBus.getInstance();
    
    // Start cleanup of old transaction history
    setInterval(() => this.cleanupTransactionHistory(), 60000); // Every minute
  }

  public static getInstance(config?: Partial<MEVProtectionConfig>): MEVProtectionManager {
    if (!MEVProtectionManager.instance) {
      MEVProtectionManager.instance = new MEVProtectionManager(config);
    }
    return MEVProtectionManager.instance;
  }

  /**
   * Assess MEV risk for a transaction
   */
  public async assessMEVRisk(
    symbol: string,
    amount: number,
    currentPrice: number,
    liquidityDepth: number
  ): Promise<MEVRiskAssessment> {
    if (!this.config.enabled) {
      return {
        riskLevel: 'low',
        riskFactors: [],
        recommendedDelay: 0,
        recommendedGasPrice: 0,
        shouldUseBundles: false,
        priceImpactEstimate: 0
      };
    }

    const riskFactors: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    
    // Calculate price impact
    const priceImpactEstimate = this.estimatePriceImpact(amount, currentPrice, liquidityDepth);
    
    // Check price impact threshold
    if (priceImpactEstimate > this.config.priceImpactThreshold) {
      riskFactors.push('High price impact detected');
      riskLevel = priceImpactEstimate > 0.02 ? 'critical' : 'high';
    }
    
    // Check recent transaction patterns
    const recentActivity = this.analyzeRecentActivity(symbol);
    if (recentActivity.suspiciousActivity) {
      riskFactors.push('Suspicious recent activity detected');
      riskLevel = this.escalateRiskLevel(riskLevel, 'medium');
    }
    
    // Check market volatility
    const volatilityRisk = await this.assessVolatilityRisk(symbol);
    if (volatilityRisk.isHigh) {
      riskFactors.push('High market volatility');
      riskLevel = this.escalateRiskLevel(riskLevel, 'medium');
    }
    
    // Calculate recommended protections
    const recommendedDelay = this.calculateOptimalDelay(riskLevel, priceImpactEstimate);
    const recommendedGasPrice = this.calculateOptimalGasPrice(riskLevel);
    const shouldUseBundles = riskLevel === 'high' || riskLevel === 'critical';
    
    const assessment: MEVRiskAssessment = {
      riskLevel,
      riskFactors,
      recommendedDelay,
      recommendedGasPrice,
      shouldUseBundles,
      priceImpactEstimate
    };
    
    // Emit telemetry
    this.telemetryBus.emit('mev_risk_assessment', {
      symbol,
      amount,
      assessment,
      timestamp: Date.now()
    });
    
    return assessment;
  }

  /**
   * Apply MEV protection to a transaction
   */
  public async applyMEVProtection(
    symbol: string,
    amount: number,
    currentPrice: number,
    liquidityDepth: number
  ): Promise<MEVProtectionResult> {
    // Check if we're in paper mode
    if (isPaperMode()) {
      return this.simulateMEVProtection(symbol, amount, currentPrice, liquidityDepth);
    }
    
    // [PRODUCTION MODE] - Real MEV protection
    const assessment = await this.assessMEVRisk(symbol, amount, currentPrice, liquidityDepth);
    
    if (!this.config.enabled || assessment.riskLevel === 'low') {
      return {
        protected: false,
        strategy: 'none',
        delayApplied: 0,
        gasPriceAdjustment: 0,
        bundleUsed: false,
        riskMitigated: []
      };
    }
    
    const riskMitigated: string[] = [];
    let delayApplied = 0;
    let gasPriceAdjustment = 0;
    let bundleUsed = false;
    let strategy = 'basic';
    
    // Apply delay randomization
    if (this.config.delayRandomizationEnabled && assessment.recommendedDelay > 0) {
      delayApplied = this.generateRandomDelay(assessment.recommendedDelay);
      riskMitigated.push('timing_randomization');
      
      if (delayApplied > 0) {
        await this.sleep(delayApplied);
      }
    }
    
    // Apply gas price adjustment
    if (assessment.recommendedGasPrice > 0) {
      gasPriceAdjustment = assessment.recommendedGasPrice;
      riskMitigated.push('gas_price_optimization');
    }
    
    // Use bundle submission for high-risk transactions
    if (this.config.bundleSubmissionEnabled && assessment.shouldUseBundles) {
      bundleUsed = true;
      strategy = 'bundle_submission';
      riskMitigated.push('private_mempool');
    }
    
    // Record transaction for pattern analysis
    this.recordTransaction(symbol, assessment.priceImpactEstimate);
    
    const result: MEVProtectionResult = {
      protected: true,
      strategy,
      delayApplied,
      gasPriceAdjustment,
      bundleUsed,
      riskMitigated
    };
    
    // Emit telemetry
    this.telemetryBus.emit('mev_protection_applied', {
      symbol,
      amount,
      result,
      assessment,
      timestamp: Date.now()
    });
    
    logger.info(`MEV protection applied for ${symbol}`, {
      strategy,
      delayApplied,
      riskLevel: assessment.riskLevel,
      riskMitigated
    });
    
    return result;
  }

  /**
   * Simulate MEV protection in paper mode
   */
  private async simulateMEVProtection(
    symbol: string,
    amount: number,
    currentPrice: number,
    liquidityDepth: number
  ): Promise<MEVProtectionResult> {
    logPaperModeCall('MEVProtectionManager', 'simulateMEVProtection', {
      symbol,
      amount,
      currentPrice,
      liquidityDepth
    });

    const simulationConfig = getSimulationConfig();
    
    // Simulate MEV risk assessment
    const tradeValue = amount * currentPrice;
    const simulatedPriceImpact = liquidityDepth > 0 ? 
      Math.sqrt(tradeValue / liquidityDepth) * 0.01 : 0.05;
    
    // Determine simulated risk level
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (simulatedPriceImpact > 0.02) riskLevel = 'critical';
    else if (simulatedPriceImpact > 0.01) riskLevel = 'high';
    else if (simulatedPriceImpact > 0.005) riskLevel = 'medium';
    
    // Check if MEV scenarios are enabled
    if (!simulationConfig.mevScenarios) {
      // No MEV protection needed in simplified mode
      return {
        protected: false,
        strategy: 'paper_mode_disabled',
        delayApplied: 0,
        gasPriceAdjustment: 0,
        bundleUsed: false,
        riskMitigated: []
      };
    }
    
    // Simulate MEV attack detection
    const mevAttackDetected = Math.random() < simulationConfig.sandwichAttackRate;
    if (mevAttackDetected) {
      logger.info(`[PAPER_MODE] MEV attack detected for ${symbol}`, {
        riskLevel,
        priceImpact: simulatedPriceImpact,
        tradeValue
      });
    }
    
    const riskMitigated: string[] = [];
    let delayApplied = 0;
    let gasPriceAdjustment = 0;
    let bundleUsed = false;
    let strategy = 'none';
    
    // Apply simulated protections based on risk level
    if (riskLevel !== 'low' || mevAttackDetected) {
      strategy = 'simulated_protection';
      
      // Simulate timing randomization
      if (this.config.delayRandomizationEnabled) {
        delayApplied = this.config.minDelayMs + 
          Math.random() * (this.config.maxDelayMs - this.config.minDelayMs);
        riskMitigated.push('timing_randomization');
        
        // Actually apply the delay for realism
        await this.sleep(delayApplied);
      }
      
      // Simulate gas price adjustment
      if (riskLevel === 'high' || riskLevel === 'critical') {
        gasPriceAdjustment = 20 + Math.random() * 50; // 20-70 gwei increase
        riskMitigated.push('gas_price_optimization');
      }
      
      // Simulate bundle submission for critical risk
      if (riskLevel === 'critical' && this.config.bundleSubmissionEnabled) {
        bundleUsed = true;
        strategy = 'bundle_submission_simulated';
        riskMitigated.push('private_mempool');
        
        // Simulate additional bundle processing time
        await this.sleep(500 + Math.random() * 1500); // 0.5-2s
      }
    }
    
    const result: MEVProtectionResult = {
      protected: riskLevel !== 'low' || mevAttackDetected,
      strategy,
      delayApplied,
      gasPriceAdjustment,
      bundleUsed,
      riskMitigated
    };
    
    // Emit telemetry (same as production for consistency)
    this.telemetryBus.emit('mev_protection_applied', {
      symbol,
      amount,
      result,
      assessment: {
        riskLevel,
        riskFactors: mevAttackDetected ? ['Simulated sandwich attack'] : [],
        recommendedDelay: delayApplied,
        recommendedGasPrice: gasPriceAdjustment,
        shouldUseBundles: bundleUsed,
        priceImpactEstimate: simulatedPriceImpact
      },
      timestamp: Date.now(),
      paperMode: true
    });
    
    logger.info(`[PAPER_MODE] MEV protection simulated for ${symbol}`, {
      strategy,
      delayApplied,
      riskLevel,
      riskMitigated,
      mevAttackDetected,
      priceImpact: simulatedPriceImpact
    });
    
    return result;
  }

  /**
   * Estimate price impact of a trade
   */
  private estimatePriceImpact(amount: number, currentPrice: number, liquidityDepth: number): number {
    if (liquidityDepth <= 0) return 0.1; // Assume high impact if no liquidity data
    
    const tradeValue = amount * currentPrice;
    const impactRatio = tradeValue / liquidityDepth;
    
    // Simple square root model for price impact
    return Math.sqrt(impactRatio) * 0.01; // Scale factor
  }

  /**
   * Analyze recent transaction activity for suspicious patterns
   */
  private analyzeRecentActivity(symbol: string): { suspiciousActivity: boolean; reason?: string } {
    const recentTxs = Array.from(this.recentTransactions.entries())
      .filter(([key]) => key.startsWith(symbol))
      .map(([, data]) => data);
    
    if (recentTxs.length < 2) {
      return { suspiciousActivity: false };
    }
    
    // Check for rapid succession of high-impact transactions
    const highImpactTxs = recentTxs.filter(tx => tx.priceImpact > this.config.priceImpactThreshold);
    const recentHighImpact = highImpactTxs.filter(tx => Date.now() - tx.timestamp < 30000); // Last 30 seconds
    
    if (recentHighImpact.length >= 2) {
      return { 
        suspiciousActivity: true, 
        reason: 'Multiple high-impact transactions in short timeframe' 
      };
    }
    
    return { suspiciousActivity: false };
  }

  /**
   * Assess volatility-based MEV risk
   */
  private async assessVolatilityRisk(symbol: string): Promise<{ isHigh: boolean; volatility: number }> {
    // This would integrate with market data to get actual volatility
    // For now, return mock data
    const mockVolatility = Math.random() * 0.1; // 0-10% volatility
    
    return {
      isHigh: mockVolatility > 0.05, // 5% threshold
      volatility: mockVolatility
    };
  }

  /**
   * Escalate risk level
   */
  private escalateRiskLevel(
    current: 'low' | 'medium' | 'high' | 'critical',
    newLevel: 'low' | 'medium' | 'high' | 'critical'
  ): 'low' | 'medium' | 'high' | 'critical' {
    const levels = { low: 0, medium: 1, high: 2, critical: 3 };
    const currentValue = levels[current];
    const newValue = levels[newLevel];
    
    return currentValue > newValue ? current : newLevel;
  }

  /**
   * Calculate optimal delay based on risk level
   */
  private calculateOptimalDelay(riskLevel: 'low' | 'medium' | 'high' | 'critical', priceImpact: number): number {
    if (!this.config.delayRandomizationEnabled) return 0;
    
    const baseDelay = {
      low: 0,
      medium: 1000,
      high: 3000,
      critical: 5000
    }[riskLevel] || 0;
    
    // Add additional delay based on price impact
    const impactDelay = Math.min(priceImpact * 100000, 2000); // Max 2s additional
    
    return Math.min(baseDelay + impactDelay, this.config.maxDelayMs);
  }

  /**
   * Calculate optimal gas price adjustment
   */
  private calculateOptimalGasPrice(riskLevel: 'low' | 'medium' | 'high' | 'critical'): number {
    const multipliers = {
      low: 1.0,
      medium: 1.1,
      high: 1.2,
      critical: 1.5
    };
    
    return (multipliers[riskLevel] || 1.0) * this.config.gasBufferMultiplier;
  }

  /**
   * Generate random delay within bounds
   */
  private generateRandomDelay(baseDelay: number): number {
    const minDelay = Math.max(this.config.minDelayMs, baseDelay * 0.5);
    const maxDelay = Math.min(this.config.maxDelayMs, baseDelay * 1.5);
    
    return Math.floor(Math.random() * (maxDelay - minDelay) + minDelay);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Record transaction for pattern analysis
   */
  private recordTransaction(symbol: string, priceImpact: number): void {
    const key = `${symbol}-${Date.now()}`;
    this.recentTransactions.set(key, {
      timestamp: Date.now(),
      priceImpact
    });
  }

  /**
   * Clean up old transaction history
   */
  private cleanupTransactionHistory(): void {
    const cutoff = Date.now() - this.TRANSACTION_HISTORY_TTL;
    
    for (const [key, data] of this.recentTransactions) {
      if (data.timestamp < cutoff) {
        this.recentTransactions.delete(key);
      }
    }
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<MEVProtectionConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('MEV protection configuration updated', config);
  }

  /**
   * Get current configuration
   */
  public getConfig(): MEVProtectionConfig {
    return { ...this.config };
  }
} 