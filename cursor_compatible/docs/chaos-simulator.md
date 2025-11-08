# Chaos Regression Simulator

The Chaos Regression Simulator is an adversarial fuzzing + trust degradation framework designed to push Noderr's AI agent architecture to its limits. It exposes fragility, behavioral edge cases, and failure scenarios across the decentralized multi-agent trading system.

## 🧪 Overview

The Chaos Simulator tests agents under high-pressure, high-entropy, and high-frequency market conditions to:

- Identify weak points in individual agents
- Trigger unexpected trust decay events 
- Force-slash borderline agents and monitor self-healing
- Analyze recovery time under adversarial loads
- Track which agents adapt, fail, or collude

## 📋 Components

The Chaos Regression Simulator consists of several key components:

1. **ChaosOrchestrator**: Manages the chaos round lifecycle, coordinates stimuli application, and generates reports.
2. **ChaosGenerator**: Produces randomized or adversarial stimuli to stress-test agent behavior.
3. **ChaosSimulationBus**: Provides pub/sub and WebSocket hooks for broadcasting events during simulation.
4. **CLI Tool**: Command-line interface for configuring and running simulation scenarios.

## 🚀 Usage

### Running a Basic Simulation

```bash
npm run chaos:simulate
```

This runs a simulation with default parameters.

### Running an Intensive Simulation

```bash
npm run chaos:simulate:intense
```

This runs a simulation with high volatility, increased corruption rate, and forced trust degradation.

### Custom Simulation

```bash
npm run chaos:simulate -- --rounds 50 --marketVolatility 85 --corruptionRate 0.3 --forceTrustLoss true
```

## 🎛️ Configuration Options

The simulator supports the following configuration parameters:

| Parameter            | Description                                      | Default |
|----------------------|--------------------------------------------------|---------|
| rounds               | Number of simulation rounds to run               | 10      |
| marketVolatility     | Market volatility level (0-100)                  | 50      |
| corruptionRate       | Rate of data corruption (0-1)                    | 0.2     |
| maxLatencyMs         | Maximum simulated latency in milliseconds        | 1000    |
| forceTrustLoss       | Force trust score degradation                    | false   |
| conflictRate         | Rate of conflicting signals (0-1)                | 0.3     |
| apiFailureRate       | Rate of API failures (0-1)                       | 0.1     |
| blackSwanProbability | Probability of black swan events (0-1)           | 0.05    |
| roundTimeout         | Maximum duration for each round in milliseconds  | 5000    |
| agentCount           | Number of mock agents to test (mock mode)        | 10      |
| intensify            | Gradually increase chaos intensity with each round| true    |
| saveReport           | Save simulation reports to file                  | true    |
| output               | Custom path to save the simulation report        | auto    |

## 📊 Metrics & Reports

Each simulation generates a report that includes:

- **Trust Regression Path**: Time-based erosion under pressure
- **Resilience Score**: Recovery time from a drop
- **Slashing Events**: Whether policy is working
- **Self-Healing Events**: Rebounding agents via reputation
- **Agent Adaptation Tags**: Notes on agents that evolved

Reports are saved as JSON files in the `reports/` directory by default.

## 📈 Example Report

```json
{
  "timestamp": 1713920000000,
  "reports": [...],
  "summary": {
    "totalRounds": 50,
    "avgSystemStability": 67.8,
    "degradedAgents": [ "agent:meta-3", "agent:delta-2" ],
    "quarantinedAgents": [ "agent:gamma-5" ],
    "adaptedAgents": [ "agent:alpha-1", "agent:theta-4" ]
  }
}
```

## 🔄 Integration with Trust System

The Chaos Simulator integrates tightly with Noderr's trust system to:

1. Test the trust decay mechanism under pressure
2. Validate quarantine triggers for low-trust agents
3. Observe self-healing behavior after trust slashing
4. Measure system stability under various levels of stress

## 🧠 Advanced Usage

### Real-World Scenario Simulation

Inject real-world stress data (like FTX collapse or COVID market crash):

```bash
npm run chaos:simulate -- --scenario "ftx-collapse"
```

### Chaos Replay Mode

Repeat identical chaos scenarios for upgrade validation:

```bash
npm run chaos:simulate -- --replayFile "reports/chaos-report-2023-05-01.json"
```

### Dashboard Integration

All simulation events are published to Redis channels, allowing for live observation in the Telemetry Dashboard.

## 🧪 Future Enhancements

- Advanced adversarial pattern generation
- Neural fuzzing based on historical failure patterns
- System topology stress testing
- Cross-agent collusion detection
- Long-term resilience scoring 