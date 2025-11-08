/**
 * CrossChainAdapterFactory - Factory for creating cross-chain adapters
 */

import { ICrossChainAdapter } from '../interfaces/ICrossChainAdapter';
import { OneInchAdapter } from '../OneInchAdapter';
import { UniversalXAdapter } from '../UniversalXAdapter';
import { crossChainConfigManager, CrossChainProviderConfig } from '../../config/CrossChainConfig';
import { createLogger } from '../../common/logger';

const logger = createLogger('CrossChainAdapterFactory');

/**
 * Factory class for creating cross-chain adapters
 */
export class CrossChainAdapterFactory {
  private static adapterCache: Map<string, ICrossChainAdapter> = new Map();
  
  /**
   * Create a cross-chain adapter based on configuration
   * @param provider Optional provider name (defaults to active config)
   * @param config Optional custom configuration
   * @returns Cross-chain adapter instance
   */
  public static createAdapter(
    provider?: string,
    config?: Partial<CrossChainProviderConfig>
  ): ICrossChainAdapter {
    // Get configuration
    const providerName = provider || process.env.CROSS_CHAIN_PROVIDER || 'oneInch';
    
    // Check cache first
    const cacheKey = `${providerName}_${JSON.stringify(config || {})}`;
    const cached = this.adapterCache.get(cacheKey);
    if (cached) {
      logger.debug(`Returning cached adapter for provider: ${providerName}`);
      return cached;
    }
    
    // Get base configuration
    const baseConfig = crossChainConfigManager.getConfig(providerName);
    if (!baseConfig) {
      throw new Error(`No configuration found for provider: ${providerName}`);
    }
    
    // Merge with custom config if provided
    const finalConfig = config ? { ...baseConfig, ...config } : baseConfig;
    
    logger.info(`Creating cross-chain adapter for provider: ${providerName}`, {
      config: {
        ...finalConfig,
        apiKey: finalConfig.apiKey ? '***' : undefined // Mask sensitive data
      }
    });
    
    let adapter: ICrossChainAdapter;
    
    switch (providerName.toLowerCase()) {
      case 'oneinch':
      case '1inch':
        adapter = new OneInchAdapter({
          apiKey: finalConfig.apiKey,
          apiUrl: finalConfig.apiUrl,
          maxSlippage: finalConfig.slippageTolerance / 100, // Convert basis points to percentage
          excludeProtocols: finalConfig.routingPreferences?.excludeProtocols,
          includeProtocols: finalConfig.routingPreferences?.includeProtocols
        });
        break;
        
      case 'universalx':
        adapter = new UniversalXAdapter();
        break;
        
      case 'custom':
        // For custom adapters, require a factory function in config
        if (!finalConfig.customAdapterFactory) {
          throw new Error('Custom adapter requires customAdapterFactory function in config');
        }
        adapter = finalConfig.customAdapterFactory(finalConfig);
        break;
        
      default:
        throw new Error(`Unsupported cross-chain provider: ${providerName}`);
    }
    
    // Cache the adapter
    this.adapterCache.set(cacheKey, adapter);
    
    return adapter;
  }
  
  /**
   * Create adapter with API key from environment
   * @param provider Provider name
   * @returns Cross-chain adapter instance
   */
  public static createFromEnv(provider?: string): ICrossChainAdapter {
    const providerName = provider || process.env.CROSS_CHAIN_PROVIDER || 'oneInch';
    
    // Get API key from environment
    const apiKeyEnvMap: Record<string, string> = {
      'oneinch': 'ONEINCH_API_KEY',
      '1inch': 'ONEINCH_API_KEY',
      'universalx': 'UNIVERSALX_API_KEY'
    };
    
    const apiKeyEnv = apiKeyEnvMap[providerName.toLowerCase()];
    const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : undefined;
    
    return this.createAdapter(providerName, { apiKey });
  }
  
  /**
   * Clear adapter cache
   */
  public static clearCache(): void {
    this.adapterCache.clear();
    logger.info('Adapter cache cleared');
  }
  
  /**
   * Get all supported providers
   * @returns Array of supported provider names
   */
  public static getSupportedProviders(): string[] {
    return ['oneinch', '1inch', 'universalx', 'custom'];
  }
  
  /**
   * Validate provider configuration
   * @param provider Provider name
   * @param config Configuration to validate
   * @returns Validation result
   */
  public static validateConfig(
    provider: string,
    config: Partial<CrossChainProviderConfig>
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Basic validation
    if (!config.apiUrl) {
      errors.push('apiUrl is required');
    }
    
    if (config.slippageTolerance !== undefined) {
      if (config.slippageTolerance < 0 || config.slippageTolerance > 10000) {
        errors.push('slippageTolerance must be between 0 and 10000 basis points');
      }
    }
    
    if (config.gasMultiplier !== undefined) {
      if (config.gasMultiplier < 1 || config.gasMultiplier > 2) {
        errors.push('gasMultiplier must be between 1 and 2');
      }
    }
    
    // Provider-specific validation
    switch (provider.toLowerCase()) {
      case 'oneinch':
      case '1inch':
        // 1inch specific validation
        if (config.routingPreferences?.maxHops !== undefined) {
          if (config.routingPreferences.maxHops < 1 || config.routingPreferences.maxHops > 5) {
            errors.push('maxHops must be between 1 and 5 for 1inch');
          }
        }
        break;
        
      case 'universalx':
        // UniversalX specific validation
        if (!config.apiKey && !process.env.UNIVERSALX_API_KEY) {
          errors.push('UniversalX requires an API key');
        }
        break;
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
} 