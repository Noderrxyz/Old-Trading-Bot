/**
 * IKnowledgeProvider - Interface for external knowledge sources
 * 
 * This interface allows integration of external data sources like Numerai
 * while maintaining compatibility with Noderr's existing architecture.
 */

import { MarketRegime } from '../../regime/RegimeClassifier';
import { Signal } from '../../strategy/AdaptiveStrategy';
import { StrategyParameters } from '../../strategy/AdaptiveStrategy';

/**
 * Knowledge confidence levels
 */
export enum KnowledgeConfidence {
  NONE = 0,
  LOW = 0.3,
  MEDIUM = 0.5,
  HIGH = 0.7,
  VERY_HIGH = 0.9
}

/**
 * Knowledge applicability context
 */
export interface KnowledgeContext {
  /** Trading pair symbol */
  symbol: string;
  
  /** Current market regime */
  regime: MarketRegime;
  
  /** Time frame (e.g., '1h', '4h', '1d') */
  timeframe: string;
  
  /** Asset types (e.g., ['BTC', 'ETH']) */
  assets: string[];
  
  /** Current market volatility */
  volatility?: number;
  
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Knowledge enhancement data
 */
export interface KnowledgeEnhancement {
  /** Unique identifier for this knowledge */
  id: string;
  
  /** Source of the knowledge (e.g., 'numerai', 'chainlink') */
  source: string;
  
  /** Confidence in this knowledge (0-1) */
  confidence: number;
  
  /** How applicable this knowledge is to crypto (0-1) */
  cryptoApplicability: number;
  
  /** Enhanced features to add/modify */
  features?: Record<string, number>;
  
  /** Strategy parameter suggestions */
  parameterHints?: Partial<StrategyParameters>;
  
  /** Regime classification hints */
  regimeHints?: Partial<Record<MarketRegime, number>>;
  
  /** Risk adjustment factors */
  riskAdjustments?: {
    positionSizeMultiplier?: number;
    stopLossMultiplier?: number;
    confidenceMultiplier?: number;
  };
  
  /** Timestamp of knowledge generation */
  timestamp: number;
  
  /** Expiry time for this knowledge */
  expiresAt?: number;
}

/**
 * Feedback on knowledge application
 */
export interface KnowledgeFeedback {
  /** Knowledge ID that was applied */
  knowledgeId: string;
  
  /** Whether the knowledge improved performance */
  wasUseful: boolean;
  
  /** Performance delta (positive = improvement) */
  performanceDelta?: number;
  
  /** The signal that used this knowledge */
  signalId?: string;
  
  /** Any specific observations */
  notes?: string;
  
  /** Timestamp of feedback */
  timestamp: number;
}

/**
 * Knowledge provider statistics
 */
export interface KnowledgeProviderStats {
  /** Total queries made */
  totalQueries: number;
  
  /** Queries where knowledge was applicable */
  applicableQueries: number;
  
  /** Times knowledge was actually used */
  timesUsed: number;
  
  /** Times knowledge improved performance */
  timesUseful: number;
  
  /** Average performance improvement */
  avgPerformanceGain: number;
  
  /** Current confidence in this provider */
  providerConfidence: number;
  
  /** Last update timestamp */
  lastUpdated: number;
}

/**
 * Main knowledge provider interface
 */
export interface IKnowledgeProvider {
  /** Unique identifier */
  readonly id: string;
  
  /** Human-readable name */
  readonly name: string;
  
  /** Whether this provider is currently enabled */
  enabled: boolean;
  
  /**
   * Initialize the knowledge provider
   */
  initialize(): Promise<void>;
  
  /**
   * Check if this provider can provide useful knowledge for the context
   * @param context Current trading context
   * @returns Applicability score (0-1)
   */
  assessApplicability(context: KnowledgeContext): Promise<number>;
  
  /**
   * Get knowledge enhancement for the given context
   * @param context Current trading context
   * @returns Knowledge enhancement or null if not applicable
   */
  getEnhancement(context: KnowledgeContext): Promise<KnowledgeEnhancement | null>;
  
  /**
   * Provide feedback on knowledge application
   * @param feedback Feedback data
   */
  provideFeedback(feedback: KnowledgeFeedback): Promise<void>;
  
  /**
   * Get provider statistics
   */
  getStats(): KnowledgeProviderStats;
  
  /**
   * Update provider configuration based on performance
   * @param config New configuration
   */
  updateConfig(config: Record<string, any>): void;
  
  /**
   * Cleanup and shutdown
   */
  shutdown(): Promise<void>;
}

/**
 * Knowledge provider events
 */
export interface KnowledgeProviderEvents {
  'knowledge.requested': {
    providerId: string;
    context: KnowledgeContext;
    timestamp: number;
  };
  
  'knowledge.provided': {
    providerId: string;
    knowledgeId: string;
    confidence: number;
    applicability: number;
    timestamp: number;
  };
  
  'knowledge.applied': {
    providerId: string;
    knowledgeId: string;
    strategyId: string;
    timestamp: number;
  };
  
  'knowledge.feedback': {
    providerId: string;
    knowledgeId: string;
    wasUseful: boolean;
    performanceDelta?: number;
    timestamp: number;
  };
} 