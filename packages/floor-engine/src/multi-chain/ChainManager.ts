/**
 * Chain Manager
 * 
 * Manages blockchain configurations and providers for multi-chain deployments.
 * 
 * @module multi-chain/ChainManager
 */

import { ethers } from 'ethers';

/**
 * Chain configuration
 */
export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  blockExplorer: string;
  gasMultiplier: number; // Multiplier for gas price estimation
  confirmations: number; // Number of confirmations required
}

/**
 * Chain health status
 */
export interface HealthStatus {
  chainId: number;
  healthy: boolean;
  blockNumber?: number;
  latency?: number;
  error?: string;
}

/**
 * Default chain configurations
 */
export const DEFAULT_CHAIN_CONFIGS: Map<number, ChainConfig> = new Map([
  [
    1,
    {
      chainId: 1,
      name: 'Ethereum Mainnet',
      rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
      nativeCurrency: {
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
      },
      blockExplorer: 'https://etherscan.io',
      gasMultiplier: 1.1,
      confirmations: 2,
    },
  ],
  [
    42161,
    {
      chainId: 42161,
      name: 'Arbitrum One',
      rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
      nativeCurrency: {
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
      },
      blockExplorer: 'https://arbiscan.io',
      gasMultiplier: 1.05,
      confirmations: 1,
    },
  ],
  [
    10,
    {
      chainId: 10,
      name: 'Optimism',
      rpcUrl: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
      nativeCurrency: {
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
      },
      blockExplorer: 'https://optimistic.etherscan.io',
      gasMultiplier: 1.05,
      confirmations: 1,
    },
  ],
  [
    8453,
    {
      chainId: 8453,
      name: 'Base',
      rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      nativeCurrency: {
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
      },
      blockExplorer: 'https://basescan.org',
      gasMultiplier: 1.05,
      confirmations: 1,
    },
  ],
]);

/**
 * Chain Manager
 * 
 * Manages blockchain configurations and providers for multi-chain deployments.
 */
export class ChainManager {
  private configs: Map<number, ChainConfig>;
  private providers: Map<number, ethers.Provider> = new Map();

  constructor(configs?: Map<number, ChainConfig>) {
    this.configs = configs || DEFAULT_CHAIN_CONFIGS;
  }

  /**
   * Get configuration for a specific chain
   */
  getConfig(chainId: number): ChainConfig {
    const config = this.configs.get(chainId);
    if (!config) throw new Error(`Chain ${chainId} not supported`);
    return config;
  }

  /**
   * Get provider for a specific chain
   */
  getProvider(chainId: number): ethers.Provider {
    // Return cached provider if available
    if (this.providers.has(chainId)) {
      return this.providers.get(chainId)!;
    }

    // Create new provider
    const config = this.getConfig(chainId);
    const provider = new ethers.JsonRpcProvider(config.rpcUrl, {
      chainId: config.chainId,
      name: config.name,
    });

    // Cache provider
    this.providers.set(chainId, provider);
    return provider;
  }

  /**
   * Check if a chain is supported
   */
  isChainSupported(chainId: number): boolean {
    return this.configs.has(chainId);
  }

  /**
   * Get all supported chain IDs
   */
  getSupportedChains(): number[] {
    return Array.from(this.configs.keys());
  }

  /**
   * Get gas price for a specific chain with multiplier
   */
  async getGasPrice(chainId: number): Promise<bigint> {
    const provider = this.getProvider(chainId);
    const config = this.getConfig(chainId);
    
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || 0n;
    
    // Apply gas multiplier
    const multipliedGas = (gasPrice * BigInt(Math.floor(config.gasMultiplier * 100))) / 100n;
    return multipliedGas;
  }

  /**
   * Get block explorer URL for a transaction
   */
  getExplorerUrl(chainId: number, txHash: string): string {
    const config = this.getConfig(chainId);
    return `${config.blockExplorer}/tx/${txHash}`;
  }

  /**
   * Get block explorer URL for an address
   */
  getAddressUrl(chainId: number, address: string): string {
    const config = this.getConfig(chainId);
    return `${config.blockExplorer}/address/${address}`;
  }

  /**
   * Wait for transaction confirmation
   */
  async waitForTransaction(
    chainId: number,
    txHash: string,
    confirmations?: number
  ): Promise<ethers.TransactionReceipt | null> {
    const provider = this.getProvider(chainId);
    const config = this.getConfig(chainId);
    const requiredConfirmations = confirmations || config.confirmations;
    
    return await provider.waitForTransaction(txHash, requiredConfirmations);
  }

  /**
   * Check health of a specific chain
   */
  async checkChainHealth(chainId: number): Promise<HealthStatus> {
    try {
      const provider = this.getProvider(chainId);
      const startTime = Date.now();
      const blockNumber = await provider.getBlockNumber();
      const latency = Date.now() - startTime;

      return {
        chainId,
        healthy: true,
        blockNumber,
        latency,
      };
    } catch (error: any) {
      return {
        chainId,
        healthy: false,
        error: error.message,
      };
    }
  }

  /**
   * Check health of all supported chains
   */
  async getHealthStatus(): Promise<Map<number, HealthStatus>> {
    const chainIds = this.getSupportedChains();
    const results = new Map<number, HealthStatus>();

    await Promise.all(
      chainIds.map(async chainId => {
        const status = await this.checkChainHealth(chainId);
        results.set(chainId, status);
      })
    );

    return results;
  }

  /**
   * Clear cached providers
   */
  clearProviders(): void {
    this.providers.clear();
  }
}
