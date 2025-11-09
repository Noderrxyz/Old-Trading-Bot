/**
 * Cache Manager
 * 
 * Provides intelligent caching for adapter positions and APY data to reduce
 * redundant RPC calls and improve performance.
 * 
 * @module performance/CacheManager
 */

/**
 * Cache entry with expiration
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  defaultTTL?: number; // Default TTL in milliseconds
  maxSize?: number; // Maximum number of entries
  cleanupInterval?: number; // Cleanup interval in milliseconds
}

/**
 * Cache Manager
 * 
 * Provides caching with TTL, automatic cleanup, and statistics.
 */
export class CacheManager<T = any> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private hits: number = 0;
  private misses: number = 0;
  private defaultTTL: number;
  private maxSize: number;
  private cleanupInterval: number;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: CacheConfig = {}) {
    this.defaultTTL = config.defaultTTL || 60000; // 1 minute default
    this.maxSize = config.maxSize || 1000;
    this.cleanupInterval = config.cleanupInterval || 300000; // 5 minutes default

    // Start automatic cleanup
    this.startCleanup();
  }

  /**
   * Get a value from the cache
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    this.hits++;
    return entry.data;
  }

  /**
   * Set a value in the cache
   */
  set(key: string, value: T, ttl?: number): void {
    // Check size limit
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      // Evict oldest entry
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      data: value,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
    });
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Delete a value from the cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all values from the cache
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get or set a value (with lazy loading)
   */
  async getOrSet(key: string, factory: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await factory();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Invalidate entries matching a pattern
   */
  invalidatePattern(pattern: string | RegExp): number {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    let count = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }

    return count;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Clean up expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let count = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        count++;
      }
    }

    return count;
  }

  /**
   * Start automatic cleanup
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }

  /**
   * Stop automatic cleanup
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Get the size of the cache
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }
}

/**
 * Position Cache Manager
 * 
 * Specialized cache manager for adapter positions with debouncing.
 */
export class PositionCacheManager {
  private cache: CacheManager<any>;
  private pendingUpdates: Map<string, NodeJS.Timeout> = new Map();
  private debounceDelay: number;

  constructor(config: CacheConfig = {}, debounceDelay = 5000) {
    this.cache = new CacheManager(config);
    this.debounceDelay = debounceDelay;
  }

  /**
   * Get a cached position
   */
  getPosition(adapterId: string): any | undefined {
    return this.cache.get(`position:${adapterId}`);
  }

  /**
   * Set a position with debouncing
   */
  setPosition(adapterId: string, position: any, ttl?: number): void {
    const key = `position:${adapterId}`;

    // Clear existing pending update
    const pending = this.pendingUpdates.get(key);
    if (pending) {
      clearTimeout(pending);
    }

    // Debounce the update
    const timer = setTimeout(() => {
      this.cache.set(key, position, ttl);
      this.pendingUpdates.delete(key);
    }, this.debounceDelay);

    this.pendingUpdates.set(key, timer);
  }

  /**
   * Force immediate position update (bypass debouncing)
   */
  setPositionImmediate(adapterId: string, position: any, ttl?: number): void {
    const key = `position:${adapterId}`;

    // Clear pending update
    const pending = this.pendingUpdates.get(key);
    if (pending) {
      clearTimeout(pending);
      this.pendingUpdates.delete(key);
    }

    this.cache.set(key, position, ttl);
  }

  /**
   * Invalidate position cache for an adapter
   */
  invalidatePosition(adapterId: string): void {
    this.cache.delete(`position:${adapterId}`);
  }

  /**
   * Invalidate all positions
   */
  invalidateAllPositions(): void {
    this.cache.invalidatePattern(/^position:/);
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return this.cache.getStats();
  }

  /**
   * Clear all caches
   */
  clear(): void {
    // Clear pending updates
    for (const timer of this.pendingUpdates.values()) {
      clearTimeout(timer);
    }
    this.pendingUpdates.clear();

    // Clear cache
    this.cache.clear();
  }

  /**
   * Stop all timers
   */
  stop(): void {
    this.cache.stopCleanup();
    for (const timer of this.pendingUpdates.values()) {
      clearTimeout(timer);
    }
    this.pendingUpdates.clear();
  }
}

/**
 * APY Cache Manager
 * 
 * Specialized cache manager for APY data with longer TTL.
 */
export class APYCacheManager {
  private cache: CacheManager<number>;

  constructor(config: CacheConfig = {}) {
    // Default TTL for APY is 5 minutes (APY changes slowly)
    this.cache = new CacheManager<number>({
      ...config,
      defaultTTL: config.defaultTTL || 300000,
    });
  }

  /**
   * Get cached APY
   */
  getAPY(adapterId: string): number | undefined {
    return this.cache.get(`apy:${adapterId}`);
  }

  /**
   * Set APY
   */
  setAPY(adapterId: string, apy: number, ttl?: number): void {
    this.cache.set(`apy:${adapterId}`, apy, ttl);
  }

  /**
   * Invalidate APY cache for an adapter
   */
  invalidateAPY(adapterId: string): void {
    this.cache.delete(`apy:${adapterId}`);
  }

  /**
   * Invalidate all APY caches
   */
  invalidateAllAPY(): void {
    this.cache.invalidatePattern(/^apy:/);
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return this.cache.getStats();
  }

  /**
   * Clear all caches
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Stop cleanup timer
   */
  stop(): void {
    this.cache.stopCleanup();
  }
}

/**
 * Multi-Level Cache Manager
 * 
 * Combines position and APY caching with unified interface.
 */
export class MultiLevelCacheManager {
  public positions: PositionCacheManager;
  public apy: APYCacheManager;

  constructor(
    positionConfig: CacheConfig = {},
    apyConfig: CacheConfig = {},
    debounceDelay = 5000
  ) {
    this.positions = new PositionCacheManager(positionConfig, debounceDelay);
    this.apy = new APYCacheManager(apyConfig);
  }

  /**
   * Get combined statistics
   */
  getStats(): { positions: CacheStats; apy: CacheStats } {
    return {
      positions: this.positions.getStats(),
      apy: this.apy.getStats(),
    };
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.positions.clear();
    this.apy.clear();
  }

  /**
   * Stop all timers
   */
  stop(): void {
    this.positions.stop();
    this.apy.stop();
  }
}
