/**
 * In-memory TTL cache implementation for alpha signals
 */
export class MemoryCache<T> {
  private cache: Map<string, { value: T; expiresAt: number }> = new Map();
  private readonly maxSize: number;
  private readonly checkExpirationOnAccess: boolean;

  /**
   * Create a new memory cache
   * @param maxSize Maximum number of entries to keep in the cache
   * @param checkExpirationOnAccess Whether to check for expired entries on each access
   */
  constructor(maxSize = 1000, checkExpirationOnAccess = true) {
    this.maxSize = maxSize;
    this.checkExpirationOnAccess = checkExpirationOnAccess;
  }

  /**
   * Set a value in the cache with a TTL
   * @param key Cache key
   * @param value Value to cache
   * @param ttlMs Time to live in milliseconds
   */
  set(key: string, value: T, ttlMs: number): void {
    // Ensure the cache doesn't exceed max size by removing oldest entries if needed
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictOldest();
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  /**
   * Get a value from the cache
   * @param key Cache key
   * @returns Value or null if not found or expired
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }
    
    // Check if entry has expired
    if (this.checkExpirationOnAccess && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.value;
  }

  /**
   * Delete a key from the cache
   * @param key Cache key
   * @returns Whether the key was deleted
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Check if a key exists in the cache (and is not expired)
   * @param key Cache key
   * @returns Whether the key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return false;
    }
    
    // Check if entry has expired
    if (this.checkExpirationOnAccess && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  /**
   * Get all keys in the cache
   * @returns Array of keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get all values in the cache
   * @returns Array of values
   */
  values(): T[] {
    const result: T[] = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if (!this.checkExpirationOnAccess || Date.now() <= entry.expiresAt) {
        result.push(entry.value);
      } else {
        this.cache.delete(key);
      }
    }
    
    return result;
  }

  /**
   * Get all entries that match a filter function
   * @param filter Filter function
   * @returns Array of values that match the filter
   */
  filter(filter: (value: T, key: string) => boolean): T[] {
    const result: T[] = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if (this.checkExpirationOnAccess && Date.now() > entry.expiresAt) {
        this.cache.delete(key);
        continue;
      }
      
      if (filter(entry.value, key)) {
        result.push(entry.value);
      }
    }
    
    return result;
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the number of entries in the cache
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Purge expired entries from the cache
   * @returns Number of entries purged
   */
  purgeExpired(): number {
    let purgedCount = 0;
    const now = Date.now();
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        purgedCount++;
      }
    }
    
    return purgedCount;
  }

  /**
   * Evict the oldest entry from the cache
   * @returns Whether an entry was evicted
   */
  private evictOldest(): boolean {
    if (this.cache.size === 0) {
      return false;
    }
    
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < oldestTime) {
        oldestTime = entry.expiresAt;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      return this.cache.delete(oldestKey);
    }
    
    return false;
  }
} 