/**
 * Execution Feedback Loop
 * 
 * Coordinates the execution feedback process, connecting executed orders
 * to post-execution analysis and venue adaptation.
 */

import { ExecutedOrder, ExecutionTelemetry } from '../../types/execution.types.js';
import { ExecutionFeedbackService } from './ExecutionFeedbackService.js';
import { ExecutionTelemetryService } from './ExecutionTelemetryService.js';
import { ExecutionRouter } from '../../infra/execution/ExecutionRouter.js';
import { computeFillIQ } from '../../models/ExecutionQualityModel.js';

/**
 * Market data source interface
 */
interface MarketDataSource {
  getCurrentPrice(asset: string): Promise<number>;
  getPriceHistory(asset: string, startTime: number, endTime: number, intervalMs: number): Promise<number[]>;
}

/**
 * Configuration for the execution feedback loop
 */
export interface FeedbackLoopConfig {
  // Whether to automatically process all executions
  autoProcessExecutions: boolean;
  
  // Interval to refresh venue rankings cache (ms)
  rankingRefreshIntervalMs: number;
  
  // Maximum age of telemetry data to use (ms)
  maxTelemetryAgeMs: number;
  
  // Whether to update router after each execution
  updateRouterAfterExecution: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: FeedbackLoopConfig = {
  autoProcessExecutions: true,
  rankingRefreshIntervalMs: 5 * 60 * 1000, // 5 minutes
  maxTelemetryAgeMs: 24 * 60 * 60 * 1000, // 24 hours
  updateRouterAfterExecution: true
};

/**
 * Service that coordinates the execution feedback loop
 */
export class ExecutionFeedbackLoop {
  private readonly feedbackService: ExecutionFeedbackService;
  private refreshInterval: NodeJS.Timeout | null = null;
  
  /**
   * Create a new execution feedback loop
   * @param telemetryService Service for storing execution telemetry
   * @param router Execution router to adapt
   * @param marketDataSource Source for market data
   * @param config Configuration options
   */
  constructor(
    private readonly telemetryService: ExecutionTelemetryService,
    private readonly router: ExecutionRouter,
    private readonly marketDataSource: MarketDataSource,
    private readonly config: FeedbackLoopConfig = DEFAULT_CONFIG
  ) {
    // Initialize the feedback service
    this.feedbackService = new ExecutionFeedbackService(
      marketDataSource,
      telemetryService
    );
  }
  
  /**
   * Start the execution feedback loop
   */
  start(): void {
    // Set up periodic refresh of venue rankings
    if (this.config.rankingRefreshIntervalMs > 0) {
      this.refreshInterval = setInterval(() => {
        this.router.clearRankingsCache();
        console.log('Cleared venue rankings cache for refresh');
      }, this.config.rankingRefreshIntervalMs);
    }
    
    console.log('Execution feedback loop started');
  }
  
  /**
   * Stop the execution feedback loop
   */
  stop(): void {
    // Clear the refresh interval
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    
    // Cancel any ongoing monitoring
    this.feedbackService.cancelAllMonitoring();
    
    console.log('Execution feedback loop stopped');
  }
  
  /**
   * Process an executed order
   * @param executedOrder Order that was executed
   * @returns Promise that resolves with the execution telemetry
   */
  async processExecution(executedOrder: ExecutedOrder): Promise<ExecutionTelemetry> {
    console.log(`Processing execution of ${executedOrder.intent.asset} order ${executedOrder.orderId}`);
    
    // Process the execution in the feedback service
    const telemetry = await this.feedbackService.processExecution(executedOrder);
    
    // Update router cache if configured to do so
    if (this.config.updateRouterAfterExecution) {
      this.router.clearRankingsCache(executedOrder.intent.asset);
    }
    
    return telemetry;
  }
  
  /**
   * Get recent telemetry for an asset
   * @param asset Asset identifier
   * @param maxAge Maximum age of telemetry data in ms (defaults to config value)
   * @returns Recent execution telemetry
   */
  async getRecentTelemetry(
    asset: string,
    maxAge: number = this.config.maxTelemetryAgeMs
  ): Promise<ExecutionTelemetry[]> {
    const allTelemetry = await this.telemetryService.getRecent(asset);
    
    // Filter by age
    const cutoffTime = Date.now() - maxAge;
    return allTelemetry.filter(t => t.timestamp >= cutoffTime);
  }
  
  /**
   * Get average Fill IQ by venue for an asset
   * @param asset Asset identifier
   * @returns Record mapping venues to average Fill IQ
   */
  async getAverageFillIQByVenue(asset: string): Promise<Record<string, number>> {
    const telemetry = await this.getRecentTelemetry(asset);
    
    // Group by venue
    const byVenue: Record<string, ExecutionTelemetry[]> = {};
    
    for (const t of telemetry) {
      if (!byVenue[t.venue]) {
        byVenue[t.venue] = [];
      }
      byVenue[t.venue].push(t);
    }
    
    // Calculate average Fill IQ for each venue
    const result: Record<string, number> = {};
    
    for (const [venue, entries] of Object.entries(byVenue)) {
      // Calculate Fill IQ for entries without it
      const withFillIQ = entries.map(t => ({
        ...t,
        fillIQ: t.fillIQ || computeFillIQ(t)
      }));
      
      // Calculate average
      const total = withFillIQ.reduce((sum, t) => sum + t.fillIQ!, 0);
      result[venue] = withFillIQ.length > 0 ? total / withFillIQ.length : 0;
    }
    
    return result;
  }
  
  /**
   * Generate a report of execution quality metrics
   * @param asset Asset identifier
   * @returns Execution quality report
   */
  async generateQualityReport(asset: string): Promise<{
    venuePerformance: Array<{ venue: string; fillIQ: number; fillCount: number; avgSlippage: number }>;
    overallFillIQ: number;
    totalExecutions: number;
    timeRange: { start: number; end: number };
  }> {
    // Get recent telemetry
    const telemetry = await this.getRecentTelemetry(asset);
    
    if (telemetry.length === 0) {
      return {
        venuePerformance: [],
        overallFillIQ: 0,
        totalExecutions: 0,
        timeRange: { start: Date.now(), end: Date.now() }
      };
    }
    
    // Group by venue
    const byVenue: Record<string, ExecutionTelemetry[]> = {};
    
    for (const t of telemetry) {
      if (!byVenue[t.venue]) {
        byVenue[t.venue] = [];
      }
      byVenue[t.venue].push(t);
    }
    
    // Calculate venue performance
    const venuePerformance = Object.entries(byVenue).map(([venue, entries]) => {
      // Calculate Fill IQ for entries without it
      const withFillIQ = entries.map(t => ({
        ...t,
        fillIQ: t.fillIQ || computeFillIQ(t)
      }));
      
      // Calculate averages
      const avgFillIQ = withFillIQ.reduce((sum, t) => sum + t.fillIQ!, 0) / withFillIQ.length;
      const avgSlippage = entries.reduce((sum, t) => sum + t.slippage, 0) / entries.length;
      
      return {
        venue,
        fillIQ: avgFillIQ,
        fillCount: entries.length,
        avgSlippage
      };
    }).sort((a, b) => b.fillIQ - a.fillIQ);
    
    // Calculate overall metrics
    const overallFillIQ = telemetry.reduce((sum, t) => sum + (t.fillIQ || computeFillIQ(t)), 0) / telemetry.length;
    
    // Find time range
    const timestamps = telemetry.map(t => t.timestamp);
    const start = Math.min(...timestamps);
    const end = Math.max(...timestamps);
    
    return {
      venuePerformance,
      overallFillIQ,
      totalExecutions: telemetry.length,
      timeRange: { start, end }
    };
  }
} 