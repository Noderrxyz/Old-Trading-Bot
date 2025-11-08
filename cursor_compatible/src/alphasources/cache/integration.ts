/**
 * Alpha Cache Integration Guide
 * 
 * This file shows how to integrate the Alpha Cache Manager with the Alpha Orchestration system.
 * It demonstrates how to use the cache to prevent redundant processing and implement temporal 
 * decay of signals.
 */

import { AlphaHub } from '../alpha-hub.js';
import { FusedAlphaFrame } from '../fusion-engine.js';
import { AlphaCacheManager, AlphaCacheConfig } from './index.js';
import { createLogger } from '../../common/logger.js';
import { RedisClient } from '../../infra/core/RedisClient.js';
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

// Logger
const logger = createLogger('AlphaCacheIntegration');

/**
 * Load Alpha Cache configuration from YAML file
 * @param configPath Path to the configuration file
 * @returns Alpha Cache configuration
 */
export function loadAlphaCacheConfig(configPath = '../../config/alpha-cache.yaml'): AlphaCacheConfig {
  try {
    const configFile = path.resolve(__dirname, configPath);
    
    if (!fs.existsSync(configFile)) {
      logger.warn(`Alpha cache config file not found: ${configFile}`);
      return {} as AlphaCacheConfig;
    }
    
    const configYaml = fs.readFileSync(configFile, 'utf8');
    const config = yaml.load(configYaml) as AlphaCacheConfig;
    
    logger.info('Loaded Alpha Cache configuration');
    return config;
  } catch (error) {
    logger.error(`Failed to load Alpha Cache config: ${error instanceof Error ? error.message : String(error)}`);
    return {} as AlphaCacheConfig;
  }
}

/**
 * Integrate Alpha Cache with Alpha Hub
 * 
 * This class extends AlphaHub functionality with temporal caching capabilities.
 */
export class CachedAlphaHub {
  private readonly alphaHub: AlphaHub;
  private readonly cacheManager: AlphaCacheManager;
  private readonly logger = createLogger('CachedAlphaHub');
  
  /**
   * Create a new cached Alpha Hub
   * @param alphaHub Existing Alpha Hub instance
   * @param cacheManager Alpha Cache Manager instance
   */
  constructor(alphaHub: AlphaHub, cacheManager: AlphaCacheManager) {
    this.alphaHub = alphaHub;
    this.cacheManager = cacheManager;
    
    this.logger.info('CachedAlphaHub initialized');
  }
  
  /**
   * Get fused signal for a specific symbol
   * @param symbol Asset symbol
   * @param useCachedSignals Whether to consider cached signals
   * @returns Fused signal with the highest confidence
   */
  public async getFusedSignal(symbol: string, useCachedSignals = true): Promise<FusedAlphaFrame | null> {
    // Get the latest fused signal from AlphaHub
    const latestSignal = this.alphaHub.getFusedSignal(symbol);
    
    if (!useCachedSignals) {
      return latestSignal;
    }
    
    try {
      // Get recent signals from cache (last 5 minutes)
      const cachedSignals = await this.cacheManager.getRecentSignals(symbol, 300);
      
      if (!cachedSignals.length) {
        // No cached signals, just return the latest and cache it
        if (latestSignal) {
          await this.cacheManager.addSignal(latestSignal);
        }
        return latestSignal;
      }
      
      // If we have a new signal, add it to the cache
      if (latestSignal) {
        const isNewSignal = !cachedSignals.some(s => 
          s.timestamp === latestSignal.timestamp && 
          s.confidence === latestSignal.confidence
        );
        
        if (isNewSignal) {
          await this.cacheManager.addSignal(latestSignal);
          cachedSignals.push(latestSignal);
        }
      }
      
      // Return the signal with the highest confidence (after decay)
      cachedSignals.sort((a, b) => b.confidence - a.confidence);
      
      const bestSignal = cachedSignals[0];
      const confidenceThreshold = this.cacheManager['config'].minConfidenceThreshold;
      
      if (bestSignal.confidence < confidenceThreshold) {
        this.logger.debug(`No signal with confidence above threshold (${confidenceThreshold}) for ${symbol}`);
        return null;
      }
      
      return bestSignal;
    } catch (error) {
      this.logger.error(`Error processing cached signals: ${error instanceof Error ? error.message : String(error)}`);
      return latestSignal;  // Fallback to latest signal
    }
  }
  
  /**
   * Get all cached fused signals for supported assets
   * @param confidenceThreshold Minimum confidence threshold (override config)
   * @returns Map of symbol to fused signal
   */
  public async getAllCachedSignals(confidenceThreshold?: number): Promise<Map<string, FusedAlphaFrame>> {
    const result = new Map<string, FusedAlphaFrame>();
    const symbols = this.alphaHub['config'].supportedAssets;
    
    for (const symbol of symbols) {
      const signal = await this.getFusedSignal(symbol, true);
      
      if (signal) {
        const minConfidence = confidenceThreshold ?? this.cacheManager['config'].minConfidenceThreshold;
        
        if (signal.confidence >= minConfidence) {
          result.set(symbol, signal);
        }
      }
    }
    
    return result;
  }
}

/**
 * Initialize Alpha Cache with Redis
 * @param redisOptions Redis connection options
 * @returns Alpha Cache Manager with Redis backend
 */
export async function initializeAlphaCache(
  redisOptions: {
    url?: string;
    host?: string;
    port?: number;
    password?: string;
    db?: number;
  } = {}
): Promise<AlphaCacheManager> {
  // Load config from YAML
  const config = loadAlphaCacheConfig();
  
  // Initialize Redis if using Redis backend
  let redisClient: RedisClient | undefined;
  
  if (config.cacheBackend === 'redis') {
    redisClient = new RedisClient({
      url: redisOptions.url,
      host: redisOptions.host || config.redis?.host,
      port: redisOptions.port || config.redis?.port,
      password: redisOptions.password || config.redis?.password,
      db: redisOptions.db || config.redis?.db
    });
    
    logger.info('Initialized Redis client for Alpha Cache');
  }
  
  // Create and return the cache manager
  const cacheManager = new AlphaCacheManager(config, redisClient);
  logger.info('Alpha Cache Manager initialized');
  
  return cacheManager;
}

/**
 * Example usage:
 * 
 * ```typescript
 * // Initialize
 * const alphaHub = getAlphaHub();
 * const cacheManager = await initializeAlphaCache();
 * const cachedHub = new CachedAlphaHub(alphaHub, cacheManager);
 * 
 * // Get alpha signal with caching and decay
 * const signal = await cachedHub.getFusedSignal('BTC/USDC');
 * 
 * // Process all signals with confidence above threshold
 * const allSignals = await cachedHub.getAllCachedSignals();
 * for (const [symbol, signal] of allSignals.entries()) {
 *   processSignal(signal);
 * }
 * ```
 */ 