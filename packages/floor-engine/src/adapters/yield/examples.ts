/**
 * Yield Farming Adapters - Usage Examples
 * 
 * This file demonstrates real-world usage scenarios for the yield farming adapters.
 * These examples show how to integrate Convex, Curve, and Balancer adapters into
 * the Floor Engine's capital allocation system.
 * 
 * @module adapters/yield/examples
 */

import { ethers } from 'ethers';
import { ConvexAdapter, CurveAdapter, BalancerAdapter } from './index';

// Example configuration
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
const chainId = 1; // Ethereum mainnet

/**
 * Example 1: Convex - Deposit Curve LP tokens and earn boosted yields
 * 
 * This example shows how to deposit Curve 3pool LP tokens into Convex
 * to earn boosted CRV rewards + CVX rewards without locking CRV.
 */
async function example1_ConvexDeposit() {
  console.log('=== Example 1: Convex Deposit ===\n');

  // Initialize Convex adapter
  const convex = new ConvexAdapter({ provider, wallet, chainId });

  // Curve 3pool LP token address
  const threepoolLP = '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490';

  // Find pool ID for 3pool
  const pid = await convex.findPoolId(threepoolLP);
  console.log(`3pool pid: ${pid}`); // Should be 9

  // Deposit 100 LP tokens
  const depositAmount = ethers.parseEther('100');
  const txHash = await convex.deposit(pid!, threepoolLP, depositAmount);
  console.log(`Deposited ${ethers.formatEther(depositAmount)} LP tokens`);
  console.log(`Transaction: ${txHash}\n`);

  // Get position
  const position = await convex.getPosition(pid);
  console.log(`Position:`);
  console.log(`  Staked: ${position.metadata.stakedBalance}`);
  console.log(`  Pending CRV: ${position.metadata.pendingCRV}`);
  console.log(`  APY: ${position.apy}%`);
  console.log(`  Total Value: ${ethers.formatEther(position.totalValue)}\n`);
}

/**
 * Example 2: Convex - Claim rewards and withdraw
 * 
 * This example shows how to claim CRV + CVX rewards and withdraw
 * LP tokens back to the wallet.
 */
async function example2_ConvexClaimAndWithdraw() {
  console.log('=== Example 2: Convex Claim & Withdraw ===\n');

  const convex = new ConvexAdapter({ provider, wallet, chainId });
  const pid = 9n; // 3pool

  // Claim rewards
  console.log('Claiming CRV + CVX rewards...');
  const claimTx = await convex.claimRewards(pid);
  console.log(`Rewards claimed: ${claimTx}\n`);

  // Withdraw 50 LP tokens
  const withdrawAmount = ethers.parseEther('50');
  console.log(`Withdrawing ${ethers.formatEther(withdrawAmount)} LP tokens...`);
  const withdrawTx = await convex.withdraw(pid, withdrawAmount);
  console.log(`Withdrawn: ${withdrawTx}\n`);

  // Check updated position
  const position = await convex.getPosition(pid);
  console.log(`Updated position:`);
  console.log(`  Staked: ${position.metadata.stakedBalance}`);
  console.log(`  Total Value: ${ethers.formatEther(position.totalValue)}\n`);
}

/**
 * Example 3: Curve - Find pools and add liquidity
 * 
 * This example shows how to discover Curve pools containing specific tokens
 * and add liquidity to earn trading fees + CRV rewards.
 */
async function example3_CurveAddLiquidity() {
  console.log('=== Example 3: Curve Add Liquidity ===\n');

  const curve = new CurveAdapter({ provider, wallet, chainId });

  // Find pools containing USDC and DAI
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
  
  console.log('Finding pools with USDC and DAI...');
  const pools = await curve.findPools(USDC, DAI);
  console.log(`Found ${pools.length} pools\n`);

  // Get info for first pool (3pool)
  const pool = pools[0];
  const poolInfo = await curve.getPoolInfo(pool);
  console.log(`Pool: ${poolInfo.name}`);
  console.log(`  Tokens: ${poolInfo.nCoins}`);
  console.log(`  LP Token: ${poolInfo.lpToken}`);
  console.log(`  Gauge: ${poolInfo.gauge}`);
  console.log(`  Virtual Price: ${ethers.formatEther(poolInfo.virtualPrice)}\n`);

  // Add liquidity to 3pool (USDC, DAI, USDT)
  const amounts = [
    ethers.parseUnits('1000', 6),  // 1000 USDC
    ethers.parseEther('1000'),      // 1000 DAI
    ethers.parseUnits('1000', 6),  // 1000 USDT
  ];
  const minMintAmount = ethers.parseEther('2990'); // 0.33% slippage

  console.log('Adding liquidity...');
  const txHash = await curve.addLiquidity(pool, amounts, minMintAmount);
  console.log(`Liquidity added: ${txHash}\n`);
}

/**
 * Example 4: Curve - Stake in gauge and claim rewards
 * 
 * This example shows how to stake Curve LP tokens in a liquidity gauge
 * to earn CRV rewards.
 */
async function example4_CurveStakeAndClaim() {
  console.log('=== Example 4: Curve Stake & Claim ===\n');

  const curve = new CurveAdapter({ provider, wallet, chainId });

  // 3pool address
  const pool = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7';
  
  // Get gauge address
  const gauge = await curve.getGauge(pool);
  console.log(`Gauge address: ${gauge}\n`);

  // Stake 3000 LP tokens in gauge
  const stakeAmount = ethers.parseEther('3000');
  console.log(`Staking ${ethers.formatEther(stakeAmount)} LP tokens...`);
  const stakeTx = await curve.stakeInGauge(gauge, stakeAmount);
  console.log(`Staked: ${stakeTx}\n`);

  // Get position
  const position = await curve.getPosition(gauge);
  console.log(`Position:`);
  console.log(`  Staked: ${position.metadata.stakedBalance}`);
  console.log(`  Unstaked: ${position.metadata.unstakedBalance}`);
  console.log(`  Pending CRV: ${position.metadata.pendingCRV}`);
  console.log(`  APY: ${position.apy}%\n`);

  // Wait some time for rewards to accrue...
  // Then claim CRV rewards
  console.log('Claiming CRV rewards...');
  const claimTx = await curve.claimRewards(gauge);
  console.log(`Rewards claimed: ${claimTx}\n`);
}

/**
 * Example 5: Curve - Unstake and remove liquidity
 * 
 * This example shows how to unstake LP tokens from a gauge and
 * remove liquidity to get back underlying tokens.
 */
async function example5_CurveUnstakeAndRemove() {
  console.log('=== Example 5: Curve Unstake & Remove ===\n');

  const curve = new CurveAdapter({ provider, wallet, chainId });

  const pool = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7';
  const gauge = await curve.getGauge(pool);

  // Unstake 3000 LP tokens
  const unstakeAmount = ethers.parseEther('3000');
  console.log(`Unstaking ${ethers.formatEther(unstakeAmount)} LP tokens...`);
  const unstakeTx = await curve.unstakeFromGauge(gauge, unstakeAmount);
  console.log(`Unstaked: ${unstakeTx}\n`);

  // Remove liquidity
  const minAmounts = [
    ethers.parseUnits('990', 6),   // Min 990 USDC (0.33% slippage)
    ethers.parseEther('990'),       // Min 990 DAI
    ethers.parseUnits('990', 6),   // Min 990 USDT
  ];

  console.log('Removing liquidity...');
  const removeTx = await curve.removeLiquidity(pool, unstakeAmount, minAmounts);
  console.log(`Liquidity removed: ${removeTx}\n`);
}

/**
 * Example 6: Balancer - Join weighted pool
 * 
 * This example shows how to join a Balancer weighted pool (80/20 BAL/ETH)
 * to earn trading fees + BAL rewards.
 */
async function example6_BalancerJoinPool() {
  console.log('=== Example 6: Balancer Join Pool ===\n');

  const balancer = new BalancerAdapter({ provider, wallet, chainId });

  // 80/20 BAL/ETH pool
  const poolId = '0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014';

  // Get pool info
  const poolInfo = await balancer.getPoolInfo(poolId);
  console.log(`Pool address: ${poolInfo.poolAddress}`);
  console.log(`Tokens: ${poolInfo.tokens.length}`);
  console.log(`Total supply: ${ethers.formatEther(poolInfo.totalSupply)}`);
  if (poolInfo.weights) {
    console.log(`Weights: ${poolInfo.weights.map(w => ethers.formatEther(w)).join(', ')}`);
  }
  console.log();

  // Join pool with 800 BAL and 1 ETH
  const amounts = [
    ethers.parseEther('800'),  // 800 BAL (80%)
    ethers.parseEther('1'),    // 1 ETH (20%)
  ];
  const minBptOut = ethers.parseEther('10'); // Minimum BPT to receive

  console.log('Joining pool...');
  const txHash = await balancer.joinPool(poolId, amounts, minBptOut);
  console.log(`Joined pool: ${txHash}\n`);
}

/**
 * Example 7: Balancer - Stake BPT and claim rewards
 * 
 * This example shows how to stake Balancer Pool Tokens (BPT) in a gauge
 * to earn BAL rewards.
 */
async function example7_BalancerStakeAndClaim() {
  console.log('=== Example 7: Balancer Stake & Claim ===\n');

  const balancer = new BalancerAdapter({ provider, wallet, chainId });

  const poolId = '0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014';
  const gauge = '0x68d019f64A7aa97e2D4e7363AEE42251D08124Fb'; // Example gauge

  // Stake 10 BPT in gauge
  const stakeAmount = ethers.parseEther('10');
  console.log(`Staking ${ethers.formatEther(stakeAmount)} BPT...`);
  const stakeTx = await balancer.stakeInGauge(gauge, stakeAmount);
  console.log(`Staked: ${stakeTx}\n`);

  // Get position
  const position = await balancer.getPosition(poolId, gauge);
  console.log(`Position:`);
  console.log(`  Staked: ${position.metadata.stakedBalance}`);
  console.log(`  Unstaked: ${position.metadata.unstakedBalance}`);
  console.log(`  Pending BAL: ${position.metadata.pendingBAL}`);
  console.log(`  APY: ${position.apy}%\n`);

  // Claim BAL rewards
  console.log('Claiming BAL rewards...');
  const claimTx = await balancer.claimRewards(gauge);
  console.log(`Rewards claimed: ${claimTx}\n`);
}

/**
 * Example 8: Balancer - Unstake and exit pool
 * 
 * This example shows how to unstake BPT from a gauge and exit the pool
 * to get back underlying tokens.
 */
async function example8_BalancerUnstakeAndExit() {
  console.log('=== Example 8: Balancer Unstake & Exit ===\n');

  const balancer = new BalancerAdapter({ provider, wallet, chainId });

  const poolId = '0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014';
  const gauge = '0x68d019f64A7aa97e2D4e7363AEE42251D08124Fb';

  // Unstake 10 BPT
  const unstakeAmount = ethers.parseEther('10');
  console.log(`Unstaking ${ethers.formatEther(unstakeAmount)} BPT...`);
  const unstakeTx = await balancer.unstakeFromGauge(gauge, unstakeAmount);
  console.log(`Unstaked: ${unstakeTx}\n`);

  // Exit pool
  const minAmountsOut = [
    ethers.parseEther('790'),  // Min 790 BAL (1.25% slippage)
    ethers.parseEther('0.99'), // Min 0.99 ETH
  ];

  console.log('Exiting pool...');
  const exitTx = await balancer.exitPool(poolId, unstakeAmount, minAmountsOut);
  console.log(`Exited pool: ${exitTx}\n`);
}

/**
 * Example 9: Multi-Protocol Yield Farming Strategy
 * 
 * This example shows how to implement a diversified yield farming strategy
 * across all three protocols (Convex, Curve, Balancer).
 */
async function example9_MultiProtocolStrategy() {
  console.log('=== Example 9: Multi-Protocol Strategy ===\n');

  // Initialize all adapters
  const convex = new ConvexAdapter({ provider, wallet, chainId });
  const curve = new CurveAdapter({ provider, wallet, chainId });
  const balancer = new BalancerAdapter({ provider, wallet, chainId });

  // Total capital: 100 ETH equivalent
  const totalCapital = ethers.parseEther('100');
  
  // Yield farming allocation: 20% of total capital
  const yieldFarmingAllocation = ethers.parseEther('20');

  console.log(`Total capital: ${ethers.formatEther(totalCapital)} ETH`);
  console.log(`Yield farming allocation: ${ethers.formatEther(yieldFarmingAllocation)} ETH\n`);

  // Allocation breakdown:
  // - Convex: 60% of yield farming (12 ETH)
  // - Curve: 25% of yield farming (5 ETH)
  // - Balancer: 15% of yield farming (3 ETH)

  const convexAllocation = ethers.parseEther('12');
  const curveAllocation = ethers.parseEther('5');
  const balancerAllocation = ethers.parseEther('3');

  console.log('Allocation breakdown:');
  console.log(`  Convex: ${ethers.formatEther(convexAllocation)} ETH (60%)`);
  console.log(`  Curve: ${ethers.formatEther(curveAllocation)} ETH (25%)`);
  console.log(`  Balancer: ${ethers.formatEther(balancerAllocation)} ETH (15%)\n`);

  // 1. Allocate to Convex (3pool)
  console.log('Step 1: Allocating to Convex 3pool...');
  const threepoolLP = '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490';
  const pid = await convex.findPoolId(threepoolLP);
  await convex.deposit(pid!, threepoolLP, convexAllocation);
  console.log(`  Deposited ${ethers.formatEther(convexAllocation)} to Convex\n`);

  // 2. Allocate to Curve (direct staking)
  console.log('Step 2: Allocating to Curve 3pool...');
  const pool = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7';
  const gauge = await curve.getGauge(pool);
  
  // Add liquidity first (simplified - assume we already have LP tokens)
  // await curve.addLiquidity(pool, amounts, minMintAmount);
  
  await curve.stakeInGauge(gauge, curveAllocation);
  console.log(`  Staked ${ethers.formatEther(curveAllocation)} in Curve gauge\n`);

  // 3. Allocate to Balancer (80/20 BAL/ETH)
  console.log('Step 3: Allocating to Balancer 80/20 pool...');
  const poolId = '0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014';
  const balancerGauge = '0x68d019f64A7aa97e2D4e7363AEE42251D08124Fb';
  
  // Join pool first (simplified - assume we have tokens)
  // await balancer.joinPool(poolId, amounts, minBptOut);
  
  await balancer.stakeInGauge(balancerGauge, balancerAllocation);
  console.log(`  Staked ${ethers.formatEther(balancerAllocation)} in Balancer gauge\n`);

  // Get aggregate position
  console.log('Aggregate Position:');
  
  const convexPosition = await convex.getPosition(pid);
  console.log(`  Convex:`);
  console.log(`    Value: ${ethers.formatEther(convexPosition.totalValue)}`);
  console.log(`    APY: ${convexPosition.apy}%`);
  console.log(`    Pending CRV: ${convexPosition.metadata.pendingCRV}`);

  const curvePosition = await curve.getPosition(gauge);
  console.log(`  Curve:`);
  console.log(`    Value: ${ethers.formatEther(curvePosition.totalValue)}`);
  console.log(`    APY: ${curvePosition.apy}%`);
  console.log(`    Pending CRV: ${curvePosition.metadata.pendingCRV}`);

  const balancerPosition = await balancer.getPosition(poolId, balancerGauge);
  console.log(`  Balancer:`);
  console.log(`    Value: ${ethers.formatEther(balancerPosition.totalValue)}`);
  console.log(`    APY: ${balancerPosition.apy}%`);
  console.log(`    Pending BAL: ${balancerPosition.metadata.pendingBAL}`);

  // Calculate weighted average APY
  const totalValue = convexPosition.totalValue + curvePosition.totalValue + balancerPosition.totalValue;
  const weightedAPY = (
    (convexPosition.apy * Number(convexPosition.totalValue)) +
    (curvePosition.apy * Number(curvePosition.totalValue)) +
    (balancerPosition.apy * Number(balancerPosition.totalValue))
  ) / Number(totalValue);

  console.log(`\nWeighted Average APY: ${weightedAPY.toFixed(2)}%`);
  console.log(`Total Value: ${ethers.formatEther(totalValue)}\n`);
}

/**
 * Example 10: Health Check and Monitoring
 * 
 * This example shows how to perform health checks on all adapters
 * and monitor their status.
 */
async function example10_HealthCheckAndMonitoring() {
  console.log('=== Example 10: Health Check & Monitoring ===\n');

  // Initialize adapters
  const convex = new ConvexAdapter({ provider, wallet, chainId });
  const curve = new CurveAdapter({ provider, wallet, chainId });
  const balancer = new BalancerAdapter({ provider, wallet, chainId });

  // Perform health checks
  console.log('Performing health checks...\n');

  const convexHealth = await convex.healthCheck();
  console.log(`Convex: ${convexHealth.healthy ? '✓ Healthy' : '✗ Unhealthy'}`);
  if (!convexHealth.healthy) {
    console.log(`  Reason: ${convexHealth.reason}`);
  }

  const curveHealth = await curve.healthCheck();
  console.log(`Curve: ${curveHealth.healthy ? '✓ Healthy' : '✗ Unhealthy'}`);
  if (!curveHealth.healthy) {
    console.log(`  Reason: ${curveHealth.reason}`);
  }

  const balancerHealth = await balancer.healthCheck();
  console.log(`Balancer: ${balancerHealth.healthy ? '✓ Healthy' : '✗ Unhealthy'}`);
  if (!balancerHealth.healthy) {
    console.log(`  Reason: ${balancerHealth.reason}`);
  }

  console.log();

  // Get APY estimates
  console.log('APY Estimates:');
  const convexAPY = await convex.getAPY(9n); // 3pool
  const curveAPY = await curve.getAPY();
  const balancerAPY = await balancer.getAPY();

  console.log(`  Convex 3pool: ${convexAPY}%`);
  console.log(`  Curve average: ${curveAPY}%`);
  console.log(`  Balancer average: ${balancerAPY}%\n`);
}

// Main execution
async function main() {
  console.log('Yield Farming Adapters - Usage Examples\n');
  console.log('========================================\n\n');

  try {
    // Run examples (comment out as needed)
    // await example1_ConvexDeposit();
    // await example2_ConvexClaimAndWithdraw();
    // await example3_CurveAddLiquidity();
    // await example4_CurveStakeAndClaim();
    // await example5_CurveUnstakeAndRemove();
    // await example6_BalancerJoinPool();
    // await example7_BalancerStakeAndClaim();
    // await example8_BalancerUnstakeAndExit();
    // await example9_MultiProtocolStrategy();
    await example10_HealthCheckAndMonitoring();

    console.log('Examples completed successfully!');
  } catch (error) {
    console.error('Error running examples:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

// Export examples for testing
export {
  example1_ConvexDeposit,
  example2_ConvexClaimAndWithdraw,
  example3_CurveAddLiquidity,
  example4_CurveStakeAndClaim,
  example5_CurveUnstakeAndRemove,
  example6_BalancerJoinPool,
  example7_BalancerStakeAndClaim,
  example8_BalancerUnstakeAndExit,
  example9_MultiProtocolStrategy,
  example10_HealthCheckAndMonitoring,
};
