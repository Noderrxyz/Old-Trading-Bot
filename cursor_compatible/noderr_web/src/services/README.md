# Federation Treasury Management Services

This directory contains services related to the federation treasury management system, including:

## 1. TreasuryBalancer

The `TreasuryBalancer` is responsible for:
- Monitoring treasury balances across clusters
- Identifying imbalances between surplus and deficit clusters
- Calculating optimal fund transfers based on trust scores and governance participation
- Creating rebalancing proposals

### Formula

The rebalancing algorithm uses the following formula:
```
imbalanceScore = trustWeight * (localDeficit / globalMedianBalance)
priority = imbalanceScore * governanceQuorumParticipation
amountToSend = Math.min(maxTransferPerEpoch, imbalanceScore * treasurySurplus)
```

## 2. SlashingEngine

The `SlashingEngine` is responsible for:
- Monitoring trust violations across clusters
- Identifying patterns of violations that warrant slashing
- Calculating penalty amounts based on violation severity and repetition
- Creating slashing proposals

### Formula

The slashing algorithm uses the following formula:
```
if trustScore < MIN_TRUST && recentViolations.length > 2:
  penalty = baseSlashAmount * (1 + violationMultiplier)
  emitSlash(clusterId, penalty)
  adjustTrust(clusterId, -15)
```

## 3. WebSocketService

Provides real-time communication for treasury events:
- Treasury balance updates
- Rebalancing proposals
- Slashing events
- Trust violation notifications

## 4. RedisService

Provides access to Redis data through the API:
- Treasury balances
- Trust scores and violations
- Governance proposals

## Usage

```typescript
// Initialize services
const treasuryBalancer = TreasuryBalancer.getInstance();
const slashingEngine = SlashingEngine.getInstance();
const wsService = WebSocketService.getInstance();

// Start automated rebalancing
treasuryBalancer.start();

// Start automated slashing engine
slashingEngine.start();

// Connect to WebSocket for real-time updates
wsService.connect();

// Listen for events
wsService.addEventListener('REBALANCE_PROPOSAL', (event) => {
  console.log('New rebalance proposal:', event);
});

wsService.addEventListener('SLASH_ENFORCED', (event) => {
  console.log('New slash event:', event);
});
``` 