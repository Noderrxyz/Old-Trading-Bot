# Governance System

## Overview

The Noderr Governance System manages decision-making processes, policy enforcement, and agent coordination within the platform. It consists of several interconnected modules that handle proposals, voting, enforcement, and now alternative governance paths through the Shadow Cabinet system.

## Core Components

- **Proposal System**: Creates, manages, and executes governance proposals
- **Voting System**: Handles vote weighting, quorums, and decision aggregation
- **Enforcement**: Ensures decisions are properly executed and compliance is maintained
- **Shadow Cabinets**: Alternative governance units that simulate opposing proposals (NEW)
- **Treaty System**: Manages agreements and cooperation between agents

## Governance Process

1. **Proposal Creation**: An agent creates a governance proposal
2. **Shadow Forking**: Shadow cabinets may create alternative versions (NEW)
3. **Voting Period**: Agents vote on the proposal
4. **Decision**: Based on voting results, the proposal is approved or rejected
5. **Execution**: Approved proposals are executed
6. **Simulation Comparison**: Outcomes are compared with shadow simulations (NEW)

## Shadow Cabinet System (NEW)

The Shadow Cabinet system enables autonomous counter-opinion, parallel governance paths, and internal dissent without breaking consensus. It provides a framework for testing alternative decision paths and evaluating their potential outcomes.

### Key Features

- **Shadow Cabinets**: Alternative governance units that simulate opposing proposals
- **Parallel Proposal Tracks**: Competing ideas, tested concurrently
- **Counterfactual Testing**: See what would've happened if another path was taken

### Integration with Treaty System

The Shadow Cabinet system integrates with the Treaty system in several ways:

1. **Treaty Simulations**: Shadow cabinets can simulate how alternative treaty terms would affect agent relationships
2. **Clause Testing**: Alternative treaty clauses can be tested in the shadow system before being proposed in the main system
3. **Violation Analysis**: Shadow cabinets can analyze treaty violations to suggest improved enforcement mechanisms

## Getting Started

### Basic Usage

```typescript
// Initialize the governance system with shadow cabinet support
await initializeGovernance(redisClient, { enableShadowCabinet: true });

// Get the proposal service
const proposalService = getProposalService();

// Create a proposal
const proposal = await proposalService.createProposal(
  'agent-123',
  'Increase resource allocation',
  'Proposal description',
  ProposalType.PARAMETER_CHANGE,
  { /* proposal data */ }
);

// Vote on the proposal
await proposalService.vote('agent-456', proposal.id, 'yes');
```

### Using Shadow Cabinets

```typescript
// Get the shadow cabinet engine
const shadowEngine = getShadowCabinetEngine();

// Create a shadow cabinet
const cabinet = await shadowEngine.createShadowCabinet(
  'main-council',
  ['agent-456', 'agent-789'],
  'Resource optimization shadow cabinet'
);

// Fork a proposal with alternative parameters
const fork = await shadowEngine.forkProposalTrack(
  proposal.id,
  cabinet.id,
  { /* alternative parameters */ }
);

// Run simulation
const outcome = await shadowEngine.simulateOutcome(fork.id);
```

## Directory Structure

- **proposalService.ts**: Core proposal management
- **voteWeighting.ts**: Vote calculation and weighting
- **arbitrationEngine.ts**: Conflict resolution
- **shadow/**: Shadow Cabinet system (NEW)
  - **ShadowCabinetEngine.ts**: Core shadow cabinet management
  - **ProposalForker.ts**: Alternative proposal creation
  - **GovernanceOracle.ts**: Outcome evaluation

## Future Improvements

- Enhanced simulation accuracy
- Machine learning for outcome prediction
- Public shadow cabinet dashboard
- Integration with external governance frameworks

## Components

1. **Role Weighting System** (`voteWeighting.ts`): Assigns dynamic weights to agent roles (leader, watcher, auditor, member) for consensus voting
2. **Proposal Service** (`proposalService.ts`): Handles the creation, management, and voting on governance proposals
3. **Quorum Enforcement** (`quorumEnforcement.ts`): Enforces minimum participation thresholds for agent votes to be considered valid

## Quorum Enforcement

The quorum enforcement system ensures that governance decisions meet minimum participation requirements to be considered valid. This prevents small clusters or malicious nodes from passing critical decisions without proper representation.

### What Is a Quorum?

A quorum is the minimum number of eligible agents (or weight total) required to validate a vote. In Noderr, we define quorum in multiple ways:

1. **Headcount quorum**: At least N agents must vote
2. **Weight quorum**: Combined weight of votes must reach threshold (e.g., ≥ 2.0)
3. **Role diversity**: Specific roles must be represented in the vote (e.g., must include 1 leader + 1 auditor)

All of these can be enforced simultaneously.

### Quorum Configuration

Quorum configuration is stored in Redis under the key `governance:config:quorum` with the following structure:

```typescript
{
  min_agents: 3,              // Minimum number of agents required
  min_weight_score: 2.0,      // Minimum total weight required
  enforce_roles: true,        // Whether to enforce role diversity
  required_roles: ["leader", "auditor"]  // Roles that must be present
}
```

### CLI Commands

The governance system provides several CLI commands for working with quorum:

1. **Check Quorum Status**: `vote:quorum-check --proposal-id <id> [--json]`
   - Shows the current quorum status for a specific proposal
   - Includes details about headcount, weight, and role diversity checks

2. **Get Quorum Configuration**: `vote:config:get-quorum [--json]`
   - Displays the current quorum configuration
   - Use `--json` for machine-readable output

3. **Set Quorum Configuration**: `vote:config:set-quorum [options]`
   - Configure quorum thresholds and requirements
   - Options:
     - `--min-agents <number>`: Minimum number of agents required for quorum
     - `--min-weight-score <number>`: Minimum total weight score required
     - `--enforce-roles [boolean]`: Whether to enforce role diversity
     - `--required-roles <roles>`: Comma-separated list of required roles
     - `--dry-run`: Show what would be set without making changes

### Example Usage

```typescript
// Create quorum configuration
await setQuorumConfig(redisClient, {
  min_agents: 4,
  min_weight_score: 2.5,
  enforce_roles: true,
  required_roles: ['leader', 'auditor', 'watcher']
});

// Check if a proposal meets quorum requirements
const result = await checkQuorum(redisClient, proposalId);
if (result.quorum_passed) {
  console.log('Quorum reached!');
} else {
  console.log('Quorum not reached. Reasons:');
  if (!result.details.passes_headcount) {
    console.log('- Not enough agents voted');
  }
  if (!result.details.passes_weight) {
    console.log('- Not enough weighted vote power');
  }
  if (!result.details.passes_role_diversity) {
    console.log('- Missing required roles');
  }
}
```

### Quorum Check Result

The quorum check returns a detailed result object with the following structure:

```typescript
{
  proposal_id: "abc123",
  votes: 5,                   // Number of votes cast
  weight_total: 2.72,         // Total weighted score
  roles: ["leader", "watcher", "auditor"],  // Roles represented
  quorum_passed: true,        // Overall result
  details: {
    passes_headcount: true,   // Headcount check result
    passes_weight: true,      // Weight check result
    passes_role_diversity: true  // Role diversity check result
  }
}
```

## Benefits of Quorum Enforcement

With quorum enforcement:

1. Malicious agents can't collude with low-trust nodes to pass proposals
2. Passive agents don't weaken vote quality
3. Leadership roles (e.g., leader, auditor) are always involved in critical decisions
4. Decisions have proper representation and weight

This creates a more robust and secure governance system for critical operations. 