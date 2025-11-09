# Lending Adapters

Comprehensive lending protocol adapters for the Noderr Floor Engine. These adapters provide a unified interface for interacting with major DeFi lending protocols across multiple chains.

## Overview

The lending adapters implement the `ILendingAdapter` interface, providing standardized methods for:
- **Supply**: Deposit assets to earn yield
- **Withdraw**: Withdraw supplied assets
- **Borrow**: Borrow assets against collateral
- **Repay**: Repay borrowed assets
- **Position Tracking**: Monitor supplied, borrowed, and total value
- **APY Calculation**: Get current supply APY
- **Health Checks**: Verify adapter functionality

## Supported Protocols

### 1. Aave V3 Adapter

**Multi-chain support**: Ethereum, Arbitrum, Optimism, Base

Aave V3 is the leading decentralized lending protocol with deep liquidity and competitive rates.

**Features:**
- Full lending functionality (supply, withdraw, borrow, repay)
- Multi-chain deployment across 4 networks
- Position tracking with health factor
- Real-time APY calculation
- Automatic token approvals
- Comprehensive error handling

**Usage:**
```typescript
import { AaveV3Adapter } from './lending';

const adapter = new AaveV3Adapter({
  provider,
  wallet,
  chainId: 1, // Ethereum
  poolAddress: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', // Optional
});

// Supply USDC
await adapter.supply(USDC_ADDRESS, ethers.parseUnits('1000', 6));

// Get position
const position = await adapter.getPosition();
console.log(`Total Value: ${position.totalValue}`);
console.log(`Health Factor: ${position.healthFactor}`);
```

**Supported Chains:**
- Ethereum (1): Full support
- Arbitrum (42161): Full support
- Optimism (10): Full support
- Base (8453): Full support

---

### 2. Compound V3 Adapter

**Multi-chain support**: Ethereum, Arbitrum, Base

Compound V3 (Comet) is a streamlined lending protocol with improved capital efficiency.

**Features:**
- Market-based lending (USDC, WETH, USDbC, USDC.e)
- Multi-chain deployment across 3 networks
- Utilization-based APY calculation
- Position tracking with health factor
- Automatic token approvals
- Comprehensive error handling

**Usage:**
```typescript
import { CompoundV3Adapter } from './lending';

const adapter = new CompoundV3Adapter({
  provider,
  wallet,
  chainId: 1, // Ethereum
  baseToken: 'USDC', // Market to use
});

// Supply USDC
await adapter.supply(USDC_ADDRESS, ethers.parseUnits('1000', 6));

// Get APY
const apy = await adapter.getAPY();
console.log(`Current APY: ${apy}%`);
```

**Supported Markets:**
- **Ethereum**: USDC, WETH
- **Arbitrum**: USDC, USDC.e
- **Base**: USDbC, WETH

**Important Notes:**
- In Compound V3, you can only borrow the base token
- Each market has a specific base token (e.g., USDC market → borrow USDC)
- Collateral can be any supported asset, but borrowing is limited to base token

---

### 3. Morpho Blue Adapter

**Single-chain support**: Ethereum mainnet

Morpho Blue is a next-generation lending protocol with flexible market creation and optimized rates.

**Features:**
- Market-based lending with custom loan/collateral pairs
- Shares-to-assets conversion
- Position tracking with collateral management
- Utilization-based APY calculation
- Automatic token approvals
- Comprehensive error handling

**Usage:**
```typescript
import { MorphoBlueAdapter } from './lending';

const adapter = new MorphoBlueAdapter({
  provider,
  wallet,
  chainId: 1, // Ethereum only
  marketId: '0x...', // Market ID (bytes32)
});

// Supply collateral
await adapter.supply(WETH_ADDRESS, ethers.parseEther('10'));

// Borrow loan token
await adapter.borrow(USDC_ADDRESS, ethers.parseUnits('5000', 6));

// Get position
const position = await adapter.getPosition();
console.log(`Collateral: ${position.metadata.collateral}`);
console.log(`Health Factor: ${position.healthFactor}`);
```

**Supported Chains:**
- Ethereum (1): Full support

**Important Notes:**
- Each market has a specific loan token and collateral token
- You can only borrow the loan token for that market
- Market IDs are bytes32 hashes of market parameters
- Morpho uses a shares-based system internally

---

### 4. Spark Adapter

**Single-chain support**: Ethereum mainnet

Spark Protocol is MakerDAO's lending protocol, forked from Aave V3 with DAI-focused features.

**Features:**
- Full lending functionality (supply, withdraw, borrow, repay)
- Variable and stable rate borrowing
- Position tracking with health factor
- Real-time APY calculation
- Automatic token approvals
- Comprehensive error handling

**Usage:**
```typescript
import { SparkAdapter } from './lending';

const adapter = new SparkAdapter({
  provider,
  wallet,
  chainId: 1, // Ethereum only
});

// Supply DAI
await adapter.supply(DAI_ADDRESS, ethers.parseEther('10000'));

// Get supply APY
const supplyAPY = await adapter.getAPY(DAI_ADDRESS);
console.log(`Supply APY: ${supplyAPY}%`);

// Get borrow APY
const borrowAPY = await adapter.getBorrowAPY(DAI_ADDRESS);
console.log(`Borrow APY: ${borrowAPY}%`);
```

**Supported Chains:**
- Ethereum (1): Full support

**Important Notes:**
- Spark is an Aave V3 fork with MakerDAO integration
- Supports both variable and stable rate borrowing
- Optimized for DAI lending and borrowing
- Uses the same interface as Aave V3

---

## Common Interface

All lending adapters implement the `ILendingAdapter` interface:

```typescript
interface ILendingAdapter {
  supply(token: string, amount: bigint): Promise<string>;
  withdraw(token: string, amount: bigint): Promise<string>;
  borrow(token: string, amount: bigint): Promise<string>;
  repay(token: string, amount: bigint): Promise<string>;
  getPosition(token?: string): Promise<AdapterPosition>;
  getAPY(token?: string): Promise<number>;
  healthCheck(): Promise<{ healthy: boolean; reason?: string }>;
}
```

### AdapterPosition Structure

```typescript
interface AdapterPosition {
  totalValue: bigint;      // Total value (supplied - borrowed)
  supplied: bigint;        // Total supplied amount
  borrowed: bigint;        // Total borrowed amount
  apy: number;             // Current APY (percentage)
  healthFactor: number;    // Health factor (> 1 = healthy)
  metadata?: Record<string, any>; // Protocol-specific data
}
```

---

## Multi-Chain Support Matrix

| Protocol | Ethereum | Arbitrum | Optimism | Base |
|----------|----------|----------|----------|------|
| Aave V3 | ✅ | ✅ | ✅ | ✅ |
| Compound V3 | ✅ | ✅ | ❌ | ✅ |
| Morpho Blue | ✅ | ❌ | ❌ | ❌ |
| Spark | ✅ | ❌ | ❌ | ❌ |

---

## Error Handling

All adapters include comprehensive error handling:

```typescript
try {
  await adapter.supply(token, amount);
} catch (error) {
  if (error.code === 'INSUFFICIENT_FUNDS') {
    console.error('Insufficient token balance');
  } else if (error.code === 'NETWORK_ERROR') {
    console.error('Network connection failed');
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

### 1. Token Approvals
All adapters handle token approvals automatically. They check existing allowances and only approve when necessary to save gas.

### 2. Health Factor Monitoring
Always monitor health factor when borrowing:
- **> 1.5**: Safe
- **1.2 - 1.5**: Moderate risk
- **< 1.2**: High risk of liquidation
- **< 1.0**: Liquidation imminent

### 3. APY Calculation
APY values are calculated in real-time from on-chain data:
- Aave V3: Uses reserve data liquidity rate
- Compound V3: Uses utilization-based rate model
- Morpho Blue: Uses simplified utilization model
- Spark: Uses reserve data liquidity rate (Aave V3 fork)

### 4. Multi-Chain Deployment
When deploying across multiple chains:
```typescript
const chains = [1, 42161, 10, 8453]; // Ethereum, Arbitrum, Optimism, Base

for (const chainId of chains) {
  if (AaveV3Adapter.isChainSupported(chainId)) {
    const adapter = new AaveV3Adapter({
      provider: providers[chainId],
      wallet: wallets[chainId],
      chainId,
    });
    
    // Use adapter...
  }
}
```

### 5. Position Management
Regularly check positions to monitor performance:
```typescript
const position = await adapter.getPosition();

console.log(`Total Value: ${ethers.formatEther(position.totalValue)} ETH`);
console.log(`Supplied: ${ethers.formatEther(position.supplied)} ETH`);
console.log(`Borrowed: ${ethers.formatEther(position.borrowed)} ETH`);
console.log(`APY: ${position.apy}%`);
console.log(`Health Factor: ${position.healthFactor}`);
```

---

## Integration with Floor Engine

The lending adapters integrate with the Floor Engine orchestrator:

```typescript
import { FloorEngineOrchestrator } from '../orchestrator';
import { AaveV3Adapter, CompoundV3Adapter } from './lending';

const orchestrator = new FloorEngineOrchestrator({
  provider,
  wallet,
  chainId: 1,
});

// Register lending adapters
orchestrator.registerAdapter('aave-v3-usdc', new AaveV3Adapter({
  provider,
  wallet,
  chainId: 1,
}));

orchestrator.registerAdapter('compound-v3-usdc', new CompoundV3Adapter({
  provider,
  wallet,
  chainId: 1,
  baseToken: 'USDC',
}));

// Allocate capital (50% lending target)
await orchestrator.allocateCapital(ethers.parseEther('100000'));
```

---

## Testing

Each adapter includes comprehensive test coverage:

```bash
# Run lending adapter tests
npm test -- lending

# Run specific adapter tests
npm test -- AaveV3Adapter
npm test -- CompoundV3Adapter
npm test -- MorphoBlueAdapter
npm test -- SparkAdapter
```

---

## Security Considerations

### 1. Token Approvals
- Adapters use exact approval amounts (not infinite)
- Approvals are checked before each transaction
- Unused approvals can be revoked manually

### 2. Health Factor
- Always maintain health factor > 1.2
- Set up monitoring and alerts for health factor < 1.5
- Consider automated deleveraging when health factor drops

### 3. Smart Contract Risk
- All adapters interact with audited protocols
- Aave V3: Audited by multiple firms
- Compound V3: Audited by OpenZeppelin
- Morpho Blue: Audited by Spearbit
- Spark: Fork of Aave V3 (audited)

### 4. Oracle Risk
- Lending protocols rely on price oracles
- Monitor oracle health and price deviations
- Be aware of potential oracle manipulation

---

## Roadmap

### Week 2 (Current)
- ✅ Aave V3 Adapter
- ✅ Compound V3 Adapter
- ✅ Morpho Blue Adapter
- ✅ Spark Adapter

### Week 3 (Next)
- Staking adapters (Lido, Rocket Pool, Native ETH)
- Integration with lending adapters

### Week 4
- Yield farming adapters (Curve, Convex, Balancer)
- Cross-protocol optimization

### Week 5
- Integration testing
- Multi-chain deployment
- Performance optimization

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
