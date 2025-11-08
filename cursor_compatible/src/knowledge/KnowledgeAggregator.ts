/**
 * KnowledgeAggregator - Central service for managing external knowledge providers
 * 
 * This service aggregates knowledge from multiple sources and provides a unified
 * interface for the Noderr Protocol to enhance its trading intelligence.
 */

import { IKnowledgeProvider, KnowledgeContext, KnowledgeEnhancement, KnowledgeFeedback, KnowledgeProviderStats } from './interfaces/IKnowledgeProvider';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { createLogger } from '../common/logger';
import { MarketRegime } from '../regime/RegimeClassifier';
import { Signal, StrategyParameters } from '../strategy/AdaptiveStrategy';

const logger = createLogger('KnowledgeAggregator');

/**
 * Knowledge aggregation configuration
 */
export interface KnowledgeAggregatorConfig {
  /** Enable knowledge aggregation */
  enabled: boolean;
  
  /** Minimum confidence threshold for applying knowledge */
  minConfidenceThreshold: number;
  
  /** Minimum crypto applicability score */
  minApplicabilityThreshold: number;
  
  /** Maximum providers to query per context */
  maxProvidersPerQuery: number;
  
  /** Cache duration for knowledge in milliseconds */
  knowledgeCacheDurationMs: number;
  
  /** Enable automatic provider adjustment based on performance */
  enableAdaptiveProviders: boolean;
  
  /** Minimum queries before evaluating provider performance */
  minQueriesForEvaluation: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: KnowledgeAggregatorConfig = {
  enabled: true,
  minConfidenceThreshold: 0.4,
  minApplicabilityThreshold: 0.3,
  maxProvidersPerQuery: 5,
  knowledgeCacheDurationMs: 5 * 60 * 1000, // 5 minutes
  enableAdaptiveProviders: true,
  minQueriesForEvaluation: 20
};

/**
 * Cached knowledge entry
 */
interface CachedKnowledge {
  enhancement: KnowledgeEnhancement;
  context: KnowledgeContext;
  cachedAt: number;
}

/**
 * Aggregated knowledge result
 */
export interface AggregatedKnowledge {
  /** All applicable enhancements */
  enhancements: KnowledgeEnhancement[];
  
  /** Merged features from all sources */
  mergedFeatures: Record<string, number>;
  
  /** Consensus parameter hints */
  parameterHints: Partial<StrategyParameters>;
  
  /** Aggregated regime hints */
  regimeHints: Partial<Record<MarketRegime, number>>;
  
  /** Overall confidence in the aggregated knowledge */
  aggregatedConfidence: number;
  
  /** Sources that contributed */
  contributingSources: string[];
}

/**
 * Knowledge Aggregator Service
 */
export class KnowledgeAggregator {
  private static instance: KnowledgeAggregator | null = null;
  private providers: Map<string, IKnowledgeProvider> = new Map();
  private telemetryBus: TelemetryBus;
  private knowledgeCache: Map<string, CachedKnowledge> = new Map();
  private config: KnowledgeAggregatorConfig;
  private isInitialized: boolean = false;
  
  private constructor(config: Partial<KnowledgeAggregatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<KnowledgeAggregatorConfig>): KnowledgeAggregator {
    if (!KnowledgeAggregator.instance) {
      KnowledgeAggregator.instance = new KnowledgeAggregator(config);
    }
    return KnowledgeAggregator.instance;
  }
  
  /**
   * Register a knowledge provider
   */
  public async registerProvider(provider: IKnowledgeProvider): Promise<void> {
    try {
      logger.info(`Registering knowledge provider: ${provider.name} (${provider.id})`);
      
      // Initialize the provider
      await provider.initialize();
      
      // Add to registry
      this.providers.set(provider.id, provider);
      
      // Emit telemetry
      this.telemetryBus.emit('knowledge_provider_registered', {
        timestamp: Date.now(),
        providerId: provider.id,
        providerName: provider.name
      });
      
      logger.info(`Successfully registered provider: ${provider.id}`);
    } catch (error) {
      logger.error(`Failed to register provider ${provider.id}:`, error);
      throw error;
    }
  }
  
  /**
   * Initialize all registered providers
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('KnowledgeAggregator already initialized');
      return;
    }
    
    logger.info('Initializing KnowledgeAggregator');
    
    // Initialize all providers
    const initPromises = Array.from(this.providers.values()).map(provider =>
      provider.initialize().catch(error => {
        logger.error(`Failed to initialize provider ${provider.id}:`, error);
        // Disable failed provider
        provider.enabled = false;
      })
    );
    
    await Promise.all(initPromises);
    
    // Start cache cleanup interval
    this.startCacheCleanup();
    
    this.isInitialized = true;
    
    // Emit telemetry
    this.telemetryBus.emit('knowledge_aggregator_initialized', {
      timestamp: Date.now(),
      providerCount: this.providers.size,
      enabledProviders: Array.from(this.providers.values()).filter(p => p.enabled).length
    });
    
    logger.info('KnowledgeAggregator initialized successfully');
  }
  
  /**
   * Get aggregated knowledge for a context
   */
  public async getAggregatedKnowledge(context: KnowledgeContext): Promise<AggregatedKnowledge | null> {
    if (!this.config.enabled) {
      return null;
    }
    
    const startTime = Date.now();
    const cacheKey = this.getCacheKey(context);
    
    // Check cache first
    const cached = this.checkCache(cacheKey);
    if (cached) {
      return this.aggregateEnhancements([cached.enhancement]);
    }
    
    // Get enabled providers sorted by confidence
    const enabledProviders = Array.from(this.providers.values())
      .filter(p => p.enabled)
      .sort((a, b) => b.getStats().providerConfidence - a.getStats().providerConfidence)
      .slice(0, this.config.maxProvidersPerQuery);
    
    if (enabledProviders.length === 0) {
      logger.debug('No enabled knowledge providers available');
      return null;
    }
    
    // Query providers in parallel
    const enhancements: KnowledgeEnhancement[] = [];
    const queryPromises = enabledProviders.map(async provider => {
      try {
        // Check applicability first
        const applicability = await provider.assessApplicability(context);
        
        if (applicability < this.config.minApplicabilityThreshold) {
          logger.debug(`Provider ${provider.id} not applicable for context (score: ${applicability})`);
          return null;
        }
        
        // Get enhancement
        const enhancement = await provider.getEnhancement(context);
        
        if (enhancement && 
            enhancement.confidence >= this.config.minConfidenceThreshold &&
            enhancement.cryptoApplicability >= this.config.minApplicabilityThreshold) {
          
          // Cache the enhancement
          this.cacheEnhancement(cacheKey, enhancement, context);
          
          // Emit telemetry
          this.telemetryBus.emit('knowledge_provider_queried', {
            timestamp: Date.now(),
            providerId: provider.id,
            context: {
              symbol: context.symbol,
              regime: context.regime,
              timeframe: context.timeframe
            },
            enhancement: {
              id: enhancement.id,
              confidence: enhancement.confidence,
              applicability: enhancement.cryptoApplicability
            }
          });
          
          return enhancement;
        }
        
        return null;
      } catch (error) {
        logger.error(`Error querying provider ${provider.id}:`, error);
        return null;
      }
    });
    
    // Wait for all queries to complete
    const results = await Promise.all(queryPromises);
    
    // Filter out null results
    for (const enhancement of results) {
      if (enhancement) {
        enhancements.push(enhancement);
      }
    }
    
    if (enhancements.length === 0) {
      logger.debug('No applicable knowledge enhancements found');
      return null;
    }
    
    // Aggregate enhancements
    const aggregated = this.aggregateEnhancements(enhancements);
    
    // Emit telemetry
    this.telemetryBus.emit('knowledge_aggregated', {
      timestamp: Date.now(),
      context: {
        symbol: context.symbol,
        regime: context.regime,
        timeframe: context.timeframe
      },
      enhancementCount: enhancements.length,
      contributingSources: aggregated.contributingSources,
      aggregatedConfidence: aggregated.aggregatedConfidence,
      latencyMs: Date.now() - startTime
    });
    
    return aggregated;
  }
  
  /**
   * Apply knowledge to enhance a signal
   */
  public async enhanceSignal(signal: Signal, knowledge: AggregatedKnowledge): Promise<Signal> {
    const enhancedSignal = { ...signal };
    
    // Apply confidence adjustment
    if (knowledge.aggregatedConfidence > 0) {
      const confidenceBoost = knowledge.aggregatedConfidence * 0.1; // Max 10% boost
      enhancedSignal.confidence = Math.min(1, (enhancedSignal.confidence || 0.5) + confidenceBoost);
    }
    
    // Apply risk adjustments if available
    const riskAdjustments = knowledge.enhancements
      .map(e => e.riskAdjustments)
      .filter(r => r !== undefined);
    
    if (riskAdjustments.length > 0) {
      // Average the risk adjustments
      const avgConfidenceMultiplier = riskAdjustments
        .map(r => r?.confidenceMultiplier || 1)
        .reduce((sum, val) => sum + val, 0) / riskAdjustments.length;
      
      enhancedSignal.confidence = (enhancedSignal.confidence || 0.5) * avgConfidenceMultiplier;
    }
    
    // Add knowledge metadata
    enhancedSignal.metadata = {
      ...enhancedSignal.metadata,
      knowledgeEnhanced: true,
      knowledgeSources: knowledge.contributingSources,
      knowledgeConfidence: knowledge.aggregatedConfidence
    };
    
    // Emit telemetry
    this.telemetryBus.emit('signal_knowledge_enhanced', {
      timestamp: Date.now(),
      signalId: enhancedSignal.id,
      originalConfidence: signal.confidence,
      enhancedConfidence: enhancedSignal.confidence,
      knowledgeSources: knowledge.contributingSources
    });
    
    return enhancedSignal;
  }
  
  /**
   * Provide feedback on knowledge application
   */
  public async provideFeedback(
    signalId: string,
    enhancementIds: string[],
    performanceDelta: number
  ): Promise<void> {
    const wasUseful = performanceDelta > 0;
    
    // Send feedback to each provider
    for (const [providerId, provider] of this.providers) {
      const providerEnhancements = enhancementIds.filter(id => id.startsWith(providerId));
      
      if (providerEnhancements.length > 0) {
        for (const enhancementId of providerEnhancements) {
          const feedback: KnowledgeFeedback = {
            knowledgeId: enhancementId,
            wasUseful,
            performanceDelta,
            signalId,
            timestamp: Date.now()
          };
          
          try {
            await provider.provideFeedback(feedback);
          } catch (error) {
            logger.error(`Error providing feedback to provider ${providerId}:`, error);
          }
        }
      }
    }
    
    // Evaluate provider performance if adaptive mode is enabled
    if (this.config.enableAdaptiveProviders) {
      this.evaluateProviderPerformance();
    }
  }
  
  /**
   * Get statistics for all providers
   */
  public getProviderStats(): Map<string, KnowledgeProviderStats> {
    const stats = new Map<string, KnowledgeProviderStats>();
    
    for (const [id, provider] of this.providers) {
      stats.set(id, provider.getStats());
    }
    
    return stats;
  }
  
  /**
   * Aggregate multiple enhancements into a single result
   */
  private aggregateEnhancements(enhancements: KnowledgeEnhancement[]): AggregatedKnowledge {
    const mergedFeatures: Record<string, number> = {};
    const parameterHints: Partial<StrategyParameters> = {};
    const regimeHints: Partial<Record<MarketRegime, number>> = {};
    const contributingSources = new Set<string>();
    
    let totalConfidence = 0;
    let totalWeight = 0;
    
    // Merge features with weighted average based on confidence
    for (const enhancement of enhancements) {
      const weight = enhancement.confidence * enhancement.cryptoApplicability;
      totalWeight += weight;
      totalConfidence += enhancement.confidence;
      contributingSources.add(enhancement.source);
      
      // Merge features
      if (enhancement.features) {
        for (const [key, value] of Object.entries(enhancement.features)) {
          if (!mergedFeatures[key]) {
            mergedFeatures[key] = 0;
          }
          mergedFeatures[key] += value * weight;
        }
      }
      
      // Merge parameter hints (take highest confidence)
      if (enhancement.parameterHints) {
        for (const [key, value] of Object.entries(enhancement.parameterHints)) {
          if (!parameterHints[key] || enhancement.confidence > totalConfidence / enhancements.length) {
            parameterHints[key as keyof StrategyParameters] = value;
          }
        }
      }
      
      // Merge regime hints
      if (enhancement.regimeHints) {
        for (const [regime, score] of Object.entries(enhancement.regimeHints)) {
          const regimeKey = regime as MarketRegime;
          if (!regimeHints[regimeKey]) {
            regimeHints[regimeKey] = 0;
          }
          regimeHints[regimeKey]! += score * weight;
        }
      }
    }
    
    // Normalize weighted features
    if (totalWeight > 0) {
      for (const key in mergedFeatures) {
        mergedFeatures[key] /= totalWeight;
      }
      
      for (const regime in regimeHints) {
        regimeHints[regime as MarketRegime]! /= totalWeight;
      }
    }
    
    return {
      enhancements,
      mergedFeatures,
      parameterHints,
      regimeHints,
      aggregatedConfidence: enhancements.length > 0 ? totalConfidence / enhancements.length : 0,
      contributingSources: Array.from(contributingSources)
    };
  }
  
  /**
   * Create cache key from context
   */
  private getCacheKey(context: KnowledgeContext): string {
    return `${context.symbol}_${context.regime}_${context.timeframe}_${context.assets.join(',')}`;
  }
  
  /**
   * Check cache for enhancement
   */
  private checkCache(key: string): CachedKnowledge | null {
    const cached = this.knowledgeCache.get(key);
    
    if (!cached) {
      return null;
    }
    
    // Check if cache is still valid
    const age = Date.now() - cached.cachedAt;
    if (age > this.config.knowledgeCacheDurationMs) {
      this.knowledgeCache.delete(key);
      return null;
    }
    
    // Check if enhancement has expired
    if (cached.enhancement.expiresAt && Date.now() > cached.enhancement.expiresAt) {
      this.knowledgeCache.delete(key);
      return null;
    }
    
    return cached;
  }
  
  /**
   * Cache an enhancement
   */
  private cacheEnhancement(key: string, enhancement: KnowledgeEnhancement, context: KnowledgeContext): void {
    this.knowledgeCache.set(key, {
      enhancement,
      context,
      cachedAt: Date.now()
    });
  }
  
  /**
   * Start cache cleanup interval
   */
  private startCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      const keysToDelete: string[] = [];
      
      for (const [key, cached] of this.knowledgeCache) {
        const age = now - cached.cachedAt;
        if (age > this.config.knowledgeCacheDurationMs ||
            (cached.enhancement.expiresAt && now > cached.enhancement.expiresAt)) {
          keysToDelete.push(key);
        }
      }
      
      for (const key of keysToDelete) {
        this.knowledgeCache.delete(key);
      }
      
      if (keysToDelete.length > 0) {
        logger.debug(`Cleaned ${keysToDelete.length} expired cache entries`);
      }
    }, 60000); // Clean every minute
  }
  
  /**
   * Evaluate provider performance and adjust accordingly
   */
  private evaluateProviderPerformance(): void {
    for (const [id, provider] of this.providers) {
      const stats = provider.getStats();
      
      // Only evaluate if we have enough data
      if (stats.totalQueries < this.config.minQueriesForEvaluation) {
        continue;
      }
      
      // Calculate performance score
      const applicabilityRate = stats.applicableQueries / stats.totalQueries;
      const usefulnessRate = stats.timesUsed > 0 ? stats.timesUseful / stats.timesUsed : 0;
      const performanceScore = applicabilityRate * usefulnessRate * (1 + stats.avgPerformanceGain);
      
      // Disable consistently poor performers
      if (performanceScore < 0.1 && provider.enabled) {
        logger.warn(`Disabling poor-performing provider ${id} (score: ${performanceScore.toFixed(3)})`);
        provider.enabled = false;
        
        this.telemetryBus.emit('knowledge_provider_disabled', {
          timestamp: Date.now(),
          providerId: id,
          reason: 'poor_performance',
          performanceScore,
          stats
        });
      }
      
      // Re-enable providers that might have improved
      if (performanceScore > 0.3 && !provider.enabled) {
        logger.info(`Re-enabling provider ${id} (score: ${performanceScore.toFixed(3)})`);
        provider.enabled = true;
        
        this.telemetryBus.emit('knowledge_provider_enabled', {
          timestamp: Date.now(),
          providerId: id,
          reason: 'performance_improved',
          performanceScore
        });
      }
    }
  }
  
  /**
   * Shutdown the aggregator
   */
  public async shutdown(): Promise<void> {
    logger.info('Shutting down KnowledgeAggregator');
    
    // Shutdown all providers
    const shutdownPromises = Array.from(this.providers.values()).map(provider =>
      provider.shutdown().catch(error => {
        logger.error(`Error shutting down provider ${provider.id}:`, error);
      })
    );
    
    await Promise.all(shutdownPromises);
    
    // Clear cache
    this.knowledgeCache.clear();
    
    this.isInitialized = false;
    
    logger.info('KnowledgeAggregator shutdown complete');
  }
} 