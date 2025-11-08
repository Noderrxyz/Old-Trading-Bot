/**
 * Configuration for the Alpha Cache Manager
 */
export interface AlphaCacheConfig {
  /** Whether the cache is enabled */
  enabled: boolean;
  
  /** The backend to use for caching (redis or memory) */
  cacheBackend: 'redis' | 'memory';
  
  /** Time to live in seconds for cached signals */
  ttlSeconds: number;
  
  /** Type of confidence decay to apply to cached signals */
  decayType: 'linear' | 'exponential' | 'none';
  
  /** Minimum confidence threshold below which signals are considered expired */
  minConfidenceThreshold: number;
  
  /** Decay factor to apply per second for confidence values */
  decayFactorPerSec: number;
  
  /** Redis connection options (if using redis backend) */
  redis?: {
    /** Redis connection URL */
    url?: string;
    
    /** Redis host */
    host?: string;
    
    /** Redis port */
    port?: number;
    
    /** Redis password */
    password?: string;
    
    /** Redis database index */
    db?: number;
    
    /** Key prefix for Redis keys */
    keyPrefix?: string;
  };
  
  /** Memory cache options (if using memory backend) */
  memory?: {
    /** Maximum number of entries to keep in the memory cache */
    maxSize?: number;
    
    /** Whether to check for expired entries on each access */
    checkExpirationOnAccess?: boolean;
  };
}

/**
 * Default configuration for the Alpha Cache Manager
 */
export const DEFAULT_ALPHA_CACHE_CONFIG: AlphaCacheConfig = {
  enabled: true,
  cacheBackend: 'memory',
  ttlSeconds: 300, // 5 minutes
  decayType: 'exponential',
  minConfidenceThreshold: 0.2,
  decayFactorPerSec: 0.01,
  memory: {
    maxSize: 1000,
    checkExpirationOnAccess: true
  },
  redis: {
    host: 'localhost',
    port: 6379,
    keyPrefix: 'noderr:alpha:cache:'
  }
}; 