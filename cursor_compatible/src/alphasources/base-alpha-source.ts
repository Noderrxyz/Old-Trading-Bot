/**
 * Base Alpha Source
 * 
 * Abstract base class for alpha sources that provides common functionality
 * and enforces consistent interface across all alpha sources.
 */

import { AlphaFrame, AlphaSourceConfig, AlphaSourceError } from './types.js';
import { createLogger } from '../common/logger.js';

/**
 * Interface for alpha sources
 */
export interface AlphaSource {
  /** Get alpha frames from this source */
  getAlpha(): Promise<AlphaFrame[]>;
  
  /** Initialize the alpha source */
  initialize(): Promise<void>;
  
  /** Get the name of this alpha source */
  getName(): string;
  
  /** Get the unique identifier for this source */
  getId(): string;
  
  /** Check if this source is enabled */
  isEnabled(): boolean;
}

/**
 * Abstract base class for all alpha sources
 */
export abstract class BaseAlphaSource implements AlphaSource {
  protected readonly logger;
  protected lastUpdate: number = 0;
  protected cache: AlphaFrame[] = [];
  
  /**
   * Create a new alpha source
   * @param name Source name
   * @param config Source configuration
   */
  constructor(
    protected readonly name: string,
    protected readonly config: AlphaSourceConfig
  ) {
    this.logger = createLogger(`AlphaSource:${name}`);
  }
  
  /**
   * Get the source name
   * @returns Source name
   */
  getName(): string {
    return this.name;
  }
  
  /**
   * Get the source ID (defaults to the same as name)
   * @returns Source identifier
   */
  getId(): string {
    return this.name;
  }
  
  /**
   * Check if source is enabled
   * @returns Whether source is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
  
  /**
   * Initialize the alpha source
   * Override in subclasses if needed
   */
  async initialize(): Promise<void> {
    this.logger.info(`Initializing alpha source: ${this.name}`);
    
    // Validate credentials if needed
    if (this.requiresCredentials() && !this.config.credentials) {
      throw new AlphaSourceError(this.name, 'Missing required credentials');
    }
    
    this.logger.info(`Alpha source ${this.name} initialized successfully`);
  }
  
  /**
   * Get alpha signals from the source
   * @returns Array of alpha frames
   */
  async getAlpha(): Promise<AlphaFrame[]> {
    if (!this.isEnabled()) {
      return [];
    }
    
    try {
      const now = Date.now();
      
      // Check if cache is still valid
      if (
        this.cache.length > 0 && 
        now - this.lastUpdate < this.config.refreshIntervalMs
      ) {
        return this.cache;
      }
      
      // Fetch new data
      this.logger.debug(`Fetching fresh data for ${this.name}`);
      const frames = await this.fetchAlpha();
      
      // Update cache
      this.cache = frames;
      this.lastUpdate = now;
      
      this.logger.debug(`Fetched ${frames.length} alpha frames from ${this.name}`);
      return frames;
    } catch (error) {
      this.logger.error(`Error fetching alpha from ${this.name}: ${error instanceof Error ? error.message : String(error)}`);
      
      // If cache exists, return it with a warning
      if (this.cache.length > 0) {
        this.logger.warn(`Returning cached data for ${this.name} due to fetch error`);
        return this.cache;
      }
      
      throw new AlphaSourceError(
        this.name,
        'Failed to fetch alpha data',
        error instanceof Error ? error : undefined
      );
    }
  }
  
  /**
   * Check if the source requires API credentials
   * Override in subclasses
   * @returns Whether credentials are required
   */
  protected requiresCredentials(): boolean {
    return false;
  }
  
  /**
   * Fetch alpha data from the source
   * To be implemented in subclasses
   * @returns Array of alpha frames
   */
  protected abstract fetchAlpha(): Promise<AlphaFrame[]>;
} 