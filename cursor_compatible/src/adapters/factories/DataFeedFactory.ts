/**
 * Data Feed Factory
 * 
 * Unified factory for creating different types of data feeds for the paper trading system.
 * Supports historical, simulated, hybrid, and live mirror feeds.
 */

import { IDataFeed, IDataFeedFactory, DataFeedConfig } from '../interfaces/IDataFeed';
import { HistoricalDataFeed } from '../feeds/HistoricalDataFeed';
import { SimulatedDataFeed, SimulatedMarketConfig } from '../feeds/SimulatedDataFeed';
import { isPaperMode } from '../../config/PaperModeConfig';
import { logger } from '../../utils/logger';

export interface DataFeedFactoryConfig {
  preferredFeedType: 'historical' | 'simulated' | 'hybrid' | 'auto';
  historicalDataPath?: string;
  simulationConfig?: Partial<SimulatedMarketConfig>;
  fallbackToSimulated?: boolean;
}

export class DataFeedFactory implements IDataFeedFactory {
  private static instance: DataFeedFactory;
  private activeFeeds: Map<string, IDataFeed> = new Map();
  private config: DataFeedFactoryConfig;

  constructor(config?: Partial<DataFeedFactoryConfig>) {
    this.config = {
      preferredFeedType: 'auto',
      fallbackToSimulated: true,
      ...config
    };
    
    logger.info('[DATA_FEED_FACTORY] Data feed factory initialized', this.config);
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: Partial<DataFeedFactoryConfig>): DataFeedFactory {
    if (!DataFeedFactory.instance) {
      DataFeedFactory.instance = new DataFeedFactory(config);
    }
    return DataFeedFactory.instance;
  }

  /**
   * Create historical data feed
   */
  async createHistoricalFeed(source: string, config: DataFeedConfig): Promise<IDataFeed> {
    const feedId = `historical_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const feed = new HistoricalDataFeed(feedId);
    
    try {
      // Configure the feed to load data from the specified source
      const enhancedConfig = {
        ...config,
        dataSource: source
      };
      
      await feed.initialize(enhancedConfig);
      
      this.activeFeeds.set(feedId, feed);
      
      logger.info('[DATA_FEED_FACTORY] Historical feed created', {
        feedId,
        source,
        symbols: config.symbols
      });
      
      return feed;
    } catch (error) {
      logger.error('[DATA_FEED_FACTORY] Failed to create historical feed', {
        source,
        error: error instanceof Error ? error.message : error
      });
      
      if (this.config.fallbackToSimulated) {
        logger.info('[DATA_FEED_FACTORY] Falling back to simulated feed');
        return this.createSimulatedFeed(config);
      }
      
      throw error;
    }
  }

  /**
   * Create simulated data feed
   */
  async createSimulatedFeed(config: DataFeedConfig): Promise<IDataFeed> {
    const feedId = `simulated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const feed = new SimulatedDataFeed(feedId, this.config.simulationConfig);
    
    await feed.initialize(config);
    
    this.activeFeeds.set(feedId, feed);
    
    logger.info('[DATA_FEED_FACTORY] Simulated feed created', {
      feedId,
      symbols: config.symbols,
      anomaliesEnabled: config.enableAnomalies
    });
    
    return feed;
  }

  /**
   * Create hybrid feed (historical + simulation)
   */
  async createHybridFeed(historicalSource: string, config: DataFeedConfig): Promise<IDataFeed> {
    // For now, create a historical feed with enhanced simulation
    const feedId = `hybrid_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      // Try to create historical feed first
      const historicalFeed = new HistoricalDataFeed(feedId);
      
      const enhancedConfig = {
        ...config,
        dataSource: historicalSource,
        // Enable more simulation features for hybrid mode
        enableAnomalies: true,
        anomalyFrequency: config.anomalyFrequency || 1.0,
        volatilityMultiplier: config.volatilityMultiplier || 1.2 // Slightly higher volatility
      };
      
      await historicalFeed.initialize(enhancedConfig);
      
      this.activeFeeds.set(feedId, historicalFeed);
      
      logger.info('[DATA_FEED_FACTORY] Hybrid feed created', {
        feedId,
        historicalSource,
        symbols: config.symbols
      });
      
      return historicalFeed;
    } catch (error) {
      logger.warn('[DATA_FEED_FACTORY] Failed to create hybrid feed, falling back to simulated', {
        error: error instanceof Error ? error.message : error
      });
      
      // Fallback to pure simulation
      return this.createSimulatedFeed(config);
    }
  }

  /**
   * Create live mirror feed (not implemented in paper mode)
   */
  async createLiveMirrorFeed(config: DataFeedConfig): Promise<IDataFeed> {
    if (!isPaperMode()) {
      throw new Error('Live mirror feed is only available in production mode');
    }
    
    // In paper mode, return simulated feed as placeholder
    logger.warn('[DATA_FEED_FACTORY] Live mirror feed requested in paper mode, returning simulated feed');
    return this.createSimulatedFeed(config);
  }

  /**
   * Create feed based on auto-detection and configuration
   */
  async createAutoFeed(config: DataFeedConfig): Promise<IDataFeed> {
    const symbols = config.symbols || ['BTC/USDT', 'ETH/USDT'];
    
    // Auto-detect best feed type based on context
    if (this.config.preferredFeedType === 'historical' || 
        (this.config.preferredFeedType === 'auto' && this.config.historicalDataPath)) {
      
      try {
        const source = this.config.historicalDataPath || 'data/historical';
        return await this.createHistoricalFeed(source, config);
      } catch (error) {
        logger.warn('[DATA_FEED_FACTORY] Auto-detection failed for historical feed', error);
      }
    }
    
    if (this.config.preferredFeedType === 'hybrid' ||
        (this.config.preferredFeedType === 'auto' && config.enableAnomalies)) {
      
      try {
        const source = this.config.historicalDataPath || 'data/historical';
        return await this.createHybridFeed(source, config);
      } catch (error) {
        logger.warn('[DATA_FEED_FACTORY] Auto-detection failed for hybrid feed', error);
      }
    }
    
    // Default to simulated feed
    logger.info('[DATA_FEED_FACTORY] Auto-selecting simulated feed');
    return this.createSimulatedFeed(config);
  }

  /**
   * Get active feed by ID
   */
  getFeed(feedId: string): IDataFeed | undefined {
    return this.activeFeeds.get(feedId);
  }

  /**
   * Get all active feeds
   */
  getActiveFeeds(): IDataFeed[] {
    return Array.from(this.activeFeeds.values());
  }

  /**
   * Stop and remove a feed
   */
  async destroyFeed(feedId: string): Promise<void> {
    const feed = this.activeFeeds.get(feedId);
    if (feed) {
      await feed.stop();
      await feed.cleanup();
      this.activeFeeds.delete(feedId);
      
      logger.info('[DATA_FEED_FACTORY] Feed destroyed', { feedId });
    }
  }

  /**
   * Stop and cleanup all feeds
   */
  async cleanup(): Promise<void> {
    logger.info('[DATA_FEED_FACTORY] Cleaning up all feeds', {
      activeFeeds: this.activeFeeds.size
    });
    
    const cleanupPromises = Array.from(this.activeFeeds.entries()).map(
      async ([feedId, feed]) => {
        try {
          await feed.stop();
          await feed.cleanup();
          logger.debug('[DATA_FEED_FACTORY] Feed cleaned up', { feedId });
        } catch (error) {
          logger.warn('[DATA_FEED_FACTORY] Error cleaning up feed', {
            feedId,
            error: error instanceof Error ? error.message : error
          });
        }
      }
    );
    
    await Promise.all(cleanupPromises);
    this.activeFeeds.clear();
    
    logger.info('[DATA_FEED_FACTORY] All feeds cleaned up');
  }

  /**
   * Get factory statistics
   */
  getStatistics(): {
    totalFeeds: number;
    feedsByType: Record<string, number>;
    activeFeeds: Array<{
      feedId: string;
      type: string;
      active: boolean;
      uptime: number;
    }>;
  } {
    const feedsByType: Record<string, number> = {};
    const activeFeeds: Array<{
      feedId: string;
      type: string;
      active: boolean;
      uptime: number;
    }> = [];
    
    for (const [feedId, feed] of this.activeFeeds) {
      const type = feed.getFeedType();
      feedsByType[type] = (feedsByType[type] || 0) + 1;
      
      const stats = feed.getStatistics();
      activeFeeds.push({
        feedId,
        type,
        active: feed.isActive(),
        uptime: stats.uptime
      });
    }
    
    return {
      totalFeeds: this.activeFeeds.size,
      feedsByType,
      activeFeeds
    };
  }

  /**
   * Update factory configuration
   */
  updateConfig(newConfig: Partial<DataFeedFactoryConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('[DATA_FEED_FACTORY] Configuration updated', this.config);
  }
}

/**
 * Convenience functions for common data feed creation patterns
 */

/**
 * Create a simple data feed with auto-detection
 */
export async function createDataFeed(
  symbols: string[],
  config?: Partial<DataFeedConfig>
): Promise<IDataFeed> {
  const factory = DataFeedFactory.getInstance();
  
  const feedConfig: DataFeedConfig = {
    symbols,
    replaySpeed: 1,
    enableAnomalies: true,
    anomalyFrequency: 0.5,
    volatilityMultiplier: 1.0,
    liquidityMultiplier: 1.0,
    ...config
  };
  
  return factory.createAutoFeed(feedConfig);
}

/**
 * Create historical data feed with fallback
 */
export async function createHistoricalDataFeed(
  symbols: string[],
  source: string,
  config?: Partial<DataFeedConfig>
): Promise<IDataFeed> {
  const factory = DataFeedFactory.getInstance({ fallbackToSimulated: true });
  
  const feedConfig: DataFeedConfig = {
    symbols,
    replaySpeed: 1,
    ...config
  };
  
  return factory.createHistoricalFeed(source, feedConfig);
}

/**
 * Create simulated data feed
 */
export async function createSimulatedDataFeed(
  symbols: string[],
  simulationConfig?: Partial<SimulatedMarketConfig>,
  config?: Partial<DataFeedConfig>
): Promise<IDataFeed> {
  const factory = DataFeedFactory.getInstance({ simulationConfig });
  
  const feedConfig: DataFeedConfig = {
    symbols,
    replaySpeed: 1,
    enableAnomalies: true,
    anomalyFrequency: 1.0,
    volatilityMultiplier: 1.0,
    liquidityMultiplier: 1.0,
    ...config
  };
  
  return factory.createSimulatedFeed(feedConfig);
}

/**
 * Create high-frequency simulation feed for stress testing
 */
export async function createHighFrequencySimulationFeed(
  symbols: string[],
  config?: Partial<DataFeedConfig>
): Promise<IDataFeed> {
  const highFreqConfig: Partial<SimulatedMarketConfig> = {
    simulationParameters: {
      volatility: 0.30, // Higher volatility
      microstructureNoise: 0.002 // More noise
    },
    mevConfig: {
      sandwichAttackProbability: 2.0, // More frequent attacks
      frontRunningProbability: 3.0,
      maxSlippageImpact: 0.05, // Higher impact
      maxPriceImpact: 0.02
    },
    liquidity: {
      baseSpread: 0.002, // Wider spreads
      depthMultiplier: 0.7, // Less liquidity
      timeOfDayEffects: true
    }
  };
  
  return createSimulatedDataFeed(symbols, highFreqConfig, {
    replaySpeed: 10, // 10x speed
    anomalyFrequency: 5.0, // 5 anomalies per hour
    volatilityMultiplier: 1.5,
    liquidityMultiplier: 0.5,
    ...config
  });
}

/**
 * Cleanup all data feeds (global cleanup)
 */
export async function cleanupAllDataFeeds(): Promise<void> {
  const factory = DataFeedFactory.getInstance();
  await factory.cleanup();
} 