/**
 * Staking Adapters Usage Examples
 * 
 * Comprehensive examples demonstrating how to use each staking adapter
 * in real-world scenarios.
 */

import { ethers } from 'ethers';
import {
  LidoAdapter,
  RocketPoolAdapter,
  NativeETHAdapter,
} from './index';

/**
 * Example 1: Lido - Basic Staking
 * 
 * Demonstrates how to stake ETH and receive stETH.
 */
async function example1_LidoBasicStaking() {
  console.log('\n=== Example 1: Lido Basic Staking ===\n');

  // Setup (replace with your actual provider and wallet)
  const provider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');
  const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

  // Initialize Lido adapter
  const lido = new LidoAdapter({
    provider,
    wallet,
    chainId: 1,
  });

  // Stake 10 ETH
  console.log('Staking 10 ETH to Lido...');
  const stakeTx = await lido.stake(ethers.parseEther('10'));
  console.log(`Stake transaction: ${stakeTx}`);

  // Get position
  const position = await lido.getPosition();
  console.log(`\nPosition:`);
  console.log(`stETH Balance: ${ethers.formatEther(position.supplied)}`);
  console.log(`ETH Value: ${ethers.formatEther(position.totalValue)}`);
  console.log(`APY: ${position.apy}%`);
  console.log(`Exchange Rate: ${position.metadata?.exchangeRate}`);

  // Get APY
  const apy = await lido.getAPY();
  console.log(`\nCurrent APY: ${apy}%`);

  // Health check
  const health = await lido.healthCheck();
  console.log(`\nAdapter Health: ${health.healthy ? 'Healthy' : 'Unhealthy'}`);
}

/**
 * Example 2: Lido - Withdrawal Process
 * 
 * Demonstrates how to request and claim withdrawals from Lido.
 */
async function example2_LidoWithdrawal() {
  console.log('\n=== Example 2: Lido Withdrawal Process ===\n');

  // Setup
  const provider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');
  const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

  // Initialize Lido adapter
  const lido = new LidoAdapter({
    provider,
    wallet,
    chainId: 1,
  });

  // Request withdrawal of 5 stETH
  console.log('Requesting withdrawal of 5 stETH...');
  const withdrawTx = await lido.unstake(ethers.parseEther('5'));
  console.log(`Withdrawal request transaction: ${withdrawTx}`);

  console.log('\nNote: Withdrawal must be claimed later when finalized');
  console.log('Typical wait time: 1-5 days');

  // Later, check withdrawal status
  const requestIds = [1n, 2n, 3n]; // Your withdrawal request IDs
  const statuses = await lido.getWithdrawalStatus(requestIds);
  
  console.log('\nWithdrawal Statuses:');
  for (let i = 0; i < statuses.length; i++) {
    const status = statuses[i];
    console.log(`Request ${requestIds[i]}:`);
    console.log(`  Amount: ${ethers.formatEther(status.amountOfStETH)} stETH`);
    console.log(`  Finalized: ${status.isFinalized}`);
    console.log(`  Claimed: ${status.isClaimed}`);
  }

  // Claim finalized withdrawals
  const finalizedIds = requestIds.filter((_, i) => 
    statuses[i].isFinalized && !statuses[i].isClaimed
  );

  if (finalizedIds.length > 0) {
    console.log(`\nClaiming ${finalizedIds.length} finalized withdrawals...`);
    const claimTx = await lido.claimWithdrawals(finalizedIds);
    console.log(`Claim transaction: ${claimTx}`);
  }
}

/**
 * Example 3: Rocket Pool - Basic Staking
 * 
 * Demonstrates how to stake ETH and receive rETH.
 */
async function example3_RocketPoolBasicStaking() {
  console.log('\n=== Example 3: Rocket Pool Basic Staking ===\n');

  // Setup
  const provider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');
  const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

  // Initialize Rocket Pool adapter
  const rocketPool = new RocketPoolAdapter({
    provider,
    wallet,
    chainId: 1,
  });

  // Check maximum deposit amount
  const maxDeposit = await rocketPool.getMaximumDepositAmount();
  console.log(`Maximum deposit amount: ${ethers.formatEther(maxDeposit)} ETH`);

  // Check deposit pool balance
  const poolBalance = await rocketPool.getDepositPoolBalance();
  console.log(`Deposit pool balance: ${ethers.formatEther(poolBalance)} ETH`);

  // Stake 10 ETH
  console.log('\nStaking 10 ETH to Rocket Pool...');
  const stakeTx = await rocketPool.stake(ethers.parseEther('10'));
  console.log(`Stake transaction: ${stakeTx}`);

  // Get position
  const position = await rocketPool.getPosition();
  console.log(`\nPosition:`);
  console.log(`rETH Balance: ${position.metadata?.rETHBalance}`);
  console.log(`ETH Value: ${position.metadata?.ethValue}`);
  console.log(`Exchange Rate: ${position.metadata?.exchangeRate}`);
  console.log(`APY: ${position.apy}%`);

  // Get exchange rate
  const exchangeRate = await rocketPool.getExchangeRate();
  console.log(`\nrETH/ETH Exchange Rate: ${ethers.formatEther(exchangeRate)}`);
}

/**
 * Example 4: Rocket Pool - Exchange Rate Calculations
 * 
 * Demonstrates how to convert between ETH and rETH.
 */
async function example4_RocketPoolExchangeRate() {
  console.log('\n=== Example 4: Rocket Pool Exchange Rate ===\n');

  // Setup
  const provider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');
  const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

  // Initialize Rocket Pool adapter
  const rocketPool = new RocketPoolAdapter({
    provider,
    wallet,
    chainId: 1,
  });

  // Convert 10 ETH to rETH
  const ethAmount = ethers.parseEther('10');
  const rethValue = await rocketPool.getRETHValue(ethAmount);
  console.log(`10 ETH = ${ethers.formatEther(rethValue)} rETH`);

  // Convert 10 rETH to ETH
  const rethAmount = ethers.parseEther('10');
  const ethValue = await rocketPool.getETHValue(rethAmount);
  console.log(`10 rETH = ${ethers.formatEther(ethValue)} ETH`);

  // Get current exchange rate
  const exchangeRate = await rocketPool.getExchangeRate();
  console.log(`\nCurrent Exchange Rate: ${ethers.formatEther(exchangeRate)} ETH per rETH`);
}

/**
 * Example 5: Rocket Pool - Unstaking
 * 
 * Demonstrates how to unstake rETH for ETH.
 */
async function example5_RocketPoolUnstaking() {
  console.log('\n=== Example 5: Rocket Pool Unstaking ===\n');

  // Setup
  const provider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');
  const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

  // Initialize Rocket Pool adapter
  const rocketPool = new RocketPoolAdapter({
    provider,
    wallet,
    chainId: 1,
  });

  // Check deposit pool balance (for instant unstaking)
  const poolBalance = await rocketPool.getDepositPoolBalance();
  console.log(`Deposit pool balance: ${ethers.formatEther(poolBalance)} ETH`);

  if (poolBalance > 0n) {
    console.log('Instant unstaking available!');
    
    // Unstake 5 rETH
    console.log('\nUnstaking 5 rETH...');
    const unstakeTx = await rocketPool.unstake(ethers.parseEther('5'));
    console.log(`Unstake transaction: ${unstakeTx}`);
    console.log('ETH received instantly!');
  } else {
    console.log('No instant unstaking available');
    console.log('Consider selling rETH on secondary market (Uniswap, Curve, etc.)');
  }
}

/**
 * Example 6: Multi-Protocol Staking Comparison
 * 
 * Demonstrates how to compare APYs and features across protocols.
 */
async function example6_MultiProtocolComparison() {
  console.log('\n=== Example 6: Multi-Protocol Comparison ===\n');

  // Setup
  const provider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');
  const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

  // Initialize all adapters
  const lido = new LidoAdapter({ provider, wallet, chainId: 1 });
  const rocketPool = new RocketPoolAdapter({ provider, wallet, chainId: 1 });

  // Get APYs
  const lidoAPY = await lido.getAPY();
  const rocketPoolAPY = await rocketPool.getAPY();

  console.log('Staking APYs:');
  console.log(`Lido (stETH): ${lidoAPY}%`);
  console.log(`Rocket Pool (rETH): ${rocketPoolAPY}%`);

  // Get TVLs
  const lidoTVL = await lido.getTVL();
  const rocketPoolTVL = await rocketPool.getTVL();

  console.log('\nTotal Value Locked:');
  console.log(`Lido: ${ethers.formatEther(lidoTVL)} ETH`);
  console.log(`Rocket Pool: ${ethers.formatEther(rocketPoolTVL)} ETH`);

  // Compare features
  console.log('\nFeature Comparison:');
  console.log('Lido:');
  console.log('  - Largest TVL (~$30B)');
  console.log('  - Highest liquidity');
  console.log('  - Rebasing token (stETH)');
  console.log('  - Withdrawal queue (1-5 days)');
  
  console.log('\nRocket Pool:');
  console.log('  - Decentralized (~$3B TVL)');
  console.log('  - Good liquidity');
  console.log('  - Appreciating token (rETH)');
  console.log('  - Instant unstaking (when available)');

  // Recommend based on APY
  const best = lidoAPY > rocketPoolAPY ? 'Lido' : 'Rocket Pool';
  const bestAPY = Math.max(lidoAPY, rocketPoolAPY);
  console.log(`\nBest APY: ${best} with ${bestAPY}%`);
}

/**
 * Example 7: Native ETH Staking (Advanced)
 * 
 * Demonstrates how to stake directly as a validator.
 * Note: This is for advanced users only.
 */
async function example7_NativeETHStaking() {
  console.log('\n=== Example 7: Native ETH Staking (Advanced) ===\n');

  // Setup
  const provider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');
  const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

  // Initialize Native ETH adapter
  const nativeETH = new NativeETHAdapter({
    provider,
    wallet,
    chainId: 1,
    validatorDataProvider: async () => {
      // In production, this would:
      // 1. Load validator keys from secure storage
      // 2. Generate deposit data using deposit-cli
      // 3. Return validator data
      
      return {
        pubkey: '0x' + '0'.repeat(96), // Replace with actual pubkey
        withdrawalCredentials: '0x' + '0'.repeat(64), // Replace with actual credentials
        signature: '0x' + '0'.repeat(192), // Replace with actual signature
        depositDataRoot: '0x' + '0'.repeat(64), // Replace with actual root
      };
    },
  });

  console.log('Native ETH Staking Requirements:');
  console.log(`- Minimum stake: ${ethers.formatEther(NativeETHAdapter.getMinimumDepositAmount())} ETH`);
  console.log(`- Withdrawal delay: ${NativeETHAdapter.getWithdrawalDelay() / 3600} hours`);
  console.log('- Validator infrastructure required');
  console.log('- Validator keys required');

  console.log('\nNote: This is for advanced users only!');
  console.log('For most use cases, use Lido or Rocket Pool instead.');

  // Stake 32 ETH (commented out for safety)
  // const stakeTx = await nativeETH.stake(ethers.parseEther('32'));
  // console.log(`Stake transaction: ${stakeTx}`);

  // Get position
  const position = await nativeETH.getPosition();
  console.log(`\nPosition:`);
  console.log(`Staked: ${ethers.formatEther(position.supplied)} ETH`);
  console.log(`APY: ${position.apy}%`);
  console.log(`Note: ${position.metadata?.note}`);
}

/**
 * Example 8: Automated Staking Strategy
 * 
 * Demonstrates how to implement an automated staking strategy.
 */
async function example8_AutomatedStakingStrategy() {
  console.log('\n=== Example 8: Automated Staking Strategy ===\n');

  // Setup
  const provider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');
  const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

  // Initialize adapters
  const lido = new LidoAdapter({ provider, wallet, chainId: 1 });
  const rocketPool = new RocketPoolAdapter({ provider, wallet, chainId: 1 });

  // Strategy: Allocate 30% of capital to staking
  // - 20% to Lido (highest liquidity)
  // - 10% to Rocket Pool (decentralization)
  
  const totalCapital = ethers.parseEther('100'); // 100 ETH
  const stakingAllocation = (totalCapital * 30n) / 100n; // 30 ETH

  const lidoAllocation = (stakingAllocation * 67n) / 100n; // ~20 ETH (67% of 30)
  const rocketPoolAllocation = (stakingAllocation * 33n) / 100n; // ~10 ETH (33% of 30)

  console.log('Capital Allocation:');
  console.log(`Total Capital: ${ethers.formatEther(totalCapital)} ETH`);
  console.log(`Staking Allocation: ${ethers.formatEther(stakingAllocation)} ETH (30%)`);
  console.log(`  - Lido: ${ethers.formatEther(lidoAllocation)} ETH (20%)`);
  console.log(`  - Rocket Pool: ${ethers.formatEther(rocketPoolAllocation)} ETH (10%)`);

  // Execute allocation
  console.log('\nExecuting allocation...');

  // Stake to Lido
  console.log(`Staking ${ethers.formatEther(lidoAllocation)} ETH to Lido...`);
  const lidoTx = await lido.stake(lidoAllocation);
  console.log(`Lido transaction: ${lidoTx}`);

  // Stake to Rocket Pool
  console.log(`Staking ${ethers.formatEther(rocketPoolAllocation)} ETH to Rocket Pool...`);
  const rocketPoolTx = await rocketPool.stake(rocketPoolAllocation);
  console.log(`Rocket Pool transaction: ${rocketPoolTx}`);

  // Get total position
  const lidoPosition = await lido.getPosition();
  const rocketPoolPosition = await rocketPool.getPosition();

  const totalStaked = lidoPosition.totalValue + rocketPoolPosition.totalValue;
  const weightedAPY = 
    (lidoPosition.apy * Number(lidoPosition.totalValue) +
     rocketPoolPosition.apy * Number(rocketPoolPosition.totalValue)) /
    Number(totalStaked);

  console.log('\nTotal Position:');
  console.log(`Total Staked: ${ethers.formatEther(totalStaked)} ETH`);
  console.log(`Weighted APY: ${weightedAPY.toFixed(2)}%`);
  console.log(`Lido: ${ethers.formatEther(lidoPosition.totalValue)} ETH (${lidoPosition.apy}%)`);
  console.log(`Rocket Pool: ${ethers.formatEther(rocketPoolPosition.totalValue)} ETH (${rocketPoolPosition.apy}%)`);
}

/**
 * Example 9: Error Handling
 * 
 * Demonstrates comprehensive error handling.
 */
async function example9_ErrorHandling() {
  console.log('\n=== Example 9: Error Handling ===\n');

  // Setup
  const provider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');
  const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

  // Initialize adapter
  const lido = new LidoAdapter({ provider, wallet, chainId: 1 });

  try {
    // Attempt to stake
    await lido.stake(ethers.parseEther('10'));
    console.log('Stake successful');
  } catch (error: any) {
    // Handle specific errors
    if (error.code === 'INSUFFICIENT_FUNDS') {
      console.error('Error: Insufficient ETH balance');
    } else if (error.code === 'NETWORK_ERROR') {
      console.error('Error: Network connection failed');
      console.error('Retrying in 5 seconds...');
      // Implement retry logic
    } else if (error.code === 'CALL_EXCEPTION') {
      console.error('Error: Smart contract call failed');
      console.error('Reason:', error.reason);
    } else {
      console.error('Unexpected error:', error.message);
    }

    // Log error details
    console.error('Error details:', {
      code: error.code,
      message: error.message,
      transaction: error.transaction,
    });
  }

  // Health check with error handling
  try {
    const health = await lido.healthCheck();
    if (!health.healthy) {
      console.error('Adapter unhealthy:', health.reason);
      // Implement recovery logic
    }
  } catch (error) {
    console.error('Health check failed:', error);
  }
}

// Export all examples
export {
  example1_LidoBasicStaking,
  example2_LidoWithdrawal,
  example3_RocketPoolBasicStaking,
  example4_RocketPoolExchangeRate,
  example5_RocketPoolUnstaking,
  example6_MultiProtocolComparison,
  example7_NativeETHStaking,
  example8_AutomatedStakingStrategy,
  example9_ErrorHandling,
};
