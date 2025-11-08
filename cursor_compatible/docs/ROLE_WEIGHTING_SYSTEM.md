# Role Weighting System for Multi-Agent Consensus

This document describes the Role Weighting System which assigns dynamic weights to agent roles (leader, watcher, auditor, member) so that consensus votes, arbitration decisions, and strategy approvals reflect trust-adjusted authority.

## Role Weight Mapping

Each role in the system has a defined base weight:

| Role    | Base Weight | Notes                                    |
|---------|------------|------------------------------------------|
| Leader  | 1.0        | Always has final veto, tie-break priority |
| Watcher | 0.75       | Can propose, validate, but not override   |
| Auditor | 0.5        | Used primarily for quorum/consensus checks|
| Member  | 0.25       | Minimal weight, typically non-voting      |

## Weighted Trust Score Calculation

The final weight of an agent's vote is calculated as:
```
final_weight = base_role_weight × normalized_trust_score
```

Trust score is normalized between 0–1 (e.g., trust 87 → 0.87)

## Weighted Voting Example

Let's say agents vote to approve a new strategy:

| Agent | Role    | Trust | Normalized | Weight | Final Score |
|-------|---------|-------|------------|--------|-------------|
| A     | leader  | 90    | 0.90       | 1.0    | 0.90        |
| B     | watcher | 80    | 0.80       | 0.75   | 0.60        |
| C     | auditor | 85    | 0.85       | 0.5    | 0.425       |
| D     | member  | 75    | 0.75       | 0.25   | 0.1875      |

Consensus score: 0.90 + 0.60 + 0.425 + 0.1875 = 2.1125

Threshold: Require ≥ 2.0 to pass.

**Result**: Proposal approved.

## Redis Schema

The system uses the following Redis keys:

```
agent:{id}:role         // 'leader' | 'watcher' | 'auditor' | 'member'
agent:{id}:trust_score  // 0–100
agent:{id}:vote:{uuid}  // { vote: 'yes' | 'no', timestamp, score }
governance:votes:{uuid} // { totalScore, votes: [...], passed: true|false }
```

## Governance Proposal Types

The system supports the following proposal types:

1. **Strategy Approval**: Approval of new trading strategies
2. **Parameter Change**: Modification of system parameters
3. **Agent Role Change**: Changes to agent roles
4. **System Upgrade**: System-wide upgrades
5. **Emergency Action**: Emergency actions like pausing trading

## Creating a Proposal

Proposals can be created using the CLI tool:

```bash
# Create a strategy approval proposal
cli/vote_propose.ts --agent-id agent123 --type strategy_approval --title "Deploy New Mean Reversion Strategy" --description "Approve strategy MR-002 for production" < strategy_data.json

# Create a parameter change proposal
cli/vote_propose.ts --agent-id agent123 --type parameter_change --title "Adjust Risk Parameters" --description "Reduce max drawdown threshold" < parameter_data.json
```

Proposal data is provided as JSON via stdin.

## Casting Votes

Votes can be cast using the CLI tool:

```bash
# Vote yes on a proposal
cli/vote_cast.ts --agent-id agent123 --proposal-id abc-123-xyz --vote yes

# Vote no on a proposal
cli/vote_cast.ts --agent-id agent456 --proposal-id abc-123-xyz --vote no

# Abstain from voting
cli/vote_cast.ts --agent-id agent789 --proposal-id abc-123-xyz --vote abstain
```

## Checking Vote Tally

View the current status of a vote:

```bash
# View vote tally
cli/vote_tally.ts --proposal-id abc-123-xyz

# Get JSON output for integration with other systems
cli/vote_tally.ts --proposal-id abc-123-xyz --json
```

## Quorum and Approval Requirements

By default:

- **Quorum**: Requires a weighted score of 2.5 or higher
- **Approval**: Requires a weighted YES score of 2.0 or higher
- **Rejection**: Happens when the weighted NO score reaches 2.0 or higher

These thresholds can be customized per proposal.

## Integration Points

The Role Weighting System integrates with:

1. **Trading Agent System**: For role-based permissions and access control
2. **Strategy Approval Flow**: To ensure strategies meet governance requirements
3. **Arbitration Engine**: For dispute resolution with weighted decision making
4. **System Configuration**: For weighted parameter change approval 