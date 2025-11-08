# Smart Order Routing: Bridge Selection & Metrics Integration

## Overview
The Smart Order Routing module in Noderr Protocol enables optimal cross-chain transaction execution by dynamically selecting the best bridges for each hop, using real-time metrics and a pluggable scoring strategy. This ensures transactions are routed efficiently, securely, and with full observability.

---

## Architecture

```
+-------------------+      +---------------------+      +--------------------------+
|   PathFinder      | ---> |   BridgeSelector    | ---> | DefaultBridgeScoringStrat|
| (entrypoint)      |      | (pluggable)         |      | (pluggable)              |
+-------------------+      +---------------------+      +--------------------------+
         |                        ^
         v                        |
+-------------------+      +---------------------+
| BridgeRegistry    |<-----| BridgeMetricsCollector |
+-------------------+      +---------------------+
```

- **PathFinder**: Orchestrates path discovery and bridge selection for cross-chain transactions.
- **BridgeSelector**: Selects the optimal bridge for each hop using a scoring strategy and real-time metrics.
- **DefaultBridgeScoringStrategy**: Scores bridges based on configurable weights for liquidity, fees, time, reliability, and security.
- **BridgeMetricsCollector**: Fetches and caches real-time metrics for all candidate bridges.
- **BridgeRegistry**: Maintains the set of available bridges and their health status.

---

## Sequence of Operations
1. **PathFinder** initiates path discovery for a cross-chain transaction.
2. For each hop, it retrieves all candidate bridges from **BridgeRegistry**.
3. **BridgeMetricsCollector** fetches real-time metrics for each candidate bridge (liquidity, fees, time, reliability, security).
4. **BridgeSelector** uses the metrics and the scoring strategy to select the optimal bridge for the hop.
5. The process repeats recursively for multi-hop paths.
6. Telemetry and logging are emitted for every bridge selection and pathfinding event.

---

## Key Interfaces & Configuration

### PathFinder
- `findOptimalPath(fromAsset, toAsset, amount)` — Finds the best path using bridge selection and scoring.
- Configurable via `PathFinderConfig` (max hops, scoring weights, etc).

### BridgeSelector
- `selectBestBridge(bridges, criteria, metricsMap)` — Returns the best bridge and rationale.
- Accepts a pluggable scoring strategy.

### DefaultBridgeScoringStrategy
- Configurable weights for:
  - Liquidity
  - Fee
  - Time
  - Reliability
  - Security
- Thresholds for minimum liquidity, max fee, and max time.

### BridgeMetricsCollector
- `getMetrics(bridge)` — Returns real-time metrics, with caching and fallback.
- Configurable cache TTL, retry logic, and fallback behavior.

---

## Extensibility
- **Custom Scoring**: Implement your own `BridgeScoringStrategy` and inject into `BridgeSelector`.
- **Custom Metrics**: Extend `BridgeMetricsCollector` to fetch additional or chain-specific metrics.
- **Bridge Health**: Integrate custom health checks via `BridgeRegistry`.

---

## Security & Observability
- All bridge and metric data is validated before use.
- Errors in metric fetching trigger fallback and are logged/telemetrized.
- Telemetry events are emitted for every bridge selection and pathfinding event.
- No sensitive data is exposed in logs or telemetry.

---

## Usage Example
```typescript
import { PathFinder } from 'src/execution/path/PathFinder';
import { Asset } from 'src/execution/types/Asset';

const pathFinder = PathFinder.getInstance();
const fromAsset: Asset = { /* ... */ };
const toAsset: Asset = { /* ... */ };
const amount = '10000';

const result = await pathFinder.findOptimalPath(fromAsset, toAsset, amount);
if (result) {
  console.log('Best path:', result.path);
  console.log('Score:', result.score);
} else {
  console.log('No valid path found.');
}
```

---

## Error Handling
- If no bridges are available or all are unhealthy, pathfinding returns `null`.
- If metric fetching fails, fallback to cached or default metrics is used.
- All errors are logged and emitted as telemetry events for monitoring.

---

## Developer Notes
- All classes are singleton or pluggable for easy integration and testing.
- Tests cover all critical scenarios, including edge cases and error handling.
- For advanced use, extend the scoring strategy or metrics collector as needed.

---

## Further Reading
- [API Design Tips for Multiple Resources](https://apihandyman.io/api-design-tips-and-tricks-getting-creating-updating-or-deleting-multiple-resources-in-one-api-call/)
- [Node.js Process Management](https://nodejs.org/api/process.html) 