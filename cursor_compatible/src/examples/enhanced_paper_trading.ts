import { PaperTradingAdapter } from '../execution/adapters/PaperTradingAdapter';
import { SlippageModel, OrderStatus } from '../execution/interfaces/PaperTradingTypes';
import { OrderSide, OrderType } from '../execution/order';
import { PositionDirection } from '../types/position';
import { createConsoleDashboard } from '../dashboard/PaperTradingDashboard';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

// Machine learning libraries would be imported here
// import * as tf from '@tensorflow/tfjs';

/**
 * Enhanced Paper Trading System with Self-Improvement
 * 
 * This system combines the full paper trading functionality with
 * machine learning capabilities for continuous improvement
 */
class EnhancedPaperTrading {
  private adapter: PaperTradingAdapter;
  private dashboard: any; // PaperTradingDashboard
  private symbols: string[] = [];
  private isRunning: boolean = false;
  private updateInterval: NodeJS.Timeout | null = null;
  private historyData: Map<string, any[]> = new Map();
  private performanceMetrics: any[] = [];
  private strategyParams: Map<string, any> = new Map();
  private optimizationHistory: any[] = [];
  private dataDir: string;
  
  constructor(symbols: string[] = ['BTC/USD', 'ETH/USD'], initialBalance: number = 10000) {
    this.symbols = symbols;
    
    // Initialize the paper trading adapter with advanced configuration
    this.adapter = PaperTradingAdapter.getInstance({
      initialBalance,
      defaultSlippageModel: SlippageModel.SizeDependent,
      defaultCommissionRate: 0.1, // 0.1%
      commissionRates: {
        'binance': 0.1,
        'coinbase': 0.5,
        'kraken': 0.26
      },
      defaultLatencyMs: 100,
      enforceRealisticConstraints: true,
      maxPositionSizePercent: 20,
      maxLeverage: 3,
      orderFillProbability: 0.98,
      verboseLogging: true
    });
    
    // Create dashboard
    this.dashboard = createConsoleDashboard(this.adapter);
    
    // Setup data directory for persistence
    this.dataDir = path.join(process.cwd(), 'data', 'paper_trading');
    this.ensureDirectoryExists(this.dataDir);
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Load historical data and settings if available
    this.loadHistoricalData();
    this.loadStrategies();
    
    console.log(`EnhancedPaperTrading initialized with ${symbols.length} symbols and $${initialBalance} balance`);
  }
  
  /**
   * Setup event listeners for monitoring performance and optimization
   */
  private setupEventListeners(): void {
    // Position updates
    this.adapter.on('position_update', (event) => {
      const { position, updateType } = event;
      
      // Record position data for analysis
      if (!this.historyData.has('positions')) {
        this.historyData.set('positions', []);
      }
      
      const positionData = this.historyData.get('positions');
      if (positionData) {
        positionData.push({
          timestamp: new Date(),
          position: { ...position },
          updateType
        });
      }
      
      // Trigger optimization if position closed with loss
      if (updateType === 'close' && event.order && event.order.pnl < 0) {
        this.scheduleOptimization(position.symbol);
      }
    });
    
    // Order execution
    this.adapter.on('order_executed', (order) => {
      // Record order data for analysis
      if (!this.historyData.has('orders')) {
        this.historyData.set('orders', []);
      }
      
      const orderData = this.historyData.get('orders');
      if (orderData) {
        orderData.push({
          timestamp: new Date(),
          order: { ...order }
        });
      }
    });
    
    // Price updates
    this.adapter.on('price_update', (event) => {
      // Record price data for time series analysis
      const { symbol, price } = event;
      
      if (!this.historyData.has(`prices_${symbol}`)) {
        this.historyData.set(`prices_${symbol}`, []);
      }
      
      const priceData = this.historyData.get(`prices_${symbol}`);
      if (priceData) {
        priceData.push({
          timestamp: new Date(),
          price
        });
        
        // Keep only last 1000 price points to avoid memory issues
        if (priceData.length > 1000) {
          this.historyData.set(`prices_${symbol}`, priceData.slice(-1000));
        }
      }
    });
  }
  
  /**
   * Start continuous simulation with self-improvement
   */
  public start(updateIntervalMs: number = 5000): void {
    if (this.isRunning) {
      console.log('System is already running');
      return;
    }
    
    this.isRunning = true;
    
    // Start the dashboard
    this.dashboard.start(1000);
    
    // Initialize with some price data
    this.symbols.forEach(symbol => {
      // Get initial price from historical data or use default
      const initialPrice = this.getInitialPrice(symbol);
      this.adapter.updatePrice(symbol, initialPrice);
    });
    
    // Regular update function
    const update = async () => {
      if (!this.isRunning) return;
      
      try {
        // Update prices with realistic movements
        await this.updatePrices();
        
        // Generate and execute signals based on current strategy
        await this.generateAndExecuteSignals();
        
        // Collect performance metrics
        this.collectPerformanceMetrics();
        
        // Periodically save data
        if (Math.random() < 0.1) { // ~10% of updates
          this.saveData();
        }
        
        // Periodically optimize strategies
        if (Math.random() < 0.05) { // ~5% of updates
          this.optimizeStrategies();
        }
      } catch (error) {
        console.error('Error in simulation update:', error);
      }
    };
    
    // Start the update interval
    this.updateInterval = setInterval(update, updateIntervalMs);
    
    // Run the first update immediately
    update();
    
    console.log(`EnhancedPaperTrading started with ${updateIntervalMs}ms update interval`);
  }
  
  /**
   * Stop the simulation
   */
  public stop(): void {
    if (!this.isRunning) {
      console.log('System is not running');
      return;
    }
    
    // Clear the update interval
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    // Stop the dashboard
    this.dashboard.stop();
    
    this.isRunning = false;
    
    // Save all data before stopping
    this.saveData();
    
    console.log('EnhancedPaperTrading stopped');
  }
  
  /**
   * Update prices with realistic market movements
   */
  private async updatePrices(): Promise<void> {
    // Update each symbol with a realistic price movement
    for (const symbol of this.symbols) {
      const currentPrice = this.adapter.getPrice(symbol) || this.getInitialPrice(symbol);
      
      // Generate a realistic price movement based on historical volatility
      // This could be enhanced with more sophisticated models
      const volatility = this.getHistoricalVolatility(symbol) || 0.01;
      const priceChange = this.generatePriceChange(currentPrice, volatility);
      const newPrice = currentPrice * (1 + priceChange);
      
      // Update the price
      this.adapter.updatePrice(symbol, newPrice);
    }
  }
  
  /**
   * Generate and execute trading signals
   */
  private async generateAndExecuteSignals(): Promise<void> {
    for (const symbol of this.symbols) {
      // Skip if we don't have a strategy for this symbol
      if (!this.strategyParams.has(symbol)) {
        this.initializeStrategyParams(symbol);
      }
      
      const params = this.strategyParams.get(symbol);
      const currentPrice = this.adapter.getPrice(symbol);
      
      // Skip if price is not available
      if (!currentPrice) continue;
      
      // Generate a signal using the current strategy parameters
      const signal = this.generateSignal(symbol, currentPrice, params);
      
      // Skip if no signal or 'hold'
      if (!signal || signal.direction === 'hold') continue;
      
      // Convert signal to order
      const order = this.createOrderFromSignal(signal, currentPrice);
      
      // Execute the order
      try {
        const result = await this.adapter.executeOrder(order);
        console.log(`Executed ${order.side} order for ${symbol}: ${result.order.status}`);
      } catch (error) {
        console.error(`Error executing order for ${symbol}:`, error);
      }
    }
  }
  
  /**
   * Generate a trading signal based on strategy parameters
   */
  private generateSignal(symbol: string, currentPrice: number, params: any): any {
    // This would be replaced with actual strategy logic
    // For now, we'll use a simple moving average crossover
    
    const priceHistory = this.historyData.get(`prices_${symbol}`) || [];
    if (priceHistory.length < params.longWindow) {
      return null; // Not enough data
    }
    
    // Calculate short and long moving averages
    const prices = priceHistory.map(p => p.price);
    const shortMA = this.calculateMA(prices, params.shortWindow);
    const longMA = this.calculateMA(prices, params.longWindow);
    
    // Previous values
    const prevPrices = prices.slice(0, -1);
    const prevShortMA = this.calculateMA(prevPrices, params.shortWindow);
    const prevLongMA = this.calculateMA(prevPrices, params.longWindow);
    
    // Generate signal based on crossover
    let direction = 'hold';
    let strength = 0;
    
    if (shortMA > longMA && prevShortMA <= prevLongMA) {
      // Bullish crossover
      direction = 'buy';
      strength = Math.min(1, (shortMA - longMA) / longMA * 100);
    } else if (shortMA < longMA && prevShortMA >= prevLongMA) {
      // Bearish crossover
      direction = 'sell';
      strength = Math.min(1, (longMA - shortMA) / shortMA * 100);
    }
    
    if (direction === 'hold') {
      return null;
    }
    
    return {
      id: uuidv4(),
      symbol,
      direction,
      strength,
      timestamp: new Date(),
      confidence: 0.7,
      metadata: {
        strategy: 'moving_average_crossover',
        parameters: { ...params },
        shortMA,
        longMA
      }
    };
  }
  
  /**
   * Create an order from a signal
   */
  private createOrderFromSignal(signal: any, currentPrice: number): any {
    const side = signal.direction === 'buy' ? OrderSide.Buy : OrderSide.Sell;
    
    // Calculate order size based on portfolio value and signal strength
    const portfolio = this.adapter.getPortfolioSnapshot();
    const positionSizePercent = 5 + (signal.strength * 15); // 5% to 20% based on strength
    const maxPositionValue = portfolio.portfolioValue * (positionSizePercent / 100);
    
    // Calculate amount based on position size and current price
    const amount = maxPositionValue / currentPrice;
    
    return {
      id: uuidv4(),
      symbol: signal.symbol,
      side,
      type: OrderType.Market,
      amount,
      price: currentPrice,
      venues: ['paper'],
      maxSlippage: 0.5,
      additionalParams: {
        signalId: signal.id,
        strategy: signal.metadata.strategy,
        confidence: signal.confidence
      }
    };
  }
  
  /**
   * Calculate moving average
   */
  private calculateMA(prices: number[], window: number): number {
    if (prices.length < window) return 0;
    
    const subset = prices.slice(-window);
    return subset.reduce((sum, price) => sum + price, 0) / subset.length;
  }
  
  /**
   * Generate a realistic price change based on volatility
   */
  private generatePriceChange(price: number, volatility: number): number {
    // Generate a random change following a normal distribution
    // Box-Muller transform to generate normal distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    
    // Scale by volatility
    return z0 * volatility;
  }
  
  /**
   * Get historical volatility for a symbol
   */
  private getHistoricalVolatility(symbol: string): number {
    const priceHistory = this.historyData.get(`prices_${symbol}`) || [];
    if (priceHistory.length < 10) return 0.01; // Default volatility
    
    // Calculate daily returns
    const returns = [];
    for (let i = 1; i < priceHistory.length; i++) {
      const prevPrice = priceHistory[i-1].price;
      const curPrice = priceHistory[i].price;
      returns.push((curPrice - prevPrice) / prevPrice);
    }
    
    // Calculate standard deviation of returns
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const sqDiffs = returns.map(r => Math.pow(r - mean, 2));
    const variance = sqDiffs.reduce((sum, sq) => sum + sq, 0) / sqDiffs.length;
    
    return Math.sqrt(variance);
  }
  
  /**
   * Initialize strategy parameters for a symbol
   */
  private initializeStrategyParams(symbol: string): void {
    // Default parameters for moving average crossover
    const params = {
      strategy: 'moving_average_crossover',
      shortWindow: 10,
      longWindow: 50,
      signalThreshold: 0.02,
      stopLoss: 0.05,
      takeProfit: 0.1,
      maxPositionSize: 0.2,
      lastOptimized: new Date()
    };
    
    this.strategyParams.set(symbol, params);
    console.log(`Initialized strategy parameters for ${symbol}`);
  }
  
  /**
   * Schedule optimization for a specific symbol
   */
  private scheduleOptimization(symbol: string): void {
    console.log(`Scheduling optimization for ${symbol} strategy`);
    setTimeout(() => this.optimizeStrategy(symbol), 5000);
  }
  
  /**
   * Optimize strategies based on performance
   */
  private optimizeStrategies(): void {
    console.log('Optimizing strategies based on performance...');
    
    for (const symbol of this.symbols) {
      this.optimizeStrategy(symbol);
    }
  }
  
  /**
   * Optimize a single strategy
   */
  private optimizeStrategy(symbol: string): void {
    if (!this.strategyParams.has(symbol)) {
      this.initializeStrategyParams(symbol);
      return;
    }
    
    const params = this.strategyParams.get(symbol);
    
    // Skip if optimized recently (less than 1 hour ago)
    const lastOptimized = new Date(params.lastOptimized);
    const hoursSinceLastOptimization = (Date.now() - lastOptimized.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastOptimization < 1) return;
    
    console.log(`Optimizing strategy for ${symbol}...`);
    
    try {
      // Here we would implement the actual optimization logic
      // This could use genetic algorithms, Bayesian optimization, or reinforcement learning
      
      // For simplicity, we'll make small random adjustments
      const newParams = { ...params };
      
      // Adjust short window (5-20)
      newParams.shortWindow = Math.max(5, Math.min(20, 
        params.shortWindow + Math.floor(Math.random() * 5) - 2));
      
      // Adjust long window (30-100)
      newParams.longWindow = Math.max(30, Math.min(100, 
        params.longWindow + Math.floor(Math.random() * 10) - 5));
      
      // Ensure short window is less than long window
      if (newParams.shortWindow >= newParams.longWindow) {
        newParams.longWindow = newParams.shortWindow * 2;
      }
      
      // Adjust signal threshold (0.01-0.05)
      newParams.signalThreshold = Math.max(0.01, Math.min(0.05, 
        params.signalThreshold + (Math.random() * 0.02 - 0.01)));
      
      // Adjust stop loss (0.02-0.1)
      newParams.stopLoss = Math.max(0.02, Math.min(0.1, 
        params.stopLoss + (Math.random() * 0.04 - 0.02)));
      
      // Adjust take profit (0.05-0.2)
      newParams.takeProfit = Math.max(0.05, Math.min(0.2, 
        params.takeProfit + (Math.random() * 0.06 - 0.03)));
      
      // Update last optimized timestamp
      newParams.lastOptimized = new Date();
      
      // Log the optimization
      this.optimizationHistory.push({
        timestamp: new Date(),
        symbol,
        oldParams: { ...params },
        newParams: { ...newParams }
      });
      
      // Update strategy params
      this.strategyParams.set(symbol, newParams);
      
      console.log(`Strategy for ${symbol} optimized. Short MA: ${newParams.shortWindow}, Long MA: ${newParams.longWindow}`);
    } catch (error) {
      console.error(`Error optimizing strategy for ${symbol}:`, error);
    }
  }
  
  /**
   * Collect performance metrics
   */
  private collectPerformanceMetrics(): void {
    const portfolio = this.adapter.getPortfolioSnapshot();
    const metrics = this.dashboard.getMetrics();
    
    this.performanceMetrics.push({
      timestamp: new Date(),
      portfolioValue: portfolio.portfolioValue,
      cashBalance: portfolio.cashBalance,
      totalPnl: portfolio.totalPnl,
      dayPnl: portfolio.dayPnl,
      positionCount: portfolio.positions.length,
      winRate: metrics.winRate,
      sharpeRatio: metrics.sharpeRatio,
      maxDrawdown: metrics.maxDrawdown
    });
    
    // Keep only last 1000 metrics to avoid memory issues
    if (this.performanceMetrics.length > 1000) {
      this.performanceMetrics = this.performanceMetrics.slice(-1000);
    }
  }
  
  /**
   * Get initial price for a symbol
   */
  private getInitialPrice(symbol: string): number {
    switch (symbol) {
      case 'BTC/USD': return 50000 + Math.random() * 1000 - 500;
      case 'ETH/USD': return 3000 + Math.random() * 100 - 50;
      case 'SOL/USD': return 100 + Math.random() * 10 - 5;
      case 'ADA/USD': return 0.5 + Math.random() * 0.1 - 0.05;
      default: return 100 + Math.random() * 20 - 10;
    }
  }
  
  /**
   * Save all data to disk
   */
  private saveData(): void {
    try {
      // Save performance metrics
      fs.writeFileSync(
        path.join(this.dataDir, 'performance_metrics.json'),
        JSON.stringify(this.performanceMetrics)
      );
      
      // Save strategy parameters
      const strategyData = Object.fromEntries(this.strategyParams);
      fs.writeFileSync(
        path.join(this.dataDir, 'strategy_params.json'),
        JSON.stringify(strategyData)
      );
      
      // Save optimization history
      fs.writeFileSync(
        path.join(this.dataDir, 'optimization_history.json'),
        JSON.stringify(this.optimizationHistory)
      );
      
      // Save selected historical data
      const selectedData: any = {};
      
      // Save last 100 orders
      if (this.historyData.has('orders')) {
        const ordersData = this.historyData.get('orders');
        if (ordersData) {
          selectedData.orders = ordersData.slice(-100);
        }
      }
      
      // Save last 100 position updates
      if (this.historyData.has('positions')) {
        const positionsData = this.historyData.get('positions');
        if (positionsData) {
          selectedData.positions = positionsData.slice(-100);
        }
      }
      
      fs.writeFileSync(
        path.join(this.dataDir, 'historical_data.json'),
        JSON.stringify(selectedData)
      );
      
      console.log('Data saved successfully');
    } catch (error) {
      console.error('Error saving data:', error);
    }
  }
  
  /**
   * Load historical data from disk
   */
  private loadHistoricalData(): void {
    try {
      const performanceFile = path.join(this.dataDir, 'performance_metrics.json');
      const historyFile = path.join(this.dataDir, 'historical_data.json');
      const optimizationFile = path.join(this.dataDir, 'optimization_history.json');
      
      if (fs.existsSync(performanceFile)) {
        this.performanceMetrics = JSON.parse(fs.readFileSync(performanceFile, 'utf8'));
        console.log(`Loaded ${this.performanceMetrics.length} performance metrics`);
      }
      
      if (fs.existsSync(historyFile)) {
        const data = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
        
        if (data.orders) {
          this.historyData.set('orders', data.orders);
        }
        
        if (data.positions) {
          this.historyData.set('positions', data.positions);
        }
        
        console.log('Loaded historical data');
      }
      
      if (fs.existsSync(optimizationFile)) {
        this.optimizationHistory = JSON.parse(fs.readFileSync(optimizationFile, 'utf8'));
        console.log(`Loaded ${this.optimizationHistory.length} optimization records`);
      }
    } catch (error) {
      console.error('Error loading historical data:', error);
    }
  }
  
  /**
   * Load strategy parameters from disk
   */
  private loadStrategies(): void {
    try {
      const strategyFile = path.join(this.dataDir, 'strategy_params.json');
      
      if (fs.existsSync(strategyFile)) {
        const data = JSON.parse(fs.readFileSync(strategyFile, 'utf8'));
        
        // Convert to Map
        this.strategyParams = new Map(Object.entries(data));
        
        console.log(`Loaded strategy parameters for ${this.strategyParams.size} symbols`);
      } else {
        // Initialize default strategies for all symbols
        this.symbols.forEach(symbol => this.initializeStrategyParams(symbol));
      }
    } catch (error) {
      console.error('Error loading strategy parameters:', error);
      
      // Initialize default strategies as fallback
      this.symbols.forEach(symbol => this.initializeStrategyParams(symbol));
    }
  }
  
  /**
   * Ensure a directory exists
   */
  private ensureDirectoryExists(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  }
  
  /**
   * Get performance report
   */
  public getPerformanceReport(): any {
    const portfolio = this.adapter.getPortfolioSnapshot();
    const metrics = this.dashboard.getMetrics();
    
    return {
      timestamp: new Date(),
      portfolio,
      metrics,
      optimizationCount: this.optimizationHistory.length,
      strategies: Object.fromEntries(this.strategyParams),
      runTime: this.isRunning ? 'Running' : 'Stopped'
    };
  }
  
  /**
   * Run a backtest on historical data
   */
  public async runBacktest(symbol: string, days: number = 30): Promise<any> {
    console.log(`Running backtest for ${symbol} over ${days} days...`);
    
    // Create a temporary adapter for backtesting
    const backtestAdapter = PaperTradingAdapter.getInstance({
      initialBalance: 10000,
      verboseLogging: false
    });
    
    // Generate or load historical prices
    const prices = this.generateHistoricalPrices(symbol, days);
    
    // Get strategy params
    const params = this.strategyParams.get(symbol) || this.initializeStrategyParams(symbol);
    
    // Run the backtest
    let totalTrades = 0;
    let winningTrades = 0;
    
    // Simulate each day
    for (const dayData of prices) {
      backtestAdapter.updatePrice(symbol, dayData.price);
      
      // Generate signal based on price
      const signal = this.generateSignal(symbol, dayData.price, params);
      
      // Execute signal if available
      if (signal && signal.direction !== 'hold') {
        const order = this.createOrderFromSignal(signal, dayData.price);
        const result = await backtestAdapter.executeOrder(order);
        
        totalTrades++;
        if (result.pnl > 0) {
          winningTrades++;
        }
      }
      
      // Simulate time passing
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Get final portfolio value
    const finalPortfolio = backtestAdapter.getPortfolioSnapshot();
    
    // Calculate performance metrics
    const initialBalance = 10000;
    const finalBalance = finalPortfolio.portfolioValue;
    const profit = finalBalance - initialBalance;
    const returnPct = (profit / initialBalance) * 100;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    
    return {
      symbol,
      days,
      initialBalance,
      finalBalance,
      profit,
      returnPct,
      totalTrades,
      winningTrades,
      winRate,
      strategyParams: params
    };
  }
  
  /**
   * Generate synthetic historical prices
   */
  private generateHistoricalPrices(symbol: string, days: number): any[] {
    const prices = [];
    let currentPrice = this.getInitialPrice(symbol);
    const volatility = 0.02; // 2% daily volatility
    
    // Generate daily prices with random walk
    for (let i = 0; i < days; i++) {
      const priceChange = this.generatePriceChange(currentPrice, volatility);
      currentPrice = currentPrice * (1 + priceChange);
      
      prices.push({
        day: i + 1,
        timestamp: new Date(Date.now() - (days - i) * 24 * 60 * 60 * 1000),
        price: currentPrice
      });
    }
    
    return prices;
  }
}

// Run the enhanced paper trading example
async function runEnhancedPaperTrading() {
  console.log('Starting Enhanced Paper Trading System');
  
  // Define symbols to trade
  const symbols = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'ADA/USD'];
  
  // Create the enhanced paper trading system
  const system = new EnhancedPaperTrading(symbols, 100000); // $100k initial balance
  
  // Start the system
  system.start(3000); // 3-second update interval
  
  // Run for 10 minutes
  console.log('System will run for 10 minutes...');
  await new Promise(resolve => setTimeout(resolve, 600000));
  
  // Run a backtest
  const backtestResult = await system.runBacktest('BTC/USD', 30);
  console.log('Backtest results:', backtestResult);
  
  // Get performance report
  const report = system.getPerformanceReport();
  console.log('\nPerformance Report:');
  console.log(`Portfolio Value: $${report.portfolio.portfolioValue.toFixed(2)}`);
  console.log(`Total P&L: $${report.portfolio.totalPnl.toFixed(2)}`);
  console.log(`Win Rate: ${(report.metrics.winRate * 100).toFixed(2)}%`);
  console.log(`Sharpe Ratio: ${report.metrics.sharpeRatio.toFixed(2)}`);
  console.log(`Maximum Drawdown: ${report.metrics.maxDrawdown.toFixed(2)}%`);
  console.log(`Optimization Count: ${report.optimizationCount}`);
  
  // Stop the system
  system.stop();
  
  console.log('\nEnhanced Paper Trading System stopped');
}

// Run if directly executed
if (require.main === module) {
  runEnhancedPaperTrading().catch(err => {
    console.error('Error in enhanced paper trading:', err);
    process.exit(1);
  });
}

export { EnhancedPaperTrading }; 