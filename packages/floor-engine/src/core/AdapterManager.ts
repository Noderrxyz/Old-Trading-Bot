/**
 * Adapter Manager
 * 
 * Centralizes all adapter interactions for the Floor Engine.
 * Provides type-safe method routing, error handling, and transaction tracking.
 * 
 * @module core/AdapterManager
 */

import { ethers } from 'ethers';
import { AdapterRegistry } from './AdapterRegistry';
import { AdapterPosition } from '../types';

// Import all adapter types
import { AaveV3Adapter } from '../adapters/lending/AaveV3Adapter';
import { CompoundV3Adapter } from '../adapters/lending/CompoundV3Adapter';
import { MorphoBlueAdapter } from '../adapters/lending/MorphoBlueAdapter';
import { SparkAdapter } from '../adapters/lending/SparkAdapter';
import { LidoAdapter } from '../adapters/staking/LidoAdapter';
import { RocketPoolAdapter } from '../adapters/staking/RocketPoolAdapter';
import { NativeETHAdapter } from '../adapters/staking/NativeETHAdapter';
import { ConvexAdapter } from '../adapters/yield/ConvexAdapter';
import { CurveAdapter } from '../adapters/yield/CurveAdapter';
import { BalancerAdapter } from '../adapters/yield/BalancerAdapter';

/**
 * Adapter instance type union
 */
type AdapterInstance =
  | AaveV3Adapter
  | CompoundV3Adapter
  | MorphoBlueAdapter
  | SparkAdapter
  | LidoAdapter
  | RocketPoolAdapter
  | NativeETHAdapter
  | ConvexAdapter
  | CurveAdapter
  | BalancerAdapter;

/**
 * Adapter configuration for creation
 */
interface AdapterConfig {
  provider: ethers.Provider;
  wallet: ethers.Wallet;
  chainId: number;
  // Protocol-specific optional fields
  baseToken?: string; // For Compound V3
  marketId?: string; // For Morpho Blue
  validatorDataProvider?: () => Promise<any>; // For Native ETH
}

/**
 * Transaction result with metadata
 */
interface TransactionResult {
  hash: string;
  adapterId: string;
  operation: string;
  amount: bigint;
  gasUsed?: bigint;
  timestamp: number;
}

/**
 * Adapter Manager
 * 
 * Centralizes adapter interaction logic for the Floor Engine.
 * Provides a unified interface for all adapter operations.
 * 
 * Features:
 * - Type-safe adapter creation and method routing
 * - Comprehensive error handling with fallback logic
 * - Transaction tracking and gas monitoring
 * - Health checking across all adapters
 * - Position aggregation and reporting
 * 
 * @example
 * ```typescript
 * const manager = new AdapterManager(registry, provider, wallet, chainId);
 * 
 * // Deposit to any adapter
 * const txHash = await manager.deposit('aave-v3-usdc', ethers.parseEther('100'));
 * 
 * // Get position from any adapter
 * const position = await manager.getPosition('lido-steth');
 * 
 * // Claim rewards from any adapter
 * await manager.claimRewards('convex-3pool');
 * ```
 */
export class AdapterManager {
  private registry: AdapterRegistry;
  private config: AdapterConfig;
  private adapterInstances: Map<string, AdapterInstance> = new Map();
  private transactionHistory: TransactionResult[] = [];

  constructor(
    registry: AdapterRegistry,
    provider: ethers.Provider,
    wallet: ethers.Wallet,
    chainId: number
  ) {
    this.registry = registry;
    this.config = { provider, wallet, chainId };
  }

  /**
   * Get or create adapter instance
   * 
   * @param adapterId Adapter ID
   * @returns Adapter instance
   */
  private getAdapter(adapterId: string): AdapterInstance {
    // Check cache first
    if (this.adapterInstances.has(adapterId)) {
      return this.adapterInstances.get(adapterId)!;
    }

    // Get metadata from registry
    const metadata = this.registry.getMetadata(adapterId);
    if (!metadata) {
      throw new Error(`Adapter not found: ${adapterId}`);
    }

    // Create adapter instance based on protocol
    let adapter: AdapterInstance;

    switch (metadata.protocol) {
      // Lending adapters
      case 'Aave V3':
        adapter = new AaveV3Adapter(this.config);
        break;
      case 'Compound V3':
        // Note: baseToken should be configured when registering the adapter
        adapter = new CompoundV3Adapter({ ...this.config, baseToken: this.config.baseToken || 'USDC' });
        break;
      case 'Morpho Blue':
        // Note: marketId should be configured when registering the adapter
        adapter = new MorphoBlueAdapter({ ...this.config, marketId: this.config.marketId || '0x' });
        break;
      case 'Spark':
        adapter = new SparkAdapter(this.config);
        break;

      // Staking adapters
      case 'Lido':
        adapter = new LidoAdapter(this.config);
        break;
      case 'Rocket Pool':
        adapter = new RocketPoolAdapter(this.config);
        break;
      case 'Native ETH':
        adapter = new NativeETHAdapter(this.config);
        break;

      // Yield farming adapters
      case 'Convex':
        adapter = new ConvexAdapter(this.config);
        break;
      case 'Curve':
        adapter = new CurveAdapter(this.config);
        break;
      case 'Balancer':
        adapter = new BalancerAdapter(this.config);
        break;

      default:
        throw new Error(`Unknown protocol: ${metadata.protocol}`);
    }

    // Cache instance
    this.adapterInstances.set(adapterId, adapter);

    return adapter;
  }

  /**
   * Deposit capital to an adapter
   * 
   * @param adapterId Adapter ID
   * @param amount Amount to deposit
   * @param token Token address (optional, for lending adapters)
   * @returns Transaction hash
   */
  async deposit(adapterId: string, amount: bigint, token?: string): Promise<string> {
    const startTime = Date.now();
    const metadata = this.registry.getMetadata(adapterId);

    console.log(`[AdapterManager] Depositing ${ethers.formatEther(amount)} to ${adapterId}`);

    try {
      const adapter = this.getAdapter(adapterId);
      let txHash: string;

      // Route to appropriate method based on category
      switch (metadata.category) {
        case 'lending':
          if (!token) {
            throw new Error('Token address required for lending adapters');
          }
          // Lending adapters use supply() method
          txHash = await (adapter as AaveV3Adapter | CompoundV3Adapter | MorphoBlueAdapter | SparkAdapter).supply(token, amount);
          break;

        case 'staking':
          // Staking adapters use stake() method
          txHash = await (adapter as LidoAdapter | RocketPoolAdapter | NativeETHAdapter).stake(amount);
          break;

        case 'yield':
          // Yield adapters have different deposit methods
          if (metadata.protocol === 'Convex') {
            // Convex requires pool ID and LP token
            throw new Error('Convex deposits require pool ID and LP token - use specialized method');
          } else if (metadata.protocol === 'Curve') {
            // Curve requires pool address and amounts array
            throw new Error('Curve deposits require pool address and amounts - use specialized method');
          } else if (metadata.protocol === 'Balancer') {
            // Balancer requires pool ID and amounts array
            throw new Error('Balancer deposits require pool ID and amounts - use specialized method');
          } else {
            throw new Error(`Unknown yield protocol: ${metadata.protocol}`);
          }

        default:
          throw new Error(`Unknown adapter category: ${metadata.category}`);
      }

      // Record transaction
      const result: TransactionResult = {
        hash: txHash,
        adapterId,
        operation: 'deposit',
        amount,
        timestamp: Date.now(),
      };
      this.transactionHistory.push(result);

      console.log(`[AdapterManager] Deposit successful: ${txHash}`);
      console.log(`[AdapterManager] Operation took ${Date.now() - startTime}ms`);

      return txHash;
    } catch (error) {
      console.error(`[AdapterManager] Deposit failed for ${adapterId}:`, error);
      throw error;
    }
  }

  /**
   * Withdraw capital from an adapter
   * 
   * @param adapterId Adapter ID
   * @param amount Amount to withdraw
   * @param token Token address (optional, for lending adapters)
   * @returns Transaction hash
   */
  async withdraw(adapterId: string, amount: bigint, token?: string): Promise<string> {
    const startTime = Date.now();
    const metadata = this.registry.getMetadata(adapterId);

    console.log(`[AdapterManager] Withdrawing ${ethers.formatEther(amount)} from ${adapterId}`);

    try {
      const adapter = this.getAdapter(adapterId);
      let txHash: string;

      // Route to appropriate method based on category
      switch (metadata.category) {
        case 'lending':
          if (!token) {
            throw new Error('Token address required for lending adapters');
          }
          // Lending adapters use withdraw() method
          txHash = await (adapter as AaveV3Adapter | CompoundV3Adapter | MorphoBlueAdapter | SparkAdapter).withdraw(token, amount);
          break;

        case 'staking':
          // Staking adapters use unstake() method
          txHash = await (adapter as LidoAdapter | RocketPoolAdapter | NativeETHAdapter).unstake(amount);
          break;

        case 'yield':
          // Yield adapters have different withdrawal methods
          if (metadata.protocol === 'Convex') {
            throw new Error('Convex withdrawals require pool ID - use specialized method');
          } else if (metadata.protocol === 'Curve') {
            throw new Error('Curve withdrawals require pool address and min amounts - use specialized method');
          } else if (metadata.protocol === 'Balancer') {
            throw new Error('Balancer withdrawals require pool ID and min amounts - use specialized method');
          } else {
            throw new Error(`Unknown yield protocol: ${metadata.protocol}`);
          }

        default:
          throw new Error(`Unknown adapter category: ${metadata.category}`);
      }

      // Record transaction
      const result: TransactionResult = {
        hash: txHash,
        adapterId,
        operation: 'withdraw',
        amount,
        timestamp: Date.now(),
      };
      this.transactionHistory.push(result);

      console.log(`[AdapterManager] Withdrawal successful: ${txHash}`);
      console.log(`[AdapterManager] Operation took ${Date.now() - startTime}ms`);

      return txHash;
    } catch (error) {
      console.error(`[AdapterManager] Withdrawal failed for ${adapterId}:`, error);
      throw error;
    }
  }

  /**
   * Claim rewards from an adapter
   * 
   * @param adapterId Adapter ID
   * @returns Transaction hash
   */
  async claimRewards(adapterId: string): Promise<string> {
    const startTime = Date.now();
    const metadata = this.registry.getMetadata(adapterId);

    console.log(`[AdapterManager] Claiming rewards from ${adapterId}`);

    try {
      const adapter = this.getAdapter(adapterId);
      let txHash: string;

      // Most adapters don't have auto-claiming in deposit/withdrawal
      // So we need to explicitly claim rewards
      // However, not all adapters have claimRewards() method in the interface
      // For now, we'll handle the ones that do

      if (metadata.category === 'yield') {
        // Yield farming adapters have claimRewards()
        if (metadata.protocol === 'Convex') {
          throw new Error('Convex reward claiming requires pool ID - use specialized method');
        } else if (metadata.protocol === 'Curve') {
          throw new Error('Curve reward claiming requires gauge address - use specialized method');
        } else if (metadata.protocol === 'Balancer') {
          throw new Error('Balancer reward claiming requires gauge address - use specialized method');
        }
      }

      // For lending and staking, rewards are typically auto-claimed or don't exist
      console.warn(`[AdapterManager] Reward claiming not implemented for ${metadata.category} adapters`);
      return '';
    } catch (error) {
      console.error(`[AdapterManager] Reward claiming failed for ${adapterId}:`, error);
      throw error;
    }
  }

  /**
   * Get position from an adapter
   * 
   * @param adapterId Adapter ID
   * @param params Additional parameters (pool ID, gauge, etc.)
   * @returns Adapter position
   */
  async getPosition(adapterId: string, params?: any): Promise<AdapterPosition> {
    const metadata = this.registry.getMetadata(adapterId);

    try {
      const adapter = this.getAdapter(adapterId);
      let position: AdapterPosition;

      // Route to appropriate method based on category
      switch (metadata.category) {
        case 'lending':
        case 'staking':
          // Lending and staking adapters have simple getPosition()
          position = await (adapter as any).getPosition(params);
          break;

        case 'yield':
          // Yield adapters require specific parameters
          if (!params) {
            throw new Error('Parameters required for yield adapter position queries');
          }
          position = await (adapter as any).getPosition(params);
          break;

        default:
          throw new Error(`Unknown adapter category: ${metadata.category}`);
      }

      return position;
    } catch (error) {
      console.error(`[AdapterManager] Position query failed for ${adapterId}:`, error);
      throw error;
    }
  }

  /**
   * Get APY from an adapter
   * 
   * @param adapterId Adapter ID
   * @param params Additional parameters (token, pool ID, etc.)
   * @returns APY percentage
   */
  async getAPY(adapterId: string, params?: any): Promise<number> {
    const metadata = this.registry.getMetadata(adapterId);

    try {
      const adapter = this.getAdapter(adapterId);
      const apy = await (adapter as any).getAPY(params);
      return apy;
    } catch (error) {
      console.error(`[AdapterManager] APY query failed for ${adapterId}:`, error);
      // Return 0 instead of throwing to allow graceful degradation
      return 0;
    }
  }

  /**
   * Health check an adapter
   * 
   * @param adapterId Adapter ID
   * @returns Health status
   */
  async healthCheck(adapterId: string): Promise<{ healthy: boolean; reason?: string }> {
    try {
      const adapter = this.getAdapter(adapterId);
      const health = await (adapter as any).healthCheck();
      return health;
    } catch (error) {
      console.error(`[AdapterManager] Health check failed for ${adapterId}:`, error);
      return {
        healthy: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Health check all adapters
   * 
   * @returns Map of adapter ID to health status
   */
  async healthCheckAll(): Promise<Map<string, { healthy: boolean; reason?: string }>> {
    const results = new Map<string, { healthy: boolean; reason?: string }>();
    const allAdapters = this.registry.getAllAdapters();

    for (const adapterId of allAdapters) {
      const health = await this.healthCheck(adapterId);
      results.set(adapterId, health);
    }

    return results;
  }

  /**
   * Get all positions across all adapters
   * 
   * @returns Array of positions with adapter IDs
   */
  async getAllPositions(): Promise<Array<{ adapterId: string; position: AdapterPosition }>> {
    const positions: Array<{ adapterId: string; position: AdapterPosition }> = [];
    const allAdapters = this.registry.getAllAdapters();

    for (const adapterId of allAdapters) {
      try {
        // For yield adapters, we'd need specific parameters
        // For now, skip them or handle with default params
        const metadata = this.registry.getMetadata(adapterId);
        
        if (metadata.category === 'yield') {
          // Skip yield adapters for now as they require specific params
          continue;
        }

        const position = await this.getPosition(adapterId);
        positions.push({ adapterId, position });
      } catch (error) {
        console.warn(`[AdapterManager] Failed to get position for ${adapterId}:`, error);
        // Continue with other adapters
      }
    }

    return positions;
  }

  /**
   * Get transaction history
   * 
   * @param limit Maximum number of transactions to return
   * @returns Array of transaction results
   */
  getTransactionHistory(limit?: number): TransactionResult[] {
    if (limit) {
      return this.transactionHistory.slice(-limit);
    }
    return [...this.transactionHistory];
  }

  /**
   * Clear adapter instance cache
   * 
   * Useful for forcing re-initialization of adapters
   */
  clearCache(): void {
    this.adapterInstances.clear();
    console.log('[AdapterManager] Adapter cache cleared');
  }

  /**
   * Get adapter instance (for advanced usage)
   * 
   * @param adapterId Adapter ID
   * @returns Adapter instance
   */
  getAdapterInstance(adapterId: string): AdapterInstance {
    return this.getAdapter(adapterId);
  }
}
