import { EnhancedPaperTradingAdapter } from '../execution/adapters/EnhancedPaperTradingAdapter';
import { SlippageModel } from '../execution/interfaces/PaperTradingTypes';
import { createEnhancedConsoleDashboard } from '../dashboard/EnhancedPaperTradingDashboard';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Configuration for 24/7 paper trading
 */
interface PaperTradingConfig24x7 {
  symbols: string[];
  initialBalance: number;
  dataDir: string;
  checkpointIntervalMs: number;
  logStatisticsIntervalMs: number;
  marketDataUpdateIntervalMs: number;
  slippageModel: SlippageModel;
  commissionRates: Record<string, number>;
  enableDashboard: boolean;
  maxPositionSizePercent: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: PaperTradingConfig24x7 = {
  symbols: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'ADA/USD', 'XRP/USD'],
  initialBalance: 100000,
  dataDir: path.join(process.cwd(), 'data', 'paper_trading'),
  checkpointIntervalMs: 5 * 60 * 1000, // 5 minutes
  logStatisticsIntervalMs: 15 * 60 * 1000, // 15 minutes
  marketDataUpdateIntervalMs: 10 * 1000, // 10 seconds
  slippageModel: SlippageModel.SizeDependent,
  commissionRates: {
    'binance': 0.1,
    'coinbase': 0.5,
    'kraken': 0.26
  },
  enableDashboard: true,
  maxPositionSizePercent: 15
};

/**
 * Class to manage 24/7 paper trading
 */
class PaperTrading24x7 {
  private adapter: EnhancedPaperTradingAdapter;
  private dashboard: any;
  private config: PaperTradingConfig24x7;
  private startTime: number;
  private isRunning: boolean = false;
  private statisticsInterval: NodeJS.Timeout | null = null;
  private lastRestartTime: number = 0;
  private restartCount: number = 0;
  private watchdogInterval: NodeJS.Timeout | null = null;
  
  constructor(config: Partial<PaperTradingConfig24x7> = {}) {
    // Merge config with defaults
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Ensure data directory exists
    this.ensureDirectoryExists(this.config.dataDir);
    
    // Initialize adapter
    this.adapter = EnhancedPaperTradingAdapter.getEnhancedInstance({
      initialBalance: this.config.initialBalance,
      defaultSlippageModel: this.config.slippageModel,
      commissionRates: this.config.commissionRates,
      maxPositionSizePercent: this.config.maxPositionSizePercent,
      defaultLatencyMs: 150,
      enforceRealisticConstraints: true,
      orderFillProbability: 0.98,
      verboseLogging: true
    });
    
    // Initialize dashboard if enabled
    if (this.config.enableDashboard) {
      this.dashboard = createEnhancedConsoleDashboard(this.adapter);
    }
    
    this.startTime = Date.now();
    
    logger.info(`PaperTrading24x7 initialized with ${this.config.symbols.length} symbols`);
  }
  
  /**
   * Start paper trading
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Paper trading is already running');
      return;
    }
    
    try {
      this.isRunning = true;
      logger.info('Starting 24/7 paper trading...');
      
      // Start the dashboard if enabled
      if (this.dashboard) {
        this.dashboard.start(1000);
      }
      
      // Configure autosave
      this.adapter.startAutosave(this.config.checkpointIntervalMs);
      
      // Start market data streams
      for (const symbol of this.config.symbols) {
        this.adapter.addMarketDataStream(symbol, this.config.marketDataUpdateIntervalMs);
      }
      
      // Start the streams
      this.adapter.startMarketDataStreams();
      
      // Set up statistics logging
      this.startStatisticsLogging();
      
      // Set up watchdog for system health monitoring
      this.startWatchdog();
      
      // Initial statistics log
      this.logStatistics();
      
      logger.info('Paper trading system is now running 24/7');
    } catch (error) {
      this.isRunning = false;
      logger.error(`Failed to start paper trading: ${error}`);
      throw error;
    }
  }
  
  /**
   * Stop paper trading
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Paper trading is not running');
      return;
    }
    
    try {
      // Stop statistics logging
      if (this.statisticsInterval) {
        clearInterval(this.statisticsInterval);
        this.statisticsInterval = null;
      }
      
      // Stop watchdog
      if (this.watchdogInterval) {
        clearInterval(this.watchdogInterval);
        this.watchdogInterval = null;
      }
      
      // Stop market data streams
      this.adapter.stopMarketDataStreams();
      
      // Stop dashboard
      if (this.dashboard) {
        this.dashboard.stop();
      }
      
      // Final log and checkpoint
      await this.logStatistics();
      
      // Shutdown adapter
      await this.adapter.shutdown();
      
      this.isRunning = false;
      logger.info('Paper trading system stopped');
    } catch (error) {
      logger.error(`Error stopping paper trading: ${error}`);
      throw error;
    }
  }
  
  /**
   * Restart paper trading
   */
  public async restart(): Promise<void> {
    try {
      logger.info('Restarting paper trading system...');
      
      // Track restart
      this.lastRestartTime = Date.now();
      this.restartCount++;
      
      // Stop first
      await this.stop();
      
      // Short delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Start again
      await this.start();
      
      logger.info(`Paper trading system restarted successfully (count: ${this.restartCount})`);
    } catch (error) {
      logger.error(`Failed to restart paper trading: ${error}`);
      throw error;
    }
  }
  
  /**
   * Start statistics logging
   */
  private startStatisticsLogging(): void {
    // Clear any existing interval
    if (this.statisticsInterval) {
      clearInterval(this.statisticsInterval);
    }
    
    // Set new interval
    this.statisticsInterval = setInterval(() => {
      this.logStatistics();
    }, this.config.logStatisticsIntervalMs);
  }
  
  /**
   * Log statistics
   */
  private async logStatistics(): Promise<void> {
    try {
      // Get portfolio data
      const portfolio = this.adapter.getPortfolioSnapshot();
      
      // Get system metrics
      const metrics = this.adapter.getSystemMetrics();
      
      // Calculate uptime
      const uptimeMs = Date.now() - this.startTime;
      const uptimeDays = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
      const uptimeHours = Math.floor((uptimeMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
      
      // Log to console
      logger.info('==== PAPER TRADING SYSTEM STATISTICS ====');
      logger.info(`Uptime: ${uptimeDays}d ${uptimeHours}h ${uptimeMinutes}m`);
      logger.info(`Portfolio Value: $${portfolio.portfolioValue.toFixed(2)}`);
      logger.info(`Cash Balance: $${portfolio.cashBalance.toFixed(2)}`);
      logger.info(`Total P&L: $${portfolio.totalPnl.toFixed(2)}`);
      logger.info(`Position Count: ${portfolio.positions.length}`);
      logger.info(`Operations: ${metrics.operationsSinceStart}, Trades: ${metrics.tradesExecuted}`);
      logger.info(`Errors: ${metrics.errorCount}, Restarts: ${this.restartCount}`);
      logger.info('=========================================');
      
      // Also save statistics to file
      const statsFile = path.join(this.config.dataDir, 'statistics.json');
      
      // Load existing stats if file exists
      let stats: any[] = [];
      if (fs.existsSync(statsFile)) {
        try {
          stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
        } catch (e) {
          logger.warn(`Could not parse statistics file: ${e}`);
          stats = [];
        }
      }
      
      // Add new stats
      stats.push({
        timestamp: new Date(),
        uptime: {
          days: uptimeDays,
          hours: uptimeHours,
          minutes: uptimeMinutes,
          totalMs: uptimeMs
        },
        portfolio: {
          value: portfolio.portfolioValue,
          cashBalance: portfolio.cashBalance,
          totalPnl: portfolio.totalPnl,
          positionCount: portfolio.positions.length
        },
        system: {
          ...metrics,
          restartCount: this.restartCount
        }
      });
      
      // Keep only last 1000 stats
      if (stats.length > 1000) {
        stats = stats.slice(-1000);
      }
      
      // Save
      fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
    } catch (error) {
      logger.error(`Error logging statistics: ${error}`);
    }
  }
  
  /**
   * Start watchdog for system health monitoring
   */
  private startWatchdog(): void {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
    }
    
    // Run watchdog check every minute
    this.watchdogInterval = setInterval(() => {
      this.checkSystemHealth();
    }, 60000);
  }
  
  /**
   * Check system health and restart if needed
   */
  private checkSystemHealth(): void {
    try {
      // Get system metrics
      const metrics = this.adapter.getSystemMetrics();
      
      // Check for error increase
      const errorThreshold = 10;
      if (metrics.errorCount > errorThreshold) {
        logger.warn(`Error count (${metrics.errorCount}) exceeds threshold, restarting...`);
        this.restart();
        return;
      }
      
      // Check last operation time
      const lastCheckpointAge = Date.now() - (this.adapter as any).lastCheckpointTime;
      if (lastCheckpointAge > this.config.checkpointIntervalMs * 3) {
        logger.warn(`No checkpoints in ${Math.floor(lastCheckpointAge / 1000)}s, restarting...`);
        this.restart();
        return;
      }
      
      // Memory usage check
      const memoryUsage = process.memoryUsage();
      const memoryThresholdMB = 1024; // 1GB
      if (memoryUsage.heapUsed / 1024 / 1024 > memoryThresholdMB) {
        logger.warn(`Memory usage (${Math.floor(memoryUsage.heapUsed / 1024 / 1024)}MB) exceeds threshold, restarting...`);
        this.restart();
        return;
      }
      
      // Everything looks good
      logger.debug('System health check passed');
    } catch (error) {
      logger.error(`Error in system health check: ${error}`);
    }
  }
  
  /**
   * Ensure directory exists
   */
  private ensureDirectoryExists(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info(`Created directory: ${dir}`);
    }
  }
  
  /**
   * Get running status
   */
  public isSystemRunning(): boolean {
    return this.isRunning;
  }
  
  /**
   * Get system status
   */
  public getSystemStatus(): any {
    const now = Date.now();
    const uptime = now - this.startTime;
    
    return {
      isRunning: this.isRunning,
      uptime,
      uptimeFormatted: this.formatUptime(uptime),
      startTime: new Date(this.startTime),
      restartCount: this.restartCount,
      lastRestartTime: this.lastRestartTime ? new Date(this.lastRestartTime) : null,
      systemMetrics: this.adapter.getSystemMetrics(),
      symbols: this.config.symbols
    };
  }
  
  /**
   * Format uptime
   */
  private formatUptime(uptimeMs: number): string {
    const seconds = Math.floor(uptimeMs / 1000) % 60;
    const minutes = Math.floor(uptimeMs / (1000 * 60)) % 60;
    const hours = Math.floor(uptimeMs / (1000 * 60 * 60)) % 24;
    const days = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
    
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  }
}

/**
 * Main function to run paper trading 24/7
 */
async function main() {
  logger.info('Initializing 24/7 paper trading system');
  
  // Create instance with configuration
  const paperTrading = new PaperTrading24x7({
    initialBalance: 100000,
    symbols: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'ADA/USD', 'XRP/USD', 'DOT/USD'],
    marketDataUpdateIntervalMs: 5000 // 5 seconds for faster simulation
  });
  
  // Set up signal handlers for graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    await paperTrading.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    await paperTrading.stop();
    process.exit(0);
  });
  
  try {
    // Start paper trading
    await paperTrading.start();
    
    logger.info('24/7 paper trading system running');
    logger.info('Press Ctrl+C to exit');
  } catch (error) {
    logger.error(`Failed to start 24/7 paper trading: ${error}`);
    process.exit(1);
  }
}

// Run if this is the main module
if (require.main === module) {
  main().catch(error => {
    logger.error(`Unhandled error in main: ${error}`);
    process.exit(1);
  });
}

export { PaperTrading24x7 }; 