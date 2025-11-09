# Floor Engine Architecture Design

**Version:** 1.0  
**Date:** November 9, 2025  
**Status:** Design Phase

---

## 1. Overview

The **Floor Engine** is a low-risk yield generation system that provides stable returns (4-8% APY) for the Noderr treasury through automated deployment to lending protocols, liquid staking, and yield farming strategies.

### **Design Principles:**

1. **Safety First:** Capital preservation over maximum yield
2. **Diversification:** Multi-protocol, multi-chain deployment
3. **Automation:** Automated rebalancing and compounding
4. **Transparency:** All positions and yields on-chain and auditable
5. **Modularity:** Adapter-based architecture for easy protocol integration

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Floor Engine Orchestrator                    │
│  - Capital allocation logic                                      │
│  - Automated rebalancing                                         │
│  - Yield optimization                                            │
│  - Risk management integration                                   │
└──────────────────────┬──────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
┌───────▼──────┐ ┌────▼─────┐ ┌──────▼───────┐
│   Lending    │ │ Staking  │ │    Yield     │
│   Adapters   │ │ Adapters │ │   Adapters   │
└───────┬──────┘ └────┬─────┘ └──────┬───────┘
        │              │              │
   ┌────┴────┐    ┌───┴────┐    ┌────┴─────┐
   │ Aave    │    │ Lido   │    │ Curve    │
   │ Compound│    │ RocketP│    │ Convex   │
   │ Morpho  │    │ Native │    │ Balancer │
   │ Spark   │    │ ETH    │    │          │
   └─────────┘    └────────┘    └──────────┘
```

---

## 3. Core Components

### **3.1 Floor Engine Orchestrator**

**Responsibilities:**
- Allocate capital across adapters based on risk/yield profiles
- Monitor adapter performance and health
- Trigger rebalancing when thresholds are breached
- Harvest and compound yields
- Report performance to TreasuryManager

**Key Functions:**
```typescript
allocateCapital(amount: bigint, strategy: AllocationStrategy): Promise<void>
rebalance(): Promise<void>
harvestYields(): Promise<bigint>
getPositions(): Promise<Position[]>
getTotalValue(): Promise<bigint>
getAPY(): Promise<number>
```

---

### **3.2 Adapter Registry**

**Responsibilities:**
- Register and manage adapters
- Enable/disable adapters
- Version control for adapters
- Emit unified execution events

**Adapter Metadata:**
```typescript
interface AdapterMetadata {
  name: string;
  version: string;
  protocol: string;
  chain: string;
  category: 'lending' | 'staking' | 'yield';
  riskLevel: 'low' | 'medium' | 'high';
  enabled: boolean;
  maxAllocation: bigint; // Maximum capital per adapter
}
```

**Key Functions:**
```typescript
registerAdapter(adapter: IAdapter, metadata: AdapterMetadata): Promise<void>
enableAdapter(adapterId: string): Promise<void>
disableAdapter(adapterId: string): Promise<void>
getAdapter(adapterId: string): Promise<IAdapter>
getAllAdapters(category?: string): Promise<IAdapter[]>
```

---

### **3.3 Risk Manager**

**Responsibilities:**
- Enforce per-adapter allocation limits
- Maintain token/pool allow lists
- Monitor slippage and price impact
- Trigger emergency pauses
- Track exposure across protocols

**Risk Parameters:**
```typescript
interface RiskParameters {
  maxAllocationPerAdapter: bigint;     // e.g., 20% of total capital
  maxAllocationPerProtocol: bigint;    // e.g., 40% of total capital
  maxAllocationPerChain: bigint;       // e.g., 60% of total capital
  maxSlippageBps: number;              // e.g., 50 bps (0.5%)
  allowedTokens: string[];             // Whitelist of tokens
  allowedProtocols: string[];          // Whitelist of protocols
  emergencyPauseEnabled: boolean;
}
```

**Key Functions:**
```typescript
validateAllocation(adapterId: string, amount: bigint): Promise<boolean>
checkSlippage(expectedOut: bigint, actualOut: bigint): boolean
emergencyPause(): Promise<void>
getExposure(protocol: string): Promise<bigint>
getTotalRisk(): Promise<RiskMetrics>
```

---

## 4. Adapter Interfaces

### **4.1 Lending Adapter Interface**

```typescript
interface ILendingAdapter {
  // Supply capital to lending protocol
  supply(asset: string, amount: bigint): Promise<TransactionResult>;
  
  // Withdraw capital from lending protocol
  withdraw(asset: string, shares: bigint): Promise<TransactionResult>;
  
  // Borrow against collateral (optional for Floor Engine)
  borrow(asset: string, amount: bigint, maxRateBps: number): Promise<TransactionResult>;
  
  // Repay borrowed amount
  repay(asset: string, amount: bigint): Promise<TransactionResult>;
  
  // Get current supply APY
  getSupplyAPY(asset: string): Promise<number>;
  
  // Get current position
  getPosition(asset: string): Promise<LendingPosition>;
}

interface LendingPosition {
  supplied: bigint;
  borrowed: bigint;
  collateralValue: bigint;
  healthFactor: number;
  supplyAPY: number;
  borrowAPY: number;
}
```

---

### **4.2 Staking Adapter Interface**

```typescript
interface IStakingAdapter {
  // Stake assets (e.g., ETH -> stETH)
  stake(amount: bigint): Promise<TransactionResult>;
  
  // Unstake assets (may have unbonding period)
  unstake(shares: bigint): Promise<TransactionResult>;
  
  // Claim staking rewards
  claimRewards(): Promise<TransactionResult>;
  
  // Get current staking APY
  getAPY(): Promise<number>;
  
  // Get current position
  getPosition(): Promise<StakingPosition>;
}

interface StakingPosition {
  staked: bigint;
  rewards: bigint;
  exchangeRate: bigint; // e.g., stETH/ETH rate
  apy: number;
  unbondingPeriod: number; // seconds
}
```

---

### **4.3 Yield Farming Adapter Interface**

```typescript
interface IYieldAdapter {
  // Deposit into yield farm
  deposit(lpToken: string, amount: bigint): Promise<TransactionResult>;
  
  // Withdraw from yield farm
  withdraw(lpToken: string, shares: bigint): Promise<TransactionResult>;
  
  // Harvest yield rewards
  harvest(): Promise<TransactionResult>;
  
  // Compound rewards back into position
  compound(): Promise<TransactionResult>;
  
  // Get current yield APY
  getAPY(lpToken: string): Promise<number>;
  
  // Get current position
  getPosition(lpToken: string): Promise<YieldPosition>;
}

interface YieldPosition {
  deposited: bigint;
  rewards: bigint;
  apy: number;
  rewardTokens: string[];
}
```

---

## 5. Capital Allocation Strategy

### **5.1 Target Allocation (Conservative)**

| Category | Target % | Protocols | Expected APY |
|:---|:---:|:---|:---:|
| **Lending** | 50% | Aave (25%), Compound (15%), Morpho (10%) | 3-5% |
| **Staking** | 30% | Lido (20%), Rocket Pool (10%) | 3-4% |
| **Yield Farming** | 20% | Curve (10%), Convex (5%), Balancer (5%) | 5-10% |

**Blended APY Target:** 4-6%

---

### **5.2 Rebalancing Triggers**

**Rebalance when:**
1. Any adapter deviates > 5% from target allocation
2. APY drops > 20% below expected
3. Risk metrics exceed thresholds
4. New capital is deposited (> 10% of total)
5. Manual trigger by Oracle Committee

**Rebalancing Logic:**
```typescript
async function rebalance() {
  const positions = await getPositions();
  const totalValue = await getTotalValue();
  
  for (const position of positions) {
    const currentAllocation = (position.value / totalValue) * 100;
    const targetAllocation = TARGET_ALLOCATIONS[position.adapterId];
    const deviation = Math.abs(currentAllocation - targetAllocation);
    
    if (deviation > REBALANCE_THRESHOLD) {
      if (currentAllocation > targetAllocation) {
        // Withdraw excess
        await withdraw(position.adapterId, excessAmount);
      } else {
        // Deposit deficit
        await deposit(position.adapterId, deficitAmount);
      }
    }
  }
}
```

---

## 6. Multi-Chain Support

### **6.1 Supported Chains (Priority Order)**

1. **Ethereum** - Primary deployment, highest liquidity
2. **Arbitrum** - Lower gas costs, good DeFi ecosystem
3. **Optimism** - Lower gas costs, Synthetix ecosystem
4. **Base** - Coinbase L2, growing ecosystem

### **6.2 Cross-Chain Bridging**

**Bridges (Allow-Listed Only):**
- Across Protocol (preferred)
- Stargate (backup)
- Hop Protocol (backup)

**Bridging Strategy:**
- Only bridge when yield differential > 2% APY
- Bridge fees must be < 0.1% of amount
- Minimum bridge amount: $10,000 equivalent
- Maximum 20% of capital on non-Ethereum chains

---

## 7. Risk Management

### **7.1 Risk Limits**

| Parameter | Limit | Rationale |
|:---|:---|:---|
| **Max per adapter** | 20% | Protocol risk diversification |
| **Max per protocol** | 40% | Protocol risk diversification |
| **Max per chain** | 60% | Chain risk (Ethereum primary) |
| **Max slippage** | 0.5% | Execution quality |
| **Max drawdown** | 5% | Capital preservation |

### **7.2 Emergency Procedures**

**Trigger Conditions:**
- Protocol exploit detected
- Abnormal price movements (> 10% in 1 hour)
- Oracle failure
- Smart contract pause
- Manual Oracle trigger

**Emergency Actions:**
1. Pause all new deposits
2. Withdraw all capital to TreasuryManager
3. Notify Oracle Committee
4. Generate incident report
5. Wait for Oracle approval to resume

---

## 8. Performance Tracking

### **8.1 Metrics**

```typescript
interface PerformanceMetrics {
  totalValue: bigint;
  totalDeposited: bigint;
  totalYield: bigint;
  currentAPY: number;
  averageAPY: number; // 30-day rolling
  sharpeRatio: number;
  maxDrawdown: number;
  positions: Position[];
  lastRebalance: number; // timestamp
  lastHarvest: number; // timestamp
}
```

### **8.2 Reporting**

**Daily:**
- Total value locked (TVL)
- Current APY
- Yield generated (24h)

**Weekly:**
- Performance vs. target
- Rebalancing history
- Risk metrics

**Monthly:**
- Comprehensive performance report
- Protocol comparison
- Optimization recommendations

---

## 9. Implementation Plan

### **Phase 1: Core Infrastructure (Week 1)**
- [ ] Floor Engine Orchestrator
- [ ] Adapter Registry
- [ ] Risk Manager
- [ ] Base adapter interfaces

### **Phase 2: Lending Adapters (Week 2)**
- [ ] Aave V3 Adapter
- [ ] Compound V3 Adapter
- [ ] Morpho Blue Adapter
- [ ] Spark Adapter

### **Phase 3: Staking Adapters (Week 3)**
- [ ] Lido Adapter (stETH)
- [ ] Rocket Pool Adapter (rETH)
- [ ] Native ETH Staking Adapter

### **Phase 4: Yield Adapters (Week 4)**
- [ ] Curve Adapter (stable pools)
- [ ] Convex Wrapper Adapter
- [ ] Balancer Boosted Adapter

### **Phase 5: Integration & Testing (Week 5)**
- [ ] End-to-end integration tests
- [ ] Rebalancing logic testing
- [ ] Emergency procedure testing
- [ ] Multi-chain deployment testing

### **Phase 6: Deployment (Week 6)**
- [ ] Testnet deployment
- [ ] Audit preparation
- [ ] Documentation finalization
- [ ] Mainnet deployment plan

---

## 10. Success Criteria

**Phase II is complete when:**
- ✅ All adapters implemented and tested
- ✅ Floor Engine orchestrator operational
- ✅ Risk management enforced
- ✅ Automated rebalancing functional
- ✅ Multi-chain support enabled
- ✅ Performance tracking implemented
- ✅ Emergency procedures tested
- ✅ Target APY achieved (4-8%)
- ✅ Max drawdown < 5%
- ✅ All code pushed to GitHub

---

**Next Step:** Implement Floor Engine Orchestrator and Adapter Registry (Week 1)
