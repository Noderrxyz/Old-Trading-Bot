/**
 * Morpho Blue Lending Adapter
 * 
 * Adapter for Morpho Blue lending protocol.
 * Supports Ethereum mainnet.
 * 
 * Protocol: https://morpho.org
 * Docs: https://docs.morpho.org/
 */

import { ethers } from 'ethers';
import { ILendingAdapter, AdapterPosition } from '../../types';

/**
 * Morpho Blue ABI (minimal interface)
 */
const MORPHO_BLUE_ABI = [
  'function supply(bytes32 marketId, uint256 assets, uint256 shares, address onBehalfOf, bytes calldata data) returns (uint256 assetsSupplied, uint256 sharesSupplied)',
  'function withdraw(bytes32 marketId, uint256 assets, uint256 shares, address onBehalfOf, address receiver) returns (uint256 assetsWithdrawn, uint256 sharesWithdrawn)',
  'function borrow(bytes32 marketId, uint256 assets, uint256 shares, address onBehalfOf, address receiver) returns (uint256 assetsBorrowed, uint256 sharesBorrowed)',
  'function repay(bytes32 marketId, uint256 assets, uint256 shares, address onBehalfOf, bytes calldata data) returns (uint256 assetsRepaid, uint256 sharesRepaid)',
  'function position(bytes32 marketId, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
  'function market(bytes32 marketId) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  'function idToMarketParams(bytes32 marketId) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)',
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
 * Morpho Blue contract address (Ethereum mainnet)
 */
const MORPHO_BLUE_ADDRESS = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';

/**
 * Morpho Blue Adapter Configuration
 */
export interface MorphoBlueAdapterConfig {
  provider: ethers.Provider;
  wallet: ethers.Wallet;
  chainId: number;
  marketId: string; // Market ID (bytes32)
  morphoAddress?: string; // Optional override
}

/**
 * Morpho Blue Lending Adapter
 * 
 * Implements ILendingAdapter for Morpho Blue protocol.
 */
export class MorphoBlueAdapter implements ILendingAdapter {
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private chainId: number;
  private marketId: string;
  private morpho: ethers.Contract;
  private morphoAddress: string;
  private loanToken: string = '';
  private collateralToken: string = '';

  constructor(config: MorphoBlueAdapterConfig) {
    this.provider = config.provider;
    this.wallet = config.wallet;
    this.chainId = config.chainId;
    this.marketId = config.marketId;

    // Only Ethereum mainnet supported
    if (config.chainId !== 1) {
      throw new Error('Morpho Blue only deployed on Ethereum mainnet');
    }

    // Get Morpho address
    this.morphoAddress = config.morphoAddress || MORPHO_BLUE_ADDRESS;

    // Initialize Morpho contract
    this.morpho = new ethers.Contract(
      this.morphoAddress,
      MORPHO_BLUE_ABI,
      this.wallet
    );
  }

  /**
   * Initialize adapter (fetch market parameters)
   */
  private async initialize(): Promise<void> {
    if (!this.loanToken) {
      const marketParams = await this.morpho.idToMarketParams(this.marketId);
      this.loanToken = marketParams.loanToken;
      this.collateralToken = marketParams.collateralToken;
    }
  }

  /**
   * Supply assets to Morpho Blue
   * 
   * @param token Token address to supply
   * @param amount Amount to supply
   * @returns Transaction hash
   */
  async supply(token: string, amount: bigint): Promise<string> {
    await this.initialize();

    console.log(`[MorphoBlue] Supplying ${ethers.formatUnits(amount, 18)} of ${token}`);

    // Approve Morpho to spend tokens
    await this.approveToken(token, amount);

    // Supply to Morpho (amount-based, not shares)
    const tx = await this.morpho.supply(
      this.marketId,
      amount,          // assets
      0n,              // shares (0 = use assets)
      this.wallet.address, // onBehalfOf
      '0x'             // data
    );

    console.log(`[MorphoBlue] Supply transaction: ${tx.hash}`);

    // Wait for confirmation
    await tx.wait();

    console.log(`[MorphoBlue] Supply confirmed`);

    return tx.hash;
  }

  /**
   * Withdraw assets from Morpho Blue
   * 
   * @param token Token address to withdraw
   * @param amount Amount to withdraw
   * @returns Transaction hash
   */
  async withdraw(token: string, amount: bigint): Promise<string> {
    await this.initialize();

    console.log(`[MorphoBlue] Withdrawing ${ethers.formatUnits(amount, 18)} of ${token}`);

    // Withdraw from Morpho (amount-based, not shares)
    const tx = await this.morpho.withdraw(
      this.marketId,
      amount,          // assets
      0n,              // shares (0 = use assets)
      this.wallet.address, // onBehalfOf
      this.wallet.address  // receiver
    );

    console.log(`[MorphoBlue] Withdraw transaction: ${tx.hash}`);

    // Wait for confirmation
    await tx.wait();

    console.log(`[MorphoBlue] Withdraw confirmed`);

    return tx.hash;
  }

  /**
   * Borrow assets from Morpho Blue
   * 
   * @param token Token address to borrow (must be loan token)
   * @param amount Amount to borrow
   * @returns Transaction hash
   */
  async borrow(token: string, amount: bigint): Promise<string> {
    await this.initialize();

    if (token.toLowerCase() !== this.loanToken.toLowerCase()) {
      throw new Error(
        `Can only borrow loan token (${this.loanToken}) in this market`
      );
    }

    console.log(`[MorphoBlue] Borrowing ${ethers.formatUnits(amount, 18)} of ${token}`);

    // Borrow from Morpho (amount-based, not shares)
    const tx = await this.morpho.borrow(
      this.marketId,
      amount,          // assets
      0n,              // shares (0 = use assets)
      this.wallet.address, // onBehalfOf
      this.wallet.address  // receiver
    );

    console.log(`[MorphoBlue] Borrow transaction: ${tx.hash}`);

    // Wait for confirmation
    await tx.wait();

    console.log(`[MorphoBlue] Borrow confirmed`);

    return tx.hash;
  }

  /**
   * Repay borrowed assets to Morpho Blue
   * 
   * @param token Token address to repay (must be loan token)
   * @param amount Amount to repay
   * @returns Transaction hash
   */
  async repay(token: string, amount: bigint): Promise<string> {
    await this.initialize();

    if (token.toLowerCase() !== this.loanToken.toLowerCase()) {
      throw new Error(
        `Can only repay loan token (${this.loanToken}) in this market`
      );
    }

    console.log(`[MorphoBlue] Repaying ${ethers.formatUnits(amount, 18)} of ${token}`);

    // Approve Morpho to spend tokens
    await this.approveToken(token, amount);

    // Repay to Morpho (amount-based, not shares)
    const tx = await this.morpho.repay(
      this.marketId,
      amount,          // assets
      0n,              // shares (0 = use assets)
      this.wallet.address, // onBehalfOf
      '0x'             // data
    );

    console.log(`[MorphoBlue] Repay transaction: ${tx.hash}`);

    // Wait for confirmation
    await tx.wait();

    console.log(`[MorphoBlue] Repay confirmed`);

    return tx.hash;
  }

  /**
   * Get current position in Morpho Blue
   * 
   * @param token Token address (optional)
   * @returns Adapter position
   */
  async getPosition(token?: string): Promise<AdapterPosition> {
    await this.initialize();

    // Get position (returns shares)
    const position = await this.morpho.position(this.marketId, this.wallet.address);
    const supplyShares = position.supplyShares;
    const borrowShares = position.borrowShares;
    const collateral = position.collateral;

    // Get market data to convert shares to assets
    const market = await this.morpho.market(this.marketId);
    const totalSupplyAssets = market.totalSupplyAssets;
    const totalSupplyShares = market.totalSupplyShares;
    const totalBorrowAssets = market.totalBorrowAssets;
    const totalBorrowShares = market.totalBorrowShares;

    // Convert shares to assets
    const supplied: bigint =
      totalSupplyShares > 0n
        ? BigInt((supplyShares * totalSupplyAssets) / totalSupplyShares)
        : 0n;

    const borrowed: bigint =
      totalBorrowShares > 0n
        ? BigInt((borrowShares * totalBorrowAssets) / totalBorrowShares)
        : 0n;

    // Calculate total value (supplied + collateral - borrowed)
    const totalValue = supplied + BigInt(collateral) - borrowed;

    // Get current supply APY
    const apy = await this.getAPY(this.loanToken);

    // Calculate health factor (collateral / borrowed)
    const healthFactor = borrowed > 0n ? Number(collateral) / Number(borrowed) : Infinity;

    return {
      totalValue,
      supplied: BigInt(supplied),
      borrowed: BigInt(borrowed),
      apy,
      healthFactor,
      metadata: {
        protocol: 'morpho-blue',
        chain: this.chainId,
        marketId: this.marketId,
        loanToken: this.loanToken,
        collateralToken: this.collateralToken,
        collateral: collateral.toString(),
      },
    };
  }

  /**
   * Get current supply APY for the market
   * 
   * @param token Token address (ignored, returns market APY)
   * @returns APY as percentage (e.g., 5.25 = 5.25%)
   */
  async getAPY(token?: string): Promise<number> {
    await this.initialize();

    // Get market data
    const market = await this.morpho.market(this.marketId);
    const totalSupplyAssets = market.totalSupplyAssets;
    const totalBorrowAssets = market.totalBorrowAssets;

    // Calculate utilization
    const utilization =
      totalSupplyAssets > 0n
        ? Number((totalBorrowAssets * 10000n) / totalSupplyAssets) / 100
        : 0;

    // Simplified APY calculation
    // In reality, Morpho uses an IRM (Interest Rate Model) contract
    // For now, we'll use a simple linear model
    const baseRate = 2.0; // 2% base
    const utilizationRate = utilization * 0.05; // 5% per 100% utilization
    const apy = baseRate + utilizationRate;

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

      // Check if Morpho contract is accessible
      const morphoAddress = await this.morpho.getAddress();
      if (morphoAddress !== this.morphoAddress) {
        return {
          healthy: false,
          reason: 'Morpho address mismatch',
        };
      }

      // Check if we can query market
      await this.morpho.market(this.marketId);

      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Approve token spending by Morpho
   * 
   * @param token Token address
   * @param amount Amount to approve
   */
  private async approveToken(token: string, amount: bigint): Promise<void> {
    const tokenContract = new ethers.Contract(token, ERC20_ABI, this.wallet);

    // Check current allowance
    const currentAllowance = await tokenContract.allowance(
      this.wallet.address,
      this.morphoAddress
    );

    // If allowance is sufficient, skip approval
    if (currentAllowance >= amount) {
      console.log(`[MorphoBlue] Sufficient allowance: ${ethers.formatUnits(currentAllowance, 18)}`);
      return;
    }

    // Approve Morpho to spend tokens
    console.log(`[MorphoBlue] Approving ${ethers.formatUnits(amount, 18)} tokens`);
    const tx = await tokenContract.approve(this.morphoAddress, amount);
    await tx.wait();
    console.log(`[MorphoBlue] Approval confirmed`);
  }

  /**
   * Get Morpho address
   * 
   * @returns Morpho contract address
   */
  getMorphoAddress(): string {
    return this.morphoAddress;
  }

  /**
   * Get market ID
   * 
   * @returns Market ID (bytes32)
   */
  getMarketId(): string {
    return this.marketId;
  }

  /**
   * Get loan token address
   * 
   * @returns Loan token address
   */
  async getLoanToken(): Promise<string> {
    await this.initialize();
    return this.loanToken;
  }

  /**
   * Get collateral token address
   * 
   * @returns Collateral token address
   */
  async getCollateralToken(): Promise<string> {
    await this.initialize();
    return this.collateralToken;
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
}
