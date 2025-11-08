# Noderr Protocol Trading Bot Telemetry

This directory contains the telemetry and metrics implementations for the Noderr Protocol Trading Bot, focusing on observability and monitoring of blockchain adapters and trading operations.

## Architecture

The telemetry system is structured around these key components:

1. **Core Metrics Module** (`metrics.ts`): Prometheus instrumentation for collecting standardized metrics about adapter performance, operations, and system health.

2. **Telemetry Integration** (`BlockchainTelemetry.js`): Enhances blockchain adapters with automatic metrics collection.

3. **API Server Integration**: Exposes metrics in Prometheus format via HTTP endpoint.

4. **Dashboard Templates**: Pre-configured Grafana dashboards for visualizing metrics.

## Getting Started

### Installing Dependencies

Ensure you have the required dependencies:

```bash
npm install prom-client express cors
```

### Setting Up Metrics Endpoint

The metrics endpoint is already set up in `src/api/server.ts`, which exposes the Prometheus metrics at `/metrics`.

### Instrumenting a Blockchain Adapter

```javascript
import { enhanceAdapterWithTelemetry } from '../adapters/telemetry/BlockchainTelemetry.js';

// Create your adapter
const adapter = createAdapter(chainId, adapterConfig);

// Enhance it with telemetry
const enhancedAdapter = enhanceAdapterWithTelemetry(adapter, chainId, isMainnet);

// Use the enhanced adapter as normal
await enhancedAdapter.connect();
const balance = await enhancedAdapter.getBalance(address);
```

### Recording Metrics Directly

If you need to record metrics from other parts of your application:

```javascript
import {
  recordBlockchainOperation,
  updateBlockchainConnectionStatus,
  updateCircuitBreakerState
} from './telemetry/metrics.js';

// Record a blockchain operation
recordBlockchainOperation(
  chainId,           // Chain ID (e.g., 1 for Ethereum)
  'custom_operation', // Operation name
  true,              // isMainnet
  startTime,         // Performance tracking start time (ms)
  success            // Whether operation succeeded
);

// Update blockchain connection status
updateBlockchainConnectionStatus(
  chainId,           // Chain ID
  true,              // isMainnet
  true,              // connected
  blockHeight,       // Current block height (optional)
  gasPrice           // Current gas price in Gwei (optional)
);

// Update circuit breaker state
updateCircuitBreakerState(
  chainId,           // Chain ID
  true,              // isMainnet
  false              // isOpen (true=open/failing, false=closed/working)
);
```

## Available Metrics

### Blockchain Adapter Metrics

- **Connection Status**: Gauges tracking connectivity to each chain
- **Circuit Breaker Status**: Gauges showing circuit breaker states
- **RPC Latency**: Histograms of RPC call performance
- **Operation Latency**: Histograms of high-level operation performance
- **Error Rates**: Counters for different error types
- **Retry Counts**: Counters for retry attempts
- **Queue Depth**: Gauges for operation backlog

### Trading Metrics

- **Execution Latency**: Histograms of trade execution times
- **Volume**: Counters tracking trading volumes
- **Slippage**: Histograms measuring execution slippage
- **Fees**: Counters for trading fees

## Prometheus Configuration

To scrape these metrics with Prometheus, add a job to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'noderr_trading_bot'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:3000']  # Adjust port as needed
```

## Grafana Dashboard

A pre-configured Grafana dashboard is available in `dashboards/blockchain-adapter-dashboard.json` which can be imported into Grafana for immediate visualization of key metrics.

## Testing the Metrics System

You can verify that metrics are being properly collected by running the test script:

```bash
node src/telemetry/test-metrics.js
```

This script simulates various blockchain operations and displays the collected metrics in Prometheus exposition format.

## Best Practices

1. **Consistent Labels**: Always use the same chain_id, method, and status labels consistently
2. **Avoid High Cardinality**: Don't create metrics with too many label combinations
3. **Focus on SLIs/SLOs**: Prioritize metrics that reflect service level indicators/objectives
4. **Balance Detail vs. Overhead**: Collect enough data for monitoring without excessive overhead

## Advanced Usage

### Extending with Custom Metrics

You can add custom metrics in `metrics.ts`:

```typescript
// Define the metric
export const myCustomMetric = new prom.Counter({
  name: 'my_custom_metric_total',
  help: 'Description of what this metric counts',
  labelNames: ['label1', 'label2'],
  registers: [register]
});

// Export helper function to record the metric
export function recordMyCustomMetric(label1Value, label2Value, incrementValue = 1) {
  myCustomMetric.inc({ label1: label1Value, label2: label2Value }, incrementValue);
}
```

### Integration with Circuit Breakers and Retry Handlers

The metrics system is integrated with the circuit breaker and retry mechanisms to provide visibility into reliability features:

- Circuit breakers report their state transitions to metrics
- Retry handlers track retry attempts by operation
- AdapterRegistry coordinates metrics collection across all adapters 