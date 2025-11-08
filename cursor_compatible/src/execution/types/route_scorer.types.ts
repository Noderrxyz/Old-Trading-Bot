/**
 * Types for route scoring and optimization
 */

/**
 * Route candidate represents a potential execution route
 */
export interface RouteCandidate {
  // Exchange identifier
  exchange: string;
  
  // Chain identifier
  chain: string;
  
  // Estimated slippage in basis points
  estimatedSlippage: number;
  
  // Available depth at desired size
  availableDepth: number;
  
  // Estimated gas fee in USD
  estimatedGasFeeUsd: number;
  
  // Estimated latency in milliseconds
  estimatedLatencyMs: number;
  
  // Base price for the asset
  basePrice: number;
  
  // Quote token
  quoteToken: string;
  
  // Base token
  baseToken: string;
  
  // Route-specific metadata
  metadata?: Record<string, any>;
}

/**
 * Route scoring configuration
 */
export interface RouteScorerConfig {
  // Weights for different factors (0-1)
  weights: {
    slippage: number;
    gas: number;
    depth: number;
    latency: number;
  };
  
  // Maximum acceptable slippage in basis points
  maxSlippageBps: number;
  
  // Maximum acceptable gas fee in USD
  maxGasFeeUsd: number;
  
  // Minimum required depth percentage
  minDepthPct: number;
  
  // Maximum acceptable latency in milliseconds
  maxLatencyMs: number;
  
  // Whether to enable logging
  enableLogging: boolean;
}

/**
 * Default configuration for route scoring
 */
export const DEFAULT_ROUTE_SCORER_CONFIG: RouteScorerConfig = {
  weights: {
    slippage: 0.4,
    gas: 0.3,
    depth: 0.2,
    latency: 0.1
  },
  maxSlippageBps: 200, // 2%
  maxGasFeeUsd: 50,
  minDepthPct: 0.5, // 50% of order size
  maxLatencyMs: 5000,
  enableLogging: true
};

/**
 * Route scoring result
 */
export interface RouteScore {
  // Total score (lower is better)
  totalScore: number;
  
  // Individual component scores
  components: {
    slippageScore: number;
    gasScore: number;
    depthScore: number;
    latencyScore: number;
  };
  
  // Whether the route meets all requirements
  meetsRequirements: boolean;
  
  // Reasons for disqualification (if any)
  disqualificationReasons?: string[];
} 