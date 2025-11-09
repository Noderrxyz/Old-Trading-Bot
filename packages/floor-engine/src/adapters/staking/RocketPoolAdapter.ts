/**
 * Rocket Pool Staking Adapter
 * 
 * Adapter for Rocket Pool decentralized liquid staking protocol (rETH).
 * Supports Ethereum mainnet.
 * 
 * Protocol: https://rocketpool.net
 * Docs: https://docs.rocketpool.net/
 */

import { ethers } from 'ethers';
import { IStakingAdapter, AdapterPosition } from '../../types';

/**
 * Rocket Pool Deposit Pool ABI (minimal interface)
 */
const ROCKET_DEPOSIT_POOL_ABI = [
  'function deposit() payable',
  'function getBalance() view returns (uint256)',
  'function getMaximumDepositAmount() view returns (uint256)',
];

/**
 * Rocket Pool rETH Token ABI (minimal interface)
 */
const ROCKET_RETH_TOKEN_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function getEthValue(uint256 rethAmount) view returns (uint256)',
  'function getRethValue(uint256 ethAmount) view returns (uint256)',
  'function getExchangeRate() view returns (uint256)',
  'function getTotalCollateral() view returns (uint256)',
  'function burn(uint256 rethAmount)',
  'function transfer(address recipient, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

/**
 * Rocket Pool Storage ABI (minimal interface)
 */
const ROCKET_STORAGE_ABI = [
  'function getAddress(bytes32 key) view returns (address)',
];

/**
 * Rocket Pool contract addresses (Ethereum mainnet)
 */
const ROCKET_STORAGE_ADDRESS = '0x1d8f8f00cfa6758d7bE78336684788Fb0ee0Fa46';

/**
 * Rocket Pool contract keys
 */
const ROCKET_DEPOSIT_POOL_KEY = ethers.id('contract.addressrocketDepositPool');
const ROCKET_RETH_TOKEN_KEY = ethers.id('contract.addressrocketTokenRETH');

/**
 * Rocket Pool Adapter Configuration
 */
export interface RocketPoolAdapterConfig {
  provider: ethers.Provider;
  wallet: ethers.Wallet;
  chainId: number;
  storageAddress?: string; // Optional override
}

/**
 * Rocket Pool Staking Adapter
 * 
 * Implements IStakingAdapter for Rocket Pool liquid staking protocol.
 */
export class RocketPoolAdapter implements IStakingAdapter {
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private chainId: number;
  private storage: ethers.Contract;
  private depositPool!: ethers.Contract;
  private rETH!: ethers.Contract;
  private storageAddress: string;
  private depositPoolAddress: string = '';
  private rETHAddress: string = '';

  constructor(config: RocketPoolAdapterConfig) {
    this.provider = config.provider;
    this.wallet = config.wallet;
    this.chainId = config.chainId;

    // Only Ethereum mainnet supported
    if (config.chainId !== 1) {
      throw new Error('Rocket Pool only deployed on Ethereum mainnet');
    }

    // Get storage address
    this.storageAddress = config.storageAddress || ROCKET_STORAGE_ADDRESS;

    // Initialize storage contract
    this.storage = new ethers.Contract(
      this.storageAddress,
      ROCKET_STORAGE_ABI,
      this.wallet
    );
  }

  /**
   * Initialize adapter (fetch contract addresses from storage)
   */
  private async initialize(): Promise<void> {
    if (!this.depositPoolAddress) {
      // Get deposit pool address
      this.depositPoolAddress = await this.storage.getAddress(ROCKET_DEPOSIT_POOL_KEY);
      this.depositPool = new ethers.Contract(
        this.depositPoolAddress,
        ROCKET_DEPOSIT_POOL_ABI,
        this.wallet
      );

      // Get rETH token address
      this.rETHAddress = await this.storage.getAddress(ROCKET_RETH_TOKEN_KEY);
      this.rETH = new ethers.Contract(
        this.rETHAddress,
        ROCKET_RETH_TOKEN_ABI,
        this.wallet
      );
    }
  }

  /**
   * Stake ETH to receive rETH
   * 
   * @param amount Amount of ETH to stake
   * @returns Transaction hash
   */
  async stake(amount: bigint): Promise<string> {
    await this.initialize();

    console.log(`[RocketPool] Staking ${ethers.formatEther(amount)} ETH`);

    // Check maximum deposit amount
    const maxDeposit = await this.depositPool.getMaximumDepositAmount();
    if (amount > maxDeposit) {
      throw new Error(
        `Deposit amount ${ethers.formatEther(amount)} exceeds maximum ${ethers.formatEther(maxDeposit)}`
      );
    }

    // Deposit ETH to receive rETH
    const tx = await this.depositPool.deposit({
      value: amount,
    });

    console.log(`[RocketPool] Stake transaction: ${tx.hash}`);

    // Wait for confirmation
    await tx.wait();

    console.log(`[RocketPool] Stake confirmed`);

    return tx.hash;
  }

  /**
   * Unstake rETH to receive ETH
   * 
   * Note: Rocket Pool allows burning rETH directly for ETH if there's
   * sufficient liquidity in the deposit pool. Otherwise, you may need
   * to sell rETH on secondary markets.
   * 
   * @param amount Amount of rETH to unstake
   * @returns Transaction hash
   */
  async unstake(amount: bigint): Promise<string> {
    await this.initialize();

    console.log(`[RocketPool] Unstaking ${ethers.formatEther(amount)} rETH`);

    // Burn rETH to receive ETH
    const tx = await this.rETH.burn(amount);

    console.log(`[RocketPool] Unstake transaction: ${tx.hash}`);

    // Wait for confirmation
    await tx.wait();

    console.log(`[RocketPool] Unstake confirmed`);

    return tx.hash;
  }

  /**
   * Claim rewards (not applicable for Rocket Pool)
   * 
   * Rocket Pool automatically accrues rewards through rETH exchange rate appreciation.
   * This method is included for interface compliance but is not needed.
   * 
   * @returns Empty transaction hash
   */
  async claimRewards(): Promise<string> {
    console.log(`[RocketPool] Rewards are automatically accrued through rETH exchange rate`);
    console.log(`[RocketPool] No claim transaction needed`);
    return '0x0000000000000000000000000000000000000000000000000000000000000000';
  }

  /**
   * Get current staking position
   * 
   * @returns Adapter position
   */
  async getPosition(): Promise<AdapterPosition> {
    await this.initialize();

    // Get rETH balance
    const rETHBalance = await this.rETH.balanceOf(this.wallet.address);

    // Get ETH value of rETH
    const ethValue = rETHBalance > 0n
      ? await this.rETH.getEthValue(rETHBalance)
      : 0n;

    // Get exchange rate
    const exchangeRate = await this.rETH.getExchangeRate();

    // Get current APY
    const apy = await this.getAPY();

    return {
      totalValue: ethValue,
      supplied: rETHBalance,
      borrowed: 0n, // No borrowing in staking
      apy,
      healthFactor: Infinity, // No liquidation risk in staking
      metadata: {
        protocol: 'rocket-pool',
        chain: this.chainId,
        rETHAddress: this.rETHAddress,
        rETHBalance: ethers.formatEther(rETHBalance),
        ethValue: ethers.formatEther(ethValue),
        exchangeRate: ethers.formatEther(exchangeRate),
      },
    };
  }

  /**
   * Get current staking APY
   * 
   * Note: This is a simplified calculation. In production, you would fetch
   * the actual APY from Rocket Pool's API or calculate it from on-chain data.
   * 
   * @returns APY as percentage (e.g., 3.2 = 3.2%)
   */
  async getAPY(): Promise<number> {
    // Simplified APY calculation
    // In production, fetch from Rocket Pool API or calculate from exchange rate changes
    
    // Historical average: ~3-4% APY
    // For now, return a conservative estimate
    const estimatedAPY = 3.2;

    return estimatedAPY;
  }

  /**
   * Perform health check on the adapter
   * 
   * @returns Health check result
   */
  async healthCheck(): Promise<{ healthy: boolean; reason?: string }> {
    try {
      await this.initialize();

      // Check if storage contract is accessible
      const storageAddress = await this.storage.getAddress();
      if (storageAddress !== this.storageAddress) {
        return {
          healthy: false,
          reason: 'Storage address mismatch',
        };
      }

      // Check if rETH contract is accessible
      const rETHAddress = await this.rETH.getAddress();
      if (rETHAddress !== this.rETHAddress) {
        return {
          healthy: false,
          reason: 'rETH address mismatch',
        };
      }

      // Check if we can query balance
      await this.rETH.balanceOf(this.wallet.address);

      // Check if deposit pool is accessible
      const depositPoolAddress = await this.depositPool.getAddress();
      if (depositPoolAddress !== this.depositPoolAddress) {
        return {
          healthy: false,
          reason: 'Deposit pool address mismatch',
        };
      }

      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get rETH address
   * 
   * @returns rETH contract address
   */
  async getRETHAddress(): Promise<string> {
    await this.initialize();
    return this.rETHAddress;
  }

  /**
   * Get deposit pool address
   * 
   * @returns Deposit pool contract address
   */
  async getDepositPoolAddress(): Promise<string> {
    await this.initialize();
    return this.depositPoolAddress;
  }

  /**
   * Get exchange rate (ETH per rETH)
   * 
   * @returns Exchange rate
   */
  async getExchangeRate(): Promise<bigint> {
    await this.initialize();
    return await this.rETH.getExchangeRate();
  }

  /**
   * Get ETH value of rETH amount
   * 
   * @param rethAmount Amount of rETH
   * @returns ETH value
   */
  async getETHValue(rethAmount: bigint): Promise<bigint> {
    await this.initialize();
    return await this.rETH.getEthValue(rethAmount);
  }

  /**
   * Get rETH value of ETH amount
   * 
   * @param ethAmount Amount of ETH
   * @returns rETH value
   */
  async getRETHValue(ethAmount: bigint): Promise<bigint> {
    await this.initialize();
    return await this.rETH.getRethValue(ethAmount);
  }

  /**
   * Get maximum deposit amount
   * 
   * @returns Maximum deposit amount in ETH
   */
  async getMaximumDepositAmount(): Promise<bigint> {
    await this.initialize();
    return await this.depositPool.getMaximumDepositAmount();
  }

  /**
   * Get deposit pool balance
   * 
   * @returns Deposit pool balance in ETH
   */
  async getDepositPoolBalance(): Promise<bigint> {
    await this.initialize();
    return await this.depositPool.getBalance();
  }

  /**
   * Get supported chains
   * 
   * @returns Array of supported chain IDs
   */
  static getSupportedChains(): number[] {
    return [1]; // Ethereum mainnet only
  }

  /**
   * Check if chain is supported
   * 
   * @param chainId Chain ID
   * @returns True if supported
   */
  static isChainSupported(chainId: number): boolean {
    return chainId === 1;
  }

  /**
   * Get protocol TVL (Total Value Locked)
   * 
   * @returns TVL in ETH
   */
  async getTVL(): Promise<bigint> {
    await this.initialize();
    const totalCollateral = await this.rETH.getTotalCollateral();
    return totalCollateral;
  }
}
