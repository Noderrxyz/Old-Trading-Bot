/**
 * Evolution Memory Injection System
 * 
 * Exports memory injection components for post-evolution learning.
 */

// Core interfaces
export { 
  StrategyMemoryEntry, 
  StrategyLearning, 
  MemoryInjectorConfig 
} from './MemoryInjector.js';

// Memory injector
export { MemoryInjector } from './MemoryInjector.js';

// Memory controller
export { 
  MemoryInjectionController, 
  MemoryInjectionControllerConfig 
} from './MemoryInjectionController.js';

// Memory service adapter
export { 
  AgentMemoryServiceAdapter,
  MemoryServiceAdapterConfig
} from './AgentMemoryServiceAdapter.js'; 