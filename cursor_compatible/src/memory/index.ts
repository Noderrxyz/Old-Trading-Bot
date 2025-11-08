// Export memory management types and classes
export {
  SharedMemoryManagerRust,
  BufferType,
  BufferConfig,
  DEFAULT_BUFFER_CONFIG
} from './SharedMemoryManagerRust';

export { SharedMemoryManagerJs } from './SharedMemoryManagerJs';
export { BatchProcessorJs } from './BatchProcessorJs';
export { BatchProcessorRust } from './BatchProcessorRust';

// Import for singleton instance creation
import { SharedMemoryManagerRust } from './SharedMemoryManagerRust';
import { SharedMemoryManagerJs } from './SharedMemoryManagerJs';
import { BatchProcessorRust } from './BatchProcessorRust';

// Create singleton instances
const sharedMemoryManager = SharedMemoryManagerRust.getInstance();
const sharedMemoryManagerJs = SharedMemoryManagerJs.getInstance();
const batchProcessor = BatchProcessorRust.getInstance(sharedMemoryManagerJs);

// Export singleton instances
export { sharedMemoryManager, sharedMemoryManagerJs, batchProcessor }; 