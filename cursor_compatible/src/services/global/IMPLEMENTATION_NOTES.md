# Agent Trust-Weighted Voting System Implementation Notes

This document provides an overview of the implementation of the Agent Trust-Weighted Voting System, which enhances the existing Global Multi-Agent Trend Prediction + Consensus Models.

## Core Components

### TrustScoreService

- Centralized service for retrieving and managing agent trust scores
- Normalized trust scores (0-100) to weights (0.1-1.0) for voting
- Maintains history of trust score changes for auditing
- Default trust of 50 for new agents
- Monitors agent health state transitions based on trust thresholds

### TrustWeightedConsensusEngine

- Extends the base TrendConsensusEngine
- Weights each agent's vote by their trust score
- Higher-trust agents exert greater influence on global trend direction
- Includes detailed consensus information with confidence metrics

### TrustDecayManager

- Manages decay and slashing of agent trust scores over time
- Configurable decay rates based on current trust level
- Faster decay for high-trust agents, slower for low-trust agents
- Slashing mechanism for violations of different severity levels
- Comprehensive event recording for transparency

### AgentHealthManager

- Manages self-healing behavior for agents with low trust scores
- Provides behavior adjustments based on health mode (NORMAL, SELF_HEALING, CRITICAL)
- Records successful operations for healing progress
- Applies recovery boosts for agents in healing mode
- Manages the transition between health modes based on criteria

### AgentPipelineIntegration

- Integrates health monitoring with signal processing pipeline
- Filters signals based on agent health state
- Adjusts confidence thresholds and throttles signals for recovering agents
- Completely suppresses signals from agents in CRITICAL health mode
- Updates trust scores based on operation outcomes

## CLI Tools

### consensus-snapshot-weighted.ts

- Trust-weighted version of the consensus snapshot tool
- Shows the effect of agent trust scores on consensus
- Provides detailed information about signal counts and confidence

### trust-manager.ts

- Comprehensive tool for managing agent trust scores
- Commands for listing, getting, setting, and adjusting trust scores
- Slashing functionality with different severity levels
- History viewing capabilities
- Manual decay triggering

### agent-health.ts

- Tool for monitoring and managing agent health states
- Commands for viewing health status of all agents
- Detailed health information for individual agents
- Simulation of successful/failed operations for testing
- Real-time monitoring of agent health events

## Scheduled Jobs

### agent-trust-decay.ts

- Automated job for trust decay process
- Configurable decay rates and thresholds
- Can be scheduled via cron or systemd timer
- Logs all operations for auditing

## Implementation Decisions

1. **Trust Score Range**: We use a 0-100 range for trust scores for intuitive understanding, but normalize to 0-1 for internal calculations.

2. **Minimum Trust Weight**: To ensure even low-trust agents have some influence, we set a minimum weight of 0.1.

3. **Progressive Decay**: Higher-trust agents decay faster than lower-trust ones, creating a natural equilibrium.

4. **Slashing Mechanism**: Three severity levels (minor, moderate, severe) with different penalty amounts.

5. **History Recording**: All trust changes are recorded with timestamps for transparency and auditing.

6. **Health Thresholds**: Agents enter self-healing mode when trust falls below 35, and critical mode below 15.

7. **Recovery Criteria**: Agents must maintain good behavior for at least 15 minutes and achieve 5 successful operations to recover.

8. **Behavior Adjustments**: Self-healing agents have reduced signal frequency, higher confidence thresholds, and recovery boosts.

## Self-Healing Agent System

The self-healing agents system allows agents to automatically detect and recover from trust score degradation:

1. **Health Modes**:
   - NORMAL (Trust Score > 35): Full participation in the ecosystem
   - SELF_HEALING (Trust Score 15-35): Reduced signal frequency, higher thresholds
   - CRITICAL (Trust Score < 15): Signal output suppressed entirely

2. **Self-Healing Process**:
   - Agent enters self-healing mode when trust falls below threshold
   - System applies behavior adjustments to limit impact and risk
   - Successful operations during healing boost trust more than normal
   - After meeting recovery criteria, agent returns to normal mode
   - A small recovery bonus is applied upon successful healing

3. **Error Handling**:
   - Different error types result in different severity penalties
   - Increased penalties for failures during healing mode
   - Comprehensive monitoring and telemetry for debugging

4. **Benefits**:
   - Risk containment through automatic behavior adjustment
   - Self-regulation without manual intervention
   - Quality assurance through higher thresholds during recovery
   - Transparency through detailed monitoring and telemetry

## Future Enhancements

1. **Trust Visualization Dashboard**: A web-based dashboard to visualize trust scores and their changes over time.

2. **Performance-Based Trust**: Automatically adjust trust scores based on agents' prediction accuracy.

3. **Reputation System**: Allow agents to build reputation through consistent good performance.

4. **Governance Integration**: Use trust scores for voting power in system governance.

5. **Sybil Resistance**: Mechanisms to prevent manipulation through multiple low-trust agents.

6. **Predictive Health Monitoring**: Use trend analysis to predict which agents are at risk of entering self-healing mode.

7. **Advanced Recovery Paths**: Specialized recovery paths based on the reason for trust degradation.

## Integration Points

The Agent Trust-Weighted Voting System integrates with:

1. **Global Consensus System**: Provides weighted voting for trend direction.

2. **Strategy Adjustment**: Influences strategy parameters based on more reliable consensus.

3. **Agent Management**: Provides a framework for agent accountability.

4. **Governance System**: Could be leveraged for system governance voting.

5. **Monitoring Dashboard**: Feeds telemetry data to visualize agent health and trust. 