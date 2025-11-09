# Staking Adapters

Comprehensive staking protocol adapters for the Noderr Floor Engine. These adapters provide a unified interface for interacting with major Ethereum staking protocols.

## Overview

The staking adapters implement the `IStakingAdapter` interface, providing standardized methods for:
- **Stake**: Deposit ETH to earn staking rewards
- **Unstake**: Withdraw staked ETH
- **Claim Rewards**: Claim accrued staking rewards (where applicable)
- **Position Tracking**: Monitor staked amount and total value
- **APY Calculation**: Get current staking APY
- **Health Checks**: Verify adapter functionality

## Supported Protocols

### 1. Lido Adapter

**Chain support**: Ethereum mainnet

Lido is the largest liquid staking protocol with over $30B TVL. It allows users to stake any amount of ETH and receive stETH, a liquid staking token that automatically accrues rewards through rebasing.

**Features:**
- Liquid staking with stETH (1:1 with ETH)
- No minimum deposit requirement
- Automatic reward accrual through rebase
- Withdrawal queue system for unstaking
- Position tracking with exchange rate
- Health check functionality

**Usage:**
```typescript
import { LidoAdapter } from './staking';

const adapter = new LidoAdapter({
  provider,
  wallet,
  chainId: 1, // Ethereum only
});

// Stake 10 ETH
await adapter.stake(ethers.parseEther('10'));

// Get position
const position = await adapter.getPosition();
console.log(`Staked: ${ethers.formatEther(position.supplied)} stETH`);
console.log(`Value: ${ethers.formatEther(position.totalValue)} ETH`);
console.log(`APY: ${position.apy}%`);

// Unstake (request withdrawal)
await adapter.unstake(ethers.parseEther('5'));
```

**Key Characteristics:**
- **TVL**: ~$30B (largest liquid staking protocol)
- **APY**: ~3.5% (historical average)
- **Minimum Stake**: None
- **Withdrawal Time**: ~1-5 days (withdrawal queue)
- **Liquidity**: Highest (stETH tradeable on all major DEXs)

**Important Notes:**
- stETH accrues rewards through daily rebases
- Unstaking requires using the withdrawal queue
- Withdrawal requests must be claimed after finalization
- stETH can be traded on secondary markets for instant liquidity

---

### 2. Rocket Pool Adapter

**Chain support**: Ethereum mainnet

Rocket Pool is a decentralized liquid staking protocol with over $3B TVL. It allows users to stake any amount of ETH and receive rETH, a liquid staking token that appreciates in value relative to ETH.

**Features:**
- Decentralized liquid staking with rETH
- No minimum deposit requirement (subject to deposit pool capacity)
- Automatic reward accrual through exchange rate appreciation
- Direct burning for unstaking (when liquidity available)
- Position tracking with ETH value calculation
- Health check functionality

**Usage:**
```typescript
import { RocketPoolAdapter } from './staking';

const adapter = new RocketPoolAdapter({
  provider,
  wallet,
  chainId: 1, // Ethereum only
});

// Check maximum deposit amount
const maxDeposit = await adapter.getMaximumDepositAmount();
console.log(`Max deposit: ${ethers.formatEther(maxDeposit)} ETH`);

// Stake 10 ETH
await adapter.stake(ethers.parseEther('10'));

// Get position
const position = await adapter.getPosition();
console.log(`rETH Balance: ${position.metadata.rETHBalance}`);
console.log(`ETH Value: ${position.metadata.ethValue}`);
console.log(`Exchange Rate: ${position.metadata.exchangeRate}`);
console.log(`APY: ${position.apy}%`);

// Unstake (burn rETH for ETH)
await adapter.unstake(ethers.parseEther('5'));
```

**Key Characteristics:**
- **TVL**: ~$3B (largest decentralized liquid staking protocol)
- **APY**: ~3.2% (historical average)
- **Minimum Stake**: None (subject to deposit pool capacity)
- **Withdrawal Time**: Instant (if deposit pool has liquidity)
- **Liquidity**: High (rETH tradeable on major DEXs)

**Important Notes:**
- rETH appreciates in value relative to ETH (no rebasing)
- Unstaking burns rETH directly for ETH (if liquidity available)
- Deposit pool capacity may limit deposits during high demand
- rETH can be traded on secondary markets for instant liquidity

---

### 3. Native ETH Adapter

**Chain support**: Ethereum mainnet

Native ETH staking allows direct participation in Ethereum's consensus mechanism by running a validator. This requires 32 ETH and validator infrastructure.

**Features:**
- Direct validator staking (32 ETH per validator)
- Highest level of decentralization
- Full control over validator keys
- Position tracking (simplified)
- Health check functionality

**Usage:**
```typescript
import { NativeETHAdapter } from './staking';

const adapter = new NativeETHAdapter({
  provider,
  wallet,
  chainId: 1, // Ethereum only
  validatorDataProvider: async () => ({
    pubkey: '0x...', // BLS12-381 public key
    withdrawalCredentials: '0x...', // Withdrawal credentials
    signature: '0x...', // BLS12-381 signature
    depositDataRoot: '0x...', // Deposit data root
  }),
});

// Stake 32 ETH (full validator)
await adapter.stake(ethers.parseEther('32'));

// Get position
const position = await adapter.getPosition();
console.log(`Staked: ${ethers.formatEther(position.supplied)} ETH`);
console.log(`APY: ${position.apy}%`);

// Note: Unstaking requires validator infrastructure
// await adapter.unstake(ethers.parseEther('32'));
```

**Key Characteristics:**
- **TVL**: N/A (direct staking, not pooled)
- **APY**: ~4.0% (base + MEV rewards)
- **Minimum Stake**: 32 ETH (exact)
- **Withdrawal Time**: ~27 hours minimum (exit queue + withdrawal processing)
- **Liquidity**: None (no liquid token)

**Important Notes:**
- Requires exactly 32 ETH per validator
- Requires validator infrastructure (beacon node, validator client)
- Requires validator keys generated with deposit-cli or similar tool
- Unstaking requires submitting voluntary exit from validator
- Rewards distributed automatically to withdrawal address
- **Not recommended for most use cases** - use liquid staking instead

**Prerequisites:**
1. Generate validator keys using [staking-deposit-cli](https://github.com/ethereum/staking-deposit-cli)
2. Set up validator infrastructure (beacon node + validator client)
3. Configure withdrawal credentials (0x01 for withdrawals)
4. Monitor validator performance and uptime

---

## Common Interface

All staking adapters implement the `IStakingAdapter` interface:

```typescript
interface IStakingAdapter {
  stake(amount: bigint): Promise<string>;
  unstake(amount: bigint): Promise<string>;
  claimRewards(): Promise<string>;
  getPosition(): Promise<AdapterPosition>;
  getAPY(): Promise<number>;
  healthCheck(): Promise<{ healthy: boolean; reason?: string }>;
}
```

### AdapterPosition Structure

```typescript
interface AdapterPosition {
  totalValue: bigint;      // Total value in ETH
  supplied: bigint;        // Staked amount (stETH, rETH, or ETH)
  borrowed: bigint;        // Always 0 for staking
  apy: number;             // Current APY (percentage)
  healthFactor: number;    // Always Infinity for staking (no liquidation risk)
  metadata?: Record<string, any>; // Protocol-specific data
}
```

---

## Protocol Comparison

| Feature | Lido | Rocket Pool | Native ETH |
|---------|------|-------------|------------|
| **TVL** | ~$30B | ~$3B | N/A |
| **APY** | ~3.5% | ~3.2% | ~4.0% |
| **Min Stake** | None | None* | 32 ETH |
| **Withdrawal Time** | 1-5 days | Instant* | ~27 hours |
| **Liquidity** | Highest | High | None |
| **Decentralization** | Medium | High | Highest |
| **Complexity** | Low | Low | High |
| **Recommended For** | Most users | Decentralization-focused | Advanced users |

\* Subject to deposit pool capacity and liquidity

---

## Capital Allocation Strategy

Based on the Floor Engine architecture, staking protocols will receive **30% of total capital allocation**:

### Target Allocation (30% Staking)
- **Lido**: 20% (highest liquidity, largest protocol)
- **Rocket Pool**: 10% (decentralization, good liquidity)
- **Native ETH**: 0% (not recommended for treasury management)

### Expected Performance
- **Target APY**: 3-5%
- **Max Drawdown**: <2%
- **Risk Level**: Very Low (staking is lowest risk DeFi primitive)

---

## Error Handling

All adapters include comprehensive error handling:

```typescript
try {
  await adapter.stake(amount);
} catch (error) {
  if (error.message.includes('insufficient')) {
    console.error('Insufficient ETH balance');
  } else if (error.message.includes('maximum')) {
    console.error('Exceeds maximum deposit amount');
  } else {
    console.error('Unexpected error:', error.message);
  }
}
```

---

## Health Checks

All adapters support health checks to verify functionality:

```typescript
const health = await adapter.healthCheck();

if (health.healthy) {
  console.log('Adapter is healthy');
} else {
  console.error('Adapter unhealthy:', health.reason);
}
```

---

## Best Practices

### 1. Reward Accrual

**Lido (stETH):**
- Rewards accrue automatically through daily rebases
- No claim transaction needed
- stETH balance increases daily

**Rocket Pool (rETH):**
- Rewards accrue through exchange rate appreciation
- No claim transaction needed
- rETH value in ETH increases over time

**Native ETH:**
- Rewards distributed automatically to withdrawal address
- No claim transaction needed
- Requires withdrawal credentials configured

### 2. Unstaking Process

**Lido:**
```typescript
// 1. Request withdrawal
const txHash = await adapter.unstake(amount);

// 2. Wait for finalization (1-5 days)
// Check status periodically

// 3. Claim withdrawal
const requestIds = [/* your request IDs */];
await adapter.claimWithdrawals(requestIds);
```

**Rocket Pool:**
```typescript
// Instant unstaking (if liquidity available)
const txHash = await adapter.unstake(amount);

// If no liquidity, sell rETH on secondary market
```

**Native ETH:**
```typescript
// Requires validator infrastructure
// 1. Submit voluntary exit from validator client
// 2. Wait for exit queue (~27 hours)
// 3. Rewards automatically sent to withdrawal address
```

### 3. Position Monitoring

Regularly check positions to monitor performance:

```typescript
const position = await adapter.getPosition();

console.log(`Total Value: ${ethers.formatEther(position.totalValue)} ETH`);
console.log(`Staked: ${ethers.formatEther(position.supplied)}`);
console.log(`APY: ${position.apy}%`);
console.log(`Health Factor: ${position.healthFactor}`);
```

### 4. Exchange Rate Tracking

**Lido:**
```typescript
const exchangeRate = await adapter.getExchangeRate();
console.log(`stETH/ETH: ${ethers.formatEther(exchangeRate)}`);
```

**Rocket Pool:**
```typescript
const exchangeRate = await adapter.getExchangeRate();
console.log(`rETH/ETH: ${ethers.formatEther(exchangeRate)}`);

// Convert between ETH and rETH
const ethValue = await adapter.getETHValue(rethAmount);
const rethValue = await adapter.getRETHValue(ethAmount);
```

---

## Integration with Floor Engine

The staking adapters integrate with the Floor Engine orchestrator:

```typescript
import { FloorEngineOrchestrator } from '../orchestrator';
import { LidoAdapter, RocketPoolAdapter } from './staking';

const orchestrator = new FloorEngineOrchestrator({
  provider,
  wallet,
  chainId: 1,
});

// Register staking adapters
orchestrator.registerAdapter('lido-steth', new LidoAdapter({
  provider,
  wallet,
  chainId: 1,
}));

orchestrator.registerAdapter('rocket-pool-reth', new RocketPoolAdapter({
  provider,
  wallet,
  chainId: 1,
}));

// Allocate capital (30% staking target)
await orchestrator.allocateCapital(ethers.parseEther('100000'));
```

---

## Testing

Each adapter includes comprehensive test coverage:

```bash
# Run staking adapter tests
npm test -- staking

# Run specific adapter tests
npm test -- LidoAdapter
npm test -- RocketPoolAdapter
npm test -- NativeETHAdapter
```

---

## Security Considerations

### 1. Smart Contract Risk
- **Lido**: Audited by multiple firms, battle-tested with $30B TVL
- **Rocket Pool**: Audited by Sigma Prime and Consensys Diligence
- **Native ETH**: Direct Ethereum protocol, highest security

### 2. Slashing Risk
- **Lido**: Distributed across many validators, insurance fund available
- **Rocket Pool**: Distributed across many node operators, RPL collateral
- **Native ETH**: Full slashing risk if validator misbehaves

### 3. Liquidity Risk
- **Lido**: Highest liquidity, stETH tradeable everywhere
- **Rocket Pool**: Good liquidity, rETH tradeable on major DEXs
- **Native ETH**: No liquidity, must wait for withdrawal queue

### 4. Withdrawal Risk
- **Lido**: Withdrawal queue may have delays during high demand
- **Rocket Pool**: Instant if deposit pool has liquidity, otherwise trade on DEX
- **Native ETH**: Exit queue + withdrawal processing (~27 hours minimum)

---

## Roadmap

### Week 3 (Current)
- ✅ Lido Adapter
- ✅ Rocket Pool Adapter
- ✅ Native ETH Adapter

### Week 4 (Next)
- Yield farming adapters (Curve, Convex, Balancer)
- Integration with staking adapters

### Week 5
- Integration testing
- Multi-protocol optimization
- Performance benchmarking

### Week 6
- Production deployment
- Monitoring and alerting
- Documentation finalization

---

## Support

For issues or questions:
- GitHub Issues: [noderr-protocol](https://github.com/Noderrxyz/noderr-protocol)
- Documentation: [Floor Engine Architecture](../../FLOOR_ENGINE_ARCHITECTURE.md)
- Contact: dev@noderr.xyz

---

## License

MIT License - see LICENSE file for details
