/**
 * Execution Router
 * 
 * Routes execution decisions to the appropriate venue based on microstructure metrics,
 * trust scores, and strategy intent from the fusion layer.
 */

import { MicrostructureAnalyzer, MicrostructureMetrics } from '../marketdata/MicrostructureAnalyzer.js';
import { TrustEngine } from '../risk/TrustEngine.js';
import { ExecutionVenue } from '../venues/VenueRegistry.js';
import { OrderIntent, ExecutionStyle, RoutingResult, ExecutedOrder, ExecutionTelemetry } from '../../types/execution.types.js';
import { FusionMemory } from '../../fusion/FusionMemory.js';
import { FusionState } from '../../types/fusion.types.js';
import { TemporalRiskModel } from '../../models/TemporalRiskModel.js';
import { ExecutionTelemetryService } from '../../services/execution/ExecutionTelemetryService.js';
import { getFillIQByVenue, getVenuesByPerformance } from '../../models/ExecutionQualityModel.js';

/**
 * Configuration for the execution router
 */
export interface ExecutionRouterConfig {
  // Minimum trust score to consider a venue
  minTrustScore: number;
  
  // Whether to automatically retry failed executions
  autoRetryFailures: boolean;
  
  // Maximum number of retry attempts
  maxRetryAttempts: number;
  
  // Delay between retries in milliseconds
  retryDelayMs: number;
  
  // Whether to adapt to time-of-day patterns
  adaptToTimeOfDay: boolean;
  
  // Whether to adapt routing based on Fill IQ
  adaptToFillIQ: boolean;
  
  // Minimum Fill IQ score to consider a venue
  minFillIQ: number;
  
  // Fill IQ weight in venue selection (0-1)
  fillIQWeight: number;
  
  // Minimum number of fills to consider Fill IQ data reliable
  minFillsForIQAdaptation: number;
  
  // Microstructure thresholds for venue selection
  thresholds: {
    // Spoofing score above which to consider delaying execution
    spoofingThreshold: number;
    
    // Sweep risk above which to switch to TWAP execution
    sweepRiskThreshold: number;
    
    // Spread pressure above which to avoid market orders
    spreadPressureThreshold: number;
    
    // Quote volatility threshold for trust penalty
    quoteVolatilityThreshold: number;
  };
}

/**
 * Default configuration
 */
const DEFAULT_ROUTER_CONFIG: ExecutionRouterConfig = {
  minTrustScore: 0.5,
  autoRetryFailures: true,
  maxRetryAttempts: 3,
  retryDelayMs: 1000,
  adaptToTimeOfDay: true,
  adaptToFillIQ: true,
  minFillIQ: 50, // Minimum 50/100 Fill IQ score
  fillIQWeight: 0.3, // 30% weight to Fill IQ in venue scoring
  minFillsForIQAdaptation: 5, // Need at least 5 fills for reliable Fill IQ
  thresholds: {
    spoofingThreshold: 0.6,
    sweepRiskThreshold: 0.8,
    spreadPressureThreshold: 0.01,
    quoteVolatilityThreshold: 0.2
  }
};

/**
 * Routes orders to the appropriate venue based on microstructure metrics and trust
 */
export class ExecutionRouter {
  // Cache for venue rankings by Fill IQ
  private venueRankingsCache: Record<string, {
    rankings: Array<{ venue: string; fillIQ: number; fillCount: number }>;
    lastUpdated: number;
  }> = {};
  
  // Cache expiry time (5 minutes)
  private readonly cacheExpiryMs: number = 5 * 60 * 1000;
  
  /**
   * Create a new execution router
   * @param venues Available execution venues
   * @param microAnalyzer Microstructure analyzer
   * @param trustEngine Trust engine for venue scoring
   * @param fusionMemory Fusion memory for strategy-execution coherence
   * @param temporalRiskModel Optional model for time-of-day adjustments
   * @param telemetryService Optional service for execution telemetry
   * @param config Router configuration
   */
  constructor(
    private readonly venues: ExecutionVenue[],
    private readonly microAnalyzer: MicrostructureAnalyzer,
    private readonly trustEngine: TrustEngine,
    private readonly fusionMemory: FusionMemory,
    private readonly temporalRiskModel?: TemporalRiskModel,
    private readonly telemetryService?: ExecutionTelemetryService,
    private readonly config: ExecutionRouterConfig = DEFAULT_ROUTER_CONFIG
  ) {}
  
  /**
   * Route an order to the best venue based on current market conditions
   * @param order Order intent to route
   * @returns Result with selected venue or null if no suitable venue
   */
  async route(order: OrderIntent): Promise<RoutingResult> {
    let bestVenue: ExecutionVenue | null = null;
    let bestScore = -Infinity;
    let bestMetrics: MicrostructureMetrics | null = null;
    let bestTrust = 0;
    let recommendedStyle: ExecutionStyle = ExecutionStyle.Adaptive;
    let shouldDelay = false;
    let delayReason = '';
    
    // Get strategy intent from fusion memory
    const fusionState = this.fusionMemory.get(order.asset);
    const strategyIntent = fusionState?.strategyIntent;
    
    // Get time-of-day profile if enabled
    let timeOfDayProfile = null;
    if (this.config.adaptToTimeOfDay && this.temporalRiskModel) {
      try {
        timeOfDayProfile = await this.temporalRiskModel.getCurrentHourProfile(order.asset);
      } catch (error) {
        console.error(`Error getting time-of-day profile for ${order.asset}:`, error);
      }
    }
    
    // Get Fill IQ data if enabled and telemetry service is available
    let fillIQByVenue: Record<string, number> = {};
    let venueRankings: Array<{ venue: string; fillIQ: number; fillCount: number }> = [];
    
    if (this.config.adaptToFillIQ && this.telemetryService) {
      try {
        // Get Fill IQ data for the asset
        const telemetryData = await this.getVenueRankings(order.asset);
        venueRankings = telemetryData.rankings;
        
        // Convert to map for easier lookup
        fillIQByVenue = Object.fromEntries(
          venueRankings.map(({ venue, fillIQ }) => [venue, fillIQ])
        );
        
        console.log(`Retrieved Fill IQ data for ${order.asset}: ${venueRankings.length} venues`);
      } catch (error) {
        console.error(`Error getting Fill IQ data for ${order.asset}:`, error);
      }
    }
    
    // Filter enabled venues that support this asset
    const eligibleVenues: ExecutionVenue[] = [];
    for (const venue of this.venues) {
      if (!venue.enabled) continue;
      
      try {
        const supported = await venue.isAssetSupported(order.asset);
        if (supported) {
          eligibleVenues.push(venue);
        }
      } catch (error) {
        console.error(`Error checking asset support for ${venue.id}:`, error);
      }
    }
    
    // Calculate scores for each venue
    for (const venue of eligibleVenues) {
      // Get microstructure metrics
      const metrics = await this.microAnalyzer.analyze(venue.id);
      
      // Get venue trust score
      const trustScore = await this.trustEngine.getVenueTrust(venue.id);
      
      // Skip venues below minimum trust threshold
      if (trustScore < this.config.minTrustScore) {
        continue;
      }
      
      // Get Fill IQ score if available
      const fillIQ = fillIQByVenue[venue.id] || 0;
      const hasSufficientFillData = venueRankings.some(v => 
        v.venue === venue.id && v.fillCount >= this.config.minFillsForIQAdaptation
      );
      
      // Skip venues with insufficient Fill IQ if we have data for other venues
      if (this.config.adaptToFillIQ && 
          hasSufficientFillData && 
          fillIQ < this.config.minFillIQ && 
          venueRankings.length > 1) {
        console.log(`Skipping venue ${venue.id} due to low Fill IQ: ${fillIQ}`);
        continue;
      }
      
      if (!metrics) {
        // No microstructure data, use trust score and Fill IQ only
        let score = trustScore * 0.7; // Apply penalty for missing metrics
        
        // Add Fill IQ component if available
        if (hasSufficientFillData && this.config.adaptToFillIQ) {
          score += (fillIQ / 100) * this.config.fillIQWeight;
        }
        
        if (score > bestScore) {
          bestVenue = venue;
          bestScore = score;
          bestTrust = trustScore;
        }
        continue;
      }
      
      // Calculate execution score based on metrics, trust, intent, time of day, and Fill IQ
      const executionScore = this.calculateScore(
        order, 
        metrics, 
        trustScore, 
        strategyIntent, 
        timeOfDayProfile,
        hasSufficientFillData ? fillIQ : undefined
      );
      
      if (executionScore > bestScore) {
        bestVenue = venue;
        bestScore = executionScore;
        bestMetrics = metrics;
        bestTrust = trustScore;
      }
    }
    
    // Determine if execution should be delayed
    if (bestMetrics) {
      if (bestMetrics.spoofingScore > this.config.thresholds.spoofingThreshold) {
        // High spoofing risk
        if (!strategyIntent || strategyIntent.urgency !== 'high') {
          shouldDelay = true;
          delayReason = 'High spoofing activity detected';
        }
      }
      
      // Determine recommended execution style based on metrics and time of day
      recommendedStyle = this.determineExecutionStyle(
        order, 
        bestMetrics, 
        strategyIntent, 
        timeOfDayProfile
      );
    }
    
    // Return routing result with time-of-day profile info and Fill IQ data
    return {
      venue: bestVenue ? bestVenue.id : null,
      score: bestScore,
      recommendedStyle,
      estimatedSlippageBps: this.estimateSlippage(order, bestMetrics, timeOfDayProfile),
      shouldDelay,
      delayReason,
      metricsSnapshot: bestMetrics,
      trustScore: bestTrust,
      metadata: {
        ...(timeOfDayProfile ? {
          timeOfDayAdjusted: true,
          hour: timeOfDayProfile.hour,
          alphaDecayRate: timeOfDayProfile.alphaDecayRate
        } : {}),
        ...(bestVenue && fillIQByVenue[bestVenue.id] ? {
          fillIQAdjusted: true,
          fillIQ: fillIQByVenue[bestVenue.id],
          venueRanking: venueRankings.findIndex(v => v.venue === bestVenue?.id) + 1
        } : {})
      }
    };
  }
  
  /**
   * Execute an order through a specific venue with adaptive execution
   * @param order Order to execute
   * @param venueId Venue ID to use (if null, best venue will be selected)
   * @returns Executed order details
   */
  async execute(order: OrderIntent, venueId?: string): Promise<ExecutedOrder> {
    // Route to best venue if none specified
    const routingResult = await this.route(order);
    
    // Use specified venue or best venue from routing
    const targetVenueId = venueId || routingResult.venue;
    
    if (!targetVenueId) {
      throw new Error('No suitable venue found for execution');
    }
    
    // Find the venue
    const venue = this.venues.find(v => v.id === targetVenueId);
    
    if (!venue) {
      throw new Error(`Venue with ID ${targetVenueId} not found`);
    }
    
    // Check if execution should be delayed
    if (routingResult.shouldDelay) {
      console.log(`Delaying execution: ${routingResult.delayReason}`);
      // In a real implementation, this would use a queue system
      // For now, we'll simply wait a bit
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    try {
      // Execute the order with the recommended style
      const executedOrder = await venue.execute(order, routingResult.recommendedStyle);
      
      // Record execution feedback in fusion memory
      this.recordExecutionFeedback(order.asset, executedOrder, targetVenueId);
      
      // Reward venue for successful execution
      if (executedOrder.status === 'filled') {
        await this.trustEngine.rewardVenue(
          targetVenueId,
          'successful_execution',
          this.calculateExecutionSuccessMagnitude(executedOrder)
        );
      }
      
      return executedOrder;
    } catch (error) {
      // Penalize venue for execution error
      await this.trustEngine.penalizeVenue(
        targetVenueId,
        'execution_error',
        0.7
      );
      
      // Attempt retry if enabled
      if (this.config.autoRetryFailures) {
        return this.retryExecution(order, targetVenueId, 0);
      }
      
      // If no retry, rethrow the error
      throw error;
    }
  }
  
  /**
   * Retry execution after failure
   * @param order Order to retry
   * @param excludeVenueId Venue to exclude (the one that failed)
   * @param attempts Number of attempts so far
   * @returns Executed order if successful
   */
  private async retryExecution(
    order: OrderIntent,
    excludeVenueId: string,
    attempts: number
  ): Promise<ExecutedOrder> {
    if (attempts >= this.config.maxRetryAttempts) {
      throw new Error(`Maximum retry attempts (${this.config.maxRetryAttempts}) reached`);
    }
    
    // Wait before retrying
    await new Promise(resolve => setTimeout(resolve, this.config.retryDelayMs));
    
    // Route to a different venue
    const routingResult = await this.route(order);
    
    // Find a venue that's not the excluded one
    let targetVenueId = routingResult.venue;
    if (targetVenueId === excludeVenueId) {
      // Try to find another venue
      const alternativeVenues = await Promise.all(
        this.venues
          .filter(v => v.id !== excludeVenueId && v.enabled)
          .map(async v => ({
            venue: v,
            trust: await this.trustEngine.getVenueTrust(v.id)
          }))
      );
      
      const suitableVenue = alternativeVenues.find(v => v.trust >= this.config.minTrustScore);
      
      if (suitableVenue) {
        targetVenueId = suitableVenue.venue.id;
      } else {
        // No alternative venue, have to use the same one
        console.log('No alternative venue available, retrying with same venue');
      }
    }
    
    if (!targetVenueId) {
      throw new Error('No suitable venue found for retry execution');
    }
    
    const venue = this.venues.find(v => v.id === targetVenueId);
    if (!venue) {
      throw new Error(`Venue with ID ${targetVenueId} not found`);
    }
    
    try {
      return await venue.execute(order, routingResult.recommendedStyle);
    } catch (error) {
      // Penalize this venue too
      await this.trustEngine.penalizeVenue(
        targetVenueId,
        'retry_execution_error',
        0.8
      );
      
      // Recursive retry with attempts increased
      return this.retryExecution(order, targetVenueId, attempts + 1);
    }
  }
  
  /**
   * Calculate execution score based on metrics, trust, intent, time of day, and Fill IQ
   * @param order Order to score
   * @param metrics Microstructure metrics
   * @param trust Trust score
   * @param intent Strategy intent from fusion layer
   * @param timeProfile Optional time-of-day profile
   * @param fillIQ Optional Fill IQ score for the venue
   * @returns Score for this venue
   */
  private calculateScore(
    order: OrderIntent,
    metrics: MicrostructureMetrics,
    trust: number,
    intent?: FusionState['strategyIntent'],
    timeProfile?: any, // TimeOfDayProfile
    fillIQ?: number
  ): number {
    // Start with trust score as base
    let score = trust;
    
    // Directional bias alignment
    const biasMatch = intent && (
      (order.side === 'buy' && intent.direction === 'long') ||
      (order.side === 'sell' && intent.direction === 'short')
    );
    
    // Apply penalties based on microstructure metrics
    const spoofPenalty = metrics.spoofingScore > this.config.thresholds.spoofingThreshold ? -0.5 : 0;
    const sweepPenalty = metrics.sweepRisk > this.config.thresholds.sweepRiskThreshold ? -0.3 : 0;
    const volatilityPenalty = metrics.quoteVolatility > this.config.thresholds.quoteVolatilityThreshold ? -0.2 : 0;
    const spreadPenalty = metrics.spreadPressure > this.config.thresholds.spreadPressureThreshold ? -0.2 : 0;
    
    // Apply alignment bonus
    const alignmentBonus = biasMatch ? 0.3 : 0;
    
    // Adjust penalties based on order urgency
    const urgencyFactor = this.getUrgencyFactor(order.urgency || 'medium');
    
    // Apply time-of-day adjustments
    let timeOfDayFactor = 0;
    if (timeProfile) {
      // Adjust venue score based on historical slippage performance at this hour
      timeOfDayFactor = -0.3 * timeProfile.avgSlippage;
      
      // During high volatility hours, prioritize venues with lower average slippage
      if (timeProfile.avgVolatility > 0.3) {
        timeOfDayFactor -= 0.2 * timeProfile.avgSlippage;
      }
    }
    
    // Apply Fill IQ factor if available
    let fillIQFactor = 0;
    if (fillIQ !== undefined && this.config.adaptToFillIQ) {
      // Convert Fill IQ (0-100) to a normalized factor
      fillIQFactor = (fillIQ / 100) * this.config.fillIQWeight;
    }
    
    // Calculate final score
    score += alignmentBonus;
    score += spoofPenalty * (1 - urgencyFactor);
    score += sweepPenalty * (1 - urgencyFactor);
    score += volatilityPenalty * (1 - urgencyFactor);
    score += spreadPenalty * (1 - urgencyFactor);
    score += timeOfDayFactor;
    score += fillIQFactor;
    
    return score;
  }
  
  /**
   * Determine best execution style based on market conditions and time of day
   * @param order Order to execute
   * @param metrics Microstructure metrics
   * @param intent Strategy intent
   * @param timeProfile Optional time-of-day profile
   * @returns Recommended execution style
   */
  private determineExecutionStyle(
    order: OrderIntent,
    metrics: MicrostructureMetrics,
    intent?: FusionState['strategyIntent'],
    timeProfile?: any // TimeOfDayProfile
  ): ExecutionStyle {
    // Apply time-of-day specific logic if available
    if (timeProfile) {
      // During high slippage hours, prefer TWAP for better execution
      if (timeProfile.avgSlippage > 0.2) {
        return ExecutionStyle.TWAP;
      }
      
      // During very volatile hours, avoid aggressive execution
      if (timeProfile.avgVolatility > 0.4 && order.urgency !== 'high') {
        return ExecutionStyle.Passive;
      }
      
      // During low volatility hours, can be more aggressive
      if (timeProfile.avgVolatility < 0.1 && order.side === 'buy') {
        return ExecutionStyle.Aggressive;
      }
    }
    
    // If high sweep risk, use TWAP to protect against slippage
    if (metrics.sweepRisk > this.config.thresholds.sweepRiskThreshold) {
      return ExecutionStyle.TWAP;
    }
    
    // If positive spread pressure (widening), avoid market orders
    if (metrics.spreadPressure > this.config.thresholds.spreadPressureThreshold) {
      return ExecutionStyle.Passive;
    }
    
    // If negative spread pressure (tightening), can be more aggressive
    if (metrics.spreadPressure < -this.config.thresholds.spreadPressureThreshold) {
      return ExecutionStyle.Aggressive;
    }
    
    // Consider strategy intent urgency
    if (intent) {
      if (intent.urgency === 'high') {
        return ExecutionStyle.Aggressive;
      } else if (intent.urgency === 'low') {
        return ExecutionStyle.Passive;
      }
    }
    
    // Consider order's own urgency
    if (order.urgency === 'high') {
      return ExecutionStyle.Aggressive;
    } else if (order.urgency === 'low') {
      return ExecutionStyle.Passive;
    }
    
    // Default to adaptive
    return ExecutionStyle.Adaptive;
  }
  
  /**
   * Estimate slippage based on market conditions and time of day
   * @param order Order to execute
   * @param metrics Microstructure metrics
   * @param timeProfile Optional time-of-day profile
   * @returns Estimated slippage in basis points
   */
  private estimateSlippage(
    order: OrderIntent,
    metrics: MicrostructureMetrics | null,
    timeProfile?: any // TimeOfDayProfile
  ): number {
    if (!metrics) return 10; // Default estimate
    
    // Base slippage on sweep risk
    let slippageEstimate = metrics.sweepRisk * 30;
    
    // Add impact from order book imbalance
    if ((order.side === 'buy' && metrics.topImbalance < 0) ||
        (order.side === 'sell' && metrics.topImbalance > 0)) {
      // Order is against the imbalance, expect higher slippage
      slippageEstimate += Math.abs(metrics.topImbalance) * 20;
    }
    
    // Add impact from quote volatility
    slippageEstimate += metrics.quoteVolatility * 15;
    
    // Adjust based on time of day if profile available
    if (timeProfile) {
      // Add historical time-of-day slippage component
      slippageEstimate += (timeProfile.avgSlippage * 25);
      
      // For high volatility hours, increase slippage estimate
      if (timeProfile.avgVolatility > 0.3) {
        slippageEstimate += 10;
      }
    }
    
    return Math.min(Math.max(slippageEstimate, 1), 100);
  }
  
  /**
   * Get urgency factor for calculations (0-1)
   * @param urgency Order urgency level
   * @returns Urgency factor between 0 and 1
   */
  private getUrgencyFactor(urgency: string): number {
    switch (urgency) {
      case 'high':
        return 0.9;
      case 'medium':
        return 0.5;
      case 'low':
        return 0.1;
      default:
        return 0.5;
    }
  }
  
  /**
   * Record execution feedback in fusion memory
   * @param asset Asset traded
   * @param order Executed order details
   * @param venueId Venue used for execution
   */
  private recordExecutionFeedback(
    asset: string,
    order: ExecutedOrder,
    venueId: string
  ): void {
    // Skip if order failed
    if (order.status === 'failed' || order.status === 'rejected') {
      return;
    }
    
    // Calculate adverse selection risk
    const adverseSelection = this.calculateAdverseSelectionRisk(order);
    
    // Create execution feedback
    const feedback = {
      lastVenueUsed: venueId,
      slippage: order.slippageBps,
      fillRate: order.executedQuantity / order.intent.quantity,
      adverseSelectionRisk: adverseSelection,
      latencyMs: order.latencyMs,
      timestamp: Date.now(),
      metadata: {
        executionStyle: order.metadata?.executionStyle,
        orderId: order.orderId,
        fees: order.fees
      }
    };
    
    // Update fusion memory
    this.fusionMemory.updateFeedback(asset, feedback);
  }
  
  /**
   * Calculate risk of adverse selection in an executed order
   * @param order Executed order
   * @returns Risk score between 0 and 1
   */
  private calculateAdverseSelectionRisk(order: ExecutedOrder): number {
    // Check if price moved against us shortly after execution
    // This is simplified; in reality would look at post-trade price action
    if (order.slippageBps > 20) {
      return 0.7; // High slippage suggests adverse selection
    }
    
    // Default moderate risk
    return 0.3;
  }
  
  /**
   * Calculate success magnitude for venue reward
   * @param order Executed order
   * @returns Success magnitude between 0 and 1
   */
  private calculateExecutionSuccessMagnitude(order: ExecutedOrder): number {
    // Base on fill rate and slippage
    const fillRateFactor = order.executedQuantity / order.intent.quantity;
    const slippageFactor = Math.max(0, 1 - (order.slippageBps / 50));
    
    // Weight fill rate higher than slippage
    return (fillRateFactor * 0.7) + (slippageFactor * 0.3);
  }
  
  /**
   * Get venue rankings by Fill IQ for an asset
   * @param asset Asset to get rankings for
   * @returns Venue rankings sorted by Fill IQ
   */
  private async getVenueRankings(asset: string): Promise<{
    rankings: Array<{ venue: string; fillIQ: number; fillCount: number }>;
    lastUpdated: number;
  }> {
    // Check cache first
    const cachedRankings = this.venueRankingsCache[asset];
    const now = Date.now();
    
    if (cachedRankings && now - cachedRankings.lastUpdated < this.cacheExpiryMs) {
      return cachedRankings;
    }
    
    // If no telemetry service, return empty rankings
    if (!this.telemetryService) {
      return { rankings: [], lastUpdated: now };
    }
    
    // Get execution telemetry data
    const telemetry = await this.telemetryService.getRecent(asset);
    
    // Calculate venue rankings
    const rankings = getVenuesByPerformance(
      telemetry,
      this.config.minFillsForIQAdaptation
    );
    
    // Cache the results
    this.venueRankingsCache[asset] = {
      rankings,
      lastUpdated: now
    };
    
    return this.venueRankingsCache[asset];
  }
  
  /**
   * Clear the venue rankings cache
   * @param asset Optional asset to clear cache for
   */
  public clearRankingsCache(asset?: string): void {
    if (asset) {
      delete this.venueRankingsCache[asset];
    } else {
      this.venueRankingsCache = {};
    }
  }
} 