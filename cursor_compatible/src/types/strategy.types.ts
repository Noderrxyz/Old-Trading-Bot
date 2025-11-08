/**
 * Market regime types
 */
export type MarketRegime = 'bull' | 'bear' | 'chop' | 'neutral';

/**
 * Strategy metadata
 */
export interface StrategyMetadata {
  regime: MarketRegime;
  locked?: string[];
  version: string;
  trustWeight?: number;
  description?: string;
}

/**
 * Strategy parameters
 */
export interface StrategyParams {
  [key: string]: number;
}

/**
 * Strategy genome
 */
export interface StrategyGenome {
  strategyId: string;
  params: StrategyParams;
  metadata: StrategyMetadata;
}

/**
 * Strategy instance
 */
export interface StrategyInstance {
  genome: StrategyGenome;
  execute: (marketData: any) => Promise<{
    action: 'buy' | 'sell' | 'hold';
    size: number;
    confidence: number;
  }>;
}

/**
 * Strategy loader configuration
 */
export interface StrategyLoaderConfig {
  strategyDir: string;
  validateSchema: boolean;
} 