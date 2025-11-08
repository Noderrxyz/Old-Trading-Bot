import { Fill, Position } from '../models/types';

/**
 * Performance metrics for backtest evaluation
 */
export interface PerformanceMetrics {
  // Return metrics
  totalReturn: number;
  annualizedReturn: number;
  dailyReturns: { date: Date; return: number }[];
  cagr?: number; // Optional CAGR property
  
  // Risk metrics
  volatility: number;
  downsideDeviation: number;
  maxDrawdown: number;
  maxDrawdownDuration: number;
  valueAtRisk: number;
  conditionalValueAtRisk: number;
  
  // Risk-adjusted metrics
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  
  // Trade metrics
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  averageTrade: number;
  largestWin: number;
  largestLoss: number;
  
  // Exposure metrics
  averageExposure: number;
  timeInMarket: number;
  
  // Drawdown profile
  drawdowns: { start: Date; end: Date; depth: number; duration: number }[];
  
  // Additional metrics
  totalPnl: number;
  totalCommissions: number;
  totalSlippage: number;
}

/**
 * Portfolio state for metrics calculation
 */
export interface PortfolioState {
  date: Date;
  cash: number;
  positions: Position[];
  equity: number;
  dailyPnl: number;
  dailyReturn: number;
}

/**
 * Options for metrics calculation
 */
export interface MetricsOptions {
  riskFreeRate?: number;
  tradingDaysPerYear?: number;
  confidenceLevel?: number;
}

/**
 * Calculates performance metrics from backtest results
 */
export class MetricsCalculator {
  private options: MetricsOptions;
  
  constructor(options: MetricsOptions = {}) {
    this.options = {
      riskFreeRate: 0.0,
      tradingDaysPerYear: 252,
      confidenceLevel: 0.95,
      ...options
    };
  }
  
  /**
   * Calculate performance metrics from portfolio states
   * 
   * @param portfolioStates Portfolio states in chronological order
   * @param fills Trade fills in chronological order
   * @returns Performance metrics
   */
  public calculateMetrics(portfolioStates: PortfolioState[], fills: Fill[]): PerformanceMetrics {
    // Handle the case where there are not enough portfolio states for calculation
    if (portfolioStates.length < 2) {
      return this.createEmptyMetrics();
    }
    
    // Calculate return metrics
    const returnMetrics = this.calculateReturnMetrics(portfolioStates);
    
    // Calculate risk metrics
    const riskMetrics = this.calculateRiskMetrics(portfolioStates);
    
    // Calculate trade metrics
    const tradeMetrics = this.calculateTradeMetrics(fills, portfolioStates);
    
    // Calculate exposure metrics
    const exposureMetrics = this.calculateExposureMetrics(portfolioStates);
    
    // Calculate risk-adjusted metrics
    const riskAdjustedMetrics = this.calculateRiskAdjustedMetrics(returnMetrics, riskMetrics, this.options);
    
    // Calculate additional metrics
    const additionalMetrics = this.calculateAdditionalMetrics(portfolioStates, fills);
    
    // Combine and validate all metrics
    const combinedMetrics: PerformanceMetrics = {
      // Return metrics
      totalReturn: returnMetrics.totalReturn,
      annualizedReturn: returnMetrics.annualizedReturn,
      cagr: returnMetrics.cagr,
      dailyReturns: returnMetrics.dailyReturns,
      
      // Risk metrics
      volatility: riskMetrics.volatility,
      downsideDeviation: riskMetrics.downsideDeviation,
      maxDrawdown: riskMetrics.maxDrawdown,
      maxDrawdownDuration: riskMetrics.maxDrawdownDuration,
      valueAtRisk: riskMetrics.valueAtRisk,
      conditionalValueAtRisk: riskMetrics.conditionalValueAtRisk,
      drawdowns: riskMetrics.drawdowns,
      
      // Risk-adjusted metrics
      sharpeRatio: riskAdjustedMetrics.sharpeRatio,
      sortinoRatio: riskAdjustedMetrics.sortinoRatio,
      calmarRatio: riskAdjustedMetrics.calmarRatio,
      
      // Trade metrics
      totalTrades: tradeMetrics.totalTrades,
      winningTrades: tradeMetrics.winningTrades,
      losingTrades: tradeMetrics.losingTrades,
      winRate: tradeMetrics.winRate,
      avgWin: tradeMetrics.avgWin,
      avgLoss: tradeMetrics.avgLoss,
      profitFactor: tradeMetrics.profitFactor,
      averageTrade: tradeMetrics.averageTrade,
      largestWin: tradeMetrics.largestWin,
      largestLoss: tradeMetrics.largestLoss,
      
      // Exposure metrics
      averageExposure: exposureMetrics.averageExposure,
      timeInMarket: exposureMetrics.timeInMarket,
      
      // Additional metrics
      totalPnl: additionalMetrics.totalPnl,
      totalCommissions: additionalMetrics.totalCommissions,
      totalSlippage: additionalMetrics.totalSlippage
    };
    
    return combinedMetrics;
  }
  
  /**
   * Create empty metrics object with default values
   */
  private createEmptyMetrics(): PerformanceMetrics {
    return {
      totalReturn: 0,
      annualizedReturn: 0,
      cagr: 0,
      volatility: 0,
      downsideDeviation: 0,
      maxDrawdown: 0,
      maxDrawdownDuration: 0,
      valueAtRisk: 0,
      conditionalValueAtRisk: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      averageTrade: 0,
      largestWin: 0,
      largestLoss: 0,
      timeInMarket: 0,
      averageExposure: 0,
      dailyReturns: [],
      drawdowns: [],
      totalPnl: 0,
      totalCommissions: 0,
      totalSlippage: 0
    };
  }
  
  /**
   * Calculate return metrics from portfolio states
   */
  private calculateReturnMetrics(portfolioStates: PortfolioState[]): {
    totalReturn: number;
    annualizedReturn: number;
    cagr: number;
    dailyReturns: { date: Date; return: number }[];
  } {
    // Extract equity curve and daily returns
    const equityCurve = portfolioStates.map(state => state.equity);
    const dailyReturns = portfolioStates.map(state => ({
      date: state.date,
      return: state.dailyReturn
    }));
    
    // Calculate return metrics
    const initialEquity = equityCurve[0];
    const finalEquity = equityCurve[equityCurve.length - 1];
    const totalReturn = (finalEquity / initialEquity) - 1;
    
    const daysInBacktest = this.calculateTradingDays(portfolioStates);
    const yearsInBacktest = daysInBacktest / this.options.tradingDaysPerYear!;
    const annualizedReturn = Math.pow(1 + totalReturn, 1 / yearsInBacktest) - 1;
    
    // Calculate CAGR (Compound Annual Growth Rate)
    const cagr = Math.pow(finalEquity / initialEquity, 1 / yearsInBacktest) - 1;
    
    return {
      totalReturn,
      annualizedReturn,
      cagr,
      dailyReturns,
    };
  }
  
  /**
   * Calculate risk metrics from portfolio states
   */
  private calculateRiskMetrics(portfolioStates: PortfolioState[]): {
    volatility: number;
    downsideDeviation: number;
    maxDrawdown: number;
    maxDrawdownDuration: number;
    valueAtRisk: number;
    conditionalValueAtRisk: number;
    drawdowns: { start: Date; end: Date; depth: number; duration: number }[];
  } {
    // Extract equity curve and daily returns
    const equityCurve = portfolioStates.map(state => state.equity);
    const dailyReturns = portfolioStates.map(state => ({
      date: state.date,
      return: state.dailyReturn
    }));
    
    // Calculate risk metrics
    const returns = dailyReturns.map(r => r.return);
    const volatility = this.calculateVolatility(returns);
    const annualizedVolatility = volatility * Math.sqrt(this.options.tradingDaysPerYear!);
    
    const downsideReturns = returns.filter(r => r < 0);
    const downsideDeviation = this.calculateStandardDeviation(downsideReturns);
    const annualizedDownsideDeviation = downsideDeviation * Math.sqrt(this.options.tradingDaysPerYear!);
    
    const { maxDrawdown, maxDrawdownDuration, drawdowns } = this.calculateDrawdowns(equityCurve, portfolioStates);
    
    const valueAtRisk = this.calculateValueAtRisk(returns, this.options.confidenceLevel!);
    const conditionalValueAtRisk = this.calculateConditionalValueAtRisk(returns, this.options.confidenceLevel!);
    
    return {
      volatility: annualizedVolatility,
      downsideDeviation: annualizedDownsideDeviation,
      maxDrawdown,
      maxDrawdownDuration,
      valueAtRisk,
      conditionalValueAtRisk,
      drawdowns,
    };
  }
  
  /**
   * Calculate trade metrics from fills and portfolio states
   */
  private calculateTradeMetrics(fills: Fill[], portfolioStates: PortfolioState[]): {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    averageTrade: number;
    largestWin: number;
    largestLoss: number;
  } {
    // Group fills by order ID to reconstruct trades
    const fillsByOrder = new Map<string, Fill[]>();
    
    for (const fill of fills) {
      if (!fillsByOrder.has(fill.orderId)) {
        fillsByOrder.set(fill.orderId, []);
      }
      
      fillsByOrder.get(fill.orderId)!.push(fill);
    }
    
    // TODO: This is a simplified approach that assumes each order is a complete trade
    // In a real system, you'd need to pair entry and exit orders
    
    const trades: { pnl: number; entryPrice: number; exitPrice: number; size: number }[] = [];
    let position: { symbol: string; side: 'buy' | 'sell'; avgPrice: number; size: number } | null = null;
    
    // This simplified implementation assumes sequential fills for the same symbol represent entry and exit
    for (const fill of fills) {
      if (!position || position.symbol !== fill.symbol) {
        // New position
        position = {
          symbol: fill.symbol,
          side: fill.side,
          avgPrice: fill.price,
          size: fill.quantity
        };
      } else if (fill.side !== position.side) {
        // Closing position (opposite side)
        const entryPrice = position.avgPrice;
        const exitPrice = fill.price;
        const size = Math.min(position.size, fill.quantity);
        
        let pnl = 0;
        
        if (position.side === 'buy') {
          // Long position
          pnl = (exitPrice - entryPrice) * size;
        } else {
          // Short position
          pnl = (entryPrice - exitPrice) * size;
        }
        
        trades.push({
          pnl,
          entryPrice,
          exitPrice,
          size
        });
        
        // Update or close position
        position.size -= size;
        if (position.size <= 0) {
          position = null;
        }
      } else {
        // Adding to position (same side)
        const newSize = position.size + fill.quantity;
        position.avgPrice = (position.avgPrice * position.size + fill.price * fill.quantity) / newSize;
        position.size = newSize;
      }
    }
    
    // Calculate trade statistics
    const totalTrades = trades.length;
    const winningTrades = trades.filter(t => t.pnl > 0).length;
    const losingTrades = trades.filter(t => t.pnl < 0).length;
    
    const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;
    
    const wins = trades.filter(t => t.pnl > 0).map(t => t.pnl);
    const losses = trades.filter(t => t.pnl < 0).map(t => t.pnl);
    
    const avgWin = wins.length > 0 ? wins.reduce((sum, pnl) => sum + pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, pnl) => sum + pnl, 0) / losses.length) : 0;
    
    const grossProfit = wins.reduce((sum, pnl) => sum + pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, pnl) => sum + pnl, 0));
    
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;
    
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const averageTrade = totalTrades > 0 ? totalPnl / totalTrades : 0;
    
    const largestWin = wins.length > 0 ? Math.max(...wins) : 0;
    const largestLoss = losses.length > 0 ? Math.abs(Math.min(...losses)) : 0;
    
    return {
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      averageTrade,
      largestWin,
      largestLoss
    };
  }
  
  /**
   * Calculate exposure metrics from portfolio states
   */
  private calculateExposureMetrics(portfolioStates: PortfolioState[]): {
    averageExposure: number;
    timeInMarket: number;
  } {
    let totalExposure = 0;
    let daysInMarket = 0;
    
    for (const state of portfolioStates) {
      const positionValue = state.positions.reduce((sum, pos) => {
        return sum + Math.abs(pos.quantity * pos.currentPrice);
      }, 0);
      
      const exposure = positionValue / state.equity;
      totalExposure += exposure;
      
      if (positionValue > 0) {
        daysInMarket++;
      }
    }
    
    const averageExposure = portfolioStates.length > 0 ? totalExposure / portfolioStates.length : 0;
    const timeInMarket = portfolioStates.length > 0 ? daysInMarket / portfolioStates.length : 0;
    
    return {
      averageExposure,
      timeInMarket
    };
  }
  
  /**
   * Calculate risk-adjusted metrics
   */
  private calculateRiskAdjustedMetrics(
    returnMetrics: {
      totalReturn: number;
      annualizedReturn: number;
      cagr: number;
      dailyReturns: { date: Date; return: number }[];
    },
    riskMetrics: {
      volatility: number;
      downsideDeviation: number;
      maxDrawdown: number;
      maxDrawdownDuration: number;
      valueAtRisk: number;
      conditionalValueAtRisk: number;
      drawdowns: { start: Date; end: Date; depth: number; duration: number }[];
    },
    options: MetricsOptions
  ): {
    sharpeRatio: number;
    sortinoRatio: number;
    calmarRatio: number;
  } {
    // Calculate risk-adjusted metrics
    const excessReturn = returnMetrics.annualizedReturn - options.riskFreeRate!;
    
    // Use the volatility from risk metrics
    const sharpeRatio = riskMetrics.volatility !== 0 ? excessReturn / riskMetrics.volatility : 0;
    
    const sortinoRatio = riskMetrics.downsideDeviation !== 0 ? excessReturn / riskMetrics.downsideDeviation : 0;
    const calmarRatio = riskMetrics.maxDrawdown !== 0 ? returnMetrics.annualizedReturn / riskMetrics.maxDrawdown : 0;
    
    return {
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
    };
  }
  
  /**
   * Calculate the number of trading days in the backtest
   */
  private calculateTradingDays(portfolioStates: PortfolioState[]): number {
    return portfolioStates.length - 1;
  }
  
  /**
   * Calculate the standard deviation of a set of values
   */
  private calculateStandardDeviation(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
    
    return Math.sqrt(variance);
  }
  
  /**
   * Calculate the volatility (standard deviation of returns)
   */
  private calculateVolatility(returns: number[]): number {
    return this.calculateStandardDeviation(returns);
  }
  
  /**
   * Calculate drawdowns from an equity curve
   */
  private calculateDrawdowns(
    equityCurve: number[],
    portfolioStates: PortfolioState[]
  ): {
    maxDrawdown: number;
    maxDrawdownDuration: number;
    drawdowns: { start: Date; end: Date; depth: number; duration: number }[];
  } {
    let peak = equityCurve[0];
    let maxDrawdown = 0;
    let maxDrawdownDuration = 0;
    let currentDrawdownStart: number | null = null;
    let peakIndex = 0;
    
    const drawdowns: { start: Date; end: Date; depth: number; duration: number }[] = [];
    let currentDrawdown: { 
      start: Date; 
      startIndex: number;
      peak: number;
      peakIndex: number;
      end?: Date; 
      endIndex?: number;
      depth: number; 
      duration: number;
    } | null = null;
    
    for (let i = 1; i < equityCurve.length; i++) {
      const equity = equityCurve[i];
      
      // New peak
      if (equity > peak) {
        peak = equity;
        peakIndex = i;
        
        // End of previous drawdown
        if (currentDrawdown !== null) {
          currentDrawdown.end = portfolioStates[i - 1].date;
          currentDrawdown.endIndex = i - 1;
          currentDrawdown.duration = currentDrawdown.endIndex - currentDrawdown.startIndex;
          
          drawdowns.push({
            start: currentDrawdown.start,
            end: currentDrawdown.end,
            depth: currentDrawdown.depth,
            duration: currentDrawdown.duration
          });
          
          currentDrawdown = null;
        }
      } 
      // In drawdown
      else {
        const drawdown = (peak - equity) / peak;
        
        if (drawdown > 0) {
          // Start of new drawdown
          if (currentDrawdown === null) {
            currentDrawdown = {
              start: portfolioStates[peakIndex].date,
              startIndex: peakIndex,
              peak,
              peakIndex,
              depth: drawdown,
              duration: i - peakIndex
            };
          } 
          // Update existing drawdown
          else {
            currentDrawdown.depth = Math.max(currentDrawdown.depth, drawdown);
            currentDrawdown.duration = i - currentDrawdown.startIndex;
          }
          
          // Update max drawdown
          if (drawdown > maxDrawdown) {
            maxDrawdown = drawdown;
            maxDrawdownDuration = i - peakIndex;
          }
        }
      }
    }
    
    // Add the final drawdown if we're still in one
    if (currentDrawdown !== null) {
      currentDrawdown.end = portfolioStates[equityCurve.length - 1].date;
      currentDrawdown.endIndex = equityCurve.length - 1;
      currentDrawdown.duration = currentDrawdown.endIndex - currentDrawdown.startIndex;
      
      drawdowns.push({
        start: currentDrawdown.start,
        end: currentDrawdown.end,
        depth: currentDrawdown.depth,
        duration: currentDrawdown.duration
      });
    }
    
    return {
      maxDrawdown,
      maxDrawdownDuration,
      drawdowns
    };
  }
  
  /**
   * Calculate Value at Risk (VaR)
   */
  private calculateValueAtRisk(returns: number[], confidenceLevel: number): number {
    const sortedReturns = [...returns].sort((a, b) => a - b);
    const index = Math.floor(sortedReturns.length * (1 - confidenceLevel));
    return -sortedReturns[index];
  }
  
  /**
   * Calculate Conditional Value at Risk (CVaR) / Expected Shortfall
   */
  private calculateConditionalValueAtRisk(returns: number[], confidenceLevel: number): number {
    const sortedReturns = [...returns].sort((a, b) => a - b);
    const varIndex = Math.floor(sortedReturns.length * (1 - confidenceLevel));
    
    let sum = 0;
    for (let i = 0; i < varIndex; i++) {
      sum += sortedReturns[i];
    }
    
    return -sum / varIndex;
  }
  
  /**
   * Calculate additional metrics like totalPnl, commissions, and slippage
   */
  private calculateAdditionalMetrics(
    portfolioStates: PortfolioState[],
    fills: Fill[]
  ): {
    totalPnl: number;
    totalCommissions: number;
    totalSlippage: number;
  } {
    // Calculate total P&L from portfolio states
    const initialEquity = portfolioStates[0].equity;
    const finalEquity = portfolioStates[portfolioStates.length - 1].equity;
    const totalPnl = finalEquity - initialEquity;
    
    // Calculate total commissions from fills
    const totalCommissions = fills.reduce((sum, fill) => {
      const commission = fill.fee?.amount || 0;
      return sum + commission;
    }, 0);
    
    // Calculate total slippage (simplified version)
    // In a real system, you'd compare intended vs. actual execution prices
    const totalSlippage = 0;
    
    return {
      totalPnl,
      totalCommissions,
      totalSlippage
    };
  }
} 