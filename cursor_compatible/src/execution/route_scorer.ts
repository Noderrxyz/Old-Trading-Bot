/**
 * Route Scorer
 * 
 * Scores potential execution routes based on slippage, gas costs, depth, and latency.
 */

import { createLogger } from '../common/logger.js';
import { RouteCandidate, RouteScorerConfig, RouteScore, DEFAULT_ROUTE_SCORER_CONFIG } from './types/route_scorer.types.js';

const logger = createLogger('RouteScorer');

/**
 * Route scorer for evaluating execution routes
 */
export class RouteScorer {
  /**
   * Create a new route scorer
   * @param config Scoring configuration
   */
  constructor(
    private readonly config: RouteScorerConfig = DEFAULT_ROUTE_SCORER_CONFIG
  ) {
    logger.info('Route Scorer initialized');
  }

  /**
   * Score a route candidate
   * @param route Route to score
   * @returns Route score
   */
  public scoreRoute(route: RouteCandidate): RouteScore {
    const disqualificationReasons: string[] = [];
    
    // Check if route meets basic requirements
    if (route.estimatedSlippage > this.config.maxSlippageBps) {
      disqualificationReasons.push(`Slippage ${route.estimatedSlippage}bps exceeds maximum ${this.config.maxSlippageBps}bps`);
    }
    
    if (route.estimatedGasFeeUsd > this.config.maxGasFeeUsd) {
      disqualificationReasons.push(`Gas fee $${route.estimatedGasFeeUsd} exceeds maximum $${this.config.maxGasFeeUsd}`);
    }
    
    if (route.availableDepth < this.config.minDepthPct) {
      disqualificationReasons.push(`Available depth ${route.availableDepth}% below minimum ${this.config.minDepthPct}%`);
    }
    
    if (route.estimatedLatencyMs > this.config.maxLatencyMs) {
      disqualificationReasons.push(`Latency ${route.estimatedLatencyMs}ms exceeds maximum ${this.config.maxLatencyMs}ms`);
    }
    
    // Calculate individual component scores
    const slippageScore = this.calculateSlippageScore(route.estimatedSlippage);
    const gasScore = this.calculateGasScore(route.estimatedGasFeeUsd);
    const depthScore = this.calculateDepthScore(route.availableDepth);
    const latencyScore = this.calculateLatencyScore(route.estimatedLatencyMs);
    
    // Calculate total weighted score
    const totalScore = (
      slippageScore * this.config.weights.slippage +
      gasScore * this.config.weights.gas +
      depthScore * this.config.weights.depth +
      latencyScore * this.config.weights.latency
    );
    
    // Log scoring details if enabled
    if (this.config.enableLogging) {
      logger.info(`Scored route for ${route.exchange}:`, {
        totalScore,
        slippageScore,
        gasScore,
        depthScore,
        latencyScore,
        disqualificationReasons
      });
    }
    
    return {
      totalScore,
      components: {
        slippageScore,
        gasScore,
        depthScore,
        latencyScore
      },
      meetsRequirements: disqualificationReasons.length === 0,
      disqualificationReasons: disqualificationReasons.length > 0 ? disqualificationReasons : undefined
    };
  }
  
  /**
   * Calculate slippage score (0-1, lower is better)
   * @param slippageBps Slippage in basis points
   * @returns Slippage score
   */
  private calculateSlippageScore(slippageBps: number): number {
    // Normalize slippage to 0-1 range, where 0 is best
    return Math.min(1, slippageBps / this.config.maxSlippageBps);
  }
  
  /**
   * Calculate gas score (0-1, lower is better)
   * @param gasFeeUsd Gas fee in USD
   * @returns Gas score
   */
  private calculateGasScore(gasFeeUsd: number): number {
    // Normalize gas fee to 0-1 range, where 0 is best
    return Math.min(1, gasFeeUsd / this.config.maxGasFeeUsd);
  }
  
  /**
   * Calculate depth score (0-1, higher is better)
   * @param depthPct Available depth percentage
   * @returns Depth score
   */
  private calculateDepthScore(depthPct: number): number {
    // Normalize depth to 0-1 range, where 1 is best
    return Math.min(1, depthPct / this.config.minDepthPct);
  }
  
  /**
   * Calculate latency score (0-1, lower is better)
   * @param latencyMs Latency in milliseconds
   * @returns Latency score
   */
  private calculateLatencyScore(latencyMs: number): number {
    // Normalize latency to 0-1 range, where 0 is best
    return Math.min(1, latencyMs / this.config.maxLatencyMs);
  }
} 