/**
 * AlphaOrchestrator Types - Central signal intelligence fusion system
 */

export enum SignalType {
  // Market structure signals
  TREND_REVERSAL = 'TREND_REVERSAL',
  MOMENTUM_SURGE = 'MOMENTUM_SURGE',
  VOLATILITY_SPIKE = 'VOLATILITY_SPIKE',
  LIQUIDITY_IMBALANCE = 'LIQUIDITY_IMBALANCE',
  
  // Order flow signals
  WHALE_ACCUMULATION = 'WHALE_ACCUMULATION',
  SMART_MONEY_FLOW = 'SMART_MONEY_FLOW',
  EXCHANGE_ARBITRAGE = 'EXCHANGE_ARBITRAGE',
  
  // Technical signals
  SUPPORT_BREAK = 'SUPPORT_BREAK',
  RESISTANCE_BREAK = 'RESISTANCE_BREAK',
  PATTERN_FORMATION = 'PATTERN_FORMATION',
  
  // ML/AI signals
  ANOMALY_DETECTED = 'ANOMALY_DETECTED',
  REGIME_CHANGE = 'REGIME_CHANGE',
  CORRELATION_BREAK = 'CORRELATION_BREAK',
  
  // Cross-chain signals
  BRIDGE_CONGESTION = 'BRIDGE_CONGESTION',
  CHAIN_MOMENTUM = 'CHAIN_MOMENTUM',
  DEFI_ROTATION = 'DEFI_ROTATION'
}

export enum SignalSource {
  ALPHA_EXPLOITATION = 'ALPHA_EXPLOITATION',
  MARKET_INTEL = 'MARKET_INTEL',
  ML_STRATEGY = 'ML_STRATEGY',
  TECHNICAL_ANALYSIS = 'TECHNICAL_ANALYSIS',
  ONCHAIN_ANALYTICS = 'ONCHAIN_ANALYTICS',
  SOCIAL_SENTIMENT = 'SOCIAL_SENTIMENT'
}

export enum MarketRegime {
  BULL_TREND = 'BULL_TREND',
  BEAR_TREND = 'BEAR_TREND',
  RANGING = 'RANGING',
  HIGH_VOLATILITY = 'HIGH_VOLATILITY',
  LOW_VOLATILITY = 'LOW_VOLATILITY',
  RISK_OFF = 'RISK_OFF',
  RISK_ON = 'RISK_ON'
}

export interface RawSignal {
  id: string;
  source: SignalSource;
  type: SignalType;
  symbol: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  strength: number; // 0-100
  timeframe: number; // milliseconds
  metadata: {
    [key: string]: any;
  };
  timestamp: number;
  expiryTime?: number;
}

export interface SignalMetrics {
  historicalAccuracy: number; // 0-1
  profitFactor: number;
  sharpeRatio: number;
  winRate: number;
  avgReturn: number;
  totalSignals: number;
  regime: MarketRegime;
  lastUpdated: number;
}

export interface AlphaEvent {
  id: string;
  strategyId: string;
  signal: SignalType;
  symbol: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number; // 0-1
  weight: number; // 0-1
  priority: number; // 1-10
  source: SignalSource;
  metadata: {
    originalSignals: RawSignal[];
    conflictResolution?: string;
    regimeAlignment: boolean;
    [key: string]: any;
  };
  timestamp: number;
  expiryTime: number;
}

export interface ConflictResolution {
  method: 'HIGHEST_CONFIDENCE' | 'WEIGHTED_AVERAGE' | 'ENSEMBLE' | 'VETO';
  conflictingSignals: RawSignal[];
  resolution: AlphaEvent;
  reason: string;
}

export interface SignalSubscription {
  subscriberId: string;
  strategyId: string;
  filters: {
    sources?: SignalSource[];
    types?: SignalType[];
    symbols?: string[];
    minConfidence?: number;
    regimes?: MarketRegime[];
  };
  callback: (event: AlphaEvent) => void;
  priority: number;
}

export interface OrchestratorConfig {
  // Signal processing
  signalDecayRate: number; // How fast signals lose relevance
  maxSignalAge: number; // Maximum age before signal expires
  
  // Conflict resolution
  conflictResolutionMethod: 'HIGHEST_CONFIDENCE' | 'WEIGHTED_AVERAGE' | 'ENSEMBLE';
  minSignalsForEnsemble: number;
  
  // Scoring weights
  weights: {
    historicalAccuracy: number;
    regimeAlignment: number;
    signalFreshness: number;
    sourceReliability: number;
  };
  
  // Performance tracking
  metricsWindow: number; // Time window for performance metrics
  minDataPoints: number; // Minimum signals for reliable metrics
  
  // Regime detection
  regimeDetectionInterval: number;
  regimeChangeThreshold: number;
}

export interface SignalPerformance {
  signalId: string;
  actualOutcome: 'WIN' | 'LOSS' | 'NEUTRAL';
  returnPercentage: number;
  executionTime: number;
  slippage: number;
}

export interface OrchestratorMetrics {
  totalSignalsProcessed: number;
  totalAlphaEvents: number;
  conflictsResolved: number;
  avgConfidence: number;
  topPerformingSources: Array<{
    source: SignalSource;
    accuracy: number;
    profitFactor: number;
  }>;
  currentRegime: MarketRegime;
  signalDistribution: Map<SignalType, number>;
} 