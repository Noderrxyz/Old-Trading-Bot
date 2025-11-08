/**
 * Trading Agent System Exports
 * 
 * This file exports all the necessary components for working with the trading agent system.
 */

// Base classes and interfaces
export { TradingAgent, Signal, Order, Position, MarketData, AgentInitOptions } from './base/TradingAgent.js';
export { 
  AgentContext, 
  AgentLifecycleState, 
  RiskProfile, 
  DEFAULT_RISK_PROFILE,
  MarketScope, 
  DEFAULT_MARKET_SCOPE,
  ExecutionConfig, 
  DEFAULT_EXECUTION_CONFIG,
  AgentMetrics
} from './base/AgentContext.js';

// Agent registry and engine
export { AgentRegistry, AgentRegistration } from './agentRegistry.js';
export { 
  AgentEngine, 
  AgentFactory, 
  AgentSpawnOptions, 
  ExecutionRequest
} from './AgentEngine.js';

// Implementations
export { MeanReversionAgent, MeanReversionConfig, MeanReversionAgentFactory } from './implementations/meanReversionV3.js';
export { MomentumAgent, MomentumConfig, MomentumAgentFactory } from './implementations/momentumAgent.js';

// Examples
export { runExample as runMomentumExample } from './examples/momentumAgentExample.js';

// Evolution Engine
export * from './evolution/index.js';
export { createEvolutionEngine } from './evolution/index.js';
export { DEFAULT_MUTATIONS, loadDefaultMutations } from './evolution/defaultMutations.js'; 