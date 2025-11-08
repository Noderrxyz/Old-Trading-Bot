/**
 * Generic Redis client for Noderr infrastructure
 * 
 * Simple wrapper around ioredis for the Microstructure analyzer
 */

// Import Redis as a dynamic require to avoid typing issues
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Redis = require('ioredis');

export class RedisClient {
  private client: any;

  constructor(config: {
    host?: string;
    port?: number;
    password?: string;
    db?: number;
    url?: string;
  }) {
    // Connect using URL if provided, otherwise use host/port
    if (config.url) {
      this.client = new Redis(config.url);
    } else {
      this.client = new Redis({
        host: config.host || 'localhost',
        port: config.port || 6379,
        password: config.password,
        db: config.db || 0,
      });
    }

    // Set up error handler
    this.client.on('error', (err: Error) => {
      console.error('Redis Client Error:', err);
    });
  }

  /**
   * Get a value from Redis
   */
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  /**
   * Set a value in Redis with optional expiration
   */
  async set(key: string, value: string, ...args: any[]): Promise<string> {
    return this.client.set(key, value, ...args);
  }

  /**
   * Delete a key from Redis
   */
  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  /**
   * Get all field-value pairs from a hash
   */
  async hgetall(key: string): Promise<Record<string, string> | null> {
    const result = await this.client.hgetall(key);
    return Object.keys(result).length > 0 ? result : null;
  }

  /**
   * Set a field in a hash
   */
  async hset(key: string, field: string, value: string): Promise<number> {
    return this.client.hset(key, field, value);
  }

  /**
   * Get a field from a hash
   */
  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  /**
   * Add a member to a sorted set
   */
  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.client.zadd(key, score, member);
  }

  /**
   * Get members from a sorted set by score range (highest to lowest)
   */
  async zrevrange(key: string, start: number, stop: number, withScores?: string): Promise<string[]> {
    if (withScores === 'WITHSCORES') {
      return this.client.zrevrange(key, start, stop, 'WITHSCORES');
    }
    return this.client.zrevrange(key, start, stop);
  }

  /**
   * Get all keys matching a pattern
   */
  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  /**
   * Push an element to the head of a list
   */
  async lpush(key: string, value: string): Promise<number> {
    return this.client.lpush(key, value);
  }

  /**
   * Trim a list to a specified range
   */
  async ltrim(key: string, start: number, stop: number): Promise<string> {
    return this.client.ltrim(key, start, stop);
  }

  /**
   * Get a range of elements from a list
   */
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.lrange(key, start, stop);
  }

  /**
   * Close the Redis connection
   */
  async quit(): Promise<string> {
    return this.client.quit();
  }
} 