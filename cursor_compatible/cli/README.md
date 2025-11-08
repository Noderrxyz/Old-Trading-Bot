# Noderr CLI Tools

Command-line utilities for the Noderr trading platform.

## Setup

Before using these CLI tools, make sure to install dependencies:

```bash
cd cli
npm install
```

## Available Commands

### Agent Governance

#### Assign Agent Role

Assign a governance role to an agent.

```bash
# Usage
npx ts-node commands/assign_agent_role.ts -a <agent-id> -r <role> [options]

# Options
# -a, --agent <id>      Agent ID (required)
# -r, --role <role>     Role to assign (required)
# --reason <text>       Reason for assignment
# --by <assignor>       Who is assigning the role

# Example
npx ts-node commands/assign_agent_role.ts -a agent123 -r watcher --reason "monitoring quorum"
```

Valid roles:
- `leader`: Responsible for strategy coordination
- `watcher`: Monitors system health and performance
- `auditor`: Reviews and validates actions
- `sentinel`: Guards against malicious behavior
- `candidate`: Eligible for promotion to other roles

#### List Agent Roles

List all agent role assignments.

```bash
# Usage
npx ts-node commands/list_agent_roles.ts [options]

# Options
# -r, --role <role>     Filter by specific role
# -j, --json            Output as JSON

# Examples
npx ts-node commands/list_agent_roles.ts
npx ts-node commands/list_agent_roles.ts -r leader
npx ts-node commands/list_agent_roles.ts -j
```

#### Remove Agent Role

Remove a governance role from an agent.

```bash
# Usage
npx ts-node commands/remove_agent_role.ts -a <agent-id> [options]

# Options
# -a, --agent <id>      Agent ID (required)
# --reason <text>       Reason for removal

# Example
npx ts-node commands/remove_agent_role.ts -a agent123 --reason "rotation policy"
```

## Redis Schema

The agent role delegation system uses the following Redis schema:

| Key Format | Type | Purpose |
|------------|------|---------|
| agent:{agentId}:role | string | Stores the current role of the agent |
| governance:roles:{roleName} | set | Set of agent IDs that hold a specific role |
| agent:{agentId}:role:history | list | Timestamped role changes for auditability |

## Future Enhancements

- GET /governance/roles endpoint: Show all role assignments
- Auto-expiration on temporary roles: Short-term delegation
- Discord log of role changes: Governance transparency
- Web UI for role management: Visual representation of governance hierarchy 