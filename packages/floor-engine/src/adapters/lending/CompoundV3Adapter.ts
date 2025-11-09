/**
 * Compound V3 (Comet) Lending Adapter
 * 
 * Adapter for Compound V3 lending protocol.
 * Supports Ethereum, Arbitrum, and Base.
 * 
 * Protocol: https://compound.finance
 * Docs: https://docs.compound.finance/
 */

import { ethers } from 'ethers';
import { ILendingAdapter, AdapterPosition } from '../../types';

/**
 * Compound V3 Comet ABI (minimal interface)
 */
const COMPOUND_V3_COMET_ABI = [
  'function supply(address asset, uint256 amount)',
  'function withdraw(address asset, uint256 amount)',
  'function borrow(uint256 amount)',
  'function repay(uint256 amount)',
  'function balanceOf(address account) view returns (uint256)',
  'function borrowBalanceOf(address account) view returns (uint256)',
  'function getSupplyRate(uint256 utilization) view returns (uint64)',
  'function getBorrowRate(uint256 utilization) view returns (uint64)',
  'function getUtilization() view returns (uint256)',
  'function baseToken() view returns (address)',
  'function baseTokenPriceFeed() view returns (address)',
  'function getPrice(address priceFeed) view returns (uint256)',
];

/**
 * ERC20 ABI (minimal interface)
 */
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

/**
 * Compound V3 Comet addresses by chain and market
 * 
 * Format: { chainId: { baseToken: cometAddress } }
 */
const COMPOUND_V3_COMETS: Record<number, Record<string, string>> = {
  // Ethereum
  1: {
    'USDC': '0xc3d688B66703497DAA19211EEdff47f25384cdc3',  // cUSDCv3
    'WETH': '0xA17581A9E3356d9A858b789D68B4d866e593aE94',  // cWETHv3
  },
  // Arbitrum
  42161: {
    'USDC': '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA',  // cUSDCv3
    'USDC.e': '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf', // cUSDC.ev3
  },
  // Base
  8453: {
    'USDbC': '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf', // cUSDbCv3
    'WETH': '0x46e6b214b524310239732D51387075E0e70970bf',  // cWETHv3
  },
};

/**
 * Compound V3 Adapter Configuration
 */
export interface CompoundV3AdapterConfig {
  provider: ethers.Provider;
  wallet: ethers.Wallet;
  chainId: number;
  baseToken: string; // e.g., 'USDC', 'WETH'
  cometAddress?: string; // Optional override
}

/**
 * Compound V3 Lending Adapter
 * 
 * Implements ILendingAdapter for Compound V3 protocol.
 */
export class CompoundV3Adapter implements ILendingAdapter {
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private chainId: number;
  private baseToken: string;
  private comet: ethers.Contract;
  private cometAddress: string;
  private baseTokenAddress: string;

  constructor(config: CompoundV3AdapterConfig) {
    this.provider = config.provider;
    this.wallet = config.wallet;
    this.chainId = config.chainId;
    this.baseToken = config.baseToken;

    // Get comet address
    this.cometAddress =
      config.cometAddress ||
      COMPOUND_V3_COMETS[config.chainId]?.[config.baseToken];

    if (!this.cometAddress) {
      throw new Error(
        `Compound V3 ${config.baseToken} market not deployed on chain ${config.chainId}`
      );
    }

    // Initialize comet contract
    this.comet = new ethers.Contract(
      this.cometAddress,
      COMPOUND_V3_COMET_ABI,
      this.wallet
    );

    // Base token address will be fetched on first use
    this.baseTokenAddress = '';
  }

  /**
   * Initialize adapter (fetch base token address)
   */
  private async initialize(): Promise<void> {
    if (!this.baseTokenAddress) {
      this.baseTokenAddress = await this.comet.baseToken();
    }
  }

  /**
   * Supply assets to Compound V3
   * 
   * @param token Token address to supply
   * @param amount Amount to supply
   * @returns Transaction hash
   */
  async supply(token: string, amount: bigint): Promise<string> {
    await this.initialize();

    console.log(`[CompoundV3] Supplying ${ethers.formatUnits(amount, 18)} of ${token}`);

    // Approve comet to spend tokens
    await this.approveToken(token, amount);

    // Supply to comet
    const tx = await this.comet.supply(token, amount);

    console.log(`[CompoundV3] Supply transaction: ${tx.hash}`);

    // Wait for confirmation
    await tx.wait();

    console.log(`[CompoundV3] Supply confirmed`);

    return tx.hash;
  }

  /**
   * Withdraw assets from Compound V3
   * 
   * @param token Token address to withdraw
   * @param amount Amount to withdraw
   * @returns Transaction hash
   */
  async withdraw(token: string, amount: bigint): Promise<string> {
    await this.initialize();

    console.log(`[CompoundV3] Withdrawing ${ethers.formatUnits(amount, 18)} of ${token}`);

    // Withdraw from comet
    const tx = await this.comet.withdraw(token, amount);

    console.log(`[CompoundV3] Withdraw transaction: ${tx.hash}`);

    // Wait for confirmation
    await tx.wait();

    console.log(`[CompoundV3] Withdraw confirmed`);

    return tx.hash;
  }

  /**
   * Borrow base token from Compound V3
   * 
   * Note: In Compound V3, you can only borrow the base token
   * 
   * @param token Token address (must be base token)
   * @param amount Amount to borrow
   * @returns Transaction hash
   */
  async borrow(token: string, amount: bigint): Promise<string> {
    await this.initialize();

    if (token.toLowerCase() !== this.baseTokenAddress.toLowerCase()) {
      throw new Error(
        `Can only borrow base token (${this.baseTokenAddress}) in Compound V3`
      );
    }

    console.log(`[CompoundV3] Borrowing ${ethers.formatUnits(amount, 18)} of ${token}`);

    // Borrow from comet
    const tx = await this.comet.borrow(amount);

    console.log(`[CompoundV3] Borrow transaction: ${tx.hash}`);

    // Wait for confirmation
    await tx.wait();

    console.log(`[CompoundV3] Borrow confirmed`);

    return tx.hash;
  }

  /**
   * Repay borrowed base token to Compound V3
   * 
   * @param token Token address (must be base token)
   * @param amount Amount to repay
   * @returns Transaction hash
   */
  async repay(token: string, amount: bigint): Promise<string> {
    await this.initialize();

    if (token.toLowerCase() !== this.baseTokenAddress.toLowerCase()) {
      throw new Error(
        `Can only repay base token (${this.baseTokenAddress}) in Compound V3`
      );
    }

    console.log(`[CompoundV3] Repaying ${ethers.formatUnits(amount, 18)} of ${token}`);

    // Approve comet to spend tokens
    await this.approveToken(token, amount);

    // Repay to comet
    const tx = await this.comet.repay(amount);

    console.log(`[CompoundV3] Repay transaction: ${tx.hash}`);

    // Wait for confirmation
    await tx.wait();

    console.log(`[CompoundV3] Repay confirmed`);

    return tx.hash;
  }

  /**
   * Get current position in Compound V3
   * 
   * @param token Token address (optional)
   * @returns Adapter position
   */
  async getPosition(token?: string): Promise<AdapterPosition> {
    await this.initialize();

    // Get supplied balance (in base token)
    const supplied = await this.comet.balanceOf(this.wallet.address);

    // Get borrowed balance (in base token)
    const borrowed = await this.comet.borrowBalanceOf(this.wallet.address);

    // Calculate total value (supplied - borrowed)
    const totalValue = BigInt(supplied) - BigInt(borrowed);

    // Get current supply APY
    const apy = await this.getAPY(this.baseTokenAddress);

    // Calculate health factor (simplified)
    // In Compound V3, health is determined by collateral value vs borrow value
    // For simplicity, we'll use (supplied / borrowed) ratio
    const healthFactor = borrowed > 0n ? Number(supplied) / Number(borrowed) : Infinity;

    return {
      totalValue,
      supplied,
      borrowed,
      apy,
      healthFactor,
      metadata: {
        protocol: 'compound-v3',
        chain: this.chainId,
        market: this.baseToken,
        cometAddress: this.cometAddress,
      },
    };
  }

  /**
   * Get current supply APY for base token
   * 
   * @param token Token address (ignored, always returns base token APY)
   * @returns APY as percentage (e.g., 5.25 = 5.25%)
   */
  async getAPY(token?: string): Promise<number> {
    await this.initialize();

    // Get current utilization
    const utilization = await this.comet.getUtilization();

    // Get supply rate for current utilization
    const supplyRate = await this.comet.getSupplyRate(utilization);

    // Convert from per-second rate to APY
    // APY = (1 + rate)^(seconds_per_year) - 1
    // Simplified: rate * seconds_per_year * 100
    const SECONDS_PER_YEAR = 31536000n;
    const apy = (Number(supplyRate) * Number(SECONDS_PER_YEAR)) / 1e16; // Convert to percentage

    return apy;
  }

  /**
   * Perform health check on the adapter
   * 
   * @returns Health check result
   */
  async healthCheck(): Promise<{ healthy: boolean; reason?: string }> {
    try {
      await this.initialize();

      // Check if comet contract is accessible
      const cometAddress = await this.comet.getAddress();
      if (cometAddress !== this.cometAddress) {
        return {
          healthy: false,
          reason: 'Comet address mismatch',
        };
      }

      // Check if we can query balance
      await this.comet.balanceOf(this.wallet.address);

      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Approve token spending by comet
   * 
   * @param token Token address
   * @param amount Amount to approve
   */
  private async approveToken(token: string, amount: bigint): Promise<void> {
    const tokenContract = new ethers.Contract(token, ERC20_ABI, this.wallet);

    // Check current allowance
    const currentAllowance = await tokenContract.allowance(
      this.wallet.address,
      this.cometAddress
    );

    // If allowance is sufficient, skip approval
    if (currentAllowance >= amount) {
      console.log(`[CompoundV3] Sufficient allowance: ${ethers.formatUnits(currentAllowance, 18)}`);
      return;
    }

    // Approve comet to spend tokens
    console.log(`[CompoundV3] Approving ${ethers.formatUnits(amount, 18)} tokens`);
    const tx = await tokenContract.approve(this.cometAddress, amount);
    await tx.wait();
    console.log(`[CompoundV3] Approval confirmed`);
  }

  /**
   * Get comet address
   * 
   * @returns Comet contract address
   */
  getCometAddress(): string {
    return this.cometAddress;
  }

  /**
   * Get base token address
   * 
   * @returns Base token address
   */
  async getBaseTokenAddress(): Promise<string> {
    await this.initialize();
    return this.baseTokenAddress;
  }

  /**
   * Get supported chains
   * 
   * @returns Array of supported chain IDs
   */
  static getSupportedChains(): number[] {
    return Object.keys(COMPOUND_V3_COMETS).map(Number);
  }

  /**
   * Get supported markets for a chain
   * 
   * @param chainId Chain ID
   * @returns Array of supported base tokens
   */
  static getSupportedMarkets(chainId: number): string[] {
    return Object.keys(COMPOUND_V3_COMETS[chainId] || {});
  }

  /**
   * Check if chain and market are supported
   * 
   * @param chainId Chain ID
   * @param baseToken Base token symbol
   * @returns True if supported
   */
  static isMarketSupported(chainId: number, baseToken: string): boolean {
    return baseToken in (COMPOUND_V3_COMETS[chainId] || {});
  }
}
