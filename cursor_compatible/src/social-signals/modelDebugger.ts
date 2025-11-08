/**
 * Social Signals Model Debugger
 * 
 * Allows comparing performance of trading strategies with and without
 * social signal influences for debugging and optimization.
 */

import { createLogger } from '../common/logger.js';
import { SignalInjectionResult } from './socialModelAdapter.js';
import { UnifiedSocialSignal } from './types.js';

const logger = createLogger('ModelDebugger');

/**
 * Performance metric for a strategy with timestamps
 */
interface StrategyPerformancePoint {
  strategyId: string;
  timestamp: number;
  pnl: number;
  drawdown: number;
  sharpeRatio?: number;
  positionSize?: number;
  confidence?: number;
}

/**
 * Attribution event showing how social signals affected strategy decisions
 */
interface SignalAttributionEvent {
  strategyId: string;
  token: string;
  timestamp: number;
  // Trading action taken
  action: 'buy' | 'sell' | 'increase' | 'decrease' | 'hold';
  // Strategy performance without social signals (baseline)
  baselinePerformance: StrategyPerformancePoint;
  // Strategy performance with social signals
  actualPerformance: StrategyPerformancePoint;
  // The social signal that influenced the decision
  socialSignal: UnifiedSocialSignal;
  // How the signal was applied
  signalApplication: SignalInjectionResult;
  // Attribution metrics
  attribution: {
    // Change in position size due to signals (%)
    positionSizeImpact: number;
    // Change in entry/exit timing (ms)
    timingImpact: number;
    // Change in confidence threshold (%)
    confidenceImpact: number;
    // PnL attribution to social signals
    pnlAttribution: number;
  };
}

/**
 * Strategy comparison result
 */
interface StrategyComparisonResult {
  strategyId: string;
  token: string;
  period: {
    start: number;
    end: number;
  };
  // Performance metrics
  withSocialSignals: {
    totalPnl: number;
    maxDrawdown: number;
    sharpeRatio: number;
    winRate: number;
    tradeCount: number;
  };
  withoutSocialSignals: {
    totalPnl: number;
    maxDrawdown: number;
    sharpeRatio: number;
    winRate: number;
    tradeCount: number;
  };
  // Performance differences
  diff: {
    pnlDiff: number;
    pnlDiffPercent: number;
    drawdownDiff: number;
    sharpeRatioDiff: number;
    winRateDiff: number;
  };
  // Attribution summary
  attributionSummary: {
    totalPositivePnlAttribution: number;
    totalNegativePnlAttribution: number;
    netPnlAttribution: number;
    positionSizeContribution: number;
    timingContribution: number;
    confidenceContribution: number;
  };
}

/**
 * Debugger that analyzes and compares strategy performance with and without social signals
 */
export class ModelDebugger {
  private attributionEvents: Map<string, SignalAttributionEvent[]> = new Map();
  private performanceHistory: Map<string, StrategyPerformancePoint[]> = new Map();
  private shadowPerformanceHistory: Map<string, StrategyPerformancePoint[]> = new Map();
  
  constructor() {
    logger.info('Model Debugger initialized');
  }

  /**
   * Record a signal attribution event
   */
  public recordAttributionEvent(event: SignalAttributionEvent): void {
    const strategyId = event.strategyId;
    
    if (!this.attributionEvents.has(strategyId)) {
      this.attributionEvents.set(strategyId, []);
    }
    
    this.attributionEvents.get(strategyId)!.push(event);
    
    // Keep history sorted by timestamp
    this.attributionEvents.get(strategyId)!.sort((a, b) => a.timestamp - b.timestamp);
    
    logger.debug(`Recorded attribution event for ${strategyId} with PnL attribution of ${event.attribution.pnlAttribution.toFixed(4)}`);
  }

  /**
   * Record performance point for a strategy
   */
  public recordPerformancePoint(point: StrategyPerformancePoint, isShadow: boolean = false): void {
    const strategyId = point.strategyId;
    const historyMap = isShadow ? this.shadowPerformanceHistory : this.performanceHistory;
    
    if (!historyMap.has(strategyId)) {
      historyMap.set(strategyId, []);
    }
    
    historyMap.get(strategyId)!.push(point);
    
    // Keep history sorted by timestamp
    historyMap.get(strategyId)!.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Compare strategy performance with and without social signals
   */
  public comparePerformance(
    strategyId: string,
    startTime?: number,
    endTime?: number
  ): StrategyComparisonResult | null {
    try {
      // Get performance histories
      const actualHistory = this.performanceHistory.get(strategyId);
      const shadowHistory = this.shadowPerformanceHistory.get(strategyId);
      
      if (!actualHistory || !shadowHistory || actualHistory.length === 0 || shadowHistory.length === 0) {
        logger.warn(`Not enough performance data to compare strategy ${strategyId}`);
        return null;
      }
      
      // Default to all available data if no time range specified
      const start = startTime ?? Math.min(
        actualHistory[0].timestamp,
        shadowHistory[0].timestamp
      );
      
      const end = endTime ?? Math.max(
        actualHistory[actualHistory.length - 1].timestamp,
        shadowHistory[shadowHistory.length - 1].timestamp
      );
      
      // Filter performance points to time range
      const actualPoints = actualHistory.filter(p => p.timestamp >= start && p.timestamp <= end);
      const shadowPoints = shadowHistory.filter(p => p.timestamp >= start && p.timestamp <= end);
      
      if (actualPoints.length === 0 || shadowPoints.length === 0) {
        logger.warn(`No performance data in specified time range for strategy ${strategyId}`);
        return null;
      }
      
      // Get relevant attribution events
      const attributionEvents = (this.attributionEvents.get(strategyId) || [])
        .filter(e => e.timestamp >= start && e.timestamp <= end);
      
      // Calculate performance metrics
      const withSocial = this.calculatePerformanceMetrics(actualPoints);
      const withoutSocial = this.calculatePerformanceMetrics(shadowPoints);
      
      // Calculate attribution summary
      const attributionSummary = this.calculateAttributionSummary(attributionEvents);
      
      // Calculate performance differences
      const diff = {
        pnlDiff: withSocial.totalPnl - withoutSocial.totalPnl,
        pnlDiffPercent: withoutSocial.totalPnl !== 0
          ? ((withSocial.totalPnl - withoutSocial.totalPnl) / Math.abs(withoutSocial.totalPnl)) * 100
          : 0,
        drawdownDiff: withSocial.maxDrawdown - withoutSocial.maxDrawdown,
        sharpeRatioDiff: withSocial.sharpeRatio - withoutSocial.sharpeRatio,
        winRateDiff: withSocial.winRate - withoutSocial.winRate
      };
      
      // Get token from any attribution event or use unknown
      const token = attributionEvents.length > 0 
        ? attributionEvents[0].token 
        : 'unknown';
      
      return {
        strategyId,
        token,
        period: { start, end },
        withSocialSignals: withSocial,
        withoutSocialSignals: withoutSocial,
        diff,
        attributionSummary
      };
    } catch (error) {
      logger.error(`Error comparing performance for strategy ${strategyId}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Generate a performance comparison report for a strategy
   */
  public generatePerformanceReport(
    strategyId: string,
    timeRangeHours: number = 24
  ): string {
    const endTime = Date.now();
    const startTime = endTime - (timeRangeHours * 60 * 60 * 1000);
    
    const comparison = this.comparePerformance(strategyId, startTime, endTime);
    
    if (!comparison) {
      return `No performance data available for strategy ${strategyId} in the last ${timeRangeHours} hours.`;
    }
    
    const { withSocialSignals, withoutSocialSignals, diff, attributionSummary } = comparison;
    
    // Format the report
    return `
Performance Report for Strategy ${strategyId} (${comparison.token})
=====================================================================
Time Period: ${new Date(comparison.period.start).toISOString()} to ${new Date(comparison.period.end).toISOString()}

Performance with Social Signals:
  - Total PnL: ${withSocialSignals.totalPnl.toFixed(4)}
  - Max Drawdown: ${withSocialSignals.maxDrawdown.toFixed(4)}
  - Sharpe Ratio: ${withSocialSignals.sharpeRatio.toFixed(2)}
  - Win Rate: ${(withSocialSignals.winRate * 100).toFixed(1)}%
  - Trade Count: ${withSocialSignals.tradeCount}

Performance without Social Signals:
  - Total PnL: ${withoutSocialSignals.totalPnl.toFixed(4)}
  - Max Drawdown: ${withoutSocialSignals.maxDrawdown.toFixed(4)}
  - Sharpe Ratio: ${withoutSocialSignals.sharpeRatio.toFixed(2)}
  - Win Rate: ${(withoutSocialSignals.winRate * 100).toFixed(1)}%
  - Trade Count: ${withoutSocialSignals.tradeCount}

Performance Difference:
  - PnL Difference: ${diff.pnlDiff.toFixed(4)} (${diff.pnlDiffPercent.toFixed(2)}%)
  - Drawdown Difference: ${diff.drawdownDiff.toFixed(4)}
  - Sharpe Ratio Difference: ${diff.sharpeRatioDiff.toFixed(2)}
  - Win Rate Difference: ${(diff.winRateDiff * 100).toFixed(1)}%

Attribution Summary:
  - Net PnL Attribution to Social Signals: ${attributionSummary.netPnlAttribution.toFixed(4)}
  - Position Size Contribution: ${attributionSummary.positionSizeContribution.toFixed(4)}
  - Timing Contribution: ${attributionSummary.timingContribution.toFixed(4)}
  - Confidence Threshold Contribution: ${attributionSummary.confidenceContribution.toFixed(4)}
`;
  }

  /**
   * Clear performance history for a strategy
   */
  public clearStrategyHistory(strategyId: string): void {
    this.attributionEvents.delete(strategyId);
    this.performanceHistory.delete(strategyId);
    this.shadowPerformanceHistory.delete(strategyId);
    
    logger.info(`Cleared performance history for strategy ${strategyId}`);
  }

  /**
   * Get all recorded attribution events for a strategy
   */
  public getAttributionEvents(
    strategyId: string,
    startTime?: number,
    endTime?: number
  ): SignalAttributionEvent[] {
    const events = this.attributionEvents.get(strategyId) || [];
    
    if (startTime !== undefined || endTime !== undefined) {
      return events.filter(e => 
        (startTime === undefined || e.timestamp >= startTime) &&
        (endTime === undefined || e.timestamp <= endTime)
      );
    }
    
    return events;
  }

  /**
   * Calculate performance metrics from performance points
   */
  private calculatePerformanceMetrics(points: StrategyPerformancePoint[]): {
    totalPnl: number;
    maxDrawdown: number;
    sharpeRatio: number;
    winRate: number;
    tradeCount: number;
  } {
    if (points.length === 0) {
      return {
        totalPnl: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        winRate: 0,
        tradeCount: 0
      };
    }
    
    // Calculate total PnL
    const totalPnl = points[points.length - 1].pnl - points[0].pnl;
    
    // Find max drawdown
    const maxDrawdown = Math.max(...points.map(p => p.drawdown));
    
    // Calculate Sharpe ratio (simplified)
    // In a real implementation, this would use proper risk-free rate and annualization
    const returns = [];
    for (let i = 1; i < points.length; i++) {
      const returnVal = points[i].pnl - points[i - 1].pnl;
      returns.push(returnVal);
    }
    
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    );
    
    const sharpeRatio = stdDev === 0 ? 0 : avgReturn / stdDev;
    
    // Calculate win rate (simplified)
    const winCount = returns.filter(r => r > 0).length;
    const winRate = returns.length > 0 ? winCount / returns.length : 0;
    
    // Assuming each PnL change represents a trade (simplified)
    const tradeCount = returns.length;
    
    return {
      totalPnl,
      maxDrawdown,
      sharpeRatio,
      winRate,
      tradeCount
    };
  }

  /**
   * Calculate attribution summary from events
   */
  private calculateAttributionSummary(events: SignalAttributionEvent[]): {
    totalPositivePnlAttribution: number;
    totalNegativePnlAttribution: number;
    netPnlAttribution: number;
    positionSizeContribution: number;
    timingContribution: number;
    confidenceContribution: number;
  } {
    if (events.length === 0) {
      return {
        totalPositivePnlAttribution: 0,
        totalNegativePnlAttribution: 0,
        netPnlAttribution: 0,
        positionSizeContribution: 0,
        timingContribution: 0,
        confidenceContribution: 0
      };
    }
    
    let totalPositivePnlAttribution = 0;
    let totalNegativePnlAttribution = 0;
    let positionSizeContribution = 0;
    let timingContribution = 0;
    let confidenceContribution = 0;
    
    for (const event of events) {
      const { pnlAttribution, positionSizeImpact, timingImpact, confidenceImpact } = event.attribution;
      
      if (pnlAttribution > 0) {
        totalPositivePnlAttribution += pnlAttribution;
      } else {
        totalNegativePnlAttribution += pnlAttribution;
      }
      
      positionSizeContribution += positionSizeImpact;
      timingContribution += timingImpact;
      confidenceContribution += confidenceImpact;
    }
    
    const netPnlAttribution = totalPositivePnlAttribution + totalNegativePnlAttribution;
    
    return {
      totalPositivePnlAttribution,
      totalNegativePnlAttribution,
      netPnlAttribution,
      positionSizeContribution,
      timingContribution,
      confidenceContribution
    };
  }
} 