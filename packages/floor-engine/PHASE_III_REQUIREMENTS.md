# Phase III Requirements - Production Infrastructure

**Document Purpose**: Capture production-ready features identified during Phase II that should be implemented in Phase III (Active Trading Engine Integration).

**Phase II Status**: Floor Engine adapters and orchestration ✅ COMPLETE  
**Phase III Timeline**: 6 weeks (after Phase II completion)

---

## Overview

During Phase II (Floor Engine implementation), we identified several **production infrastructure** features that are required for mainnet deployment but are beyond the scope of the Floor Engine adapter implementation. These features should be implemented during **Phase III: Active Trading Engine Integration** when the full system is being prepared for production deployment.

---

## 1. Transaction Management

### 1.1 Transaction Queue

**Purpose**: Prevent nonce conflicts and ensure ordered transaction execution.

**Requirements**:
- Serialize operations to prevent concurrent transaction conflicts
- Implement nonce management
- Handle transaction failures and retries
- Support priority-based transaction ordering

**Priority**: **CRITICAL** for production  
**Estimated Effort**: 2-3 days  
**Dependencies**: None

**Implementation Notes**:
```typescript
class TransactionQueue {
  private queue: Transaction[] = [];
  private processing: boolean = false;
  
  async enqueue(tx: Transaction): Promise<void>;
  async process(): Promise<void>;
  async retry(tx: Transaction): Promise<void>;
}
```

### 1.2 Transaction Batching

**Purpose**: Reduce gas costs by batching multiple operations into single transactions.

**Requirements**:
- Batch multiple deposits/withdrawals
- Support cross-adapter batching
- Implement atomic execution (all-or-nothing)
- Handle partial failures gracefully

**Priority**: **HIGH** for gas optimization  
**Estimated Effort**: 3-4 days  
**Dependencies**: Transaction Queue

**Implementation Notes**:
- Use Multicall3 for batching read operations
- Implement custom batching contract for write operations
- Consider Flashbots for large batched transactions

---

## 2. Risk Management Enhancements

### 2.1 Smart Contract Risk Scoring

**Purpose**: Quantify and monitor smart contract risk for each protocol.

**Requirements**:
- Audit score tracking (based on audit reports)
- TVL stability scoring
- Protocol age and maturity scoring
- Incident history tracking
- Overall risk score calculation

**Priority**: **HIGH** for risk management  
**Estimated Effort**: 2-3 days  
**Dependencies**: None

**Implementation Notes**:
```typescript
interface SmartContractRisk {
  auditScore: number; // 0-100 based on audit quality
  tvlScore: number; // Based on TVL stability
  ageScore: number; // Protocol age in months
  incidentHistory: number; // Past incidents (0 = none)
  overallScore: number; // Weighted average
}
```

### 2.2 Liquidity Risk Monitoring

**Purpose**: Ensure sufficient liquidity for withdrawals and prevent liquidity crises.

**Requirements**:
- Track available liquidity per protocol
- Calculate liquidity ratio (our position / available liquidity)
- Set maximum safe withdrawal limits
- Alert on low liquidity conditions

**Priority**: **CRITICAL** for capital safety  
**Estimated Effort**: 2-3 days  
**Dependencies**: None

**Implementation Notes**:
```typescript
interface LiquidityRisk {
  availableLiquidity: bigint;
  ourPosition: bigint;
  liquidityRatio: number; // ourPosition / availableLiquidity
  maxSafeWithdrawal: bigint;
  alert: boolean; // true if ratio > threshold
}
```

### 2.3 Correlation Risk Tracking

**Purpose**: Identify and manage correlated protocol dependencies.

**Requirements**:
- Track underlying protocol dependencies (e.g., Convex → Curve)
- Calculate correlation scores between protocols
- Measure portfolio diversification
- Alert on over-concentration

**Priority**: **MEDIUM** for diversification  
**Estimated Effort**: 2-3 days  
**Dependencies**: None

**Implementation Notes**:
```typescript
interface CorrelationRisk {
  underlyingProtocols: string[]; // e.g., ['Curve', 'Aave']
  correlationScore: number; // 0-1 (1 = fully correlated)
  diversificationScore: number; // 0-100
}
```

### 2.4 Slippage Protection

**Purpose**: Prevent value loss from slippage on large withdrawals.

**Requirements**:
- Calculate expected slippage for operations
- Set maximum acceptable slippage thresholds
- Reject operations exceeding slippage limits
- Implement slippage-aware rebalancing

**Priority**: **CRITICAL** for value preservation  
**Estimated Effort**: 2-3 days  
**Dependencies**: None

**Implementation Notes**:
```typescript
interface SlippageProtection {
  maxSlippageBps: number; // e.g., 50 = 0.5%
  calculateSlippage(amount: bigint): Promise<number>;
  validateSlippage(amount: bigint): Promise<boolean>;
}
```

---

## 3. Security & Access Control

### 3.1 Role-Based Access Control (RBAC)

**Purpose**: Restrict access to sensitive operations.

**Requirements**:
- Define roles (ADMIN, OPERATOR, VIEWER)
- Implement role-based method access
- Support role assignment and revocation
- Audit role changes

**Priority**: **CRITICAL** for security  
**Estimated Effort**: 2-3 days  
**Dependencies**: None

**Implementation Notes**:
```typescript
enum Role {
  ADMIN = 'ADMIN',
  OPERATOR = 'OPERATOR',
  VIEWER = 'VIEWER'
}

class AccessControl {
  hasRole(address: string, role: Role): boolean;
  grantRole(address: string, role: Role): Promise<void>;
  revokeRole(address: string, role: Role): Promise<void>;
}
```

### 3.2 Rate Limiting

**Purpose**: Prevent spam attacks and DoS.

**Requirements**:
- Implement per-address rate limits
- Support different limits for different operations
- Implement exponential backoff for repeated failures
- Log and alert on rate limit violations

**Priority**: **MEDIUM** for security  
**Estimated Effort**: 1-2 days  
**Dependencies**: None

### 3.3 Signature Verification (EIP-712)

**Purpose**: Prevent replay attacks and ensure transaction authenticity.

**Requirements**:
- Implement EIP-712 typed data signing
- Verify signatures before executing operations
- Implement nonce tracking to prevent replay
- Support signature expiration

**Priority**: **HIGH** for security  
**Estimated Effort**: 2-3 days  
**Dependencies**: None

---

## 4. Monitoring & Alerting

### 4.1 Prometheus Metrics

**Purpose**: Collect and expose metrics for monitoring.

**Requirements**:
- Expose metrics endpoint
- Track key metrics (TVL, APY, positions, errors)
- Implement custom metrics for each adapter
- Support metric aggregation across chains

**Priority**: **CRITICAL** for production  
**Estimated Effort**: 3-4 days  
**Dependencies**: None

**Key Metrics**:
```
floor_engine_tvl_total{chain, protocol}
floor_engine_apy{chain, protocol}
floor_engine_positions{chain, protocol}
floor_engine_errors_total{chain, protocol, type}
floor_engine_rebalance_duration_seconds
floor_engine_harvest_yield_total
```

### 4.2 Grafana Dashboards

**Purpose**: Visualize metrics and system health.

**Requirements**:
- Create dashboards for TVL, APY, positions
- Implement health status dashboard
- Create error and alert dashboard
- Support multi-chain visualization

**Priority**: **HIGH** for operations  
**Estimated Effort**: 2-3 days  
**Dependencies**: Prometheus Metrics

### 4.3 Alert System

**Purpose**: Notify operators of critical issues.

**Requirements**:
- Implement alert rules (low liquidity, high slippage, errors)
- Support multiple alert channels (email, Slack, PagerDuty)
- Implement alert severity levels
- Support alert acknowledgment and resolution

**Priority**: **CRITICAL** for operations  
**Estimated Effort**: 2-3 days  
**Dependencies**: Prometheus Metrics

---

## 5. Infrastructure & Automation

### 5.1 Circuit Breakers

**Purpose**: Automatically pause operations on anomalies.

**Requirements**:
- Implement circuit breaker patterns
- Define trigger conditions (APY drop, TVL drop, errors)
- Support automatic pause and manual resume
- Log circuit breaker events

**Priority**: **CRITICAL** for risk management  
**Estimated Effort**: 2-3 days  
**Dependencies**: Monitoring

**Implementation Notes**:
```typescript
class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  
  async execute(operation: () => Promise<void>): Promise<void>;
  async trip(reason: string): Promise<void>;
  async reset(): Promise<void>;
}
```

### 5.2 State Machine

**Purpose**: Explicitly manage FloorEngine state transitions.

**Requirements**:
- Define states (IDLE, ALLOCATING, REBALANCING, HARVESTING, PAUSED)
- Implement valid state transitions
- Prevent invalid state transitions
- Log all state changes

**Priority**: **HIGH** for reliability  
**Estimated Effort**: 2-3 days  
**Dependencies**: None

**Implementation Notes**:
```typescript
enum FloorEngineState {
  IDLE = 'IDLE',
  ALLOCATING = 'ALLOCATING',
  REBALANCING = 'REBALANCING',
  HARVESTING = 'HARVESTING',
  PAUSED = 'PAUSED'
}
```

### 5.3 Position Reconciliation

**Purpose**: Ensure cached state matches on-chain state.

**Requirements**:
- Implement periodic position reconciliation
- Compare cached positions with on-chain positions
- Alert on discrepancies
- Support manual reconciliation trigger

**Priority**: **HIGH** for accuracy  
**Estimated Effort**: 2-3 days  
**Dependencies**: None

### 5.4 Deployment Automation

**Purpose**: Automate deployment and reduce errors.

**Requirements**:
- Create deployment scripts for all chains
- Implement CI/CD pipeline (GitHub Actions)
- Support staged deployments (testnet → mainnet)
- Implement rollback mechanisms

**Priority**: **CRITICAL** for deployment  
**Estimated Effort**: 3-4 days  
**Dependencies**: None

---

## 6. Advanced Features (Optional)

### 6.1 Flashbots Integration

**Purpose**: Prevent MEV on large transactions.

**Requirements**:
- Integrate Flashbots RPC
- Implement Flashbots bundle submission
- Set threshold for Flashbots usage (e.g., >10 ETH)
- Monitor Flashbots success rate

**Priority**: **MEDIUM** for MEV protection  
**Estimated Effort**: 2-3 days  
**Dependencies**: None

### 6.2 Gas Price Prediction

**Purpose**: Optimize gas costs through better price prediction.

**Requirements**:
- Implement gas price prediction model
- Use historical gas price data
- Support EIP-1559 (base fee + priority fee)
- Implement dynamic gas strategies per chain

**Priority**: **LOW** for optimization  
**Estimated Effort**: 3-4 days  
**Dependencies**: None

### 6.3 Admin Dashboard UI

**Purpose**: Provide user-friendly interface for monitoring and control.

**Requirements**:
- Build web-based admin dashboard
- Display real-time metrics and positions
- Support manual operations (pause, rebalance, harvest)
- Implement role-based UI access

**Priority**: **LOW** for Phase III, **MEDIUM** for Phase IV  
**Estimated Effort**: 1-2 weeks  
**Dependencies**: Monitoring, Access Control

---

## 7. Pre-Mainnet Requirements

### 7.1 Professional Security Audit

**Purpose**: Identify and fix vulnerabilities before mainnet.

**Requirements**:
- Engage professional audit firm (e.g., Trail of Bits, OpenZeppelin)
- Audit all smart contracts and critical code paths
- Fix all critical and high-severity findings
- Implement recommended improvements

**Priority**: **CRITICAL** for mainnet  
**Estimated Cost**: $20k-50k  
**Estimated Time**: 2-4 weeks

### 7.2 Testnet Deployment

**Purpose**: Test full system in realistic environment.

**Requirements**:
- Deploy to Sepolia testnet
- Run for minimum 2 weeks
- Test all operations with real (testnet) assets
- Conduct stress testing

**Priority**: **CRITICAL** for mainnet  
**Estimated Effort**: 2 weeks  
**Dependencies**: All Phase III features

### 7.3 Incident Response Planning

**Purpose**: Prepare for production incidents.

**Requirements**:
- Create runbooks for common issues
- Define escalation procedures
- Establish on-call rotation
- Conduct incident response drills

**Priority**: **HIGH** for operations  
**Estimated Effort**: 1 week  
**Dependencies**: None

---

## 8. Implementation Priority

### Critical (Must Have for Mainnet)
1. Transaction Queue
2. Liquidity Risk Monitoring
3. Slippage Protection
4. Access Control (RBAC)
5. Monitoring & Alerting (Prometheus)
6. Circuit Breakers
7. Deployment Automation
8. Professional Security Audit
9. Testnet Deployment

### High (Should Have for Mainnet)
10. Smart Contract Risk Scoring
11. State Machine
12. Position Reconciliation
13. Grafana Dashboards
14. Alert System
15. Signature Verification
16. Incident Response Planning

### Medium (Nice to Have)
17. Transaction Batching
18. Correlation Risk Tracking
19. Rate Limiting
20. Flashbots Integration

### Low (Future Enhancement)
21. Gas Price Prediction
22. Admin Dashboard UI

---

## 9. Estimated Timeline

**Phase III Duration**: 6 weeks

**Week 1-2: Transaction & Risk Management**
- Transaction Queue (3 days)
- Liquidity Risk Monitoring (3 days)
- Slippage Protection (2 days)
- Smart Contract Risk Scoring (2 days)

**Week 3-4: Security & Monitoring**
- Access Control (3 days)
- Prometheus Metrics (4 days)
- Circuit Breakers (2 days)
- Alert System (3 days)

**Week 5: Infrastructure**
- State Machine (3 days)
- Position Reconciliation (2 days)
- Deployment Automation (4 days)

**Week 6: Testing & Documentation**
- Integration testing (3 days)
- Documentation updates (2 days)
- Testnet deployment (4 days)

**Post-Phase III: Security Audit** (2-4 weeks)

---

## 10. Success Criteria

Phase III will be considered complete when:

1. ✅ All Critical features implemented and tested
2. ✅ All High priority features implemented and tested
3. ✅ Zero critical or high-severity bugs
4. ✅ Comprehensive integration tests passing
5. ✅ Testnet deployment successful for 2+ weeks
6. ✅ Professional security audit completed
7. ✅ All audit findings addressed
8. ✅ Incident response plan documented
9. ✅ Deployment automation tested
10. ✅ Team trained on operations

---

## Conclusion

This document captures the production infrastructure requirements identified during Phase II (Floor Engine implementation). These features are essential for mainnet deployment but are beyond the scope of the Floor Engine adapter implementation.

**Phase II Focus**: Build high-quality adapters and orchestration logic  
**Phase III Focus**: Add production infrastructure and prepare for mainnet

By deferring these features to Phase III, we maintain focus on delivering a complete, well-tested Floor Engine in Phase II, while ensuring all production requirements are captured and planned for.

---

**Document Status**: ✅ Complete  
**Last Updated**: Current session  
**Next Review**: Start of Phase III
