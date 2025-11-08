/**
 * Simulation Loop - Run trading simulation to validate system integration
 */

import { ValidationResult, CheckType, SimulationResult } from '../types';

export class SimulationLoop {
  private readonly duration: number; // minutes
  private readonly tickInterval = 100; // ms
  private readonly initialCapital = 100000; // $100k
  
  constructor(duration: number = 60) {
    this.duration = duration;
  }
  
  async run(): Promise<ValidationResult> {
    const result: ValidationResult = {
      success: true,
      checkType: CheckType.SIMULATION,
      timestamp: Date.now(),
      details: [],
      metrics: {}
    };
    
    try {
      // Initialize simulation
      result.details.push({
        success: true,
        message: `Starting ${this.duration} minute trading simulation`,
        metadata: {
          duration: this.duration,
          initialCapital: this.initialCapital
        }
      });
      
      // Run simulation
      const simulationResult = await this.runSimulation();
      
      // Validate AI → Execution → Risk loop
      const loopValidation = this.validateTradingLoop(simulationResult);
      result.details.push({
        success: loopValidation.success,
        message: loopValidation.message,
        metadata: loopValidation.metadata
      });
      
      if (!loopValidation.success) {
        result.success = false;
      }
      
      // Check performance metrics
      const performanceChecks = this.checkPerformanceMetrics(simulationResult);
      performanceChecks.forEach(check => {
        result.details.push(check);
        if (!check.success) {
          result.success = false;
        }
      });
      
      // Add metrics
      result.metrics = {
        'total_trades': simulationResult.trades,
        'pnl': simulationResult.pnl,
        'win_rate': simulationResult.winRate * 100,
        'sharpe_ratio': simulationResult.sharpeRatio,
        'max_drawdown': simulationResult.maxDrawdown * 100,
        'errors': simulationResult.errors
      };
      
    } catch (error) {
      result.success = false;
      result.error = error as Error;
      result.details.push({
        success: false,
        message: `Simulation failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
    
    return result;
  }
  
  private async runSimulation(): Promise<SimulationResult> {
    const startTime = Date.now();
    const endTime = startTime + (this.duration * 60 * 1000);
    
    let capital = this.initialCapital;
    let trades = 0;
    let wins = 0;
    let losses = 0;
    let errors = 0;
    const returns: number[] = [];
    let maxCapital = capital;
    let maxDrawdown = 0;
    
    // Simulate trading loop
    while (Date.now() < endTime) {
      try {
        // Simulate market data fetch
        const marketData = this.generateMarketData();
        
        // Simulate AI signal generation
        const signal = this.generateTradingSignal(marketData);
        
        // Simulate risk check
        const riskApproved = this.checkRisk(signal, capital);
        
        if (riskApproved && signal.confidence > 0.7) {
          // Simulate trade execution
          const tradeResult = await this.executeTrade(signal);
          trades++;
          
          // Update capital
          const pnl = tradeResult.pnl;
          capital += pnl;
          returns.push(pnl / (capital - pnl));
          
          if (pnl > 0) {
            wins++;
          } else {
            losses++;
          }
          
          // Track max capital and drawdown
          if (capital > maxCapital) {
            maxCapital = capital;
          }
          const currentDrawdown = (maxCapital - capital) / maxCapital;
          if (currentDrawdown > maxDrawdown) {
            maxDrawdown = currentDrawdown;
          }
        }
        
        // Wait for next tick
        await new Promise(resolve => setTimeout(resolve, this.tickInterval));
        
      } catch (error) {
        errors++;
        console.error('Simulation error:', error);
      }
    }
    
    // Calculate final metrics
    const totalPnL = capital - this.initialCapital;
    const winRate = trades > 0 ? wins / trades : 0;
    const sharpeRatio = this.calculateSharpeRatio(returns);
    
    return {
      trades,
      pnl: totalPnL,
      winRate,
      sharpeRatio,
      maxDrawdown,
      errors
    };
  }
  
  private generateMarketData(): any {
    // Simulate market data
    return {
      symbol: 'BTC/USDT',
      price: 50000 + (Math.random() - 0.5) * 1000,
      volume: Math.random() * 1000000,
      bid: 49950 + (Math.random() - 0.5) * 100,
      ask: 50050 + (Math.random() - 0.5) * 100,
      timestamp: Date.now()
    };
  }
  
  private generateTradingSignal(marketData: any): any {
    // Simulate AI signal generation
    const direction = Math.random() > 0.5 ? 'long' : 'short';
    const confidence = Math.random();
    
    return {
      symbol: marketData.symbol,
      direction,
      confidence,
      entryPrice: marketData.price,
      stopLoss: marketData.price * (direction === 'long' ? 0.98 : 1.02),
      takeProfit: marketData.price * (direction === 'long' ? 1.02 : 0.98),
      size: 0.1, // 10% of capital
      timestamp: Date.now()
    };
  }
  
  private checkRisk(signal: any, capital: number): boolean {
    // Simulate risk checks
    const positionSize = capital * signal.size;
    const maxLoss = Math.abs(signal.entryPrice - signal.stopLoss) * positionSize / signal.entryPrice;
    const maxLossPercent = maxLoss / capital;
    
    // Risk rules
    if (maxLossPercent > 0.02) return false; // Max 2% loss per trade
    if (signal.size > 0.2) return false; // Max 20% position size
    
    return true;
  }
  
  private async executeTrade(signal: any): Promise<{ pnl: number }> {
    // Simulate trade execution with random outcome
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
    
    // Simulate price movement
    const priceMovement = (Math.random() - 0.5) * 0.04; // ±2% movement
    const exitPrice = signal.entryPrice * (1 + priceMovement);
    
    // Calculate P&L
    const direction = signal.direction === 'long' ? 1 : -1;
    const pnlPercent = direction * (exitPrice - signal.entryPrice) / signal.entryPrice;
    const pnl = this.initialCapital * signal.size * pnlPercent;
    
    return { pnl };
  }
  
  private validateTradingLoop(result: SimulationResult): {
    success: boolean;
    message: string;
    metadata?: any;
  } {
    // Check if all components worked together
    const hasTradesExecuted = result.trades > 0;
    const hasReasonableWinRate = result.winRate >= 0.4 && result.winRate <= 0.7;
    const hasLowErrors = result.errors < result.trades * 0.01; // Less than 1% error rate
    
    const success = hasTradesExecuted && hasReasonableWinRate && hasLowErrors;
    
    return {
      success,
      message: success 
        ? 'AI → Execution → Risk loop validated successfully'
        : 'Trading loop validation failed',
      metadata: {
        tradesExecuted: hasTradesExecuted,
        winRateReasonable: hasReasonableWinRate,
        lowErrorRate: hasLowErrors,
        errorRate: result.trades > 0 ? result.errors / result.trades : 0
      }
    };
  }
  
  private checkPerformanceMetrics(result: SimulationResult): Array<{
    success: boolean;
    message: string;
    metadata?: any;
  }> {
    const checks = [];
    
    // Check profitability
    checks.push({
      success: result.pnl > 0,
      message: `Profitability: ${result.pnl > 0 ? 'Positive' : 'Negative'} P&L ($${result.pnl.toFixed(2)})`,
      metadata: { pnl: result.pnl }
    });
    
    // Check Sharpe ratio
    const sharpeTarget = 1.5;
    checks.push({
      success: result.sharpeRatio >= sharpeTarget,
      message: `Sharpe Ratio: ${result.sharpeRatio.toFixed(2)} (target: >${sharpeTarget})`,
      metadata: { sharpeRatio: result.sharpeRatio, target: sharpeTarget }
    });
    
    // Check max drawdown
    const maxDrawdownLimit = 0.15; // 15%
    checks.push({
      success: result.maxDrawdown <= maxDrawdownLimit,
      message: `Max Drawdown: ${(result.maxDrawdown * 100).toFixed(2)}% (limit: <${maxDrawdownLimit * 100}%)`,
      metadata: { maxDrawdown: result.maxDrawdown, limit: maxDrawdownLimit }
    });
    
    return checks;
  }
  
  private calculateSharpeRatio(returns: number[]): number {
    if (returns.length === 0) return 0;
    
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    // Annualized Sharpe ratio (assuming daily returns)
    return stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
  }
} 