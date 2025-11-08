/**
 * Venue Registry and ExecutionVenue interfaces
 * 
 * Provides abstractions for managing execution venues and routing orders.
 */

import { OrderIntent, ExecutedOrder, ExecutionStyle } from '../../types/execution.types.js';

/**
 * Configuration for an execution venue
 */
export interface VenueConfig {
  // Unique venue identifier
  id: string;
  
  // Display name for the venue
  name: string;
  
  // Type of venue
  type: 'cex' | 'dex' | 'otc' | 'broker' | 'simulator';
  
  // Base URL for API
  apiUrl: string;
  
  // API key
  apiKey?: string;
  
  // API secret
  apiSecret?: string;
  
  // Default timeout for requests in ms
  requestTimeoutMs: number;
  
  // Rate limit in requests per second
  rateLimit: number;
  
  // Supported assets
  supportedAssets: string[];
  
  // Default fees in basis points
  feeBps: number;
  
  // Whether venue supports margin trading
  supportsMargin: boolean;
  
  // Whether venue is enabled
  enabled: boolean;
  
  // Additional venue-specific settings
  settings?: Record<string, any>;
}

/**
 * Interface for execution venues
 */
export interface ExecutionVenue {
  // Venue identifier
  readonly id: string;
  
  // Venue name
  readonly name: string;
  
  // Venue type
  readonly type: string;
  
  // Whether venue is currently enabled
  readonly enabled: boolean;
  
  // Get supported assets
  getSupportedAssets(): Promise<string[]>;
  
  // Check if an asset is supported
  isAssetSupported(asset: string): Promise<boolean>;
  
  // Check current venue health
  checkHealth(): Promise<boolean>;
  
  // Get current market data for an asset
  getMarketData(asset: string): Promise<any>;
  
  // Execute an order
  execute(order: OrderIntent, style?: ExecutionStyle): Promise<ExecutedOrder>;
  
  // Cancel an existing order
  cancelOrder(orderId: string): Promise<boolean>;
  
  // Get order status
  getOrderStatus(orderId: string): Promise<any>;
  
  // Enable the venue
  enable(): void;
  
  // Disable the venue
  disable(): void;
}

/**
 * Registry of available execution venues
 */
export class VenueRegistry {
  private venues: Map<string, ExecutionVenue> = new Map();
  
  /**
   * Register a new execution venue
   * @param venue Execution venue to register
   */
  register(venue: ExecutionVenue): void {
    this.venues.set(venue.id, venue);
  }
  
  /**
   * Get a venue by ID
   * @param id Venue ID
   * @returns Execution venue or undefined if not found
   */
  get(id: string): ExecutionVenue | undefined {
    return this.venues.get(id);
  }
  
  /**
   * Get all registered venues
   * @returns Array of all execution venues
   */
  getAll(): ExecutionVenue[] {
    return Array.from(this.venues.values());
  }
  
  /**
   * Get all enabled venues
   * @returns Array of enabled execution venues
   */
  getEnabled(): ExecutionVenue[] {
    return Array.from(this.venues.values()).filter(venue => venue.enabled);
  }
  
  /**
   * Find venues that support a specific asset
   * @param asset Asset to check support for
   * @returns Promise resolving to array of supporting venues
   */
  async findVenuesForAsset(asset: string): Promise<ExecutionVenue[]> {
    const enabledVenues = this.getEnabled();
    const results = await Promise.all(
      enabledVenues.map(async venue => {
        try {
          const supported = await venue.isAssetSupported(asset);
          return supported ? venue : null;
        } catch (error) {
          console.error(`Error checking if ${asset} is supported on ${venue.name}:`, error);
          return null;
        }
      })
    );
    return results.filter((venue): venue is ExecutionVenue => venue !== null);
  }
  
  /**
   * Remove a venue from the registry
   * @param id Venue ID to remove
   * @returns True if venue was removed, false otherwise
   */
  unregister(id: string): boolean {
    return this.venues.delete(id);
  }
  
  /**
   * Check health of all enabled venues
   * @returns Object mapping venue IDs to health status
   */
  async checkAllHealth(): Promise<Record<string, boolean>> {
    const enabledVenues = this.getEnabled();
    const results: Record<string, boolean> = {};
    
    await Promise.all(
      enabledVenues.map(async venue => {
        try {
          results[venue.id] = await venue.checkHealth();
        } catch (error) {
          console.error(`Error checking health for ${venue.name}:`, error);
          results[venue.id] = false;
        }
      })
    );
    
    return results;
  }
} 