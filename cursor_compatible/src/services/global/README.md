# Global Multi-Agent Trend Prediction + Consensus Models

This module implements a collective intelligence layer where all agents share trend signals, vote on global consensus, and adjust their local strategies accordingly.

## Key Components

### TrendSignalAggregator

- Collects predictions from all active agents across different assets and timeframes
- Stores signals with a 5-minute expiration window to ensure freshness
- Provides methods to retrieve recent signals for consensus calculations

### TrendConsensusEngine

- Calculates consensus across all asset/timeframe combinations
- Uses confidence-weighted voting to determine dominant market trends
- Provides both simple direction consensus and detailed results with confidence metrics

### TrustWeightedConsensusEngine

- Enhanced version of the consensus engine that weights signals by agent trust scores
- Higher-trust agents have more influence on the consensus direction
- Improves signal quality by filtering noise from low-trust agents
- Reinforces good behavior by incentivizing agents to build track records

### StrategyConsensusAdapter

- Adjusts strategy thresholds based on global consensus data
- In uptrends: lowers thresholds to make it easier to enter positions
- In downtrends: raises thresholds to make it more difficult to enter positions
- Respects confidence levels in consensus data for adjustment strength

### TrustScoreService

- Centralized service for retrieving agent trust scores
- Provides normalized trust weights for the voting system
- Maintains a history of trust score changes for auditing
- Interfaces with the trust decay system

### TrustDecayManager

- Manages the decay and slashing of agent trust scores over time
- Applies progressive decay rates based on current trust level
- Provides mechanisms for slashing trust scores for violations
- Records all slashing events for transparency and analysis

## Command Line Tools

### consensus-snapshot.ts

A CLI tool that displays current global consensus information:
- Shows trend direction for each asset/timeframe combination
- Displays confidence levels and signal counts
- Updates in real-time as agents submit new signals

### consensus-snapshot-weighted.ts

Enhanced version of the consensus snapshot that uses trust-weighted voting:
- Weights each agent's signal by their trust score
- Gives more influence to highly trusted agents
- Shows a more reliable picture of market consensus

### trust-manager.ts

Command-line tool for managing agent trust scores:
- List all agents with their trust scores and weights
- Set or adjust trust scores for individual agents
- Slash trust scores for violations of different severity
- View slashing history
- Trigger trust decay process

## Usage

### Submitting Signals

Agents can submit trend signals to the global consensus system:

```typescript
const trendAggregator = new TrendSignalAggregator(redisService);

await trendAggregator.submit('agent-123', {
  agentId: 'agent-123',
  asset: 'BTC',
  timeframe: '5m',
  direction: 'up',
  confidence: 0.85,
  timestamp: Date.now()
});
```

### Trust-Weighted Consensus

Use the enhanced consensus engine that weights signals by agent trust:

```typescript
const redis = new RedisService();
const trustService = new TrustScoreService(redis);
const weightedEngine = new TrustWeightedConsensusEngine(trustService, aggregator);

// Get trust-weighted consensus
const consensus = await weightedEngine.calculateConsensus();
```

### Managing Trust Scores

Adjust agent trust scores and apply slashing for violations:

```typescript
const trustService = new TrustScoreService(redis);
const decayManager = new TrustDecayManager(trustService, redis);

// Set initial trust score
await trustService.updateScore('agent-123', 75);

// Slash trust for violation
await decayManager.slashTrust(
  'agent-123', 
  ViolationSeverity.MODERATE, 
  'Excessive API usage'
);

// Start trust decay process
decayManager.start();
```

### Applying Consensus to Strategies

Strategy managers can adjust their strategy parameters based on global consensus:

```typescript
const consensusAdapter = new StrategyConsensusAdapter(consensusEngine, redisService);

// Apply adjustments to all strategies for this agent
await consensusAdapter.applyConsensusAdjustments('agent-456', strategies);

// Get an adjusted threshold for a specific strategy
const threshold = await consensusAdapter.getAdjustedThreshold(
  'agent-456', 
  'btc_momentum', 
  0.65 // default threshold
);
```

### Viewing Consensus Data

Run the CLI tools to view current consensus data:

```bash
# Standard consensus snapshot
npm run consensus:snapshot

# Trust-weighted consensus snapshot
npm run consensus:snapshot:weighted

# Manage agent trust scores
npm run trust-manager list
npm run trust-manager get agent-123
npm run trust-manager slash agent-123 minor "Failed to report execution"
```

## Architecture

This implementation creates a decentralized, swarm-aware prediction system where:

1. Individual agents submit their trend predictions with confidence scores
2. The consensus engine aggregates these signals and weights them by agent trust scores
3. Agents adjust their strategies based on the global consensus
4. The trust decay system gradually reduces trust for underperforming agents
5. The slashing mechanism applies immediate penalties for violations
6. The entire system becomes adaptive to changing market conditions

This approach helps reduce individual agent biases and improves overall decision quality through collective intelligence, with extra weight given to the most reliable agents. 