/**
 * Chain Manager
 * 
 * Manages multi-chain configuration and provides chain-specific utilities.
 * Supports Ethereum, Arbitrum, Optimism, and Base.
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
  shortName: string;
  rpcUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  blockExplorer: string;
  enabled: boolean;
  gasMultiplier: number;
  confirmations: number;
}

/**
 * Supported chain IDs
 */
export enum SupportedChainId {
  ETHEREUM = 1,
  ARBITRUM = 42161,
  OPTIMISM = 10,
  BASE = 8453,
}

/**
 * Default chain configurations
 */
export const DEFAULT_CHAIN_CONFIGS: Record<number, ChainConfig> = {
  1: {
    chainId: 1,
    name: 'Ethereum Mainnet',
    shortName: 'ethereum',
    rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://etherscan.io',
    enabled: true,
    gasMultiplier: 1.1,
    confirmations: 2,
  },
  42161: {
    chainId: 42161,
    name: 'Arbitrum One',
    shortName: 'arbitrum',
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://arbiscan.io',
    enabled: true,
    gasMultiplier: 1.05,
    confirmations: 1,
  },
  10: {
    chainId: 10,
    name: 'Optimism',
    shortName: 'optimism',
    rpcUrl: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://optimistic.etherscan.io',
    enabled: true,
    gasMultiplier: 1.05,
    confirmations: 1,
  },
  8453: {
    chainId: 8453,
    name: 'Base',
    shortName: 'base',
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorer: 'https://basescan.org',
    enabled: true,
    gasMultiplier: 1.05,
    confirmations: 1,
  },
};

/**
 * Chain Manager
 */
export class ChainManager {
  private configs: Map<number, ChainConfig> = new Map();
  private providers: Map<number, ethers.Provider> = new Map();

  constructor(customConfigs?: Partial<Record<number, ChainConfig>>) {
    for (const [chainId, config] of Object.entries(DEFAULT_CHAIN_CONFIGS)) {
      this.configs.set(Number(chainId), config);
    }
    if (customConfigs) {
      for (const [chainId, config] of Object.entries(customConfigs)) {
        this.configs.set(Number(chainId), { ...this.configs.get(Number(chainId))!, ...config });
      }
    }
  }

  getConfig(chainId: number): ChainConfig {
    const config = this.configs.get(chainId);
    if (!config) throw new Error(\`Chain \${chainId} not supported\`);
    return config;
  }

  getProvider(chainId: number): ethers.Provider {
    if (this.providers.has(chainId)) {
      return this.providers.get(chainId)!;
    }
    const config = this.getConfig(chainId);
    if (!config.enabled) throw new Error(\`Chain \${chainId} is not enabled\`);
    const provider = new ethers.JsonRpcProvider(config.rpcUrl, {
      chainId: config.chainId,
      name: config.name,
    });
    this.providers.set(chainId, provider);
    return provider;
  }

  isChainSupported(chainId: number): boolean {
    return this.configs.has(chainId);
  }

  isChainEnabled(chainId: number): boolean {
    const config = this.configs.get(chainId);
    return config ? config.enabled : false;
  }

  getSupportedChains(): number[] {
    return Array.from(this.configs.keys());
  }

  getEnabledChains(): number[] {
    return Array.from(this.configs.entries())
      .filter(([_, config]) => config.enabled)
      .map(([chainId, _]) => chainId);
  }

  enableChain(chainId: number): void {
    const config = this.getConfig(chainId);
    config.enabled = true;
  }

  disableChain(chainId: number): void {
    const config = this.getConfig(chainId);
    config.enabled = false;
    this.providers.delete(chainId);
  }

  getTransactionUrl(chainId: number, txHash: string): string {
    const config = this.getConfig(chainId);
    return \`\${config.blockExplorer}/tx/\${txHash}\`;
  }

  getAddressUrl(chainId: number, address: string): string {
    const config = this.getConfig(chainId);
    return \`\${config.blockExplorer}/address/\${address}\`;
  }

  async getGasPrice(chainId: number): Promise<bigint> {
    const provider = this.getProvider(chainId);
    const config = this.getConfig(chainId);
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || 0n;
    return BigInt(Math.floor(Number(gasPrice) * config.gasMultiplier));
  }

  async getBlockNumber(chainId: number): Promise<number> {
    const provider = this.getProvider(chainId);
    return await provider.getBlockNumber();
  }

  async waitForTransaction(chainId: number, txHash: string): Promise<ethers.TransactionReceipt> {
    const provider = this.getProvider(chainId);
    const config = this.getConfig(chainId);
    const receipt = await provider.waitForTransaction(txHash, config.confirmations);
    if (!receipt) throw new Error(\`Transaction \${txHash} not found on chain \${chainId}\`);
    return receipt;
  }

  getChainName(chainId: number): string {
    return this.getConfig(chainId).name;
  }

  getChainShortName(chainId: number): string {
    return this.getConfig(chainId).shortName;
  }

  async validateChain(chainId: number): Promise<{ valid: boolean; error?: string }> {
    try {
      const provider = this.getProvider(chainId);
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== chainId) {
        return { valid: false, error: \`Chain ID mismatch: expected \${chainId}, got \${network.chainId}\` };
      }
      return { valid: true };
    } catch (error: any) {
      return { valid: false, error: error.message };
    }
  }

  async getHealthStatus(): Promise<Map<number, { healthy: boolean; blockNumber?: number; error?: string }>> {
    const status = new Map();
    for (const chainId of this.getEnabledChains()) {
      try {
        const blockNumber = await this.getBlockNumber(chainId);
        status.set(chainId, { healthy: true, blockNumber });
      } catch (error: any) {
        status.set(chainId, { healthy: false, error: error.message });
      }
    }
    return status;
  }
}
