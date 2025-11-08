/**
 * Execution Memory System
 * 
 * Tracks and learns from past execution performance to influence future route selection.
 * Maintains trust scores for DEXs, routes, pools, and tokens based on execution outcomes.
 */

import fs from 'fs';
import path from 'path';
import { OrderIntent, ExecutedOrder } from '../types/execution.types.js';
import { createLogger } from '../common/logger.js';

const logger = createLogger('ExecutionMemory');

/**
 * Route hash factors used to identify unique routes
 */
interface RouteIdentifier {
  // The venues involved in the route (e.g., "uniswap_v3")
  venue: string;
  
  // The token pair being traded (e.g., "ETH/USDC")
  tokenPair: string;
  
  // The specific pool or path used (e.g., "0.3%" for fee tier)
  poolIdentifier?: string;
}

/**
 * Trust score for a specific route
 */
interface RouteTrustScore {
  // Overall trust score (0-1)
  score: number;
  
  // Number of successful executions
  successCount: number;
  
  // Number of failed executions
  failureCount: number;
  
  // Average slippage in basis points
  avgSlippageBps: number;
  
  // Average latency in milliseconds
  avgLatencyMs: number;
  
  // Average gas cost in USD (if available)
  avgGasCostUsd?: number;
  
  // Last updated timestamp
  lastUpdated: number;
  
  // Last execution result (success/failure)
  lastResult?: 'success' | 'failure';
  
  // Recent reverts count (last 24h)
  recentRevertCount: number;
}

/**
 * Execution result log entry
 */
export interface ExecutionResult {
  // Unique execution ID
  id: string;
  
  // Timestamp of execution
  timestamp: number;
  
  // The asset pair traded
  asset: string;
  
  // Route used for execution
  route: RouteIdentifier;
  
  // Order side (buy/sell)
  side: 'buy' | 'sell';
  
  // Order quantity
  quantity: number;
  
  // Execution status
  status: 'filled' | 'partially_filled' | 'failed' | 'rejected';
  
  // Execution mode used
  executionMode: string;
  
  // Slippage in basis points (if available)
  slippageBps?: number;
  
  // Execution latency in milliseconds
  latencyMs?: number;
  
  // Gas cost in USD (if available)
  gasCostUsd?: number;
  
  // Reason for failure (if any)
  failureReason?: string;
  
  // Execution style used
  executionStyle?: string;
}

/**
 * Configuration for the execution memory system
 */
export interface ExecutionMemoryConfig {
  // Path to store trust scores
  trustScoreStorePath: string;
  
  // Path to store execution logs
  executionLogPath: string;
  
  // Default trust score for new routes
  defaultTrustScore: number;
  
  // Minimum trust score
  minTrustScore: number;
  
  // Maximum trust score
  maxTrustScore: number;
  
  // Success reward amount
  successRewardAmount: number;
  
  // Failure penalty amount
  failurePenaltyAmount: number;
  
  // Gas overrun penalty amount
  gasOverrunPenaltyAmount: number;
  
  // Slippage overrun penalty amount
  slippageOverrunPenaltyAmount: number;
  
  // How much to decrease score when route experiences reverts
  revertPenaltyAmount: number;
  
  // Decay factor for old data (0-1) - higher means faster decay
  historyDecayFactor: number;
  
  // How frequently to persist scores (in milliseconds)
  persistIntervalMs: number;
  
  // Maximum number of execution results to keep in memory
  maxExecutionResultsInMemory: number;
  
  // Whether to enable automatic persistence
  enableAutoPersist: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ExecutionMemoryConfig = {
  trustScoreStorePath: './trust_score_store.json',
  executionLogPath: './execution_results.jsonl',
  defaultTrustScore: 0.7,
  minTrustScore: 0.1,
  maxTrustScore: 1.0,
  successRewardAmount: 0.05,
  failurePenaltyAmount: 0.1,
  gasOverrunPenaltyAmount: 0.03,
  slippageOverrunPenaltyAmount: 0.05,
  revertPenaltyAmount: 0.15,
  historyDecayFactor: 0.01,
  persistIntervalMs: 60000, // 1 minute
  maxExecutionResultsInMemory: 1000,
  enableAutoPersist: true
};

/**
 * Route trust store containing all trust scores
 */
interface RouteTrustStore {
  // Map of route hashes to trust scores
  routes: Record<string, RouteTrustScore>;
  
  // Map of venues to aggregated trust scores
  venues: Record<string, number>;
  
  // Map of token pairs to aggregated trust scores
  tokenPairs: Record<string, number>;
  
  // Last updated timestamp
  lastUpdated: number;
  
  // Version of the trust store format
  version: string;
}

/**
 * Execution Memory System
 * 
 * Maintains historical performance data and trust scores for execution routes.
 */
export class ExecutionMemory {
  private config: ExecutionMemoryConfig;
  private trustStore: RouteTrustStore;
  private executionResults: ExecutionResult[] = [];
  private persistTimer: NodeJS.Timeout | null = null;
  private isDirty: boolean = false;
  
  /**
   * Create a new execution memory system
   * @param config Configuration options
   */
  constructor(config: Partial<ExecutionMemoryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.trustStore = this.loadTrustStore();
    
    if (this.config.enableAutoPersist) {
      this.persistTimer = setInterval(() => {
        if (this.isDirty) {
          this.persistTrustStore();
          this.isDirty = false;
        }
      }, this.config.persistIntervalMs);
    }
    
    logger.info(`ExecutionMemory initialized with ${Object.keys(this.trustStore.routes).length} routes`);
  }
  
  /**
   * Record execution result and update trust scores
   * @param order Original order intent
   * @param result Execution result
   */
  public recordExecution(order: OrderIntent, result: ExecutedOrder): void {
    const route = this.getRouteIdentifier(result);
    const routeHash = this.hashRoute(route);
    
    // Create execution result log
    const executionResult: ExecutionResult = {
      id: result.orderId,
      timestamp: result.timestamp,
      asset: order.asset,
      route,
      side: order.side,
      quantity: order.quantity,
      status: result.status,
      executionMode: order.tags?.find(t => t.startsWith('mode:'))?.replace('mode:', '') || 'unknown',
      slippageBps: result.slippageBps,
      latencyMs: result.latencyMs,
      executionStyle: result.metadata?.executionStyle,
      gasCostUsd: result.metadata?.gasCostUsd
    };
    
    // Add to in-memory execution results
    this.executionResults.push(executionResult);
    
    // Trim if exceeding maximum
    if (this.executionResults.length > this.config.maxExecutionResultsInMemory) {
      this.executionResults.shift();
    }
    
    // Append to log file
    this.appendToExecutionLog(executionResult);
    
    // Update trust score
    this.updateRouteTrustScore(routeHash, route, result);
    
    // Update aggregated trust scores
    this.updateAggregatedScores();
    
    logger.info(`Recorded execution for ${order.asset} on ${route.venue}: ${result.status}`);
  }
  
  /**
   * Get trust score for a specific route
   * @param venue Venue ID
   * @param tokenPair Token pair
   * @param poolIdentifier Optional pool identifier
   * @returns Trust score (0-1)
   */
  public getRouteTrust(venue: string, tokenPair: string, poolIdentifier?: string): number {
    const route: RouteIdentifier = { venue, tokenPair, poolIdentifier };
    const routeHash = this.hashRoute(route);
    
    if (this.trustStore.routes[routeHash]) {
      return this.trustStore.routes[routeHash].score;
    }
    
    return this.config.defaultTrustScore;
  }
  
  /**
   * Get trust score for a venue
   * @param venue Venue ID
   * @returns Trust score (0-1)
   */
  public getVenueTrust(venue: string): number {
    return this.trustStore.venues[venue] || this.config.defaultTrustScore;
  }
  
  /**
   * Get trust score for a token pair
   * @param tokenPair Token pair (e.g., "ETH/USDC")
   * @returns Trust score (0-1)
   */
  public getTokenPairTrust(tokenPair: string): number {
    return this.trustStore.tokenPairs[tokenPair] || this.config.defaultTrustScore;
  }
  
  /**
   * Get route scores for all known routes for a token pair
   * @param tokenPair Token pair to get routes for
   * @returns Map of venue to trust score for this token pair
   */
  public getRoutesForTokenPair(tokenPair: string): Map<string, number> {
    const routes = new Map<string, number>();
    
    // Find all routes that match this token pair
    Object.entries(this.trustStore.routes).forEach(([hash, routeScore]) => {
      const routeParts = hash.split('::');
      if (routeParts.length >= 2 && routeParts[1] === tokenPair) {
        routes.set(routeParts[0], routeScore.score);
      }
    });
    
    return routes;
  }
  
  /**
   * Get recent execution results
   * @param limit Maximum number of results to return
   * @param filterFn Optional filter function
   * @returns Array of execution results
   */
  public getRecentExecutions(
    limit: number = 100,
    filterFn?: (result: ExecutionResult) => boolean
  ): ExecutionResult[] {
    let results = [...this.executionResults];
    
    // Apply filter if provided
    if (filterFn) {
      results = results.filter(filterFn);
    }
    
    // Sort by timestamp descending (newest first)
    results.sort((a, b) => b.timestamp - a.timestamp);
    
    // Return limited results
    return results.slice(0, limit);
  }
  
  /**
   * Get recent failures for analysis
   * @param timeframeMs Timeframe to look back in milliseconds
   * @returns Map of failure reasons to count
   */
  public getRecentFailures(timeframeMs: number = 86400000): Map<string, number> {
    const cutoffTime = Date.now() - timeframeMs;
    const failures = new Map<string, number>();
    
    this.executionResults
      .filter(r => r.timestamp >= cutoffTime && r.status !== 'filled')
      .forEach(result => {
        const reason = result.failureReason || 'unknown';
        failures.set(reason, (failures.get(reason) || 0) + 1);
      });
    
    return failures;
  }
  
  /**
   * Apply route trust scores to adjust routing weights
   * @param routeWeights Original route weights
   * @param tokenPair Token pair being traded
   * @returns Adjusted route weights
   */
  public adjustRouteWeights(
    routeWeights: Record<string, number>,
    tokenPair: string
  ): Record<string, number> {
    const adjustedWeights: Record<string, number> = {};
    let totalWeight = 0;
    
    // Apply trust scores as multipliers
    for (const [venue, weight] of Object.entries(routeWeights)) {
      const trustScore = this.getRouteTrust(venue, tokenPair);
      const adjustedWeight = weight * trustScore;
      adjustedWeights[venue] = adjustedWeight;
      totalWeight += adjustedWeight;
    }
    
    // Normalize weights to sum to 1
    if (totalWeight > 0) {
      for (const venue of Object.keys(adjustedWeights)) {
        adjustedWeights[venue] /= totalWeight;
      }
    }
    
    return adjustedWeights;
  }
  
  /**
   * Get performance metrics for analysis
   * @returns Performance metrics by venue and token pair
   */
  public getPerformanceMetrics(): any {
    const venueMetrics: Record<string, any> = {};
    const tokenPairMetrics: Record<string, any> = {};
    
    // Calculate venue metrics
    Object.entries(this.trustStore.routes).forEach(([hash, score]) => {
      const [venue, tokenPair] = hash.split('::');
      
      // Initialize venue metrics if needed
      if (!venueMetrics[venue]) {
        venueMetrics[venue] = {
          successCount: 0,
          failureCount: 0,
          avgSlippageBps: 0,
          avgLatencyMs: 0,
          trustScore: this.getVenueTrust(venue)
        };
      }
      
      // Initialize token pair metrics if needed
      if (!tokenPairMetrics[tokenPair]) {
        tokenPairMetrics[tokenPair] = {
          successCount: 0,
          failureCount: 0,
          avgSlippageBps: 0,
          bestVenue: '',
          bestVenueScore: 0
        };
      }
      
      // Update venue metrics
      venueMetrics[venue].successCount += score.successCount;
      venueMetrics[venue].failureCount += score.failureCount;
      venueMetrics[venue].avgSlippageBps = 
        (venueMetrics[venue].avgSlippageBps + score.avgSlippageBps) / 2;
      venueMetrics[venue].avgLatencyMs =
        (venueMetrics[venue].avgLatencyMs + score.avgLatencyMs) / 2;
      
      // Update token pair metrics
      tokenPairMetrics[tokenPair].successCount += score.successCount;
      tokenPairMetrics[tokenPair].failureCount += score.failureCount;
      tokenPairMetrics[tokenPair].avgSlippageBps =
        (tokenPairMetrics[tokenPair].avgSlippageBps + score.avgSlippageBps) / 2;
      
      // Track best venue for token pair
      if (score.score > tokenPairMetrics[tokenPair].bestVenueScore) {
        tokenPairMetrics[tokenPair].bestVenue = venue;
        tokenPairMetrics[tokenPair].bestVenueScore = score.score;
      }
    });
    
    return {
      venueMetrics,
      tokenPairMetrics
    };
  }
  
  /**
   * Force persist trust store
   */
  public persistNow(): void {
    this.persistTrustStore();
    this.isDirty = false;
  }
  
  /**
   * Clean up resources
   */
  public dispose(): void {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }
    
    // Force persist on dispose
    if (this.isDirty) {
      this.persistTrustStore();
    }
  }
  
  /**
   * Update route trust score based on execution result
   * @param routeHash Unique hash for the route
   * @param route Route identifier
   * @param result Execution result
   */
  private updateRouteTrustScore(
    routeHash: string,
    route: RouteIdentifier,
    result: ExecutedOrder
  ): void {
    // Get or create trust score record
    if (!this.trustStore.routes[routeHash]) {
      this.trustStore.routes[routeHash] = {
        score: this.config.defaultTrustScore,
        successCount: 0,
        failureCount: 0,
        avgSlippageBps: 0,
        avgLatencyMs: 0,
        lastUpdated: Date.now(),
        recentRevertCount: 0
      };
    }
    
    const record = this.trustStore.routes[routeHash];
    
    // Update basic stats
    record.lastUpdated = Date.now();
    
    // Apply success or failure adjustments
    if (result.status === 'filled') {
      record.successCount++;
      
      // Reward successful execution
      record.score = Math.min(
        this.config.maxTrustScore,
        record.score + this.config.successRewardAmount
      );
      
      record.lastResult = 'success';
      
      // Update average slippage and latency
      if (record.successCount > 1) {
        record.avgSlippageBps = (record.avgSlippageBps * (record.successCount - 1) + 
                                (result.slippageBps || 0)) / record.successCount;
        record.avgLatencyMs = (record.avgLatencyMs * (record.successCount - 1) + 
                              (result.latencyMs || 0)) / record.successCount;
      } else {
        record.avgSlippageBps = result.slippageBps || 0;
        record.avgLatencyMs = result.latencyMs || 0;
      }
      
      // Check for excessive slippage
      if (result.slippageBps > (result.intent.maxSlippageBps || 0) * 0.9) {
        // Penalize high slippage even on success
        record.score = Math.max(
          this.config.minTrustScore,
          record.score - this.config.slippageOverrunPenaltyAmount
        );
      }
    } else {
      record.failureCount++;
      
      // Penalize failed execution
      record.score = Math.max(
        this.config.minTrustScore,
        record.score - this.config.failurePenaltyAmount
      );
      
      record.lastResult = 'failure';
      
      // Track revert count for reverted transactions
      if (result.failureReason?.toLowerCase().includes('revert')) {
        record.recentRevertCount++;
        
        // Additional penalty for reverts
        record.score = Math.max(
          this.config.minTrustScore,
          record.score - this.config.revertPenaltyAmount
        );
      }
    }
    
    // Apply gas cost considerations if available
    if (result.metadata?.gasCostUsd && result.metadata?.expectedGasCostUsd) {
      const gasOverrun = result.metadata.gasCostUsd / result.metadata.expectedGasCostUsd;
      
      if (gasOverrun > 1.5) {
        // Penalize excessive gas usage
        record.score = Math.max(
          this.config.minTrustScore,
          record.score - this.config.gasOverrunPenaltyAmount
        );
      }
    }
    
    // Apply history decay to older events
    this.applyTrustScoreDecay(record);
    
    this.isDirty = true;
  }
  
  /**
   * Apply decay factor to trust scores to gradually forget old data
   * @param record Trust score record
   */
  private applyTrustScoreDecay(record: RouteTrustScore): void {
    // Calculate time since last decay
    const now = Date.now();
    const daysSinceLastUpdate = (now - record.lastUpdated) / (1000 * 60 * 60 * 24);
    
    // Apply decay factor based on time passed
    if (daysSinceLastUpdate > 0.5) { // More than 12 hours
      const decayFactor = this.config.historyDecayFactor * daysSinceLastUpdate;
      
      // Reset recent revert count periodically
      if (daysSinceLastUpdate > 1) { // More than a day
        record.recentRevertCount = Math.max(0, record.recentRevertCount - 1);
      }
      
      // Move score toward default value
      if (record.score > this.config.defaultTrustScore) {
        record.score = Math.max(
          this.config.defaultTrustScore,
          record.score - decayFactor
        );
      } else if (record.score < this.config.defaultTrustScore) {
        record.score = Math.min(
          this.config.defaultTrustScore,
          record.score + decayFactor
        );
      }
    }
  }
  
  /**
   * Update aggregated trust scores for venues and token pairs
   */
  private updateAggregatedScores(): void {
    const venueScores: Record<string, number[]> = {};
    const tokenPairScores: Record<string, number[]> = {};
    
    // Collect all scores by venue and token pair
    Object.entries(this.trustStore.routes).forEach(([hash, record]) => {
      const [venue, tokenPair] = hash.split('::');
      
      if (!venueScores[venue]) {
        venueScores[venue] = [];
      }
      
      if (!tokenPairScores[tokenPair]) {
        tokenPairScores[tokenPair] = [];
      }
      
      venueScores[venue].push(record.score);
      tokenPairScores[tokenPair].push(record.score);
    });
    
    // Calculate average scores
    Object.entries(venueScores).forEach(([venue, scores]) => {
      this.trustStore.venues[venue] = scores.reduce((a, b) => a + b, 0) / scores.length;
    });
    
    Object.entries(tokenPairScores).forEach(([tokenPair, scores]) => {
      this.trustStore.tokenPairs[tokenPair] = scores.reduce((a, b) => a + b, 0) / scores.length;
    });
    
    this.trustStore.lastUpdated = Date.now();
    this.isDirty = true;
  }
  
  /**
   * Extract route identifier from execution result
   * @param result Execution result
   * @returns Route identifier
   */
  private getRouteIdentifier(result: ExecutedOrder): RouteIdentifier {
    const route: RouteIdentifier = {
      venue: result.venue,
      tokenPair: result.intent.asset
    };
    
    // Extract pool identifier from metadata if available
    if (result.metadata?.route?.pool) {
      route.poolIdentifier = result.metadata.route.pool;
    } else if (result.metadata?.route?.path) {
      route.poolIdentifier = result.metadata.route.path.join('_');
    }
    
    return route;
  }
  
  /**
   * Generate unique hash for a route
   * @param route Route identifier
   * @returns Unique hash
   */
  private hashRoute(route: RouteIdentifier): string {
    return `${route.venue}::${route.tokenPair}${route.poolIdentifier ? `::${route.poolIdentifier}` : ''}`;
  }
  
  /**
   * Load trust store from disk
   * @returns Loaded trust store or new empty store
   */
  private loadTrustStore(): RouteTrustStore {
    try {
      if (fs.existsSync(this.config.trustScoreStorePath)) {
        const data = fs.readFileSync(this.config.trustScoreStorePath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      logger.error(`Error loading trust store: ${error}`);
    }
    
    // Return empty trust store if loading fails
    return {
      routes: {},
      venues: {},
      tokenPairs: {},
      lastUpdated: Date.now(),
      version: '1.0'
    };
  }
  
  /**
   * Persist trust store to disk
   */
  private persistTrustStore(): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.config.trustScoreStorePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Write trust store to file
      fs.writeFileSync(
        this.config.trustScoreStorePath,
        JSON.stringify(this.trustStore, null, 2),
        'utf8'
      );
      
      logger.debug(`Trust store persisted with ${Object.keys(this.trustStore.routes).length} routes`);
    } catch (error) {
      logger.error(`Error persisting trust store: ${error}`);
    }
  }
  
  /**
   * Append execution result to log file
   * @param result Execution result
   */
  private appendToExecutionLog(result: ExecutionResult): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.config.executionLogPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Append to log file as JSONL
      fs.appendFileSync(
        this.config.executionLogPath,
        JSON.stringify(result) + '\n',
        'utf8'
      );
    } catch (error) {
      logger.error(`Error appending to execution log: ${error}`);
    }
  }
}

/**
 * Singleton instance of ExecutionMemory
 */
let executionMemoryInstance: ExecutionMemory | null = null;

/**
 * Get or create singleton instance of ExecutionMemory
 * @param config Optional configuration
 * @returns ExecutionMemory instance
 */
export function getExecutionMemory(
  config?: Partial<ExecutionMemoryConfig>
): ExecutionMemory {
  if (!executionMemoryInstance) {
    executionMemoryInstance = new ExecutionMemory(config);
  }
  
  return executionMemoryInstance;
} 