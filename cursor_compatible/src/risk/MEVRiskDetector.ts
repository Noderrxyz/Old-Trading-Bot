import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

interface VenueQuote {
  symbol: string;
  price: number;
  slippage: number;
  venue: string;
  timestamp: number;
}

interface MempoolData {
  pendingTxs: number;
  avgGasPrice: number;
  sandwichPatterns: number;
}

interface RiskAssessment {
  shouldUseFlashbots: boolean;
  sandwichRisk: number;
  timestamp: number;
}

interface RiskConfig {
  highSlippageThreshold: number;
  highVolatilityThreshold: number;
  highMempoolThreshold: number;
  logFilePath: string;
}

const DEFAULT_CONFIG: RiskConfig = {
  highSlippageThreshold: 0.5, // 0.5% slippage
  highVolatilityThreshold: 2.0, // 2% volatility
  highMempoolThreshold: 100, // 100 pending transactions
  logFilePath: path.join(process.cwd(), 'logs', 'risk', 'sandwich_risk.jsonl')
};

export class MEVRiskDetector {
  private static instance: MEVRiskDetector;
  private config: RiskConfig;

  private constructor(config: Partial<RiskConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setupLogDirectory();
  }

  public static getInstance(config?: Partial<RiskConfig>): MEVRiskDetector {
    if (!MEVRiskDetector.instance) {
      MEVRiskDetector.instance = new MEVRiskDetector(config);
    }
    return MEVRiskDetector.instance;
  }

  private setupLogDirectory(): void {
    const logDir = path.dirname(this.config.logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  public assessRisk(
    quote: VenueQuote,
    volatility: number,
    mempoolData: MempoolData
  ): RiskAssessment {
    const riskFactors = this.calculateRiskFactors(quote, volatility, mempoolData);
    const sandwichRisk = this.calculateSandwichRisk(riskFactors);
    const shouldUseFlashbots = this.shouldUseFlashbots(riskFactors);

    const assessment: RiskAssessment = {
      shouldUseFlashbots,
      sandwichRisk,
      timestamp: Date.now()
    };

    this.logRiskAssessment(quote.symbol, assessment);
    return assessment;
  }

  private calculateRiskFactors(
    quote: VenueQuote,
    volatility: number,
    mempoolData: MempoolData
  ): {
    slippageRisk: number;
    volatilityRisk: number;
    mempoolRisk: number;
  } {
    const slippageRisk = Math.min(quote.slippage / this.config.highSlippageThreshold, 1);
    const volatilityRisk = Math.min(volatility / this.config.highVolatilityThreshold, 1);
    const mempoolRisk = Math.min(mempoolData.pendingTxs / this.config.highMempoolThreshold, 1);

    return { slippageRisk, volatilityRisk, mempoolRisk };
  }

  private calculateSandwichRisk(riskFactors: {
    slippageRisk: number;
    volatilityRisk: number;
    mempoolRisk: number;
  }): number {
    // Weighted average of risk factors
    const weights = {
      slippage: 0.4,
      volatility: 0.3,
      mempool: 0.3
    };

    return (
      riskFactors.slippageRisk * weights.slippage +
      riskFactors.volatilityRisk * weights.volatility +
      riskFactors.mempoolRisk * weights.mempool
    );
  }

  private shouldUseFlashbots(riskFactors: {
    slippageRisk: number;
    volatilityRisk: number;
    mempoolRisk: number;
  }): boolean {
    const totalRisk = this.calculateSandwichRisk(riskFactors);
    return totalRisk > 0.7; // Use Flashbots if risk is above 70%
  }

  private logRiskAssessment(symbol: string, assessment: RiskAssessment): void {
    try {
      const logEntry = {
        symbol,
        slippage: assessment.sandwichRisk,
        sandwichRisk: assessment.sandwichRisk,
        flashbotsUsed: assessment.shouldUseFlashbots,
        timestamp: assessment.timestamp
      };

      fs.appendFileSync(
        this.config.logFilePath,
        JSON.stringify(logEntry) + '\n'
      );
    } catch (error) {
      logger.error('Failed to log risk assessment:', error);
    }
  }
} 