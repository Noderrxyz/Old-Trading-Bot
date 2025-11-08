import { FeedConfig, FeedSource } from '../../types/MarketSnapshot.types.js';
import { DataPipelineService, DataPoint } from './DataPipelineService.js';
import { UniswapV3Feed } from '../../feeds/uniswap/uniswap_feed.js';
import { BinanceFeed } from '../../feeds/binance/binance_feed.js';
import { createLogger } from '../../common/logger.js';

const logger = createLogger('MarketDataIngestionService');

export class MarketDataIngestionService {
  private feeds: any[] = [];
  private configs: FeedConfig[];
  private pipeline: DataPipelineService;
  private isRunning = false;

  constructor(configs: FeedConfig[], pipeline: DataPipelineService) {
    this.configs = configs;
    this.pipeline = pipeline;
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    logger.info('Starting MarketDataIngestionService...');
    for (const config of this.configs) {
      try {
        let feed: any;
        switch (config.source) {
          case 'uniswap_v3':
            feed = new UniswapV3Feed(config);
            break;
          case 'binance':
            feed = new BinanceFeed(config);
            break;
          default:
            logger.warn(`Unsupported feed source: ${config.source}`);
            continue;
        }
        feed.feedBus.subscribe(async (snapshot: any) => {
          try {
            const dataPoint = this.normalizeSnapshotToDataPoint(snapshot, config.source);
            await this.pipeline.processDataPoint(dataPoint);
            logger.debug(`Ingested data from ${config.source} for ${config.symbol}`);
          } catch (err) {
            logger.error(`Error processing data from ${config.source}:`, err);
          }
        });
        await feed.start?.();
        this.feeds.push(feed);
        logger.info(`Started feed for ${config.source} - ${config.symbol}`);
      } catch (err) {
        logger.error(`Failed to start feed for ${config.source}:`, err);
      }
    }
    this.isRunning = true;
  }

  public async stop(): Promise<void> {
    logger.info('Stopping MarketDataIngestionService...');
    for (const feed of this.feeds) {
      try {
        await feed.stop?.();
      } catch (err) {
        logger.error('Error stopping feed:', err);
      }
    }
    this.feeds = [];
    this.isRunning = false;
  }

  private normalizeSnapshotToDataPoint(snapshot: any, source: FeedSource): DataPoint {
    // Normalize snapshot from any feed to DataPoint
    // Extend this logic as new feeds are added
    switch (source) {
      case 'binance':
        return {
          timestamp: new Date(snapshot.timestamp),
          symbol: snapshot.symbol,
          price: snapshot.lastPrice,
          volume: snapshot.lastSize || 0,
          liquidity: snapshot.liquidity || 0,
          volatility: snapshot.volatility || 0,
          orderbook: snapshot.orderbook,
          trades: snapshot.trades,
          metadata: { source: 'binance', ...snapshot }
        };
      case 'uniswap_v3':
        return {
          timestamp: new Date(snapshot.timestamp),
          symbol: snapshot.symbol,
          price: snapshot.lastPrice || 0,
          volume: snapshot.lastSize || 0,
          liquidity: snapshot.liquidity || 0,
          volatility: snapshot.volatility || 0,
          orderbook: snapshot.orderbook,
          trades: snapshot.trades,
          metadata: { source: 'uniswap_v3', ...snapshot }
        };
      default:
        throw new Error(`Unsupported feed source for normalization: ${source}`);
    }
  }
} 