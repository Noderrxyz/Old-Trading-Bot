import { Command } from 'commander';
import { UniswapV3Feed } from '../feeds/uniswap/uniswap_feed.js';
import { BinanceFeed } from '../feeds/binance/binance_feed.js';
import { FeedConfig, FeedSource } from '../types/MarketSnapshot.types.js';
import { FeedBus } from '../feeds/publishers/FeedBus.js';
import logger from '../utils/logger.js';

const DEFAULT_CONFIG = {
  uniswap_v3: {
    rpcUrl: process.env.ETH_RPC_URL || 'https://mainnet.infura.io/v3/your-api-key',
    contractAddress: process.env.UNISWAP_POOL_ADDRESS,
    pollingIntervalMs: 1000,
    maxRetries: 5,
    retryDelayMs: 5000
  },
  binance: {
    wsUrl: 'wss://stream.binance.com:9443/ws',
    pollingIntervalMs: 1000,
    maxRetries: 5,
    retryDelayMs: 5000
  }
};

export class FeedLauncher {
  private feeds: Map<string, UniswapV3Feed | BinanceFeed>;
  private feedBus: FeedBus;

  constructor() {
    this.feeds = new Map();
    this.feedBus = FeedBus.getInstance();
  }

  public async launchFeed(source: FeedSource, symbol: string): Promise<void> {
    const key = `${source}:${symbol}`;
    
    if (this.feeds.has(key)) {
      logger.warn(`Feed ${key} is already running`);
      return;
    }

    const config: FeedConfig = {
      source,
      symbol,
      ...DEFAULT_CONFIG[source]
    };

    let feed: UniswapV3Feed | BinanceFeed;

    switch (source) {
      case 'uniswap_v3':
        feed = new UniswapV3Feed(config);
        break;
      case 'binance':
        feed = new BinanceFeed(config);
        break;
      default:
        throw new Error(`Unsupported feed source: ${source}`);
    }

    this.feeds.set(key, feed);
    await feed.start();

    // Subscribe to feed events
    this.feedBus.subscribe((snapshot) => {
      if (snapshot.source === source && snapshot.symbol === symbol) {
        this.logFeedStats(snapshot);
      }
    });
  }

  public stopFeed(source: FeedSource, symbol: string): void {
    const key = `${source}:${symbol}`;
    const feed = this.feeds.get(key);

    if (feed) {
      feed.stop();
      this.feeds.delete(key);
      logger.info(`Stopped feed ${key}`);
    }
  }

  public stopAllFeeds(): void {
    for (const [key, feed] of this.feeds.entries()) {
      feed.stop();
      logger.info(`Stopped feed ${key}`);
    }
    this.feeds.clear();
  }

  private logFeedStats(snapshot: any): void {
    const stats = this.feedBus.getStats(snapshot.source, snapshot.symbol);
    if (stats) {
      const latency = stats.latencyMs.toFixed(0);
      const status = stats.latencyMs < 1000 ? '🟢' : '🟡';
      console.log(`${status} ${snapshot.source} | ${snapshot.symbol} | ${latency}ms latency`);
    }
  }
}

// CLI setup
const program = new Command();

program
  .name('feed-launcher')
  .description('Launch and manage market data feeds')
  .version('1.0.0');

program
  .command('start')
  .description('Start one or more feeds')
  .option('-d, --dex <source>', 'DEX feed source (uniswap_v3)')
  .option('-c, --cex <source>', 'CEX feed source (binance)')
  .option('-s, --symbol <symbol>', 'Trading pair symbol (e.g., ETH/USDC)')
  .action(async (options) => {
    const launcher = new FeedLauncher();
    const symbol = options.symbol || 'ETH/USDC';

    try {
      if (options.dex) {
        await launcher.launchFeed('uniswap_v3', symbol);
      }
      if (options.cex) {
        await launcher.launchFeed('binance', symbol);
      }
    } catch (error) {
      logger.error('Error starting feeds:', error);
      process.exit(1);
    }
  });

program
  .command('stop')
  .description('Stop one or more feeds')
  .option('-d, --dex <source>', 'DEX feed source (uniswap_v3)')
  .option('-c, --cex <source>', 'CEX feed source (binance)')
  .option('-s, --symbol <symbol>', 'Trading pair symbol (e.g., ETH/USDC)')
  .action((options) => {
    const launcher = new FeedLauncher();
    const symbol = options.symbol || 'ETH/USDC';

    if (options.dex) {
      launcher.stopFeed('uniswap_v3', symbol);
    }
    if (options.cex) {
      launcher.stopFeed('binance', symbol);
    }
  });

program
  .command('stop-all')
  .description('Stop all running feeds')
  .action(() => {
    const launcher = new FeedLauncher();
    launcher.stopAllFeeds();
  });

program.parse(process.argv); 