/**
 * Momentum Agent Example
 * 
 * This example demonstrates how to set up and use the Momentum Agent.
 */

import { AgentEngine } from '../AgentEngine.js';
import { MomentumAgentFactory } from '../implementations/momentumAgent.js';
import { RiskProfile, MarketScope, ExecutionConfig } from '../base/AgentContext.js';
import { createLogger } from '../../common/logger.js';

// Create a logger
const logger = createLogger('MomentumExample');

// Mock Redis client for this example
const mockRedis = {
  get: async (key: string) => null,
  set: async (key: string, value: string) => true,
  lpush: async (key: string, value: string) => 1,
  ltrim: async (key: string, start: number, end: number) => true,
  xadd: async (key: string, id: string, fields: Record<string, string>) => '123-0'
};

// Initialize agent engine
const agentEngine = new AgentEngine(mockRedis as any);

// Register the Momentum agent factory
agentEngine.registerAgentFactory(new MomentumAgentFactory());

async function runExample() {
  try {
    // Initialize the engine
    await agentEngine.initialize();
    
    // Define custom risk profile
    const riskProfile: Partial<RiskProfile> = {
      maxDrawdownPct: 5,        // 5% max drawdown
      maxLeverage: 1.0,         // No leverage
      maxPositionSizePct: 15,   // Max 15% of capital per position
      allowShort: true,         // Allow short selling
      applyRiskNormalization: true,
      minTimeBetweenTrades: 300000, // 5 minutes
      maxDailyTradeCount: 5     // Max 5 trades per day
    };
    
    // Define market scope
    const marketScope: Partial<MarketScope> = {
      tradableAssets: ['BTC/USD', 'ETH/USD'],
      minLiquidityUsd: 500000,  // $500k
      maxSpreadBps: 10          // 0.1%
    };
    
    // Define execution config
    const executionConfig: Partial<ExecutionConfig> = {
      executionMode: 'normal',
      defaultOrderType: 'limit',
      maxSlippageBps: 5,        // 0.05%
      orderTtlMs: 60000,        // 1 minute
      useRetryLogic: true,
      canaryMode: false
    };
    
    // Define momentum strategy parameters
    const momentumConfig = {
      emaPeriod: 14,            // 14-period EMA
      rocPeriod: 10,            // 10-period Rate of Change
      entryThreshold: 1.5,      // Enter on 1.5% momentum
      exitThreshold: 0.7,       // Exit on 0.7% counter-momentum
      positionSizePercent: 10,  // Use 10% of available capital
      stopLossPercent: 2.5,     // 2.5% stop loss
      takeProfitPercent: 5.0,   // 5% take profit
      maxHoldingPeriodMs: 3 * 24 * 60 * 60 * 1000 // 3 days max
    };
    
    // Spawn a momentum agent
    const agent = await agentEngine.spawnAgent({
      agentId: 'momentum-btc-1',
      agentType: 'momentum_v1',
      riskProfile,
      marketScope,
      executionConfig,
      config: momentumConfig,
      signalSource: 'internal',
      enabled: true
    });
    
    logger.info(`Spawned agent: ${agent.agentId}`);
    
    // Start the agent engine
    agentEngine.start();
    
    // Simulate some market data
    const mockMarketData = {
      asset: 'BTC/USD',
      price: {
        bid: 50000,
        ask: 50050,
        last: 50025,
        mid: 50025
      },
      stats: {
        volume: 1000,
        volumeUsd: 50025000,
        high: 51000,
        low: 49000,
        priceChange: 500,
        priceChangePct: 1.0
      },
      liquidity: {
        bps10: 100,
        bps50: 500,
        bps100: 1000
      },
      volatility: {
        hourly: 0.005,
        daily: 0.02
      },
      timestamp: Date.now()
    };
    
    // Process market data multiple times with increasing price to create uptrend
    for (let i = 0; i < 30; i++) {
      const changePercent = 0.2 * (i < 15 ? 1 : -1); // Up trend then down trend
      
      mockMarketData.price.bid *= (1 + changePercent / 100);
      mockMarketData.price.ask *= (1 + changePercent / 100);
      mockMarketData.price.last *= (1 + changePercent / 100);
      mockMarketData.price.mid *= (1 + changePercent / 100);
      mockMarketData.timestamp = Date.now();
      
      // Update the agent with the new market data
      await agent.processUpdate(mockMarketData);
      
      // Simulate time passing
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Stop the agent engine
    agentEngine.stop();
    
    logger.info(`Agent metrics: ${JSON.stringify(agent.agentMetrics, null, 2)}`);
    
  } catch (error) {
    logger.error(`Error running example: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Run the example automatically when the module is loaded
runExample().catch(error => {
  logger.error(`Unhandled error: ${error instanceof Error ? error.message : String(error)}`);
  // In a browser environment, we don't call process.exit
});

export { runExample }; 