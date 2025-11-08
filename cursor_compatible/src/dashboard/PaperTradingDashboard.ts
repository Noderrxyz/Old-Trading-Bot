import { EventEmitter } from 'events';
import { PaperTradingAdapter } from '../execution/adapters/PaperTradingAdapter';
import { PortfolioSnapshot, ExecutionReport, PaperOrder } from '../execution/interfaces/PaperTradingTypes';
import { Position } from '../types/position';
import { logger } from '../utils/logger';

/**
 * Dashboard data interfaces
 */
interface PerformanceMetrics {
  totalPnl: number;
  dayPnl: number;
  winRate: number;
  tradeCount: number;
  averageProfitPerTrade: number;
  largestProfit: number;
  largestLoss: number;
  equityCurve: number[];
  drawdowns: number[];
  sharpeRatio: number;
  maxDrawdown: number;
}

interface PerformancePoint {
  timestamp: Date;
  portfolioValue: number;
  cashBalance: number;
  positionValue: number;
  pnl: number;
  equityHigh: number;
}

/**
 * Simple performance dashboard for paper trading
 */
export class PaperTradingDashboard {
  private adapter: PaperTradingAdapter;
  private portfolioHistory: PerformancePoint[] = [];
  private executionHistory: ExecutionReport[] = [];
  private currentSnapshot: PortfolioSnapshot | null = null;
  private metrics: PerformanceMetrics;
  private events: EventEmitter = new EventEmitter();
  private updateInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  
  /**
   * Create a new performance dashboard
   * @param adapter Paper trading adapter
   */
  constructor(adapter: PaperTradingAdapter) {
    this.adapter = adapter;
    
    // Initialize metrics
    this.metrics = {
      totalPnl: 0,
      dayPnl: 0,
      winRate: 0,
      tradeCount: 0,
      averageProfitPerTrade: 0,
      largestProfit: 0,
      largestLoss: 0,
      equityCurve: [],
      drawdowns: [],
      sharpeRatio: 0,
      maxDrawdown: 0
    };
    
    // Set up event listeners
    this.setupEventListeners();
  }
  
  /**
   * Set up event listeners
   */
  private setupEventListeners(): void {
    // Listen for order execution
    this.adapter.on('order_executed', (order: PaperOrder) => {
      this.updateMetrics();
    });
    
    // Listen for position updates
    this.adapter.on('position_update', (event: { position: Position }) => {
      this.updateMetrics();
    });
    
    // Listen for price updates
    this.adapter.on('price_update', () => {
      this.updateMetrics();
    });
    
    // Listen for reset
    this.adapter.on('reset', () => {
      this.reset();
    });
  }
  
  /**
   * Start the dashboard updates
   * @param intervalMs Update interval in milliseconds
   */
  public start(intervalMs: number = 1000): void {
    if (this.isRunning) {
      logger.warn('Dashboard is already running');
      return;
    }
    
    this.isRunning = true;
    
    // Update immediately
    this.update();
    
    // Set up interval for updates
    this.updateInterval = setInterval(() => {
      this.update();
    }, intervalMs);
    
    logger.info(`Performance dashboard started with ${intervalMs}ms update interval`);
  }
  
  /**
   * Stop dashboard updates
   */
  public stop(): void {
    if (!this.isRunning) {
      logger.warn('Dashboard is not running');
      return;
    }
    
    // Clear interval
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    this.isRunning = false;
    logger.info('Performance dashboard stopped');
  }
  
  /**
   * Reset the dashboard
   */
  public reset(): void {
    this.portfolioHistory = [];
    this.executionHistory = [];
    this.currentSnapshot = null;
    
    // Reset metrics
    this.metrics = {
      totalPnl: 0,
      dayPnl: 0,
      winRate: 0,
      tradeCount: 0,
      averageProfitPerTrade: 0,
      largestProfit: 0,
      largestLoss: 0,
      equityCurve: [],
      drawdowns: [],
      sharpeRatio: 0,
      maxDrawdown: 0
    };
    
    logger.info('Performance dashboard reset');
    
    // Emit reset event
    this.events.emit('reset');
  }
  
  /**
   * Get current performance metrics
   * @returns Performance metrics
   */
  public getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }
  
  /**
   * Get portfolio history
   * @param limit Maximum number of points to return (most recent)
   * @returns Array of performance points
   */
  public getPortfolioHistory(limit?: number): PerformancePoint[] {
    if (limit && limit > 0) {
      return this.portfolioHistory.slice(-limit);
    }
    return [...this.portfolioHistory];
  }
  
  /**
   * Get latest portfolio snapshot
   * @returns Current portfolio snapshot
   */
  public getCurrentSnapshot(): PortfolioSnapshot | null {
    return this.currentSnapshot;
  }
  
  /**
   * Update dashboard
   */
  private update(): void {
    try {
      // Get current portfolio snapshot
      this.currentSnapshot = this.adapter.getPortfolioSnapshot();
      
      // Get execution history
      this.executionHistory = this.adapter.getExecutionHistory();
      
      // Update metrics
      this.updateMetrics();
      
      // Add to portfolio history
      this.addPortfolioDataPoint(this.currentSnapshot);
      
      // Emit update event
      this.events.emit('update', {
        snapshot: this.currentSnapshot,
        metrics: this.metrics
      });
    } catch (error) {
      logger.error('Error updating dashboard:', error);
    }
  }
  
  /**
   * Add a data point to the portfolio history
   */
  private addPortfolioDataPoint(snapshot: PortfolioSnapshot): void {
    if (!snapshot) return;
    
    // Calculate position value
    const positionValue = snapshot.positions.reduce(
      (total, position) => total + position.value,
      0
    );
    
    // Calculate all-time high
    const currentValue = snapshot.portfolioValue;
    const previousHigh = this.portfolioHistory.length > 0
      ? this.portfolioHistory[this.portfolioHistory.length - 1].equityHigh
      : currentValue;
    const equityHigh = Math.max(currentValue, previousHigh);
    
    // Create data point
    const point: PerformancePoint = {
      timestamp: snapshot.timestamp,
      portfolioValue: snapshot.portfolioValue,
      cashBalance: snapshot.cashBalance,
      positionValue,
      pnl: snapshot.dayPnl,
      equityHigh
    };
    
    // Add to history
    this.portfolioHistory.push(point);
    
    // Limit history size to avoid memory issues (keep last 10000 points)
    if (this.portfolioHistory.length > 10000) {
      this.portfolioHistory = this.portfolioHistory.slice(-10000);
    }
  }
  
  /**
   * Update performance metrics
   */
  private updateMetrics(): void {
    if (!this.currentSnapshot || this.executionHistory.length === 0) {
      return;
    }
    
    // Basic metrics from snapshot
    this.metrics.totalPnl = this.currentSnapshot.totalPnl;
    this.metrics.dayPnl = this.currentSnapshot.dayPnl;
    
    // Trade metrics
    const trades = this.executionHistory.filter(
      report => report.pnl !== 0 && report.pnl !== undefined
    );
    
    this.metrics.tradeCount = trades.length;
    
    if (trades.length > 0) {
      // Calculate win rate
      const winningTrades = trades.filter(trade => trade.pnl > 0);
      this.metrics.winRate = winningTrades.length / trades.length;
      
      // Calculate average profit
      const totalPnl = trades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
      this.metrics.averageProfitPerTrade = totalPnl / trades.length;
      
      // Find largest profit and loss
      const profits = trades.map(trade => trade.pnl || 0);
      this.metrics.largestProfit = Math.max(...profits);
      this.metrics.largestLoss = Math.min(...profits);
    }
    
    // Calculate equity curve and drawdowns
    if (this.portfolioHistory.length > 0) {
      // Equity curve is simply portfolio values
      this.metrics.equityCurve = this.portfolioHistory.map(point => point.portfolioValue);
      
      // Calculate drawdowns
      this.metrics.drawdowns = this.portfolioHistory.map(point => {
        if (point.equityHigh === 0) return 0;
        return (point.equityHigh - point.portfolioValue) / point.equityHigh * 100;
      });
      
      // Calculate max drawdown
      this.metrics.maxDrawdown = Math.max(...this.metrics.drawdowns);
      
      // Calculate simplified Sharpe ratio if we have enough data
      if (this.portfolioHistory.length > 10) {
        // Extract last 30 points or all available
        const returns = [];
        const points = this.portfolioHistory.slice(-Math.min(30, this.portfolioHistory.length));
        
        // Calculate daily returns
        for (let i = 1; i < points.length; i++) {
          const prev = points[i - 1].portfolioValue;
          const curr = points[i].portfolioValue;
          if (prev > 0) {
            returns.push((curr - prev) / prev);
          }
        }
        
        if (returns.length > 0) {
          // Calculate mean return
          const meanReturn = returns.reduce((sum, val) => sum + val, 0) / returns.length;
          
          // Calculate standard deviation
          const variance = returns.reduce((sum, val) => sum + Math.pow(val - meanReturn, 2), 0) / returns.length;
          const stdDev = Math.sqrt(variance);
          
          // Simplified Sharpe ratio
          this.metrics.sharpeRatio = stdDev > 0 ? meanReturn / stdDev : 0;
        }
      }
    }
  }
  
  /**
   * Subscribe to dashboard events
   * @param event Event name
   * @param listener Event listener
   * @returns Unsubscribe function
   */
  public on(event: string, listener: (...args: any[]) => void): () => void {
    this.events.on(event, listener);
    
    // Return unsubscribe function
    return () => this.events.off(event, listener);
  }
  
  /**
   * Generate a performance report
   * @returns Performance report string
   */
  public generateReport(): string {
    const snapshot = this.currentSnapshot;
    if (!snapshot) {
      return 'No data available';
    }
    
    // Format a number to 2 decimal places
    const f = (n: number) => n.toFixed(2);
    
    // Generate the report
    let report = '=== PAPER TRADING PERFORMANCE REPORT ===\n\n';
    
    report += `Portfolio Value: $${f(snapshot.portfolioValue)}\n`;
    report += `Cash Balance: $${f(snapshot.cashBalance)}\n`;
    report += `Total P&L: $${f(this.metrics.totalPnl)} (${f(this.metrics.totalPnl / snapshot.portfolioValue * 100)}%)\n`;
    report += `Day P&L: $${f(this.metrics.dayPnl)}\n\n`;
    
    report += `Trade Count: ${this.metrics.tradeCount}\n`;
    report += `Win Rate: ${f(this.metrics.winRate * 100)}%\n`;
    report += `Average Profit Per Trade: $${f(this.metrics.averageProfitPerTrade)}\n`;
    report += `Largest Profit: $${f(this.metrics.largestProfit)}\n`;
    report += `Largest Loss: $${f(this.metrics.largestLoss)}\n`;
    report += `Max Drawdown: ${f(this.metrics.maxDrawdown)}%\n`;
    report += `Sharpe Ratio: ${f(this.metrics.sharpeRatio)}\n\n`;
    
    report += 'Open Positions:\n';
    if (snapshot.positions.length > 0) {
      for (const position of snapshot.positions) {
        report += `- ${position.symbol} ${position.direction} ${position.size} @ ${f(position.entryPrice)} (Current: ${f(position.currentPrice)})\n`;
        if (position.unrealizedPnl) {
          report += `  Unrealized P&L: $${f(position.unrealizedPnl)} (${f(position.unrealizedPnlPct || 0)}%)\n`;
        }
      }
    } else {
      report += '  No open positions\n';
    }
    
    report += '\nRecent Executions:\n';
    const recentExecutions = this.executionHistory.slice(-5);
    if (recentExecutions.length > 0) {
      for (const execution of recentExecutions) {
        if (!execution.order) continue;
        
        report += `- ${execution.order.symbol} ${execution.order.side} ${f(execution.order.filledAmount)} @ ${f(execution.order.avgFillPrice)}\n`;
        if (execution.pnl !== 0 && execution.pnl !== undefined) {
          report += `  P&L: $${f(execution.pnl)}\n`;
        }
      }
    } else {
      report += '  No recent executions\n';
    }
    
    report += '\n======================================\n';
    
    return report;
  }
}

/**
 * Create a console-based dashboard instance
 * @param adapter Paper trading adapter
 * @returns Dashboard instance
 */
export function createConsoleDashboard(adapter: PaperTradingAdapter): PaperTradingDashboard {
  const dashboard = new PaperTradingDashboard(adapter);
  
  // Log updates periodically
  dashboard.on('update', () => {
    // Only log every 10 updates to avoid console spam
    const snapshot = dashboard.getCurrentSnapshot();
    if (snapshot && Math.random() < 0.1) {
      console.log('\n' + dashboard.generateReport());
    }
  });
  
  return dashboard;
} 