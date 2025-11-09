/**
 * Spark Protocol Lending Adapter
 * 
 * Adapter for Spark Protocol (MakerDAO's lending protocol).
 * Supports Ethereum mainnet.
 * 
 * Protocol: https://spark.fi
 * Docs: https://docs.spark.fi/
 */

import { ethers } from 'ethers';
import { ILendingAdapter, AdapterPosition } from '../../types';

/**
 * Spark Pool ABI (Aave V3 fork)
 */
const SPARK_POOL_ABI = [
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
  'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)',
  'function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function getReserveData(address asset) view returns (uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt)',
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
 * Spark Pool address (Ethereum mainnet)
 */
const SPARK_POOL_ADDRESS = '0xC13e21B648A5Ee794902342038FF3aDAB66BE987';

/**
 * Interest rate modes
 */
enum InterestRateMode {
  NONE = 0,
  STABLE = 1,
  VARIABLE = 2,
}

/**
 * Spark Adapter Configuration
 */
export interface SparkAdapterConfig {
  provider: ethers.Provider;
  wallet: ethers.Wallet;
  chainId: number;
  poolAddress?: string; // Optional override
}

/**
 * Spark Protocol Lending Adapter
 * 
 * Implements ILendingAdapter for Spark Protocol.
 * Spark is a fork of Aave V3 by MakerDAO.
 */
export class SparkAdapter implements ILendingAdapter {
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private chainId: number;
  private pool: ethers.Contract;
  private poolAddress: string;

  constructor(config: SparkAdapterConfig) {
    this.provider = config.provider;
    this.wallet = config.wallet;
    this.chainId = config.chainId;

    // Only Ethereum mainnet supported
    if (config.chainId !== 1) {
      throw new Error('Spark Protocol only deployed on Ethereum mainnet');
    }

    // Get pool address
    this.poolAddress = config.poolAddress || SPARK_POOL_ADDRESS;

    // Initialize pool contract
    this.pool = new ethers.Contract(
      this.poolAddress,
      SPARK_POOL_ABI,
      this.wallet
    );
  }

  /**
   * Supply assets to Spark
   * 
   * @param token Token address to supply
   * @param amount Amount to supply
   * @returns Transaction hash
   */
  async supply(token: string, amount: bigint): Promise<string> {
    console.log(`[Spark] Supplying ${ethers.formatUnits(amount, 18)} of ${token}`);

    // Approve pool to spend tokens
    await this.approveToken(token, amount);

    // Supply to pool
    const tx = await this.pool.supply(
      token,
      amount,
      this.wallet.address, // onBehalfOf
      0                     // referralCode
    );

    console.log(`[Spark] Supply transaction: ${tx.hash}`);

    // Wait for confirmation
    await tx.wait();

    console.log(`[Spark] Supply confirmed`);

    return tx.hash;
  }

  /**
   * Withdraw assets from Spark
   * 
   * @param token Token address to withdraw
   * @param amount Amount to withdraw
   * @returns Transaction hash
   */
  async withdraw(token: string, amount: bigint): Promise<string> {
    console.log(`[Spark] Withdrawing ${ethers.formatUnits(amount, 18)} of ${token}`);

    // Withdraw from pool
    const tx = await this.pool.withdraw(
      token,
      amount,
      this.wallet.address // to
    );

    console.log(`[Spark] Withdraw transaction: ${tx.hash}`);

    // Wait for confirmation
    await tx.wait();

    console.log(`[Spark] Withdraw confirmed`);

    return tx.hash;
  }

  /**
   * Borrow assets from Spark
   * 
   * @param token Token address to borrow
   * @param amount Amount to borrow
   * @returns Transaction hash
   */
  async borrow(token: string, amount: bigint): Promise<string> {
    console.log(`[Spark] Borrowing ${ethers.formatUnits(amount, 18)} of ${token}`);

    // Borrow from pool (variable rate)
    const tx = await this.pool.borrow(
      token,
      amount,
      InterestRateMode.VARIABLE, // interestRateMode
      0,                          // referralCode
      this.wallet.address         // onBehalfOf
    );

    console.log(`[Spark] Borrow transaction: ${tx.hash}`);

    // Wait for confirmation
    await tx.wait();

    console.log(`[Spark] Borrow confirmed`);

    return tx.hash;
  }

  /**
   * Repay borrowed assets to Spark
   * 
   * @param token Token address to repay
   * @param amount Amount to repay
   * @returns Transaction hash
   */
  async repay(token: string, amount: bigint): Promise<string> {
    console.log(`[Spark] Repaying ${ethers.formatUnits(amount, 18)} of ${token}`);

    // Approve pool to spend tokens
    await this.approveToken(token, amount);

    // Repay to pool (variable rate)
    const tx = await this.pool.repay(
      token,
      amount,
      InterestRateMode.VARIABLE, // interestRateMode
      this.wallet.address         // onBehalfOf
    );

    console.log(`[Spark] Repay transaction: ${tx.hash}`);

    // Wait for confirmation
    await tx.wait();

    console.log(`[Spark] Repay confirmed`);

    return tx.hash;
  }

  /**
   * Get current position in Spark
   * 
   * @param token Token address (optional)
   * @returns Adapter position
   */
  async getPosition(token?: string): Promise<AdapterPosition> {
    // Get user account data
    const accountData = await this.pool.getUserAccountData(this.wallet.address);

    const totalCollateralBase = accountData.totalCollateralBase;
    const totalDebtBase = accountData.totalDebtBase;
    const healthFactor = accountData.healthFactor;

    // Calculate total value (collateral - debt)
    const totalValue = totalCollateralBase - totalDebtBase;

    // Get current supply APY (if token specified)
    let apy = 0;
    if (token) {
      apy = await this.getAPY(token);
    }

    // Convert health factor from 1e18 to decimal
    const healthFactorDecimal = Number(healthFactor) / 1e18;

    return {
      totalValue,
      supplied: totalCollateralBase,
      borrowed: totalDebtBase,
      apy,
      healthFactor: healthFactorDecimal,
      metadata: {
        protocol: 'spark',
        chain: this.chainId,
        availableBorrows: accountData.availableBorrowsBase.toString(),
        liquidationThreshold: accountData.currentLiquidationThreshold.toString(),
        ltv: accountData.ltv.toString(),
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
    // Get reserve data
    const reserveData = await this.pool.getReserveData(token);

    const currentLiquidityRate = reserveData.currentLiquidityRate;

    // Convert from ray (1e27) to APY percentage
    // APY = rate / 1e25 (converts ray to percentage)
    const apy = Number(currentLiquidityRate) / 1e25;

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

      // Check if we can query user data
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
      console.log(`[Spark] Sufficient allowance: ${ethers.formatUnits(currentAllowance, 18)}`);
      return;
    }

    // Approve pool to spend tokens
    console.log(`[Spark] Approving ${ethers.formatUnits(amount, 18)} tokens`);
    const tx = await tokenContract.approve(this.poolAddress, amount);
    await tx.wait();
    console.log(`[Spark] Approval confirmed`);
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
   * Get borrow APY for a token
   * 
   * @param token Token address
   * @returns Borrow APY as percentage
   */
  async getBorrowAPY(token: string): Promise<number> {
    // Get reserve data
    const reserveData = await this.pool.getReserveData(token);

    const currentVariableBorrowRate = reserveData.currentVariableBorrowRate;

    // Convert from ray (1e27) to APY percentage
    const apy = Number(currentVariableBorrowRate) / 1e25;

    return apy;
  }

  /**
   * Get stable borrow APY for a token
   * 
   * @param token Token address
   * @returns Stable borrow APY as percentage
   */
  async getStableBorrowAPY(token: string): Promise<number> {
    // Get reserve data
    const reserveData = await this.pool.getReserveData(token);

    const currentStableBorrowRate = reserveData.currentStableBorrowRate;

    // Convert from ray (1e27) to APY percentage
    const apy = Number(currentStableBorrowRate) / 1e25;

    return apy;
  }
}
