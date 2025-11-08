/**
 * Risk Scoring Types
 * 
 * Types and interfaces for the contextual risk scoring system that
 * evaluates trade signals based on various risk factors.
 */

/**
 * Risk score tier categorization
 */
export enum RiskTier {
  SAFE = 'SAFE',
  CAUTIOUS = 'CAUTIOUS',
  RISKY = 'RISKY'
}

/**
 * Market classification for risk evaluation
 */
export enum MarketClass {
  TRENDING = 'TRENDING',
  MEAN_REVERTING = 'MEAN_REVERTING',
  VOLATILE = 'VOLATILE',
  RANGING = 'RANGING',
  UNKNOWN = 'UNKNOWN'
}

/**
 * Risk score output containing the assessment of a signal
 */
export interface RiskScore {
  /** Unique ID for this risk assessment */
  id: string;
  
  /** Asset symbol this assessment is for */
  symbol: string;
  
  /** Signal ID this assessment is linked to (if available) */
  signalId?: string;
  
  /** Overall risk score (0.0-1.0) where 1.0 is safest */
  score: number;
  
  /** Risk tier classification */
  tier: RiskTier;
  
  /** Timestamp when the assessment was made */
  timestamp: number;
  
  /** Individual component scores that make up the overall score */
  components: {
    /** Volatility-based score (0.0-1.0) */
    volatility: number;
    
    /** Liquidity-based score (0.0-1.0) */
    liquidity: number;
    
    /** Spread-based score (0.0-1.0) */
    spread: number;
    
    /** Signal age/staleness score (0.0-1.0) */
    staleness: number;
    
    /** Execution trust score based on historical performance (0.0-1.0) */
    executionTrust: number;
  };
  
  /** Additional metadata and context for this risk assessment */
  metadata: {
    /** Current market classification */
    marketClass: MarketClass;
    
    /** Recent alpha volatility measurement */
    alphaVolatility: number;
    
    /** Current bid-ask spread in basis points */
    spreadBps: number;
    
    /** Signal age in seconds */
    signalAgeSec: number;
    
    /** Estimated liquidity available in USD */
    estimatedLiquidityUsd: number;
    
    /** Recent slippage history in basis points (if available) */
    recentSlippageBps?: number;
    
    /** Key venues with trust scores */
    venueTrustScores?: Record<string, number>;
    
    /** Any additional context or data used in scoring */
    [key: string]: any;
  };
}

/**
 * Configuration for the risk scoring system
 */
export interface RiskScorerConfig {
  /** Whether the risk scoring system is enabled */
  enabled: boolean;
  
  /** Weight for volatility component (0.0-1.0) */
  volatilityWeight: number;
  
  /** Weight for spread component (0.0-1.0) */
  spreadWeight: number;
  
  /** Weight for signal staleness component (0.0-1.0) */
  stalenessWeight: number;
  
  /** Weight for execution trust component (0.0-1.0) */
  executionTrustWeight: number;
  
  /** Weight for liquidity component (0.0-1.0) */
  liquidityWeight: number;
  
  /** Score penalties/bonuses for different market classifications */
  marketClassAdjustments: {
    /** Adjustment for trending markets (-1.0 to 1.0) */
    trending: number;
    
    /** Adjustment for mean-reverting markets (-1.0 to 1.0) */
    meanReverting: number;
    
    /** Adjustment for volatile markets (-1.0 to 1.0) */
    volatile: number;
    
    /** Adjustment for ranging markets (-1.0 to 1.0) */
    ranging: number;
  };
  
  /** Tier thresholds */
  tiers: {
    /** Minimum score for SAFE tier (0.0-1.0) */
    safe: number;
    
    /** Minimum score for CAUTIOUS tier (0.0-1.0) */
    cautious: number;
  };
  
  /** Maximum signal age in seconds before applying severe staleness penalty */
  maxSignalAgeSec: number;
  
  /** Thresholds for volatility scoring */
  volatility: {
    /** Volatility threshold above which score is zero (maximum risk) */
    highRisk: number;
    
    /** Volatility threshold below which score is one (minimum risk) */
    lowRisk: number;
  };
  
  /** Thresholds for spread scoring */
  spread: {
    /** Spread in basis points above which score is zero (maximum risk) */
    highRisk: number;
    
    /** Spread in basis points below which score is one (minimum risk) */
    lowRisk: number;
  };
  
  /** Thresholds for liquidity scoring */
  liquidity: {
    /** Liquidity in USD below which score is zero (maximum risk) */
    highRisk: number;
    
    /** Liquidity in USD above which score is one (minimum risk) */
    lowRisk: number;
  };
  
  // Thresholds for risk tiers
  safeTierThreshold: number;
  cautiousTierThreshold: number;
  riskyTierThreshold: number;
  
  // Staleness thresholds in milliseconds
  stalenessThresholds: {
    safe: number;
    cautious: number;
    risky: number;
  };
}

/**
 * Default configuration for the risk scoring system
 */
export const DEFAULT_RISK_SCORER_CONFIG: RiskScorerConfig = {
  enabled: true,
  volatilityWeight: 0.3,
  spreadWeight: 0.2,
  stalenessWeight: 0.1,
  executionTrustWeight: 0.2,
  liquidityWeight: 0.2,
  marketClassAdjustments: {
    trending: -0.05,
    meanReverting: 0.05,
    volatile: -0.15,
    ranging: 0
  },
  tiers: {
    safe: 0.7,
    cautious: 0.4
  },
  maxSignalAgeSec: 300, // 5 minutes
  volatility: {
    highRisk: 0.5,
    lowRisk: 0.1
  },
  spread: {
    highRisk: 50, // 0.5%
    lowRisk: 5 // 0.05%
  },
  liquidity: {
    highRisk: 10000, // $10k
    lowRisk: 1000000 // $1M
  },
  safeTierThreshold: 0.7,
  cautiousTierThreshold: 0.4,
  riskyTierThreshold: 0.3,
  stalenessThresholds: {
    safe: 1000, // 1 second
    cautious: 5000, // 5 seconds
    risky: 10000 // 10 seconds
  }
}; 