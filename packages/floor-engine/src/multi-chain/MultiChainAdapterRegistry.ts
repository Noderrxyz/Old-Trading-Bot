/**
 * Multi-Chain Adapter Registry
 * 
 * Manages adapter instances across multiple blockchains, providing unified
 * access to protocol adapters regardless of which chain they're deployed on.
 * 
 * @module multi-chain/MultiChainAdapterRegistry
 */

import { ethers } from 'ethers';
import { ChainManager } from './ChainManager';
import type { AdapterMetadata, AdapterCategory } from '../types';

/**
 * Multi-chain adapter configuration
 */
export interface MultiChainAdapterConfig {
  adapterId: string;
  chainId: number;
  protocol: string;
  category: AdapterCategory;
  enabled: boolean;
  metadata: AdapterMetadata;
}

/**
 * Adapter instance with chain context
 */
export interface ChainAdapter {
  adapterId: string;
  chainId: number;
  instance: any; // Actual adapter instance
  config: MultiChainAdapterConfig;
  lastHealthCheck?: Date;
  healthy?: boolean;
}

/**
 * Cross-chain position aggregation
 */
export interface CrossChainPosition {
  protocol: string;
  category: AdapterCategory;
  positions: Map<number, any>; // chainId -> position
  totalValue: bigint;
  weightedAPY: number;
}

/**
 * Multi-Chain Adapter Registry
 * 
 * Manages protocol adapters across multiple blockchains.
 */
export class MultiChainAdapterRegistry {
  private chainManager: ChainManager;
  private adapters: Map<string, ChainAdapter> = new Map(); // adapterId -> adapter
  private adaptersByChain: Map<number, Set<string>> = new Map(); // chainId -> adapterIds
  private adaptersByProtocol: Map<string, Set<string>> = new Map(); // protocol -> adapterIds
  private adaptersByCategory: Map<AdapterCategory, Set<string>> = new Map(); // category -> adapterIds

  constructor(chainManager: ChainManager) {
    this.chainManager = chainManager;
  }

  /**
   * Register an adapter for a specific chain
   */
  registerAdapter(
    adapterId: string,
    chainId: number,
    instance: any,
    config: MultiChainAdapterConfig
  ): void {
    if (this.adapters.has(adapterId)) {
      throw new Error(`Adapter ${adapterId} already registered`);
    }

    if (!this.chainManager.isChainSupported(chainId)) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    const adapter: ChainAdapter = {
      adapterId,
      chainId,
      instance,
      config,
    };

    this.adapters.set(adapterId, adapter);

    // Index by chain
    if (!this.adaptersByChain.has(chainId)) {
      this.adaptersByChain.set(chainId, new Set());
    }
    this.adaptersByChain.get(chainId)!.add(adapterId);

    // Index by protocol
    if (!this.adaptersByProtocol.has(config.protocol)) {
      this.adaptersByProtocol.set(config.protocol, new Set());
    }
    this.adaptersByProtocol.get(config.protocol)!.add(adapterId);

    // Index by category
    if (!this.adaptersByCategory.has(config.category)) {
      this.adaptersByCategory.set(config.category, new Set());
    }
    this.adaptersByCategory.get(config.category)!.add(adapterId);
  }

  /**
   * Unregister an adapter
   */
  unregisterAdapter(adapterId: string): void {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) return;

    // Remove from indices
    this.adaptersByChain.get(adapter.chainId)?.delete(adapterId);
    this.adaptersByProtocol.get(adapter.config.protocol)?.delete(adapterId);
    this.adaptersByCategory.get(adapter.config.category)?.delete(adapterId);

    // Remove adapter
    this.adapters.delete(adapterId);
  }

  /**
   * Get adapter by ID
   */
  getAdapter(adapterId: string): ChainAdapter | undefined {
    return this.adapters.get(adapterId);
  }

  /**
   * Get all adapters for a specific chain
   */
  getAdaptersByChain(chainId: number): ChainAdapter[] {
    const adapterIds = this.adaptersByChain.get(chainId) || new Set();
    return Array.from(adapterIds)
      .map(id => this.adapters.get(id)!)
      .filter(a => a !== undefined);
  }

  /**
   * Get all adapters for a specific protocol (across all chains)
   */
  getAdaptersByProtocol(protocol: string): ChainAdapter[] {
    const adapterIds = this.adaptersByProtocol.get(protocol) || new Set();
    return Array.from(adapterIds)
      .map(id => this.adapters.get(id)!)
      .filter(a => a !== undefined);
  }

  /**
   * Get all adapters for a specific category (across all chains)
   */
  getAdaptersByCategory(category: AdapterCategory): ChainAdapter[] {
    const adapterIds = this.adaptersByCategory.get(category) || new Set();
    return Array.from(adapterIds)
      .map(id => this.adapters.get(id)!)
      .filter(a => a !== undefined);
  }

  /**
   * Get all enabled adapters
   */
  getEnabledAdapters(): ChainAdapter[] {
    return Array.from(this.adapters.values()).filter(a => a.config.enabled);
  }

  /**
   * Enable an adapter
   */
  enableAdapter(adapterId: string): void {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) throw new Error(`Adapter ${adapterId} not found`);
    adapter.config.enabled = true;
  }

  /**
   * Disable an adapter
   */
  disableAdapter(adapterId: string): void {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) throw new Error(`Adapter ${adapterId} not found`);
    adapter.config.enabled = false;
  }

  /**
   * Check health of a specific adapter
   */
  async checkAdapterHealth(adapterId: string): Promise<{ healthy: boolean; reason?: string }> {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) {
      return { healthy: false, reason: 'Adapter not found' };
    }

    try {
      const result = await adapter.instance.healthCheck();
      adapter.lastHealthCheck = new Date();
      adapter.healthy = result.healthy;
      return result;
    } catch (error: any) {
      adapter.healthy = false;
      return { healthy: false, reason: error.message };
    }
  }

  /**
   * Check health of all adapters
   */
  async checkAllAdaptersHealth(): Promise<Map<string, { healthy: boolean; reason?: string }>> {
    const results = new Map();
    const adapters = this.getEnabledAdapters();

    await Promise.all(
      adapters.map(async adapter => {
        const result = await this.checkAdapterHealth(adapter.adapterId);
        results.set(adapter.adapterId, result);
      })
    );

    return results;
  }

  /**
   * Get cross-chain position aggregation for a protocol
   */
  async getCrossChainPosition(protocol: string): Promise<CrossChainPosition> {
    const adapters = this.getAdaptersByProtocol(protocol).filter(a => a.config.enabled);
    
    if (adapters.length === 0) {
      throw new Error(`No enabled adapters found for protocol ${protocol}`);
    }

    const positions = new Map<number, any>();
    let totalValue = 0n;
    let weightedAPYSum = 0;
    let totalValueForAPY = 0;

    await Promise.all(
      adapters.map(async adapter => {
        try {
          const position = await adapter.instance.getPosition();
          positions.set(adapter.chainId, position);
          totalValue += position.totalValue;
          
          // Weight APY by position value
          const valueNum = Number(position.totalValue);
          weightedAPYSum += position.apy * valueNum;
          totalValueForAPY += valueNum;
        } catch (error: any) {
          console.error(`Failed to get position for ${adapter.adapterId}:`, error.message);
        }
      })
    );

    const weightedAPY = totalValueForAPY > 0 ? weightedAPYSum / totalValueForAPY : 0;

    return {
      protocol,
      category: adapters[0].config.category,
      positions,
      totalValue,
      weightedAPY,
    };
  }

  /**
   * Get all cross-chain positions grouped by protocol
   */
  async getAllCrossChainPositions(): Promise<CrossChainPosition[]> {
    const protocols = Array.from(this.adaptersByProtocol.keys());
    const positions = await Promise.all(
      protocols.map(protocol => this.getCrossChainPosition(protocol))
    );
    return positions;
  }

  /**
   * Get total value across all adapters
   */
  async getTotalValue(): Promise<bigint> {
    const adapters = this.getEnabledAdapters();
    let total = 0n;

    await Promise.all(
      adapters.map(async adapter => {
        try {
          const position = await adapter.instance.getPosition();
          total += position.totalValue;
        } catch (error: any) {
          console.error(`Failed to get position for ${adapter.adapterId}:`, error.message);
        }
      })
    );

    return total;
  }

  /**
   * Get weighted average APY across all adapters
   */
  async getWeightedAPY(): Promise<number> {
    const adapters = this.getEnabledAdapters();
    let weightedSum = 0;
    let totalValue = 0;

    await Promise.all(
      adapters.map(async adapter => {
        try {
          const position = await adapter.instance.getPosition();
          const valueNum = Number(position.totalValue);
          weightedSum += position.apy * valueNum;
          totalValue += valueNum;
        } catch (error: any) {
          console.error(`Failed to get position for ${adapter.adapterId}:`, error.message);
        }
      })
    );

    return totalValue > 0 ? weightedSum / totalValue : 0;
  }

  /**
   * Get summary statistics
   */
  async getSummary(): Promise<{
    totalAdapters: number;
    enabledAdapters: number;
    chains: number;
    protocols: number;
    totalValue: bigint;
    weightedAPY: number;
    healthyAdapters: number;
  }> {
    const enabled = this.getEnabledAdapters();
    const healthResults = await this.checkAllAdaptersHealth();
    const healthyCount = Array.from(healthResults.values()).filter(r => r.healthy).length;

    return {
      totalAdapters: this.adapters.size,
      enabledAdapters: enabled.length,
      chains: this.adaptersByChain.size,
      protocols: this.adaptersByProtocol.size,
      totalValue: await this.getTotalValue(),
      weightedAPY: await this.getWeightedAPY(),
      healthyAdapters: healthyCount,
    };
  }

  /**
   * Find best adapter for a protocol on a specific chain
   */
  findBestAdapter(protocol: string, chainId: number): ChainAdapter | undefined {
    const adapters = this.getAdaptersByProtocol(protocol)
      .filter(a => a.chainId === chainId && a.config.enabled && a.healthy !== false);
    
    if (adapters.length === 0) return undefined;
    if (adapters.length === 1) return adapters[0];

    // If multiple adapters for same protocol on same chain, prefer the healthiest
    return adapters.sort((a, b) => {
      if (a.healthy && !b.healthy) return -1;
      if (!a.healthy && b.healthy) return 1;
      return 0;
    })[0];
  }

  /**
   * Get adapter distribution across chains
   */
  getChainDistribution(): Map<number, { count: number; protocols: Set<string> }> {
    const distribution = new Map();

    for (const [chainId, adapterIds] of this.adaptersByChain.entries()) {
      const protocols = new Set<string>();
      for (const adapterId of adapterIds) {
        const adapter = this.adapters.get(adapterId);
        if (adapter) {
          protocols.add(adapter.config.protocol);
        }
      }
      distribution.set(chainId, {
        count: adapterIds.size,
        protocols,
      });
    }

    return distribution;
  }

  /**
   * Clear all adapters
   */
  clear(): void {
    this.adapters.clear();
    this.adaptersByChain.clear();
    this.adaptersByProtocol.clear();
    this.adaptersByCategory.clear();
  }
}
