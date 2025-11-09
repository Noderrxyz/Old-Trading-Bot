import { ethers } from 'ethers';

/**
 * Slippage protection configuration
 */
export interface SlippageConfig {
  maxSlippageBps: number; // Max slippage in basis points (100 = 1%)
  priceImpactThresholdBps: number; // Price impact threshold for warnings
  enableSimulation: boolean; // Enable transaction simulation
  enablePriceChecks: boolean; // Enable pre/post price checks
}

/**
 * Slippage check result
 */
export interface SlippageCheckResult {
  safe: boolean;
  expectedAmount: bigint;
  minAmount: bigint;
  maxAmount: bigint;
  slippageBps: number;
  priceImpactBps: number;
  warnings: string[];
  errors: string[];
}

/**
 * Price quote for slippage calculation
 */
export interface PriceQuote {
  inputAmount: bigint;
  outputAmount: bigint;
  priceImpactBps: number;
  route?: string[];
}

/**
 * Slippage protection system
 * 
 * Features:
 * - Pre-transaction slippage checks
 * - Transaction simulation
 * - Price impact analysis
 * - Minimum output amount calculation
 * - Post-transaction verification
 */
export class SlippageProtection {
  private config: SlippageConfig;
  private provider: ethers.Provider;

  constructor(provider: ethers.Provider, config?: Partial<SlippageConfig>) {
    this.provider = provider;
    this.config = {
      maxSlippageBps: config?.maxSlippageBps ?? 50, // 0.5% default
      priceImpactThresholdBps: config?.priceImpactThresholdBps ?? 100, // 1% warning threshold
      enableSimulation: config?.enableSimulation ?? true,
      enablePriceChecks: config?.enablePriceChecks ?? true,
    };
  }

  /**
   * Check slippage for a swap operation
   */
  async checkSwapSlippage(
    inputToken: string,
    outputToken: string,
    inputAmount: bigint,
    expectedOutput: bigint,
    poolAddress?: string
  ): Promise<SlippageCheckResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Calculate minimum output with slippage
    const minOutput = this.calculateMinOutput(expectedOutput, this.config.maxSlippageBps);
    const maxOutput = this.calculateMaxOutput(expectedOutput, this.config.maxSlippageBps);

    // Calculate price impact (simplified - would need pool data for accurate calculation)
    const priceImpactBps = this.estimatePriceImpact(inputAmount, expectedOutput);

    // Check if price impact exceeds threshold
    if (priceImpactBps > this.config.priceImpactThresholdBps) {
      warnings.push(`High price impact: ${(priceImpactBps / 100).toFixed(2)}%`);
    }

    // Check if price impact exceeds max slippage
    if (priceImpactBps > this.config.maxSlippageBps) {
      errors.push(`Price impact (${(priceImpactBps / 100).toFixed(2)}%) exceeds max slippage (${(this.config.maxSlippageBps / 100).toFixed(2)}%)`);
    }

    // Simulate transaction if enabled
    if (this.config.enableSimulation && poolAddress) {
      try {
        await this.simulateSwap(inputToken, outputToken, inputAmount, minOutput, poolAddress);
      } catch (error: any) {
        errors.push(`Simulation failed: ${error.message}`);
      }
    }

    return {
      safe: errors.length === 0,
      expectedAmount: expectedOutput,
      minAmount: minOutput,
      maxAmount: maxOutput,
      slippageBps: this.config.maxSlippageBps,
      priceImpactBps,
      warnings,
      errors,
    };
  }

  /**
   * Check slippage for a liquidity operation (add/remove)
   */
  async checkLiquiditySlippage(
    token0: string,
    token1: string,
    amount0: bigint,
    amount1: bigint,
    expectedLpTokens: bigint,
    poolAddress: string
  ): Promise<SlippageCheckResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Calculate minimum LP tokens with slippage
    const minLpTokens = this.calculateMinOutput(expectedLpTokens, this.config.maxSlippageBps);
    const maxLpTokens = this.calculateMaxOutput(expectedLpTokens, this.config.maxSlippageBps);

    // Estimate price impact (simplified)
    const priceImpactBps = this.estimateLiquidityPriceImpact(amount0, amount1);

    // Check if price impact exceeds threshold
    if (priceImpactBps > this.config.priceImpactThresholdBps) {
      warnings.push(`High price impact: ${(priceImpactBps / 100).toFixed(2)}%`);
    }

    // Check if price impact exceeds max slippage
    if (priceImpactBps > this.config.maxSlippageBps) {
      errors.push(`Price impact (${(priceImpactBps / 100).toFixed(2)}%) exceeds max slippage (${(this.config.maxSlippageBps / 100).toFixed(2)}%)`);
    }

    return {
      safe: errors.length === 0,
      expectedAmount: expectedLpTokens,
      minAmount: minLpTokens,
      maxAmount: maxLpTokens,
      slippageBps: this.config.maxSlippageBps,
      priceImpactBps,
      warnings,
      errors,
    };
  }

  /**
   * Check slippage for lending operations (supply/borrow)
   */
  async checkLendingSlippage(
    token: string,
    amount: bigint,
    expectedShares: bigint,
    protocolAddress: string
  ): Promise<SlippageCheckResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Calculate minimum shares with slippage
    const minShares = this.calculateMinOutput(expectedShares, this.config.maxSlippageBps);
    const maxShares = this.calculateMaxOutput(expectedShares, this.config.maxSlippageBps);

    // Lending operations typically have minimal slippage
    const priceImpactBps = 1; // Minimal impact for lending

    return {
      safe: true,
      expectedAmount: expectedShares,
      minAmount: minShares,
      maxAmount: maxShares,
      slippageBps: this.config.maxSlippageBps,
      priceImpactBps,
      warnings,
      errors,
    };
  }

  /**
   * Verify post-transaction slippage
   */
  async verifyPostTransactionSlippage(
    txHash: string,
    expectedAmount: bigint,
    minAmount: bigint,
    maxAmount: bigint
  ): Promise<{ success: boolean; actualAmount: bigint; withinBounds: boolean }> {
    // Get transaction receipt
    const receipt = await this.provider.getTransactionReceipt(txHash);
    if (!receipt) {
      throw new Error('Transaction receipt not found');
    }

    // Parse logs to get actual amount (simplified - would need ABI parsing)
    // This is a placeholder - real implementation would parse Transfer events
    const actualAmount = expectedAmount; // Placeholder

    // Check if within bounds
    const withinBounds = actualAmount >= minAmount && actualAmount <= maxAmount;

    return {
      success: receipt.status === 1,
      actualAmount,
      withinBounds,
    };
  }

  /**
   * Calculate minimum output amount with slippage
   */
  private calculateMinOutput(expectedAmount: bigint, slippageBps: number): bigint {
    const slippageMultiplier = BigInt(10000 - slippageBps);
    return (expectedAmount * slippageMultiplier) / 10000n;
  }

  /**
   * Calculate maximum output amount with slippage
   */
  private calculateMaxOutput(expectedAmount: bigint, slippageBps: number): bigint {
    const slippageMultiplier = BigInt(10000 + slippageBps);
    return (expectedAmount * slippageMultiplier) / 10000n;
  }

  /**
   * Estimate price impact for swap (simplified)
   */
  private estimatePriceImpact(inputAmount: bigint, outputAmount: bigint): number {
    // This is a simplified estimation
    // Real implementation would query pool reserves and calculate exact impact
    if (inputAmount === 0n || outputAmount === 0n) {
      return 0;
    }

    // Placeholder: assume 0.1% impact per $100k trade
    // Real implementation would use: impact = (inputAmount / poolLiquidity) * 10000
    return 10; // 0.1% placeholder
  }

  /**
   * Estimate price impact for liquidity operations (simplified)
   */
  private estimateLiquidityPriceImpact(amount0: bigint, amount1: bigint): number {
    // Liquidity operations typically have minimal price impact
    return 5; // 0.05% placeholder
  }

  /**
   * Simulate swap transaction
   */
  private async simulateSwap(
    inputToken: string,
    outputToken: string,
    inputAmount: bigint,
    minOutput: bigint,
    poolAddress: string
  ): Promise<void> {
    // This would use eth_call to simulate the transaction
    // Simplified implementation - real version would construct proper calldata
    try {
      await this.provider.call({
        to: poolAddress,
        data: '0x', // Placeholder - would be actual swap calldata
      });
    } catch (error: any) {
      throw new Error(`Simulation failed: ${error.message}`);
    }
  }

  /**
   * Get current slippage configuration
   */
  getConfig(): SlippageConfig {
    return { ...this.config };
  }

  /**
   * Update slippage configuration
   */
  updateConfig(config: Partial<SlippageConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * Calculate slippage percentage from amounts
   */
  calculateSlippagePercentage(expected: bigint, actual: bigint): number {
    if (expected === 0n) {
      return 0;
    }

    const diff = expected > actual ? expected - actual : actual - expected;
    return Number((diff * 10000n) / expected);
  }

  /**
   * Check if slippage is acceptable
   */
  isSlippageAcceptable(expected: bigint, actual: bigint): boolean {
    const slippageBps = this.calculateSlippagePercentage(expected, actual);
    return slippageBps <= this.config.maxSlippageBps;
  }
}
