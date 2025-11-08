/**
 * Simulated Performance Tracker - Phase 5: Strategy Engine Integration
 * 
 * Provides real-time performance metrics for strategy execution in paper trading mode.
 * Tracks P&L, Sharpe ratio, drawdown, win rate, and other key performance indicators.
 * Operates with zero real-world costs in full simulation mode.
 */

import { logger } from '../utils/logger';
import { logPaperModeCall } from '../config/PaperModeConfig';

export interface PerformanceTrackerConfig {
  initialCapital: number;
  trackingId: string;
  benchmarkSymbol?: string;
  riskFreeRate?: number; // Annual risk-free rate for Sharpe calculation
  rollingPeriod?: number; // Days for rolling calculations
}

export interface TradeRecord {
  symbol: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  fees: number;
  timestamp: number;
  pnl?: number;
}

export interface PositionInfo {
  symbol: string;
  quantity: number;
  averagePrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  marketValue: number;
  currentPrice: number;
}

export interface PerformanceMetrics {
  // Portfolio metrics
  totalValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  unrealizedPnl: number;
  realizedPnl: number;
  
  // Trade metrics
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  
  // Risk metrics
  maxDrawdown: number;
  maxDrawdownPercent: number;
  currentDrawdown: number;
  currentDrawdownPercent: number;
  volatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  
  // Time metrics
  startTime: number;
  lastUpdate: number;
  tradingDays: number;
  
  // Additional metrics
  largestWin: number;
  largestLoss: number;
  averageTradeSize: number;
  totalFees: number;
  returnOnInvestment: number;
}

export class SimulatedPerformanceTracker {
  private config: PerformanceTrackerConfig;
  private initialCapital: number;
  private currentPortfolioValue: number;
  private highWaterMark: number;
  
  // Trade tracking
  private trades: TradeRecord[] = [];
  private positions: Map<string, PositionInfo> = new Map();
  private portfolioHistory: Array<{ timestamp: number; value: number }> = [];
  
  // Performance calculations
  private dailyReturns: number[] = [];
  private lastPortfolioValue: number;
  private startTime: number;
  
  // Cached metrics
  private cachedMetrics?: PerformanceMetrics;
  private lastMetricsUpdate: number = 0;
  private metricsUpdateInterval: number = 1000; // 1 second

  constructor(config: PerformanceTrackerConfig) {
    this.config = {
      benchmarkSymbol: 'BTC/USDT',
      riskFreeRate: 0.03, // 3% annual risk-free rate
      rollingPeriod: 252, // 252 trading days
      ...config
    };
    
    this.initialCapital = config.initialCapital;
    this.currentPortfolioValue = config.initialCapital;
    this.lastPortfolioValue = config.initialCapital;
    this.highWaterMark = config.initialCapital;
    this.startTime = Date.now();
    
    // Initialize portfolio history
    this.portfolioHistory.push({
      timestamp: this.startTime,
      value: this.initialCapital
    });
    
    logger.info(`[PERFORMANCE_TRACKER] Initialized tracker for ${config.trackingId}`, {
      initialCapital: config.initialCapital,
      riskFreeRate: config.riskFreeRate
    });
  }

  /**
   * Record a trade execution
   */
  public recordTrade(trade: TradeRecord): void {
    logPaperModeCall('SimulatedPerformanceTracker', 'recordTrade', {
      symbol: trade.symbol,
      side: trade.side,
      amount: trade.amount,
      price: trade.price
    });
    
    // Calculate P&L for this trade
    const pnl = this.calculateTradePnl(trade);
    const tradeWithPnl = { ...trade, pnl };
    
    this.trades.push(tradeWithPnl);
    this.updatePosition(tradeWithPnl);
    
    // Invalidate cached metrics
    this.cachedMetrics = undefined;
    
    logger.debug(`[PERFORMANCE_TRACKER] Recorded trade`, {
      symbol: trade.symbol,
      side: trade.side,
      pnl,
      totalTrades: this.trades.length
    });
  }

  /**
   * Update current portfolio value
   */
  public updatePortfolioValue(value: number): void {
    const now = Date.now();
    
    // Calculate daily return if it's a new day
    const lastUpdate = this.portfolioHistory[this.portfolioHistory.length - 1];
    const hoursSinceLastUpdate = (now - lastUpdate.timestamp) / (1000 * 60 * 60);
    
    if (hoursSinceLastUpdate >= 24) { // New trading day
      const dailyReturn = (value - this.lastPortfolioValue) / this.lastPortfolioValue;
      this.dailyReturns.push(dailyReturn);
      
      // Keep only recent returns
      if (this.dailyReturns.length > this.config.rollingPeriod!) {
        this.dailyReturns.shift();
      }
      
      this.lastPortfolioValue = value;
    }
    
    this.currentPortfolioValue = value;
    
    // Update high water mark
    if (value > this.highWaterMark) {
      this.highWaterMark = value;
    }
    
    // Add to portfolio history
    this.portfolioHistory.push({ timestamp: now, value });
    
    // Keep only recent history (last 1000 points)
    if (this.portfolioHistory.length > 1000) {
      this.portfolioHistory.shift();
    }
    
    // Invalidate cached metrics
    this.cachedMetrics = undefined;
  }

  /**
   * Update position with current market price
   */
  public updatePositionPrice(symbol: string, currentPrice: number): void {
    const position = this.positions.get(symbol);
    if (!position) return;
    
    position.currentPrice = currentPrice;
    position.marketValue = position.quantity * currentPrice;
    position.unrealizedPnl = (currentPrice - position.averagePrice) * position.quantity;
    
    // Invalidate cached metrics
    this.cachedMetrics = undefined;
  }

  /**
   * Get current performance metrics
   */
  public getMetrics(): PerformanceMetrics {
    const now = Date.now();
    
    // Return cached metrics if recent
    if (this.cachedMetrics && (now - this.lastMetricsUpdate) < this.metricsUpdateInterval) {
      return this.cachedMetrics;
    }
    
    this.cachedMetrics = this.calculateMetrics();
    this.lastMetricsUpdate = now;
    
    return this.cachedMetrics;
  }

  /**
   * Get position information
   */
  public getPositions(): PositionInfo[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get trade history
   */
  public getTradeHistory(): TradeRecord[] {
    return [...this.trades];
  }

  /**
   * Get portfolio value history
   */
  public getPortfolioHistory(): Array<{ timestamp: number; value: number }> {
    return [...this.portfolioHistory];
  }

  /**
   * Reset all tracking data
   */
  public reset(): void {
    logPaperModeCall('SimulatedPerformanceTracker', 'reset', { trackingId: this.config.trackingId });
    
    this.currentPortfolioValue = this.initialCapital;
    this.lastPortfolioValue = this.initialCapital;
    this.highWaterMark = this.initialCapital;
    this.startTime = Date.now();
    
    this.trades = [];
    this.positions.clear();
    this.portfolioHistory = [{
      timestamp: this.startTime,
      value: this.initialCapital
    }];
    this.dailyReturns = [];
    
    this.cachedMetrics = undefined;
    this.lastMetricsUpdate = 0;
    
    logger.info(`[PERFORMANCE_TRACKER] Reset tracker ${this.config.trackingId}`);
  }

  // Private methods

  private calculateTradePnl(trade: TradeRecord): number {
    const position = this.positions.get(trade.symbol);
    
    if (!position) {
      // First trade for this symbol - no P&L yet
      return 0;
    }
    
    if (trade.side === 'sell') {
      // Selling position - realize P&L
      const sellAmount = Math.min(trade.amount, position.quantity);
      return (trade.price - position.averagePrice) * sellAmount - trade.fees;
    } else {
      // Buying more - just fees
      return -trade.fees;
    }
  }

  private updatePosition(trade: TradeRecord): void {
    let position = this.positions.get(trade.symbol);
    
    if (!position) {
      position = {
        symbol: trade.symbol,
        quantity: 0,
        averagePrice: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
        marketValue: 0,
        currentPrice: trade.price
      };
      this.positions.set(trade.symbol, position);
    }
    
    if (trade.side === 'buy') {
      // Update average price and quantity
      const totalValue = (position.quantity * position.averagePrice) + (trade.amount * trade.price);
      const totalQuantity = position.quantity + trade.amount;
      
      position.averagePrice = totalValue / totalQuantity;
      position.quantity = totalQuantity;
    } else {
      // Selling - reduce quantity and update realized P&L
      const sellAmount = Math.min(trade.amount, position.quantity);
      position.quantity -= sellAmount;
      position.realizedPnl += trade.pnl || 0;
      
      // If position is closed, remove it
      if (position.quantity <= 0.0001) { // Small epsilon for floating point
        this.positions.delete(trade.symbol);
        return;
      }
    }
    
    // Update market value and unrealized P&L
    position.currentPrice = trade.price;
    position.marketValue = position.quantity * position.currentPrice;
    position.unrealizedPnl = (position.currentPrice - position.averagePrice) * position.quantity;
  }

  private calculateMetrics(): PerformanceMetrics {
    const now = Date.now();
    const runtime = now - this.startTime;
    const tradingDays = Math.max(1, runtime / (1000 * 60 * 60 * 24));
    
    // Basic portfolio metrics
    const totalPnl = this.currentPortfolioValue - this.initialCapital;
    const totalPnlPercent = (totalPnl / this.initialCapital) * 100;
    
    // Unrealized and realized P&L
    let unrealizedPnl = 0;
    let realizedPnl = 0;
    
    for (const position of this.positions.values()) {
      unrealizedPnl += position.unrealizedPnl;
      realizedPnl += position.realizedPnl;
    }
    
    // Add realized P&L from closed positions
    for (const trade of this.trades) {
      if (trade.pnl && trade.side === 'sell') {
        realizedPnl += trade.pnl;
      }
    }
    
    // Trade metrics
    const totalTrades = this.trades.length;
    const winningTrades = this.trades.filter(t => (t.pnl || 0) > 0).length;
    const losingTrades = this.trades.filter(t => (t.pnl || 0) < 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    
    const wins = this.trades.filter(t => (t.pnl || 0) > 0).map(t => t.pnl || 0);
    const losses = this.trades.filter(t => (t.pnl || 0) < 0).map(t => Math.abs(t.pnl || 0));
    
    const avgWin = wins.length > 0 ? wins.reduce((sum, w) => sum + w, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((sum, l) => sum + l, 0) / losses.length : 0;
    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0;
    
    // Drawdown metrics
    const currentDrawdown = this.highWaterMark - this.currentPortfolioValue;
    const currentDrawdownPercent = (currentDrawdown / this.highWaterMark) * 100;
    
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    let peak = this.initialCapital;
    
    for (const point of this.portfolioHistory) {
      if (point.value > peak) {
        peak = point.value;
      } else {
        const drawdown = peak - point.value;
        const drawdownPercent = (drawdown / peak) * 100;
        
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
        if (drawdownPercent > maxDrawdownPercent) {
          maxDrawdownPercent = drawdownPercent;
        }
      }
    }
    
    // Risk metrics
    const volatility = this.calculateVolatility();
    const sharpeRatio = this.calculateSharpeRatio(volatility);
    const sortinoRatio = this.calculateSortinoRatio();
    
    // Additional metrics
    const largestWin = wins.length > 0 ? Math.max(...wins) : 0;
    const largestLoss = losses.length > 0 ? Math.max(...losses) : 0;
    const totalFees = this.trades.reduce((sum, trade) => sum + trade.fees, 0);
    const averageTradeSize = totalTrades > 0 ? 
      this.trades.reduce((sum, trade) => sum + (trade.amount * trade.price), 0) / totalTrades : 0;
    const returnOnInvestment = totalPnlPercent;
    
    return {
      // Portfolio metrics
      totalValue: this.currentPortfolioValue,
      totalPnl,
      totalPnlPercent,
      unrealizedPnl,
      realizedPnl,
      
      // Trade metrics
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      
      // Risk metrics
      maxDrawdown,
      maxDrawdownPercent,
      currentDrawdown,
      currentDrawdownPercent,
      volatility,
      sharpeRatio,
      sortinoRatio,
      
      // Time metrics
      startTime: this.startTime,
      lastUpdate: now,
      tradingDays,
      
      // Additional metrics
      largestWin,
      largestLoss,
      averageTradeSize,
      totalFees,
      returnOnInvestment
    };
  }

  private calculateVolatility(): number {
    if (this.dailyReturns.length < 2) return 0;
    
    const mean = this.dailyReturns.reduce((sum, r) => sum + r, 0) / this.dailyReturns.length;
    const variance = this.dailyReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (this.dailyReturns.length - 1);
    
    // Annualize volatility (252 trading days)
    return Math.sqrt(variance * 252) * 100;
  }

  private calculateSharpeRatio(volatility: number): number {
    if (this.dailyReturns.length < 2 || volatility === 0) return 0;
    
    const annualReturn = this.calculateAnnualizedReturn();
    const excessReturn = annualReturn - (this.config.riskFreeRate! * 100);
    
    return excessReturn / volatility;
  }

  private calculateSortinoRatio(): number {
    if (this.dailyReturns.length < 2) return 0;
    
    const annualReturn = this.calculateAnnualizedReturn();
    const negativeReturns = this.dailyReturns.filter(r => r < 0);
    
    if (negativeReturns.length === 0) return annualReturn > 0 ? 999 : 0;
    
    const downside = negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length;
    const downsideDeviation = Math.sqrt(downside * 252) * 100;
    
    const excessReturn = annualReturn - (this.config.riskFreeRate! * 100);
    
    return downsideDeviation > 0 ? excessReturn / downsideDeviation : 0;
  }

  private calculateAnnualizedReturn(): number {
    if (this.dailyReturns.length === 0) return 0;
    
    const totalReturn = this.dailyReturns.reduce((product, r) => product * (1 + r), 1) - 1;
    const periods = this.dailyReturns.length / 252; // Convert to years
    
    if (periods <= 0) return 0;
    
    return (Math.pow(1 + totalReturn, 1 / periods) - 1) * 100;
  }
} 