/**
 * Standalone Self-Improving Trading Demo
 * 
 * This is a complete, self-contained implementation that demonstrates
 * self-improving algorithmic trading without external dependencies.
 */

// Basic enums and types
enum OrderSide {
  Buy = 'buy',
  Sell = 'sell'
}

enum OrderType {
  Market = 'market',
  Limit = 'limit'
}

enum OrderStatus {
  Created = 'created',
  Submitted = 'submitted',
  Filled = 'filled',
  Rejected = 'rejected'
}

enum PositionDirection {
  Long = 'long',
  Short = 'short'
}

// Type definitions
interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  amount: number;
  price: number;
  status?: OrderStatus;
  filledAmount?: number;
  avgFillPrice?: number;
  commission?: number;
  slippage?: number;
}

interface Position {
  id: string;
  symbol: string;
  direction: PositionDirection;
  size: number;
  entryPrice: number;
  currentPrice: number;
  value: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
}

interface Portfolio {
  cashBalance: number;
  positions: Position[];
  portfolioValue: number;
  totalPnl: number;
}

interface Signal {
  id: string;
  symbol: string;
  direction: 'buy' | 'sell' | 'hold';
  strength?: number;
  confidence?: number;
  timestamp: Date;
  metadata?: Record<string, any>;
}

interface MarketData {
  symbol: string;
  price: number;
  timestamp: Date;
  volume?: number;
  high?: number;
  low?: number;
  open?: number;
  close?: number;
}

interface StrategyParams {
  name: string;
  shortWindow: number;
  longWindow: number;
  signalThreshold: number;
  stopLoss: number;
  takeProfit: number;
  positionSizePercent: number;
  fitness: number;
  generation: number;
  lastOptimized: Date;
}

// Helper function to generate UUIDs
function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Self-improving trading system
 */
class SelfImprovingTradingSystem {
  private symbols: string[] = [];
  private marketData: Map<string, MarketData[]> = new Map();
  private portfolio: Portfolio;
  private positions: Map<string, Position> = new Map();
  private orders: Order[] = [];
  private strategies: Map<string, StrategyParams> = new Map();
  private history: {
    trades: any[],
    performance: any[],
    signals: Signal[],
    optimizations: any[]
  };
  private isRunning: boolean = false;
  private updateInterval: NodeJS.Timeout | null = null;
  
  constructor(symbols: string[] = ['BTC/USD', 'ETH/USD'], initialBalance: number = 10000) {
    this.symbols = symbols;
    
    // Initialize portfolio
    this.portfolio = {
      cashBalance: initialBalance,
      positions: [],
      portfolioValue: initialBalance,
      totalPnl: 0
    };
    
    // Initialize history
    this.history = {
      trades: [],
      performance: [],
      signals: [],
      optimizations: []
    };
    
    // Initialize strategies for each symbol
    this.symbols.forEach(symbol => {
      this.initializeStrategy(symbol);
    });
    
    // Initialize price data
    this.symbols.forEach(symbol => {
      this.marketData.set(symbol, []);
    });
    
    console.log(`Trading system initialized with ${symbols.length} symbols and $${initialBalance} balance`);
  }
  
  /**
   * Start trading simulation
   */
  start(intervalMs: number = 1000): void {
    if (this.isRunning) {
      console.log('System is already running');
      return;
    }
    
    this.isRunning = true;
    console.log(`Starting trading simulation with ${intervalMs}ms interval`);
    
    // Initialize with seed prices
    this.symbols.forEach(symbol => {
      const initialPrice = this.getInitialPrice(symbol);
      this.updatePrice(symbol, initialPrice);
    });
    
    // Main update loop
    const update = async () => {
      if (!this.isRunning) return;
      
      try {
        // 1. Update prices
        await this.updatePrices();
        
        // 2. Generate signals
        const signals = await this.generateSignals();
        
        // 3. Execute signals
        for (const signal of signals) {
          await this.executeSignal(signal);
        }
        
        // 4. Update portfolio metrics
        this.updatePortfolioMetrics();
        
        // 5. Periodically run optimization
        if (Math.random() < 0.05) { // 5% chance each update
          this.optimizeStrategies();
        }
      } catch (error) {
        console.error('Error in update cycle:', error);
      }
    };
    
    // Set update interval
    this.updateInterval = setInterval(update, intervalMs);
    
    // Run initial update
    update();
  }
  
  /**
   * Stop trading simulation
   */
  stop(): void {
    if (!this.isRunning) {
      console.log('System is not running');
      return;
    }
    
    // Clear interval
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    this.isRunning = false;
    console.log('Trading simulation stopped');
    
    // Print final performance report
    this.printPerformanceReport();
  }
  
  /**
   * Initialize strategy for a symbol
   */
  private initializeStrategy(symbol: string): void {
    const strategy: StrategyParams = {
      name: 'MovingAverageCrossover',
      shortWindow: 10,
      longWindow: 50,
      signalThreshold: 0.01,
      stopLoss: 0.05,
      takeProfit: 0.1,
      positionSizePercent: 10,
      fitness: 0,
      generation: 1,
      lastOptimized: new Date()
    };
    
    this.strategies.set(symbol, strategy);
    console.log(`Initialized strategy for ${symbol}`);
  }
  
  /**
   * Update price for a symbol
   */
  private updatePrice(symbol: string, price: number): void {
    // Create market data entry
    const data: MarketData = {
      symbol,
      price,
      timestamp: new Date(),
      volume: Math.random() * 1000,
      high: price * (1 + Math.random() * 0.01),
      low: price * (1 - Math.random() * 0.01),
      open: price * (1 - Math.random() * 0.005),
      close: price
    };
    
    // Add to market data history
    const history = this.marketData.get(symbol) || [];
    history.push(data);
    this.marketData.set(symbol, history);
    
    // Keep only last 1000 data points
    if (history.length > 1000) {
      this.marketData.set(symbol, history.slice(-1000));
    }
    
    // Update any open positions for this symbol
    this.updatePositionPrice(symbol, price);
    
    // Check for stop loss or take profit
    this.checkStopLossAndTakeProfit(symbol);
  }
  
  /**
   * Update all prices with realistic movements
   */
  private async updatePrices(): Promise<void> {
    for (const symbol of this.symbols) {
      const history = this.marketData.get(symbol) || [];
      const currentPrice = history.length > 0 ? history[history.length-1].price : this.getInitialPrice(symbol);
      
      // Calculate volatility based on recent price history
      const volatility = this.calculateVolatility(symbol) || 0.01;
      
      // Generate new price with realistic movement
      const change = this.generatePriceChange(volatility);
      const newPrice = currentPrice * (1 + change);
      
      // Update price
      this.updatePrice(symbol, newPrice);
    }
  }
  
  /**
   * Generate trading signals for all symbols
   */
  private async generateSignals(): Promise<Signal[]> {
    const signals: Signal[] = [];
    
    for (const symbol of this.symbols) {
      const strategy = this.strategies.get(symbol);
      if (!strategy) continue;
      
      const signal = this.generateSignalForSymbol(symbol, strategy);
      if (signal) {
        signals.push(signal);
        
        // Store signal in history
        this.history.signals.push(signal);
      }
    }
    
    return signals;
  }
  
  /**
   * Generate a signal for a specific symbol
   */
  private generateSignalForSymbol(symbol: string, strategy: StrategyParams): Signal | null {
    const history = this.marketData.get(symbol) || [];
    if (history.length < strategy.longWindow) {
      return null; // Not enough data
    }
    
    // Extract prices
    const prices = history.map(d => d.price);
    
    // Calculate moving averages
    const shortMA = this.calculateMA(prices, strategy.shortWindow);
    const longMA = this.calculateMA(prices, strategy.longWindow);
    
    // Previous values for crossover detection
    const prevPrices = prices.slice(0, -1);
    const prevShortMA = this.calculateMA(prevPrices, strategy.shortWindow);
    const prevLongMA = this.calculateMA(prevPrices, strategy.longWindow);
    
    // Current price
    const currentPrice = prices[prices.length - 1];
    
    // Default to hold
    let direction: 'buy' | 'sell' | 'hold' = 'hold';
    let strength = 0;
    let confidence = 0;
    
    // Check for crossovers
    if (shortMA > longMA && prevShortMA <= prevLongMA) {
      // Bullish crossover
      direction = 'buy';
      strength = Math.min(1, (shortMA - longMA) / longMA * 10);
      confidence = 0.7 + (Math.random() * 0.2);
    } else if (shortMA < longMA && prevShortMA >= prevLongMA) {
      // Bearish crossover
      direction = 'sell';
      strength = Math.min(1, (longMA - shortMA) / shortMA * 10);
      confidence = 0.7 + (Math.random() * 0.2);
    }
    
    if (direction === 'hold') {
      return null;
    }
    
    // Create signal
    return {
      id: generateId(),
      symbol,
      direction,
      strength,
      confidence,
      timestamp: new Date(),
      metadata: {
        strategy: strategy.name,
        shortMA,
        longMA,
        currentPrice,
        generation: strategy.generation
      }
    };
  }
  
  /**
   * Execute a trading signal
   */
  private async executeSignal(signal: Signal): Promise<void> {
    console.log(`Executing ${signal.direction} signal for ${signal.symbol}`);
    
    // Get current price
    const history = this.marketData.get(signal.symbol) || [];
    if (history.length === 0) return;
    
    const currentPrice = history[history.length - 1].price;
    
    // Determine position size based on portfolio value and signal strength
    const positionSize = this.calculatePositionSize(signal);
    
    // Create order
    const order: Order = {
      id: generateId(),
      symbol: signal.symbol,
      side: signal.direction === 'buy' ? OrderSide.Buy : OrderSide.Sell,
      type: OrderType.Market,
      amount: positionSize / currentPrice,
      price: currentPrice,
      status: OrderStatus.Created
    };
    
    // Execute order
    await this.executeOrder(order);
  }
  
  /**
   * Execute an order
   */
  private async executeOrder(order: Order): Promise<void> {
    // Set order to submitted
    order.status = OrderStatus.Submitted;
    
    // Apply slippage to price (0.1% to 0.5%)
    const slippage = 0.001 + (Math.random() * 0.004);
    const executionPrice = order.side === OrderSide.Buy
      ? order.price * (1 + slippage)  // Buy orders get worse price
      : order.price * (1 - slippage); // Sell orders get worse price
    
    // Calculate commission (0.1%)
    const commission = order.amount * executionPrice * 0.001;
    
    // Update order
    order.status = OrderStatus.Filled;
    order.filledAmount = order.amount;
    order.avgFillPrice = executionPrice;
    order.commission = commission;
    order.slippage = slippage;
    
    // Update cash
    if (order.side === OrderSide.Buy) {
      // Deduct cash for buy
      this.portfolio.cashBalance -= (order.amount * executionPrice) + commission;
    } else {
      // Add cash for sell
      this.portfolio.cashBalance += (order.amount * executionPrice) - commission;
    }
    
    // Update position
    this.updatePosition(order);
    
    // Store order in history
    this.orders.push(order);
    
    // Store trade in history
    this.history.trades.push({
      timestamp: new Date(),
      symbol: order.symbol,
      side: order.side,
      amount: order.amount,
      price: order.avgFillPrice,
      commission,
      slippage
    });
    
    console.log(`Order executed: ${order.side} ${order.amount.toFixed(4)} ${order.symbol} @ $${order.avgFillPrice.toFixed(2)}`);
  }
  
  /**
   * Update position based on an executed order
   */
  private updatePosition(order: Order): void {
    const { symbol, side, amount, avgFillPrice } = order;
    
    // Find existing position
    let position = Array.from(this.positions.values()).find(p => p.symbol === symbol);
    let pnl = 0;
    
    if (!position) {
      // Create new position
      position = {
        id: generateId(),
        symbol,
        direction: side === OrderSide.Buy ? PositionDirection.Long : PositionDirection.Short,
        size: amount,
        entryPrice: avgFillPrice!,
        currentPrice: avgFillPrice!,
        value: amount * avgFillPrice!,
        unrealizedPnl: 0,
        unrealizedPnlPct: 0
      };
      
      this.positions.set(position.id, position);
      console.log(`Position opened: ${position.direction} ${position.size.toFixed(4)} ${position.symbol} @ $${position.entryPrice.toFixed(2)}`);
    } else {
      // Update existing position
      if (side === OrderSide.Buy) {
        if (position.direction === PositionDirection.Long) {
          // Add to long position
          const newSize = position.size + amount;
          const newValue = position.value + (amount * avgFillPrice!);
          position.entryPrice = newValue / newSize;
          position.size = newSize;
          position.value = newValue;
          
          console.log(`Position increased: ${position.direction} ${position.size.toFixed(4)} ${position.symbol} @ $${position.entryPrice.toFixed(2)}`);
        } else {
          // Reduce short position
          const reduceAmount = Math.min(position.size, amount);
          
          // Calculate realized PnL
          pnl = (position.entryPrice - avgFillPrice!) * reduceAmount;
          this.portfolio.totalPnl += pnl;
          
          position.size -= reduceAmount;
          
          if (position.size <= 0) {
            // Position closed
            this.positions.delete(position.id);
            console.log(`Position closed: ${position.direction} ${position.symbol} with P&L: $${pnl.toFixed(2)}`);
          } else {
            // Position reduced
            position.value = position.size * avgFillPrice!;
            console.log(`Position decreased: ${position.direction} ${position.size.toFixed(4)} ${position.symbol} with P&L: $${pnl.toFixed(2)}`);
          }
        }
      } else { // Sell order
        if (position.direction === PositionDirection.Long) {
          // Reduce long position
          const reduceAmount = Math.min(position.size, amount);
          
          // Calculate realized PnL
          pnl = (avgFillPrice! - position.entryPrice) * reduceAmount;
          this.portfolio.totalPnl += pnl;
          
          position.size -= reduceAmount;
          
          if (position.size <= 0) {
            // Position closed
            this.positions.delete(position.id);
            console.log(`Position closed: ${position.direction} ${position.symbol} with P&L: $${pnl.toFixed(2)}`);
          } else {
            // Position reduced
            position.value = position.size * avgFillPrice!;
            console.log(`Position decreased: ${position.direction} ${position.size.toFixed(4)} ${position.symbol} with P&L: $${pnl.toFixed(2)}`);
          }
        } else {
          // Add to short position
          const newSize = position.size + amount;
          const newValue = position.value + (amount * avgFillPrice!);
          position.entryPrice = newValue / newSize;
          position.size = newSize;
          position.value = newValue;
          
          console.log(`Position increased: ${position.direction} ${position.size.toFixed(4)} ${position.symbol} @ $${position.entryPrice.toFixed(2)}`);
        }
      }
    }
    
    // Update portfolio
    this.updatePortfolioMetrics();
  }
  
  /**
   * Update position with new price
   */
  private updatePositionPrice(symbol: string, price: number): void {
    // Find position for symbol
    const position = Array.from(this.positions.values()).find(p => p.symbol === symbol);
    if (!position) return;
    
    // Update price and value
    position.currentPrice = price;
    position.value = position.size * price;
    
    // Calculate unrealized P&L
    if (position.direction === PositionDirection.Long) {
      position.unrealizedPnl = (price - position.entryPrice) * position.size;
    } else {
      position.unrealizedPnl = (position.entryPrice - price) * position.size;
    }
    
    position.unrealizedPnlPct = (position.unrealizedPnl / position.value) * 100;
  }
  
  /**
   * Check for stop loss and take profit
   */
  private checkStopLossAndTakeProfit(symbol: string): void {
    // Find position for symbol
    const position = Array.from(this.positions.values()).find(p => p.symbol === symbol);
    if (!position) return;
    
    // Get strategy
    const strategy = this.strategies.get(symbol);
    if (!strategy) return;
    
    // Check for stop loss
    if (position.unrealizedPnlPct < -strategy.stopLoss * 100) {
      console.log(`Stop loss triggered for ${symbol} at ${position.unrealizedPnlPct.toFixed(2)}%`);
      
      // Create order to close position
      const order: Order = {
        id: generateId(),
        symbol,
        side: position.direction === PositionDirection.Long ? OrderSide.Sell : OrderSide.Buy,
        type: OrderType.Market,
        amount: position.size,
        price: position.currentPrice,
        status: OrderStatus.Created
      };
      
      // Execute order
      this.executeOrder(order);
    }
    
    // Check for take profit
    if (position.unrealizedPnlPct > strategy.takeProfit * 100) {
      console.log(`Take profit triggered for ${symbol} at ${position.unrealizedPnlPct.toFixed(2)}%`);
      
      // Create order to close position
      const order: Order = {
        id: generateId(),
        symbol,
        side: position.direction === PositionDirection.Long ? OrderSide.Sell : OrderSide.Buy,
        type: OrderType.Market,
        amount: position.size,
        price: position.currentPrice,
        status: OrderStatus.Created
      };
      
      // Execute order
      this.executeOrder(order);
    }
  }
  
  /**
   * Update portfolio metrics
   */
  private updatePortfolioMetrics(): void {
    // Update positions list
    this.portfolio.positions = Array.from(this.positions.values());
    
    // Calculate portfolio value
    let positionValue = 0;
    for (const position of this.positions.values()) {
      positionValue += position.value;
    }
    
    this.portfolio.portfolioValue = this.portfolio.cashBalance + positionValue;
    
    // Store performance point
    this.history.performance.push({
      timestamp: new Date(),
      portfolioValue: this.portfolio.portfolioValue,
      cashBalance: this.portfolio.cashBalance,
      positionValue,
      totalPnl: this.portfolio.totalPnl,
      positionCount: this.portfolio.positions.length
    });
    
    // Keep only last 1000 performance points
    if (this.history.performance.length > 1000) {
      this.history.performance = this.history.performance.slice(-1000);
    }
  }
  
  /**
   * Optimize trading strategies
   */
  private optimizeStrategies(): void {
    console.log('Optimizing trading strategies...');
    
    for (const symbol of this.symbols) {
      this.optimizeStrategy(symbol);
    }
  }
  
  /**
   * Optimize a single trading strategy
   */
  private optimizeStrategy(symbol: string): void {
    const strategy = this.strategies.get(symbol);
    if (!strategy) return;
    
    // Skip if optimized recently (less than 30 seconds ago in this demo)
    const timeSinceLastOptimization = Date.now() - strategy.lastOptimized.getTime();
    if (timeSinceLastOptimization < 30000) return;
    
    console.log(`Optimizing strategy for ${symbol}...`);
    
    // In a real system, we would use more sophisticated optimization methods
    // For this demo, we'll use simple genetic algorithm approach
    
    // 1. Generate variations of the strategy
    const variations: StrategyParams[] = [];
    for (let i = 0; i < 5; i++) {
      variations.push(this.mutateStrategy(strategy));
    }
    
    // 2. Evaluate fitness of each variation
    const evaluatedVariations = variations.map(v => {
      return {
        strategy: v,
        fitness: this.evaluateStrategy(symbol, v)
      };
    });
    
    // 3. Select the best variation
    evaluatedVariations.sort((a, b) => b.fitness - a.fitness);
    const bestVariation = evaluatedVariations[0];
    
    // 4. If better than current, update strategy
    if (bestVariation.fitness > strategy.fitness) {
      const newStrategy = bestVariation.strategy;
      newStrategy.fitness = bestVariation.fitness;
      newStrategy.generation = strategy.generation + 1;
      newStrategy.lastOptimized = new Date();
      
      this.strategies.set(symbol, newStrategy);
      
      // Store optimization in history
      this.history.optimizations.push({
        timestamp: new Date(),
        symbol,
        oldStrategy: { ...strategy },
        newStrategy: { ...newStrategy },
        improvement: (newStrategy.fitness - strategy.fitness) / strategy.fitness * 100
      });
      
      console.log(`Strategy optimized for ${symbol}: Fitness improved from ${strategy.fitness.toFixed(4)} to ${newStrategy.fitness.toFixed(4)}`);
    } else {
      // Just update last optimized time
      strategy.lastOptimized = new Date();
      this.strategies.set(symbol, strategy);
      console.log(`No improvement found for ${symbol} strategy`);
    }
  }
  
  /**
   * Create a mutated copy of a strategy
   */
  private mutateStrategy(strategy: StrategyParams): StrategyParams {
    const newStrategy = { ...strategy };
    
    // Randomly adjust parameters
    // Short window (5-20)
    newStrategy.shortWindow = Math.max(5, Math.min(20, 
      strategy.shortWindow + Math.floor(Math.random() * 5) - 2
    ));
    
    // Long window (30-100)
    newStrategy.longWindow = Math.max(30, Math.min(100, 
      strategy.longWindow + Math.floor(Math.random() * 10) - 5
    ));
    
    // Ensure short window is less than long window
    if (newStrategy.shortWindow >= newStrategy.longWindow) {
      newStrategy.longWindow = newStrategy.shortWindow * 2;
    }
    
    // Signal threshold (0.01-0.05)
    newStrategy.signalThreshold = Math.max(0.01, Math.min(0.05, 
      strategy.signalThreshold + (Math.random() * 0.02 - 0.01)
    ));
    
    // Stop loss (0.02-0.1)
    newStrategy.stopLoss = Math.max(0.02, Math.min(0.1, 
      strategy.stopLoss + (Math.random() * 0.04 - 0.02)
    ));
    
    // Take profit (0.05-0.2)
    newStrategy.takeProfit = Math.max(0.05, Math.min(0.2, 
      strategy.takeProfit + (Math.random() * 0.06 - 0.03)
    ));
    
    // Position size (5-20%)
    newStrategy.positionSizePercent = Math.max(5, Math.min(20, 
      strategy.positionSizePercent + Math.floor(Math.random() * 5) - 2
    ));
    
    return newStrategy;
  }
  
  /**
   * Evaluate a strategy's fitness
   */
  private evaluateStrategy(symbol: string, strategy: StrategyParams): number {
    // For a real system, we would backtest the strategy on historical data
    // For this demo, we'll use a simplified approach
    
    const history = this.marketData.get(symbol) || [];
    if (history.length < strategy.longWindow) {
      return 0; // Not enough data
    }
    
    // Calculate simple metrics based on recent performance
    const prices = history.map(d => d.price);
    const shortMA = this.calculateMA(prices, strategy.shortWindow);
    const longMA = this.calculateMA(prices, strategy.longWindow);
    
    // Calculate crossover count (indicator of potential trades)
    let crossovers = 0;
    for (let i = strategy.longWindow; i < prices.length; i++) {
      const prevShortMA = this.calculateMA(prices.slice(0, i), strategy.shortWindow);
      const prevLongMA = this.calculateMA(prices.slice(0, i), strategy.longWindow);
      const currShortMA = this.calculateMA(prices.slice(0, i+1), strategy.shortWindow);
      const currLongMA = this.calculateMA(prices.slice(0, i+1), strategy.longWindow);
      
      if ((prevShortMA <= prevLongMA && currShortMA > currLongMA) || 
          (prevShortMA >= prevLongMA && currShortMA < currLongMA)) {
        crossovers++;
      }
    }
    
    // Calculate fitness based on:
    // 1. Number of crossovers (more potential trades)
    // 2. Difference between short and long MA (stronger signals)
    // 3. Balance between stop loss and take profit
    // 4. Random factor for exploration
    
    const crossoverScore = Math.min(10, crossovers) / 10; // Normalize to 0-1
    const maScore = Math.abs(shortMA - longMA) / ((shortMA + longMA) / 2);
    const riskRewardScore = strategy.takeProfit / (strategy.stopLoss * 2); // Reward should be higher than risk
    const randomFactor = Math.random() * 0.2; // Random factor for exploration
    
    // Weighted score
    const fitness = (
      crossoverScore * 0.4 +
      maScore * 0.3 +
      riskRewardScore * 0.2 +
      randomFactor * 0.1
    );
    
    return fitness;
  }
  
  /**
   * Calculate position size based on portfolio value and signal
   */
  private calculatePositionSize(signal: Signal): number {
    const strategy = this.strategies.get(signal.symbol);
    if (!strategy) return 0;
    
    // Base size on strategy parameters
    let sizePercent = strategy.positionSizePercent;
    
    // Adjust based on signal strength and confidence
    if (signal.strength !== undefined && signal.confidence !== undefined) {
      sizePercent = sizePercent * (0.5 + signal.strength * 0.5) * signal.confidence;
    }
    
    // Cap at strategy max
    sizePercent = Math.min(sizePercent, strategy.positionSizePercent);
    
    // Calculate dollar amount
    return this.portfolio.portfolioValue * (sizePercent / 100);
  }
  
  /**
   * Calculate moving average
   */
  private calculateMA(prices: number[], window: number): number {
    if (prices.length < window) return 0;
    
    const slice = prices.slice(-window);
    return slice.reduce((sum, price) => sum + price, 0) / slice.length;
  }
  
  /**
   * Calculate volatility for a symbol
   */
  private calculateVolatility(symbol: string): number {
    const history = this.marketData.get(symbol) || [];
    if (history.length < 10) return 0.01; // Default volatility
    
    // Calculate recent price changes
    const returns: number[] = [];
    for (let i = 1; i < history.length; i++) {
      const prev = history[i-1].price;
      const curr = history[i].price;
      returns.push((curr - prev) / prev);
    }
    
    // Calculate standard deviation
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const stdev = Math.sqrt(variance);
    
    return stdev;
  }
  
  /**
   * Generate price change based on volatility
   */
  private generatePriceChange(volatility: number): number {
    // Generate a normally distributed random number
    // Using Box-Muller transform
    const u1 = Math.random();
    const u2 = Math.random();
    
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    
    // Scale by volatility
    return z0 * volatility;
  }
  
  /**
   * Get initial price for a symbol
   */
  private getInitialPrice(symbol: string): number {
    switch (symbol) {
      case 'BTC/USD': return 50000 + Math.random() * 1000 - 500;
      case 'ETH/USD': return 3000 + Math.random() * 100 - 50;
      default: return 100 + Math.random() * 10 - 5;
    }
  }
  
  /**
   * Get current portfolio
   */
  getPortfolio(): Portfolio {
    return { ...this.portfolio };
  }
  
  /**
   * Get strategy for a symbol
   */
  getStrategy(symbol: string): StrategyParams | undefined {
    return this.strategies.get(symbol);
  }
  
  /**
   * Print performance report
   */
  printPerformanceReport(): void {
    console.log('\n=== PERFORMANCE REPORT ===');
    console.log(`Initial Balance: $10,000.00`);
    console.log(`Current Portfolio Value: $${this.portfolio.portfolioValue.toFixed(2)}`);
    console.log(`Total P&L: $${this.portfolio.totalPnl.toFixed(2)} (${(this.portfolio.totalPnl / 10000 * 100).toFixed(2)}%)`);
    console.log(`Total Trades: ${this.history.trades.length}`);
    console.log(`Current Positions: ${this.portfolio.positions.length}`);
    
    if (this.portfolio.positions.length > 0) {
      console.log('\nOpen Positions:');
      for (const position of this.portfolio.positions) {
        console.log(`- ${position.symbol} ${position.direction} ${position.size.toFixed(4)} @ $${position.entryPrice.toFixed(2)} (Current: $${position.currentPrice.toFixed(2)})`);
        console.log(`  Unrealized P&L: $${position.unrealizedPnl.toFixed(2)} (${position.unrealizedPnlPct.toFixed(2)}%)`);
      }
    }
    
    console.log('\nStrategy Stats:');
    for (const [symbol, strategy] of this.strategies.entries()) {
      console.log(`- ${symbol}: Generation ${strategy.generation}, Fitness: ${strategy.fitness.toFixed(4)}`);
      console.log(`  Params: Short MA: ${strategy.shortWindow}, Long MA: ${strategy.longWindow}, Stop Loss: ${(strategy.stopLoss * 100).toFixed(1)}%, Take Profit: ${(strategy.takeProfit * 100).toFixed(1)}%`);
    }
    
    console.log('\nOptimization History:');
    const recentOptimizations = this.history.optimizations.slice(-3);
    if (recentOptimizations.length > 0) {
      for (const opt of recentOptimizations) {
        console.log(`- ${opt.symbol}: Gen ${opt.oldStrategy.generation} → Gen ${opt.newStrategy.generation}, Improvement: ${opt.improvement.toFixed(2)}%`);
      }
    } else {
      console.log('No optimizations yet');
    }
    
    console.log('===========================\n');
  }
}

// Run the demo
async function runTradingDemo() {
  console.log('Starting Self-Improving Trading Demo');
  
  // Create trading system
  const system = new SelfImprovingTradingSystem(['BTC/USD', 'ETH/USD'], 10000);
  
  // Start the system
  system.start(500); // 500ms update interval for faster demo
  
  // Run for 60 seconds
  console.log('System will run for 60 seconds...');
  
  // Print updates every 10 seconds
  for (let i = 1; i <= 6; i++) {
    await new Promise(resolve => setTimeout(resolve, 10000));
    console.log(`\n[${i * 10}s] Progress update:`);
    
    const portfolio = system.getPortfolio();
    const btcStrategy = system.getStrategy('BTC/USD');
    
    console.log(`Portfolio Value: $${portfolio.portfolioValue.toFixed(2)}`);
    if (btcStrategy) {
      console.log(`BTC/USD Strategy: Gen ${btcStrategy.generation}, Short MA: ${btcStrategy.shortWindow}, Long MA: ${btcStrategy.longWindow}`);
    }
  }
  
  // Stop the system
  system.stop();
  
  console.log('\nDemo completed');
}

// Run if directly executed
runTradingDemo().catch(err => {
  console.error('Error in trading demo:', err);
}); 