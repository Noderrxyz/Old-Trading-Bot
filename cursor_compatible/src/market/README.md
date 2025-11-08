# Market Data Processor

The Market Data Processor is a critical component of the Noderr Trading Bot that handles real-time market data ingestion, feature calculation, and anomaly detection. It's designed with high performance in mind, leveraging Rust for core calculations with a JavaScript fallback implementation.

## Key Components

### `MarketDataProcessorRust.ts`

TypeScript wrapper for the Rust implementation with fallback support:

- Leverages native Rust methods for high-performance data processing
- Automatically falls back to JavaScript implementation when native methods fail
- Implements singleton pattern for consistent application-wide access
- Includes periodic timers for feature calculation and anomaly detection

### `MarketDataProcessorJs.ts`

Pure JavaScript implementation used as a fallback:

- Provides identical API to the Rust implementation
- Handles all data processing in memory
- Calculates key metrics like volatility, momentum, and volume profiles
- Detects market anomalies like price and volume spikes

### Core Data Types

- **MarketTick**: Represents a single market data point with price, volume, etc.
- **MarketFeatures**: Contains calculated statistical features for a specific symbol
- **MarketAnomaly**: Describes detected anomalies with type, severity, and metadata
- **MarketDataProcessorConfig**: Configuration parameters for the processor

## Usage Examples

### Basic Usage

```typescript
import { MarketDataProcessorRust, MarketTick } from "./market/MarketDataProcessorRust";

// Get the singleton instance
const marketDataProcessor = MarketDataProcessorRust.getInstance();

// Process a market tick
const tick: MarketTick = {
  symbol: "BTC-USD",
  timestamp: Date.now(),
  price: 50000,
  volume: 1.5,
  bid: 49990,
  ask: 50010
};

marketDataProcessor.processTick(tick);

// Calculate features for a symbol
const features = marketDataProcessor.calculateFeatures("BTC-USD");
console.log(features);

// Detect anomalies
const anomalies = marketDataProcessor.detectAnomalies();
if (anomalies.length > 0) {
  console.log("Detected anomalies:", anomalies);
}
```

### Advanced Configuration

```typescript
import { 
  MarketDataProcessorRust, 
  MarketDataProcessorConfig 
} from "./market/MarketDataProcessorRust";

// Create custom configuration
const config: Partial<MarketDataProcessorConfig> = {
  featureCalculationInterval: 10000, // 10 seconds
  anomalyDetectionInterval: 30000,   // 30 seconds
  maxTickHistory: 5000,
  features: {
    enabledFeatures: ['volatility', 'momentum'],
    windows: [14, 30, 50]
  }
};

// Get instance with custom config
const marketDataProcessor = MarketDataProcessorRust.getInstance(config);

// Update configuration at runtime
marketDataProcessor.updateConfig({
  featureCalculationInterval: 5000
});
```

## Performance Considerations

- The Rust implementation is significantly faster than the JavaScript fallback
- For high-frequency data processing, ensure the Rust native module is available
- Consider adjusting `maxTickHistory` based on memory constraints
- Periodic calculations scale with the number of tracked symbols

## Integration with Other Components

- Works with the Shared Memory Manager for efficient data sharing
- Provides features that feed into strategy engines
- Detects anomalies that can trigger risk management responses
- Integrates with telemetry for system monitoring

## Internal Implementation Details

The Market Data Processor maintains a history of ticks per symbol and uses this data to calculate features and detect anomalies. It employs a windowed approach to statistical calculations, allowing for efficient updates without reprocessing the entire dataset.

Both implementations (Rust and JavaScript) maintain identical public APIs, allowing for seamless switching between them. The TypeScript wrapper handles the initialization of both implementations and the fallback logic. 