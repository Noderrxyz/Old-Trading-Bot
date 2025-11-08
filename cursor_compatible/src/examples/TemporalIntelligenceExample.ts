/**
 * Temporal Intelligence Example
 * 
 * Demonstrates how to set up and use the temporal intelligence system.
 */

import { FusionMemory } from '../fusion/FusionMemory.js';
import { MicrostructureAnalyzer } from '../infra/marketdata/MicrostructureAnalyzer.js';
import { TrustEngine } from '../infra/risk/TrustEngine.js';
import { VenueRegistry, ExecutionVenue } from '../infra/venues/VenueRegistry.js';
import { ExecutionRouter } from '../infra/execution/ExecutionRouter.js';
import { AlphaAgent, AlphaAgentConfig } from '../strategy/AlphaAgent.js';
import { TemporalIntelligenceFactory } from '../temporal/TemporalIntelligenceFactory.js';

/**
 * Set up the temporal intelligence system
 */
async function setupTemporalIntelligence() {
  console.log('Setting up temporal intelligence system...');
  
  // Create core components
  const fusionMemory = new FusionMemory();
  
  // Create mock data source for microstructure analyzer
  const mockDataSource = {
    getMarketData: async () => ({
      // Mock market data
      topImbalance: 0.2,
      quoteVolatility: 0.15,
      spreadPressure: 0.01,
      sweepRisk: 0.3,
      spoofingScore: 0.1
    })
  };
  
  const microAnalyzer = new MicrostructureAnalyzer(mockDataSource as any);
  const trustEngine = new TrustEngine();
  const venueRegistry = new VenueRegistry();
  
  // Register sample venues
  const venue1: ExecutionVenue = {
    id: 'binance',
    name: 'Binance',
    type: 'cex',
    enabled: true,
    getSupportedAssets: async () => ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
    isAssetSupported: async (asset) => ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'].includes(asset),
    checkHealth: async () => true,
    getMarketData: async () => ({}),
    execute: async () => ({ /* mock executed order */ } as any),
    cancelOrder: async () => true,
    getOrderStatus: async () => ({}),
    enable: () => {},
    disable: () => {}
  };
  
  const venue2: ExecutionVenue = {
    id: 'coinbase',
    name: 'Coinbase',
    type: 'cex',
    enabled: true,
    getSupportedAssets: async () => ['BTC/USDT', 'ETH/USDT'],
    isAssetSupported: async (asset) => ['BTC/USDT', 'ETH/USDT'].includes(asset),
    checkHealth: async () => true,
    getMarketData: async () => ({}),
    execute: async () => ({ /* mock executed order */ } as any),
    cancelOrder: async () => true,
    getOrderStatus: async () => ({}),
    enable: () => {},
    disable: () => {}
  };
  
  venueRegistry.register(venue1);
  venueRegistry.register(venue2);
  
  // Define alpha agent configurations
  const agent1Config: AlphaAgentConfig = {
    id: 'momentum-1',
    name: 'Momentum Strategy',
    assets: ['BTC/USDT', 'ETH/USDT'],
    strategyType: 'momentum',
    defaultHorizon: 'swing',
    confidenceThreshold: 0.6,
    adaptToFeedback: true,
    adaptToTimeOfDay: true
  };
  
  const agent2Config: AlphaAgentConfig = {
    id: 'mean-rev-1',
    name: 'Mean Reversion Strategy',
    assets: ['ETH/USDT', 'SOL/USDT'],
    strategyType: 'mean-reversion',
    defaultHorizon: 'scalp',
    confidenceThreshold: 0.7,
    adaptToFeedback: true,
    adaptToTimeOfDay: true
  };
  
  // Create and wire temporal intelligence first, since agents need the risk model
  const temporalSystem = TemporalIntelligenceFactory.createModule(
    fusionMemory,
    microAnalyzer,
    {
      // Example custom config
      collectionIntervalMs: 30 * 60 * 1000, // 30 minutes
      trackedAssets: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT']
    }
  );
  
  // Now create agents with the risk model
  const riskModel = temporalSystem.getRiskModel();
  const agent1 = new AlphaAgent(agent1Config, fusionMemory, riskModel);
  const agent2 = new AlphaAgent(agent2Config, fusionMemory, riskModel);
  
  // Wire agents and routers to temporal system
  TemporalIntelligenceFactory.wireToAlphaAgents(temporalSystem, [agent1, agent2]);
  
  // Create execution router with temporal risk model
  const router = new ExecutionRouter(
    venueRegistry.getAll(),
    microAnalyzer,
    trustEngine,
    fusionMemory,
    riskModel
  );
  
  TemporalIntelligenceFactory.wireToExecutionRouters(temporalSystem, [router]);
  
  // Start the temporal system
  temporalSystem.start();
  
  // Start agents
  agent1.start();
  agent2.start();
  
  console.log('Temporal intelligence system set up successfully');
  
  // Example: Generate signals with time-of-day adaptation
  setTimeout(async () => {
    console.log('\nGenerating sample trading signals...');
    
    // These signals will be adjusted based on time-of-day patterns
    await agent1.generateSignal('BTC/USDT', 0.75, 'buy', 0.1);
    await agent2.generateSignal('ETH/USDT', 0.8, 'sell', 5);
    
    // Example: Get current time profile for an asset
    const btcProfile = await temporalSystem.getRiskModel().getCurrentHourProfile('BTC/USDT');
    console.log(`\nCurrent hour profile for BTC/USDT (hour ${btcProfile.hour}):`);
    console.log(`- Average volatility: ${btcProfile.avgVolatility}`);
    console.log(`- Average slippage: ${btcProfile.avgSlippage}`);
    console.log(`- Alpha decay rate: ${btcProfile.alphaDecayRate}`);
    console.log(`- Confidence adjustment: ${btcProfile.confidenceAdjustment}`);
    
    // Example: Route an order with time-of-day adaptation
    const routingResult = await router.route({
      asset: 'ETH/USDT',
      side: 'buy',
      quantity: 1.0,
      urgency: 'medium'
    });
    
    console.log('\nRouting result with time-of-day adaptation:');
    console.log(`- Selected venue: ${routingResult.venue}`);
    console.log(`- Recommended style: ${routingResult.recommendedStyle}`);
    console.log(`- Estimated slippage: ${routingResult.estimatedSlippageBps} bps`);
    console.log(`- Time-of-day adjusted: ${routingResult.metadata?.timeOfDayAdjusted}`);
    
    // Stop everything after demo
    setTimeout(() => {
      temporalSystem.stop();
      console.log('\nTemporal intelligence system stopped');
    }, 2000);
  }, 1000);
}

// Run the example
setupTemporalIntelligence().catch(error => {
  console.error('Error in temporal intelligence example:', error);
}); 