import { logger } from '../utils/logger.js';
import { Order, OrderType } from '../execution/types/execution.types.js';
import { GasEstimator } from '../execution/gas_estimator.js';
import { VenueLiquidityTracker } from '../execution/venue_liquidity_tracker.js';
import { ExecutionStrategyRouter } from '../execution/ExecutionStrategyRouter.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Arbitrage scanner configuration
 */
export interface ArbitrageScannerConfig {
  minProfitThreshold: number;
  maxSlippage: number;
  maxGasCost: number;
  minLiquidity: number;
  scanIntervalMs: number;
  logFilePath: string;
}

/**
 * Default arbitrage scanner configuration
 */
export const DEFAULT_ARBITRAGE_SCANNER_CONFIG: ArbitrageScannerConfig = {
  minProfitThreshold: 0.005, // 0.5%
  maxSlippage: 0.001, // 0.1%
  maxGasCost: 0.0001, // 0.01 ETH
  minLiquidity: 1000,
  scanIntervalMs: 5000, // 5 seconds
  logFilePath: 'arbitrage_attempts.jsonl'
};

/**
 * Arbitrage opportunity
 */
interface ArbitrageOpportunity {
  symbol: string;
  buyVenue: string;
  sellVenue: string;
  buyPrice: number;
  sellPrice: number;
  amount: number;
  expectedProfit: number;
  gasCost: number;
  timestamp: number;
}

/**
 * Arbitrage Scanner
 */
export class ArbitrageScanner {
  private static instance: ArbitrageScanner | null = null;
  private config: ArbitrageScannerConfig;
  private gasEstimator: GasEstimator;
  private liquidityTracker: VenueLiquidityTracker;
  private executionRouter: ExecutionStrategyRouter;
  private scanInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private logStream: fs.WriteStream | null = null;

  private constructor(config: Partial<ArbitrageScannerConfig> = {}) {
    this.config = { ...DEFAULT_ARBITRAGE_SCANNER_CONFIG, ...config };
    this.gasEstimator = GasEstimator.getInstance();
    this.liquidityTracker = VenueLiquidityTracker.getInstance();
    this.executionRouter = ExecutionStrategyRouter.getInstance();
    this.setupLogStream();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<ArbitrageScannerConfig>): ArbitrageScanner {
    if (!ArbitrageScanner.instance) {
      ArbitrageScanner.instance = new ArbitrageScanner(config);
    }
    return ArbitrageScanner.instance;
  }

  /**
   * Start the arbitrage scanner
   */
  public start(): void {
    if (this.isRunning) {
      logger.info('Arbitrage scanner is already running');
      return;
    }

    this.isRunning = true;
    this.scanInterval = setInterval(
      () => this.scanOpportunities(),
      this.config.scanIntervalMs
    );

    logger.info('Arbitrage scanner started');
  }

  /**
   * Stop the arbitrage scanner
   */
  public stop(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }

    this.isRunning = false;
    this.closeLogStream();

    logger.info('Arbitrage scanner stopped');
  }

  /**
   * Scan for arbitrage opportunities
   */
  private async scanOpportunities(): Promise<void> {
    try {
      // TODO: Implement actual venue price fetching
      // This is a placeholder that should be replaced with real venue API calls
      const venues = ['venue1', 'venue2', 'venue3'];
      const symbols = ['BTC/USD', 'ETH/USD'];

      for (const symbol of symbols) {
        const prices = await this.getVenuePrices(venues, symbol);
        const opportunities = this.findArbitrageOpportunities(symbol, prices);

        for (const opportunity of opportunities) {
          if (await this.isOpportunityValid(opportunity)) {
            await this.executeArbitrage(opportunity);
          }
        }
      }
    } catch (error) {
      logger.error('Error scanning for arbitrage opportunities:', error);
    }
  }

  /**
   * Get prices from all venues
   */
  private async getVenuePrices(
    venues: string[],
    symbol: string
  ): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    for (const venue of venues) {
      // TODO: Implement actual price fetching
      // This is a placeholder that should be replaced with real venue API calls
      prices.set(venue, Math.random() * 1000); // Example price
    }

    return prices;
  }

  /**
   * Find arbitrage opportunities
   */
  private findArbitrageOpportunities(
    symbol: string,
    prices: Map<string, number>
  ): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];
    const venues = Array.from(prices.keys());

    for (let i = 0; i < venues.length; i++) {
      for (let j = i + 1; j < venues.length; j++) {
        const venue1 = venues[i];
        const venue2 = venues[j];
        const price1 = prices.get(venue1)!;
        const price2 = prices.get(venue2)!;

        if (price1 < price2) {
          opportunities.push({
            symbol,
            buyVenue: venue1,
            sellVenue: venue2,
            buyPrice: price1,
            sellPrice: price2,
            amount: this.config.minLiquidity,
            expectedProfit: (price2 - price1) / price1,
            gasCost: 0, // Will be calculated later
            timestamp: Date.now()
          });
        }
      }
    }

    return opportunities;
  }

  /**
   * Check if an arbitrage opportunity is valid
   */
  private async isOpportunityValid(
    opportunity: ArbitrageOpportunity
  ): Promise<boolean> {
    // Check profit threshold
    if (opportunity.expectedProfit < this.config.minProfitThreshold) {
      return false;
    }

    // Check liquidity
    const buyLiquidity = await this.liquidityTracker.getLiquidity(
      opportunity.buyVenue,
      opportunity.symbol
    );
    const sellLiquidity = await this.liquidityTracker.getLiquidity(
      opportunity.sellVenue,
      opportunity.symbol
    );

    if (
      buyLiquidity < this.config.minLiquidity ||
      sellLiquidity < this.config.minLiquidity
    ) {
      return false;
    }

    // Check gas cost
    const gasCost = await this.estimateGasCost(opportunity);
    if (gasCost > this.config.maxGasCost) {
      return false;
    }

    opportunity.gasCost = gasCost;
    return true;
  }

  /**
   * Estimate gas cost for arbitrage
   */
  private async estimateGasCost(
    opportunity: ArbitrageOpportunity
  ): Promise<number> {
    const buyOrder: Order = {
      id: `arb_buy_${Date.now()}`,
      symbol: opportunity.symbol,
      venue: opportunity.buyVenue,
      type: OrderType.Market,
      side: 'buy',
      amount: opportunity.amount,
      timestamp: Date.now()
    };

    const sellOrder: Order = {
      id: `arb_sell_${Date.now()}`,
      symbol: opportunity.symbol,
      venue: opportunity.sellVenue,
      type: OrderType.Market,
      side: 'sell',
      amount: opportunity.amount,
      timestamp: Date.now()
    };

    const buyGas = await this.gasEstimator.estimateGas(buyOrder);
    const sellGas = await this.gasEstimator.estimateGas(sellOrder);
    const gasPrice = await this.gasEstimator.getCurrentGasPrice();

    return (buyGas + sellGas) * gasPrice;
  }

  /**
   * Execute arbitrage opportunity
   */
  private async executeArbitrage(opportunity: ArbitrageOpportunity): Promise<void> {
    try {
      const buyOrder: Order = {
        id: `arb_buy_${Date.now()}`,
        symbol: opportunity.symbol,
        venue: opportunity.buyVenue,
        type: OrderType.Market,
        side: 'buy',
        amount: opportunity.amount,
        timestamp: Date.now()
      };

      const sellOrder: Order = {
        id: `arb_sell_${Date.now()}`,
        symbol: opportunity.symbol,
        venue: opportunity.sellVenue,
        type: OrderType.Market,
        side: 'sell',
        amount: opportunity.amount,
        timestamp: Date.now()
      };

      // Execute buy order
      await this.executionRouter.execute(buyOrder, () => {
        // Execute sell order after buy is complete
        this.executionRouter.execute(sellOrder, () => {
          this.logArbitrageAttempt(opportunity, true);
        });
      });

      logger.info(`Executing arbitrage: ${JSON.stringify(opportunity)}`);
    } catch (error) {
      logger.error('Error executing arbitrage:', error);
      this.logArbitrageAttempt(opportunity, false, error);
    }
  }

  /**
   * Log arbitrage attempt
   */
  private logArbitrageAttempt(
    opportunity: ArbitrageOpportunity,
    success: boolean,
    error?: any
  ): void {
    if (!this.logStream) return;

    const logEntry = {
      ...opportunity,
      success,
      error: error ? error.message : null,
      timestamp: Date.now()
    };

    this.logStream.write(JSON.stringify(logEntry) + '\n');
  }

  /**
   * Setup log stream
   */
  private setupLogStream(): void {
    try {
      const logDir = path.dirname(this.config.logFilePath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      this.logStream = fs.createWriteStream(this.config.logFilePath, {
        flags: 'a'
      });
    } catch (error) {
      logger.error('Error setting up arbitrage log stream:', error);
    }
  }

  /**
   * Close log stream
   */
  private closeLogStream(): void {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }
} 