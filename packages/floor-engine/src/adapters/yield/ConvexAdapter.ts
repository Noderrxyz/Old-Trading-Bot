import { ethers } from 'ethers';
import type { AdapterPosition } from '../../types';

/**
 * Configuration for Convex adapter
 */
export interface ConvexAdapterConfig {
  provider: ethers.Provider;
  wallet: ethers.Wallet;
  chainId: number;
}

/**
 * Convex Finance Adapter
 * 
 * Provides boosted Curve yields by depositing Curve LP tokens into Convex.
 * Convex automatically stakes LP tokens in Curve gauges and maximizes boost
 * through accumulated veCRV.
 * 
 * Features:
 * - Deposit Curve LP tokens to earn boosted CRV + CVX rewards
 * - Automatic gauge staking (no manual staking needed)
 * - Claim CRV + CVX rewards
 * - Withdraw back to Curve LP tokens
 * - Multi-pool support through pool ID (pid) system
 * 
 * @example
 * ```typescript
 * const convex = new ConvexAdapter({ provider, wallet, chainId: 1 });
 * 
 * // Deposit Curve 3pool LP tokens (pid 9)
 * await convex.deposit(9n, ethers.parseEther('100'), true);
 * 
 * // Get position
 * const position = await convex.getPosition(9n);
 * 
 * // Claim rewards
 * await convex.claimRewards(9n);
 * 
 * // Withdraw
 * await convex.withdraw(9n, ethers.parseEther('100'));
 * ```
 */
export class ConvexAdapter {
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private chainId: number;
  private booster: ethers.Contract;
  private cvxToken: ethers.Contract;

  // Contract addresses (Ethereum mainnet)
  private static readonly BOOSTER_ADDRESS = '0xF403C135812408BFbE8713b5A23a04b3D48AAE31';
  private static readonly CVX_TOKEN_ADDRESS = '0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B';
  private static readonly CRV_TOKEN_ADDRESS = '0xD533a949740bb3306d119CC777fa900bA034cd52';

  // Booster ABI (main deposit contract)
  private static readonly BOOSTER_ABI = [
    'function poolInfo(uint256) view returns (address lptoken, address token, address gauge, address crvRewards, address stash, bool shutdown)',
    'function poolLength() view returns (uint256)',
    'function deposit(uint256 _pid, uint256 _amount, bool _stake) returns (bool)',
    'function depositAll(uint256 _pid, bool _stake) returns (bool)',
    'function withdraw(uint256 _pid, uint256 _amount) returns (bool)',
    'function withdrawAll(uint256 _pid) returns (bool)',
  ];

  // BaseRewardPool ABI (reward contract for each pool)
  private static readonly REWARD_POOL_ABI = [
    'function balanceOf(address account) view returns (uint256)',
    'function earned(address account) view returns (uint256)',
    'function getReward(address _account, bool _claimExtras) returns (bool)',
    'function stake(uint256 _amount) returns (bool)',
    'function withdraw(uint256 amount, bool claim) returns (bool)',
    'function withdrawAll(bool claim) returns (bool)',
    'function withdrawAndUnwrap(uint256 amount, bool claim) returns (bool)',
    'function rewardToken() view returns (address)',
    'function extraRewardsLength() view returns (uint256)',
    'function extraRewards(uint256) view returns (address)',
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

  constructor(config: ConvexAdapterConfig) {
    this.provider = config.provider;
    this.wallet = config.wallet;
    this.chainId = config.chainId;

    // Validate chain
    if (this.chainId !== 1) {
      throw new Error('Convex adapter only supports Ethereum mainnet (chainId: 1)');
    }

    // Initialize contracts
    this.booster = new ethers.Contract(
      ConvexAdapter.BOOSTER_ADDRESS,
      ConvexAdapter.BOOSTER_ABI,
      this.wallet
    );

    this.cvxToken = new ethers.Contract(
      ConvexAdapter.CVX_TOKEN_ADDRESS,
      ConvexAdapter.ERC20_ABI,
      this.provider
    );
  }

  /**
   * Deposit Curve LP tokens into Convex
   * 
   * @param pid - Pool ID in Convex (maps to specific Curve pool)
   * @param lpToken - Curve LP token address
   * @param amount - Amount of LP tokens to deposit
   * @returns Transaction hash
   * 
   * @example
   * ```typescript
   * // Deposit 100 3pool LP tokens (pid 9)
   * const tx = await convex.deposit(
   *   9n,
   *   '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490',
   *   ethers.parseEther('100')
   * );
   * ```
   */
  async deposit(pid: bigint, lpToken: string, amount: bigint): Promise<string> {
    console.log(`[Convex] Depositing ${ethers.formatEther(amount)} LP tokens to pool ${pid}`);

    try {
      // Get pool info to validate
      const poolInfo = await this.booster.poolInfo(pid);
      if (poolInfo.lptoken.toLowerCase() !== lpToken.toLowerCase()) {
        throw new Error(`LP token mismatch: expected ${poolInfo.lptoken}, got ${lpToken}`);
      }

      if (poolInfo.shutdown) {
        throw new Error(`Pool ${pid} is shutdown`);
      }

      // Create LP token contract
      const lpTokenContract = new ethers.Contract(lpToken, ConvexAdapter.ERC20_ABI, this.wallet);

      // Check balance
      const balance = await lpTokenContract.balanceOf(this.wallet.address);
      if (balance < amount) {
        throw new Error(`Insufficient LP token balance: ${ethers.formatEther(balance)} < ${ethers.formatEther(amount)}`);
      }

      // Approve Booster if needed
      const allowance = await lpTokenContract.allowance(this.wallet.address, ConvexAdapter.BOOSTER_ADDRESS);
      if (allowance < amount) {
        console.log(`[Convex] Approving Booster to spend LP tokens...`);
        const approveTx = await lpTokenContract.approve(ConvexAdapter.BOOSTER_ADDRESS, ethers.MaxUint256);
        await approveTx.wait();
        console.log(`[Convex] Approval confirmed: ${approveTx.hash}`);
      }

      // Deposit LP tokens (stake = true to auto-stake in reward pool)
      console.log(`[Convex] Depositing LP tokens to Booster...`);
      const tx = await this.booster.deposit(pid, amount, true);
      const receipt = await tx.wait();

      console.log(`[Convex] Deposit successful!`);
      console.log(`[Convex] Transaction hash: ${receipt.hash}`);
      console.log(`[Convex] Pool ID: ${pid}`);
      console.log(`[Convex] Amount: ${ethers.formatEther(amount)} LP tokens`);

      return receipt.hash;
    } catch (error: any) {
      console.error(`[Convex] Deposit failed:`, error.message);
      throw new Error(`Convex deposit failed: ${error.message}`);
    }
  }

  /**
   * Withdraw Curve LP tokens from Convex
   * 
   * @param pid - Pool ID in Convex
   * @param amount - Amount of LP tokens to withdraw
   * @returns Transaction hash
   * 
   * @example
   * ```typescript
   * // Withdraw 50 LP tokens from pool 9
   * const tx = await convex.withdraw(9n, ethers.parseEther('50'));
   * ```
   */
  async withdraw(pid: bigint, amount: bigint): Promise<string> {
    console.log(`[Convex] Withdrawing ${ethers.formatEther(amount)} LP tokens from pool ${pid}`);

    try {
      // Get pool info
      const poolInfo = await this.booster.poolInfo(pid);
      const rewardPool = new ethers.Contract(
        poolInfo.crvRewards,
        ConvexAdapter.REWARD_POOL_ABI,
        this.wallet
      );

      // Check staked balance
      const stakedBalance = await rewardPool.balanceOf(this.wallet.address);
      if (stakedBalance < amount) {
        throw new Error(`Insufficient staked balance: ${ethers.formatEther(stakedBalance)} < ${ethers.formatEther(amount)}`);
      }

      // Withdraw from reward pool (claim = true to also claim rewards)
      console.log(`[Convex] Withdrawing from reward pool...`);
      const tx = await rewardPool.withdrawAndUnwrap(amount, true);
      const receipt = await tx.wait();

      console.log(`[Convex] Withdrawal successful!`);
      console.log(`[Convex] Transaction hash: ${receipt.hash}`);
      console.log(`[Convex] Pool ID: ${pid}`);
      console.log(`[Convex] Amount: ${ethers.formatEther(amount)} LP tokens`);

      return receipt.hash;
    } catch (error: any) {
      console.error(`[Convex] Withdrawal failed:`, error.message);
      throw new Error(`Convex withdrawal failed: ${error.message}`);
    }
  }

  /**
   * Claim CRV + CVX rewards
   * 
   * @param pid - Pool ID in Convex
   * @returns Transaction hash
   * 
   * @example
   * ```typescript
   * // Claim rewards from pool 9
   * const tx = await convex.claimRewards(9n);
   * ```
   */
  async claimRewards(pid: bigint): Promise<string> {
    console.log(`[Convex] Claiming rewards from pool ${pid}`);

    try {
      // Get pool info
      const poolInfo = await this.booster.poolInfo(pid);
      const rewardPool = new ethers.Contract(
        poolInfo.crvRewards,
        ConvexAdapter.REWARD_POOL_ABI,
        this.wallet
      );

      // Check pending rewards
      const pendingCRV = await rewardPool.earned(this.wallet.address);
      console.log(`[Convex] Pending CRV rewards: ${ethers.formatEther(pendingCRV)}`);

      // Claim rewards (claimExtras = true to claim CVX and other extra rewards)
      const tx = await rewardPool.getReward(this.wallet.address, true);
      const receipt = await tx.wait();

      console.log(`[Convex] Rewards claimed successfully!`);
      console.log(`[Convex] Transaction hash: ${receipt.hash}`);

      return receipt.hash;
    } catch (error: any) {
      console.error(`[Convex] Claim rewards failed:`, error.message);
      throw new Error(`Convex claim rewards failed: ${error.message}`);
    }
  }

  /**
   * Get position information for a specific pool
   * 
   * @param pid - Pool ID in Convex (optional, if not provided returns total across all pools)
   * @returns Position information
   * 
   * @example
   * ```typescript
   * const position = await convex.getPosition(9n);
   * console.log(`Staked: ${ethers.formatEther(position.supplied)}`);
   * console.log(`Pending CRV: ${position.metadata.pendingCRV}`);
   * ```
   */
  async getPosition(pid?: bigint): Promise<AdapterPosition> {
    try {
      if (pid === undefined) {
        // Return aggregate position across all pools
        // This would require iterating through all pools, which is expensive
        // For now, throw an error requiring pid
        throw new Error('Pool ID (pid) is required for Convex position query');
      }

      // Get pool info
      const poolInfo = await this.booster.poolInfo(pid);
      const rewardPool = new ethers.Contract(
        poolInfo.crvRewards,
        ConvexAdapter.REWARD_POOL_ABI,
        this.provider
      );

      // Get staked balance (cvxLP tokens)
      const stakedBalance = await rewardPool.balanceOf(this.wallet.address);

      // Get pending CRV rewards
      const pendingCRV = await rewardPool.earned(this.wallet.address);

      // Get LP token info
      const lpToken = new ethers.Contract(poolInfo.lptoken, ConvexAdapter.ERC20_ABI, this.provider);
      const lpTokenSymbol = await lpToken.symbol();

      // Note: To get the exact USD value, we'd need to:
      // 1. Get the Curve pool's virtual price
      // 2. Multiply by staked balance
      // For now, we'll use the LP token amount as the value
      const totalValue = stakedBalance;

      // Get APY (would need to calculate from reward rates)
      // For now, return estimated APY
      const estimatedAPY = 8.5; // 8.5% estimated

      return {
        totalValue,
        supplied: stakedBalance,
        borrowed: 0n,
        apy: estimatedAPY,
        healthFactor: Infinity,
        metadata: {
          protocol: 'convex',
          poolId: pid.toString(),
          lpToken: poolInfo.lptoken,
          lpTokenSymbol,
          stakedBalance: ethers.formatEther(stakedBalance),
          pendingCRV: ethers.formatEther(pendingCRV),
          rewardPool: poolInfo.crvRewards,
          gauge: poolInfo.gauge,
        },
      };
    } catch (error: any) {
      console.error(`[Convex] Get position failed:`, error.message);
      throw new Error(`Convex get position failed: ${error.message}`);
    }
  }

  /**
   * Get estimated APY for a pool
   * 
   * @param pid - Pool ID in Convex (optional)
   * @returns Estimated APY as a percentage
   * 
   * @example
   * ```typescript
   * const apy = await convex.getAPY(9n);
   * console.log(`Pool 9 APY: ${apy}%`);
   * ```
   */
  async getAPY(pid?: bigint): Promise<number> {
    // Note: Calculating real-time APY requires:
    // 1. Getting CRV reward rate from reward pool
    // 2. Getting CVX mint ratio
    // 3. Getting CRV and CVX prices
    // 4. Getting pool TVL
    // 5. Calculating: (CRV rewards + CVX rewards) / TVL * 365 days
    //
    // For production, this should fetch from Convex API or calculate on-chain
    // For now, return estimated APY based on pool type

    if (pid === undefined) {
      // Return average APY across all pools
      return 8.5;
    }

    // Get pool info to determine pool type
    const poolInfo = await this.booster.poolInfo(pid);
    const lpToken = new ethers.Contract(poolInfo.lptoken, ConvexAdapter.ERC20_ABI, this.provider);
    const symbol = await lpToken.symbol();

    // Estimate APY based on pool type
    // Stablecoin pools typically have lower APY but lower risk
    if (symbol.includes('3Crv') || symbol.includes('USDC') || symbol.includes('USDT') || symbol.includes('DAI')) {
      return 6.5; // Stablecoin pools: ~6.5%
    } else {
      return 10.5; // Volatile pools: ~10.5%
    }
  }

  /**
   * Health check for Convex adapter
   * 
   * @returns Health status
   * 
   * @example
   * ```typescript
   * const health = await convex.healthCheck();
   * if (!health.healthy) {
   *   console.error('Convex adapter unhealthy:', health.reason);
   * }
   * ```
   */
  async healthCheck(): Promise<{ healthy: boolean; reason?: string }> {
    try {
      // Check Booster contract is accessible
      const poolLength = await this.booster.poolLength();
      if (poolLength === 0n) {
        return {
          healthy: false,
          reason: 'Booster contract has no pools',
        };
      }

      // Check CVX token is accessible
      const cvxTotalSupply = await this.cvxToken.totalSupply();
      if (cvxTotalSupply === 0n) {
        return {
          healthy: false,
          reason: 'CVX token has zero total supply',
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
   * @param pid - Pool ID in Convex
   * @returns Pool information
   * 
   * @example
   * ```typescript
   * const poolInfo = await convex.getPoolInfo(9n);
   * console.log(`LP Token: ${poolInfo.lptoken}`);
   * console.log(`Gauge: ${poolInfo.gauge}`);
   * ```
   */
  async getPoolInfo(pid: bigint): Promise<{
    lptoken: string;
    token: string;
    gauge: string;
    crvRewards: string;
    stash: string;
    shutdown: boolean;
  }> {
    try {
      const poolInfo = await this.booster.poolInfo(pid);
      return {
        lptoken: poolInfo.lptoken,
        token: poolInfo.token,
        gauge: poolInfo.gauge,
        crvRewards: poolInfo.crvRewards,
        stash: poolInfo.stash,
        shutdown: poolInfo.shutdown,
      };
    } catch (error: any) {
      console.error(`[Convex] Get pool info failed:`, error.message);
      throw new Error(`Convex get pool info failed: ${error.message}`);
    }
  }

  /**
   * Get total number of pools in Convex
   * 
   * @returns Number of pools
   * 
   * @example
   * ```typescript
   * const poolCount = await convex.getPoolCount();
   * console.log(`Total pools: ${poolCount}`);
   * ```
   */
  async getPoolCount(): Promise<bigint> {
    try {
      return await this.booster.poolLength();
    } catch (error: any) {
      console.error(`[Convex] Get pool count failed:`, error.message);
      throw new Error(`Convex get pool count failed: ${error.message}`);
    }
  }

  /**
   * Find pool ID (pid) for a specific Curve LP token
   * 
   * @param lpToken - Curve LP token address
   * @returns Pool ID (pid) or undefined if not found
   * 
   * @example
   * ```typescript
   * // Find pid for 3pool LP token
   * const pid = await convex.findPoolId('0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490');
   * console.log(`3pool pid: ${pid}`);
   * ```
   */
  async findPoolId(lpToken: string): Promise<bigint | undefined> {
    try {
      const poolLength = await this.booster.poolLength();
      const lpTokenLower = lpToken.toLowerCase();

      // Iterate through all pools to find matching LP token
      for (let i = 0n; i < poolLength; i++) {
        const poolInfo = await this.booster.poolInfo(i);
        if (poolInfo.lptoken.toLowerCase() === lpTokenLower) {
          return i;
        }
      }

      return undefined;
    } catch (error: any) {
      console.error(`[Convex] Find pool ID failed:`, error.message);
      throw new Error(`Convex find pool ID failed: ${error.message}`);
    }
  }
}
