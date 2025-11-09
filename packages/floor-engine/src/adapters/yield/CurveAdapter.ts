import { ethers } from 'ethers';
import type { AdapterPosition } from '../../types';

/**
 * Configuration for Curve adapter
 */
export interface CurveAdapterConfig {
  provider: ethers.Provider;
  wallet: ethers.Wallet;
  chainId: number;
}

/**
 * Curve Finance Adapter
 * 
 * Provides direct access to Curve pools for liquidity provision and yield farming.
 * Curve specializes in stablecoin swaps with low slippage using the StableSwap invariant.
 * 
 * Features:
 * - Add liquidity to Curve pools
 * - Remove liquidity from Curve pools
 * - Stake LP tokens in gauges to earn CRV rewards
 * - Claim CRV rewards
 * - Pool discovery through MetaRegistry
 * 
 * @example
 * ```typescript
 * const curve = new CurveAdapter({ provider, wallet, chainId: 1 });
 * 
 * // Find 3pool
 * const pools = await curve.findPools(USDC_ADDRESS, DAI_ADDRESS);
 * const pool = pools[0];
 * 
 * // Add liquidity
 * await curve.addLiquidity(pool, [usdcAmount, daiAmount, usdtAmount], minMintAmount);
 * 
 * // Stake in gauge
 * const gauge = await curve.getGauge(pool);
 * await curve.stakeInGauge(gauge, lpAmount);
 * 
 * // Claim rewards
 * await curve.claimRewards(gauge);
 * ```
 */
export class CurveAdapter {
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private chainId: number;
  private metaRegistry: ethers.Contract;
  private minter: ethers.Contract;

  // Contract addresses (Ethereum mainnet)
  private static readonly META_REGISTRY_ADDRESS = '0xF98B45FA17DE75FB1aD0e7aFD971b0ca00e379fC';
  private static readonly CRV_TOKEN_ADDRESS = '0xD533a949740bb3306d119CC777fa900bA034cd52';
  private static readonly MINTER_ADDRESS = '0xd061D61a4d941c39E5453435B6345Dc261C2fcE0';

  // MetaRegistry ABI
  private static readonly META_REGISTRY_ABI = [
    'function find_pools_for_coins(address _from, address _to) view returns (address[])',
    'function find_pool_for_coins(address _from, address _to, uint256 i) view returns (address)',
    'function get_pool_name(address _pool) view returns (string)',
    'function get_coins(address _pool) view returns (address[8])',
    'function get_n_coins(address _pool) view returns (uint256)',
    'function get_balances(address _pool) view returns (uint256[8])',
    'function get_gauge(address _pool) view returns (address)',
    'function get_lp_token(address _pool) view returns (address)',
    'function get_fees(address _pool) view returns (uint256[10])',
    'function get_virtual_price_from_lp_token(address _token) view returns (uint256)',
  ];

  // Curve Pool ABI (StableSwap)
  private static readonly POOL_ABI = [
    'function add_liquidity(uint256[2] amounts, uint256 min_mint_amount) returns (uint256)',
    'function add_liquidity(uint256[3] amounts, uint256 min_mint_amount) returns (uint256)',
    'function add_liquidity(uint256[4] amounts, uint256 min_mint_amount) returns (uint256)',
    'function remove_liquidity(uint256 _amount, uint256[2] min_amounts) returns (uint256[2])',
    'function remove_liquidity(uint256 _amount, uint256[3] min_amounts) returns (uint256[3])',
    'function remove_liquidity(uint256 _amount, uint256[4] min_amounts) returns (uint256[4])',
    'function remove_liquidity_one_coin(uint256 _token_amount, int128 i, uint256 min_amount) returns (uint256)',
    'function calc_withdraw_one_coin(uint256 _token_amount, int128 i) view returns (uint256)',
    'function get_virtual_price() view returns (uint256)',
    'function balances(uint256) view returns (uint256)',
    'function coins(uint256) view returns (address)',
  ];

  // Liquidity Gauge ABI
  private static readonly GAUGE_ABI = [
    'function deposit(uint256 _value) returns ()',
    'function deposit(uint256 _value, address _addr) returns ()',
    'function withdraw(uint256 _value) returns ()',
    'function balanceOf(address arg0) view returns (uint256)',
    'function claimable_tokens(address addr) view returns (uint256)',
    'function claimable_reward(address _addr, address _token) view returns (uint256)',
    'function claim_rewards() returns ()',
    'function claim_rewards(address _addr) returns ()',
    'function lp_token() view returns (address)',
  ];

  // Minter ABI
  private static readonly MINTER_ABI = [
    'function mint(address gauge_addr) returns ()',
    'function mint_many(address[8] gauge_addrs) returns ()',
    'function minted(address _for, address gauge_addr) view returns (uint256)',
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

  constructor(config: CurveAdapterConfig) {
    this.provider = config.provider;
    this.wallet = config.wallet;
    this.chainId = config.chainId;

    // Validate chain
    if (this.chainId !== 1) {
      throw new Error('Curve adapter only supports Ethereum mainnet (chainId: 1)');
    }

    // Initialize contracts
    this.metaRegistry = new ethers.Contract(
      CurveAdapter.META_REGISTRY_ADDRESS,
      CurveAdapter.META_REGISTRY_ABI,
      this.provider
    );

    this.minter = new ethers.Contract(
      CurveAdapter.MINTER_ADDRESS,
      CurveAdapter.MINTER_ABI,
      this.wallet
    );
  }

  /**
   * Find Curve pools containing two specific tokens
   * 
   * @param tokenA - First token address
   * @param tokenB - Second token address
   * @returns Array of pool addresses
   * 
   * @example
   * ```typescript
   * // Find pools with USDC and DAI
   * const pools = await curve.findPools(USDC_ADDRESS, DAI_ADDRESS);
   * console.log(`Found ${pools.length} pools`);
   * ```
   */
  async findPools(tokenA: string, tokenB: string): Promise<string[]> {
    try {
      const pools = await this.metaRegistry.find_pools_for_coins(tokenA, tokenB);
      // Filter out zero addresses
      return pools.filter((pool: string) => pool !== ethers.ZeroAddress);
    } catch (error: any) {
      console.error(`[Curve] Find pools failed:`, error.message);
      throw new Error(`Curve find pools failed: ${error.message}`);
    }
  }

  /**
   * Add liquidity to a Curve pool
   * 
   * @param pool - Pool address
   * @param amounts - Array of token amounts to deposit (must match pool's token count)
   * @param minMintAmount - Minimum LP tokens to receive (slippage protection)
   * @returns Transaction hash
   * 
   * @example
   * ```typescript
   * // Add liquidity to 3pool (USDC, DAI, USDT)
   * const tx = await curve.addLiquidity(
   *   pool,
   *   [usdcAmount, daiAmount, usdtAmount],
   *   minLpTokens
   * );
   * ```
   */
  async addLiquidity(pool: string, amounts: bigint[], minMintAmount: bigint): Promise<string> {
    console.log(`[Curve] Adding liquidity to pool ${pool}`);

    try {
      // Get pool info
      const nCoins = await this.metaRegistry.get_n_coins(pool);
      if (amounts.length !== Number(nCoins)) {
        throw new Error(`Amount array length (${amounts.length}) doesn't match pool coins (${nCoins})`);
      }

      // Get coin addresses
      const coins = await this.metaRegistry.get_coins(pool);

      // Approve tokens
      for (let i = 0; i < amounts.length; i++) {
        if (amounts[i] > 0n) {
          const token = new ethers.Contract(coins[i], CurveAdapter.ERC20_ABI, this.wallet);
          const allowance = await token.allowance(this.wallet.address, pool);
          
          if (allowance < amounts[i]) {
            console.log(`[Curve] Approving ${coins[i]} for pool...`);
            const approveTx = await token.approve(pool, ethers.MaxUint256);
            await approveTx.wait();
            console.log(`[Curve] Approval confirmed: ${approveTx.hash}`);
          }
        }
      }

      // Create pool contract
      const poolContract = new ethers.Contract(pool, CurveAdapter.POOL_ABI, this.wallet);

      // Add liquidity (function signature depends on number of coins)
      console.log(`[Curve] Adding liquidity...`);
      let tx;
      if (amounts.length === 2) {
        tx = await poolContract['add_liquidity(uint256[2],uint256)'](amounts, minMintAmount);
      } else if (amounts.length === 3) {
        tx = await poolContract['add_liquidity(uint256[3],uint256)'](amounts, minMintAmount);
      } else if (amounts.length === 4) {
        tx = await poolContract['add_liquidity(uint256[4],uint256)'](amounts, minMintAmount);
      } else {
        throw new Error(`Unsupported pool size: ${amounts.length} coins`);
      }

      const receipt = await tx.wait();

      console.log(`[Curve] Liquidity added successfully!`);
      console.log(`[Curve] Transaction hash: ${receipt.hash}`);

      return receipt.hash;
    } catch (error: any) {
      console.error(`[Curve] Add liquidity failed:`, error.message);
      throw new Error(`Curve add liquidity failed: ${error.message}`);
    }
  }

  /**
   * Remove liquidity from a Curve pool
   * 
   * @param pool - Pool address
   * @param lpAmount - Amount of LP tokens to burn
   * @param minAmounts - Minimum amounts of each token to receive (slippage protection)
   * @returns Transaction hash
   * 
   * @example
   * ```typescript
   * // Remove liquidity from 3pool
   * const tx = await curve.removeLiquidity(
   *   pool,
   *   lpAmount,
   *   [minUSDC, minDAI, minUSDT]
   * );
   * ```
   */
  async removeLiquidity(pool: string, lpAmount: bigint, minAmounts: bigint[]): Promise<string> {
    console.log(`[Curve] Removing ${ethers.formatEther(lpAmount)} LP tokens from pool ${pool}`);

    try {
      // Get pool info
      const nCoins = await this.metaRegistry.get_n_coins(pool);
      if (minAmounts.length !== Number(nCoins)) {
        throw new Error(`Min amounts array length (${minAmounts.length}) doesn't match pool coins (${nCoins})`);
      }

      // Create pool contract
      const poolContract = new ethers.Contract(pool, CurveAdapter.POOL_ABI, this.wallet);

      // Remove liquidity (function signature depends on number of coins)
      console.log(`[Curve] Removing liquidity...`);
      let tx;
      if (minAmounts.length === 2) {
        tx = await poolContract['remove_liquidity(uint256,uint256[2])'](lpAmount, minAmounts);
      } else if (minAmounts.length === 3) {
        tx = await poolContract['remove_liquidity(uint256,uint256[3])'](lpAmount, minAmounts);
      } else if (minAmounts.length === 4) {
        tx = await poolContract['remove_liquidity(uint256,uint256[4])'](lpAmount, minAmounts);
      } else {
        throw new Error(`Unsupported pool size: ${minAmounts.length} coins`);
      }

      const receipt = await tx.wait();

      console.log(`[Curve] Liquidity removed successfully!`);
      console.log(`[Curve] Transaction hash: ${receipt.hash}`);

      return receipt.hash;
    } catch (error: any) {
      console.error(`[Curve] Remove liquidity failed:`, error.message);
      throw new Error(`Curve remove liquidity failed: ${error.message}`);
    }
  }

  /**
   * Stake LP tokens in a liquidity gauge to earn CRV rewards
   * 
   * @param gauge - Gauge address
   * @param amount - Amount of LP tokens to stake
   * @returns Transaction hash
   * 
   * @example
   * ```typescript
   * const gauge = await curve.getGauge(pool);
   * const tx = await curve.stakeInGauge(gauge, lpAmount);
   * ```
   */
  async stakeInGauge(gauge: string, amount: bigint): Promise<string> {
    console.log(`[Curve] Staking ${ethers.formatEther(amount)} LP tokens in gauge ${gauge}`);

    try {
      // Create gauge contract
      const gaugeContract = new ethers.Contract(gauge, CurveAdapter.GAUGE_ABI, this.wallet);

      // Get LP token address
      const lpToken = await gaugeContract.lp_token();
      const lpTokenContract = new ethers.Contract(lpToken, CurveAdapter.ERC20_ABI, this.wallet);

      // Check balance
      const balance = await lpTokenContract.balanceOf(this.wallet.address);
      if (balance < amount) {
        throw new Error(`Insufficient LP token balance: ${ethers.formatEther(balance)} < ${ethers.formatEther(amount)}`);
      }

      // Approve gauge if needed
      const allowance = await lpTokenContract.allowance(this.wallet.address, gauge);
      if (allowance < amount) {
        console.log(`[Curve] Approving gauge to spend LP tokens...`);
        const approveTx = await lpTokenContract.approve(gauge, ethers.MaxUint256);
        await approveTx.wait();
        console.log(`[Curve] Approval confirmed: ${approveTx.hash}`);
      }

      // Deposit into gauge
      console.log(`[Curve] Depositing into gauge...`);
      const tx = await gaugeContract['deposit(uint256)'](amount);
      const receipt = await tx.wait();

      console.log(`[Curve] Staked successfully!`);
      console.log(`[Curve] Transaction hash: ${receipt.hash}`);

      return receipt.hash;
    } catch (error: any) {
      console.error(`[Curve] Stake in gauge failed:`, error.message);
      throw new Error(`Curve stake in gauge failed: ${error.message}`);
    }
  }

  /**
   * Unstake LP tokens from a liquidity gauge
   * 
   * @param gauge - Gauge address
   * @param amount - Amount of LP tokens to unstake
   * @returns Transaction hash
   * 
   * @example
   * ```typescript
   * const tx = await curve.unstakeFromGauge(gauge, lpAmount);
   * ```
   */
  async unstakeFromGauge(gauge: string, amount: bigint): Promise<string> {
    console.log(`[Curve] Unstaking ${ethers.formatEther(amount)} LP tokens from gauge ${gauge}`);

    try {
      // Create gauge contract
      const gaugeContract = new ethers.Contract(gauge, CurveAdapter.GAUGE_ABI, this.wallet);

      // Check staked balance
      const stakedBalance = await gaugeContract.balanceOf(this.wallet.address);
      if (stakedBalance < amount) {
        throw new Error(`Insufficient staked balance: ${ethers.formatEther(stakedBalance)} < ${ethers.formatEther(amount)}`);
      }

      // Withdraw from gauge
      console.log(`[Curve] Withdrawing from gauge...`);
      const tx = await gaugeContract.withdraw(amount);
      const receipt = await tx.wait();

      console.log(`[Curve] Unstaked successfully!`);
      console.log(`[Curve] Transaction hash: ${receipt.hash}`);

      return receipt.hash;
    } catch (error: any) {
      console.error(`[Curve] Unstake from gauge failed:`, error.message);
      throw new Error(`Curve unstake from gauge failed: ${error.message}`);
    }
  }

  /**
   * Claim CRV rewards from a liquidity gauge
   * 
   * @param gauge - Gauge address
   * @returns Transaction hash
   * 
   * @example
   * ```typescript
   * const tx = await curve.claimRewards(gauge);
   * ```
   */
  async claimRewards(gauge: string): Promise<string> {
    console.log(`[Curve] Claiming CRV rewards from gauge ${gauge}`);

    try {
      // Mint CRV rewards through Minter contract
      console.log(`[Curve] Minting CRV rewards...`);
      const tx = await this.minter.mint(gauge);
      const receipt = await tx.wait();

      console.log(`[Curve] Rewards claimed successfully!`);
      console.log(`[Curve] Transaction hash: ${receipt.hash}`);

      return receipt.hash;
    } catch (error: any) {
      console.error(`[Curve] Claim rewards failed:`, error.message);
      throw new Error(`Curve claim rewards failed: ${error.message}`);
    }
  }

  /**
   * Get position information for a specific gauge
   * 
   * @param gauge - Gauge address (optional, if not provided returns total LP token balance)
   * @param lpToken - LP token address (required if gauge not provided)
   * @returns Position information
   * 
   * @example
   * ```typescript
   * const position = await curve.getPosition(gauge);
   * console.log(`Staked: ${ethers.formatEther(position.supplied)}`);
   * ```
   */
  async getPosition(gauge?: string, lpToken?: string): Promise<AdapterPosition> {
    try {
      if (!gauge && !lpToken) {
        throw new Error('Either gauge or lpToken must be provided');
      }

      let stakedBalance = 0n;
      let unstakedBalance = 0n;
      let pendingCRV = 0n;
      let lpTokenAddress = lpToken || '';
      let virtualPrice = 0n;

      if (gauge) {
        // Get staked position in gauge
        const gaugeContract = new ethers.Contract(gauge, CurveAdapter.GAUGE_ABI, this.provider);
        
        stakedBalance = await gaugeContract.balanceOf(this.wallet.address);
        pendingCRV = await gaugeContract.claimable_tokens(this.wallet.address);
        lpTokenAddress = await gaugeContract.lp_token();
      }

      // Get unstaked LP token balance
      const lpTokenContract = new ethers.Contract(lpTokenAddress, CurveAdapter.ERC20_ABI, this.provider);
      unstakedBalance = await lpTokenContract.balanceOf(this.wallet.address);

      // Get virtual price (LP token value in USD)
      try {
        virtualPrice = await this.metaRegistry.get_virtual_price_from_lp_token(lpTokenAddress);
      } catch {
        // Some pools may not have virtual price
        virtualPrice = ethers.parseEther('1'); // Default to 1:1
      }

      // Calculate total value
      const totalLpTokens = stakedBalance + unstakedBalance;
      const totalValue = (totalLpTokens * virtualPrice) / ethers.parseEther('1');

      // Get APY (estimated)
      const estimatedAPY = 5.5; // 5.5% estimated

      return {
        totalValue,
        supplied: totalLpTokens,
        borrowed: 0n,
        apy: estimatedAPY,
        healthFactor: Infinity,
        metadata: {
          protocol: 'curve',
          lpToken: lpTokenAddress,
          gauge: gauge || 'none',
          stakedBalance: ethers.formatEther(stakedBalance),
          unstakedBalance: ethers.formatEther(unstakedBalance),
          pendingCRV: ethers.formatEther(pendingCRV),
          virtualPrice: ethers.formatEther(virtualPrice),
        },
      };
    } catch (error: any) {
      console.error(`[Curve] Get position failed:`, error.message);
      throw new Error(`Curve get position failed: ${error.message}`);
    }
  }

  /**
   * Get estimated APY for a pool/gauge
   * 
   * @param pool - Pool address (optional)
   * @returns Estimated APY as a percentage
   * 
   * @example
   * ```typescript
   * const apy = await curve.getAPY(pool);
   * console.log(`Pool APY: ${apy}%`);
   * ```
   */
  async getAPY(pool?: string): Promise<number> {
    // Note: Calculating real-time APY requires:
    // 1. Getting CRV reward rate from gauge
    // 2. Getting gauge weight from GaugeController
    // 3. Getting CRV price
    // 4. Getting pool TVL
    // 5. Calculating: (CRV rewards * CRV price) / TVL * 365 days
    //
    // For production, this should fetch from Curve API
    // For now, return estimated APY

    if (!pool) {
      return 5.5; // Average APY
    }

    // Get pool name to estimate APY
    try {
      const poolName = await this.metaRegistry.get_pool_name(pool);
      
      // Stablecoin pools typically have lower APY
      if (poolName.includes('3pool') || poolName.includes('USDC') || poolName.includes('USDT')) {
        return 4.5; // Stablecoin pools: ~4.5%
      } else {
        return 7.5; // Volatile pools: ~7.5%
      }
    } catch {
      return 5.5; // Default APY
    }
  }

  /**
   * Health check for Curve adapter
   * 
   * @returns Health status
   * 
   * @example
   * ```typescript
   * const health = await curve.healthCheck();
   * if (!health.healthy) {
   *   console.error('Curve adapter unhealthy:', health.reason);
   * }
   * ```
   */
  async healthCheck(): Promise<{ healthy: boolean; reason?: string }> {
    try {
      // Check MetaRegistry is accessible
      const testPool = await this.metaRegistry.find_pool_for_coins(
        CurveAdapter.CRV_TOKEN_ADDRESS,
        ethers.ZeroAddress,
        0
      );
      
      // If we can query the registry, it's healthy
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
   * Get gauge address for a pool
   * 
   * @param pool - Pool address
   * @returns Gauge address
   * 
   * @example
   * ```typescript
   * const gauge = await curve.getGauge(pool);
   * ```
   */
  async getGauge(pool: string): Promise<string> {
    try {
      return await this.metaRegistry.get_gauge(pool);
    } catch (error: any) {
      console.error(`[Curve] Get gauge failed:`, error.message);
      throw new Error(`Curve get gauge failed: ${error.message}`);
    }
  }

  /**
   * Get LP token address for a pool
   * 
   * @param pool - Pool address
   * @returns LP token address
   * 
   * @example
   * ```typescript
   * const lpToken = await curve.getLpToken(pool);
   * ```
   */
  async getLpToken(pool: string): Promise<string> {
    try {
      return await this.metaRegistry.get_lp_token(pool);
    } catch (error: any) {
      console.error(`[Curve] Get LP token failed:`, error.message);
      throw new Error(`Curve get LP token failed: ${error.message}`);
    }
  }

  /**
   * Get pool information
   * 
   * @param pool - Pool address
   * @returns Pool information
   * 
   * @example
   * ```typescript
   * const poolInfo = await curve.getPoolInfo(pool);
   * console.log(`Pool name: ${poolInfo.name}`);
   * console.log(`Coins: ${poolInfo.coins}`);
   * ```
   */
  async getPoolInfo(pool: string): Promise<{
    name: string;
    coins: string[];
    nCoins: number;
    lpToken: string;
    gauge: string;
    virtualPrice: bigint;
  }> {
    try {
      const name = await this.metaRegistry.get_pool_name(pool);
      const coins = await this.metaRegistry.get_coins(pool);
      const nCoins = await this.metaRegistry.get_n_coins(pool);
      const lpToken = await this.metaRegistry.get_lp_token(pool);
      const gauge = await this.metaRegistry.get_gauge(pool);
      
      let virtualPrice = 0n;
      try {
        virtualPrice = await this.metaRegistry.get_virtual_price_from_lp_token(lpToken);
      } catch {
        virtualPrice = ethers.parseEther('1');
      }

      // Filter out zero addresses from coins
      const validCoins = coins.filter((coin: string) => coin !== ethers.ZeroAddress);

      return {
        name,
        coins: validCoins,
        nCoins: Number(nCoins),
        lpToken,
        gauge,
        virtualPrice,
      };
    } catch (error: any) {
      console.error(`[Curve] Get pool info failed:`, error.message);
      throw new Error(`Curve get pool info failed: ${error.message}`);
    }
  }
}
