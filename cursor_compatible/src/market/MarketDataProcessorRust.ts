import { NapiMarketDataProcessor, NapiSharedMemoryManager } from "@noderr/core";
import { logger } from "../utils/logger";
import { MarketDataProcessorJs } from "./MarketDataProcessorJs";

/**
 * Interface representing a market tick with price and volume information
 */
export interface MarketTick {
  /** Symbol/ticker of the instrument */
  symbol: string;
  /** Timestamp in milliseconds */
  timestamp: number;
  /** Current price */
  price: number;
  /** Trade volume */
  volume: number;
  /** Optional bid price */
  bid?: number;
  /** Optional ask price */
  ask?: number;
  /** Additional custom fields */
  [key: string]: any;
}

/**
 * Interface for market data anomalies
 */
export interface MarketAnomaly {
  /** Symbol where anomaly was detected */
  symbol: string;
  /** Type of anomaly detected */
  type: string;
  /** Severity score (0-1) */
  severity: number;
  /** When the anomaly was detected */
  timestamp: number;
  /** Additional metadata about the anomaly */
  metadata?: Record<string, any>;
}

/**
 * Interface for calculated market features
 */
export interface MarketFeatures {
  /** Symbol these features belong to */
  symbol: string;
  /** When features were calculated */
  timestamp: number;
  /** Volatility measurement */
  volatility?: number;
  /** Volume profile metrics */
  volumeProfile?: Record<string, number>;
  /** Price momentum indicators */
  momentum?: Record<string, number>;
  /** Any additional calculated features */
  [key: string]: any;
}

/**
 * Configuration for the MarketDataProcessor
 */
export interface MarketDataProcessorConfig {
  /** Enable or disable the processor */
  enabled: boolean;
  /** Interval in ms to calculate features */
  featureCalculationInterval: number;
  /** Interval in ms to detect anomalies */
  anomalyDetectionInterval: number;
  /** Buffer size for historical ticks per symbol */
  maxTickHistory: number;
  /** Shared memory configuration */
  sharedMemory?: {
    /** Enable shared memory integration */
    enabled: boolean;
    /** Buffer configuration */
    bufferConfig: Record<string, any>;
  };
  /** Feature calculation settings */
  features?: {
    /** List of features to calculate */
    enabledFeatures: string[];
    /** Calculation window sizes */
    windows: number[];
  };
}

/**
 * Default configuration for the MarketDataProcessor
 */
export const DEFAULT_MARKET_DATA_PROCESSOR_CONFIG: MarketDataProcessorConfig = {
  enabled: true,
  featureCalculationInterval: 5000, // 5 seconds
  anomalyDetectionInterval: 10000, // 10 seconds
  maxTickHistory: 10000,
  sharedMemory: {
    enabled: false,
    bufferConfig: {
      size: 1024 * 1024, // 1MB
      maxItems: 10000
    }
  },
  features: {
    enabledFeatures: [
      'volatility',
      'momentum',
      'volumeProfile',
      'pricePatterns'
    ],
    windows: [14, 30, 60, 200]
  }
};

/**
 * Utility to convert between native and JavaScript objects
 */
function convertMarketTickToNative(tick: MarketTick): any {
  return {
    symbol: tick.symbol,
    timestamp: tick.timestamp,
    price: tick.price,
    volume: tick.volume,
    bid: tick.bid || 0,
    ask: tick.ask || 0,
    fields: { ...tick }
  };
}

/**
 * Utility to convert from native to TypeScript MarketFeatures
 */
function convertNativeToMarketFeatures(nativeFeatures: any): MarketFeatures {
  if (!nativeFeatures) return null;
  
  return {
    symbol: nativeFeatures.symbol,
    timestamp: nativeFeatures.timestamp,
    volatility: nativeFeatures.volatility,
    volumeProfile: nativeFeatures.volume_profile,
    momentum: nativeFeatures.momentum,
    ...nativeFeatures
  };
}

/**
 * Utility to convert from native to TypeScript MarketAnomaly
 */
function convertNativeToMarketAnomaly(nativeAnomaly: any): MarketAnomaly {
  if (!nativeAnomaly) return null;
  
  return {
    symbol: nativeAnomaly.symbol,
    type: nativeAnomaly.anomaly_type.toString(),
    severity: nativeAnomaly.severity,
    timestamp: nativeAnomaly.timestamp,
    metadata: nativeAnomaly.metrics
  };
}

/**
 * Utility function to try an operation with fallback
 */
async function tryNativeOrFallback<T>(
  nativeOperation: () => T,
  fallbackOperation: () => T,
  errorMessage: string
): Promise<T> {
  try {
    return nativeOperation();
  } catch (error) {
    logger.warn(`Native operation failed (${errorMessage}), using fallback: ${error.message}`);
    return fallbackOperation();
  }
}

/**
 * MarketDataProcessor - TypeScript wrapper for the Rust native implementation
 * with JavaScript fallback implementation
 */
export class MarketDataProcessorRust {
  private static instance: MarketDataProcessorRust | null = null;
  private nativeProcessor: NapiMarketDataProcessor | null = null;
  private fallbackProcessor: MarketDataProcessorJs | null = null;
  private config: MarketDataProcessorConfig;
  private sharedMemoryManager: NapiSharedMemoryManager | null = null;
  private featureTimer: NodeJS.Timeout | null = null;
  private anomalyTimer: NodeJS.Timeout | null = null;

  /**
   * Get the singleton instance of MarketDataProcessorRust
   */
  public static getInstance(config?: Partial<MarketDataProcessorConfig>): MarketDataProcessorRust {
    if (!MarketDataProcessorRust.instance) {
      MarketDataProcessorRust.instance = new MarketDataProcessorRust(config);
    }
    return MarketDataProcessorRust.instance;
  }

  /**
   * Private constructor - use getInstance() instead
   */
  private constructor(config?: Partial<MarketDataProcessorConfig>) {
    this.config = { ...DEFAULT_MARKET_DATA_PROCESSOR_CONFIG, ...config };
    
    this.initialize();
    this.startPeriodicJobs();
  }

  /**
   * Initialize both native and fallback processors
   */
  private initialize(): void {
    try {
      if (this.config.sharedMemory?.enabled) {
        this.sharedMemoryManager = new NapiSharedMemoryManager();
      }
      
      this.nativeProcessor = new NapiMarketDataProcessor(
        this.sharedMemoryManager,
        this.convertConfigToNative(this.config)
      );
      logger.info("Native MarketDataProcessor initialized successfully");
    } catch (error) {
      logger.warn(`Failed to initialize native MarketDataProcessor: ${error.message}`);
      this.nativeProcessor = null;
    }

    try {
      this.fallbackProcessor = new MarketDataProcessorJs(this.config);
      logger.info("JavaScript fallback MarketDataProcessor initialized");
    } catch (error) {
      logger.error(`Failed to initialize fallback MarketDataProcessor: ${error.message}`);
      this.fallbackProcessor = null;
    }

    if (!this.nativeProcessor && !this.fallbackProcessor) {
      throw new Error("Failed to initialize both native and fallback MarketDataProcessor");
    }
  }

  /**
   * Start periodic jobs for feature calculation and anomaly detection
   */
  private startPeriodicJobs(): void {
    if (this.config.featureCalculationInterval > 0) {
      this.featureTimer = setInterval(() => {
        try {
          // This would calculate features for all tracked symbols
          // In a production system, you might want to be more selective
          logger.debug("Running periodic feature calculation");
        } catch (error) {
          logger.error(`Error in periodic feature calculation: ${error.message}`);
        }
      }, this.config.featureCalculationInterval);
    }

    if (this.config.anomalyDetectionInterval > 0) {
      this.anomalyTimer = setInterval(() => {
        try {
          this.detectAnomalies();
          logger.debug("Running periodic anomaly detection");
        } catch (error) {
          logger.error(`Error in periodic anomaly detection: ${error.message}`);
        }
      }, this.config.anomalyDetectionInterval);
    }
  }

  /**
   * Stop periodic jobs
   */
  public stopPeriodicJobs(): void {
    if (this.featureTimer) {
      clearInterval(this.featureTimer);
      this.featureTimer = null;
    }
    
    if (this.anomalyTimer) {
      clearInterval(this.anomalyTimer);
      this.anomalyTimer = null;
    }
  }

  /**
   * Process a market tick
   */
  public processTick(tick: MarketTick): void {
    const startTime = Date.now();
    
    tryNativeOrFallback(
      () => {
        this.nativeProcessor.process_tick(convertMarketTickToNative(tick));
        return true;
      },
      () => {
        this.fallbackProcessor.processTick(tick);
        return true;
      },
      "processTick"
    );
    
    const processingTime = Date.now() - startTime;
    if (processingTime > 5) { // Log only if processing takes more than 5ms
      logger.debug(`Market tick processed in ${processingTime}ms: ${tick.symbol} @ ${tick.price}`);
    }
  }

  /**
   * Calculate features for a specific symbol
   */
  public calculateFeatures(symbol: string): MarketFeatures {
    return tryNativeOrFallback(
      () => {
        const nativeFeatures = this.nativeProcessor.calculate_features(symbol);
        return convertNativeToMarketFeatures(nativeFeatures);
      },
      () => this.fallbackProcessor.calculateFeatures(symbol),
      "calculateFeatures"
    );
  }

  /**
   * Detect anomalies across all tracked symbols
   */
  public detectAnomalies(): MarketAnomaly[] {
    return tryNativeOrFallback(
      () => {
        const nativeAnomalies = this.nativeProcessor.detect_anomalies();
        return nativeAnomalies.map(convertNativeToMarketAnomaly);
      },
      () => this.fallbackProcessor.detectAnomalies(),
      "detectAnomalies"
    );
  }

  /**
   * Get recent anomalies (limited by count)
   */
  public getRecentAnomalies(limit: number): MarketAnomaly[] {
    return tryNativeOrFallback(
      () => {
        const nativeAnomalies = this.nativeProcessor.get_recent_anomalies(limit);
        return nativeAnomalies.map(convertNativeToMarketAnomaly);
      },
      () => this.fallbackProcessor.getRecentAnomalies(limit),
      "getRecentAnomalies"
    );
  }

  /**
   * Get latest features for a specific symbol
   */
  public getLatestFeatures(symbol: string): MarketFeatures {
    return tryNativeOrFallback(
      () => {
        const nativeFeatures = this.nativeProcessor.get_latest_features(symbol);
        return convertNativeToMarketFeatures(nativeFeatures);
      },
      () => this.fallbackProcessor.getLatestFeatures(symbol),
      "getLatestFeatures"
    );
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<MarketDataProcessorConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Restart timers if intervals have changed
    this.stopPeriodicJobs();
    this.startPeriodicJobs();
    
    // Update native processor config if available
    if (this.nativeProcessor) {
      try {
        // Method doesn't exist in the type definitions yet
        // this.nativeProcessor.update_config(this.convertConfigToNative(this.config));
      } catch (error) {
        logger.warn(`Failed to update native processor config: ${error.message}`);
      }
    }
    
    // Update fallback processor config
    if (this.fallbackProcessor) {
      this.fallbackProcessor.updateConfig(this.config);
    }
  }

  /**
   * Get current configuration
   */
  public getConfig(): MarketDataProcessorConfig {
    return { ...this.config };
  }

  /**
   * Convert TypeScript config to native format
   */
  private convertConfigToNative(config: MarketDataProcessorConfig): any {
    return {
      enabled: config.enabled,
      feature_calculation_interval_ms: config.featureCalculationInterval,
      anomaly_detection_interval_ms: config.anomalyDetectionInterval,
      max_tick_history: config.maxTickHistory,
      shared_memory: config.sharedMemory ? {
        enabled: config.sharedMemory.enabled,
        buffer_config: config.sharedMemory.bufferConfig
      } : null,
      features: config.features ? {
        enabled_features: config.features.enabledFeatures,
        windows: config.features.windows
      } : null
    };
  }
} 