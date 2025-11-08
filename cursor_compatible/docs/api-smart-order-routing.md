# Smart Order Routing API Documentation

## Overview
This document provides detailed API documentation for the Smart Order Routing module, including all public interfaces, types, methods, error handling, extension points, and usage examples. This is intended for developers integrating, extending, or maintaining the Noderr Protocol's cross-chain routing system.

---

## PathFinder

### `PathFinder.getInstance(config?: Partial<PathFinderConfig>): PathFinder`
Returns the singleton instance of the PathFinder. Optionally accepts a partial configuration object.

#### Parameters
- `config` (optional): `Partial<PathFinderConfig>` — Configuration overrides.

#### Returns
- `PathFinder` — The singleton instance.

---

### `findOptimalPath(fromAsset: Asset, toAsset: Asset, amount: string): Promise<{ path: Path; score: PathScore } | null>`
Finds the optimal cross-chain path for a given asset transfer.

#### Parameters
- `fromAsset`: `Asset` — The source asset.
- `toAsset`: `Asset` — The destination asset.
- `amount`: `string` — The amount to transfer (as a string for precision).

#### Returns
- `Promise<{ path: Path; score: PathScore } | null>` — The best path and its score, or `null` if no valid path is found.

#### Example
```typescript
const result = await pathFinder.findOptimalPath(fromAsset, toAsset, '10000');
if (result) {
  console.log(result.path, result.score);
}
```

#### Error Handling
- Returns `null` if no valid path is found or if all bridges are unhealthy.
- All errors are logged and emitted as telemetry events.

---

### `simulatePath(path: Path, inputAmount: string): Promise<PathSimulationResult>`
Simulates the outcome of a given path, including expected output, slippage, fees, and risk.

#### Parameters
- `path`: `Path` — The path to simulate.
- `inputAmount`: `string` — The input amount.

#### Returns
- `Promise<PathSimulationResult>` — Simulation results including output, fees, slippage, and risk factors.

---

## BridgeSelector

### `new BridgeSelector(scoringStrategy: BridgeScoringStrategy)`
Creates a new BridgeSelector with a pluggable scoring strategy.

#### Parameters
- `scoringStrategy`: `BridgeScoringStrategy` — The scoring strategy to use.

---

### `selectBestBridge(bridges: Bridge[], criteria: BridgeSelectionCriteria, metricsMap: Map<string, BridgeMetrics>): BridgeSelectionResult | null`
Selects the optimal bridge from a list of candidates based on criteria and real-time metrics.

#### Parameters
- `bridges`: `Bridge[]` — Candidate bridges.
- `criteria`: `BridgeSelectionCriteria` — Selection criteria (source/destination chain, amount, preferences).
- `metricsMap`: `Map<string, BridgeMetrics>` — Real-time metrics for each bridge.

#### Returns
- `BridgeSelectionResult | null` — The best bridge and rationale, or `null` if none are suitable.

---

## DefaultBridgeScoringStrategy

### `new DefaultBridgeScoringStrategy(config?: Partial<DefaultScoringConfig>)`
Creates a new scoring strategy with configurable weights and thresholds.

#### Parameters
- `config` (optional): `Partial<DefaultScoringConfig>` — Custom weights and thresholds.

#### Example
```typescript
const strategy = new DefaultBridgeScoringStrategy({ liquidityWeight: 0.5 });
```

---

## BridgeMetricsCollector

### `BridgeMetricsCollector.getInstance(config?: Partial<BridgeMetricsCollectorConfig>): BridgeMetricsCollector`
Returns the singleton instance of the metrics collector.

---

### `getMetrics(bridge: Bridge): Promise<BridgeMetrics>`
Fetches real-time metrics for a given bridge, with caching and fallback.

#### Parameters
- `bridge`: `Bridge` — The bridge to fetch metrics for.

#### Returns
- `Promise<BridgeMetrics>` — The metrics object.

#### Error Handling
- If fetching fails, falls back to cached or default metrics.
- All errors are logged and emitted as telemetry events.

---

## Types

### `Asset`
- `chainId: ChainId`
- `address: string`
- `symbol: string`
- `decimals: number`
- `name: string`

### `Bridge`
- `id: string`
- `name: string`
- `sourceChain: ChainId`
- `destinationChain: ChainId`
- `sourceAddress: string`
- `destinationAddress: string`
- `isActive: boolean`
- `minAmountUsd: number`
- `maxAmountUsd: number`
- `estimatedTimeSeconds: number`
- `feePercentage: number`

### `BridgeSelectionCriteria`
- `sourceChain: ChainId`
- `destinationChain: ChainId`
- `amountUsd: number`
- `userPreferences?: Record<string, unknown>`

### `BridgeMetrics`
- `liquidityUsd: number`
- `feeUsd: number`
- `estimatedTimeSeconds: number`
- `reliabilityScore: number`
- `securityScore: number`

### `Path`
- `hops: Array<{ fromChain: ChainId; toChain: ChainId; bridge: string; asset: Asset }>`
- `fromAsset: Asset`
- `toAsset: Asset`
- `amount: string`

### `PathScore`
- `gasCost: number`
- `bridgeFees: number`
- `priceImpact: number`
- `pathLength: number`
- `liquidity: number`
- `total: number`

### `PathSimulationResult`
- `path: Path`
- `inputAmount: string`
- `expectedOutputAmount: string`
- `totalFees: string`
- `slippage: number`
- `failureProbability: number`
- `warnings: string[]`
- `hopDetails: Array<{ bridge: string; fromChain: string; toChain: string; input: string; output: string; fee: string; slippage: number; risk: string[] }>`

---

## Error Handling & Edge Cases
- All methods return `null` or fallback values on failure, never throw uncaught exceptions.
- All errors are logged and emitted as telemetry events.
- Fallbacks are used for metric failures and unhealthy bridges.

---

## Extension Points
- Implement custom `BridgeScoringStrategy` for advanced bridge selection logic.
- Extend `BridgeMetricsCollector` for additional or chain-specific metrics.
- Integrate custom health checks via `BridgeRegistry`.

---

## Security & Observability
- All input is validated and sanitized.
- No sensitive data is exposed in logs or telemetry.
- Telemetry events are emitted for all key operations and errors.

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
}
``` 