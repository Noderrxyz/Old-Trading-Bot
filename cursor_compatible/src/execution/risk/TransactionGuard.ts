/**
 * Transaction Risk Mitigation Layer
 * 
 * The TransactionGuard is responsible for:
 * 1. Pre-transaction validation through simulation
 * 2. Tracking and analyzing reversion patterns
 * 3. Providing protective wrappers for high-risk transactions
 * 4. Implementing rate limiting for failed transactions
 * 5. Logging and emitting telemetry for transaction risk
 */

import { v4 as uuidv4 } from 'uuid';
import { SmartOrderRouter } from '../../infra/router/SmartOrderRouter.js';
import { TrustEngine } from '../../infra/risk/TrustEngine.js';
import { OrderIntent, ExecutedOrder } from '../../types/execution.types.js';
import { createLogger } from '../../common/logger.js';

const logger = createLogger('TransactionGuard');

/**
 * Transaction risk report 
 */
export interface TransactionRiskReport {
  // Unique identifier for this risk assessment
  id: string;
  
  // Asset pair being traded
  asset: string;
  
  // DEX or venue ID
  venueId: string;
  
  // Overall risk score (0.0-1.0)
  riskScore: number;
  
  // Whether simulation was successful
  simulatedSuccess: boolean;
  
  // Estimated slippage in basis points
  slippageEstimate: number;
  
  // Estimated gas cost in wei
  gasEstimate: number;
  
  // Gas price used for the transaction in gwei
  gasPrice: number;
  
  // Current block number
  blockNumber: number;
  
  // Action taken by the guard
  guardAction: 'allowed' | 'wrapped' | 'blocked' | 'delayed';
  
  // Reason for the action
  reason?: string;
  
  // Pool volatility indicator (0.0-1.0)
  poolVolatility: number;
  
  // Timestamp of the report
  timestamp: number;
}

/**
 * Transaction reversion record
 */
interface ReversionRecord {
  // DEX or venue ID
  venueId: string;
  
  // Asset pair
  asset: string;
  
  // Gas strategy used
  gasStrategy: string;
  
  // Block number when reversion occurred
  blockNumber: number;
  
  // Timestamp of reversion
  timestamp: number;
  
  // Error message or reason
  errorMessage: string;
  
  // Gas price used in gwei
  gasPrice: number;
}

/**
 * Rate-limiting record for asset pairs
 */
interface RateLimitRecord {
  // Asset pair
  asset: string;
  
  // Failure count
  failureCount: number;
  
  // Last failure timestamp
  lastFailureTimestamp: number;
  
  // Current cooldown period in ms
  currentCooldownMs: number;
}

/**
 * Configuration for the TransactionGuard
 */
export interface TransactionGuardConfig {
  // Whether to enable transaction simulation
  enableSimulation: boolean;
  
  // Whether to enable reversion pattern analysis
  enableReversionAnalysis: boolean;
  
  // Whether to enable protective wrappers
  enableProtectiveWrappers: boolean;
  
  // Whether to enable rate limiting
  enableRateLimiting: boolean;
  
  // High risk threshold that triggers protective measures
  highRiskThreshold: number;
  
  // Maximum acceptable slippage in basis points
  maxAcceptableSlippageBps: number;
  
  // Volatility threshold above which transactions are considered risky
  volatilityThreshold: number;
  
  // Base cooldown period for rate limiting in ms
  baseCooldownMs: number;
  
  // Maximum cooldown period for rate limiting in ms
  maxCooldownMs: number;
  
  // Maximum historical reversion records to keep
  maxReversionHistory: number;
  
  // Whether to emit events for monitoring
  emitEvents: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: TransactionGuardConfig = {
  enableSimulation: true,
  enableReversionAnalysis: true,
  enableProtectiveWrappers: true,
  enableRateLimiting: true,
  highRiskThreshold: 0.6,
  maxAcceptableSlippageBps: 200, // 2%
  volatilityThreshold: 0.5,
  baseCooldownMs: 120000, // 2 minutes
  maxCooldownMs: 600000, // 10 minutes
  maxReversionHistory: 1000,
  emitEvents: true
};

/**
 * Transaction Guard for mitigating trading risks
 */
export class TransactionGuard {
  // Store historical reversion records
  private reversionHistory: ReversionRecord[] = [];
  
  // Rate limiting records by asset pair
  private rateLimits: Map<string, RateLimitRecord> = new Map();
  
  // Risk score cache
  private riskScoreCache: Map<string, {score: number, timestamp: number}> = new Map();
  
  // Risk score cache TTL (5 minutes)
  private riskScoreCacheTtlMs: number = 5 * 60 * 1000;
  
  // Event handlers
  private eventHandlers: Map<string, Function[]> = new Map();
  
  /**
   * Create a new TransactionGuard
   */
  constructor(
    private readonly router: SmartOrderRouter,
    private readonly trustEngine: TrustEngine,
    private readonly config: TransactionGuardConfig = DEFAULT_CONFIG
  ) {
    logger.info('Transaction Guard initialized');
  }
  
  /**
   * Validate a transaction before execution
   * @param order The order intent to validate
   * @param venue The execution venue
   * @returns Transaction risk report
   */
  public async validateTransaction(
    order: OrderIntent,
    venueId: string
  ): Promise<TransactionRiskReport> {
    const riskReport = await this.assessRisk(order, venueId);
    
    // Check if transaction should be blocked
    if (this.shouldBlockTransaction(riskReport)) {
      riskReport.guardAction = 'blocked';
      riskReport.reason = 'High risk transaction blocked';
      
      logger.warn(`Blocked high risk transaction for ${order.asset} on ${venueId}: risk=${riskReport.riskScore}`);
      this.emitEvent('transaction:blocked', riskReport);
      
      return riskReport;
    }
    
    // Check if transaction should be wrapped in protective measures
    if (this.shouldWrapTransaction(riskReport)) {
      riskReport.guardAction = 'wrapped';
      riskReport.reason = 'High risk transaction wrapped with protective measures';
      
      logger.info(`Applied protective wrapper for ${order.asset} on ${venueId}: risk=${riskReport.riskScore}`);
      this.emitEvent('transaction:wrapped', riskReport);
      
      return riskReport;
    }
    
    // Check if transaction should be delayed due to rate limiting
    if (this.shouldDelayTransaction(order.asset)) {
      riskReport.guardAction = 'delayed';
      
      const rateLimit = this.rateLimits.get(order.asset);
      const cooldownRemaining = rateLimit ? 
        (rateLimit.lastFailureTimestamp + rateLimit.currentCooldownMs) - Date.now() : 0;
      
      riskReport.reason = `Rate limited: cooldown for ${Math.ceil(cooldownRemaining / 1000)}s`;
      
      logger.info(`Delayed transaction for ${order.asset} due to rate limiting: ${riskReport.reason}`);
      this.emitEvent('transaction:delayed', riskReport);
      
      return riskReport;
    }
    
    // Transaction is allowed to proceed
    riskReport.guardAction = 'allowed';
    this.emitEvent('transaction:allowed', riskReport);
    
    return riskReport;
  }
  
  /**
   * Assess the risk of a transaction
   * @param order Order intent
   * @param venueId Venue identifier
   * @returns Risk report
   */
  public async assessRisk(
    order: OrderIntent,
    venueId: string
  ): Promise<TransactionRiskReport> {
    // Check cache first
    const cacheKey = `${order.asset}:${venueId}:${order.side}:${order.quantity}`;
    const cachedRisk = this.riskScoreCache.get(cacheKey);
    
    if (cachedRisk && (Date.now() - cachedRisk.timestamp < this.riskScoreCacheTtlMs)) {
      logger.debug(`Using cached risk score for ${order.asset} on ${venueId}: ${cachedRisk.score}`);
      
      // Create basic report from cached risk score
      return {
        id: uuidv4(),
        asset: order.asset,
        venueId,
        riskScore: cachedRisk.score,
        simulatedSuccess: true, // Assume success since we're using cached data
        slippageEstimate: 0, // Will be filled in by simulation
        gasEstimate: 0, // Will be filled in by simulation
        gasPrice: 0, // Will be filled in by simulation
        blockNumber: 0, // Will be filled in by simulation
        guardAction: 'allowed', // Default
        poolVolatility: 0, // Will be calculated
        timestamp: Date.now()
      };
    }
    
    // Create a new risk report
    const report: TransactionRiskReport = {
      id: uuidv4(),
      asset: order.asset,
      venueId,
      riskScore: 0, // Will be calculated
      simulatedSuccess: false, // Will be determined by simulation
      slippageEstimate: 0, // Will be calculated
      gasEstimate: 0, // Will be determined by simulation
      gasPrice: 0, // Will be determined by simulation
      blockNumber: await this.getCurrentBlockNumber(),
      guardAction: 'allowed', // Default action
      poolVolatility: await this.calculatePoolVolatility(order.asset),
      timestamp: Date.now()
    };
    
    // Perform pre-transaction simulation if enabled
    if (this.config.enableSimulation) {
      const simulationResult = await this.simulateTransaction(order, venueId);
      report.simulatedSuccess = simulationResult.success;
      report.slippageEstimate = simulationResult.slippageBps;
      report.gasEstimate = simulationResult.gasEstimate;
      report.gasPrice = simulationResult.gasPrice;
      
      if (!simulationResult.success) {
        report.riskScore = 1.0; // Maximum risk for failed simulation
        report.reason = simulationResult.errorMessage;
        
        // Update the reversion history
        this.recordReversion({
          venueId,
          asset: order.asset,
          gasStrategy: order.urgency || 'medium',
          blockNumber: report.blockNumber,
          timestamp: Date.now(),
          errorMessage: simulationResult.errorMessage || 'Simulation failed',
          gasPrice: report.gasPrice
        });
        
        return report;
      }
    }
    
    // Calculate risk score based on multiple factors
    report.riskScore = await this.calculateRiskScore(order, venueId, report);
    
    // Cache the risk score
    this.riskScoreCache.set(cacheKey, {
      score: report.riskScore,
      timestamp: Date.now()
    });
    
    return report;
  }
  
  /**
   * Handle a failed transaction
   * @param order The order that failed
   * @param venueId The venue where it failed
   * @param error Error message or object
   */
  public handleFailedTransaction(
    order: OrderIntent,
    venueId: string,
    error: any
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`Transaction failed for ${order.asset} on ${venueId}: ${errorMessage}`);
    
    // Record the reversion
    this.recordReversion({
      venueId,
      asset: order.asset,
      gasStrategy: order.urgency || 'medium',
      blockNumber: 0, // Will be updated if possible
      timestamp: Date.now(),
      errorMessage,
      gasPrice: 0 // Will be updated if possible
    });
    
    // Update rate limiting
    this.updateRateLimit(order.asset);
    
    // Penalize the venue in the trust engine
    this.trustEngine.penalizeVenue(venueId, `Transaction failed: ${errorMessage}`, 0.2);
    
    // Emit event
    this.emitEvent('transaction:failed', {
      asset: order.asset,
      venueId,
      error: errorMessage,
      timestamp: Date.now()
    });
  }
  
  /**
   * Handle a successful transaction
   * @param order The executed order
   */
  public handleSuccessfulTransaction(
    executedOrder: ExecutedOrder
  ): void {
    logger.info(`Transaction successful for ${executedOrder.intent.asset} on ${executedOrder.venue}`);
    
    // Reset rate limiting for this asset
    this.resetRateLimit(executedOrder.intent.asset);
    
    // Reward the venue in the trust engine
    this.trustEngine.rewardVenue(
      executedOrder.venue, 
      'Successful execution',
      Math.max(0, 1 - (executedOrder.slippageBps / 200)) // Higher reward for lower slippage
    );
    
    // Emit event
    this.emitEvent('transaction:success', {
      asset: executedOrder.intent.asset,
      venueId: executedOrder.venue,
      slippageBps: executedOrder.slippageBps,
      timestamp: Date.now()
    });
  }
  
  /**
   * Get risk metrics for analytics
   */
  public getRiskMetrics(): any {
    return {
      reversionCount: this.reversionHistory.length,
      reversionsByVenue: this.getReversionsByVenue(),
      rateLimitedAssets: Array.from(this.rateLimits.entries())
        .filter(([_, record]) => record.failureCount > 0)
        .map(([asset, record]) => ({
          asset,
          failureCount: record.failureCount,
          cooldownRemaining: Math.max(0, 
            (record.lastFailureTimestamp + record.currentCooldownMs) - Date.now()
          )
        }))
    };
  }
  
  /**
   * Add an event listener
   * @param event Event name
   * @param handler Event handler function
   */
  public on(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    
    this.eventHandlers.get(event)?.push(handler);
  }
  
  /**
   * Remove an event listener
   * @param event Event name
   * @param handler Event handler function
   */
  public off(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      return;
    }
    
    const handlers = this.eventHandlers.get(event) || [];
    const index = handlers.indexOf(handler);
    
    if (index !== -1) {
      handlers.splice(index, 1);
    }
  }
  
  /**
   * Simulate a transaction before execution
   * @param order Order intent
   * @param venueId Venue identifier
   * @returns Simulation result
   */
  private async simulateTransaction(
    order: OrderIntent,
    venueId: string
  ): Promise<{
    success: boolean;
    slippageBps: number;
    gasEstimate: number;
    gasPrice: number;
    errorMessage?: string;
  }> {
    try {
      // Here we would perform an actual blockchain transaction simulation
      // For now, we'll simulate the simulation with a mock implementation
      
      // Mock random success with 90% success rate
      const success = Math.random() > 0.1;
      
      if (!success) {
        return {
          success: false,
          slippageBps: 0,
          gasEstimate: 0,
          gasPrice: 0,
          errorMessage: 'Transaction simulation failed. Likely reasons: insufficient funds, high slippage, or reverted execution.'
        };
      }
      
      // Mock gas estimate based on asset and venue
      const gasEstimate = 150000 + Math.floor(Math.random() * 100000);
      
      // Mock gas price based on urgency
      let gasPrice;
      switch (order.urgency) {
        case 'high':
          gasPrice = 50 + Math.floor(Math.random() * 20);
          break;
        case 'low':
          gasPrice = 20 + Math.floor(Math.random() * 10);
          break;
        case 'medium':
        default:
          gasPrice = 30 + Math.floor(Math.random() * 15);
          break;
      }
      
      // Mock slippage calculation
      const slippageBps = Math.floor(Math.random() * 150); // 0-1.5%
      
      return {
        success: true,
        slippageBps,
        gasEstimate,
        gasPrice
      };
    } catch (error) {
      logger.error(`Error during transaction simulation: ${error}`);
      return {
        success: false,
        slippageBps: 0,
        gasEstimate: 0,
        gasPrice: 0,
        errorMessage: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Calculate risk score based on multiple factors
   * @param order Order intent
   * @param venueId Venue identifier
   * @param report The current risk report
   * @returns Risk score between 0 and 1
   */
  private async calculateRiskScore(
    order: OrderIntent,
    venueId: string,
    report: TransactionRiskReport
  ): Promise<number> {
    // Start with baseline score
    let score = 0.3;
    
    // Factor 1: Venue trust score (lower trust = higher risk)
    const trustScore = await this.trustEngine.getVenueTrust(venueId);
    score += (1 - trustScore) * 0.2;
    
    // Factor 2: Slippage risk
    const slippageFactor = Math.min(1, report.slippageEstimate / this.config.maxAcceptableSlippageBps);
    score += slippageFactor * 0.2;
    
    // Factor 3: Pool volatility
    score += report.poolVolatility * 0.2;
    
    // Factor 4: Historical reversion patterns
    if (this.config.enableReversionAnalysis) {
      const reversionRisk = this.calculateReversionRisk(order, venueId);
      score += reversionRisk * 0.2;
    }
    
    // Factor 5: Current network congestion (mocked)
    const networkCongestion = Math.random() * 0.2;
    score += networkCongestion;
    
    // Ensure score is between 0 and 1
    return Math.min(1, Math.max(0, score));
  }
  
  /**
   * Calculate reversion risk based on historical patterns
   * @param order Order intent
   * @param venueId Venue identifier
   * @returns Risk score between 0 and 1
   */
  private calculateReversionRisk(
    order: OrderIntent,
    venueId: string
  ): number {
    // Get recent reversions for this asset/venue combination
    const recentReversions = this.reversionHistory.filter(record => 
      record.asset === order.asset &&
      record.venueId === venueId &&
      (Date.now() - record.timestamp < 24 * 60 * 60 * 1000) // Last 24 hours
    );
    
    if (recentReversions.length === 0) {
      return 0; // No recent reversions
    }
    
    // Calculate risk based on frequency
    const recentReversionCount = recentReversions.length;
    const frequencyRisk = Math.min(1, recentReversionCount / 10);
    
    return frequencyRisk;
  }
  
  /**
   * Record a transaction reversion
   * @param record Reversion record
   */
  private recordReversion(record: ReversionRecord): void {
    // Add to history
    this.reversionHistory.unshift(record);
    
    // Trim history if needed
    if (this.reversionHistory.length > this.config.maxReversionHistory) {
      this.reversionHistory = this.reversionHistory.slice(0, this.config.maxReversionHistory);
    }
    
    // Emit event
    this.emitEvent('reversion:recorded', record);
    
    // Log the reversion
    logger.warn(`Reversion recorded for ${record.asset} on ${record.venueId}: ${record.errorMessage}`);
  }
  
  /**
   * Update rate limiting for an asset
   * @param asset Asset identifier
   */
  private updateRateLimit(asset: string): void {
    if (!this.config.enableRateLimiting) {
      return;
    }
    
    let rateLimit = this.rateLimits.get(asset);
    
    if (!rateLimit) {
      rateLimit = {
        asset,
        failureCount: 0,
        lastFailureTimestamp: 0,
        currentCooldownMs: this.config.baseCooldownMs
      };
    }
    
    // Increment failure count
    rateLimit.failureCount += 1;
    
    // Update timestamp
    rateLimit.lastFailureTimestamp = Date.now();
    
    // Increase cooldown exponentially up to max
    rateLimit.currentCooldownMs = Math.min(
      this.config.maxCooldownMs,
      this.config.baseCooldownMs * Math.pow(2, rateLimit.failureCount - 1)
    );
    
    // Save rate limit
    this.rateLimits.set(asset, rateLimit);
    
    logger.info(`Rate limit updated for ${asset}: count=${rateLimit.failureCount}, cooldown=${rateLimit.currentCooldownMs}ms`);
  }
  
  /**
   * Reset rate limiting for an asset
   * @param asset Asset identifier
   */
  private resetRateLimit(asset: string): void {
    const rateLimit = this.rateLimits.get(asset);
    
    if (rateLimit && rateLimit.failureCount > 0) {
      // Reduce failure count but don't reset completely
      // This allows for a gradual return to normal
      rateLimit.failureCount = Math.max(0, rateLimit.failureCount - 1);
      
      // Reset cooldown if failure count is 0
      if (rateLimit.failureCount === 0) {
        rateLimit.currentCooldownMs = this.config.baseCooldownMs;
      }
      
      // Save rate limit
      this.rateLimits.set(asset, rateLimit);
      
      logger.info(`Rate limit reduced for ${asset}: count=${rateLimit.failureCount}, cooldown=${rateLimit.currentCooldownMs}ms`);
    }
  }
  
  /**
   * Check if a transaction should be delayed due to rate limiting
   * @param asset Asset identifier
   * @returns True if the transaction should be delayed
   */
  private shouldDelayTransaction(asset: string): boolean {
    if (!this.config.enableRateLimiting) {
      return false;
    }
    
    const rateLimit = this.rateLimits.get(asset);
    
    if (!rateLimit || rateLimit.failureCount === 0) {
      return false;
    }
    
    // Check if we're still in the cooldown period
    const cooldownExpiry = rateLimit.lastFailureTimestamp + rateLimit.currentCooldownMs;
    return Date.now() < cooldownExpiry;
  }
  
  /**
   * Check if a transaction should be blocked
   * @param report Risk report
   * @returns True if the transaction should be blocked
   */
  private shouldBlockTransaction(report: TransactionRiskReport): boolean {
    // Always block failed simulations
    if (!report.simulatedSuccess) {
      return true;
    }
    
    // Block if slippage exceeds maximum
    if (report.slippageEstimate > this.config.maxAcceptableSlippageBps) {
      return true;
    }
    
    // Block if pool volatility is extremely high
    if (report.poolVolatility > 0.8) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Check if a transaction should be wrapped with protective measures
   * @param report Risk report
   * @returns True if the transaction should be wrapped
   */
  private shouldWrapTransaction(report: TransactionRiskReport): boolean {
    // Only wrap if protective wrappers are enabled
    if (!this.config.enableProtectiveWrappers) {
      return false;
    }
    
    // Wrap if risk score exceeds threshold
    return report.riskScore > this.config.highRiskThreshold;
  }
  
  /**
   * Calculate pool volatility for an asset
   * @param asset Asset pair
   * @returns Volatility score between 0 and 1
   */
  private async calculatePoolVolatility(asset: string): Promise<number> {
    // In a real implementation, we would analyze recent price movements
    // For simplicity, we'll use a random value
    return Math.random() * 0.5;
  }
  
  /**
   * Get the current blockchain block number
   * @returns Current block number
   */
  private async getCurrentBlockNumber(): Promise<number> {
    // In a real implementation, we would query the blockchain
    // For simplicity, we'll return a mock value
    return 1000000 + Math.floor(Math.random() * 1000);
  }
  
  /**
   * Get reversions grouped by venue
   * @returns Map of venue IDs to reversion counts
   */
  private getReversionsByVenue(): Map<string, number> {
    const result = new Map<string, number>();
    
    for (const record of this.reversionHistory) {
      const count = result.get(record.venueId) || 0;
      result.set(record.venueId, count + 1);
    }
    
    return result;
  }
  
  /**
   * Emit an event
   * @param event Event name
   * @param data Event data
   */
  private emitEvent(event: string, data: any): void {
    if (!this.config.emitEvents) {
      return;
    }
    
    const handlers = this.eventHandlers.get(event) || [];
    
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (error) {
        logger.error(`Error in event handler for ${event}: ${error}`);
      }
    }
  }
}

/**
 * Get a singleton instance of the transaction guard
 */
let transactionGuardInstance: TransactionGuard | null = null;

export function getTransactionGuard(
  router?: SmartOrderRouter,
  trustEngine?: TrustEngine,
  config?: TransactionGuardConfig
): TransactionGuard {
  if (!transactionGuardInstance) {
    if (!router || !trustEngine) {
      throw new Error('SmartOrderRouter and TrustEngine are required to create the TransactionGuard');
    }
    
    transactionGuardInstance = new TransactionGuard(router, trustEngine, config);
  }
  
  return transactionGuardInstance;
} 