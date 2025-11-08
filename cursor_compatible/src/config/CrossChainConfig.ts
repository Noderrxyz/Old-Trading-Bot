/**
 * CrossChainConfig - Configuration for cross-chain execution providers
 */

export interface CrossChainProviderConfig {
  provider: 'oneInch' | 'unizen' | 'universalx' | 'custom';
  apiKey?: string;
  apiUrl: string;
  websocketUrl?: string;
  maxConcurrentRequests: number;
  requestTimeout: number;
  retryAttempts: number;
  circuitBreakerThreshold: number;
  circuitBreakerResetTimeMs: number;
  slippageTolerance: number; // in basis points (e.g., 50 = 0.5%)
  gasMultiplier: number; // e.g., 1.1 = 10% more gas than estimated
  supportedChains: string[];
  mevProtection?: {
    enabled: boolean;
    provider?: 'flashbots' | 'custom';
    providerUrl?: string;
  };
  routingPreferences?: {
    excludeProtocols?: string[];
    includeProtocols?: string[];
    preferredDexs?: string[];
    maxHops?: number;
  };
  customAdapterFactory?: (config: CrossChainProviderConfig) => any; // For custom adapters
}

/**
 * Default configuration for 1inch provider
 */
export const oneInchConfig: CrossChainProviderConfig = {
  provider: 'oneInch',
  apiUrl: process.env.ONEINCH_API_URL || 'https://api.1inch.io/v5.0',
  websocketUrl: process.env.ONEINCH_WS_URL || 'wss://ws.1inch.io/v1/',
  maxConcurrentRequests: 50,
  requestTimeout: 30000,
  retryAttempts: 3,
  circuitBreakerThreshold: 5,
  circuitBreakerResetTimeMs: 60000,
  slippageTolerance: 50, // 0.5%
  gasMultiplier: 1.1,
  supportedChains: [
    'ethereum', 'binance-smart-chain', 'polygon',
    'arbitrum', 'optimism', 'avalanche', 'fantom', 'gnosis'
  ],
  mevProtection: {
    enabled: true,
    provider: 'flashbots'
  },
  routingPreferences: {
    maxHops: 3
  }
};

/**
 * Default configuration for UniversalX provider
 */
export const universalXConfig: CrossChainProviderConfig = {
  provider: 'universalx',
  apiUrl: process.env.UNIVERSALX_API_URL || 'https://api.universalx.io',
  maxConcurrentRequests: 100,
  requestTimeout: 45000,
  retryAttempts: 3,
  circuitBreakerThreshold: 5,
  circuitBreakerResetTimeMs: 60000,
  slippageTolerance: 100, // 1%
  gasMultiplier: 1.15,
  supportedChains: [
    'ethereum', 'binance-smart-chain', 'polygon', 'arbitrum', 
    'optimism', 'avalanche', 'base', 'zksync', 'linea', 'scroll'
  ]
};

/**
 * Cross-chain configuration manager
 */
export class CrossChainConfigManager {
  private static instance: CrossChainConfigManager;
  private configs: Map<string, CrossChainProviderConfig> = new Map();
  
  private constructor() {
    // Initialize with default configs
    this.configs.set('oneInch', oneInchConfig);
    this.configs.set('universalx', universalXConfig);
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(): CrossChainConfigManager {
    if (!CrossChainConfigManager.instance) {
      CrossChainConfigManager.instance = new CrossChainConfigManager();
    }
    return CrossChainConfigManager.instance;
  }
  
  /**
   * Get configuration for a provider
   */
  public getConfig(provider: string): CrossChainProviderConfig | undefined {
    return this.configs.get(provider);
  }
  
  /**
   * Set configuration for a provider
   */
  public setConfig(provider: string, config: CrossChainProviderConfig): void {
    this.configs.set(provider, config);
  }
  
  /**
   * Get all configurations
   */
  public getAllConfigs(): Map<string, CrossChainProviderConfig> {
    return new Map(this.configs);
  }
  
  /**
   * Update configuration for a provider
   */
  public updateConfig(provider: string, updates: Partial<CrossChainProviderConfig>): void {
    const existing = this.configs.get(provider);
    if (existing) {
      this.configs.set(provider, { ...existing, ...updates });
    }
  }
  
  /**
   * Get active provider configuration
   */
  public getActiveConfig(): CrossChainProviderConfig {
    const activeProvider = process.env.CROSS_CHAIN_PROVIDER || 'oneInch';
    const config = this.configs.get(activeProvider);
    
    if (!config) {
      throw new Error(`No configuration found for provider: ${activeProvider}`);
    }
    
    return config;
  }
}

/**
 * Export singleton instance
 */
export const crossChainConfigManager = CrossChainConfigManager.getInstance();

/**
 * Export active configuration
 */
export const crossChainConfig = crossChainConfigManager.getActiveConfig(); 