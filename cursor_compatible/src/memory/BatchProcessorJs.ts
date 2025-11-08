import { telemetry } from '../telemetry';
import { SeverityLevel } from '../telemetry';
import { logger } from '../utils/logger';
import { SharedMemoryManagerJs } from './SharedMemoryManagerJs';

/**
 * JavaScript fallback implementation of the BatchProcessor
 * Processes batches of data from shared memory buffers
 */
export class BatchProcessorJs {
  private processors: Map<string, {
    active: boolean;
    interval: NodeJS.Timeout | null;
    lastSequence: number;
  }>;
  private memoryManager: SharedMemoryManagerJs;
  private processingInterval = 50; // ms

  /**
   * Create a new BatchProcessorJs instance
   * @param memoryManager The SharedMemoryManagerJs instance to use
   */
  constructor(memoryManager: SharedMemoryManagerJs) {
    this.processors = new Map();
    this.memoryManager = memoryManager;
    
    telemetry.recordMetric('batch_processor.init', 1, {
      implementation: 'js'
    });
    
    logger.info('BatchProcessorJs initialized');
  }

  /**
   * Create a new processor for a buffer
   * @param bufferName The name of the buffer to process
   * @returns True if processor was created, false otherwise
   */
  createProcessor(bufferName: string): boolean {
    try {
      if (this.processors.has(bufferName)) {
        logger.warn(`Processor for buffer '${bufferName}' already exists`);
        return false;
      }

      this.processors.set(bufferName, {
        active: false,
        interval: null,
        lastSequence: -1
      });

      telemetry.recordMetric('batch_processor.create_processor', 1, {
        buffer: bufferName,
        implementation: 'js'
      });

      return true;
    } catch (error) {
      telemetry.recordError(
        'BatchProcessorJs',
        `Error creating processor for buffer '${bufferName}': ${error instanceof Error ? error.message : String(error)}`,
        SeverityLevel.ERROR,
        { operation: 'create_processor' }
      );
      return false;
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
      const processor = this.processors.get(bufferName);
      
      if (!processor) {
        logger.warn(`No processor found for buffer '${bufferName}'`);
        return false;
      }

      if (processor.active) {
        logger.warn(`Processor for buffer '${bufferName}' is already active`);
        return true;
      }

      processor.active = true;
      
      // Start processing loop
      processor.interval = setInterval(() => {
        try {
          const items = this.memoryManager.getAfterSequence(bufferName, processor.lastSequence);
          
          if (items.length > 0) {
            // Update last sequence
            const lastItem = items[items.length - 1];
            if (lastItem && lastItem._sequence !== undefined) {
              processor.lastSequence = lastItem._sequence;
            }
            
            // Process items
            callback(items);
            
            telemetry.recordMetric('batch_processor.items_processed', items.length, {
              buffer: bufferName,
              implementation: 'js'
            });
          }
        } catch (error) {
          telemetry.recordError(
            'BatchProcessorJs',
            `Error processing items from buffer '${bufferName}': ${error instanceof Error ? error.message : String(error)}`,
            SeverityLevel.ERROR,
            { operation: 'process_items' }
          );
        }
      }, this.processingInterval);

      telemetry.recordMetric('batch_processor.start_processing', 1, {
        buffer: bufferName,
        implementation: 'js'
      });

      return true;
    } catch (error) {
      telemetry.recordError(
        'BatchProcessorJs',
        `Error starting processor for buffer '${bufferName}': ${error instanceof Error ? error.message : String(error)}`,
        SeverityLevel.ERROR,
        { operation: 'start_processing' }
      );
      return false;
    }
  }

  /**
   * Stop processing items from a buffer
   * @param bufferName The name of the buffer to stop processing
   * @returns True if processor was stopped, false otherwise
   */
  stopProcessor(bufferName: string): boolean {
    try {
      const processor = this.processors.get(bufferName);
      
      if (!processor) {
        logger.warn(`No processor found for buffer '${bufferName}'`);
        return false;
      }

      if (!processor.active) {
        logger.warn(`Processor for buffer '${bufferName}' is not active`);
        return true;
      }

      processor.active = false;
      
      if (processor.interval) {
        clearInterval(processor.interval);
        processor.interval = null;
      }

      telemetry.recordMetric('batch_processor.stop_processing', 1, {
        buffer: bufferName,
        implementation: 'js'
      });

      return true;
    } catch (error) {
      telemetry.recordError(
        'BatchProcessorJs',
        `Error stopping processor for buffer '${bufferName}': ${error instanceof Error ? error.message : String(error)}`,
        SeverityLevel.ERROR,
        { operation: 'stop_processor' }
      );
      return false;
    }
  }

  /**
   * Check if a processor is active
   * @param bufferName The name of the buffer to check
   * @returns True if processor is active, false otherwise
   */
  isProcessorActive(bufferName: string): boolean {
    try {
      const processor = this.processors.get(bufferName);
      return processor ? processor.active : false;
    } catch (error) {
      telemetry.recordError(
        'BatchProcessorJs',
        `Error checking processor status for buffer '${bufferName}': ${error instanceof Error ? error.message : String(error)}`,
        SeverityLevel.ERROR,
        { operation: 'is_processor_active' }
      );
      return false;
    }
  }

  /**
   * Get the last sequence processed by a processor
   * @param bufferName The name of the buffer to check
   * @returns The last sequence processed, or -1 if no items processed
   */
  getLastSequence(bufferName: string): number {
    try {
      const processor = this.processors.get(bufferName);
      return processor ? processor.lastSequence : -1;
    } catch (error) {
      telemetry.recordError(
        'BatchProcessorJs',
        `Error getting last sequence for buffer '${bufferName}': ${error instanceof Error ? error.message : String(error)}`,
        SeverityLevel.ERROR,
        { operation: 'get_last_sequence' }
      );
      return -1;
    }
  }
} 