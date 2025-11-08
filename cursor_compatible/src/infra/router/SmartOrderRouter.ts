/**
 * Smart Order Router
 * 
 * Routes orders across multiple DEXs based on:
 * - Slippage estimation
 * - Liquidity depth
 * - Gas costs
 * 
 * Provides optimal execution by selecting the best venue based on total cost.
 */

import { OrderIntent, ExecutedOrder, ExecutionStyle, RoutingResult } from '../../types/execution.types.js';
import { ExecutionVenue } from '../venues/VenueRegistry.js';
import { TrustEngine } from '../risk/TrustEngine.js';
import { FusionMemory } from '../../fusion/FusionMemory.js';
import { createLogger } from '../../common/logger.js';
import { ExecutionMemory, getExecutionMemory } from '../../execution/ExecutionMemory.js';

const logger = createLogger('SmartOrderRouter');

/**
 * Configuration for the Smart Order Router
 */
export interface SmartOrderRouterConfig {
  // List of DEX venues to consider
  enabledDexes: string[];
  
  // Whether to consider gas costs in routing decisions
  considerGasCosts: boolean;
  
  // Gas price multiplier for urgency
  gasPriceMultiplier: {
    low: number;
    medium: number;
    high: number;
  };
  
  // Slippage tolerance (in basis points) per urgency level
  slippageTolerance: {
    low: number;
    medium: number;
    high: number;
  };
  
  // Maximum price impact percentage to accept
  maxPriceImpact: number;
  
  // How much to weight each factor in routing decision (0-1)
  weights: {
    slippage: number;
    gas: number;
    trust: number;
    liquidity: number;
  };
  
  // Quote cache time in milliseconds (0 to disable)
  quoteCacheMs: number;
  
  // Whether to fail execution if all routes exceed maxPriceImpact
  failOnHighImpact: boolean;
  
  // Maximum retries for failed quotes
  maxRetries: number;
  
  // Delay between retries in milliseconds
  retryDelayMs: number;
  
  // Whether to simulate executions in test mode
  simulationMode: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_SOR_CONFIG: SmartOrderRouterConfig = {
  enabledDexes: ['uniswap_v3', 'sushiswap', '0x_api', 'curve'],
  considerGasCosts: true,
  gasPriceMultiplier: {
    low: 1.0,
    medium: 1.2,
    high: 1.5
  },
  slippageTolerance: {
    low: 50, // 0.5%
    medium: 100, // 1%
    high: 200 // 2%
  },
  maxPriceImpact: 5.0, // 5%
  weights: {
    slippage: 0.5,
    gas: 0.25,
    trust: 0.15,
    liquidity: 0.1
  },
  quoteCacheMs: 10000, // 10 seconds
  failOnHighImpact: true,
  maxRetries: 3,
  retryDelayMs: 1000,
  simulationMode: false
};

/**
 * Quote information from a DEX
 */
interface DexQuote {
  // Venue ID
  venueId: string;
  
  // Expected output amount
  outputAmount: number;
  
  // Input amount
  inputAmount: number;
  
  // Effective price (outputAmount / inputAmount)
  effectivePrice: number;
  
  // Estimated price impact (percentage)
  priceImpact: number;
  
  // Estimated gas cost (in ETH)
  gasCost: number;
  
  // Gas cost in USD
  gasCostUsd: number;
  
  // Estimated execution time in milliseconds
  estimatedTimeMs: number;
  
  // Liquidity depth (in base units)
  liquidityDepth: number;
  
  // Quote timestamp
  timestamp: number;
  
  // Whether the quote is estimated (vs exact)
  isEstimate: boolean;
  
  // Route details (may include multiple hops)
  route?: {
    path: string[];
    pools?: any[];
  };
}

/**
 * Cached quote information
 */
interface CachedQuote {
  quote: DexQuote;
  expiresAt: number;
}

/**
 * Route scoring result
 */
interface RouteScore {
  venueId: string;
  totalScore: number;
  breakdown: {
    slippageScore: number;
    gasScore: number;
    trustScore: number;
    liquidityScore: number;
  };
  quote: DexQuote;
}

/**
 * Smart Order Router for optimal DEX execution
 */
export class SmartOrderRouter {
  // Cache for quotes
  private quoteCache: Map<string, CachedQuote> = new Map();
  private executionMemory: ExecutionMemory;
  
  /**
   * Create a new Smart Order Router
   * 
   * @param venues Available execution venues
   * @param trustEngine Trust engine for venue scoring
   * @param fusionMemory Fusion memory for strategy data
   * @param config Router configuration
   */
  constructor(
    private readonly venues: ExecutionVenue[],
    private readonly trustEngine: TrustEngine,
    private readonly fusionMemory?: FusionMemory,
    private readonly config: SmartOrderRouterConfig = DEFAULT_SOR_CONFIG
  ) {
    logger.info(`Smart Order Router initialized with ${this.config.enabledDexes.length} DEXs`);
    // Initialize execution memory
    this.executionMemory = getExecutionMemory();
  }
  
  /**
   * Route an order to the best DEX based on slippage, gas costs, and liquidity
   * 
   * @param order Order intent to route
   * @returns Routing result with selected venue
   */
  async route(order: OrderIntent): Promise<RoutingResult> {
    logger.info(`Routing ${order.side} order for ${order.quantity} ${order.asset}`);
    
    // Get eligible DEX venues
    const eligibleVenues = await this.getEligibleVenues(order.asset);
    if (eligibleVenues.length === 0) {
      logger.warn(`No eligible DEX venues found for ${order.asset}`);
      return this.createEmptyRoutingResult('No eligible venues found');
    }
    
    // Get quotes from all eligible venues
    const quotes = await this.getQuotesFromVenues(order, eligibleVenues);
    if (quotes.length === 0) {
      logger.warn(`No valid quotes received for ${order.asset}`);
      return this.createEmptyRoutingResult('No valid quotes received');
    }
    
    // Score each route
    const scoredRoutes = await this.scoreRoutes(order, quotes);
    if (scoredRoutes.length === 0) {
      logger.warn(`No valid routes found for ${order.asset}`);
      return this.createEmptyRoutingResult('No valid routes after scoring');
    }
    
    // Select the best route
    const bestRoute = scoredRoutes[0];
    logger.info(`Selected ${bestRoute.venueId} as best route with score ${bestRoute.totalScore.toFixed(2)}`);
    
    // Check if price impact is too high
    if (bestRoute.quote.priceImpact > this.config.maxPriceImpact && this.config.failOnHighImpact) {
      logger.warn(`Price impact too high (${bestRoute.quote.priceImpact.toFixed(2)}%) for ${order.asset}`);
      return this.createEmptyRoutingResult(`Price impact too high: ${bestRoute.quote.priceImpact.toFixed(2)}%`);
    }
    
    // Create routing result
    return {
      venue: bestRoute.venueId,
      score: bestRoute.totalScore,
      recommendedStyle: this.determineExecutionStyle(order, bestRoute.quote),
      estimatedSlippageBps: Math.round(bestRoute.quote.priceImpact * 100),
      shouldDelay: false,
      metricsSnapshot: {
        priceImpact: bestRoute.quote.priceImpact,
        gasCost: bestRoute.quote.gasCostUsd,
        liquidityDepth: bestRoute.quote.liquidityDepth,
        effectivePrice: bestRoute.quote.effectivePrice
      },
      trustScore: bestRoute.breakdown.trustScore,
      metadata: {
        route: bestRoute.quote.route,
        scoreBreakdown: bestRoute.breakdown,
        quotedAt: bestRoute.quote.timestamp,
        estimatedTimeMs: bestRoute.quote.estimatedTimeMs,
        alternativeRoutes: scoredRoutes.slice(1, 3).map(r => ({
          venue: r.venueId,
          score: r.totalScore,
          priceImpact: r.quote.priceImpact
        }))
      }
    };
  }
  
  /**
   * Execute an order using the best available route
   * 
   * @param order Order intent to execute
   * @returns Executed order details
   */
  async execute(order: OrderIntent): Promise<ExecutedOrder> {
    // First route the order to find the best venue
    const routingResult = await this.route(order);
    
    if (!routingResult.venue) {
      throw new Error(`No suitable venue found for execution: ${routingResult.delayReason}`);
    }
    
    logger.info(`Executing ${order.side} order for ${order.quantity} ${order.asset} on ${routingResult.venue}`);
    
    // Get the venue
    const venue = this.venues.find(v => v.id === routingResult.venue);
    if (!venue) {
      throw new Error(`Venue ${routingResult.venue} not found`);
    }
    
    // Set slippage tolerance based on urgency
    const urgency = order.urgency || 'medium';
    const slippageBps = this.config.slippageTolerance[urgency];
    
    // Clone the order and add slippage tolerance
    const orderWithSlippage: OrderIntent = {
      ...order,
      maxSlippageBps: slippageBps,
    };
    
    try {
      // If in simulation mode, return a mock executed order
      if (this.config.simulationMode) {
        return this.createMockExecutedOrder(orderWithSlippage, venue.id, routingResult);
      }
      
      // Execute the order on the selected venue
      const result = await venue.execute(orderWithSlippage, routingResult.recommendedStyle);
      
      // Update fusion memory with execution feedback if available
      if (this.fusionMemory) {
        this.recordExecutionFeedback(order.asset, result);
      }
      
      // Record execution result in the ExecutionMemory system
      this.executionMemory.recordExecution(orderWithSlippage, result);
      
      return result;
    } catch (error) {
      logger.error(`Execution failed on ${venue.id}: ${error instanceof Error ? error.message : String(error)}`);
      
      // Log error to the trust memory system (create a failed execution record)
      if (!this.config.simulationMode) {
        const failedResult: ExecutedOrder = {
          intent: orderWithSlippage,
          venue: venue.id,
          orderId: `failed-${Date.now()}`,
          executedPrice: 0,
          executedQuantity: 0,
          timestamp: Date.now(),
          status: 'failed',
          latencyMs: 0,
          slippageBps: 0,
          failureReason: error instanceof Error ? error.message : String(error)
        };
        
        this.executionMemory.recordExecution(orderWithSlippage, failedResult);
      }
      
      throw new Error(`Execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get eligible venues that support the given asset
   * 
   * @param asset Asset to check
   * @returns Array of eligible venues
   */
  private async getEligibleVenues(asset: string): Promise<ExecutionVenue[]> {
    const eligibleVenues: ExecutionVenue[] = [];
    
    for (const venue of this.venues) {
      // Skip venues that are not enabled or not DEXs
      if (!venue.enabled || !this.config.enabledDexes.includes(venue.id)) {
        continue;
      }
      
      try {
        const supported = await venue.isAssetSupported(asset);
        if (supported) {
          eligibleVenues.push(venue);
        }
      } catch (error) {
        logger.error(`Error checking asset support for ${venue.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    return eligibleVenues;
  }
  
  /**
   * Get quotes from all eligible venues
   * 
   * @param order Order intent
   * @param venues Eligible venues
   * @returns Array of quotes
   */
  private async getQuotesFromVenues(order: OrderIntent, venues: ExecutionVenue[]): Promise<DexQuote[]> {
    const quotes: DexQuote[] = [];
    const quotePromises: Promise<void>[] = [];
    
    // Check cache first
    for (const venue of venues) {
      const cacheKey = this.getQuoteCacheKey(order, venue.id);
      const cachedQuote = this.quoteCache.get(cacheKey);
      
      if (cachedQuote && cachedQuote.expiresAt > Date.now()) {
        quotes.push(cachedQuote.quote);
        continue;
      }
      
      // Otherwise fetch quote
      quotePromises.push(this.fetchQuoteWithRetries(order, venue).then(quote => {
        if (quote) {
          quotes.push(quote);
          
          // Cache the quote if caching is enabled
          if (this.config.quoteCacheMs > 0) {
            this.quoteCache.set(cacheKey, {
              quote,
              expiresAt: Date.now() + this.config.quoteCacheMs
            });
          }
        }
      }));
    }
    
    // Wait for all quotes
    await Promise.all(quotePromises);
    return quotes;
  }
  
  /**
   * Fetch a quote from a venue with retries
   * 
   * @param order Order intent
   * @param venue Execution venue
   * @returns Quote or null if failed
   */
  private async fetchQuoteWithRetries(order: OrderIntent, venue: ExecutionVenue): Promise<DexQuote | null> {
    let lastError: any = null;
    
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        return await this.fetchQuote(order, venue);
      } catch (error) {
        lastError = error;
        logger.warn(`Attempt ${attempt + 1}/${this.config.maxRetries} failed for ${venue.id}: ${error instanceof Error ? error.message : String(error)}`);
        
        if (attempt < this.config.maxRetries - 1) {
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelayMs));
        }
      }
    }
    
    logger.error(`Failed to get quote from ${venue.id} after ${this.config.maxRetries} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    return null;
  }
  
  /**
   * Fetch a quote from a specific venue
   * 
   * @param order Order intent
   * @param venue Execution venue
   * @returns Quote information
   */
  private async fetchQuote(order: OrderIntent, venue: ExecutionVenue): Promise<DexQuote> {
    // In a real implementation, we would call venue-specific quote API
    // For this implementation, we'll simulate the response with realistic values
    
    // Get market data for base price
    const marketData = await venue.getMarketData(order.asset);
    const basePrice = marketData.lastPrice || 1000; // Fallback price
    
    // Calculate random but realistic values for the quote
    const gasPriceGwei = 20 + Math.random() * 30; // 20-50 Gwei
    const estimatedGas = 80000 + Math.random() * 120000; // 80k-200k gas
    const gasCostEth = (gasPriceGwei * 1e-9) * estimatedGas;
    const ethUsdPrice = 2000 + Math.random() * 1000; // $2000-$3000
    const gasCostUsd = gasCostEth * ethUsdPrice;
    
    // Calculate simulated slippage based on order size
    // Larger orders have higher slippage
    const orderSizeUsd = order.quantity * basePrice;
    let priceImpactPct = 0.1 + (orderSizeUsd / 100000) * (0.5 + Math.random() * 0.5);
    priceImpactPct = Math.min(priceImpactPct, 10); // Cap at 10%
    
    // Adjust price based on slippage direction
    const slippageDirection = order.side === 'buy' ? 1 : -1;
    const effectivePrice = basePrice * (1 + (slippageDirection * priceImpactPct / 100));
    
    // Calculate output amount based on effective price
    const outputAmount = order.side === 'buy' 
      ? order.quantity / effectivePrice 
      : order.quantity * effectivePrice;
    
    // Estimate liquidity depth 
    const liquidityDepth = orderSizeUsd * (10 + Math.random() * 20);
    
    // Different DEXs will have different latencies
    const latencyByVenue: Record<string, number> = {
      'uniswap_v3': 300 + Math.random() * 200,
      'sushiswap': 400 + Math.random() * 300,
      '0x_api': 500 + Math.random() * 400,
      'curve': 350 + Math.random() * 250,
    };
    
    const estimatedTimeMs = latencyByVenue[venue.id] || 500;
    
    // Simulate multi-hop routes for some venues
    const route = venue.id === '0x_api' || Math.random() > 0.7 
      ? {
          path: this.generateRoutePath(order.asset),
          pools: this.generatePoolsInfo(2 + Math.floor(Math.random() * 2))
        }
      : undefined;
    
    return {
      venueId: venue.id,
      inputAmount: order.quantity,
      outputAmount,
      effectivePrice,
      priceImpact: priceImpactPct,
      gasCost: gasCostEth,
      gasCostUsd,
      estimatedTimeMs,
      liquidityDepth,
      timestamp: Date.now(),
      isEstimate: venue.id !== 'uniswap_v3', // Uniswap provides exact quotes
      route
    };
  }
  
  /**
   * Score routes based on quotes, liquidity, gas cost, and trust scores
   * @param order Order to route
   * @param quotes Quotes from various venues
   * @returns Scored routes
   */
  private async scoreRoutes(
    order: OrderIntent,
    quotes: DexQuote[]
  ): Promise<RouteScore[]> {
    logger.debug(`Scoring ${quotes.length} routes for ${order.asset}`);
    
    const scoredRoutes: RouteScore[] = [];
    
    // Get weights based on order urgency
    const urgency = order.urgency || 'medium';
    const weights = {
      slippage: this.config.weights.slippage,
      gas: this.config.weights.gas,
      trust: this.config.weights.trust,
      liquidity: this.config.weights.liquidity
    };
    
    // Adjust weights based on urgency
    if (urgency === 'high') {
      weights.slippage *= 0.8; // Less focus on slippage
      weights.gas *= 0.7;      // Less focus on gas
      weights.trust *= 1.3;    // More focus on trust
    } else if (urgency === 'low') {
      weights.slippage *= 1.3; // More focus on slippage
      weights.gas *= 1.2;      // More focus on gas
    }
    
    for (const quote of quotes) {
      // Get trust score from TrustEngine
      const trustScore = await this.trustEngine.getVenueTrust(quote.venueId);
      
      // Get route trust score from ExecutionMemory
      const routeTrustScore = this.executionMemory.getRouteTrust(
        quote.venueId, 
        order.asset,
        quote.route?.pools?.[0]?.id
      );
      
      // Combine trust scores - weight the route-specific score higher
      const combinedTrustScore = (trustScore * 0.4) + (routeTrustScore * 0.6);
      
      // Calculate score components
      const slippageScore = this.calculateSlippageScore(quote.priceImpact);
      const gasScore = this.calculateGasScore(quote.gasCostUsd);
      const liquidityScore = this.calculateLiquidityScore(quote.liquidityDepth, order.quantity);
      
      // Calculate total score
      const totalScore = 
        (slippageScore * weights.slippage) + 
        (gasScore * weights.gas) + 
        (combinedTrustScore * weights.trust) + 
        (liquidityScore * weights.liquidity);
      
      scoredRoutes.push({
        venueId: quote.venueId,
        quote,
        totalScore,
        breakdown: {
          slippageScore,
          gasScore,
          trustScore: combinedTrustScore,
          liquidityScore
        }
      });
    }
    
    // Sort by total score descending
    scoredRoutes.sort((a, b) => b.totalScore - a.totalScore);
    
    return scoredRoutes;
  }
  
  /**
   * Calculate score for slippage component
   * Lower price impact is better (higher score)
   * @param priceImpact Price impact as percentage
   * @returns Score from 0-1
   */
  private calculateSlippageScore(priceImpact: number): number {
    // Lower is better, scale from 0-10% impact
    const maxImpact = 10;
    
    if (priceImpact <= 0) return 1; // No price impact
    if (priceImpact >= maxImpact) return 0; // Max price impact
    
    return 1 - (priceImpact / maxImpact);
  }
  
  /**
   * Calculate score for gas cost component
   * Lower gas cost is better (higher score)
   * @param gasCostUsd Gas cost in USD
   * @returns Score from 0-1
   */
  private calculateGasScore(gasCostUsd: number): number {
    // Lower is better, scale from 0-50 USD
    const maxGasCost = 50;
    
    if (gasCostUsd <= 0) return 1; // No gas cost
    if (gasCostUsd >= maxGasCost) return 0; // Max gas cost
    
    return 1 - (gasCostUsd / maxGasCost);
  }
  
  /**
   * Calculate score for liquidity component
   * Higher liquidity relative to trade size is better
   * @param liquidityDepth Liquidity depth in USD
   * @param orderQuantity Order quantity
   * @returns Score from 0-1
   */
  private calculateLiquidityScore(liquidityDepth: number, orderQuantity: number): number {
    // Calculate ratio of liquidity to order size
    const ratio = liquidityDepth / (orderQuantity * 2);
    
    // Logarithmic scale - ratio of 5 gives 0.8 score
    if (ratio <= 0) return 0;
    if (ratio >= 10) return 1;
    
    return Math.log10(ratio + 1) / Math.log10(11);
  }
  
  /**
   * Determine the optimal execution style based on order and quote
   * 
   * @param order Order intent
   * @param quote Quote from venue
   * @returns Recommended execution style
   */
  private determineExecutionStyle(order: OrderIntent, quote: DexQuote): ExecutionStyle {
    // High urgency always uses aggressive style
    if (order.urgency === 'high') {
      return ExecutionStyle.Aggressive;
    }
    
    // Low urgency prefers passive style unless slippage is very low
    if (order.urgency === 'low') {
      return quote.priceImpact < 0.3 ? ExecutionStyle.Aggressive : ExecutionStyle.Passive;
    }
    
    // For medium urgency or default:
    // Use adaptive for normal conditions
    // Use TWAP for higher impact orders
    if (quote.priceImpact > 2) {
      return ExecutionStyle.TWAP;
    }
    
    return ExecutionStyle.Adaptive;
  }
  
  /**
   * Create an empty routing result when no suitable venue found
   * 
   * @param reason Reason for empty result
   * @returns Empty routing result
   */
  private createEmptyRoutingResult(reason: string): RoutingResult {
    return {
      venue: null,
      score: 0,
      recommendedStyle: ExecutionStyle.Adaptive,
      estimatedSlippageBps: 0,
      shouldDelay: true,
      delayReason: reason,
      metricsSnapshot: {},
      trustScore: 0
    };
  }
  
  /**
   * Record execution feedback in fusion memory
   * 
   * @param asset Asset being traded
   * @param order Executed order
   */
  private recordExecutionFeedback(asset: string, order: ExecutedOrder): void {
    if (!this.fusionMemory) return;
    
    const state = this.fusionMemory.get(asset);
    if (!state) return;
    
    // Update the execution feedback in fusion memory
    this.fusionMemory.set(asset, {
      ...state,
      executionFeedback: {
        lastVenueUsed: order.venue,
        timestamp: order.timestamp,
        slippage: order.slippageBps / 10000, // Convert basis points to decimal
        fillRate: order.executedQuantity / order.intent.quantity,
        latencyMs: order.latencyMs,
        adverseSelectionRisk: 0, // Would need proper calculation in a real implementation
        metadata: {
          orderId: order.orderId,
          executedPrice: order.executedPrice,
          status: order.status,
          fees: order.fees
        }
      }
    });
  }
  
  /**
   * Generate a mock executed order for simulation mode
   * 
   * @param order Order intent
   * @param venueId Venue ID
   * @param routingResult Routing result
   * @returns Mock executed order
   */
  private createMockExecutedOrder(
    order: OrderIntent,
    venueId: string,
    routingResult: RoutingResult
  ): ExecutedOrder {
    const now = Date.now();
    const mockOrderId = `mock-${venueId}-${now}-${Math.floor(Math.random() * 1000)}`;
    const priceImpact = routingResult.metricsSnapshot?.priceImpact || 0.5;
    
    // For buy orders, higher price is worse; for sell orders, lower price is worse
    const direction = order.side === 'buy' ? 1 : -1;
    const basePrice = order.price || 1000;
    const executedPrice = basePrice * (1 + (direction * priceImpact / 100));
    
    const latency = 100 + Math.random() * 400;
    
    return {
      intent: order,
      venue: venueId,
      orderId: mockOrderId,
      executedPrice,
      executedQuantity: order.quantity,
      timestamp: now,
      status: 'filled',
      latencyMs: latency,
      slippageBps: Math.round(priceImpact * 100),
      fees: {
        asset: order.asset.split('/')[1] || 'USD',
        amount: order.quantity * executedPrice * 0.001 // 0.1% fee
      },
      metadata: {
        simulation: true,
        routingScore: routingResult.score,
        executionStyle: routingResult.recommendedStyle
      }
    };
  }
  
  /**
   * Get cache key for a quote
   * 
   * @param order Order intent
   * @param venueId Venue ID
   * @returns Cache key
   */
  private getQuoteCacheKey(order: OrderIntent, venueId: string): string {
    return `${order.asset}:${order.side}:${order.quantity}:${venueId}`;
  }
  
  /**
   * Generate a simulated route path for multi-hop routes
   * 
   * @param assetPair Asset pair (e.g. "ETH/USDC")
   * @returns Array of tokens in the route
   */
  private generateRoutePath(assetPair: string): string[] {
    const [from, to] = assetPair.split('/');
    
    // Possible intermediate tokens for routes
    const intermediateTokens = ['WETH', 'USDT', 'DAI', 'WBTC', 'MATIC'];
    
    // Simple case: direct route
    if (Math.random() > 0.3) {
      return [from, to];
    }
    
    // One-hop route
    if (Math.random() > 0.5) {
      const intermediate = intermediateTokens[Math.floor(Math.random() * intermediateTokens.length)];
      return [from, intermediate, to];
    }
    
    // Two-hop route
    const intermediates: string[] = [];
    while (intermediates.length < 2) {
      const token = intermediateTokens[Math.floor(Math.random() * intermediateTokens.length)];
      if (!intermediates.includes(token)) {
        intermediates.push(token);
      }
    }
    
    return [from, ...intermediates, to];
  }
  
  /**
   * Generate simulated pool information for routes
   * 
   * @param count Number of pools
   * @returns Array of pool objects
   */
  private generatePoolsInfo(count: number): any[] {
    const pools = [];
    const feeOptions = [0.0005, 0.003, 0.01]; // 0.05%, 0.3%, 1%
    
    for (let i = 0; i < count; i++) {
      pools.push({
        id: `pool_${Math.floor(Math.random() * 1000000)}`,
        fee: feeOptions[Math.floor(Math.random() * feeOptions.length)],
        liquidity: Math.floor(1000000 + Math.random() * 10000000)
      });
    }
    
    return pools;
  }
  
  /**
   * Clear the quote cache
   * 
   * @param asset Optional asset to clear cache for (all if omitted)
   */
  public clearQuoteCache(asset?: string): void {
    if (asset) {
      // Clear only for specific asset
      const keysToDelete: string[] = [];
      
      for (const key of this.quoteCache.keys()) {
        if (key.startsWith(`${asset}:`)) {
          keysToDelete.push(key);
        }
      }
      
      for (const key of keysToDelete) {
        this.quoteCache.delete(key);
      }
      
      logger.info(`Cleared quote cache for ${asset}`);
    } else {
      // Clear entire cache
      this.quoteCache.clear();
      logger.info('Cleared entire quote cache');
    }
  }
} 