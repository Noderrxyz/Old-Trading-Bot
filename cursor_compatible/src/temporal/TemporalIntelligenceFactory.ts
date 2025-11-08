/**
 * Temporal Intelligence Factory
 * 
 * Creates and configures the temporal intelligence system components.
 */

import { FusionMemory } from '../fusion/FusionMemory.js';
import { MicrostructureAnalyzer } from '../infra/marketdata/MicrostructureAnalyzer.js';
import { ExecutionRouter } from '../infra/execution/ExecutionRouter.js';
import { AlphaAgent } from '../strategy/AlphaAgent.js';
import { TemporalIntelligenceModule, TemporalIntelligenceConfig } from './TemporalIntelligenceModule.js';

/**
 * Factory for creating and wiring temporal intelligence components
 */
export class TemporalIntelligenceFactory {
  /**
   * Create a new temporal intelligence module
   * @param fusionMemory Fusion memory system
   * @param microAnalyzer Microstructure analyzer
   * @param config Optional configuration
   * @returns Configured temporal intelligence module
   */
  static createModule(
    fusionMemory: FusionMemory,
    microAnalyzer: MicrostructureAnalyzer,
    config?: Partial<TemporalIntelligenceConfig>
  ): TemporalIntelligenceModule {
    // Create module with default or custom config
    const fullConfig: TemporalIntelligenceConfig = {
      collectionIntervalMs: config?.collectionIntervalMs || 60 * 60 * 1000,
      maxMetricsAgeMs: config?.maxMetricsAgeMs || 30 * 24 * 60 * 60 * 1000,
      trackedAssets: config?.trackedAssets || [],
      enableAdaptation: config?.enableAdaptation !== undefined ? config.enableAdaptation : true
    };
    
    return new TemporalIntelligenceModule(fusionMemory, microAnalyzer, fullConfig);
  }
  
  /**
   * Wire the temporal intelligence module to alpha agents
   * @param module Temporal intelligence module
   * @param agents Alpha agents to wire
   */
  static wireToAlphaAgents(
    module: TemporalIntelligenceModule,
    agents: AlphaAgent[]
  ): void {
    // Add all agent assets to tracking
    for (const agent of agents) {
      for (const asset of agent.getAssets()) {
        module.addTrackedAsset(asset);
      }
    }
    
    console.log(`Wired temporal intelligence to ${agents.length} alpha agents`);
  }
  
  /**
   * Wire the temporal intelligence module to execution routers
   * @param module Temporal intelligence module
   * @param routers Execution routers to wire
   */
  static wireToExecutionRouters(
    module: TemporalIntelligenceModule,
    routers: ExecutionRouter[]
  ): void {
    // No additional setup needed as routers will access the risk model directly
    console.log(`Wired temporal intelligence to ${routers.length} execution routers`);
  }
  
  /**
   * Create a complete temporal intelligence system
   * @param fusionMemory Fusion memory system
   * @param microAnalyzer Microstructure analyzer
   * @param agents Alpha agents to wire
   * @param routers Execution routers to wire
   * @param config Optional configuration
   * @returns Configured and wired temporal intelligence module
   */
  static createAndWireSystem(
    fusionMemory: FusionMemory,
    microAnalyzer: MicrostructureAnalyzer,
    agents: AlphaAgent[],
    routers: ExecutionRouter[],
    config?: Partial<TemporalIntelligenceConfig>
  ): TemporalIntelligenceModule {
    // Create the module
    const module = this.createModule(fusionMemory, microAnalyzer, config);
    
    // Wire to components
    this.wireToAlphaAgents(module, agents);
    this.wireToExecutionRouters(module, routers);
    
    // Start the module
    module.start();
    
    return module;
  }
} 