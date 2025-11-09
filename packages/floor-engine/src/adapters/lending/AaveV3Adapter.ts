/**
 * Aave V3 Lending Adapter
 * 
 * Adapter for Aave V3 lending protocol.
 * Supports Ethereum, Arbitrum, Optimism, and Base.
 * 
 * Protocol: https://aave.com
 * Docs: https://docs.aave.com/developers/
 */

import { ethers } from 'ethers';
import { ILendingAdapter, AdapterPosition } from '../../types';

/**
 * Aave V3 Pool ABI (minimal interface)
 */
const AAVE_V3_POOL_ABI = [
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
  'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)',
  'function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function getReserveData(address asset) view returns (tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))',
];

/**
 * aToken ABI (minimal interface)
 */
const ATOKEN_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function UNDERLYING_ASSET_ADDRESS() view returns (address)',
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
 * Aave V3 Pool addresses by chain
 */
const AAVE_V3_POOLS: Record<number, string> = {
  1: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',     // Ethereum
  42161: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',  // Arbitrum
  10: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',     // Optimism
  8453: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',   // Base
};

/**
 * Aave V3 Adapter Configuration
 */
export interface AaveV3AdapterConfig {
  provider: ethers.Provider;
  wallet: ethers.Wallet;
  chainId: number;
  poolAddress?: string; // Optional override
}

/**
 * Aave V3 Lending Adapter
 * 
 * Implements ILendingAdapter for Aave V3 protocol.
 */
export class AaveV3Adapter implements ILendingAdapter {
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private chainId: number;
  private pool: ethers.Contract;
  private poolAddress: string;

  constructor(config: AaveV3AdapterConfig) {
    this.provider = config.provider;
    this.wallet = config.wallet;
    this.chainId = config.chainId;

    // Get pool address
    this.poolAddress = config.poolAddress || AAVE_V3_POOLS[config.chainId];
    if (!this.poolAddress) {
      throw new Error(`Aave V3 not deployed on chain ${config.chainId}`);
    }

    // Initialize pool contract
    this.pool = new ethers.Contract(
      this.poolAddress,
      AAVE_V3_POOL_ABI,
      this.wallet
    );
  }

  /**
   * Supply assets to Aave V3
   * 
   * @param token Token address to supply
   * @param amount Amount to supply
   * @returns Transaction hash
   */
  async supply(token: string, amount: bigint): Promise<string> {
    console.log(`[AaveV3] Supplying ${ethers.formatUnits(amount, 18)} of ${token}`);

    // Approve pool to spend tokens
    await this.approveToken(token, amount);

    // Supply to pool
    const tx = await this.pool.supply(
      token,
      amount,
      this.wallet.address,
      0 // referralCode
    );

    console.log(`[AaveV3] Supply transaction: ${tx.hash}`);

    // Wait for confirmation
    await tx.wait();

    console.log(`[AaveV3] Supply confirmed`);

    return tx.hash;
  }

  /**
   * Withdraw assets from Aave V3
   * 
   * @param token Token address to withdraw
   * @param amount Amount to withdraw (use MaxUint256 for all)
   * @returns Transaction hash
   */
  async withdraw(token: string, amount: bigint): Promise<string> {
    console.log(`[AaveV3] Withdrawing ${ethers.formatUnits(amount, 18)} of ${token}`);

    // Withdraw from pool
    const tx = await this.pool.withdraw(
      token,
      amount,
      this.wallet.address
    );

    console.log(`[AaveV3] Withdraw transaction: ${tx.hash}`);

    // Wait for confirmation
    await tx.wait();

    console.log(`[AaveV3] Withdraw confirmed`);

    return tx.hash;
  }

  /**
   * Borrow assets from Aave V3
   * 
   * @param token Token address to borrow
   * @param amount Amount to borrow
   * @returns Transaction hash
   */
  async borrow(token: string, amount: bigint): Promise<string> {
    console.log(`[AaveV3] Borrowing ${ethers.formatUnits(amount, 18)} of ${token}`);

    // Borrow from pool (variable rate = 2)
    const tx = await this.pool.borrow(
      token,
      amount,
      2, // interestRateMode (2 = variable)
      0, // referralCode
      this.wallet.address
    );

    console.log(`[AaveV3] Borrow transaction: ${tx.hash}`);

    // Wait for confirmation
    await tx.wait();

    console.log(`[AaveV3] Borrow confirmed`);

    return tx.hash;
  }

  /**
   * Repay borrowed assets to Aave V3
   * 
   * @param token Token address to repay
   * @param amount Amount to repay (use MaxUint256 for all)
   * @returns Transaction hash
   */
  async repay(token: string, amount: bigint): Promise<string> {
    console.log(`[AaveV3] Repaying ${ethers.formatUnits(amount, 18)} of ${token}`);

    // Approve pool to spend tokens
    await this.approveToken(token, amount);

    // Repay to pool (variable rate = 2)
    const tx = await this.pool.repay(
      token,
      amount,
      2, // interestRateMode (2 = variable)
      this.wallet.address
    );

    console.log(`[AaveV3] Repay transaction: ${tx.hash}`);

    // Wait for confirmation
    await tx.wait();

    console.log(`[AaveV3] Repay confirmed`);

    return tx.hash;
  }

  /**
   * Get current position in Aave V3
   * 
   * @param token Token address (optional, returns all if not specified)
   * @returns Adapter position
   */
  async getPosition(token?: string): Promise<AdapterPosition> {
    // Get user account data
    const accountData = await this.pool.getUserAccountData(this.wallet.address);

    const totalCollateral = accountData.totalCollateralBase;
    const totalDebt = accountData.totalDebtBase;
    const healthFactor = accountData.healthFactor;

    // If specific token requested, get aToken balance
    let tokenBalance = 0n;
    let tokenDebt = 0n;
    let apy = 0;

    if (token) {
      const reserveData = await this.pool.getReserveData(token);
      const aTokenAddress = reserveData.aTokenAddress;

      // Get aToken balance (represents supplied amount)
      const aToken = new ethers.Contract(aTokenAddress, ATOKEN_ABI, this.provider);
      tokenBalance = await aToken.balanceOf(this.wallet.address);

      // Get current supply APY
      apy = await this.getAPY(token);

      // TODO: Get debt balance (requires querying debt tokens)
    }

    return {
      totalValue: totalCollateral,
      supplied: token ? tokenBalance : totalCollateral,
      borrowed: token ? tokenDebt : totalDebt,
      apy,
      healthFactor: Number(healthFactor) / 1e18, // Convert from 18 decimals
      metadata: {
        protocol: 'aave-v3',
        chain: this.chainId,
        poolAddress: this.poolAddress,
      },
    };
  }

  /**
   * Get current supply APY for a token
   * 
   * @param token Token address
   * @returns APY as percentage (e.g., 5.25 = 5.25%)
   */
  async getAPY(token: string): Promise<number> {
    const reserveData = await this.pool.getReserveData(token);

    // Current liquidity rate is in Ray (27 decimals)
    const liquidityRate = reserveData.currentLiquidityRate;

    // Convert to APY percentage
    // APY = (1 + rate/seconds_per_year)^seconds_per_year - 1
    // Simplified: rate * 100 / 1e27 (approximate)
    const apy = Number(liquidityRate) / 1e25; // Convert from Ray to percentage

    return apy;
  }

  /**
   * Perform health check on the adapter
   * 
   * @returns Health check result
   */
  async healthCheck(): Promise<{ healthy: boolean; reason?: string }> {
    try {
      // Check if pool contract is accessible
      const poolAddress = await this.pool.getAddress();
      if (poolAddress !== this.poolAddress) {
        return {
          healthy: false,
          reason: 'Pool address mismatch',
        };
      }

      // Check if we can query account data
      await this.pool.getUserAccountData(this.wallet.address);

      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Approve token spending by pool
   * 
   * @param token Token address
   * @param amount Amount to approve
   */
  private async approveToken(token: string, amount: bigint): Promise<void> {
    const tokenContract = new ethers.Contract(token, ERC20_ABI, this.wallet);

    // Check current allowance
    const currentAllowance = await tokenContract.allowance(
      this.wallet.address,
      this.poolAddress
    );

    // If allowance is sufficient, skip approval
    if (currentAllowance >= amount) {
      console.log(`[AaveV3] Sufficient allowance: ${ethers.formatUnits(currentAllowance, 18)}`);
      return;
    }

    // Approve pool to spend tokens
    console.log(`[AaveV3] Approving ${ethers.formatUnits(amount, 18)} tokens`);
    const tx = await tokenContract.approve(this.poolAddress, amount);
    await tx.wait();
    console.log(`[AaveV3] Approval confirmed`);
  }

  /**
   * Get pool address
   * 
   * @returns Pool contract address
   */
  getPoolAddress(): string {
    return this.poolAddress;
  }

  /**
   * Get supported chain IDs
   * 
   * @returns Array of supported chain IDs
   */
  static getSupportedChains(): number[] {
    return Object.keys(AAVE_V3_POOLS).map(Number);
  }

  /**
   * Check if chain is supported
   * 
   * @param chainId Chain ID to check
   * @returns True if supported
   */
  static isChainSupported(chainId: number): boolean {
    return chainId in AAVE_V3_POOLS;
  }
}
