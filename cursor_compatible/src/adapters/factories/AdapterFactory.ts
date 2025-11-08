/**
 * Adapter Factory
 * 
 * Factory pattern implementation for seamless switching between
 * real and mock adapters based on paper mode configuration.
 */

import { IExchangeConnector } from '../interfaces/IExchangeConnector';
import { IRPCProvider } from '../interfaces/IRPCProvider';
import { isPaperMode, logPaperModeCall } from '../../config/PaperModeConfig';
import { MockExchangeConnector } from '../mock/MockExchangeConnector';
import { MockRPCProvider } from '../mock/MockRPCProvider';
import { logger } from '../../utils/logger';

/**
 * Exchange Connector Factory
 */
export class ExchangeConnectorFactory {
  private static mockInstances: Map<string, MockExchangeConnector> = new Map();
  
  /**
   * Create exchange connector based on paper mode setting
   */
  public static createExchangeConnector(
    exchangeId: string, 
    exchangeName: string,
    config?: any
  ): IExchangeConnector {
    logPaperModeCall('ExchangeConnectorFactory', 'createExchangeConnector', {
      exchangeId,
      exchangeName,
      paperMode: isPaperMode()
    });
    
    if (isPaperMode()) {
      // Return mock exchange connector
      let mockInstance = this.mockInstances.get(exchangeId);
      if (!mockInstance) {
        mockInstance = new MockExchangeConnector(exchangeId, exchangeName);
        this.mockInstances.set(exchangeId, mockInstance);
        
        logger.info(`[PAPER_MODE] Created mock exchange connector: ${exchangeName}`, {
          exchangeId,
          totalMockInstances: this.mockInstances.size
        });
      }
      
      return mockInstance;
    } else {
      // Return real exchange connector
      // TODO: Implement real exchange connector creation
      // This would integrate with actual exchange APIs (ccxt, direct APIs, etc.)
      
      logger.warn(`[PRODUCTION MODE] Real exchange connector not yet implemented for ${exchangeName}`, {
        exchangeId,
        config
      });
      
      // For now, throw error to prevent accidental production usage
      throw new Error(`Real exchange connector not implemented for ${exchangeId}. Set PAPER_MODE=true for simulation.`);
      
      // Future implementation:
      // switch (exchangeId.toLowerCase()) {
      //   case 'binance':
      //     return new BinanceConnector(config);
      //   case 'coinbase':
      //     return new CoinbaseConnector(config);
      //   case 'uniswap':
      //     return new UniswapConnector(config);
      //   default:
      //     throw new Error(`Unsupported exchange: ${exchangeId}`);
      // }
    }
  }
  
  /**
   * Create multiple exchange connectors
   */
  public static createMultipleExchangeConnectors(
    exchanges: Array<{ id: string; name: string; config?: any }>
  ): IExchangeConnector[] {
    logPaperModeCall('ExchangeConnectorFactory', 'createMultipleExchangeConnectors', {
      exchangeCount: exchanges.length,
      paperMode: isPaperMode()
    });
    
    return exchanges.map(exchange => 
      this.createExchangeConnector(exchange.id, exchange.name, exchange.config)
    );
  }
  
  /**
   * Get all active mock instances (for testing/debugging)
   */
  public static getMockInstances(): Map<string, MockExchangeConnector> {
    return new Map(this.mockInstances);
  }
  
  /**
   * Cleanup all mock instances
   */
  public static cleanup(): void {
    logger.info(`[PAPER_MODE] Cleaning up ${this.mockInstances.size} exchange connector instances`);
    
    for (const [exchangeId, mockInstance] of this.mockInstances) {
      try {
        mockInstance.cleanup();
        logger.debug(`[PAPER_MODE] Cleaned up exchange connector: ${exchangeId}`);
      } catch (error) {
        logger.warn(`[PAPER_MODE] Error cleaning up exchange connector ${exchangeId}:`, error);
      }
    }
    
    this.mockInstances.clear();
    logger.info(`[PAPER_MODE] Exchange connector factory cleanup completed`);
  }
}

/**
 * RPC Provider Factory
 */
export class RPCProviderFactory {
  private static mockInstances: Map<string, MockRPCProvider> = new Map();
  
  /**
   * Create RPC provider based on paper mode setting
   */
  public static createRPCProvider(
    providerId: string,
    providerName: string,
    chainId: number = 1,
    networkId: number = 1,
    config?: any
  ): IRPCProvider {
    logPaperModeCall('RPCProviderFactory', 'createRPCProvider', {
      providerId,
      providerName,
      chainId,
      paperMode: isPaperMode()
    });
    
    if (isPaperMode()) {
      // Return mock RPC provider
      const instanceKey = `${providerId}-${chainId}`;
      let mockInstance = this.mockInstances.get(instanceKey);
      
      if (!mockInstance) {
        mockInstance = new MockRPCProvider(providerId, providerName, chainId, networkId);
        this.mockInstances.set(instanceKey, mockInstance);
        
        logger.info(`[PAPER_MODE] Created mock RPC provider: ${providerName}`, {
          providerId,
          chainId,
          networkId,
          totalMockInstances: this.mockInstances.size
        });
      }
      
      return mockInstance;
    } else {
      // Return real RPC provider
      // TODO: Implement real RPC provider creation
      // This would integrate with actual RPC providers (Infura, Alchemy, etc.)
      
      logger.warn(`[PRODUCTION MODE] Real RPC provider not yet implemented for ${providerName}`, {
        providerId,
        chainId,
        config
      });
      
      // For now, throw error to prevent accidental production usage
      throw new Error(`Real RPC provider not implemented for ${providerId}. Set PAPER_MODE=true for simulation.`);
      
      // Future implementation:
      // switch (providerId.toLowerCase()) {
      //   case 'infura':
      //     return new InfuraProvider(config.apiKey, chainId);
      //   case 'alchemy':
      //     return new AlchemyProvider(config.apiKey, chainId);
      //   case 'local':
      //     return new JsonRpcProvider(config.url);
      //   default:
      //     throw new Error(`Unsupported RPC provider: ${providerId}`);
      // }
    }
  }
  
  /**
   * Create RPC provider for specific chain
   */
  public static createRPCProviderForChain(
    chainId: number,
    preferredProvider?: string,
    config?: any
  ): IRPCProvider {
    const chainConfigs = {
      1: { id: 'ethereum', name: 'Ethereum Mainnet', networkId: 1 },
      137: { id: 'polygon', name: 'Polygon Mainnet', networkId: 137 },
      42161: { id: 'arbitrum', name: 'Arbitrum One', networkId: 42161 },
      43114: { id: 'avalanche', name: 'Avalanche C-Chain', networkId: 43114 },
      56: { id: 'binance', name: 'Binance Smart Chain', networkId: 56 }
    };
    
    const chainConfig = chainConfigs[chainId as keyof typeof chainConfigs];
    if (!chainConfig) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }
    
    const providerId = preferredProvider || `${chainConfig.id}_rpc`;
    const providerName = `${chainConfig.name} RPC Provider`;
    
    return this.createRPCProvider(
      providerId,
      providerName,
      chainId,
      chainConfig.networkId,
      config
    );
  }
  
  /**
   * Create multiple RPC providers for different chains
   */
  public static createMultipleRPCProviders(
    chains: Array<{ chainId: number; providerId?: string; config?: any }>
  ): IRPCProvider[] {
    logPaperModeCall('RPCProviderFactory', 'createMultipleRPCProviders', {
      chainCount: chains.length,
      paperMode: isPaperMode()
    });
    
    return chains.map(chain => 
      this.createRPCProviderForChain(chain.chainId, chain.providerId, chain.config)
    );
  }
  
  /**
   * Get all active mock instances (for testing/debugging)
   */
  public static getMockInstances(): Map<string, MockRPCProvider> {
    return new Map(this.mockInstances);
  }
  
  /**
   * Cleanup all mock instances
   */
  public static cleanup(): void {
    logger.info(`[PAPER_MODE] Cleaning up ${this.mockInstances.size} RPC provider instances`);
    
    for (const [instanceKey, mockInstance] of this.mockInstances) {
      try {
        mockInstance.cleanup();
        logger.debug(`[PAPER_MODE] Cleaned up RPC provider: ${instanceKey}`);
      } catch (error) {
        logger.warn(`[PAPER_MODE] Error cleaning up RPC provider ${instanceKey}:`, error);
      }
    }
    
    this.mockInstances.clear();
    logger.info(`[PAPER_MODE] RPC provider factory cleanup completed`);
  }
}

/**
 * Convenience functions for common adapter creation patterns
 */

/**
 * Create exchange connector using simplified API
 */
export function getExchangeConnector(
  exchangeId: string, 
  exchangeName?: string,
  config?: any
): IExchangeConnector {
  const name = exchangeName || exchangeId.charAt(0).toUpperCase() + exchangeId.slice(1);
  return ExchangeConnectorFactory.createExchangeConnector(exchangeId, name, config);
}

/**
 * Create RPC provider using simplified API
 */
export function getRPCProvider(
  chainIdOrProviderId: number | string,
  config?: any
): IRPCProvider {
  if (typeof chainIdOrProviderId === 'number') {
    return RPCProviderFactory.createRPCProviderForChain(chainIdOrProviderId, undefined, config);
  } else {
    return RPCProviderFactory.createRPCProvider(
      chainIdOrProviderId,
      `${chainIdOrProviderId} Provider`,
      1,
      1,
      config
    );
  }
}

/**
 * Create common exchange connectors
 */
export function createCommonExchangeConnectors(): IExchangeConnector[] {
  const commonExchanges = [
    { id: 'binance', name: 'Binance' },
    { id: 'coinbase', name: 'Coinbase Pro' },
    { id: 'uniswap', name: 'Uniswap V3' },
    { id: 'sushiswap', name: 'SushiSwap' },
    { id: '1inch', name: '1inch' }
  ];
  
  return ExchangeConnectorFactory.createMultipleExchangeConnectors(commonExchanges);
}

/**
 * Create common RPC providers for major chains
 */
export function createCommonRPCProviders(): IRPCProvider[] {
  const commonChains = [
    { chainId: 1 },    // Ethereum
    { chainId: 137 },  // Polygon
    { chainId: 42161 }, // Arbitrum
    { chainId: 43114 }, // Avalanche
    { chainId: 56 }    // BSC
  ];
  
  return RPCProviderFactory.createMultipleRPCProviders(commonChains);
}

/**
 * Global cleanup function for all adapters
 */
export function cleanupAllAdapters(): void {
  logger.info('[PAPER_MODE] Cleaning up all adapter factories');
  
  ExchangeConnectorFactory.cleanup();
  RPCProviderFactory.cleanup();
  
  logger.info('[PAPER_MODE] All adapter factories cleaned up');
}

/**
 * Adapter factory statistics
 */
export function getAdapterStatistics(): {
  paperMode: boolean;
  exchangeConnectors: number;
  rpcProviders: number;
  totalAdapters: number;
} {
  const exchangeCount = ExchangeConnectorFactory.getMockInstances().size;
  const rpcCount = RPCProviderFactory.getMockInstances().size;
  
  return {
    paperMode: isPaperMode(),
    exchangeConnectors: exchangeCount,
    rpcProviders: rpcCount,
    totalAdapters: exchangeCount + rpcCount
  };
} 