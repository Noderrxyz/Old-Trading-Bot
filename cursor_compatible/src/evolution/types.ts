/**
 * Evolution Types
 * 
 * Type definitions for the evolution system.
 */

/**
 * Trading strategy interface
 */
export interface TradingStrategy {
  id: string;
  name: string;
  description: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  parentId: string | string[] | null;
  
  // Strategy components
  indicators: {
    [key: string]: {
      enabled: boolean;
      [param: string]: any;
    };
  };
  
  entryConditions: {
    logicOperator: 'AND' | 'OR';
    conditions: Array<{
      indicator: string;
      comparison: 'ABOVE' | 'BELOW' | 'EQUAL' | 'CROSS_ABOVE' | 'CROSS_BELOW';
      value?: number;
      referenceIndicator?: string;
      referenceMultiplier?: number;
    }>;
  };
  
  exitConditions: {
    logicOperator: 'AND' | 'OR';
    conditions: Array<{
      indicator: string;
      comparison: 'ABOVE' | 'BELOW' | 'EQUAL' | 'CROSS_ABOVE' | 'CROSS_BELOW';
      value?: number;
      referenceIndicator?: string;
      referenceMultiplier?: number;
    }>;
  };
  
  riskParameters: {
    positionSizePercent: number;
    stopLossPercent: number;
    takeProfitPercent: number;
    maxOpenPositions: number;
  };
  
  timeSettings: {
    timeframe: string;
  };
  
  // Performance metrics
  performance?: {
    totalTrades: number;
    netProfit: number;
    maxDrawdown: number;
    sharpeRatio: number;
    winRate: number;
    firstProfitDate?: string;
    lastTradeDate?: string;
  };
  
  // Fitness scores
  fitness: {
    returns: number;
    sharpeRatio: number;
    drawdown: number;
    winRate: number;
    profitFactor: number;
    evaluatedAt: string | null;
    overallScore: number;
  };
}

/**
 * Strategy performance metrics
 */
export interface StrategyPerformance {
  strategyId: string;
  netProfit: number;
  maxDrawdown: number;
  sharpeRatio: number;
  winRate: number;
  timeToAlpha: number;
  timestamp: number;
}

/**
 * Strategy mutation result
 */
export interface MutationResult {
  success: boolean;
  strategy: TradingStrategy;
  error?: string;
}

/**
 * Strategy evolution statistics
 */
export interface EvolutionStats {
  generation: number;
  populationSize: number;
  averageFitness: number;
  bestFitness: number;
  mutationRate: number;
  crossoverRate: number;
  timestamp: number;
}

/**
 * Strategy fitness statistics
 */
export interface FitnessStats {
  returns: number;
  sharpeRatio: number;
  drawdown: number;
  winRate: number;
  profitFactor: number;
  overallScore: number;
} 