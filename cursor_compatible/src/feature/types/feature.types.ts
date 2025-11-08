/**
 * Raw market data frame
 */
export interface MarketFrame {
  /** Asset symbol */
  symbol: string;
  
  /** Timestamp */
  timestamp: number;
  
  /** Price data */
  price: {
    /** Open price */
    open: number;
    /** High price */
    high: number;
    /** Low price */
    low: number;
    /** Close price */
    close: number;
  };
  
  /** Volume data */
  volume: {
    /** Total volume */
    total: number;
    /** Buy volume */
    buy: number;
    /** Sell volume */
    sell: number;
  };
  
  /** Order book snapshot */
  orderbook: {
    /** Bid levels (price, size) */
    bids: Array<[number, number]>;
    /** Ask levels (price, size) */
    asks: Array<[number, number]>;
  };
  
  /** Recent trades */
  trades: Array<{
    /** Price */
    price: number;
    /** Size */
    size: number;
    /** Side (buy/sell) */
    side: 'buy' | 'sell';
    /** Timestamp */
    timestamp: number;
  }>;
}

/**
 * Expanded feature frame
 */
export interface ExpandedFeatureFrame {
  /** Asset symbol */
  symbol: string;
  
  /** Timestamp */
  timestamp: number;
  
  /** Computed features */
  features: {
    /** VWAP deviation from current price */
    vwapDeviation: number;
    
    /** Average trade size */
    avgTradeSize: number;
    
    /** Spread volatility (rolling std dev) */
    spreadVolatility: number;
    
    /** Volume spike ratio (current vs rolling mean) */
    volumeSpikeRatio: number;
    
    /** Order book imbalance (top 10 levels) */
    orderbookImbalance: number;
    
    /** Rolling skewness of returns */
    rollingSkewness: number;
    
    /** Rolling kurtosis of returns */
    rollingKurtosis: number;
    
    /** Microstructure volatility */
    microstructureVolatility: number;
    
    /** Trade flow imbalance */
    tradeFlowImbalance: number;
    
    /** Hidden liquidity signature */
    hiddenLiquiditySignature: number;
  };
  
  /** Metadata about feature computation */
  metadata: {
    /** Number of samples used */
    sampleCount: number;
    /** Rolling window size */
    windowSize: number;
    /** Feature computation time in ms */
    computationTime: number;
  };
}

/**
 * Feature expansion configuration
 */
export interface FeatureExpansionConfig {
  /** Whether feature expansion is enabled */
  enabled: boolean;
  
  /** Rolling window size for calculations */
  rollingWindow: number;
  
  /** Enabled features */
  features: Array<
    | 'vwapDeviation'
    | 'orderbookImbalance'
    | 'tradeFlowImbalance'
    | 'spreadVolatility'
    | 'rollingSkewness'
    | 'rollingKurtosis'
    | 'microstructureVolatility'
  >;
  
  /** Feature-specific parameters */
  parameters: {
    /** VWAP calculation window */
    vwapWindow: number;
    /** Order book levels to consider */
    orderbookLevels: number;
    /** Trade flow window */
    tradeFlowWindow: number;
    /** Minimum samples for statistics */
    minSamples: number;
  };
}

/**
 * Default configuration for feature expansion
 */
export const DEFAULT_FEATURE_EXPANSION_CONFIG: FeatureExpansionConfig = {
  enabled: true,
  rollingWindow: 100,
  features: [
    'vwapDeviation',
    'orderbookImbalance',
    'tradeFlowImbalance',
    'spreadVolatility',
    'rollingSkewness',
    'rollingKurtosis',
    'microstructureVolatility'
  ],
  parameters: {
    vwapWindow: 20,
    orderbookLevels: 10,
    tradeFlowWindow: 50,
    minSamples: 30
  }
}; 