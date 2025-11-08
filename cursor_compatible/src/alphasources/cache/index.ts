/**
 * Alpha Cache Module
 * 
 * Exports the Alpha Cache Manager and related types for
 * temporal caching of alpha signals with configurable decay.
 */

export * from './alpha-cache-config.js';
export * from './alpha-cache-manager.js';
export * from './memory-cache.js';

import { AlphaCacheManager } from './alpha-cache-manager.js';
import { AlphaCacheConfig } from './alpha-cache-config.js';
import { RedisClient } from '../../infra/core/RedisClient.js';

/**
 * Singleton instance of the AlphaCacheManager
 */
let alphaCacheManagerInstance: AlphaCacheManager | null = null;

/**
 * Get the singleton instance of the AlphaCacheManager
 * @param config Optional configuration for the cache manager
 * @param redisClient Optional Redis client to use
 * @returns Alpha Cache Manager instance
 */
export function getAlphaCacheManager(
  config?: Partial<AlphaCacheConfig>,
  redisClient?: RedisClient
): AlphaCacheManager {
  if (!alphaCacheManagerInstance) {
    alphaCacheManagerInstance = new AlphaCacheManager(config, redisClient);
  }
  
  return alphaCacheManagerInstance;
} 