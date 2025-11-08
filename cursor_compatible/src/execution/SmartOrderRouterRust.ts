import { NapiSmartOrderRouter } from '@noderr/core';
import { ExecutionResult, ExecutionStatus } from './types';
import { Order, OrderSide } from './order';
import { VenueExecutionResult } from './venue';
import { VenueLatencyTrackerRust } from './VenueLatencyTrackerRust';
import { SmartOrderRouterJs } from './SmartOrderRouterJs';
import { tryNativeOrFallback, createFallbackProxy } from '../utils/fallback';
import { telemetry, SeverityLevel, TraceFunctions } from '../telemetry';

// Simple logger implementation
const logger = {
  error: (message: string) => console.error(message),
  warn: (message: string) => console.warn(message),
  info: (message: string) => console.info(message),
  debug: (message: string) => console.debug(message),
};

/**
 * Order parameters for Rust implementation
 */
interface OrderParams {
  symbol: string;
  side: string;
  amount: number;
  price: number;
  venues: string[];
  id?: string;
  max_slippage?: number;
  max_retries?: number;
  additional_params?: Record<string, any>;
}

/**
 * Extended execution result with venue information
 */
interface ExtendedExecutionResult extends ExecutionResult {
  venue?: string;
  filledAmount?: number;
  averagePrice?: number;
}

/**
 * Rust-powered implementation of the Smart Order Router
 * Provides high-performance execution routing with minimal latency
 */
export class SmartOrderRouterRust {
  private router: NapiSmartOrderRouter;
  private latencyTracker: VenueLatencyTrackerRust;
  private fallbackRouter: SmartOrderRouterJs;
  private static instance: SmartOrderRouterRust | null = null;
  private componentName = 'SmartOrderRouter';
  
  /**
   * Create a new SmartOrderRouterRust instance
   * @param trustScores Initial trust scores for venues
   */
  private constructor(trustScores?: Record<string, number>) {
    // Initialize the fallback JavaScript router
    this.fallbackRouter = SmartOrderRouterJs.getInstance(trustScores);
    
    // Initialize the Rust router with trust scores if provided
    try {
      this.router = trustScores 
        ? NapiSmartOrderRouter.with_trust_scores(trustScores)
        : new NapiSmartOrderRouter();
        
      // Record successful initialization
      telemetry.recordMetric(`${this.componentName}.initialization`, 1, {
        implementation: 'rust',
        status: 'success'
      });
    } catch (error) {
      logger.warn(`Failed to initialize native SmartOrderRouter: ${(error as Error).message}`);
      logger.warn('Using JavaScript fallback for all SmartOrderRouter operations');
      
      // Record initialization failure
      telemetry.recordError(
        this.componentName,
        `Failed to initialize native SmartOrderRouter: ${(error as Error).message}`,
        SeverityLevel.WARNING
      );
      
      telemetry.recordMetric(`${this.componentName}.initialization`, 0, {
        implementation: 'rust',
        status: 'failed',
        error: (error as Error).name || 'unknown'
      });
      
      // Create a dummy router to avoid null checks
      this.router = {} as NapiSmartOrderRouter;
    }
    
    // Get latency tracker instance
    this.latencyTracker = VenueLatencyTrackerRust.getInstance();
    
    // Register health check
    if (typeof (globalThis as any).healthEndpoint?.registerHealthCheck === 'function') {
      (globalThis as any).healthEndpoint.registerHealthCheck(
        this.componentName,
        () => this.healthCheck()
      );
    }
  }

  /**
   * Get singleton router instance
   * @param trustScores Optional initial trust scores for venues
   */
  public static getInstance(trustScores?: Record<string, number>): SmartOrderRouterRust {
    if (!SmartOrderRouterRust.instance) {
      SmartOrderRouterRust.instance = new SmartOrderRouterRust(trustScores);
    }
    return SmartOrderRouterRust.instance;
  }

  /**
   * Execute an order using the best available venues based on trust scores and latency
   * @param order Order to execute
   * @returns Execution result
   */
  public async executeOrder(order: Order): Promise<ExecutionResult> {
    return TraceFunctions.traceAsync(
      this.componentName,
      'executeOrder',
      async () => {
        // Track number of orders routed
        telemetry.recordMetric(`${this.componentName}.order_count`, 1, {
          symbol: order.symbol,
          side: order.side,
          venues_count: String((order.venues || []).length)
        });
        
        return tryNativeOrFallback(
          { 
            name: 'SmartOrderRouter.executeOrder',
            maxConsecutiveFailures: 3,
            permanentFallbackAfterMaxFailures: true,
            collectMetrics: true
          },
          async () => {
            const startTime = performance.now();
            try {
              // Convert the order to params format expected by Rust
              const orderParams = this.convertOrderToParams(order);
              
              // Optimize venue order based on latency metrics
              orderParams.venues = await this.optimizeVenueOrder(orderParams.venues);
              
              // Start timing for latency measurement
              const venueTimingStart = this.latencyTracker.startTiming();
              
              // Execute the order using the Rust implementation
              const result = await this.router.execute_order(orderParams) as ExtendedExecutionResult;
              
              // Record the execution latency for the venue
              if (result && result.venue) {
                this.latencyTracker.finishTiming(result.venue, venueTimingStart);
                
                // Record successful execution and fill amount
                telemetry.recordMetric(`${this.componentName}.execution_success`, 1, {
                  symbol: order.symbol,
                  venue: result.venue,
                  side: order.side
                });
                
                if (result.filledAmount && result.filledAmount > 0) {
                  telemetry.recordMetric(`${this.componentName}.fill_amount`, result.filledAmount, {
                    symbol: order.symbol,
                    venue: result.venue,
                    side: order.side
                  });
                  
                  // Calculate and record price improvement if applicable
                  if (order.price && result.averagePrice) {
                    const isPriceImprovement = order.side === OrderSide.Buy
                      ? result.averagePrice < order.price
                      : result.averagePrice > order.price;
                      
                    if (isPriceImprovement) {
                      const improvement = Math.abs(order.price - result.averagePrice);
                      telemetry.recordMetric(`${this.componentName}.price_improvement`, improvement, {
                        symbol: order.symbol,
                        venue: result.venue,
                        side: order.side
                      });
                    }
                  }
                }
              }
              
              // Record order execution latency
              const duration = performance.now() - startTime;
              telemetry.recordMetric(`${this.componentName}.order_execution_latency`, duration, {
                implementation: 'rust',
                symbol: order.symbol,
                venue: result?.venue || 'unknown',
                status: result?.status || 'unknown'
              });
              
              return result;
            } catch (err) {
              // Record error
              telemetry.recordError(
                this.componentName, 
                err as Error,
                SeverityLevel.ERROR,
                {
                  implementation: 'rust',
                  method: 'executeOrder',
                  symbol: order.symbol,
                  side: order.side
                }
              );
              
              // Record execution failure
              telemetry.recordMetric(`${this.componentName}.execution_failure`, 1, {
                implementation: 'rust',
                symbol: order.symbol,
                error: (err as Error).name || 'unknown'
              });
              
              logger.error(`Error executing order with Rust SOR: ${(err as Error).message}`);
              
              // Re-throw to trigger fallback
              throw err;
            }
          },
          async () => {
            const startTime = performance.now();
            
            try {
              // Use JavaScript fallback
              const result = await this.fallbackRouter.executeOrder(order) as ExtendedExecutionResult;
              
              // Record fallback execution latency
              const duration = performance.now() - startTime;
              telemetry.recordMetric(`${this.componentName}.order_execution_latency`, duration, {
                implementation: 'javascript',
                symbol: order.symbol,
                venue: result?.venue || 'unknown',
                status: result?.status || 'unknown'
              });
              
              // Record fallback usage
              telemetry.recordMetric(`${this.componentName}.fallback_usage`, 1, {
                method: 'executeOrder',
                symbol: order.symbol,
                side: order.side
              });
              
              return result;
            } catch (err) {
              // Record error in fallback
              telemetry.recordError(
                `${this.componentName}Fallback`, 
                err as Error,
                SeverityLevel.ERROR,
                {
                  method: 'executeOrder',
                  symbol: order.symbol,
                  side: order.side
                }
              );
              
              throw err;
            }
          }
        );
      },
      {
        tags: {
          symbol: order.symbol,
          side: order.side
        }
      }
    );
  }

  /**
   * Get the trust score for a venue
   * @param venue Venue identifier
   * @returns Trust score for the venue
   */
  public async getVenueTrustScore(venue: string): Promise<number> {
    return TraceFunctions.traceAsync(
      this.componentName,
      'getVenueTrustScore',
      async () => {
        return tryNativeOrFallback(
          { name: 'SmartOrderRouter.getVenueTrustScore' },
          async () => this.router.get_venue_trust_score(venue),
          async () => {
            // Record fallback usage
            telemetry.recordMetric(`${this.componentName}.fallback_usage`, 1, {
              method: 'getVenueTrustScore',
              venue
            });
            
            return this.fallbackRouter.getVenueTrustScore(venue);
          }
        );
      },
      {
        tags: { venue }
      }
    );
  }

  /**
   * Set the trust score for a venue
   * @param venue Venue identifier
   * @param score New trust score
   */
  public async setVenueTrustScore(venue: string, score: number): Promise<void> {
    return TraceFunctions.traceAsync(
      this.componentName,
      'setVenueTrustScore',
      async () => {
        // Record trust score update
        telemetry.recordMetric(`${this.componentName}.trust_score_update`, score, {
          venue
        });
        
        return tryNativeOrFallback(
          { name: 'SmartOrderRouter.setVenueTrustScore' },
          async () => this.router.set_venue_trust_score(venue, score),
          async () => {
            // Record fallback usage
            telemetry.recordMetric(`${this.componentName}.fallback_usage`, 1, {
              method: 'setVenueTrustScore',
              venue
            });
            
            return this.fallbackRouter.setVenueTrustScore(venue, score);
          }
        );
      },
      {
        tags: { venue, score: String(score) }
      }
    );
  }
  
  /**
   * Get the latency tracker instance
   * @returns VenueLatencyTrackerRust instance
   */
  public getLatencyTracker(): VenueLatencyTrackerRust {
    return this.latencyTracker;
  }

  /**
   * Convert a TypeScript Order to OrderParams for the Rust implementation
   * @param order Order to convert
   * @returns OrderParams for Rust
   */
  private convertOrderToParams(order: Order): OrderParams {
    return {
      symbol: order.symbol,
      side: order.side.toLowerCase(),
      amount: order.amount,
      price: order.price || 0,
      venues: order.venues || [],
      id: order.id,
      max_slippage: order.maxSlippage,
      max_retries: order.maxRetries,
      additional_params: order.additionalParams || {},
    };
  }

  /**
   * Get the combined score for a venue based on trust and latency
   * @param venue Venue identifier
   * @returns Combined score where higher is better
   */
  private async getVenueCombinedScore(venue: string): Promise<number> {
    // Define the weights for trust score vs latency (trust:latency)
    const TRUST_WEIGHT = 0.6;
    const LATENCY_WEIGHT = 0.4;
    
    try {
      // Get trust score
      const trustScore = await this.getVenueTrustScore(venue);
      
      // Get latency score (0-100, lower is better)
      const latencyScore = this.latencyTracker.getRoutingScore(venue);
      
      // Invert the latency score (100 - score) so higher is better
      const invertedLatencyScore = 100 - latencyScore;
      
      // Calculate combined score (higher is better)
      const combinedScore = (trustScore * TRUST_WEIGHT) + (invertedLatencyScore * LATENCY_WEIGHT);
      
      // Record venue scores for monitoring
      telemetry.recordMetric(`${this.componentName}.venue_score`, combinedScore, {
        venue,
        trust_score: String(trustScore),
        latency_score: String(latencyScore)
      });
      
      return combinedScore;
    } catch (error) {
      logger.warn(`Error calculating combined score for venue ${venue}: ${(error as Error).message}`);
      
      // Record error
      telemetry.recordError(
        this.componentName,
        `Error calculating combined score for venue ${venue}: ${(error as Error).message}`,
        SeverityLevel.WARNING,
        { venue }
      );
      
      return 0; // Return lowest score on error
    }
  }

  /**
   * Optimize the order of venues based on trust scores and latency metrics
   * Prioritizes venues with better performance for faster execution
   * @param venues List of venues to optimize
   * @returns Optimized list of venues
   */
  private async optimizeVenueOrder(venues: string[]): Promise<string[]> {
    return TraceFunctions.traceAsync(
      this.componentName,
      'optimizeVenueOrder',
      async () => {
        if (!venues || venues.length <= 1) {
          return venues;
        }
    
        // Create a copy to avoid modifying the original
        const venuesCopy = [...venues];
        
        // Get scores for all venues
        const venueScores = new Map<string, number>();
        
        // Calculate scores for all venues
        for (const venue of venuesCopy) {
          venueScores.set(venue, await this.getVenueCombinedScore(venue));
        }
        
        // Sort venues by combined score (higher is better)
        venuesCopy.sort((a, b) => {
          const scoreA = venueScores.get(a) || 0;
          const scoreB = venueScores.get(b) || 0;
          return scoreB - scoreA; // Descending order
        });
        
        // Record venue selection events
        if (venuesCopy.length > 0) {
          telemetry.recordMetric(`${this.componentName}.primary_venue_score`, venueScores.get(venuesCopy[0]) || 0, {
            venue: venuesCopy[0]
          });
        }
        
        return venuesCopy;
      },
      {
        tags: { venue_count: String(venues.length) }
      }
    );
  }
  
  /**
   * Perform a health check on the Smart Order Router
   * @returns Whether the router is healthy
   */
  private async healthCheck(): Promise<boolean> {
    try {
      // Check if we can access trust scores as a basic health check
      const score = await this.getVenueTrustScore('binance');
      return true;
    } catch (error) {
      // Record the health check failure
      telemetry.recordError(
        this.componentName,
        `Health check failed: ${(error as Error).message}`,
        SeverityLevel.WARNING
      );
      return false;
    }
  }
} 