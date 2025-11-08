/**
 * Example usage of ReinforcementLog and InfluenceGraph
 * 
 * This file demonstrates how to use the reinforcement log and influence graph
 * to track agent-to-agent interactions and analyze influence patterns.
 */

import { ReinforcementLog } from '../services/meta-agent/ReinforcementLog.js';
import { InfluenceGraph } from '../services/meta-agent/InfluenceGraph.js';
import Logger from '../utils/Logger.js';

const logger = Logger.getInstance('ReinforcementExample');

// Create a new reinforcement log
const log = new ReinforcementLog();

// Record some reinforcement events
const event1 = log.record({
  sourceAgent: 'agent.predictor',
  targetAgent: 'agent.executor',
  reason: 'helpful signal accuracy',
  weight: 0.8,
  decayTTL: 1000 * 60 * 60 * 24 * 7, // 1 week
  tags: ['accuracy', 'signal']
});

const event2 = log.record({
  sourceAgent: 'agent.validator',
  targetAgent: 'agent.predictor',
  reason: 'model improvement suggestion',
  weight: 0.5,
  decayTTL: 1000 * 60 * 60 * 24 * 3, // 3 days
  tags: ['model', 'improvement']
});

const event3 = log.record({
  sourceAgent: 'agent.executor',
  targetAgent: 'agent.validator',
  reason: 'verification quality',
  weight: 0.3,
  decayTTL: 1000 * 60 * 60 * 24 * 5, // 5 days
  tags: ['verification', 'quality']
});

// Log all recorded events
logger.info(`Recorded ${log.getAll().length} reinforcement events`);
log.getAll().forEach((event, index) => {
  logger.info(`Event ${index + 1}: ${event.sourceAgent} -> ${event.targetAgent} (${event.reason})`);
});

// Filter events by agent
const predictorEvents = log.getByAgent('agent.predictor');
logger.info(`Events related to predictor agent: ${predictorEvents.length}`);

// Filter events by tags
const accuracyEvents = log.getByTags(['accuracy']);
logger.info(`Events related to accuracy: ${accuracyEvents.length}`);

// Convert to influence graph and analyze
const graph = log.toGraph();
logger.info(`Graph contains ${graph.getNodes().length} nodes and ${graph.getEdges().length} edges`);

// Calculate influence for agents
graph.getNodes().forEach(agentId => {
  const incoming = graph.getIncomingInfluenceTotal(agentId);
  const outgoing = graph.getOutgoingInfluenceTotal(agentId);
  logger.info(`Agent ${agentId}: incoming influence ${incoming.toFixed(2)}, outgoing influence ${outgoing.toFixed(2)}`);
});

// Check for circular influence patterns
const hasCircular = graph.hasCircularInfluence();
logger.info(`Graph contains circular influence: ${hasCircular}`);

// Create a complete graph representation
const adjacencyMap = graph.asAdjacencyMap();
logger.info('Adjacency Map:');
Object.keys(adjacencyMap).forEach(from => {
  logger.info(`${from} -> ${adjacencyMap[from].map(edge => edge.to).join(', ')}`);
});

/**
 * Example: Using with MetaRewardEngine
 * 
 * The ReinforcementLog would typically be integrated with MetaRewardEngine:
 * 
 * ```
 * // Initialize services
 * const redisService = new RedisService();
 * const eventEmitter = new EventEmitter();
 * const trustScoreService = new TrustScoreService();
 * const influenceService = new AgentInfluenceService();
 * const reinforcementLog = new ReinforcementLog();
 * 
 * // Initialize reward engine with reinforcement log
 * const rewardEngine = new MetaRewardEngine(
 *   redisService,
 *   eventEmitter,
 *   trustScoreService,
 *   influenceService,
 *   reinforcementLog
 * );
 * 
 * // Later, retrieve the reinforcement graph for analysis
 * const graph = rewardEngine.getReinforcementLog().toGraph();
 * 
 * // Detect potential manipulation patterns
 * if (graph.hasCircularInfluence()) {
 *   logger.warn('Circular influence patterns detected, potential collusion');
 * }
 * ```
 */ 