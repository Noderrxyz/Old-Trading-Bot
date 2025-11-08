/**
 * Evolution Engine Example
 * 
 * Demonstrates how to set up and use the Multi-Agent Adaptation and
 * Evolution Engine to allow agents to self-optimize.
 */

import { RedisClient } from '../../common/redis.js';
import { AgentRegistry } from '../agentRegistry.js';
import { MomentumAgentFactory } from '../implementations/momentumAgent.js';
import { AgentEngine } from '../AgentEngine.js';
import { createEvolutionEngine, loadDefaultMutations } from '../evolution/index.js';
import { TrustScoreEngine } from '../../strategy-engine/index.js';

/**
 * Run the evolution engine example
 */
export async function runExample(): Promise<void> {
  console.log('🧬 Starting Evolution Engine Example');
  
  // Initialize Redis client
  const redis = new RedisClient();
  await redis.connect();
  console.log('✅ Connected to Redis');
  
  // Create Agent Registry
  const agentRegistry = new AgentRegistry(redis);
  await agentRegistry.initialize();
  console.log('✅ Initialized Agent Registry');
  
  // Create Agent Engine with Momentum Agent Factory
  const momentumFactory = new MomentumAgentFactory();
  const agentEngine = new AgentEngine(redis, agentRegistry);
  agentEngine.registerAgentFactory('momentum', momentumFactory);
  console.log('✅ Created Agent Engine');
  
  // Create Trust Score Engine (mock implementation for example)
  const trustScoreEngine = new TrustScoreEngine();
  console.log('✅ Created Trust Score Engine');
  
  // Create Evolution Engine components
  const evolution = createEvolutionEngine(redis, agentRegistry, trustScoreEngine);
  console.log('✅ Created Evolution Engine Components');
  
  // Initialize all components
  await Promise.all([
    evolution.fitnessScoring.initialize(),
    evolution.mutationRegistry.initialize(),
    evolution.votingSystem.initialize(),
    evolution.evolutionEngine.initialize()
  ]);
  console.log('✅ Initialized Evolution Engine');
  
  // Load default mutations
  await loadDefaultMutations(evolution.mutationRegistry);
  console.log('✅ Loaded Default Mutations');
  
  // Create and start some example agents
  const agentIds = [];
  
  for (let i = 0; i < 5; i++) {
    const response = await agentEngine.spawnAgent({
      agentType: 'momentum',
      signalSource: 'market-data',
      tradingPairs: ['BTC/USD', 'ETH/USD'],
      config: {
        lookbackPeriods: 14,
        signalThreshold: 0.5,
        riskFactor: 0.5 + (i * 0.1), // Vary risk factor across agents
      }
    });
    
    if (response.success) {
      agentIds.push(response.agentId!);
      console.log(`✅ Created agent: ${response.agentId}`);
    } else {
      console.error(`❌ Failed to create agent: ${response.message}`);
    }
  }
  
  // Calculate fitness scores for all agents
  await evolution.fitnessScoring.calculateAllAgentFitness();
  console.log('✅ Calculated Initial Fitness Scores');
  
  // Display fitness scores
  console.log('\n📊 Agent Fitness Scores:');
  const fitnessScores = evolution.fitnessScoring.getAllFitnessScores();
  
  for (const [agentId, fitness] of fitnessScores) {
    console.log(`  ${agentId}: ${fitness.fitnessScore.toFixed(4)} (PnL: ${fitness.pnl7d.toFixed(4)}, Hit Rate: ${fitness.strategyHitRate}%, Anomalies: ${fitness.anomalyCount})`);
  }
  
  // Start an evolution trial for the first agent
  if (agentIds.length > 0) {
    const agentId = agentIds[0];
    
    // Get all mutations
    const mutations = evolution.mutationRegistry.getAllMutations();
    const mutationIds = Array.from(mutations.keys());
    
    if (mutationIds.length > 0) {
      // Choose a mutation to apply
      const mutationId = mutationIds[0];
      const mutation = mutations.get(mutationId)!;
      
      console.log(`\n🧪 Starting Evolution Trial:`);
      console.log(`  Agent: ${agentId}`);
      console.log(`  Mutation: ${mutation.name} (${mutationId})`);
      
      // Start the trial
      const result = await evolution.evolutionEngine.startEvolutionTrial(agentId, mutationId);
      
      if (result.success) {
        console.log(`✅ Started trial ${result.trialId}`);
        
        // In a real application, you would wait for the trial to complete
        // and evaluate the results. For this example, we'll simulate the process.
        
        console.log('\n🔄 Trial In Progress...');
        console.log('  - Agent is running in canary evolution mode');
        console.log('  - Fitness metrics are being tracked');
        console.log('  - After the minimum trial duration, fitness will be compared');
        console.log('  - If fitness improved by the threshold, mutation will be promoted');
        
        // Print evolution trial loop process
        console.log('\n🔄 Evolution Trial Loop:');
        console.log('  1. Apply mutation in sandbox mode (DONE)');
        console.log('  2. Track fitness metrics side-by-side (IN PROGRESS)');
        console.log('  3. Compare to baseline variant after minimum duration');
        console.log('  4. Submit for vote if fitness improved');
        console.log('  5. If approved, promote mutation to production');
        console.log('  6. Otherwise, rollback and try different mutation');
      } else {
        console.error(`❌ Failed to start trial: ${result.message}`);
      }
    } else {
      console.log('\n⚠️ No mutations available to test');
    }
  }
  
  // Dashboard API example
  console.log('\n📊 Evolution Dashboard API:');
  console.log('  - Provides real-time data on evolution trials');
  console.log('  - Shows agent fitness rankings');
  console.log('  - Tracks mutation performance');
  console.log('  - Displays voting status');
  
  // Get dashboard data
  const dashboard = await evolution.dashboardAPI.getDashboardData();
  
  console.log(`\n📊 Dashboard Summary:`);
  console.log(`  Active Trials: ${dashboard.summary.activeTrialsCount}`);
  console.log(`  Completed Trials: ${dashboard.summary.completedTrialsCount}`);
  console.log(`  Promoted Mutations: ${dashboard.summary.promotedMutationsCount}`);
  console.log(`  Rejected Mutations: ${dashboard.summary.rejectedMutationsCount}`);
  console.log(`  Pending Votes: ${dashboard.summary.pendingVotesCount}`);
  
  console.log('\n🏁 Evolution Engine Example Complete');
  
  // Disconnect Redis
  await redis.disconnect();
}

/**
 * Run the example if file is executed directly
 */
if (process.argv[1].includes('evolutionEngineExample')) {
  runExample().catch(error => {
    console.error('Error running example:', error);
    process.exit(1);
  });
} 