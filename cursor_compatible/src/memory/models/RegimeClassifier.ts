import logger from '../../utils/logger.js';
import { MarketRegime, RegimeMetrics } from '../../types/AlphaSnapshot.js';

interface RegimeConfig {
  priceSlopeThreshold: number;
  volatilityThreshold: number;
  tvlDeltaThreshold: number;
  volumeDeltaThreshold: number;
  minConfidence: number;
  windowSize: number;
}

const DEFAULT_CONFIG: RegimeConfig = {
  priceSlopeThreshold: 0.001, // 0.1% per day
  volatilityThreshold: 0.02, // 2% daily
  tvlDeltaThreshold: 0.05, // 5% change
  volumeDeltaThreshold: 0.1, // 10% change
  minConfidence: 0.7,
  windowSize: 24 // hours
};

export class RegimeClassifier {
  private static instance: RegimeClassifier;
  private config: RegimeConfig;
  private metricsHistory: RegimeMetrics[];
  private currentRegime: MarketRegime;
  private confidence: number;

  private constructor(config: Partial<RegimeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.metricsHistory = [];
    this.currentRegime = 'chop';
    this.confidence = 0;
  }

  public static getInstance(config?: Partial<RegimeConfig>): RegimeClassifier {
    if (!RegimeClassifier.instance) {
      RegimeClassifier.instance = new RegimeClassifier(config);
    }
    return RegimeClassifier.instance;
  }

  public updateMetrics(metrics: RegimeMetrics): void {
    this.metricsHistory.push(metrics);
    
    // Keep only recent history
    const cutoff = Date.now() - this.config.windowSize * 60 * 60 * 1000;
    this.metricsHistory = this.metricsHistory.filter(m => 
      new Date(m.timestamp).getTime() >= cutoff
    );

    // Update regime
    this.detectRegime();
  }

  private detectRegime(): void {
    if (this.metricsHistory.length === 0) {
      return;
    }

    const recentMetrics = this.metricsHistory[this.metricsHistory.length - 1];
    const { priceSlope, realizedVolatility, tvlDelta, volumeDelta } = recentMetrics;

    // Calculate regime scores
    const bullScore = this.calculateBullScore(priceSlope, tvlDelta, volumeDelta);
    const bearScore = this.calculateBearScore(priceSlope, tvlDelta, volumeDelta);
    const chopScore = this.calculateChopScore(realizedVolatility, volumeDelta);

    // Determine regime with highest score
    const scores = {
      bull: bullScore,
      bear: bearScore,
      chop: chopScore
    };

    const maxScore = Math.max(...Object.values(scores));
    const newRegime = Object.entries(scores).find(([_, score]) => score === maxScore)?.[0] as MarketRegime;

    // Update confidence
    this.confidence = this.calculateConfidence(scores, newRegime);

    // Only update regime if confidence is high enough
    if (this.confidence >= this.config.minConfidence) {
      this.currentRegime = newRegime;
    }
  }

  private calculateBullScore(priceSlope: number, tvlDelta: number, volumeDelta: number): number {
    const priceScore = Math.max(0, priceSlope / this.config.priceSlopeThreshold);
    const tvlScore = Math.max(0, tvlDelta / this.config.tvlDeltaThreshold);
    const volumeScore = Math.max(0, volumeDelta / this.config.volumeDeltaThreshold);
    
    return (priceScore + tvlScore + volumeScore) / 3;
  }

  private calculateBearScore(priceSlope: number, tvlDelta: number, volumeDelta: number): number {
    const priceScore = Math.max(0, -priceSlope / this.config.priceSlopeThreshold);
    const tvlScore = Math.max(0, -tvlDelta / this.config.tvlDeltaThreshold);
    const volumeScore = Math.max(0, volumeDelta / this.config.volumeDeltaThreshold);
    
    return (priceScore + tvlScore + volumeScore) / 3;
  }

  private calculateChopScore(volatility: number, volumeDelta: number): number {
    const volScore = Math.max(0, volatility / this.config.volatilityThreshold);
    const volumeScore = Math.max(0, -Math.abs(volumeDelta) / this.config.volumeDeltaThreshold);
    
    return (volScore + volumeScore) / 2;
  }

  private calculateConfidence(scores: Record<MarketRegime, number>, regime: MarketRegime): number {
    const maxScore = scores[regime];
    const otherScores = Object.entries(scores)
      .filter(([r]) => r !== regime)
      .map(([_, score]) => score);
    
    const avgOtherScore = otherScores.reduce((a, b) => a + b, 0) / otherScores.length;
    return Math.max(0, Math.min(1, (maxScore - avgOtherScore) / maxScore));
  }

  public getCurrentRegime(): { regime: MarketRegime; confidence: number } {
    return {
      regime: this.currentRegime,
      confidence: this.confidence
    };
  }

  public getMetricsHistory(): RegimeMetrics[] {
    return [...this.metricsHistory];
  }

  public cleanup(): void {
    this.metricsHistory = [];
    this.currentRegime = 'chop';
    this.confidence = 0;
  }
} 