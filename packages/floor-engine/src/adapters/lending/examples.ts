/**
 * Lending Adapters Usage Examples
 * 
 * Comprehensive examples demonstrating how to use each lending adapter
 * in real-world scenarios.
 */

import { ethers } from 'ethers';
import {
  AaveV3Adapter,
  CompoundV3Adapter,
  MorphoBlueAdapter,
  SparkAdapter,
} from './index';

/**
 * Example 1: Aave V3 - Multi-Chain Lending
 * 
 * Demonstrates how to use Aave V3 adapter across multiple chains.
 */
async function example1_AaveV3MultiChain() {
  console.log('\n=== Example 1: Aave V3 Multi-Chain Lending ===\n');

  // Setup (replace with your actual provider and wallet)
  const provider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');
  const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

  // Token addresses (Ethereum mainnet)
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

  // Initialize Aave V3 adapter for Ethereum
  const aaveEth = new AaveV3Adapter({
    provider,
    wallet,
    chainId: 1,
  });

  // Supply USDC
  console.log('Supplying 10,000 USDC to Aave V3...');
  const supplyTx = await aaveEth.supply(
    USDC,
    ethers.parseUnits('10000', 6)
  );
  console.log(`Supply transaction: ${supplyTx}`);

  // Get current position
  const position = await aaveEth.getPosition();
  console.log(`Total Value: $${ethers.formatUnits(position.totalValue, 6)}`);
  console.log(`Supplied: $${ethers.formatUnits(position.supplied, 6)}`);
  console.log(`APY: ${position.apy}%`);
  console.log(`Health Factor: ${position.healthFactor}`);

  // Get USDC APY
  const usdcAPY = await aaveEth.getAPY(USDC);
  console.log(`USDC Supply APY: ${usdcAPY}%`);

  // Borrow WETH against USDC collateral
  console.log('\nBorrowing 1 WETH...');
  const borrowTx = await aaveEth.borrow(
    WETH,
    ethers.parseEther('1')
  );
  console.log(`Borrow transaction: ${borrowTx}`);

  // Check position after borrowing
  const positionAfterBorrow = await aaveEth.getPosition();
  console.log(`\nPosition after borrowing:`);
  console.log(`Total Value: $${ethers.formatUnits(positionAfterBorrow.totalValue, 6)}`);
  console.log(`Borrowed: $${ethers.formatUnits(positionAfterBorrow.borrowed, 6)}`);
  console.log(`Health Factor: ${positionAfterBorrow.healthFactor}`);

  // Health check
  const health = await aaveEth.healthCheck();
  console.log(`\nAdapter Health: ${health.healthy ? 'Healthy' : 'Unhealthy'}`);
}

/**
 * Example 2: Compound V3 - Market-Based Lending
 * 
 * Demonstrates how to use Compound V3 adapter with different markets.
 */
async function example2_CompoundV3Markets() {
  console.log('\n=== Example 2: Compound V3 Market-Based Lending ===\n');

  // Setup
  const provider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');
  const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

  // Token addresses
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

  // Initialize Compound V3 adapter for USDC market
  const compoundUSDC = new CompoundV3Adapter({
    provider,
    wallet,
    chainId: 1,
    baseToken: 'USDC',
  });

  // Get supported markets
  const markets = CompoundV3Adapter.getSupportedMarkets(1);
  console.log(`Supported markets on Ethereum: ${markets.join(', ')}`);

  // Supply WETH as collateral
  console.log('\nSupplying 10 WETH as collateral...');
  const supplyTx = await compoundUSDC.supply(
    WETH,
    ethers.parseEther('10')
  );
  console.log(`Supply transaction: ${supplyTx}`);

  // Get current APY
  const apy = await compoundUSDC.getAPY();
  console.log(`Current USDC APY: ${apy}%`);

  // Borrow USDC (base token)
  console.log('\nBorrowing 5,000 USDC...');
  const borrowTx = await compoundUSDC.borrow(
    USDC,
    ethers.parseUnits('5000', 6)
  );
  console.log(`Borrow transaction: ${borrowTx}`);

  // Get position
  const position = await compoundUSDC.getPosition();
  console.log(`\nPosition:`);
  console.log(`Total Value: $${ethers.formatUnits(position.totalValue, 6)}`);
  console.log(`Supplied: $${ethers.formatUnits(position.supplied, 6)}`);
  console.log(`Borrowed: $${ethers.formatUnits(position.borrowed, 6)}`);
  console.log(`Health Factor: ${position.healthFactor}`);

  // Get comet address
  const cometAddress = compoundUSDC.getCometAddress();
  console.log(`\nComet Address: ${cometAddress}`);
}

/**
 * Example 3: Morpho Blue - Flexible Market Lending
 * 
 * Demonstrates how to use Morpho Blue adapter with custom markets.
 */
async function example3_MorphoBlueFlexibleMarkets() {
  console.log('\n=== Example 3: Morpho Blue Flexible Market Lending ===\n');

  // Setup
  const provider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');
  const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

  // Example market ID (WETH/USDC market)
  // In production, get this from Morpho Blue UI or API
  const marketId = '0x...'; // Replace with actual market ID

  // Initialize Morpho Blue adapter
  const morpho = new MorphoBlueAdapter({
    provider,
    wallet,
    chainId: 1,
    marketId,
  });

  // Get market tokens
  const loanToken = await morpho.getLoanToken();
  const collateralToken = await morpho.getCollateralToken();
  console.log(`Loan Token: ${loanToken}`);
  console.log(`Collateral Token: ${collateralToken}`);

  // Supply collateral
  console.log('\nSupplying 10 WETH as collateral...');
  const supplyTx = await morpho.supply(
    collateralToken,
    ethers.parseEther('10')
  );
  console.log(`Supply transaction: ${supplyTx}`);

  // Get position
  const position = await morpho.getPosition();
  console.log(`\nPosition:`);
  console.log(`Total Value: ${ethers.formatEther(position.totalValue)} ETH`);
  console.log(`Collateral: ${position.metadata?.collateral}`);
  console.log(`Health Factor: ${position.healthFactor}`);

  // Borrow loan token
  console.log('\nBorrowing loan token...');
  const borrowTx = await morpho.borrow(
    loanToken,
    ethers.parseUnits('5000', 6) // Assuming USDC (6 decimals)
  );
  console.log(`Borrow transaction: ${borrowTx}`);

  // Get updated position
  const positionAfterBorrow = await morpho.getPosition();
  console.log(`\nPosition after borrowing:`);
  console.log(`Borrowed: ${ethers.formatUnits(positionAfterBorrow.borrowed, 6)}`);
  console.log(`Health Factor: ${positionAfterBorrow.healthFactor}`);
}

/**
 * Example 4: Spark - DAI-Focused Lending
 * 
 * Demonstrates how to use Spark adapter for DAI lending.
 */
async function example4_SparkDAILending() {
  console.log('\n=== Example 4: Spark DAI-Focused Lending ===\n');

  // Setup
  const provider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');
  const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

  // Token addresses
  const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

  // Initialize Spark adapter
  const spark = new SparkAdapter({
    provider,
    wallet,
    chainId: 1,
  });

  // Supply DAI
  console.log('Supplying 50,000 DAI to Spark...');
  const supplyTx = await spark.supply(
    DAI,
    ethers.parseEther('50000')
  );
  console.log(`Supply transaction: ${supplyTx}`);

  // Get DAI supply APY
  const supplyAPY = await spark.getAPY(DAI);
  console.log(`DAI Supply APY: ${supplyAPY}%`);

  // Get DAI borrow APY
  const borrowAPY = await spark.getBorrowAPY(DAI);
  console.log(`DAI Borrow APY: ${borrowAPY}%`);

  // Get stable borrow APY
  const stableAPY = await spark.getStableBorrowAPY(DAI);
  console.log(`DAI Stable Borrow APY: ${stableAPY}%`);

  // Get position
  const position = await spark.getPosition();
  console.log(`\nPosition:`);
  console.log(`Total Value: ${ethers.formatEther(position.totalValue)} DAI`);
  console.log(`Supplied: ${ethers.formatEther(position.supplied)} DAI`);
  console.log(`APY: ${position.apy}%`);
  console.log(`Health Factor: ${position.healthFactor}`);

  // Borrow WETH against DAI collateral
  console.log('\nBorrowing 5 WETH...');
  const borrowTx = await spark.borrow(
    WETH,
    ethers.parseEther('5')
  );
  console.log(`Borrow transaction: ${borrowTx}`);

  // Check position after borrowing
  const positionAfterBorrow = await spark.getPosition();
  console.log(`\nPosition after borrowing:`);
  console.log(`Borrowed: ${ethers.formatEther(positionAfterBorrow.borrowed)} ETH`);
  console.log(`Health Factor: ${positionAfterBorrow.healthFactor}`);
}

/**
 * Example 5: Multi-Protocol Yield Optimization
 * 
 * Demonstrates how to compare APYs across protocols and optimize yield.
 */
async function example5_MultiProtocolOptimization() {
  console.log('\n=== Example 5: Multi-Protocol Yield Optimization ===\n');

  // Setup
  const provider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');
  const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

  // Initialize all adapters
  const aave = new AaveV3Adapter({ provider, wallet, chainId: 1 });
  const compound = new CompoundV3Adapter({ provider, wallet, chainId: 1, baseToken: 'USDC' });
  const spark = new SparkAdapter({ provider, wallet, chainId: 1 });

  // Get APYs from all protocols
  const aaveAPY = await aave.getAPY(USDC);
  const compoundAPY = await compound.getAPY();
  const sparkAPY = await spark.getAPY(USDC);

  console.log('USDC Supply APYs:');
  console.log(`Aave V3: ${aaveAPY}%`);
  console.log(`Compound V3: ${compoundAPY}%`);
  console.log(`Spark: ${sparkAPY}%`);

  // Find best protocol
  const apys = [
    { protocol: 'Aave V3', apy: aaveAPY, adapter: aave },
    { protocol: 'Compound V3', apy: compoundAPY, adapter: compound },
    { protocol: 'Spark', apy: sparkAPY, adapter: spark },
  ];

  const best = apys.reduce((prev, current) =>
    current.apy > prev.apy ? current : prev
  );

  console.log(`\nBest protocol: ${best.protocol} with ${best.apy}% APY`);

  // Supply to best protocol
  console.log(`\nSupplying 10,000 USDC to ${best.protocol}...`);
  const tx = await best.adapter.supply(USDC, ethers.parseUnits('10000', 6));
  console.log(`Transaction: ${tx}`);
}

/**
 * Example 6: Health Factor Monitoring
 * 
 * Demonstrates how to monitor health factor and manage risk.
 */
async function example6_HealthFactorMonitoring() {
  console.log('\n=== Example 6: Health Factor Monitoring ===\n');

  // Setup
  const provider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');
  const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

  // Initialize adapter
  const aave = new AaveV3Adapter({ provider, wallet, chainId: 1 });

  // Supply and borrow
  await aave.supply(USDC, ethers.parseUnits('10000', 6));
  await aave.borrow(WETH, ethers.parseEther('2'));

  // Monitor health factor
  const position = await aave.getPosition();
  const healthFactor = position.healthFactor;

  console.log(`Current Health Factor: ${healthFactor}`);

  // Risk assessment
  if (healthFactor > 2.0) {
    console.log('Risk Level: LOW - Safe to borrow more');
  } else if (healthFactor > 1.5) {
    console.log('Risk Level: MODERATE - Monitor closely');
  } else if (healthFactor > 1.2) {
    console.log('Risk Level: HIGH - Consider repaying debt');
  } else {
    console.log('Risk Level: CRITICAL - Liquidation risk!');
    
    // Automatic deleveraging
    console.log('\nTriggering automatic deleveraging...');
    const repayAmount = position.borrowed / 2n; // Repay 50% of debt
    await aave.repay(WETH, repayAmount);
    
    const newPosition = await aave.getPosition();
    console.log(`New Health Factor: ${newPosition.healthFactor}`);
  }
}

/**
 * Example 7: Multi-Chain Deployment
 * 
 * Demonstrates how to deploy across multiple chains.
 */
async function example7_MultiChainDeployment() {
  console.log('\n=== Example 7: Multi-Chain Deployment ===\n');

  // Setup providers and wallets for each chain
  const chains = {
    ethereum: {
      chainId: 1,
      provider: new ethers.JsonRpcProvider('https://eth.llamarpc.com'),
      wallet: new ethers.Wallet('YOUR_PRIVATE_KEY'),
    },
    arbitrum: {
      chainId: 42161,
      provider: new ethers.JsonRpcProvider('https://arb1.arbitrum.io/rpc'),
      wallet: new ethers.Wallet('YOUR_PRIVATE_KEY'),
    },
    optimism: {
      chainId: 10,
      provider: new ethers.JsonRpcProvider('https://mainnet.optimism.io'),
      wallet: new ethers.Wallet('YOUR_PRIVATE_KEY'),
    },
    base: {
      chainId: 8453,
      provider: new ethers.JsonRpcProvider('https://mainnet.base.org'),
      wallet: new ethers.Wallet('YOUR_PRIVATE_KEY'),
    },
  };

  // Deploy Aave V3 adapters across all chains
  const adapters: Record<string, AaveV3Adapter> = {};

  for (const [name, config] of Object.entries(chains)) {
    if (AaveV3Adapter.isChainSupported(config.chainId)) {
      console.log(`Deploying Aave V3 adapter on ${name}...`);
      
      adapters[name] = new AaveV3Adapter({
        provider: config.provider,
        wallet: config.wallet.connect(config.provider),
        chainId: config.chainId,
      });

      // Health check
      const health = await adapters[name].healthCheck();
      console.log(`${name} adapter: ${health.healthy ? 'Healthy' : 'Unhealthy'}`);
    }
  }

  console.log(`\nDeployed adapters on ${Object.keys(adapters).length} chains`);
}

/**
 * Example 8: Error Handling
 * 
 * Demonstrates comprehensive error handling.
 */
async function example8_ErrorHandling() {
  console.log('\n=== Example 8: Error Handling ===\n');

  // Setup
  const provider = new ethers.JsonRpcProvider('https://eth.llamarpc.com');
  const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);

  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

  // Initialize adapter
  const aave = new AaveV3Adapter({ provider, wallet, chainId: 1 });

  try {
    // Attempt to supply
    await aave.supply(USDC, ethers.parseUnits('10000', 6));
    console.log('Supply successful');
  } catch (error: any) {
    // Handle specific errors
    if (error.code === 'INSUFFICIENT_FUNDS') {
      console.error('Error: Insufficient USDC balance');
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
    const health = await aave.healthCheck();
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
  example1_AaveV3MultiChain,
  example2_CompoundV3Markets,
  example3_MorphoBlueFlexibleMarkets,
  example4_SparkDAILending,
  example5_MultiProtocolOptimization,
  example6_HealthFactorMonitoring,
  example7_MultiChainDeployment,
  example8_ErrorHandling,
};
