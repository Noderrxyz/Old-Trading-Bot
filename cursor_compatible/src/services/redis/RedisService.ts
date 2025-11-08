/**
 * Redis Service
 * 
 * Provides Redis functionality for caching and persistence.
 */

import { createClient } from 'redis';
import logger from '../../utils/logger.js';

/**
 * Redis service configuration
 */
export interface RedisServiceConfig {
  url: string;
  prefix: string;
  ttl: number; // Default TTL in seconds
}

/**
 * Default Redis service configuration
 */
export const DEFAULT_REDIS_SERVICE_CONFIG: RedisServiceConfig = {
  url: 'redis://localhost:6379',
  prefix: 'noderr:',
  ttl: 3600 // 1 hour
};

/**
 * Redis service for caching and persistence
 */
export class RedisService {
  private readonly config: RedisServiceConfig;
  private client: ReturnType<typeof createClient>;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => logger.debug(`[RedisService] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => logger.info(`[RedisService] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => logger.warn(`[RedisService] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => logger.error(`[RedisService] ${msg}`, ...args)
  };

  constructor(config: Partial<RedisServiceConfig> = {}) {
    this.config = { ...DEFAULT_REDIS_SERVICE_CONFIG, ...config };
    this.client = createClient({ url: this.config.url });
    
    this.client.on('error', (err) => {
      this.logger.error('Redis client error', err);
    });
    
    this.client.on('connect', () => {
      this.logger.info('Redis client connected');
    });
  }

  /**
   * Connect to Redis
   */
  public async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      this.logger.error('Failed to connect to Redis', error);
      throw error;
    }
  }

  /**
   * Disconnect from Redis
   */
  public async disconnect(): Promise<void> {
    try {
      await this.client.disconnect();
    } catch (error) {
      this.logger.error('Failed to disconnect from Redis', error);
      throw error;
    }
  }

  /**
   * Get prefixed key
   */
  private getKey(key: string): string {
    return `${this.config.prefix}${key}`;
  }

  /**
   * Set a value in Redis
   */
  public async set(key: string, value: string, ttl?: number): Promise<void> {
    try {
      const prefixedKey = this.getKey(key);
      await this.client.set(prefixedKey, value, {
        EX: ttl || this.config.ttl
      });
    } catch (error) {
      this.logger.error(`Failed to set key ${key}`, error);
      throw error;
    }
  }

  /**
   * Get a value from Redis
   */
  public async get(key: string): Promise<string | null> {
    try {
      const prefixedKey = this.getKey(key);
      return await this.client.get(prefixedKey);
    } catch (error) {
      this.logger.error(`Failed to get key ${key}`, error);
      throw error;
    }
  }

  /**
   * Delete a key from Redis
   */
  public async del(key: string): Promise<void> {
    try {
      const prefixedKey = this.getKey(key);
      await this.client.del(prefixedKey);
    } catch (error) {
      this.logger.error(`Failed to delete key ${key}`, error);
      throw error;
    }
  }

  /**
   * Check if a key exists in Redis
   */
  public async exists(key: string): Promise<boolean> {
    try {
      const prefixedKey = this.getKey(key);
      return await this.client.exists(prefixedKey) === 1;
    } catch (error) {
      this.logger.error(`Failed to check existence of key ${key}`, error);
      throw error;
    }
  }

  /**
   * Set TTL for a key
   */
  public async expire(key: string, ttl: number): Promise<void> {
    try {
      const prefixedKey = this.getKey(key);
      await this.client.expire(prefixedKey, ttl);
    } catch (error) {
      this.logger.error(`Failed to set TTL for key ${key}`, error);
      throw error;
    }
  }

  /**
   * Get TTL for a key
   */
  public async ttl(key: string): Promise<number> {
    try {
      const prefixedKey = this.getKey(key);
      return await this.client.ttl(prefixedKey);
    } catch (error) {
      this.logger.error(`Failed to get TTL for key ${key}`, error);
      throw error;
    }
  }
} 