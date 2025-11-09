/**
 * Lido Staking Adapter
 * 
 * Adapter for Lido liquid staking protocol (stETH).
 * Supports Ethereum mainnet.
 * 
 * Protocol: https://lido.fi
 * Docs: https://docs.lido.fi/
 */

import { ethers } from 'ethers';
import { IStakingAdapter, AdapterPosition } from '../../types';

/**
 * Lido stETH ABI (minimal interface)
 */
const LIDO_STETH_ABI = [
  'function submit(address _referral) payable returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function sharesOf(address account) view returns (uint256)',
  'function getPooledEthByShares(uint256 sharesAmount) view returns (uint256)',
  'function getSharesByPooledEth(uint256 pooledEthAmount) view returns (uint256)',
  'function getTotalPooledEther() view returns (uint256)',
  'function getTotalShares() view returns (uint256)',
  'function transfer(address recipient, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

/**
 * Lido Withdrawal Queue ABI (minimal interface)
 */
const LIDO_WITHDRAWAL_QUEUE_ABI = [
  'function requestWithdrawals(uint256[] amounts, address owner) returns (uint256[] requestIds)',
  'function getWithdrawalStatus(uint256[] requestIds) view returns (tuple(uint256 amountOfStETH, uint256 amountOfShares, address owner, uint256 timestamp, bool isFinalized, bool isClaimed)[])',
  'function claimWithdrawals(uint256[] requestIds, uint256[] hints)',
  'function findCheckpointHints(uint256[] requestIds, uint256 firstIndex, uint256 lastIndex) view returns (uint256[])',
];

/**
 * Lido contract addresses (Ethereum mainnet)
 */
const LIDO_STETH_ADDRESS = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84';
const LIDO_WITHDRAWAL_QUEUE_ADDRESS = '0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1';

/**
 * Lido Adapter Configuration
 */
export interface LidoAdapterConfig {
  provider: ethers.Provider;
  wallet: ethers.Wallet;
  chainId: number;
  stETHAddress?: string; // Optional override
  withdrawalQueueAddress?: string; // Optional override
}

/**
 * Lido Staking Adapter
 * 
 * Implements IStakingAdapter for Lido liquid staking protocol.
 */
export class LidoAdapter implements IStakingAdapter {
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private chainId: number;
  private stETH: ethers.Contract;
  private withdrawalQueue: ethers.Contract;
  private stETHAddress: string;
  private withdrawalQueueAddress: string;

  constructor(config: LidoAdapterConfig) {
    this.provider = config.provider;
    this.wallet = config.wallet;
    this.chainId = config.chainId;

    // Only Ethereum mainnet supported
    if (config.chainId !== 1) {
      throw new Error('Lido only deployed on Ethereum mainnet');
    }

    // Get contract addresses
    this.stETHAddress = config.stETHAddress || LIDO_STETH_ADDRESS;
    this.withdrawalQueueAddress = config.withdrawalQueueAddress || LIDO_WITHDRAWAL_QUEUE_ADDRESS;

    // Initialize contracts
    this.stETH = new ethers.Contract(
      this.stETHAddress,
      LIDO_STETH_ABI,
      this.wallet
    );

    this.withdrawalQueue = new ethers.Contract(
      this.withdrawalQueueAddress,
      LIDO_WITHDRAWAL_QUEUE_ABI,
      this.wallet
    );
  }

  /**
   * Stake ETH to receive stETH
   * 
   * @param amount Amount of ETH to stake
   * @returns Transaction hash
   */
  async stake(amount: bigint): Promise<string> {
    console.log(`[Lido] Staking ${ethers.formatEther(amount)} ETH`);

    // Submit ETH to Lido (no referral)
    const tx = await this.stETH.submit(ethers.ZeroAddress, {
      value: amount,
    });

    console.log(`[Lido] Stake transaction: ${tx.hash}`);

    // Wait for confirmation
    await tx.wait();

    console.log(`[Lido] Stake confirmed`);

    return tx.hash;
  }

  /**
   * Unstake stETH (request withdrawal)
   * 
   * Note: Lido uses a withdrawal queue system. This initiates a withdrawal request
   * that must be claimed later when finalized.
   * 
   * @param amount Amount of stETH to unstake
   * @returns Transaction hash
   */
  async unstake(amount: bigint): Promise<string> {
    console.log(`[Lido] Requesting withdrawal of ${ethers.formatEther(amount)} stETH`);

    // Approve withdrawal queue to spend stETH
    await this.approveWithdrawalQueue(amount);

    // Request withdrawal
    const tx = await this.withdrawalQueue.requestWithdrawals(
      [amount],
      this.wallet.address
    );

    console.log(`[Lido] Withdrawal request transaction: ${tx.hash}`);

    // Wait for confirmation
    const receipt = await tx.wait();

    console.log(`[Lido] Withdrawal request confirmed`);
    console.log(`[Lido] Note: Withdrawal must be claimed later when finalized`);

    return tx.hash;
  }

  /**
   * Claim rewards (not applicable for Lido)
   * 
   * Lido automatically accrues rewards through stETH rebase.
   * This method is included for interface compliance but is not needed.
   * 
   * @returns Empty transaction hash
   */
  async claimRewards(): Promise<string> {
    console.log(`[Lido] Rewards are automatically accrued through stETH rebase`);
    console.log(`[Lido] No claim transaction needed`);
    return '0x0000000000000000000000000000000000000000000000000000000000000000';
  }

  /**
   * Get current staking position
   * 
   * @returns Adapter position
   */
  async getPosition(): Promise<AdapterPosition> {
    // Get stETH balance
    const stETHBalance = await this.stETH.balanceOf(this.wallet.address);

    // Get shares (for calculating rewards)
    const shares = await this.stETH.sharesOf(this.wallet.address);

    // Get current APY
    const apy = await this.getAPY();

    // Calculate total value (stETH is 1:1 with ETH, but can vary slightly)
    const totalValue = stETHBalance;

    // Get exchange rate (stETH per share)
    const totalPooledEther = await this.stETH.getTotalPooledEther();
    const totalShares = await this.stETH.getTotalShares();
    const exchangeRate = totalShares > 0n
      ? (totalPooledEther * ethers.parseEther('1')) / totalShares
      : ethers.parseEther('1');

    return {
      totalValue,
      supplied: stETHBalance,
      borrowed: 0n, // No borrowing in staking
      apy,
      healthFactor: Infinity, // No liquidation risk in staking
      metadata: {
        protocol: 'lido',
        chain: this.chainId,
        stETHAddress: this.stETHAddress,
        shares: shares.toString(),
        exchangeRate: ethers.formatEther(exchangeRate),
        rebaseEnabled: true,
      },
    };
  }

  /**
   * Get current staking APY
   * 
   * Note: This is a simplified calculation. In production, you would fetch
   * the actual APY from Lido's API or calculate it from on-chain data.
   * 
   * @returns APY as percentage (e.g., 3.5 = 3.5%)
   */
  async getAPY(): Promise<number> {
    // Simplified APY calculation
    // In production, fetch from Lido API: https://stake.lido.fi/api/sma-steth-apr
    
    // Historical average: ~3-4% APY
    // For now, return a conservative estimate
    const estimatedAPY = 3.5;

    return estimatedAPY;
  }

  /**
   * Perform health check on the adapter
   * 
   * @returns Health check result
   */
  async healthCheck(): Promise<{ healthy: boolean; reason?: string }> {
    try {
      // Check if stETH contract is accessible
      const stETHAddress = await this.stETH.getAddress();
      if (stETHAddress !== this.stETHAddress) {
        return {
          healthy: false,
          reason: 'stETH address mismatch',
        };
      }

      // Check if we can query balance
      await this.stETH.balanceOf(this.wallet.address);

      // Check if withdrawal queue is accessible
      const withdrawalQueueAddress = await this.withdrawalQueue.getAddress();
      if (withdrawalQueueAddress !== this.withdrawalQueueAddress) {
        return {
          healthy: false,
          reason: 'Withdrawal queue address mismatch',
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
   * Approve withdrawal queue to spend stETH
   * 
   * @param amount Amount to approve
   */
  private async approveWithdrawalQueue(amount: bigint): Promise<void> {
    // Check if approval is needed
    const currentAllowance = await this.stETH.allowance(
      this.wallet.address,
      this.withdrawalQueueAddress
    );

    // If allowance is sufficient, skip approval
    if (currentAllowance >= amount) {
      console.log(`[Lido] Sufficient allowance: ${ethers.formatEther(currentAllowance)} stETH`);
      return;
    }

    // Approve withdrawal queue to spend stETH
    console.log(`[Lido] Approving ${ethers.formatEther(amount)} stETH`);
    const tx = await this.stETH.approve(this.withdrawalQueueAddress, amount);
    await tx.wait();
    console.log(`[Lido] Approval confirmed`);
  }

  /**
   * Get stETH address
   * 
   * @returns stETH contract address
   */
  getStETHAddress(): string {
    return this.stETHAddress;
  }

  /**
   * Get withdrawal queue address
   * 
   * @returns Withdrawal queue contract address
   */
  getWithdrawalQueueAddress(): string {
    return this.withdrawalQueueAddress;
  }

  /**
   * Get exchange rate (stETH per share)
   * 
   * @returns Exchange rate
   */
  async getExchangeRate(): Promise<bigint> {
    const totalPooledEther = await this.stETH.getTotalPooledEther();
    const totalShares = await this.stETH.getTotalShares();
    
    if (totalShares === 0n) {
      return ethers.parseEther('1');
    }

    return (totalPooledEther * ethers.parseEther('1')) / totalShares;
  }

  /**
   * Get pending withdrawal requests
   * 
   * @param requestIds Array of withdrawal request IDs
   * @returns Withdrawal status for each request
   */
  async getWithdrawalStatus(requestIds: bigint[]): Promise<any[]> {
    const statuses = await this.withdrawalQueue.getWithdrawalStatus(requestIds);
    return statuses;
  }

  /**
   * Claim finalized withdrawals
   * 
   * @param requestIds Array of withdrawal request IDs to claim
   * @returns Transaction hash
   */
  async claimWithdrawals(requestIds: bigint[]): Promise<string> {
    console.log(`[Lido] Claiming ${requestIds.length} withdrawal requests`);

    // Find checkpoint hints (required for claiming)
    const hints = await this.withdrawalQueue.findCheckpointHints(
      requestIds,
      1,
      await this.withdrawalQueue.getLastCheckpointIndex()
    );

    // Claim withdrawals
    const tx = await this.withdrawalQueue.claimWithdrawals(requestIds, hints);

    console.log(`[Lido] Claim transaction: ${tx.hash}`);

    // Wait for confirmation
    await tx.wait();

    console.log(`[Lido] Claim confirmed`);

    return tx.hash;
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
    const totalPooledEther = await this.stETH.getTotalPooledEther();
    return totalPooledEther;
  }
}
