/**
 * Redis Service
 * 
 * Service for interacting with Redis data store
 */

// Using dynamic import approach to avoid constructor issues
import type { Redis } from 'ioredis';
// The actual Redis constructor will be imported dynamically at runtime

export class RedisService {
  private client: Redis;

  constructor(url: string = process.env.REDIS_URL || 'redis://localhost:6379') {
    // Dynamically import and instantiate Redis to avoid TypeScript constructor issues
    // This is a workaround for the "This expression is not constructable" error
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Redis = require('ioredis');
    this.client = new Redis(url);
  }

  /**
   * Set a key value in Redis
   */
  async set(key: string, value: string, ...args: any[]): Promise<void> {
    await this.client.set(key, value, ...args);
  }

  /**
   * Get a value by key
   */
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  /**
   * Delete a key
   */
  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Set a key with expiration
   */
  async setex(key: string, seconds: number, value: string): Promise<void> {
    await this.client.setex(key, seconds, value);
  }

  /**
   * Set expiration on a key
   */
  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds);
  }

  /**
   * Get the time-to-live for a key in seconds
   * @param key The key to get the TTL for
   * @returns TTL in seconds (or -1 if key exists but has no TTL, -2 if key does not exist)
   */
  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /**
   * Set hash field
   */
  async hset(key: string, field: string, value: string): Promise<void> {
    await this.client.hset(key, field, value);
  }

  /**
   * Delete hash fields
   * @param key Hash key
   * @param fields One or more fields to delete
   */
  async hdel(key: string, ...fields: string[]): Promise<void> {
    await this.client.hdel(key, ...fields);
  }

  /**
   * Get hash field
   */
  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  /**
   * Get all hash fields and values
   */
  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  /**
   * Increment a key's value
   * @param key The key to increment
   * @returns The new value after increment
   */
  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  /**
   * Find keys matching a pattern
   * @param pattern Pattern to match (e.g., user:*, session:*)
   * @returns Array of matching key names
   */
  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  /**
   * Add one or multiple values to the head of a list
   * @param key The list key
   * @param values Values to add to the list
   */
  async lpush(key: string, ...values: string[]): Promise<void> {
    await this.client.lpush(key, ...values);
  }

  /**
   * Trim a list to the specified range
   * @param key The list key
   * @param start Start index
   * @param stop End index
   */
  async ltrim(key: string, start: number, stop: number): Promise<void> {
    await this.client.ltrim(key, start, stop);
  }

  /**
   * Get a range of elements from a list
   * @param key The list key
   * @param start Start index
   * @param stop End index
   * @returns Array of elements in the specified range
   */
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.lrange(key, start, stop);
  }

  /**
   * Add members to a set
   * @param key The set key
   * @param members Members to add to the set
   * @returns Number of members added to the set
   */
  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.client.sadd(key, ...members);
  }

  /**
   * Remove members from a set
   * @param key The set key
   * @param members Members to remove from the set
   * @returns Number of members removed from the set
   */
  async srem(key: string, ...members: string[]): Promise<number> {
    return this.client.srem(key, ...members);
  }

  /**
   * Get all members of a set
   * @param key The set key
   * @returns Array of set members
   */
  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  /**
   * Publish a message to a channel
   * @param channel The channel to publish to
   * @param message The message to publish
   * @returns Number of clients that received the message
   */
  async publish(channel: string, message: string): Promise<number> {
    return this.client.publish(channel, message);
  }

  /**
   * Close the Redis connection
   */
  async close(): Promise<void> {
    await this.client.quit();
  }
} 