/**
 * Integration tests for the Memory system
 * Shows how MemoryGraph, CompressionEngine, and MemoryQuery work together
 */

import { createMemorySystem } from '../index.js';
import { FusionFeedbackEvent } from '../../../types/memory.types.js';
import { v4 as uuidv4 } from 'uuid';

// Mock RedisService
const mockRedisService = {
  setex: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  expire: jest.fn(),
  sadd: jest.fn(),
  srem: jest.fn(),
  smembers: jest.fn(),
  publish: jest.fn(),
};

describe('Memory System Integration', () => {
  // Store created nodes for testing
  const createdNodes: Record<string, any> = {};
  
  // Mock implementations to simulate basic Redis functionality
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Clear stored nodes
    Object.keys(createdNodes).forEach(key => delete createdNodes[key]);
    
    // Mock setex to store nodes
    mockRedisService.setex.mockImplementation((key: string, ttl: number, json: string) => {
      // Extract nodeId from key (e.g., agent:memory:node:abc123)
      const nodeId = key.split(':').pop() || '';
      createdNodes[nodeId] = JSON.parse(json);
      return Promise.resolve('OK');
    });
    
    // Mock get to retrieve nodes
    mockRedisService.get.mockImplementation((key: string) => {
      // Extract nodeId from key
      const nodeId = key.split(':').pop() || '';
      const node = createdNodes[nodeId];
      return Promise.resolve(node ? JSON.stringify(node) : null);
    });
    
    // Mock smembers to return all node IDs for an agent
    mockRedisService.smembers.mockImplementation((key: string) => {
      // Extract agentId from key (e.g., agent:memory:agent:agent123:nodes)
      const agentId = key.split(':')[3] || '';
      const nodeIds = Object.keys(createdNodes).filter(
        nodeId => createdNodes[nodeId].agentId === agentId
      );
      return Promise.resolve(nodeIds);
    });
    
    // Other mocks
    mockRedisService.sadd.mockResolvedValue(1);
    mockRedisService.expire.mockResolvedValue(1);
    mockRedisService.del.mockImplementation((key: string) => {
      const nodeId = key.split(':').pop() || '';
      if (createdNodes[nodeId]) {
        delete createdNodes[nodeId];
        return Promise.resolve(1);
      }
      return Promise.resolve(0);
    });
    mockRedisService.srem.mockResolvedValue(1);
  });
  
  it('should track and analyze agent memory across multiple events', async () => {
    // Create the memory system
    const memory = createMemorySystem(mockRedisService as any, {
      // Increase decay rate for testing
      memoryDecayRate: 0.9
    });
    
    const agentId = 'test-agent-' + uuidv4().slice(0, 8);
    const strategyId = 'test-strategy-' + uuidv4().slice(0, 8);
    
    // 1. Create some events for the agent
    const event1: FusionFeedbackEvent = {
      id: uuidv4(),
      agentId,
      strategyId,
      timestamp: Date.now() - 24 * 60 * 60 * 1000, // 1 day ago
      eventType: 'trust',
      score: 0.7,
      contextTags: ['market:bull', 'asset:bitcoin', 'volatility:low'],
    };
    
    const event2: FusionFeedbackEvent = {
      id: uuidv4(),
      agentId,
      strategyId,
      timestamp: Date.now() - 12 * 60 * 60 * 1000, // 12 hours ago
      eventType: 'reinforcement',
      score: 0.8,
      contextTags: ['market:bull', 'asset:bitcoin', 'performance:good'],
      parentEventId: event1.id,
    };
    
    const event3: FusionFeedbackEvent = {
      id: uuidv4(),
      agentId,
      strategyId,
      timestamp: Date.now() - 6 * 60 * 60 * 1000, // 6 hours ago
      eventType: 'regret',
      score: 0.2,
      contextTags: ['market:bull', 'asset:bitcoin', 'volatility:high'],
      parentEventId: event2.id,
    };
    
    // 2. Add events to memory graph
    await memory.memoryGraph.addNode(event1);
    await memory.memoryGraph.addNode(event2);
    await memory.memoryGraph.addNode(event3);
    
    // 3. Test MemoryGraph functionality
    const nodes = await memory.memoryGraph.getAgentNodes(agentId);
    expect(nodes.length).toBe(3);
    
    const context = await memory.memoryGraph.getContext(agentId, strategyId);
    expect(context.length).toBe(3);
    
    // 4. Test querying capabilities
    const hasTried = await memory.memoryQuery.hasAgentTriedContext(
      agentId,
      ['market:bull', 'asset:bitcoin']
    );
    expect(hasTried).toBe(true);
    
    const similarContexts = await memory.memoryQuery.findSimilarContexts(
      agentId,
      ['market:bull', 'asset:bitcoin', 'volatility:high']
    );
    expect(similarContexts.length).toBeGreaterThan(0);
    
    const successfulStrategies = await memory.memoryQuery.findSuccessfulStrategies(
      agentId,
      ['market:bull', 'asset:bitcoin']
    );
    expect(successfulStrategies.length).toBeGreaterThan(0);
    expect(successfulStrategies[0].strategyId).toBe(strategyId);
    
    // 5. Test compression
    const compressionStats = await memory.compressionEngine.compressAgentMemory(agentId);
    expect(compressionStats.nodesAnalyzed).toBe(3);
    
    // 6. Test memory path retrieval
    const mostTrustedPath = await memory.memoryQuery.getMostTrustedStrategyPath(agentId);
    expect(mostTrustedPath.nodes.length).toBeGreaterThan(0);
    
    // 7. Test memory pattern analysis
    const patterns = await memory.memoryQuery.analyzeMemoryPatterns(agentId);
    expect(patterns.frequentContextTags.length).toBeGreaterThan(0);
    expect(patterns.topStrategies.length).toBeGreaterThan(0);
    
    // 8. Test path decay
    const decayedCount = await memory.memoryGraph.decayOldPaths(agentId);
    expect(decayedCount).toBeGreaterThan(0);
  });
  
  it('should demonstrate finding best strategy based on historical performance', async () => {
    // Create the memory system
    const memory = createMemorySystem(mockRedisService as any);
    
    const agentId = 'test-agent-' + uuidv4().slice(0, 8);
    const strategy1Id = 'strategy-a-' + uuidv4().slice(0, 8);
    const strategy2Id = 'strategy-b-' + uuidv4().slice(0, 8);
    
    // Create events for different strategies
    // Strategy 1: Good performance
    const events1: FusionFeedbackEvent[] = [
      {
        id: uuidv4(),
        agentId,
        strategyId: strategy1Id,
        timestamp: Date.now() - 48 * 60 * 60 * 1000,
        eventType: 'trust',
        score: 0.9,
        contextTags: ['market:volatile', 'asset:ethereum', 'trend:sideways'],
      },
      {
        id: uuidv4(),
        agentId,
        strategyId: strategy1Id,
        timestamp: Date.now() - 24 * 60 * 60 * 1000,
        eventType: 'reinforcement',
        score: 0.85,
        contextTags: ['market:volatile', 'asset:ethereum', 'trend:sideways'],
      }
    ];
    
    // Strategy 2: Poor performance
    const events2: FusionFeedbackEvent[] = [
      {
        id: uuidv4(),
        agentId,
        strategyId: strategy2Id,
        timestamp: Date.now() - 48 * 60 * 60 * 1000,
        eventType: 'trust',
        score: 0.6,
        contextTags: ['market:volatile', 'asset:ethereum', 'trend:sideways'],
      },
      {
        id: uuidv4(),
        agentId,
        strategyId: strategy2Id,
        timestamp: Date.now() - 24 * 60 * 60 * 1000,
        eventType: 'regret',
        score: 0.5,
        contextTags: ['market:volatile', 'asset:ethereum', 'trend:sideways'],
      }
    ];
    
    // Add all events
    for (const event of [...events1, ...events2]) {
      await memory.memoryGraph.addNode(event);
    }
    
    // Query for the best strategy
    const bestStrategy = await memory.memoryQuery.findBestStrategyForContext(
      agentId,
      ['market:volatile', 'asset:ethereum']
    );
    
    // Strategy 1 should be recommended
    expect(bestStrategy.strategyId).toBe(strategy1Id);
    expect(bestStrategy.confidence).toBeGreaterThan(0.5);
    
    // Alternate context should return null
    const unrelatedContext = await memory.memoryQuery.findBestStrategyForContext(
      agentId,
      ['market:bull', 'asset:bitcoin'] // Completely different context
    );
    
    expect(unrelatedContext.strategyId).toBeNull();
    expect(unrelatedContext.confidence).toBe(0);
  });
}); 