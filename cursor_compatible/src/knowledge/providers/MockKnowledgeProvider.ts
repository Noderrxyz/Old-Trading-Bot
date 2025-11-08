/**
 * MockKnowledgeProvider - A demonstration knowledge provider
 * 
 * This provider simulates external knowledge without requiring actual
 * connections to services like Numerai. It's useful for testing and
 * demonstrating the knowledge aggregation system.
 */

import { 
  IKnowledgeProvider, 
  KnowledgeContext, 
  KnowledgeEnhancement, 
  KnowledgeFeedback,
  KnowledgeProviderStats,
  KnowledgeConfidence 
} from '../interfaces/IKnowledgeProvider';
import { MarketRegime } from '../../regime/RegimeClassifier';
import { createLogger } from '../../common/logger';

const logger = createLogger('MockKnowledgeProvider');

/**
 * Configuration for the mock provider
 */
export interface MockProviderConfig {
  /** Base confidence level for knowledge */
  baseConfidence: number;
  
  /** Base crypto applicability */
  baseCryptoApplicability: number;
  
  /** Simulate varying quality */
  simulateVariability: boolean;
  
  /** Failure rate for testing (0-1) */
  failureRate: number;
  
  /** Latency simulation in ms */
  simulatedLatencyMs: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: MockProviderConfig = {
  baseConfidence: 0.6,
  baseCryptoApplicability: 0.5,
  simulateVariability: true,
  failureRate: 0.05,
  simulatedLatencyMs: 100
};

/**
 * Mock Knowledge Provider Implementation
 */
export class MockKnowledgeProvider implements IKnowledgeProvider {
  public readonly id = 'mock';
  public readonly name = 'Mock Knowledge Provider';
  public enabled = true;
  
  private config: MockProviderConfig;
  private stats: KnowledgeProviderStats;
  private knowledgeCount = 0;
  private performanceHistory: number[] = [];
  
  constructor(config: Partial<MockProviderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = {
      totalQueries: 0,
      applicableQueries: 0,
      timesUsed: 0,
      timesUseful: 0,
      avgPerformanceGain: 0,
      providerConfidence: this.config.baseConfidence,
      lastUpdated: Date.now()
    };
  }
  
  /**
   * Initialize the provider
   */
  async initialize(): Promise<void> {
    // Simulate initialization delay
    await this.simulateLatency();
    
    logger.info(`${this.name} initialized with config:`, this.config);
  }
  
  /**
   * Assess applicability for a context
   */
  async assessApplicability(context: KnowledgeContext): Promise<number> {
    this.stats.totalQueries++;
    
    // Simulate latency
    await this.simulateLatency();
    
    // Simulate failure
    if (Math.random() < this.config.failureRate) {
      logger.debug(`${this.name}: Simulated failure for applicability check`);
      return 0;
    }
    
    let applicability = this.config.baseCryptoApplicability;
    
    // Adjust based on context
    if (context.timeframe === '1d' || context.timeframe === '4h') {
      applicability += 0.2; // Better for longer timeframes
    } else if (context.timeframe === '1m' || context.timeframe === '5m') {
      applicability -= 0.3; // Worse for short timeframes
    }
    
    // Adjust based on assets
    if (context.assets.some(a => ['BTC', 'ETH'].includes(a))) {
      applicability += 0.1; // Better for major assets
    }
    
    // Adjust based on regime
    if (context.regime === MarketRegime.HighVolatility) {
      applicability += 0.15; // Good at volatile markets
    } else if (context.regime === MarketRegime.LowVolatility) {
      applicability -= 0.1; // Less useful in calm markets
    }
    
    // Add variability
    if (this.config.simulateVariability) {
      applicability += (Math.random() - 0.5) * 0.2;
    }
    
    // Clamp to valid range
    applicability = Math.max(0, Math.min(1, applicability));
    
    if (applicability > 0.3) {
      this.stats.applicableQueries++;
    }
    
    this.updateStats();
    
    return applicability;
  }
  
  /**
   * Get enhancement for a context
   */
  async getEnhancement(context: KnowledgeContext): Promise<KnowledgeEnhancement | null> {
    // Simulate latency
    await this.simulateLatency();
    
    // Simulate failure
    if (Math.random() < this.config.failureRate) {
      logger.debug(`${this.name}: Simulated failure for enhancement`);
      return null;
    }
    
    // Generate mock enhancement
    const enhancementId = `${this.id}_${++this.knowledgeCount}_${Date.now()}`;
    
    // Calculate confidence based on context
    let confidence = this.config.baseConfidence;
    
    if (this.config.simulateVariability) {
      confidence += (Math.random() - 0.5) * 0.3;
    }
    
    confidence = Math.max(0.1, Math.min(0.9, confidence));
    
    // Generate mock features
    const features: Record<string, number> = {};
    
    // Add volatility-related features
    if (context.volatility !== undefined) {
      features['mock_volatility_adjusted'] = context.volatility * 1.1;
      features['mock_volatility_zscore'] = (context.volatility - 0.2) / 0.1;
    }
    
    // Add regime-specific features
    switch (context.regime) {
      case MarketRegime.BullishTrend:
        features['mock_trend_strength'] = 0.7 + Math.random() * 0.2;
        features['mock_momentum_score'] = 0.6 + Math.random() * 0.3;
        break;
        
      case MarketRegime.BearishTrend:
        features['mock_trend_strength'] = -0.7 - Math.random() * 0.2;
        features['mock_momentum_score'] = -0.6 - Math.random() * 0.3;
        break;
        
      case MarketRegime.HighVolatility:
        features['mock_volatility_regime'] = 0.8 + Math.random() * 0.2;
        features['mock_risk_score'] = 0.7 + Math.random() * 0.3;
        break;
        
      default:
        features['mock_neutral_score'] = 0.5 + (Math.random() - 0.5) * 0.2;
    }
    
    // Generate parameter hints
    const parameterHints: any = {};
    
    if (context.regime === MarketRegime.HighVolatility) {
      parameterHints.positionSizePercent = 30; // Reduce position size
      parameterHints.stopLossPercentage = 0.03; // Tighter stop loss
    } else if (context.regime === MarketRegime.BullishTrend) {
      parameterHints.positionSizePercent = 70; // Increase position size
      parameterHints.riskLevel = 'medium';
    }
    
    // Generate regime hints
    const regimeHints: Partial<Record<MarketRegime, number>> = {};
    
    // Add some noise to current regime confidence
    regimeHints[context.regime] = 0.7 + Math.random() * 0.2;
    
    // Add hints for related regimes
    if (context.regime === MarketRegime.BullishTrend) {
      regimeHints[MarketRegime.MeanReverting] = 0.2;
    } else if (context.regime === MarketRegime.HighVolatility) {
      regimeHints[MarketRegime.MarketStress] = 0.3;
    }
    
    // Generate risk adjustments
    const riskAdjustments = {
      positionSizeMultiplier: context.regime === MarketRegime.HighVolatility ? 0.7 : 1.0,
      stopLossMultiplier: context.regime === MarketRegime.MarketStress ? 0.5 : 1.0,
      confidenceMultiplier: confidence
    };
    
    const enhancement: KnowledgeEnhancement = {
      id: enhancementId,
      source: this.id,
      confidence,
      cryptoApplicability: await this.assessApplicability(context),
      features,
      parameterHints,
      regimeHints,
      riskAdjustments,
      timestamp: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000 // Expires in 10 minutes
    };
    
    this.stats.timesUsed++;
    this.updateStats();
    
    logger.debug(`${this.name}: Generated enhancement ${enhancementId} with confidence ${confidence.toFixed(2)}`);
    
    return enhancement;
  }
  
  /**
   * Provide feedback on knowledge usage
   */
  async provideFeedback(feedback: KnowledgeFeedback): Promise<void> {
    // Simulate latency
    await this.simulateLatency();
    
    if (feedback.wasUseful) {
      this.stats.timesUseful++;
    }
    
    // Track performance
    if (feedback.performanceDelta !== undefined) {
      this.performanceHistory.push(feedback.performanceDelta);
      
      // Keep only last 100 entries
      if (this.performanceHistory.length > 100) {
        this.performanceHistory.shift();
      }
      
      // Update average performance gain
      if (this.performanceHistory.length > 0) {
        const sum = this.performanceHistory.reduce((a, b) => a + b, 0);
        this.stats.avgPerformanceGain = sum / this.performanceHistory.length;
      }
    }
    
    // Update provider confidence based on feedback
    if (feedback.wasUseful) {
      this.stats.providerConfidence = Math.min(0.95, this.stats.providerConfidence + 0.01);
    } else {
      this.stats.providerConfidence = Math.max(0.1, this.stats.providerConfidence - 0.02);
    }
    
    this.updateStats();
    
    logger.debug(`${this.name}: Received feedback - useful: ${feedback.wasUseful}, delta: ${feedback.performanceDelta?.toFixed(4)}`);
  }
  
  /**
   * Get provider statistics
   */
  getStats(): KnowledgeProviderStats {
    return { ...this.stats };
  }
  
  /**
   * Update configuration
   */
  updateConfig(config: Record<string, any>): void {
    this.config = { ...this.config, ...config };
    logger.info(`${this.name}: Configuration updated`, this.config);
  }
  
  /**
   * Shutdown the provider
   */
  async shutdown(): Promise<void> {
    logger.info(`${this.name}: Shutting down`);
    // Nothing to clean up for mock provider
  }
  
  /**
   * Simulate network latency
   */
  private async simulateLatency(): Promise<void> {
    if (this.config.simulatedLatencyMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.config.simulatedLatencyMs));
    }
  }
  
  /**
   * Update statistics timestamp
   */
  private updateStats(): void {
    this.stats.lastUpdated = Date.now();
  }
} 