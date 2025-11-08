/**
 * Execution Feedback Service
 * 
 * Collects post-execution market data and provides analysis
 * of execution quality, including slippage and adverse selection.
 */

import { ExecutionTelemetry } from '../../types/execution.types.js';
import { ExecutedOrder } from '../../types/execution.types.js';
import { analyzeAdverseSelection } from '../../utils/analyzeAdverseSelection.js';
import { computeFillIQ } from '../../models/ExecutionQualityModel.js';
import { ExecutionTelemetryService } from './ExecutionTelemetryService.js';

/**
 * Market data source interface
 */
interface MarketDataSource {
  getCurrentPrice(asset: string): Promise<number>;
  getPriceHistory(asset: string, startTime: number, endTime: number, intervalMs: number): Promise<number[]>;
}

/**
 * Service for collecting and analyzing post-execution data
 */
export class ExecutionFeedbackService {
  // Time window for post-execution monitoring (in ms)
  private readonly postExecutionWindowMs = 1000 * 60; // 1 minute
  
  // Number of price samples to collect after execution
  private readonly priceSampleCount = 5;
  
  // Cache of active monitoring tasks
  private monitoringTasks: Map<string, NodeJS.Timeout> = new Map();
  
  /**
   * Create a new execution feedback service
   * @param marketDataSource Source for price data
   * @param telemetryService Service for storing execution telemetry
   */
  constructor(
    private readonly marketDataSource: MarketDataSource,
    private readonly telemetryService: ExecutionTelemetryService
  ) {}
  
  /**
   * Process a newly executed order and start monitoring post-execution movement
   * @param executedOrder Order that was executed
   * @returns Promise that resolves with execution telemetry
   */
  async processExecution(executedOrder: ExecutedOrder): Promise<ExecutionTelemetry> {
    const { asset } = executedOrder.intent;
    const { venue, orderId, executedPrice } = executedOrder;
    
    // Get the current market price
    const currentPrice = await this.marketDataSource.getCurrentPrice(asset);
    
    // Calculate initial slippage (as a percentage)
    const expectedPrice = executedOrder.intent.price || currentPrice;
    const slippage = executedOrder.intent.side === 'buy'
      ? (executedPrice - expectedPrice) / expectedPrice
      : (expectedPrice - executedPrice) / expectedPrice;
    
    // Create initial telemetry record
    const telemetry: ExecutionTelemetry = {
      orderId,
      asset,
      expectedPrice,
      filledPrice: executedPrice,
      side: executedOrder.intent.side,
      timestamp: executedOrder.timestamp,
      postFillDelta: 0, // Will be populated after monitoring
      slippage,
      venue,
      urgency: executedOrder.intent.urgency,
      tags: executedOrder.intent.tags
    };
    
    // Start monitoring post-execution price movement
    this.startPostExecutionMonitoring(telemetry);
    
    return telemetry;
  }
  
  /**
   * Start monitoring price movement after an execution
   * @param telemetry Initial execution telemetry
   */
  private startPostExecutionMonitoring(telemetry: ExecutionTelemetry): void {
    // Calculate time interval between price samples
    const intervalMs = this.postExecutionWindowMs / this.priceSampleCount;
    
    // Create timeout to collect post-execution data
    const timeoutId = setTimeout(async () => {
      try {
        // Get price history for the post-execution window
        const endTime = Date.now();
        const startTime = telemetry.timestamp;
        
        const prices = await this.marketDataSource.getPriceHistory(
          telemetry.asset,
          startTime,
          endTime,
          intervalMs
        );
        
        // Analyze for adverse selection
        const postFillDelta = analyzeAdverseSelection(telemetry, prices);
        
        // Update telemetry with post-execution data
        const updatedTelemetry: ExecutionTelemetry = {
          ...telemetry,
          postFillDelta,
          fillIQ: computeFillIQ({ ...telemetry, postFillDelta })
        };
        
        // Log the complete telemetry
        await this.telemetryService.log(updatedTelemetry);
        
        console.log(`Completed post-execution monitoring for ${telemetry.asset} order ${telemetry.orderId}`);
        console.log(`Fill IQ: ${updatedTelemetry.fillIQ}, Post-fill delta: ${postFillDelta}`);
        
        // Remove from active monitoring tasks
        this.monitoringTasks.delete(telemetry.orderId);
        
      } catch (error) {
        console.error(`Error in post-execution monitoring for ${telemetry.orderId}:`, error);
      }
    }, this.postExecutionWindowMs);
    
    // Store the task reference
    this.monitoringTasks.set(telemetry.orderId, timeoutId);
    
    console.log(`Started post-execution monitoring for ${telemetry.asset} order ${telemetry.orderId}`);
  }
  
  /**
   * Cancel monitoring for a specific order
   * @param orderId Order identifier
   */
  cancelMonitoring(orderId: string): void {
    const timeoutId = this.monitoringTasks.get(orderId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.monitoringTasks.delete(orderId);
      console.log(`Cancelled post-execution monitoring for order ${orderId}`);
    }
  }
  
  /**
   * Cancel all active monitoring tasks
   */
  cancelAllMonitoring(): void {
    for (const [orderId, timeoutId] of this.monitoringTasks.entries()) {
      clearTimeout(timeoutId);
      console.log(`Cancelled post-execution monitoring for order ${orderId}`);
    }
    this.monitoringTasks.clear();
  }
} 