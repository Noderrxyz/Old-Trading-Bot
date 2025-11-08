/**
 * Meta-Agent Services
 * 
 * Entry point for meta-agent services.
 */

// Export the new refactored reward system from the rewards directory
export { MetaRewardEngine } from './rewards/MetaRewardEngine.js';
export { RewardPropagator } from './rewards/RewardPropagator.js';
export { RewardStorage } from './rewards/RewardStorage.js';
export { VerificationService } from './rewards/VerificationService.js';
export { RewardEligibility } from './rewards/RewardEligibility.js';
export { RewardProcessor } from './rewards/RewardProcessor.js';

// Export types
export type {
  RewardEvent,
  VerificationStatus,
  VerificationVote,
  VerificationRequest,
  PropagationConfig,
  RewardGrantParams,
  VerificationVoteParams,
  IRewardStorage,
  IVerificationService,
  IRewardProcessor,
  IRewardEligibility,
  IRewardPropagator
} from './rewards/types.js';

// Continue to export other services
export { ReinforcementLog, type ReinforcementEvent } from './ReinforcementLog.js';
export { InfluenceGraph } from './InfluenceGraph.js';
export { ReinforcementAnalyzer } from './ReinforcementAnalyzer.js';
export { RegretScorerEngine } from './RegretScorerEngine.js';
export { MemoryReplaySimulator } from './MemoryReplaySimulator.js';
export { StrategyManager } from './StrategyManager.js';
export { MemoryManager } from './MemoryManager.js';
export { StrategyLifecycleManager } from './StrategyLifecycleManager.js';
export { AgentReinforcementService } from './AgentReinforcementService.js'; 