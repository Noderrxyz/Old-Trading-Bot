# Shadow Cabinet System

## Introduction

The Shadow Cabinet system enables autonomous counter-opinion, parallel governance paths, and internal dissent within Noderr's multi-agent clusters without breaking consensus. This system is designed to improve governance quality by simulating alternative decision paths and providing a mechanism to evaluate which decisions would have been more optimal.

## Core Components

### Shadow Cabinets

Alternative governance units that simulate opposing proposals. These cabinets consist of agents who offer a different perspective or approach to governance issues.

### Parallel Proposal Tracks

Competing ideas that can be tested concurrently. When a proposal is created in the main governance system, it can be forked and modified by a shadow cabinet to create an alternative version.

### Counterfactual Testing Framework

Allows the system to see what would have happened if another path had been taken. After decisions are implemented, the system can compare the actual outcomes with the simulated outcomes from shadow proposals.

## Key Files

- `ShadowCabinetEngine.ts`: Core system for creating and managing shadow cabinets
- `ProposalForker.ts`: Logic to clone and tweak live proposals
- `GovernanceOracle.ts`: Hindsight-based outcome analyzer
- `cabinets.json`: Stores shadow cabinet configurations
- `forks.json`: Stores forked proposal tracks
- `outcomes.json`: Stores counterfactual simulation outcomes
- `shadow_log.json`: Records alternate decisions tested

## Usage

### Creating a Shadow Cabinet

```typescript
import { getShadowCabinetEngine } from '../governance/shadow';

// Create a shadow cabinet for an existing council
const shadowEngine = getShadowCabinetEngine();
const cabinet = await shadowEngine.createShadowCabinet(
  'main-council-id',
  ['agent-1', 'agent-2', 'agent-3'],
  'Alternative economic perspective'
);
```

### Forking a Proposal

```typescript
// Fork an existing proposal with modified parameters
const fork = await shadowEngine.forkProposalTrack(
  'original-proposal-id',
  cabinet.id,
  {
    title: 'Alternative approach to resource allocation',
    data: {
      allocationStrategy: 'progressive',
      threshold: 0.75
    }
  }
);
```

### Simulating Outcomes

```typescript
// Simulate what would happen if this fork was implemented
const outcome = await shadowEngine.simulateOutcome(fork.id);
```

### Evaluating Proposals

```typescript
// After the original proposal is implemented, compare outcomes
const oracle = getGovernanceOracle();
const result = await oracle.evaluateFork(
  'original-proposal-id',
  fork.id
);

// result will be 'original', 'shadow', or 'undecided'
console.log(`The ${result} proposal would have been better`);
```

## Safeguards

- Shadow cabinets cannot affect live governance unless promoted via supermajority
- Proposals from shadow agents go through a sandboxed simulation layer
- Shadow forks are not visible to voters by default unless marked "Public Shadow"

## Benefits

- Simulate governance outcomes without consequences
- Promote constructive dissent within the system
- Improve governance quality through hindsight analysis
- Test risky proposals in parallel
- Create evolutionary pressure for better decision-making

## Integration

The Shadow Cabinet system integrates with the main governance system through events. When proposals are created or completed in the main system, the shadow system is notified and can take appropriate actions. 