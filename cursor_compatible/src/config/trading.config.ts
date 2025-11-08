/**
 * Trading Configuration
 * 
 * Central configuration for all trading-related settings.
 */

/**
 * Time-of-day bias adjustment configuration
 */
export interface TimeOfDayBiasConfig {
  /** Whether time-of-day bias adjustment is enabled */
  enabled: boolean;
  
  /** Duration of each time bucket in minutes */
  bucketIntervalMinutes: number;
  
  /** Minimum number of data points needed before applying bias */
  minDataPoints: number;
  
  /** Smoothing factor for moving average calculations (0-1) */
  smoothing: number;
  
  /** Confidence adjustment clamp range [min, max] */
  clampRange: [number, number];
  
  /** Whether to log detailed adjustments */
  logDetailedAdjustments: boolean;
}

/**
 * Knowledge enhancement configuration
 */
export interface KnowledgeEnhancementConfig {
  /** Whether knowledge enhancement is enabled */
  enabled: boolean;
  
  /** List of enabled knowledge providers */
  enabledProviders: string[];
  
  /** Minimum confidence threshold for applying knowledge */
  minConfidenceThreshold: number;
  
  /** Minimum crypto applicability score */
  minApplicabilityThreshold: number;
  
  /** Enable adaptive provider adjustment */
  enableAdaptiveProviders: boolean;
  
  /** Cache duration for knowledge in milliseconds */
  knowledgeCacheDurationMs: number;
  
  /** Configuration for specific providers */
  providerConfigs?: Record<string, any>;
}

/**
 * Trading configuration for the Noderr Protocol
 */
export interface TradingConfig {
  /** Time-of-day bias adjustment configuration */
  timeOfDayBias: TimeOfDayBiasConfig;
  
  /** Knowledge enhancement configuration */
  knowledgeEnhancement: KnowledgeEnhancementConfig;
  
  // Risk management
  maxPositionSize: number;
  maxDrawdown: number;
  stopLossPercentage: number;
  takeProfitPercentage: number;
  
  // Execution
  slippageTolerance: number;
  executionTimeout: number;
  maxRetries: number;
  retryDelay: number;
  
  // Strategy
  enableAdaptiveStrategies: boolean;
  strategyUpdateInterval: number;
  minConfidenceThreshold: number;
  
  // Cross-chain execution
  enableUniversalX: boolean;
  universalXConfig?: {
    apiUrl?: string;
    environment?: 'mainnet' | 'testnet' | 'sandbox';
    maxCrossChainLatency?: number;
    preferredChains?: string[];
    fallbackToLegacy?: boolean;
  };
  
  // Market data
  dataUpdateInterval: number;
  historicalDataDays: number;
  
  // Telemetry
  enableTelemetry: boolean;
  telemetryInterval: number;
}

/**
 * Default trading configuration
 */
export const DEFAULT_TRADING_CONFIG: TradingConfig = {
  timeOfDayBias: {
    enabled: true,
    bucketIntervalMinutes: 60,
    minDataPoints: 20,
    smoothing: 0.1,
    clampRange: [0.1, 1.0],
    logDetailedAdjustments: false
  },
  
  knowledgeEnhancement: {
    enabled: false, // Disabled by default for safety
    enabledProviders: ['mock'], // Start with mock provider
    minConfidenceThreshold: 0.4,
    minApplicabilityThreshold: 0.3,
    enableAdaptiveProviders: true,
    knowledgeCacheDurationMs: 5 * 60 * 1000, // 5 minutes
    providerConfigs: {
      mock: {
        baseConfidence: 0.6,
        baseCryptoApplicability: 0.5,
        simulateVariability: true,
        failureRate: 0.05,
        simulatedLatencyMs: 100
      }
    }
  },
  
  // Risk management
  maxPositionSize: 0.1, // 10% of portfolio
  maxDrawdown: 0.2, // 20% max drawdown
  stopLossPercentage: 0.05, // 5% stop loss
  takeProfitPercentage: 0.1, // 10% take profit
  
  // Execution
  slippageTolerance: 0.01, // 1% slippage
  executionTimeout: 30000, // 30 seconds
  maxRetries: 3,
  retryDelay: 2000, // 2 seconds
  
  // Strategy
  enableAdaptiveStrategies: true,
  strategyUpdateInterval: 3600000, // 1 hour
  minConfidenceThreshold: 0.7,
  
  // Cross-chain execution
  enableUniversalX: false, // Disabled by default
  universalXConfig: {
    environment: 'mainnet',
    maxCrossChainLatency: 60000, // 60 seconds
    fallbackToLegacy: true
  },
  
  // Market data
  dataUpdateInterval: 60000, // 1 minute
  historicalDataDays: 30,
  
  // Telemetry
  enableTelemetry: true,
  telemetryInterval: 5000 // 5 seconds
};

/**
 * Get the trading configuration
 * @param overrides Optional configuration overrides
 * @returns Trading configuration
 */
export function getTradingConfig(overrides?: Partial<TradingConfig>): TradingConfig {
  return {
    ...DEFAULT_TRADING_CONFIG,
    ...overrides,
    // Merge nested objects
    timeOfDayBias: {
      ...DEFAULT_TRADING_CONFIG.timeOfDayBias,
      ...(overrides?.timeOfDayBias || {})
    },
    knowledgeEnhancement: {
      ...DEFAULT_TRADING_CONFIG.knowledgeEnhancement,
      ...(overrides?.knowledgeEnhancement || {})
    }
  };
} 