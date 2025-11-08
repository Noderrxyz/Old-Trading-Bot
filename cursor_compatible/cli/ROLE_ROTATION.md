# Smart Role Rotation Engine

This system automates the rotation of agent roles (leader, watcher, auditor) based on live trust intelligence and performance metrics. It ensures that only the most qualified agents retain positions of power and responsibility within the network.

## How It Works

The role rotation is triggered by several factors:

1. **Trust decay**: Agent trust drops below a role-specific threshold
2. **Inactivity**: No heartbeat or last activity beyond the role's maximum inactivity period
3. **Abuse/penalty flags**: Agent has an open abuse violation
4. **Election supersession**: Another agent has a higher score and qualifies for role reassignment

## Role Qualification Requirements

| Role    | Trust Floor | Max Inactivity | Allowed Violations |
|---------|------------|----------------|-------------------|
| Leader  | 80%        | 6 hours        | 0                 |
| Watcher | 75%        | 12 hours       | 0                 |
| Auditor | 70%        | 24 hours       | 1 (temporary)     |

## Usage

```bash
# Run with dry-run mode (no changes made)
npx ts-node cli/rotate-roles.ts --dry-run

# Run with broadcast to send role changes to network
npx ts-node cli/rotate-roles.ts --broadcast

# Run regularly to ensure governance stays current
npx ts-node cli/rotate-roles.ts
```

## Scoring Algorithm

Agents are scored based on a weighted combination of:

- **Trust Score**: 50% weight (historical reliability)
- **Uptime**: 30% weight (availability)
- **Activity Score**: 20% weight (engagement level)

The system maintains rotation history and logs, recording:

- When a role change occurs
- The reason for rotation
- The agent's previous and new roles

## Role Rotation Records

The system stores rotation records in Redis:

- `governance:rotated:{agentId}` - Records the most recent rotation with reason and timestamp
- `governance:role_history:{agentId}` - Maintains a history of all role changes for an agent
- `governance:current_roles` - The current governance structure

## Integration

The role rotation engine integrates with the existing agent system and can be:

1. Scheduled to run periodically (e.g., hourly)
2. Triggered by trust system alerts
3. Manually executed by administrators

## Future Enhancements

- WebSocket broadcasts for real-time role changes
- Weighted voting based on role rank
- Dispute arbitration system for contesting role changes 