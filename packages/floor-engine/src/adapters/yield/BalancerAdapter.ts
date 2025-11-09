import { ethers } from 'ethers';
import type { AdapterPosition } from '../../types';

/**
 * Configuration for Balancer adapter
 */
export interface BalancerAdapterConfig {
  provider: ethers.Provider;
  wallet: ethers.Wallet;
  chainId: number;
}

/**
 * Join/Exit kind for Balancer pools
 */
enum JoinKind {
  INIT = 0,
  EXACT_TOKENS_IN_FOR_BPT_OUT = 1,
  TOKEN_IN_FOR_EXACT_BPT_OUT = 2,
  ALL_TOKENS_IN_FOR_EXACT_BPT_OUT = 3,
}

enum ExitKind {
  EXACT_BPT_IN_FOR_ONE_TOKEN_OUT = 0,
  EXACT_BPT_IN_FOR_TOKENS_OUT = 1,
  BPT_IN_FOR_EXACT_TOKENS_OUT = 2,
}

/**
 * Balancer V2 Adapter
 * 
 * Provides access to Balancer V2 weighted pools for liquidity provision and yield farming.
 * Balancer uses a single Vault contract to hold all pool tokens and manage swaps/joins/exits.
 * 
 * Features:
 * - Join pools (add liquidity) through Vault
 * - Exit pools (remove liquidity) through Vault
 * - Stake BPT tokens in gauges to earn BAL rewards
 * - Claim BAL rewards
 * - Support for weighted pools (e.g., 80/20 BAL/ETH)
 * 
 * @example
 * ```typescript
 * const balancer = new BalancerAdapter({ provider, wallet, chainId: 1 });
 * 
 * // Join 80/20 BAL/ETH pool
 * await balancer.joinPool(
 *   poolId,
 *   [balAmount, ethAmount],
 *   minBptOut
 * );
 * 
 * // Stake BPT in gauge
 * await balancer.stakeInGauge(gauge, bptAmount);
 * 
 * // Claim BAL rewards
 * await balancer.claimRewards(gauge);
 * ```
 */
export class BalancerAdapter {
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private chainId: number;
  private vault: ethers.Contract;
  private balToken: ethers.Contract;

  // Contract addresses (Ethereum mainnet)
  private static readonly VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';
  private static readonly BAL_TOKEN_ADDRESS = '0xba100000625a3754423978a60c9317c58a424e3D';
  private static readonly BALANCER_HELPERS_ADDRESS = '0x5aDDCCa35b7A0D07C74063c48700C8590E87864E';

  // Vault ABI
  private static readonly VAULT_ABI = [
    'function joinPool(bytes32 poolId, address sender, address recipient, tuple(address[] assets, uint256[] maxAmountsIn, bytes userData, bool fromInternalBalance) request) payable',
    'function exitPool(bytes32 poolId, address sender, address payable recipient, tuple(address[] assets, uint256[] minAmountsOut, bytes userData, bool toInternalBalance) request)',
    'function getPoolTokens(bytes32 poolId) view returns (address[] tokens, uint256[] balances, uint256 lastChangeBlock)',
    'function getPool(bytes32 poolId) view returns (address, uint8)',
  ];

  // Pool ABI (Weighted Pool)
  private static readonly POOL_ABI = [
    'function getPoolId() view returns (bytes32)',
    'function getVault() view returns (address)',
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address account) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function getNormalizedWeights() view returns (uint256[])',
    'function getSwapFeePercentage() view returns (uint256)',
  ];

  // Liquidity Gauge ABI
  private static readonly GAUGE_ABI = [
    'function deposit(uint256 _value) returns ()',
    'function deposit(uint256 _value, address _addr, bool _claim_rewards) returns ()',
    'function withdraw(uint256 _value) returns ()',
    'function withdraw(uint256 _value, bool _claim_rewards) returns ()',
    'function balanceOf(address arg0) view returns (uint256)',
    'function claimable_tokens(address addr) view returns (uint256)',
    'function claim_rewards() returns ()',
    'function claim_rewards(address _addr) returns ()',
    'function claim_rewards(address _addr, address _receiver) returns ()',
    'function lp_token() view returns (address)',
  ];

  // ERC20 ABI
  private static readonly ERC20_ABI = [
    'function balanceOf(address account) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function name() view returns (string)',
  ];

  constructor(config: BalancerAdapterConfig) {
    this.provider = config.provider;
    this.wallet = config.wallet;
    this.chainId = config.chainId;

    // Validate chain
    if (this.chainId !== 1) {
      throw new Error('Balancer adapter only supports Ethereum mainnet (chainId: 1)');
    }

    // Initialize contracts
    this.vault = new ethers.Contract(
      BalancerAdapter.VAULT_ADDRESS,
      BalancerAdapter.VAULT_ABI,
      this.wallet
    );

    this.balToken = new ethers.Contract(
      BalancerAdapter.BAL_TOKEN_ADDRESS,
      BalancerAdapter.ERC20_ABI,
      this.provider
    );
  }

  /**
   * Join a Balancer pool (add liquidity)
   * 
   * @param poolId - Pool ID (32-byte identifier)
   * @param amounts - Array of token amounts to deposit (must match pool's token order)
   * @param minBptOut - Minimum BPT tokens to receive (slippage protection)
   * @returns Transaction hash
   * 
   * @example
   * ```typescript
   * // Join 80/20 BAL/ETH pool
   * const tx = await balancer.joinPool(
   *   poolId,
   *   [balAmount, ethAmount],
   *   minBptOut
   * );
   * ```
   */
  async joinPool(poolId: string, amounts: bigint[], minBptOut: bigint): Promise<string> {
    console.log(`[Balancer] Joining pool ${poolId}`);

    try {
      // Get pool tokens
      const { tokens } = await this.vault.getPoolTokens(poolId);
      
      if (amounts.length !== tokens.length) {
        throw new Error(`Amount array length (${amounts.length}) doesn't match pool tokens (${tokens.length})`);
      }

      // Approve tokens
      for (let i = 0; i < tokens.length; i++) {
        if (amounts[i] > 0n) {
          const token = new ethers.Contract(tokens[i], BalancerAdapter.ERC20_ABI, this.wallet);
          const allowance = await token.allowance(this.wallet.address, BalancerAdapter.VAULT_ADDRESS);
          
          if (allowance < amounts[i]) {
            console.log(`[Balancer] Approving ${tokens[i]} for Vault...`);
            const approveTx = await token.approve(BalancerAdapter.VAULT_ADDRESS, ethers.MaxUint256);
            await approveTx.wait();
            console.log(`[Balancer] Approval confirmed: ${approveTx.hash}`);
          }
        }
      }

      // Encode user data for EXACT_TOKENS_IN_FOR_BPT_OUT
      // Format: [joinKind, amountsIn, minimumBPT]
      const userData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'uint256[]', 'uint256'],
        [JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT, amounts, minBptOut]
      );

      // Create join request
      const joinRequest = {
        assets: tokens,
        maxAmountsIn: amounts,
        userData: userData,
        fromInternalBalance: false,
      };

      // Join pool
      console.log(`[Balancer] Joining pool...`);
      const tx = await this.vault.joinPool(
        poolId,
        this.wallet.address,
        this.wallet.address,
        joinRequest
      );
      const receipt = await tx.wait();

      console.log(`[Balancer] Joined pool successfully!`);
      console.log(`[Balancer] Transaction hash: ${receipt.hash}`);

      return receipt.hash;
    } catch (error: any) {
      console.error(`[Balancer] Join pool failed:`, error.message);
      throw new Error(`Balancer join pool failed: ${error.message}`);
    }
  }

  /**
   * Exit a Balancer pool (remove liquidity)
   * 
   * @param poolId - Pool ID (32-byte identifier)
   * @param bptAmount - Amount of BPT tokens to burn
   * @param minAmountsOut - Minimum amounts of each token to receive (slippage protection)
   * @returns Transaction hash
   * 
   * @example
   * ```typescript
   * // Exit 80/20 BAL/ETH pool
   * const tx = await balancer.exitPool(
   *   poolId,
   *   bptAmount,
   *   [minBAL, minETH]
   * );
   * ```
   */
  async exitPool(poolId: string, bptAmount: bigint, minAmountsOut: bigint[]): Promise<string> {
    console.log(`[Balancer] Exiting pool ${poolId} with ${ethers.formatEther(bptAmount)} BPT`);

    try {
      // Get pool tokens
      const { tokens } = await this.vault.getPoolTokens(poolId);
      
      if (minAmountsOut.length !== tokens.length) {
        throw new Error(`Min amounts array length (${minAmountsOut.length}) doesn't match pool tokens (${tokens.length})`);
      }

      // Encode user data for EXACT_BPT_IN_FOR_TOKENS_OUT
      // Format: [exitKind, bptAmountIn]
      const userData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'uint256'],
        [ExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, bptAmount]
      );

      // Create exit request
      const exitRequest = {
        assets: tokens,
        minAmountsOut: minAmountsOut,
        userData: userData,
        toInternalBalance: false,
      };

      // Exit pool
      console.log(`[Balancer] Exiting pool...`);
      const tx = await this.vault.exitPool(
        poolId,
        this.wallet.address,
        this.wallet.address,
        exitRequest
      );
      const receipt = await tx.wait();

      console.log(`[Balancer] Exited pool successfully!`);
      console.log(`[Balancer] Transaction hash: ${receipt.hash}`);

      return receipt.hash;
    } catch (error: any) {
      console.error(`[Balancer] Exit pool failed:`, error.message);
      throw new Error(`Balancer exit pool failed: ${error.message}`);
    }
  }

  /**
   * Stake BPT tokens in a liquidity gauge to earn BAL rewards
   * 
   * @param gauge - Gauge address
   * @param amount - Amount of BPT tokens to stake
   * @returns Transaction hash
   * 
   * @example
   * ```typescript
   * const tx = await balancer.stakeInGauge(gauge, bptAmount);
   * ```
   */
  async stakeInGauge(gauge: string, amount: bigint): Promise<string> {
    console.log(`[Balancer] Staking ${ethers.formatEther(amount)} BPT in gauge ${gauge}`);

    try {
      // Create gauge contract
      const gaugeContract = new ethers.Contract(gauge, BalancerAdapter.GAUGE_ABI, this.wallet);

      // Get BPT token address
      const bptToken = await gaugeContract.lp_token();
      const bptTokenContract = new ethers.Contract(bptToken, BalancerAdapter.ERC20_ABI, this.wallet);

      // Check balance
      const balance = await bptTokenContract.balanceOf(this.wallet.address);
      if (balance < amount) {
        throw new Error(`Insufficient BPT balance: ${ethers.formatEther(balance)} < ${ethers.formatEther(amount)}`);
      }

      // Approve gauge if needed
      const allowance = await bptTokenContract.allowance(this.wallet.address, gauge);
      if (allowance < amount) {
        console.log(`[Balancer] Approving gauge to spend BPT...`);
        const approveTx = await bptTokenContract.approve(gauge, ethers.MaxUint256);
        await approveTx.wait();
        console.log(`[Balancer] Approval confirmed: ${approveTx.hash}`);
      }

      // Deposit into gauge
      console.log(`[Balancer] Depositing into gauge...`);
      const tx = await gaugeContract['deposit(uint256)'](amount);
      const receipt = await tx.wait();

      console.log(`[Balancer] Staked successfully!`);
      console.log(`[Balancer] Transaction hash: ${receipt.hash}`);

      return receipt.hash;
    } catch (error: any) {
      console.error(`[Balancer] Stake in gauge failed:`, error.message);
      throw new Error(`Balancer stake in gauge failed: ${error.message}`);
    }
  }

  /**
   * Unstake BPT tokens from a liquidity gauge
   * 
   * @param gauge - Gauge address
   * @param amount - Amount of BPT tokens to unstake
   * @returns Transaction hash
   * 
   * @example
   * ```typescript
   * const tx = await balancer.unstakeFromGauge(gauge, bptAmount);
   * ```
   */
  async unstakeFromGauge(gauge: string, amount: bigint): Promise<string> {
    console.log(`[Balancer] Unstaking ${ethers.formatEther(amount)} BPT from gauge ${gauge}`);

    try {
      // Create gauge contract
      const gaugeContract = new ethers.Contract(gauge, BalancerAdapter.GAUGE_ABI, this.wallet);

      // Check staked balance
      const stakedBalance = await gaugeContract.balanceOf(this.wallet.address);
      if (stakedBalance < amount) {
        throw new Error(`Insufficient staked balance: ${ethers.formatEther(stakedBalance)} < ${ethers.formatEther(amount)}`);
      }

      // Withdraw from gauge (claim rewards = true)
      console.log(`[Balancer] Withdrawing from gauge...`);
      const tx = await gaugeContract['withdraw(uint256,bool)'](amount, true);
      const receipt = await tx.wait();

      console.log(`[Balancer] Unstaked successfully!`);
      console.log(`[Balancer] Transaction hash: ${receipt.hash}`);

      return receipt.hash;
    } catch (error: any) {
      console.error(`[Balancer] Unstake from gauge failed:`, error.message);
      throw new Error(`Balancer unstake from gauge failed: ${error.message}`);
    }
  }

  /**
   * Claim BAL rewards from a liquidity gauge
   * 
   * @param gauge - Gauge address
   * @returns Transaction hash
   * 
   * @example
   * ```typescript
   * const tx = await balancer.claimRewards(gauge);
   * ```
   */
  async claimRewards(gauge: string): Promise<string> {
    console.log(`[Balancer] Claiming BAL rewards from gauge ${gauge}`);

    try {
      // Create gauge contract
      const gaugeContract = new ethers.Contract(gauge, BalancerAdapter.GAUGE_ABI, this.wallet);

      // Claim rewards
      console.log(`[Balancer] Claiming rewards...`);
      const tx = await gaugeContract['claim_rewards()']();
      const receipt = await tx.wait();

      console.log(`[Balancer] Rewards claimed successfully!`);
      console.log(`[Balancer] Transaction hash: ${receipt.hash}`);

      return receipt.hash;
    } catch (error: any) {
      console.error(`[Balancer] Claim rewards failed:`, error.message);
      throw new Error(`Balancer claim rewards failed: ${error.message}`);
    }
  }

  /**
   * Get position information for a specific pool/gauge
   * 
   * @param poolId - Pool ID (optional)
   * @param gauge - Gauge address (optional)
   * @param bptToken - BPT token address (required if poolId and gauge not provided)
   * @returns Position information
   * 
   * @example
   * ```typescript
   * const position = await balancer.getPosition(poolId, gauge);
   * console.log(`Staked: ${ethers.formatEther(position.supplied)}`);
   * ```
   */
  async getPosition(poolId?: string, gauge?: string, bptToken?: string): Promise<AdapterPosition> {
    try {
      if (!poolId && !gauge && !bptToken) {
        throw new Error('Either poolId, gauge, or bptToken must be provided');
      }

      let stakedBalance = 0n;
      let unstakedBalance = 0n;
      let pendingBAL = 0n;
      let bptTokenAddress = bptToken || '';
      let poolIdValue = poolId || '';

      if (gauge) {
        // Get staked position in gauge
        const gaugeContract = new ethers.Contract(gauge, BalancerAdapter.GAUGE_ABI, this.provider);
        
        stakedBalance = await gaugeContract.balanceOf(this.wallet.address);
        pendingBAL = await gaugeContract.claimable_tokens(this.wallet.address);
        bptTokenAddress = await gaugeContract.lp_token();
      }

      if (poolId && !bptTokenAddress) {
        // Get BPT token from pool
        const [poolAddress] = await this.vault.getPool(poolId);
        bptTokenAddress = poolAddress;
        poolIdValue = poolId;
      }

      if (bptTokenAddress && !poolIdValue) {
        // Get pool ID from BPT token
        const poolContract = new ethers.Contract(bptTokenAddress, BalancerAdapter.POOL_ABI, this.provider);
        poolIdValue = await poolContract.getPoolId();
      }

      // Get unstaked BPT balance
      const bptTokenContract = new ethers.Contract(bptTokenAddress, BalancerAdapter.ERC20_ABI, this.provider);
      unstakedBalance = await bptTokenContract.balanceOf(this.wallet.address);

      // Calculate total value
      // Note: To get accurate USD value, we'd need to:
      // 1. Get pool token balances and prices
      // 2. Calculate BPT value based on pool composition
      // For now, use BPT amount as value
      const totalBpt = stakedBalance + unstakedBalance;
      const totalValue = totalBpt;

      // Get APY (estimated)
      const estimatedAPY = 6.5; // 6.5% estimated

      return {
        totalValue,
        supplied: totalBpt,
        borrowed: 0n,
        apy: estimatedAPY,
        healthFactor: Infinity,
        metadata: {
          protocol: 'balancer',
          poolId: poolIdValue,
          bptToken: bptTokenAddress,
          gauge: gauge || 'none',
          stakedBalance: ethers.formatEther(stakedBalance),
          unstakedBalance: ethers.formatEther(unstakedBalance),
          pendingBAL: ethers.formatEther(pendingBAL),
        },
      };
    } catch (error: any) {
      console.error(`[Balancer] Get position failed:`, error.message);
      throw new Error(`Balancer get position failed: ${error.message}`);
    }
  }

  /**
   * Get estimated APY for a pool
   * 
   * @param poolId - Pool ID (optional)
   * @returns Estimated APY as a percentage
   * 
   * @example
   * ```typescript
   * const apy = await balancer.getAPY(poolId);
   * console.log(`Pool APY: ${apy}%`);
   * ```
   */
  async getAPY(poolId?: string): Promise<number> {
    // Note: Calculating real-time APY requires:
    // 1. Getting BAL reward rate from gauge
    // 2. Getting gauge relative weight
    // 3. Getting BAL price
    // 4. Getting pool TVL
    // 5. Calculating: (BAL rewards * BAL price) / TVL * 365 days
    //
    // For production, this should fetch from Balancer API
    // For now, return estimated APY

    if (!poolId) {
      return 6.5; // Average APY
    }

    // Estimate APY based on pool type
    // Stablecoin pools typically have lower APY
    return 6.5; // Default APY
  }

  /**
   * Health check for Balancer adapter
   * 
   * @returns Health status
   * 
   * @example
   * ```typescript
   * const health = await balancer.healthCheck();
   * if (!health.healthy) {
   *   console.error('Balancer adapter unhealthy:', health.reason);
   * }
   * ```
   */
  async healthCheck(): Promise<{ healthy: boolean; reason?: string }> {
    try {
      // Check Vault is accessible by querying a known pool
      // Using the 80/20 BAL/ETH pool as a test
      const testPoolId = '0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014';
      const { tokens } = await this.vault.getPoolTokens(testPoolId);
      
      if (tokens.length === 0) {
        return {
          healthy: false,
          reason: 'Vault returned no tokens for test pool',
        };
      }

      // All checks passed
      return {
        healthy: true,
      };
    } catch (error: any) {
      return {
        healthy: false,
        reason: `Health check failed: ${error.message}`,
      };
    }
  }

  /**
   * Get pool information
   * 
   * @param poolId - Pool ID
   * @returns Pool information
   * 
   * @example
   * ```typescript
   * const poolInfo = await balancer.getPoolInfo(poolId);
   * console.log(`Pool address: ${poolInfo.poolAddress}`);
   * console.log(`Tokens: ${poolInfo.tokens}`);
   * ```
   */
  async getPoolInfo(poolId: string): Promise<{
    poolAddress: string;
    tokens: string[];
    balances: bigint[];
    totalSupply: bigint;
    weights?: bigint[];
    swapFee?: bigint;
  }> {
    try {
      // Get pool address
      const [poolAddress] = await this.vault.getPool(poolId);

      // Get pool tokens and balances
      const { tokens, balances } = await this.vault.getPoolTokens(poolId);

      // Get pool contract
      const poolContract = new ethers.Contract(poolAddress, BalancerAdapter.POOL_ABI, this.provider);

      // Get total supply
      const totalSupply = await poolContract.totalSupply();

      // Try to get weights (only for weighted pools)
      let weights: bigint[] | undefined;
      let swapFee: bigint | undefined;
      try {
        weights = await poolContract.getNormalizedWeights();
        swapFee = await poolContract.getSwapFeePercentage();
      } catch {
        // Not a weighted pool or method not available
      }

      return {
        poolAddress,
        tokens,
        balances: balances.map((b: any) => BigInt(b.toString())),
        totalSupply,
        weights,
        swapFee,
      };
    } catch (error: any) {
      console.error(`[Balancer] Get pool info failed:`, error.message);
      throw new Error(`Balancer get pool info failed: ${error.message}`);
    }
  }
}
