# Knowledge Enhancement System Guide

## Overview

The Knowledge Enhancement System for Noderr Protocol provides a flexible, modular approach to incorporating external data sources and intelligence into trading strategies. Unlike rigid integrations, this system treats external sources like Numerai as optional "knowledge plugins" that can selectively enhance decision-making when appropriate for cryptocurrency markets.

## Key Design Principles

1. **Selective Application**: Knowledge is only applied when relevant to crypto markets
2. **Performance-Based Adaptation**: Providers are automatically enabled/disabled based on effectiveness
3. **Non-Intrusive**: The system enhances existing strategies without requiring modifications
4. **Feedback Loop**: Performance data is used to improve knowledge application over time

## Architecture

### Core Components

1. **IKnowledgeProvider Interface** (`src/knowledge/interfaces/IKnowledgeProvider.ts`)
   - Defines the contract for all knowledge providers
   - Handles applicability assessment and enhancement generation

2. **KnowledgeAggregator** (`src/knowledge/KnowledgeAggregator.ts`)
   - Central service managing multiple knowledge providers
   - Aggregates and weights knowledge from different sources
   - Implements caching and performance tracking

3. **Knowledge Providers**
   - `MockKnowledgeProvider`: For testing and demonstration
   - Future: `NumeraiProvider`, `ChainlinkProvider`, etc.

## Quick Start

### 1. Basic Setup

```typescript
import { KnowledgeAggregator } from './knowledge/KnowledgeAggregator';
import { MockKnowledgeProvider } from './knowledge/providers/MockKnowledgeProvider';
import { getTradingConfig } from './config/trading.config';

// Get configuration
const config = getTradingConfig({
  knowledgeEnhancement: {
    enabled: true,
    enabledProviders: ['mock'],
    minConfidenceThreshold: 0.4,
    minApplicabilityThreshold: 0.3
  }
});

// Initialize knowledge aggregator
const aggregator = KnowledgeAggregator.getInstance(config.knowledgeEnhancement);

// Register providers
const mockProvider = new MockKnowledgeProvider(
  config.knowledgeEnhancement.providerConfigs?.mock
);
await aggregator.registerProvider(mockProvider);

// Initialize
await aggregator.initialize();
```

### 2. Integration with Strategies

Strategies automatically use the KnowledgeAggregator if available:

```typescript
// In your strategy implementation
const signal = await strategy.generateSignal(marketFeatures, {
  timeframe: '1h'
});

// The strategy will automatically:
// 1. Query applicable knowledge providers
// 2. Enhance features and parameters
// 3. Adjust signal confidence
// 4. Track which providers were used
```

### 3. Monitoring Performance

```typescript
// Get provider statistics
const stats = aggregator.getProviderStats();

for (const [providerId, providerStats] of stats) {
  console.log(`Provider ${providerId}:`);
  console.log(`- Queries: ${providerStats.totalQueries}`);
  console.log(`- Applicable: ${providerStats.applicableQueries}`);
  console.log(`- Useful: ${providerStats.timesUseful}`);
  console.log(`- Avg Gain: ${providerStats.avgPerformanceGain}`);
}
```

## Configuration Options

### Global Settings

```typescript
export interface KnowledgeEnhancementConfig {
  enabled: boolean;                    // Master switch
  enabledProviders: string[];          // Which providers to use
  minConfidenceThreshold: number;      // Min confidence to apply knowledge (0-1)
  minApplicabilityThreshold: number;   // Min crypto applicability (0-1)
  enableAdaptiveProviders: boolean;    // Auto-disable poor performers
  knowledgeCacheDurationMs: number;    // Cache duration in ms
  providerConfigs?: Record<string, any>; // Provider-specific settings
}
```

### Provider Configuration

Each provider can have custom configuration:

```typescript
// Mock provider config
{
  mock: {
    baseConfidence: 0.6,
    baseCryptoApplicability: 0.5,
    simulateVariability: true,
    failureRate: 0.05,
    simulatedLatencyMs: 100
  }
}
```

## Knowledge Enhancement Flow

1. **Context Creation**: Strategy creates a knowledge context with current market state
2. **Applicability Check**: Each provider assesses if it can provide useful knowledge
3. **Enhancement Generation**: Applicable providers generate enhancements
4. **Aggregation**: Multiple enhancements are weighted and merged
5. **Application**: Enhanced features/parameters are applied to signal generation
6. **Feedback**: Performance results are fed back to providers

## Performance Tracking

The system tracks several metrics:

- **Applicability Rate**: How often a provider has relevant knowledge
- **Usefulness Rate**: How often applied knowledge improves performance
- **Average Performance Gain**: Mean improvement when knowledge is applied
- **Provider Confidence**: Dynamic confidence score based on historical performance

## Adaptive Behavior

Providers are automatically managed based on performance:

1. **Poor Performers**: Disabled if performance score < 0.1
2. **Improved Performers**: Re-enabled if performance score > 0.3
3. **Performance Score**: `applicabilityRate * usefulnessRate * (1 + avgGain)`

## Telemetry Events

The system emits detailed telemetry for monitoring:

- `knowledge_provider_registered`: Provider added to system
- `knowledge_aggregator_initialized`: System startup
- `knowledge_provider_queried`: Provider consulted
- `knowledge_aggregated`: Knowledge combined
- `signal_knowledge_enhanced`: Signal improved
- `knowledge_provider_disabled`: Provider turned off
- `knowledge_provider_enabled`: Provider turned on

## Creating Custom Providers

To create a custom knowledge provider:

```typescript
import { IKnowledgeProvider, KnowledgeContext, KnowledgeEnhancement } from '../interfaces/IKnowledgeProvider';

export class MyCustomProvider implements IKnowledgeProvider {
  readonly id = 'custom';
  readonly name = 'My Custom Provider';
  enabled = true;
  
  async initialize(): Promise<void> {
    // Setup code
  }
  
  async assessApplicability(context: KnowledgeContext): Promise<number> {
    // Return 0-1 score for how applicable your knowledge is
    if (context.timeframe === '1d') return 0.8;
    return 0.3;
  }
  
  async getEnhancement(context: KnowledgeContext): Promise<KnowledgeEnhancement | null> {
    // Generate enhancement based on context
    return {
      id: `${this.id}_${Date.now()}`,
      source: this.id,
      confidence: 0.7,
      cryptoApplicability: 0.6,
      features: {
        custom_feature_1: 0.5,
        custom_feature_2: 0.8
      },
      parameterHints: {
        positionSizePercent: 40
      },
      timestamp: Date.now()
    };
  }
  
  // Implement other required methods...
}
```

## Best Practices

1. **Start with Mock Provider**: Test the system with the mock provider before adding real providers
2. **Monitor Performance**: Regularly review provider statistics to ensure value
3. **Gradual Rollout**: Start with low confidence thresholds and increase as you gain confidence
4. **Provider Diversity**: Use multiple providers for different market conditions
5. **Feedback Integration**: Ensure strategies provide performance feedback for continuous improvement

## Phased Implementation

### Phase 1: Testing (Current)
- Use MockKnowledgeProvider
- Set `enabled: false` in production
- Monitor telemetry in development

### Phase 2: Limited Production
- Enable for specific strategies
- Set conservative thresholds
- Monitor performance metrics

### Phase 3: Full Integration
- Enable globally
- Add real providers (Numerai, etc.)
- Optimize based on performance data

## Troubleshooting

### Knowledge Not Applied
1. Check if `knowledgeEnhancement.enabled = true`
2. Verify provider is in `enabledProviders` list
3. Check confidence/applicability thresholds
4. Review provider statistics for issues

### Poor Performance
1. Check provider statistics with `getProviderStats()`
2. Review telemetry for failed queries
3. Adjust confidence thresholds
4. Consider disabling specific providers

### High Latency
1. Check provider `simulatedLatencyMs` settings
2. Review cache hit rates
3. Consider reducing `maxProvidersPerQuery`

## Future Enhancements

1. **Numerai Integration**: Full implementation of Numerai dataset access
2. **Chainlink Oracles**: Real-time market data enhancement
3. **Custom ML Models**: Integrate proprietary models as providers
4. **Cross-Provider Learning**: Share insights between providers
5. **Multi-Objective Optimization**: Use knowledge for Pareto-optimal solutions 