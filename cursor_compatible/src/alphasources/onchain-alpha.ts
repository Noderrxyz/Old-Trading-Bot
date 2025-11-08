/**
 * Onchain Alpha Source
 * 
 * Fetches on-chain metrics like token liquidity, volume, and velocity
 * to generate alpha signals.
 */

import { BaseAlphaSource } from './base-alpha-source.js';
import { AlphaFrame, AlphaSourceConfig } from './types.js';

/**
 * Onchain-specific configuration
 */
export interface OnchainAlphaConfig extends AlphaSourceConfig {
  settings: {
    // RPC endpoints for different chains
    rpcEndpoints: Record<string, string>;
    
    // Metrics to track
    metrics: Array<'liquidity' | 'volume' | 'velocity' | 'netflow' | 'concentration'>;
    
    // Liquidity threshold for signal generation (USD)
    minLiquidityThresholdUsd: number;
    
    // Volume change threshold for signal generation (%)
    volumeChangeThresholdPct: number;
  };
}

/**
 * Alpha source for on-chain metrics
 */
export class OnchainAlphaSource extends BaseAlphaSource {
  private readonly supportedAssets: string[];
  
  /**
   * Create a new on-chain alpha source
   * @param config Source configuration
   * @param supportedAssets Supported asset pairs
   */
  constructor(
    config: OnchainAlphaConfig,
    supportedAssets: string[]
  ) {
    super('onchain', config);
    this.supportedAssets = supportedAssets;
  }
  
  /**
   * Get typed configuration
   */
  protected get onchainConfig(): OnchainAlphaConfig {
    return this.config as OnchainAlphaConfig;
  }
  
  /**
   * Initialize the source
   */
  async initialize(): Promise<void> {
    await super.initialize();
    
    // Validate RPC endpoints
    const { rpcEndpoints } = this.onchainConfig.settings;
    if (!rpcEndpoints || Object.keys(rpcEndpoints).length === 0) {
      throw new Error('No RPC endpoints configured for onchain alpha source');
    }
    
    // Initialize connections to blockchain nodes
    // This would connect to real nodes in production
    this.logger.info(`Initialized connections to ${Object.keys(rpcEndpoints).length} blockchain nodes`);
  }
  
  /**
   * Fetch onchain alpha signals
   * @returns Array of alpha frames
   */
  protected async fetchAlpha(): Promise<AlphaFrame[]> {
    const frames: AlphaFrame[] = [];
    const now = Math.floor(Date.now() / 1000);
    
    // Process each supported asset
    for (const symbol of this.supportedAssets) {
      try {
        // Extract token from symbol (e.g., "ETH" from "ETH/USDC")
        const token = symbol.split('/')[0];
        
        // Mock data - in a real implementation, this would fetch from the blockchain
        const mockData = this.getMockOnchainData(token);
        
        // Calculate signal score from metrics
        const score = this.calculateSignalScore(mockData);
        
        frames.push({
          source: this.name,
          symbol,
          timestamp: now,
          score,
          details: {
            ...mockData,
            token
          }
        });
      } catch (error) {
        this.logger.error(`Error processing onchain data for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    return frames;
  }
  
  /**
   * Calculate signal score from onchain metrics
   * @param data Onchain metrics
   * @returns Signal score (0-1)
   */
  private calculateSignalScore(data: Record<string, any>): number {
    // Extract metrics
    const { liquidityUsd, volumeChangePercent, velocity, netflow, whaleConcentration } = data;
    
    // Check against thresholds
    const { minLiquidityThresholdUsd, volumeChangeThresholdPct } = this.onchainConfig.settings;
    
    // Return 0 score if liquidity is too low
    if (liquidityUsd < minLiquidityThresholdUsd) {
      return 0;
    }
    
    // Base signal on volume change
    let score = 0.5; // Neutral starting point
    
    // Adjust based on volume change - strong volume signals confidence
    if (Math.abs(volumeChangePercent) > volumeChangeThresholdPct) {
      // Direction of signal based on net flow
      const direction = netflow > 0 ? 1 : -1;
      
      // Magnitude based on volume change
      const magnitude = Math.min(1, Math.abs(volumeChangePercent) / 100);
      
      // Confidence based on velocity and concentration
      const confidence = 0.4 + (velocity * 0.3) + ((1 - whaleConcentration) * 0.3);
      
      // Calculate final score (0.5 is neutral, 0 is strong sell, 1 is strong buy)
      score = 0.5 + (direction * magnitude * confidence * 0.5);
    }
    
    // Ensure score is between 0 and 1
    return Math.max(0, Math.min(1, score));
  }
  
  /**
   * Get mock onchain data for testing
   * In a real implementation, this would fetch from the blockchain
   * @param token Token symbol
   * @returns Mock onchain metrics
   */
  private getMockOnchainData(token: string): Record<string, any> {
    // Generate pseudo-random numbers based on token name for consistency
    const seed = [...token].reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const rand = (min: number, max: number) => {
      const x = Math.sin(seed + frames.length) * 10000;
      return min + (x - Math.floor(x)) * (max - min);
    };
    
    // Number of frames generated so far
    const frames = this.cache;
    
    // Generate mock metrics with some randomness
    return {
      liquidityUsd: token === 'ETH' ? 
        rand(1000000, 5000000) : 
        rand(100000, 1000000),
      volumeChangePercent: rand(-30, 30),
      velocity: rand(0, 1),
      netflow: rand(-100000, 100000),
      whaleConcentration: rand(0.1, 0.9),
      blockHeight: 1000000 + frames.length,
      dexVolume: token === 'ETH' ? 
        rand(50000000, 100000000) : 
        rand(1000000, 10000000),
      activeAddresses: token === 'ETH' ? 
        Math.floor(rand(5000, 10000)) : 
        Math.floor(rand(1000, 5000)),
      gasUsed: Math.floor(rand(1000000, 5000000)),
      tokenTransfers: Math.floor(rand(1000, 5000))
    };
  }
  
  /**
   * Check if source requires credentials
   * @returns True if credentials required
   */
  protected requiresCredentials(): boolean {
    // We might need API keys for some onchain data providers
    return false;
  }
} 