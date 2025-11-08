/**
 * Paper Mode Configuration
 * 
 * Global configuration system for enabling paper trading mode throughout
 * the Noderr Protocol execution engine. When paper mode is enabled,
 * all external API calls are intercepted and simulated.
 */

export interface PaperModeConfig {
  enabled: boolean;
  simulation: {
    // Price simulation settings
    priceVolatility: number; // 0-1, how volatile price movements should be
    spreadSimulation: boolean; // Whether to simulate bid/ask spreads
    slippageEnabled: boolean; // Whether to apply realistic slippage
    
    // Execution simulation settings
    executionLatency: {
      min: number; // Minimum execution latency in ms
      max: number; // Maximum execution latency in ms
    };
    
    // Failure simulation settings
    failureRate: number; // 0-1, rate of simulated failures
    networkLatency: {
      min: number; // Minimum network latency in ms
      max: number; // Maximum network latency in ms
    };
    
    // Bridge simulation settings
    bridgeDelays: {
      ethereum: number;
      polygon: number;
      arbitrum: number;
      avalanche: number;
      binance: number;
    };
    
    // MEV simulation settings
    mevScenarios: boolean; // Whether to simulate MEV scenarios
    sandwichAttackRate: number; // 0-1, rate of sandwich attack simulation
  };
  
  // Data sources for simulation
  dataSources: {
    historicalPrices: string; // Path to historical price data
    orderBookData: string; // Path to order book simulation data
    bridgeMetrics: string; // Path to bridge performance data
  };
  
  // Persistence settings
  persistence: {
    enabled: boolean;
    stateDirectory: string;
    autosaveInterval: number; // Autosave interval in ms
  };
  
  // Logging and telemetry
  telemetry: {
    logAllSimulatedCalls: boolean;
    emitRealTelemetry: boolean; // Whether to emit telemetry as if real
    traceSimulatedExecution: boolean;
  };
}

/**
 * Default paper mode configuration
 */
export const DEFAULT_PAPER_MODE_CONFIG: PaperModeConfig = {
  enabled: false,
  simulation: {
    priceVolatility: 0.02, // 2% volatility
    spreadSimulation: true,
    slippageEnabled: true,
    executionLatency: {
      min: 50,
      max: 200
    },
    failureRate: 0.05, // 5% failure rate
    networkLatency: {
      min: 20,
      max: 100
    },
    bridgeDelays: {
      ethereum: 15000, // 15s
      polygon: 5000,   // 5s
      arbitrum: 3000,  // 3s
      avalanche: 4000, // 4s
      binance: 2000    // 2s
    },
    mevScenarios: true,
    sandwichAttackRate: 0.1 // 10% chance of sandwich detection
  },
  dataSources: {
    historicalPrices: './data/mock/historical-prices',
    orderBookData: './data/mock/orderbook',
    bridgeMetrics: './data/mock/bridge-metrics'
  },
  persistence: {
    enabled: true,
    stateDirectory: './data/paper-trading-state',
    autosaveInterval: 30000 // 30 seconds
  },
  telemetry: {
    logAllSimulatedCalls: true,
    emitRealTelemetry: true,
    traceSimulatedExecution: true
  }
};

/**
 * Paper mode configuration instance
 */
class PaperModeConfigManager {
  private static instance: PaperModeConfigManager;
  private config: PaperModeConfig;
  private initialized: boolean = false;

  private constructor() {
    this.config = { ...DEFAULT_PAPER_MODE_CONFIG };
    this.loadFromEnvironment();
  }

  public static getInstance(): PaperModeConfigManager {
    if (!PaperModeConfigManager.instance) {
      PaperModeConfigManager.instance = new PaperModeConfigManager();
    }
    return PaperModeConfigManager.instance;
  }

  /**
   * Load configuration from environment variables
   */
  private loadFromEnvironment(): void {
    // Check for PAPER_MODE environment variable
    const paperModeEnv = process.env.PAPER_MODE?.toLowerCase();
    if (paperModeEnv === 'true' || paperModeEnv === '1' || paperModeEnv === 'on') {
      this.config.enabled = true;
    }

    // Load other environment-specific overrides
    if (process.env.PAPER_PRICE_VOLATILITY) {
      this.config.simulation.priceVolatility = parseFloat(process.env.PAPER_PRICE_VOLATILITY);
    }

    if (process.env.PAPER_FAILURE_RATE) {
      this.config.simulation.failureRate = parseFloat(process.env.PAPER_FAILURE_RATE);
    }

    if (process.env.PAPER_STATE_DIR) {
      this.config.persistence.stateDirectory = process.env.PAPER_STATE_DIR;
    }

    // Override based on NODE_ENV
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
      this.config.enabled = this.config.enabled || true; // Default to paper mode in test/dev
    }

    this.initialized = true;
  }

  /**
   * Check if paper mode is enabled
   */
  public isPaperMode(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the current configuration
   */
  public getConfig(): PaperModeConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  public updateConfig(updates: Partial<PaperModeConfig>): void {
    this.config = {
      ...this.config,
      ...updates
    };
  }

  /**
   * Enable paper mode
   */
  public enablePaperMode(): void {
    this.config.enabled = true;
  }

  /**
   * Disable paper mode
   */
  public disablePaperMode(): void {
    this.config.enabled = false;
  }

  /**
   * Get simulation settings
   */
  public getSimulationConfig() {
    return this.config.simulation;
  }

  /**
   * Check if component should log simulated calls
   */
  public shouldLogSimulatedCalls(): boolean {
    return this.config.telemetry.logAllSimulatedCalls;
  }

  /**
   * Check if component should emit real telemetry
   */
  public shouldEmitRealTelemetry(): boolean {
    return this.config.telemetry.emitRealTelemetry;
  }

  /**
   * Check if execution should be traced
   */
  public shouldTraceExecution(): boolean {
    return this.config.telemetry.traceSimulatedExecution;
  }
}

// Export singleton instance functions
export const paperModeConfig = PaperModeConfigManager.getInstance();

/**
 * Utility function to check if paper mode is enabled
 * This is the primary function that should be used throughout the codebase
 */
export function isPaperMode(): boolean {
  return paperModeConfig.isPaperMode();
}

/**
 * Get paper mode configuration
 */
export function getPaperModeConfig(): PaperModeConfig {
  return paperModeConfig.getConfig();
}

/**
 * Get simulation configuration
 */
export function getSimulationConfig() {
  return paperModeConfig.getSimulationConfig();
}

/**
 * Paper mode logging utility
 */
export function logPaperModeCall(component: string, method: string, params?: any): void {
  if (paperModeConfig.shouldLogSimulatedCalls()) {
    console.log(`[PAPER_MODE] ${component}.${method}`, params ? JSON.stringify(params, null, 2) : '');
  }
} 