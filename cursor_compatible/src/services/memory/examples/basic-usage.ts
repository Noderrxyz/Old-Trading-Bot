/**
 * Basic usage example for the Memory Graph system
 * 
 * This example demonstrates how to:
 * 1. Initialize the memory system
 * 2. Create and record memory nodes
 * 3. Query for relevant memories
 * 4. Maintain memory health through decay and compression
 */

import { createMemorySystem } from '../index.js';
import { RedisService } from '../../infrastructure/RedisService.js';
import { FusionFeedbackEvent } from '../../../types/memory.types.js';
import { v4 as uuidv4 } from 'uuid';

async function memoryGraphExample() {
  // 1. Initialize the memory system
  console.log('Initializing memory system...');
  const redisService = new RedisService({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  });
  
  const memory = createMemorySystem(redisService);
  const { memoryGraph, compressionEngine, memoryQuery } = memory;
  
  // Define agent and strategy IDs
  const agentId = 'agent-' + uuidv4().slice(0, 8);
  const strategyId = 'strategy-' + uuidv4().slice(0, 8);
  
  // 2. Create and record memory nodes
  console.log('Creating memory nodes...');
  
  // Create a sequence of related events
  const events: FusionFeedbackEvent[] = [
    // Initial trust event
    {
      id: uuidv4(),
      agentId,
      strategyId,
      timestamp: Date.now() - (3 * 24 * 60 * 60 * 1000), // 3 days ago
      eventType: 'trust',
      score: 0.7,
      contextTags: ['market:bull', 'asset:bitcoin', 'volatility:low'],
    },
    
    // Reinforcement event after using strategy
    {
      id: uuidv4(),
      agentId,
      strategyId,
      timestamp: Date.now() - (2 * 24 * 60 * 60 * 1000), // 2 days ago
      eventType: 'reinforcement',
      score: 0.8,
      contextTags: ['market:bull', 'asset:bitcoin', 'performance:good'],
    },
    
    // Minor regret event
    {
      id: uuidv4(),
      agentId,
      strategyId,
      timestamp: Date.now() - (1 * 24 * 60 * 60 * 1000), // 1 day ago
      eventType: 'regret',
      score: 0.2,
      contextTags: ['market:bull', 'asset:bitcoin', 'volatility:high'],
    },
    
    // New trust event after adapting
    {
      id: uuidv4(),
      agentId,
      strategyId,
      timestamp: Date.now() - (6 * 60 * 60 * 1000), // 6 hours ago
      eventType: 'trust',
      score: 0.85,
      contextTags: ['market:bull', 'asset:bitcoin', 'volatility:high', 'adapting:true'],
    }
  ];
  
  // Add events to memory and link them in sequence
  let previousEventId = null;
  for (const event of events) {
    if (previousEventId) {
      event.parentEventId = previousEventId;
    }
    
    const nodeId = await memoryGraph.addNode(event);
    console.log(`Added node: ${nodeId}`);
    previousEventId = nodeId;
  }
  
  // 3. Query for memories
  console.log('\nQuerying memories...');
  
  // Check if agent has tried a context
  const hasTried = await memoryQuery.hasAgentTriedContext(
    agentId,
    ['market:bull', 'asset:bitcoin']
  );
  console.log(`Has agent tried this context? ${hasTried}`);
  
  // Find similar contexts
  const similarContexts = await memoryQuery.findSimilarContexts(
    agentId,
    ['market:bull', 'asset:bitcoin', 'volatility:high']
  );
  console.log(`Found ${similarContexts.length} similar contexts`);
  
  // Get best strategy for a context
  const bestStrategy = await memoryQuery.findBestStrategyForContext(
    agentId,
    ['market:bull', 'asset:bitcoin']
  );
  console.log(`Best strategy: ${bestStrategy.strategyId} (confidence: ${bestStrategy.confidence.toFixed(2)})`);
  
  // Get most trusted path
  const trustedPath = await memoryQuery.getMostTrustedStrategyPath(agentId);
  console.log(`Most trusted path has ${trustedPath.nodes.length} nodes`);
  console.log(`Total trust score: ${trustedPath.totalTrust.toFixed(2)}`);
  
  // Analyze memory patterns
  const patterns = await memoryQuery.analyzeMemoryPatterns(agentId);
  console.log('Memory patterns:');
  console.log(`- Frequent tags: ${patterns.frequentContextTags.map(t => t.tag).join(', ')}`);
  console.log(`- Top strategies: ${patterns.topStrategies.length}`);
  
  // 4. Maintain memory health
  console.log('\nMaintaining memory health...');
  
  // Apply decay to reduce importance of older memories
  const decayed = await memoryGraph.decayOldPaths(agentId);
  console.log(`Decayed ${decayed} nodes`);
  
  // Compress memory graph
  const compression = await compressionEngine.compressAgentMemory(agentId);
  console.log('Compression results:');
  console.log(`- Analyzed: ${compression.nodesAnalyzed} nodes`);
  console.log(`- Merged: ${compression.nodesMerged} nodes`);
  console.log(`- Pruned: ${compression.nodesPruned} nodes`);
  console.log(`- Promoted: ${compression.nodesPromoted} nodes`);
  
  // Clean up for the example
  console.log('\nCleaning up...');
  const cleared = await memoryGraph.clearAgentMemory(agentId);
  console.log(`Cleared ${cleared} memory nodes`);
  
  console.log('\nExample completed');
}

// Run the example
memoryGraphExample().catch(error => {
  console.error('Error in memory graph example:', error);
}); 