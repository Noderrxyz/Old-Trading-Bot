import { OrderBookManager, OrderSide, PriceLevel } from '../execution/OrderBookManager';
import { logger } from '../utils/logger';

/**
 * A demo application that showcases the OrderBookManager functionality
 * by simulating a market data feed and displaying order book analytics
 */
class OrderBookDemo {
  private orderBookManager: OrderBookManager;
  private symbols: string[] = ['BTC/USD', 'ETH/USD', 'SOL/USD'];
  private running = false;
  private updateInterval = 500; // ms between updates
  private updateCount = 0;
  
  constructor() {
    try {
      this.orderBookManager = OrderBookManager.getInstance();
      logger.info('OrderBookDemo initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize OrderBookDemo:', error);
      throw new Error('Failed to initialize OrderBookDemo: OrderBookManager not available');
    }
  }
  
  /**
   * Start the demo with simulated order book updates
   */
  public async start(): Promise<void> {
    if (this.running) {
      logger.warn('OrderBookDemo is already running');
      return;
    }
    
    this.running = true;
    logger.info('Starting OrderBookDemo');
    
    // Initialize order books with some data
    await this.initializeOrderBooks();
    
    // Start the update loop
    this.updateLoop();
  }
  
  /**
   * Stop the demo
   */
  public stop(): void {
    logger.info('Stopping OrderBookDemo');
    this.running = false;
  }
  
  /**
   * Initialize order books with initial data
   */
  private async initializeOrderBooks(): Promise<void> {
    for (const symbol of this.symbols) {
      // Create bid and ask levels
      const basePrice = symbol.startsWith('BTC') ? 50000 : 
                        symbol.startsWith('ETH') ? 2500 : 
                        symbol.startsWith('SOL') ? 150 : 100;
      
      // Initialize with 10 bid and ask levels
      for (let i = 0; i < 10; i++) {
        // Bids (descending prices)
        const bidPrice = basePrice * (1 - 0.001 * (i + 1));
        const bidSize = 1 + Math.random() * 5;
        
        this.orderBookManager.processUpdate(
          symbol,
          bidPrice,
          bidSize,
          OrderSide.Bid,
          i
        );
        
        // Asks (ascending prices)
        const askPrice = basePrice * (1 + 0.001 * (i + 1));
        const askSize = 1 + Math.random() * 5;
        
        this.orderBookManager.processUpdate(
          symbol,
          askPrice,
          askSize,
          OrderSide.Ask,
          i + 100
        );
      }
      
      logger.info(`Initialized order book for ${symbol}`);
    }
  }
  
  /**
   * Main update loop for simulating order book updates
   */
  private async updateLoop(): Promise<void> {
    if (!this.running) return;
    
    try {
      // Update each symbol's order book
      for (const symbol of this.symbols) {
        await this.updateOrderBook(symbol);
      }
      
      // Periodically display analytics
      if (++this.updateCount % 10 === 0) {
        await this.displayAnalytics();
      }
    } catch (error) {
      logger.error('Error in update loop:', error);
    }
    
    // Schedule next update
    setTimeout(() => this.updateLoop(), this.updateInterval);
  }
  
  /**
   * Update a single order book with simulated changes
   */
  private async updateOrderBook(symbol: string): Promise<void> {
    const snapshot = await this.orderBookManager.getSnapshot(symbol, 10);
    if (!snapshot) return;
    
    const [bids, asks] = snapshot;
    
    // Randomly select an update type:
    // 1. Modify existing level
    // 2. Add new level
    // 3. Remove level
    const updateType = Math.floor(Math.random() * 3);
    
    if (updateType === 0) {
      // Modify existing level
      const side = Math.random() > 0.5 ? OrderSide.Bid : OrderSide.Ask;
      const levels = side === OrderSide.Bid ? bids : asks;
      
      if (levels.length > 0) {
        const levelIndex = Math.floor(Math.random() * levels.length);
        const level = levels[levelIndex];
        
        // Change size by +/- 30%
        const sizeDelta = level.size * (0.7 + Math.random() * 0.6);
        
        this.orderBookManager.processUpdate(
          symbol,
          level.price,
          sizeDelta,
          side,
          this.getNextUpdateId()
        );
      }
    } else if (updateType === 1) {
      // Add new level
      const side = Math.random() > 0.5 ? OrderSide.Bid : OrderSide.Ask;
      const levels = side === OrderSide.Bid ? bids : asks;
      
      if (levels.length > 0) {
        // Insert between existing levels
        const levelIndex = Math.floor(Math.random() * (levels.length - 1));
        const level1 = levels[levelIndex];
        const level2 = levels[levelIndex + 1];
        
        // Calculate price between the two levels
        const newPrice = (level1.price + level2.price) / 2;
        const newSize = 1 + Math.random() * 3;
        
        this.orderBookManager.processUpdate(
          symbol,
          newPrice,
          newSize,
          side,
          this.getNextUpdateId()
        );
      }
    } else {
      // Remove level
      const side = Math.random() > 0.5 ? OrderSide.Bid : OrderSide.Ask;
      const levels = side === OrderSide.Bid ? bids : asks;
      
      if (levels.length > 5) { // Ensure we keep some minimum number of levels
        const levelIndex = Math.floor(Math.random() * levels.length);
        const level = levels[levelIndex];
        
        this.orderBookManager.processUpdate(
          symbol,
          level.price,
          0, // Size of 0 removes the level
          side,
          this.getNextUpdateId()
        );
      }
    }
  }
  
  /**
   * Display analytics for all order books
   */
  private async displayAnalytics(): Promise<void> {
    logger.info('===== ORDER BOOK ANALYTICS =====');
    
    for (const symbol of this.symbols) {
      const midPrice = this.orderBookManager.getMidPrice(symbol);
      const imbalance = this.orderBookManager.calculateImbalance(symbol, 5);
      const bidVwap = this.orderBookManager.getVWAP(symbol, 10, OrderSide.Bid);
      const askVwap = this.orderBookManager.getVWAP(symbol, 10, OrderSide.Ask);
      
      logger.info(`${symbol}:`);
      logger.info(`  Mid Price: ${midPrice?.toFixed(2)}`);
      logger.info(`  Imbalance (5 levels): ${imbalance?.toFixed(4)}`);
      logger.info(`  VWAP Bid (10 units): ${bidVwap?.toFixed(2)}`);
      logger.info(`  VWAP Ask (10 units): ${askVwap?.toFixed(2)}`);
      
      if (midPrice && bidVwap && askVwap) {
        const bidImpact = ((midPrice - bidVwap) / midPrice * 100).toFixed(4);
        const askImpact = ((askVwap - midPrice) / midPrice * 100).toFixed(4);
        logger.info(`  Bid Price Impact: ${bidImpact}%`);
        logger.info(`  Ask Price Impact: ${askImpact}%`);
      }
      
      // Display shortened order book
      const snapshot = await this.orderBookManager.getSnapshot(symbol, 3);
      if (snapshot) {
        const [bids, asks] = snapshot;
        
        logger.info('  Top 3 Asks:');
        asks.forEach((level, i) => {
          logger.info(`    ${i+1}. ${level.price.toFixed(2)} @ ${level.size.toFixed(4)} (${level.orderCount} orders)`);
        });
        
        logger.info('  Top 3 Bids:');
        bids.forEach((level, i) => {
          logger.info(`    ${i+1}. ${level.price.toFixed(2)} @ ${level.size.toFixed(4)} (${level.orderCount} orders)`);
        });
      }
      
      logger.info('----------------------------');
    }
  }
  
  /**
   * Generate a new update ID for order book updates
   */
  private getNextUpdateId(): number {
    return Date.now();
  }
}

/**
 * Run the demo if this file is executed directly
 */
if (require.main === module) {
  const demo = new OrderBookDemo();
  
  demo.start().catch(err => {
    logger.error('Error running OrderBookDemo:', err);
  });
  
  // Run for 1 minute then stop
  setTimeout(() => {
    demo.stop();
    logger.info('OrderBookDemo completed');
  }, 60000);
}

export { OrderBookDemo }; 