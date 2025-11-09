# Floor Engine - Week 5 Integration Plan

**Date**: November 9, 2025  
**Phase**: Phase II - Week 5  
**Status**: Planning

---

## Executive Summary

Week 5 focuses on completing the FloorEngine orchestrator by implementing all TODO placeholders with production-ready code, creating comprehensive integration tests, and ensuring all adapters work together cohesively.

---

## Current State Analysis

### FloorEngine Orchestrator (469 lines)

**Implemented Features:**
- ✅ Initialization and configuration
- ✅ Wallet and provider setup
- ✅ Adapter registry integration
- ✅ Risk manager integration
- ✅ Event system
- ✅ Capital allocation framework
- ✅ Rebalancing framework
- ✅ Yield harvesting framework
- ✅ Performance metrics tracking

**Missing Implementation (TODOs):**
1. **Line 207**: Execute deposit to adapter
2. **Line 219**: Execute withdrawal from adapter
3. **Line 273**: Implement yield harvesting for each adapter type
4. **Line 418**: Execute allocation to adapter
5. **Line 449**: Query each adapter for current position value and APY

### Adapter Status

**Lending Adapters** (Week 2):
- ✅ AaveV3Adapter - 400+ lines
- ✅ CompoundV3Adapter - 400+ lines
- ✅ MorphoBlueAdapter - 450+ lines
- ✅ SparkAdapter - 400+ lines
- **Total**: 4 adapters, 1,650+ lines

**Staking Adapters** (Week 3):
- ✅ LidoAdapter - 400+ lines
- ✅ RocketPoolAdapter - 400+ lines
- ✅ NativeETHAdapter - 450+ lines
- **Total**: 3 adapters, 1,250+ lines

**Yield Farming Adapters** (Week 4):
- ✅ ConvexAdapter - 450+ lines
- ✅ CurveAdapter - 500+ lines
- ✅ BalancerAdapter - 500+ lines
- **Total**: 3 adapters, 1,450+ lines

**Grand Total**: 10 adapters, 4,350+ lines of adapter code

---

## Week 5 Objectives

### 1. Complete FloorEngine Orchestrator Implementation

**Replace TODO #1: Execute Deposit (Line 207)**

Current code:
```typescript
// TODO: Execute deposit
console.log(`[FloorEngine] Would deposit ${ethers.formatEther(difference)} to ${target.adapterId}`);
```

Required implementation:
- Get adapter instance from registry
- Determine adapter type (lending, staking, yield)
- Call appropriate deposit method based on type
- Handle token approvals if needed
- Track transaction hash
- Update gas used
- Handle errors with fallback logic

**Replace TODO #2: Execute Withdrawal (Line 219)**

Current code:
```typescript
// TODO: Execute withdrawal
console.log(`[FloorEngine] Would withdraw ${ethers.formatEther(-difference)} from ${target.adapterId}`);
```

Required implementation:
- Get adapter instance from registry
- Determine adapter type
- Call appropriate withdrawal method
- Track transaction hash
- Update gas used
- Handle errors with fallback logic

**Replace TODO #3: Implement Yield Harvesting (Line 273)**

Current code:
```typescript
// TODO: Implement yield harvesting for each adapter type
// For now, this is a placeholder
```

Required implementation:
- Iterate through all positions
- For each position, get adapter instance
- Call appropriate reward claiming method:
  - Lending: Claim AAVE/COMP/CRV rewards
  - Staking: Claim staking rewards (if any)
  - Yield: Claim CRV/CVX/BAL rewards
- Track total yield harvested
- Convert rewards to stablecoins or reinvest
- Handle gas optimization (batch claims)

**Replace TODO #4: Execute Allocation (Line 418)**

Current code:
```typescript
// TODO: Execute allocation to adapter
console.log(`[FloorEngine] Allocating ${ethers.formatEther(amountPerAdapter)} to ${adapterId}`);
```

Required implementation:
- Get adapter instance from registry
- Determine adapter type and specific protocol
- For lending adapters:
  - Convert ETH to stablecoin if needed
  - Call supply() method
- For staking adapters:
  - Call stake() method with ETH
- For yield adapters:
  - Convert ETH to required tokens
  - Add liquidity to pool
  - Stake LP tokens in gauge
- Track transaction hashes
- Update position with real data

**Replace TODO #5: Query Adapter Positions (Line 449)**

Current code:
```typescript
// TODO: Query each adapter for current position value and APY
// For now, this is a placeholder
```

Required implementation:
- Iterate through all positions
- For each position:
  - Get adapter instance
  - Call getPosition() method
  - Extract totalValue, apy, and metadata
  - Update position object
- Handle errors gracefully (skip failed queries)
- Log position updates

### 2. Create Adapter Manager

**Purpose**: Centralize adapter interaction logic

**Features**:
- Factory pattern for creating adapter instances
- Type-safe adapter method calling
- Common error handling
- Transaction tracking
- Gas optimization

**Interface**:
```typescript
class AdapterManager {
  // Create adapter instance from registry
  createAdapter(adapterId: string): IAdapter;
  
  // Execute deposit to any adapter type
  deposit(adapterId: string, amount: bigint, token?: string): Promise<string>;
  
  // Execute withdrawal from any adapter type
  withdraw(adapterId: string, amount: bigint, token?: string): Promise<string>;
  
  // Claim rewards from any adapter type
  claimRewards(adapterId: string): Promise<string>;
  
  // Get position from any adapter type
  getPosition(adapterId: string): Promise<AdapterPosition>;
  
  // Health check any adapter
  healthCheck(adapterId: string): Promise<{ healthy: boolean; reason?: string }>;
}
```

### 3. Implement Integration Tests

**Test Suite 1: Lending Adapter Integration**
- Test Aave V3 integration with FloorEngine
- Test Compound V3 integration with FloorEngine
- Test Morpho Blue integration with FloorEngine
- Test Spark integration with FloorEngine
- Test multi-lending allocation
- Test lending rebalancing
- Test lending yield harvesting

**Test Suite 2: Staking Adapter Integration**
- Test Lido integration with FloorEngine
- Test Rocket Pool integration with FloorEngine
- Test Native ETH integration with FloorEngine
- Test multi-staking allocation
- Test staking rebalancing
- Test staking yield harvesting

**Test Suite 3: Yield Farming Adapter Integration**
- Test Convex integration with FloorEngine
- Test Curve integration with FloorEngine
- Test Balancer integration with FloorEngine
- Test multi-yield allocation
- Test yield rebalancing
- Test yield reward harvesting

**Test Suite 4: Cross-Adapter Integration**
- Test capital allocation across all categories (50/30/20)
- Test global rebalancing across categories
- Test global yield harvesting
- Test emergency withdrawal from all adapters
- Test position aggregation and reporting
- Test APY calculation across all adapters

**Test Suite 5: Error Handling and Edge Cases**
- Test adapter failure scenarios
- Test insufficient balance scenarios
- Test slippage protection
- Test gas price spikes
- Test network failures
- Test concurrent operations

### 4. Create Deployment Scripts

**Script 1: Adapter Registration**
- Register all lending adapters
- Register all staking adapters
- Register all yield adapters
- Set adapter parameters (limits, fees, etc.)
- Enable/disable adapters based on environment

**Script 2: Initial Capital Allocation**
- Calculate allocation amounts based on strategy
- Execute deposits to all adapters
- Verify positions
- Report allocation results

**Script 3: Monitoring and Maintenance**
- Health check all adapters
- Query all positions
- Calculate performance metrics
- Generate reports
- Alert on issues

---

## Implementation Plan

### Phase 1: Adapter Manager (Day 1-2)

**Step 1**: Create AdapterManager class
- Implement adapter factory
- Implement type-safe method routing
- Add error handling
- Add transaction tracking

**Step 2**: Integrate with FloorEngine
- Replace direct adapter calls with AdapterManager
- Update all TODO sections to use AdapterManager
- Test basic functionality

### Phase 2: Complete FloorEngine Implementation (Day 2-3)

**Step 1**: Implement deposit/withdrawal logic
- Complete allocateToCategory() method
- Complete rebalance() deposit/withdrawal
- Add token conversion logic
- Add approval handling

**Step 2**: Implement yield harvesting
- Implement harvestYields() method
- Add reward claiming for each adapter type
- Add reward conversion logic
- Add gas optimization

**Step 3**: Implement position querying
- Complete updatePositions() method
- Query all adapters for current state
- Update position objects
- Calculate aggregate metrics

### Phase 3: Integration Testing (Day 3-4)

**Step 1**: Set up test environment
- Configure forked mainnet
- Fund test wallet
- Deploy test contracts if needed

**Step 2**: Implement test suites
- Write lending integration tests
- Write staking integration tests
- Write yield farming integration tests
- Write cross-adapter tests
- Write error handling tests

**Step 3**: Run and validate tests
- Execute all test suites
- Fix any failures
- Optimize gas usage
- Document test results

### Phase 4: Documentation and Deployment (Day 4-5)

**Step 1**: Create comprehensive documentation
- Document AdapterManager
- Document FloorEngine updates
- Document integration patterns
- Create usage examples

**Step 2**: Create deployment scripts
- Write adapter registration script
- Write initial allocation script
- Write monitoring script

**Step 3**: Create Week 5 summary
- Summarize all deliverables
- Document test results
- Provide usage examples
- Outline next steps

---

## Success Criteria

### Code Quality
- ✅ All TODOs replaced with production code
- ✅ No console.log in production paths (only logging framework)
- ✅ Comprehensive error handling
- ✅ Type-safe adapter interactions
- ✅ Gas-optimized operations

### Testing
- ✅ 100% test coverage for FloorEngine core methods
- ✅ All adapter integrations tested
- ✅ Cross-adapter scenarios tested
- ✅ Error cases handled
- ✅ Edge cases validated

### Integration
- ✅ All 10 adapters integrate with FloorEngine
- ✅ Capital allocation works end-to-end
- ✅ Rebalancing works across all adapters
- ✅ Yield harvesting works for all adapter types
- ✅ Position tracking works accurately

### Documentation
- ✅ AdapterManager fully documented
- ✅ FloorEngine updates documented
- ✅ Integration patterns documented
- ✅ Deployment scripts documented
- ✅ Week 5 summary complete

---

## Risk Mitigation

### Technical Risks

**Risk**: Adapter method signatures don't match expectations
- **Mitigation**: Create adapter interface wrappers
- **Mitigation**: Add runtime type checking
- **Mitigation**: Comprehensive integration tests

**Risk**: Gas costs too high for operations
- **Mitigation**: Batch operations where possible
- **Mitigation**: Implement gas price monitoring
- **Mitigation**: Add gas cost thresholds

**Risk**: Token conversion failures
- **Mitigation**: Use DEX aggregators (1inch, 0x)
- **Mitigation**: Add slippage protection
- **Mitigation**: Implement fallback conversion paths

### Operational Risks

**Risk**: Adapter failures during operations
- **Mitigation**: Implement circuit breakers
- **Mitigation**: Add fallback adapters
- **Mitigation**: Emergency pause functionality

**Risk**: Insufficient liquidity for large operations
- **Mitigation**: Split large operations into batches
- **Mitigation**: Monitor pool liquidity before operations
- **Mitigation**: Implement dynamic position limits

**Risk**: Network congestion
- **Mitigation**: Implement retry logic with backoff
- **Mitigation**: Add transaction deadline protection
- **Mitigation**: Monitor mempool before operations

---

## Deliverables

### Code
1. **AdapterManager.ts** (300+ lines) - Centralized adapter interaction
2. **FloorEngine.ts** (updated) - All TODOs replaced with production code
3. **Integration tests** (1,000+ lines) - Comprehensive test coverage
4. **Deployment scripts** (300+ lines) - Automated deployment and monitoring

### Documentation
1. **ADAPTER_MANAGER.md** - AdapterManager documentation
2. **INTEGRATION_GUIDE.md** - Integration patterns and examples
3. **DEPLOYMENT_GUIDE.md** - Deployment and operations guide
4. **WEEK_5_SUMMARY.md** - Complete week summary

### Tests
1. **lending.integration.test.ts** - Lending adapter integration tests
2. **staking.integration.test.ts** - Staking adapter integration tests
3. **yield.integration.test.ts** - Yield farming adapter integration tests
4. **cross-adapter.test.ts** - Cross-adapter integration tests
5. **error-handling.test.ts** - Error handling and edge case tests

---

## Timeline

**Day 1**: AdapterManager implementation
**Day 2**: FloorEngine completion (deposit/withdrawal)
**Day 3**: FloorEngine completion (harvesting/positions) + Test setup
**Day 4**: Integration testing
**Day 5**: Documentation and deployment scripts

**Total**: 5 days of focused, high-quality implementation

---

## Next Steps

After Week 5 completion:
- **Week 6**: Multi-chain deployment and performance optimization
- **Week 7**: Comprehensive system verification and final optimizations

---

**Status**: Ready to begin implementation  
**Quality Standard**: "Quality #1. No shortcuts. No AI slop. No time limits."
