# Agent Memory Graph System

The Agent Memory Graph system provides persistent, evolving memory capabilities for agents, capturing historical interactions, decisions, trust events, and reinforcement signals in a compressed knowledge graph. This system enables agents to recall prior strategy outcomes in context, weigh historical decisions during planning, adapt to long-term behavior shifts, and compress redundant or outdated feedback through memory decay.

## Core Architecture

The Memory Graph system consists of three primary components:

1. **MemoryGraph**: Core node/edge storage and mutation logic
2. **CompressionEngine**: Graph pruning, node merging, and long-term structure management
3. **MemoryQuery**: Advanced querying utilities for historical tracing and lookup

### Key Concepts

- **MemoryGraphNode**: Represents a snapshot of agent knowledge at a specific moment
- **Memory Path**: A connected series of nodes forming a decision lineage
- **Context Tags**: Metadata applied to nodes for semantic matching
- **Memory Decay**: Gradual reduction in importance of older memories
- **Compression**: Merging similar nodes to create condensed representations

## Usage

### Creating the Memory System

```typescript
import { createMemorySystem } from './services/memory';
import { RedisService } from './services/infrastructure/RedisService';

// Initialize Redis service
const redisService = new RedisService(/* config */);

// Create memory system
const memory = createMemorySystem(redisService);

// Access individual components
const { memoryGraph, compressionEngine, memoryQuery } = memory;
```

### Recording Agent Experiences

```typescript
// Create a feedback event
const event = {
  id: 'event-123',
  agentId: 'agent-456',
  strategyId: 'strategy-789',
  timestamp: Date.now(),
  eventType: 'trust',
  score: 0.85,
  contextTags: ['market:bull', 'asset:bitcoin', 'volatility:low'],
};

// Add to memory graph
await memoryGraph.addNode(event);

// Link to previous event
await memoryGraph.linkNodes('previous-event-id', 'event-123');
```

### Querying Agent Memory

```typescript
// Check if agent has tried a context
const hasTried = await memoryQuery.hasAgentTriedContext(
  'agent-456',
  ['market:bull', 'asset:bitcoin']
);

// Find best strategy for a context
const bestStrategy = await memoryQuery.findBestStrategyForContext(
  'agent-456',
  ['market:volatile', 'asset:ethereum']
);

// Analyze memory patterns
const patterns = await memoryQuery.analyzeMemoryPatterns('agent-456');
```

### Maintaining Memory Health

```typescript
// Apply time-based decay to reduce importance of old memories
await memoryGraph.decayOldPaths('agent-456');

// Compress memory graph to reduce redundancy
await compressionEngine.compressAgentMemory('agent-456');
```

## Integration with Existing Systems

The Memory Graph system integrates with:

- **Trust Score System**: Records trust events and integrates with trust score calculation
- **Regret Buffer**: Records regret events for strategy decisions
- **Reinforcement Learning**: Captures reinforcement signals for strategy adaptation
- **Strategy Selection**: Provides historical context for deciding between strategies

## Implementation Notes

- Uses Redis for persistence with TTL-based expiry
- Configurable memory decay rates (default: ~0.2% per day)
- Automatically prunes and compresses memory when appropriate
- Handles parent-child relationships for tracking strategy lineage
- Provides similarity-based matching for finding relevant historical experiences 