# Self-Healing Agents System

This module implements a robust self-healing system that allows agents to automatically detect and recover from trust score degradation. When agent trust falls below critical thresholds, their behavior is automatically adjusted to prioritize high-quality signals and gradually rebuild trust.

## Core Components

### TrustScoreService

Enhanced with trust state monitoring capabilities:
- Manages trust scores (0-100 scale) for all agents
- Tracks agent health modes (NORMAL, SELF_HEALING, CRITICAL)
- Detects transitions between health modes
- Emits real-time events for health state changes

### AgentHealthManager

Handles the self-healing process:
- Provides behavior adjustments based on agent health
- Records successful operations for healing progress
- Monitors recovery eligibility criteria
- Manages the transition back to normal operation
- Applies extra penalties for failures during healing

### AgentPipelineIntegration

Integrates health monitoring with signal processing:
- Filters signals based on agent health state
- Adjusts confidence thresholds for agents in healing mode
- Throttles signal frequency for recovering agents
- Completely suppresses signals from critical agents
- Updates trust scores based on operation outcomes

## Health Modes

### NORMAL (Trust Score > 35)
- Full participation in the agent ecosystem
- Standard confidence thresholds
- Normal signal frequency
- Eligible for all operations

### SELF_HEALING (Trust Score 15-35)
- Reduced signal frequency (50%)
- Higher confidence thresholds (85%)
- Recovery boost for successful operations (2x)
- Ineligible for sensitive operations
- Must achieve 5 successful operations to recover

### CRITICAL (Trust Score < 15)
- Signal output suppressed entirely
- Extremely high confidence thresholds (95%)
- Maximum recovery boost for successful operations (3x)
- Requires manual intervention/audit
- Cannot perform any sensitive operations

## Self-Healing Process

1. When an agent's trust score falls below 35, it automatically enters `SELF_HEALING` mode
2. The system applies behavior adjustments to limit impact and risk
3. Successful operations during healing boost trust more than normal
4. Agent must maintain good behavior for a minimum time period (15 minutes)
5. After 5 successful operations and trust above threshold, agent returns to `NORMAL` mode
6. A small recovery bonus is applied upon successful healing

## Monitoring & Management

### agent-health CLI

Command-line tool for monitoring and managing agent health:
- `agent-health list` - View all agents with health status
- `agent-health get <agentId>` - View detailed health info for an agent
- `agent-health simulate-success <agentId>` - Simulate a successful operation
- `agent-health simulate-failure <agentId>` - Simulate a failed operation
- `agent-health monitor` - Watch health events in real-time

### Trust Events Stream

Real-time telemetry events are emitted via Redis pub/sub:
- Trust score changes
- Health mode transitions
- Self-healing entry/exit events
- Recovery progress updates

## Implementation Details

### Trust Score Range
- 0-100 scale for intuitive understanding
- Normalized to 0-1 for internal calculations
- Minimum weight of 0.1 for all agents

### Healing Thresholds
- SELF_HEALING: Trust score below 35
- CRITICAL: Trust score below 15
- Minimum decay level: 30 (trust decay stops at this level)

### Recovery Criteria
- Trust score back above 35
- Minimum 15 minutes in self-healing mode
- At least 5 successful operations
- Recovery bonus of 2 points upon successful healing

### Error Severity Levels
- Network issues: 0.3 severity
- Validation errors: 0.5 severity
- Timing issues: 0.2 severity
- Security violations: 0.9 severity
- Critical errors: 1.0 severity

## Integration with Other Systems

The self-healing agents system integrates with:

1. **Trust-Weighted Consensus** - By ensuring that recovering agents contribute fewer but higher-quality signals

2. **Trust Decay System** - Working alongside the decay system to enable recovery mechanisms

3. **Agent Governance** - Providing health status information for governance decisions

4. **Monitoring Dashboard** - Feeding telemetry data to visualize agent health

## Usage Example

```typescript
// Initialize required services
const redis = new RedisService();
const trustService = new TrustScoreService(redis);
const healthManager = new AgentHealthManager(trustService, redis);
const pipelineIntegration = new AgentPipelineIntegration(trustService, healthManager);

// In agent signal pipeline
async function processAgentSignal(agentId: string, signal: AgentSignal) {
  // Apply health-based filtering
  const shouldProcess = await pipelineIntegration.signalFilter(agentId, signal);
  
  if (shouldProcess) {
    // Process the signal normally
    const result = await executeSignal(signal);
    
    // Update trust based on operation result
    await pipelineIntegration.handleOperationResult(agentId, {
      success: result.success,
      errorType: result.error?.type
    });
  }
}

// Get agent telemetry for dashboard
const telemetry = await pipelineIntegration.getAgentTelemetry('agent-123');
```

## Key Benefits

1. **Risk Containment** - Automatically limits the impact of problematic agents
2. **Self-Regulation** - Agents can recover without manual intervention
3. **Quality Assurance** - Encourages high-quality signals during recovery
4. **Adaptive Behavior** - Dynamically adjusts behavior based on trust level
5. **Transparency** - Provides detailed monitoring and telemetry
6. **Autonomous Resilience** - System heals itself through agent behavior correction 