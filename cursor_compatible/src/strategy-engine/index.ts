/**
 * Strategy Engine Module
 * 
 * Main entry point for the strategy engine module, which includes
 * decay detection, attribution monitoring, performance tracking,
 * and strategy lifecycle management.
 */

// Export strategy lifecycle manager
export { 
  LifecycleManager,
  RotationMode,
  RotationAction,
  RotationAnalysis
} from './lifecycleManager.js';

// Export decay detection components
export {
  DecayScorer,
  DecayFlag,
  DecayResult,
  DecayConfig,
  StrategyMetrics
} from './decay/decayScorer.js';

// Export attribution monitoring components
export {
  AttributionMonitor,
  FeatureAttribution,
  AttributionSnapshot,
  AttributionDecayAnalysis
} from './decay/attributionMonitor.js';

// Export performance tracking components
export {
  PerformanceTracker,
  TimeWindow,
  PerformanceMetrics,
  TradeResult,
  PerformanceSnapshot
} from './decay/performanceTracker.js';

// Export decay events components
export {
  DecayEventManager,
  DecayEventType,
  DecayEvent
} from './decay/decayEvents.js'; 