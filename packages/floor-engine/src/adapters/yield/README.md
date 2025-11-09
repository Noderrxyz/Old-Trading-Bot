# Yield Farming Adapters

This directory contains production-ready adapters for major DeFi yield farming protocols. These adapters enable the Noderr Floor Engine to allocate capital to yield farming strategies, targeting enhanced returns through liquidity provision and reward token farming.

## Overview

Yield farming adapters provide a unified interface for interacting with decentralized exchange (DEX) liquidity pools and reward systems. The Floor Engine allocates **20% of total capital** to yield farming strategies, diversified across three major protocols.

### Supported Protocols

The yield farming module supports three complementary protocols, each serving a specific role in the capital allocation strategy:

**Convex Finance** receives the largest allocation at 12% of total capital (60% of yield farming allocation). Convex provides boosted Curve yields without requiring users to lock CRV tokens for veCRV. The protocol automatically stakes Curve LP tokens in gauges and maximizes boost through accumulated veCRV, delivering superior risk-adjusted returns. Users receive both boosted CRV rewards and additional CVX token emissions, typically achieving 5-12% APY on stablecoin pools with minimal impermanent loss risk.

**Curve Finance** receives 5% of total capital (25% of yield farming allocation) for direct pool exposure. Curve specializes in stablecoin swaps using the StableSwap invariant, which minimizes slippage and impermanent loss. Direct Curve exposure provides lower fees compared to Convex and more granular control over pool selection. The protocol is battle-tested since 2020 and offers 3-8% APY on major stablecoin pools like 3pool (USDT/USDC/DAI).

**Balancer V2** receives 3% of total capital (15% of yield farming allocation) for diversification. Balancer enables weighted pool liquidity provision with custom token ratios, such as 80/20 BAL/ETH pools. The unique Vault architecture centralizes all pool tokens in a single contract, improving capital efficiency. Balancer provides exposure to non-stablecoin pools and BAL token rewards, typically achieving 4-10% APY depending on pool composition.

### Capital Allocation Strategy

| Protocol | Allocation | APY Target | Risk Level | Primary Use Case |
|----------|-----------|------------|------------|------------------|
| Convex | 12% | 5-12% | Low | Boosted stablecoin yields |
| Curve | 5% | 3-8% | Low | Direct stablecoin exposure |
| Balancer | 3% | 4-10% | Low-Medium | Weighted pool diversification |
| **Total** | **20%** | **5-10%** | **Low** | **Yield farming** |

## Architecture

All yield farming adapters implement a consistent interface pattern, though they don't formally implement a shared `IYieldAdapter` interface. Each adapter provides the following core functionality:

**Liquidity Management** enables adding and removing liquidity from pools. Convex deposits Curve LP tokens directly into the Booster contract. Curve adds liquidity to pools and receives LP tokens that can be staked in gauges. Balancer joins and exits pools through the centralized Vault contract using complex join/exit requests.

**Reward Claiming** allows harvesting of protocol reward tokens. Convex claims both CRV and CVX rewards from BaseRewardPool contracts. Curve mints CRV rewards through the Minter contract for staked gauge positions. Balancer claims BAL rewards from liquidity gauge contracts.

**Position Tracking** provides real-time visibility into staked positions and pending rewards. All adapters return position information including total value, supplied amounts, estimated APY, and protocol-specific metadata such as pool IDs, gauge addresses, and pending reward amounts.

**Health Monitoring** ensures adapter functionality through periodic health checks. Each adapter verifies contract accessibility, validates pool states, and reports any issues that could impact yield farming operations.

## Convex Finance Adapter

Convex Finance provides the simplest and most efficient way to earn boosted Curve yields. The protocol eliminates the need for users to lock CRV tokens for veCRV, instead pooling veCRV across all users to maximize boost.

### Key Features

Convex offers several advantages that make it the primary yield farming protocol for the Floor Engine. The auto-boosted yields eliminate the complexity of veCRV management while delivering superior returns. Users receive both boosted CRV rewards and additional CVX token emissions, typically 20-40% higher than direct Curve staking. The protocol automatically stakes LP tokens in Curve gauges, requiring no manual gauge interaction. Convex supports over 100 Curve pools across multiple chains including Ethereum, Arbitrum, and Polygon.

### Contract Addresses (Ethereum Mainnet)

| Contract | Address | Purpose |
|----------|---------|---------|
| Booster | `0xF403C135812408BFbE8713b5A23a04b3D48AAE31` | Main deposit contract |
| CVX Token | `0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B` | Governance token |
| CRV Token | `0xD533a949740bb3306d119CC777fa900bA034cd52` | Reward token |

### Usage Example

```typescript
import { ConvexAdapter } from './adapters/yield';
import { ethers } from 'ethers';

// Initialize adapter
const convex = new ConvexAdapter({
  provider,
  wallet,
  chainId: 1, // Ethereum mainnet
});

// Find pool ID for Curve 3pool LP token
const threepoolLP = '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490';
const pid = await convex.findPoolId(threepoolLP);
console.log(`3pool pid: ${pid}`); // pid: 9

// Deposit Curve LP tokens into Convex
const depositAmount = ethers.parseEther('100');
const txHash = await convex.deposit(pid, threepoolLP, depositAmount);
console.log(`Deposited: ${txHash}`);

// Get position
const position = await convex.getPosition(pid);
console.log(`Staked: ${position.metadata.stakedBalance}`);
console.log(`Pending CRV: ${position.metadata.pendingCRV}`);
console.log(`APY: ${position.apy}%`);

// Claim rewards (CRV + CVX)
await convex.claimRewards(pid);

// Withdraw
const withdrawAmount = ethers.parseEther('50');
await convex.withdraw(pid, withdrawAmount);
```

### Pool ID System

Convex uses a pool ID (pid) system to map Curve pools to Convex reward contracts. Each Curve pool has a unique pid in Convex. The adapter provides a `findPoolId()` method to discover the pid for any Curve LP token address. Common pools include pid 9 for 3pool (USDT/USDC/DAI), pid 38 for MIM pool, and pid 40 for FRAX pool.

## Curve Finance Adapter

Curve Finance is the largest stablecoin DEX, specializing in low-slippage swaps between similar assets. The protocol uses the StableSwap invariant to minimize impermanent loss while providing competitive yields through CRV rewards.

### Key Features

Curve offers direct pool access with granular control over liquidity provision. The MetaRegistry system enables efficient pool discovery by querying pools containing specific token pairs. Liquidity gauges distribute CRV rewards to staked LP token holders, with boost multipliers for veCRV holders. The protocol supports over 100 pools across Ethereum, Arbitrum, Optimism, and Polygon. Curve pools typically contain 2-4 tokens with similar values, such as stablecoin pools (USDT/USDC/DAI) or wrapped asset pools (wBTC/renBTC/sBTC).

### Contract Addresses (Ethereum Mainnet)

| Contract | Address | Purpose |
|----------|---------|---------|
| MetaRegistry | `0xF98B45FA17DE75FB1aD0e7aFD971b0ca00e379fC` | Pool discovery |
| CRV Token | `0xD533a949740bb3306d119CC777fa900bA034cd52` | Reward token |
| Minter | `0xd061D61a4d941c39E5453435B6345Dc261C2fcE0` | CRV minting |

### Usage Example

```typescript
import { CurveAdapter } from './adapters/yield';
import { ethers } from 'ethers';

// Initialize adapter
const curve = new CurveAdapter({
  provider,
  wallet,
  chainId: 1,
});

// Find pools containing USDC and DAI
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const pools = await curve.findPools(USDC, DAI);
console.log(`Found ${pools.length} pools`);

// Get pool info
const pool = pools[0];
const poolInfo = await curve.getPoolInfo(pool);
console.log(`Pool: ${poolInfo.name}`);
console.log(`Tokens: ${poolInfo.coins.length}`);
console.log(`LP Token: ${poolInfo.lpToken}`);
console.log(`Gauge: ${poolInfo.gauge}`);

// Add liquidity to 3pool (USDC, DAI, USDT)
const amounts = [
  ethers.parseUnits('1000', 6),  // 1000 USDC
  ethers.parseEther('1000'),      // 1000 DAI
  ethers.parseUnits('1000', 6),  // 1000 USDT
];
const minMintAmount = ethers.parseEther('2990'); // 0.33% slippage
await curve.addLiquidity(pool, amounts, minMintAmount);

// Stake LP tokens in gauge
const gauge = poolInfo.gauge;
const lpAmount = ethers.parseEther('3000');
await curve.stakeInGauge(gauge, lpAmount);

// Get position
const position = await curve.getPosition(gauge);
console.log(`Staked: ${position.metadata.stakedBalance}`);
console.log(`Pending CRV: ${position.metadata.pendingCRV}`);

// Claim CRV rewards
await curve.claimRewards(gauge);

// Unstake and remove liquidity
await curve.unstakeFromGauge(gauge, lpAmount);
const minAmounts = [
  ethers.parseUnits('990', 6),   // Min 990 USDC
  ethers.parseEther('990'),       // Min 990 DAI
  ethers.parseUnits('990', 6),   // Min 990 USDT
];
await curve.removeLiquidity(pool, lpAmount, minAmounts);
```

### MetaRegistry System

The Curve MetaRegistry aggregates information from multiple pool registries, providing a unified interface for pool discovery. The adapter uses `find_pools_for_coins()` to locate pools containing specific token pairs, `get_pool_name()` to retrieve human-readable pool names, `get_coins()` to get pool token addresses, `get_gauge()` to find the liquidity gauge for reward staking, and `get_virtual_price_from_lp_token()` to calculate LP token value in USD.

## Balancer V2 Adapter

Balancer V2 introduces a revolutionary Vault architecture where all pool tokens are held in a single contract. This design improves capital efficiency and enables complex pool compositions with custom token weights.

### Key Features

Balancer's Vault architecture centralizes all pool tokens in one contract, reducing gas costs and improving security. Weighted pools support custom token ratios such as 80/20, 60/40, or 33/33/33, enabling capital-efficient liquidity provision with reduced impermanent loss. The protocol supports composable pools where BPT tokens from one pool can be used in another pool. Liquidity gauges distribute BAL rewards to staked BPT holders, with boost multipliers for veBAL holders. Balancer operates across Ethereum, Arbitrum, Optimism, Polygon, and other chains.

### Contract Addresses (Ethereum Mainnet)

| Contract | Address | Purpose |
|----------|---------|---------|
| Vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | Core token vault |
| BAL Token | `0xba100000625a3754423978a60c9317c58a424e3D` | Governance token |
| BalancerHelpers | `0x5aDDCCa35b7A0D07C74063c48700C8590E87864E` | Query helpers |

### Usage Example

```typescript
import { BalancerAdapter } from './adapters/yield';
import { ethers } from 'ethers';

// Initialize adapter
const balancer = new BalancerAdapter({
  provider,
  wallet,
  chainId: 1,
});

// 80/20 BAL/ETH pool
const poolId = '0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014';

// Get pool info
const poolInfo = await balancer.getPoolInfo(poolId);
console.log(`Pool address: ${poolInfo.poolAddress}`);
console.log(`Tokens: ${poolInfo.tokens}`);
console.log(`Weights: ${poolInfo.weights}`);

// Join pool (add liquidity)
const BAL = '0xba100000625a3754423978a60c9317c58a424e3D';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const amounts = [
  ethers.parseEther('800'),  // 800 BAL (80%)
  ethers.parseEther('1'),    // 1 ETH (20%)
];
const minBptOut = ethers.parseEther('10'); // Minimum BPT to receive
await balancer.joinPool(poolId, amounts, minBptOut);

// Stake BPT in gauge
const gauge = '0x68d019f64A7aa97e2D4e7363AEE42251D08124Fb'; // Example gauge
const bptAmount = ethers.parseEther('10');
await balancer.stakeInGauge(gauge, bptAmount);

// Get position
const position = await balancer.getPosition(poolId, gauge);
console.log(`Staked: ${position.metadata.stakedBalance}`);
console.log(`Pending BAL: ${position.metadata.pendingBAL}`);

// Claim BAL rewards
await balancer.claimRewards(gauge);

// Unstake and exit pool
await balancer.unstakeFromGauge(gauge, bptAmount);
const minAmountsOut = [
  ethers.parseEther('790'),  // Min 790 BAL
  ethers.parseEther('0.99'), // Min 0.99 ETH
];
await balancer.exitPool(poolId, bptAmount, minAmountsOut);
```

### Pool ID System

Balancer uses a 32-byte poolId to uniquely identify each pool. The poolId encodes the pool address and pool specialization type. Pool IDs can be obtained from the Balancer UI, Balancer subgraph, or by calling `getPoolId()` on a pool contract. The Vault uses poolId for all join, exit, and query operations.

## Risk Management

Yield farming involves several risk factors that the Floor Engine monitors and mitigates through diversification and position limits.

### Smart Contract Risk

All three protocols have undergone extensive security audits and have been battle-tested with billions of dollars in TVL. Curve was audited by Trail of Bits and has operated since 2020 without major incidents. Convex was audited by Mixbytes and builds on top of Curve's proven infrastructure. Balancer V2 was audited by OpenZeppelin, Trail of Bits, and Certora, with multiple audit rounds covering the Vault architecture.

### Impermanent Loss Risk

Impermanent loss occurs when token prices diverge within a liquidity pool. The Floor Engine minimizes this risk by focusing on stablecoin pools where price divergence is minimal. Curve pools containing USDT, USDC, and DAI typically experience less than 0.1% impermanent loss. Convex inherits the same low impermanent loss characteristics as Curve. Balancer weighted pools can experience higher impermanent loss, which is why the allocation is limited to 3% of total capital.

### Liquidity Risk

All three protocols maintain deep liquidity in major pools, enabling quick position exits without significant slippage. Curve 3pool holds over $500M in liquidity. Convex pools can always be withdrawn back to Curve LP tokens. Balancer major pools maintain $50M+ liquidity. The Floor Engine monitors pool liquidity continuously and avoids pools with insufficient depth.

### Reward Token Risk

Yield farming rewards are paid in protocol governance tokens (CRV, CVX, BAL) which have price volatility. The Floor Engine implements automatic reward harvesting and conversion to stablecoins to lock in gains. CRV has high liquidity on major DEXs with $50M+ daily volume. CVX is tied to Convex protocol success with medium liquidity. BAL has established liquidity with $10M+ daily volume.

## Performance Monitoring

The Floor Engine continuously monitors yield farming performance through several key metrics.

### APY Tracking

Each adapter provides real-time APY estimates based on reward rates, token prices, and pool TVL. The system tracks both base APY from trading fees and bonus APY from reward token emissions. Convex typically delivers 5-12% APY on stablecoin pools. Curve direct staking provides 3-8% APY. Balancer weighted pools achieve 4-10% APY depending on composition.

### Position Health

Health checks run periodically to ensure adapter functionality and pool health. The system verifies contract accessibility, validates pool states, checks for paused or shutdown pools, and monitors reward accrual rates. Any health check failures trigger automatic alerts and can pause new deposits.

### Reward Harvesting

The Floor Engine implements automated reward harvesting to compound yields and reduce gas costs. Rewards are claimed when the accumulated value exceeds gas costs by a minimum threshold (typically $100). Harvested rewards are automatically converted to stablecoins or reinvested based on strategy configuration. The system batches multiple reward claims in a single transaction when possible.

## Integration with Floor Engine

The yield farming adapters integrate seamlessly with the Floor Engine's capital allocation system through the Orchestrator component.

### Allocation Strategy

The Orchestrator allocates 20% of total capital to yield farming based on the following strategy. Convex receives 60% of yield farming allocation (12% of total) focused on 3pool and other major stablecoin pools. Curve receives 25% of yield farming allocation (5% of total) for direct exposure to select pools. Balancer receives 15% of yield farming allocation (3% of total) for weighted pool diversification.

### Rebalancing Logic

The Floor Engine rebalances yield farming positions based on APY differentials, pool health, and risk metrics. If a pool's APY drops below threshold, capital is reallocated to higher-yielding opportunities. If a pool experiences high volatility or liquidity issues, positions are reduced or exited. The system maintains minimum and maximum position sizes to ensure diversification.

### Emergency Procedures

In case of protocol issues or market stress, the Floor Engine can execute emergency withdrawals. Each adapter supports rapid position unwinding through unstake and withdraw operations. The system prioritizes capital preservation over yield optimization during emergency scenarios. All emergency actions are logged and reported to administrators.

## Testing and Verification

All yield farming adapters have been thoroughly tested against live mainnet contracts to ensure correctness and reliability.

### Contract Verification

Every contract address has been verified on Etherscan to ensure ABI correctness. The adapters use the exact ABIs from verified contracts, not approximations or assumptions. All method signatures have been tested against live contracts to confirm compatibility.

### Integration Testing

The adapters have been tested in a forked mainnet environment to simulate real-world conditions. Tests cover deposit, withdrawal, reward claiming, position queries, and error handling. Edge cases such as zero balances, insufficient allowances, and slippage protection have been validated.

### Production Readiness

The yield farming adapters are production-ready and suitable for deployment with real capital. All code follows TypeScript best practices with comprehensive error handling. Logging provides detailed visibility into all operations for debugging and monitoring. The adapters integrate cleanly with the Floor Engine's existing infrastructure.

## Future Enhancements

Several enhancements are planned for future versions of the yield farming adapters.

### Multi-Chain Support

Expand Convex adapter to support Arbitrum and Polygon deployments. Add Curve support for Optimism and Polygon pools. Implement Balancer support for Arbitrum and Optimism.

### Advanced Strategies

Implement auto-compounding strategies that automatically reinvest rewards. Add support for leveraged yield farming through lending protocols. Integrate with yield aggregators like Yearn for optimized returns.

### Dynamic APY Calculation

Replace estimated APY with real-time on-chain calculations. Integrate with Curve API for accurate pool APY data. Use Balancer subgraph for historical APY tracking.

### Gas Optimization

Implement batch operations to reduce gas costs. Use multicall for position queries across multiple pools. Optimize approval patterns to minimize transactions.

## Conclusion

The yield farming adapters provide a robust, production-ready foundation for the Floor Engine's yield farming strategy. By supporting three complementary protocols (Convex, Curve, Balancer), the system achieves optimal diversification while maintaining simplicity and reliability. The adapters follow consistent patterns, provide comprehensive error handling, and integrate seamlessly with the Floor Engine's capital allocation system.

With 20% of capital allocated to yield farming, the Floor Engine targets 5-10% APY with low risk, contributing significantly to overall portfolio returns while maintaining the protocol's commitment to capital preservation and sustainable growth.

---

**Documentation Version**: 1.0  
**Last Updated**: November 9, 2025  
**Maintainer**: Noderr Protocol Team
