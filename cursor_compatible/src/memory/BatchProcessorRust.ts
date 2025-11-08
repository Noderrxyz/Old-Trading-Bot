import { BatchProcessorJs } from './BatchProcessorJs';
import { SharedMemoryManagerJs } from './SharedMemoryManagerJs';
import { telemetry } from '../telemetry';
import { SeverityLevel } from '../telemetry';
import { logger } from '../utils/logger';

// Interface for the Rust native batch processor that will be dynamically imported
interface NapiBatchProcessorClass {
  new(): NapiBatchProcessor;
}

// Interface for the Rust native batch processor instance
interface NapiBatchProcessor {
  create_processor(buffer_name: string): boolean;
  process_items(buffer_name: string, callback: (items: any[]) => void): boolean;
  stop_processor(buffer_name: string): boolean;
  is_processor_active(buffer_name: string): boolean;
  get_last_sequence(buffer_name: string): number;
}

/**
 * BatchProcessorRust class
 * Wraps the native Rust batch processor implementation with JavaScript fallback
 */
export class BatchProcessorRust {
  private native: NapiBatchProcessor | null = null;
  private fallback: BatchProcessorJs;
  private useNative: boolean = true;
  private static instance: BatchProcessorRust | null = null;

  /**
   * Creates a new BatchProcessorRust instance
   * @param jsMemoryManager JavaScript fallback memory manager
   */
  constructor(jsMemoryManager: SharedMemoryManagerJs) {
    this.fallback = new BatchProcessorJs(jsMemoryManager);
    
    // Try to load the native implementation
    try {
      // Using dynamic import to avoid issues when native module is not available
      import('@noderr/core').then(core => {
        if (core.NapiBatchProcessor) {
          // Use any to bypass TypeScript's type checking for dynamically imported module
          this.native = new (core.NapiBatchProcessor as any)();
          telemetry.recordMetric('batch_processor.init', 1, {
            implementation: 'rust',
            status: 'success'
          });
          logger.info('BatchProcessorRust initialized with native implementation');
        } else {
          this.useNative = false;
          telemetry.recordMetric('batch_processor.init', 1, {
            implementation: 'js',
            status: 'fallback_no_export'
          });
          logger.warn('NapiBatchProcessor not found in @noderr/core, using JavaScript fallback');
        }
      }).catch(error => {
        this.useNative = false;
        telemetry.recordError(
          'BatchProcessorRust',
          `Error loading native batch processor: ${error instanceof Error ? error.message : String(error)}`,
          SeverityLevel.ERROR,
          { operation: 'init' }
        );
        logger.warn(`Error loading native batch processor, using JavaScript fallback: ${error}`);
      });
    } catch (error) {
      this.useNative = false;
      telemetry.recordError(
        'BatchProcessorRust',
        `Error initializing native batch processor: ${error instanceof Error ? error.message : String(error)}`,
        SeverityLevel.ERROR,
        { operation: 'init' }
      );
      logger.warn(`Error initializing native batch processor, using JavaScript fallback: ${error}`);
    }
  }

  /**
   * Get the singleton instance of BatchProcessorRust
   * @param jsMemoryManager JavaScript fallback memory manager
   * @returns The singleton instance
   */
  public static getInstance(jsMemoryManager: SharedMemoryManagerJs): BatchProcessorRust {
    if (!BatchProcessorRust.instance) {
      BatchProcessorRust.instance = new BatchProcessorRust(jsMemoryManager);
    }
    return BatchProcessorRust.instance;
  }

  /**
   * Create a new processor for a buffer
   * @param bufferName The name of the buffer to process
   * @returns True if processor was created, false otherwise
   */
  createProcessor(bufferName: string): boolean {
    try {
      // Try native implementation first
      if (this.useNative && this.native) {
        const success = this.native.create_processor(bufferName);
        
        if (success) {
          telemetry.recordMetric('batch_processor.create_processor', 1, {
            buffer: bufferName,
            implementation: 'rust'
          });
        }
        
        return success;
      }
      
      // Fall back to JavaScript implementation
      return this.fallback.createProcessor(bufferName);
    } catch (error) {
      telemetry.recordError(
        'BatchProcessorRust',
        `Error creating processor for buffer '${bufferName}': ${error instanceof Error ? error.message : String(error)}`,
        SeverityLevel.ERROR,
        { operation: 'create_processor' }
      );
      
      // Try fallback on error
      try {
        return this.fallback.createProcessor(bufferName);
      } catch (fallbackError) {
        logger.error(`Error creating processor for buffer '${bufferName}' (fallback failed): ${fallbackError}`);
        return false;
      }
    }
  }

  /**
   * Start processing items from a buffer
   * @param bufferName The name of the buffer to process
   * @param callback Function to call with batches of items
   * @returns True if processor was started, false otherwise
   */
  processItems(bufferName: string, callback: (items: any[]) => void): boolean {
    try {
      // Try native implementation first
      if (this.useNative && this.native) {
        const success = this.native.process_items(bufferName, callback);
        
        if (success) {
          telemetry.recordMetric('batch_processor.start_processing', 1, {
            buffer: bufferName,
            implementation: 'rust'
          });
        }
        
        return success;
      }
      
      // Fall back to JavaScript implementation
      return this.fallback.processItems(bufferName, callback);
    } catch (error) {
      telemetry.recordError(
        'BatchProcessorRust',
        `Error starting processor for buffer '${bufferName}': ${error instanceof Error ? error.message : String(error)}`,
        SeverityLevel.ERROR,
        { operation: 'process_items' }
      );
      
      // Try fallback on error
      try {
        return this.fallback.processItems(bufferName, callback);
      } catch (fallbackError) {
        logger.error(`Error starting processor for buffer '${bufferName}' (fallback failed): ${fallbackError}`);
        return false;
      }
    }
  }

  /**
   * Stop processing items from a buffer
   * @param bufferName The name of the buffer to stop processing
   * @returns True if processor was stopped, false otherwise
   */
  stopProcessor(bufferName: string): boolean {
    try {
      // Try native implementation first
      if (this.useNative && this.native) {
        const success = this.native.stop_processor(bufferName);
        
        if (success) {
          telemetry.recordMetric('batch_processor.stop_processing', 1, {
            buffer: bufferName,
            implementation: 'rust'
          });
        }
        
        return success;
      }
      
      // Fall back to JavaScript implementation
      return this.fallback.stopProcessor(bufferName);
    } catch (error) {
      telemetry.recordError(
        'BatchProcessorRust',
        `Error stopping processor for buffer '${bufferName}': ${error instanceof Error ? error.message : String(error)}`,
        SeverityLevel.ERROR,
        { operation: 'stop_processor' }
      );
      
      // Try fallback on error
      try {
        return this.fallback.stopProcessor(bufferName);
      } catch (fallbackError) {
        logger.error(`Error stopping processor for buffer '${bufferName}' (fallback failed): ${fallbackError}`);
        return false;
      }
    }
  }

  /**
   * Check if a processor is active
   * @param bufferName The name of the buffer to check
   * @returns True if processor is active, false otherwise
   */
  isProcessorActive(bufferName: string): boolean {
    try {
      // Try native implementation first
      if (this.useNative && this.native) {
        return this.native.is_processor_active(bufferName);
      }
      
      // Fall back to JavaScript implementation
      return this.fallback.isProcessorActive(bufferName);
    } catch (error) {
      telemetry.recordError(
        'BatchProcessorRust',
        `Error checking processor status for buffer '${bufferName}': ${error instanceof Error ? error.message : String(error)}`,
        SeverityLevel.ERROR,
        { operation: 'is_processor_active' }
      );
      
      // Try fallback on error
      try {
        return this.fallback.isProcessorActive(bufferName);
      } catch (fallbackError) {
        logger.error(`Error checking processor status for buffer '${bufferName}' (fallback failed): ${fallbackError}`);
        return false;
      }
    }
  }

  /**
   * Get the last sequence processed by a processor
   * @param bufferName The name of the buffer to check
   * @returns The last sequence processed, or -1 if no items processed
   */
  getLastSequence(bufferName: string): number {
    try {
      // Try native implementation first
      if (this.useNative && this.native) {
        return this.native.get_last_sequence(bufferName);
      }
      
      // Fall back to JavaScript implementation
      return this.fallback.getLastSequence(bufferName);
    } catch (error) {
      telemetry.recordError(
        'BatchProcessorRust',
        `Error getting last sequence for buffer '${bufferName}': ${error instanceof Error ? error.message : String(error)}`,
        SeverityLevel.ERROR,
        { operation: 'get_last_sequence' }
      );
      
      // Try fallback on error
      try {
        return this.fallback.getLastSequence(bufferName);
      } catch (fallbackError) {
        logger.error(`Error getting last sequence for buffer '${bufferName}' (fallback failed): ${fallbackError}`);
        return -1;
      }
    }
  }
} 