import {
  NapiSharedMemoryManager,
  NapiBatchProcessor
} from '@noderr/core';
import { SharedMemoryManagerJs, BatchProcessorJs } from './SharedMemoryManagerJs';
import { telemetry } from '../telemetry';
import { logger } from '../logger';
import { SeverityLevel } from '../telemetry/types';

// Define interface for BufferConfigParams
interface BufferConfigParams {
  capacity: number;
  buffer_type: string;
  allow_overwrites: boolean;
  auto_compact: boolean;
}

// Define interface for NapiSharedMemoryManager to avoid importing it directly
interface NapiSharedMemoryManager {
  create_market_data_buffer(name: string, config: BufferConfigParams): boolean;
  push_market_data(bufferName: string, data: any): number;
  push_market_data_batch(bufferName: string, items: any[]): number[];
  get_recent_market_data(bufferName: string, limit: number): any[];
  get_market_data_after_sequence(bufferName: string, sequence: number): any[];
  get_market_data_after_timestamp(bufferName: string, timestamp: number): any[];
  clear_buffer(bufferName: string): boolean;
  list_buffers(): string[];
  remove_buffer(bufferName: string): boolean;
}

// Define interface for NapiBatchProcessor to avoid importing it directly
interface NapiBatchProcessor<T, R> {
  add_item(item: T): boolean;
  process_batch(): { 
    successes: R[], 
    failures: Array<{ value: T, error: string }>,
    total_time_us: number
  };
  pending_count(): number;
  clear_pending(): void;
}

/**
 * Buffer types available in the SharedMemoryManager
 */
export enum BufferType {
  MarketData = 'market_data',
  OrderBookDeltas = 'order_book_deltas',
  TradeEvents = 'trade_events',
  Trades = 'trades',
  TickerData = 'ticker_data',
  OrderEvents = 'order_events',
  PositionEvents = 'position_events',
  CustomEvents = 'custom_events'
}

/**
 * Buffer configuration options
 */
export interface BufferConfig {
  /**
   * Maximum capacity of the buffer
   */
  capacity: number;
  /**
   * Type of buffer
   */
  type: BufferType;
  /**
   * Whether to allow overwrites when buffer is full
   */
  allow_overwrites?: boolean;
  /**
   * Whether to automatically compact the buffer when needed
   */
  auto_compact?: boolean;
}

/**
 * Default buffer configuration
 */
export const DEFAULT_BUFFER_CONFIG: BufferConfig = {
  capacity: 10000,
  type: BufferType.CustomEvents,
  allow_overwrites: true,
  auto_compact: false
};

/**
 * High-performance Rust-powered shared memory manager with JavaScript fallback
 * Provides efficient data sharing between components using ring buffers
 */
export class SharedMemoryManagerRust {
  private native: NapiSharedMemoryManager | null = null;
  private fallback: SharedMemoryManagerJs;
  private useNative: boolean = false;
  private static instance: SharedMemoryManagerRust | null = null;
  
  /**
   * Private constructor for singleton pattern
   */
  private constructor() {
    // Initialize JavaScript fallback
    this.fallback = SharedMemoryManagerJs.getInstance();
    
    // Try to initialize the native Rust implementation
    try {
      telemetry.recordMetric('shared_memory_manager.initialization.attempt', 1, {
        implementation: 'rust'
      });
      
      // Dynamically import to avoid issues when the native module is not available
      import('@noderr/core').then(core => {
        this.native = new core.NapiSharedMemoryManager();
        this.useNative = true;
        
        telemetry.recordMetric('shared_memory_manager.initialization.success', 1, {
          implementation: 'rust'
        });
        
        logger.info('Initialized Rust SharedMemoryManager');
      }).catch(error => {
        this.useNative = false;
        this.native = null;
        
        telemetry.recordError(
          'SharedMemoryManagerRust',
          `Failed to initialize Rust implementation: ${error.message}`,
          SeverityLevel.WARNING,
          { implementation: 'rust' }
        );
        
        logger.warn(`Using JavaScript fallback for SharedMemoryManager: ${error.message}`);
      });
    } catch (error) {
      this.useNative = false;
      this.native = null;
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      telemetry.recordError(
        'SharedMemoryManagerRust',
        `Failed to initialize Rust implementation: ${errorMessage}`,
        SeverityLevel.WARNING,
        { implementation: 'rust' }
      );
      
      logger.warn(`Using JavaScript fallback for SharedMemoryManager: ${errorMessage}`);
    }
  }
  
  /**
   * Get singleton instance of SharedMemoryManagerRust
   */
  public static getInstance(): SharedMemoryManagerRust {
    if (!SharedMemoryManagerRust.instance) {
      SharedMemoryManagerRust.instance = new SharedMemoryManagerRust();
    }
    return SharedMemoryManagerRust.instance;
  }
  
  /**
   * Create a new buffer for market data
   * @param name Buffer name (must be unique)
   * @param config Buffer configuration
   * @returns true if successful
   */
  public createBuffer(name: string, config: Partial<BufferConfig> = {}): boolean {
    try {
      const finalConfig: BufferConfig = {
        ...DEFAULT_BUFFER_CONFIG,
        ...config
      };
      
      // Try native implementation first
      if (this.useNative && this.native) {
        // Convert to the format expected by Rust
        const bufferConfig: BufferConfigParams = {
          capacity: finalConfig.capacity,
          buffer_type: finalConfig.type,
          allow_overwrites: finalConfig.allow_overwrites || false,
          auto_compact: finalConfig.auto_compact || false
        };
        
        const success = this.native.create_market_data_buffer(name, bufferConfig);
        
        if (success) {
          telemetry.recordMetric('shared_memory_manager.create_buffer', 1, {
            buffer: name,
            buffer_type: finalConfig.type,
            capacity: finalConfig.capacity.toString(),
            implementation: 'rust'
          });
        }
        
        return success;
      }
      
      // Fall back to JavaScript implementation
      return this.fallback.createBuffer(name, finalConfig);
    } catch (error) {
      telemetry.recordError(
        'SharedMemoryManagerRust',
        `Error creating buffer '${name}': ${error instanceof Error ? error.message : String(error)}`,
        SeverityLevel.ERROR,
        { operation: 'create_buffer' }
      );
      
      // Try fallback on error
      try {
        return this.fallback.createBuffer(name, config);
      } catch (fallbackError) {
        logger.error(`Error creating buffer '${name}' (fallback failed): ${fallbackError}`);
        return false;
      }
    }
  }
  
  /**
   * Push market data to a buffer
   * @param bufferName Name of the buffer
   * @param data Data to push (must be JSON serializable)
   * @returns Sequence number of the pushed data
   */
  public push(bufferName: string, data: any): number {
    try {
      // Try native implementation first
      if (this.useNative && this.native) {
        const sequence = this.native.push_market_data(bufferName, data);
        
        if (sequence >= 0) {
          telemetry.recordMetric('shared_memory_manager.push', 1, {
            buffer: bufferName,
            implementation: 'rust'
          });
        }
        
        return sequence;
      }
      
      // Fall back to JavaScript implementation
      return this.fallback.push(bufferName, data);
    } catch (error) {
      telemetry.recordError(
        'SharedMemoryManagerRust',
        `Error pushing data to buffer '${bufferName}': ${error instanceof Error ? error.message : String(error)}`,
        SeverityLevel.ERROR,
        { operation: 'push' }
      );
      
      // Try fallback on error
      try {
        return this.fallback.push(bufferName, data);
      } catch (fallbackError) {
        logger.error(`Error pushing to buffer '${bufferName}' (fallback failed): ${fallbackError}`);
        return -1;
      }
    }
  }
  
  /**
   * Push multiple market data items at once
   * @param bufferName Name of the buffer
   * @param items Array of data items to push (must be JSON serializable)
   * @returns Array of sequence numbers for the pushed data
   */
  public pushBatch(bufferName: string, items: any[]): number[] {
    try {
      // Try native implementation first
      if (this.useNative && this.native) {
        const sequences = this.native.push_market_data_batch(bufferName, items);
        
        if (sequences.length > 0) {
          telemetry.recordMetric('shared_memory_manager.push_batch', 1, {
            buffer: bufferName,
            count: items.length.toString(),
            implementation: 'rust'
          });
        }
        
        return sequences;
      }
      
      // Fall back to JavaScript implementation
      return this.fallback.pushBatch(bufferName, items);
    } catch (error) {
      telemetry.recordError(
        'SharedMemoryManagerRust',
        `Error pushing batch to buffer '${bufferName}': ${error instanceof Error ? error.message : String(error)}`,
        SeverityLevel.ERROR,
        { operation: 'push_batch' }
      );
      
      // Try fallback on error
      try {
        return this.fallback.pushBatch(bufferName, items);
      } catch (fallbackError) {
        logger.error(`Error pushing batch to buffer '${bufferName}' (fallback failed): ${fallbackError}`);
        return [];
      }
    }
  }
  
  /**
   * Get recent data from a buffer
   * @param bufferName Name of the buffer
   * @param limit Maximum number of items to retrieve
   * @returns Array of data items, newest first
   */
  public getRecent(bufferName: string, limit: number = 100): any[] {
    try {
      // Try native implementation first
      if (this.useNative && this.native) {
        const items = this.native.get_recent_market_data(bufferName, limit);
        
        telemetry.recordMetric('shared_memory_manager.get_recent', 1, {
          buffer: bufferName,
          limit: limit.toString(),
          count_returned: items.length.toString(),
          implementation: 'rust'
        });
        
        return items;
      }
      
      // Fall back to JavaScript implementation
      return this.fallback.getRecent(bufferName, limit);
    } catch (error) {
      telemetry.recordError('Error getting recent data from buffer', {
        buffer: bufferName,
        limit: limit.toString(),
        error: error instanceof Error ? error.message : String(error)
      }, SeverityLevel.ERROR);
      
      // Try fallback on error
      try {
        return this.fallback.getRecent(bufferName, limit);
      } catch (fallbackError) {
        logger.error(`Error getting recent data from buffer '${bufferName}' (fallback failed): ${fallbackError}`);
        return [];
      }
    }
  }
  
  /**
   * Get data after a specific sequence number
   * @param bufferName Name of the buffer
   * @param sequence Sequence number
   * @returns Array of data items that came after the specified sequence
   */
  public getAfterSequence(bufferName: string, sequence: number): any[] {
    try {
      // Try native implementation first
      if (this.useNative && this.native) {
        const items = this.native.get_market_data_after_sequence(bufferName, sequence);
        
        telemetry.recordMetric('shared_memory_manager.get_after_sequence', 1, {
          buffer: bufferName,
          sequence: sequence.toString(),
          count_returned: items.length.toString(),
          implementation: 'rust'
        });
        
        return items;
      }
      
      // Fall back to JavaScript implementation
      return this.fallback.getAfterSequence(bufferName, sequence);
    } catch (error) {
      telemetry.recordError('Error getting data after sequence from buffer', {
        buffer: bufferName,
        sequence: sequence.toString(),
        error: error instanceof Error ? error.message : String(error)
      }, SeverityLevel.ERROR);
      
      // Try fallback on error
      try {
        return this.fallback.getAfterSequence(bufferName, sequence);
      } catch (fallbackError) {
        logger.error(`Error getting data after sequence from buffer '${bufferName}' (fallback failed): ${fallbackError}`);
        return [];
      }
    }
  }
  
  /**
   * Get data after a specific timestamp
   * @param bufferName Name of the buffer
   * @param timestamp Timestamp in microseconds
   * @returns Array of data items that came after the specified timestamp
   */
  public getAfterTimestamp(bufferName: string, timestamp: number): any[] {
    try {
      // Try native implementation first
      if (this.useNative && this.native) {
        const items = this.native.get_market_data_after_timestamp(bufferName, timestamp);
        
        telemetry.recordMetric('shared_memory_manager.get_after_timestamp', 1, {
          buffer: bufferName,
          timestamp: timestamp.toString(),
          count_returned: items.length.toString(),
          implementation: 'rust'
        });
        
        return items;
      }
      
      // Fall back to JavaScript implementation
      return this.fallback.getAfterTimestamp(bufferName, timestamp);
    } catch (error) {
      telemetry.recordError('Error getting data after timestamp from buffer', {
        buffer: bufferName,
        timestamp: timestamp.toString(),
        error: error instanceof Error ? error.message : String(error)
      }, SeverityLevel.ERROR);
      
      // Try fallback on error
      try {
        return this.fallback.getAfterTimestamp(bufferName, timestamp);
      } catch (fallbackError) {
        logger.error(`Error getting data after timestamp from buffer '${bufferName}' (fallback failed): ${fallbackError}`);
        return [];
      }
    }
  }
  
  /**
   * Clear all data from a buffer
   * @param bufferName Name of the buffer
   * @returns true if successful
   */
  public clearBuffer(bufferName: string): boolean {
    try {
      // Try native implementation first
      if (this.useNative && this.native) {
        const success = this.native.clear_buffer(bufferName);
        
        if (success) {
          telemetry.recordMetric('shared_memory_manager.clear_buffer', 1, {
            buffer: bufferName,
            implementation: 'rust'
          });
        }
        
        return success;
      }
      
      // Fall back to JavaScript implementation
      return this.fallback.clearBuffer(bufferName);
    } catch (error) {
      telemetry.recordError('Error clearing buffer', {
        buffer: bufferName,
        error: error instanceof Error ? error.message : String(error)
      }, SeverityLevel.ERROR);
      
      // Try fallback on error
      try {
        return this.fallback.clearBuffer(bufferName);
      } catch (fallbackError) {
        logger.error(`Error clearing buffer '${bufferName}' (fallback failed): ${fallbackError}`);
        return false;
      }
    }
  }
  
  /**
   * List all buffers
   * @returns Array of buffer names
   */
  public listBuffers(): string[] {
    try {
      // Try native implementation first
      if (this.useNative && this.native) {
        const bufferNames = this.native.list_buffers();
        
        telemetry.recordMetric('shared_memory_manager.list_buffers', 1, {
          count: bufferNames.length.toString(),
          implementation: 'rust'
        });
        
        return bufferNames;
      }
      
      // Fall back to JavaScript implementation
      return this.fallback.listBuffers();
    } catch (error) {
      telemetry.recordError('Error listing buffers', {
        error: error instanceof Error ? error.message : String(error)
      }, SeverityLevel.ERROR);
      
      // Try fallback on error
      try {
        return this.fallback.listBuffers();
      } catch (fallbackError) {
        logger.error(`Error listing buffers (fallback failed): ${fallbackError}`);
        return [];
      }
    }
  }
  
  /**
   * Remove a buffer
   * @param bufferName Name of the buffer to remove
   * @returns true if successful
   */
  public removeBuffer(bufferName: string): boolean {
    try {
      // Try native implementation first
      if (this.useNative && this.native) {
        const success = this.native.remove_buffer(bufferName);
        
        if (success) {
          telemetry.recordMetric('shared_memory_manager.remove_buffer', 1, {
            buffer: bufferName,
            implementation: 'rust'
          });
        }
        
        return success;
      }
      
      // Fall back to JavaScript implementation
      return this.fallback.removeBuffer(bufferName);
    } catch (error) {
      telemetry.recordError('Error removing buffer', {
        buffer: bufferName,
        error: error instanceof Error ? error.message : String(error)
      }, SeverityLevel.ERROR);
      
      // Try fallback on error
      try {
        return this.fallback.removeBuffer(bufferName);
      } catch (fallbackError) {
        logger.error(`Error removing buffer '${bufferName}' (fallback failed): ${fallbackError}`);
        return false;
      }
    }
  }
  
  /**
   * Create a SharedArrayBuffer and return a view to it
   * This is a helper method for creating shared memory for browser use
   * @param byteLength Size of the buffer in bytes
   * @returns A typed array view on a SharedArrayBuffer
   */
  public createSharedArrayBuffer(byteLength: number): Float64Array {
    try {
      // Use JavaScript implementation directly for this method
      return this.fallback.createSharedArrayBuffer(byteLength);
    } catch (error) {
      telemetry.recordError('Error creating SharedArrayBuffer', {
        byteLength: byteLength.toString(),
        error: error instanceof Error ? error.message : String(error)
      }, SeverityLevel.ERROR);
      
      // Fall back to regular ArrayBuffer
      logger.error(`Error creating SharedArrayBuffer: ${error}`);
      return new Float64Array(byteLength / 8);
    }
  }
  
  /**
   * Get the native Rust SharedMemoryManager instance
   * Used by other native components that need access to shared memory
   * @returns Native Rust SharedMemoryManager or null if using fallback
   */
  public getNativeManager(): NapiSharedMemoryManager | null {
    return this.native;
  }
  
  /**
   * Create a market data buffer with binary format optimized for performance
   * @param name Buffer name
   * @param itemSchema Schema defining the binary layout
   * @returns true if successful
   */
  public createBinaryBuffer(name: string, itemSchema: { [key: string]: string }): boolean {
    try {
      // Try native implementation first
      if (this.useNative && this.native) {
        // For now, we're just creating a regular buffer
        // In a real implementation, we would use the schema to optimize the binary layout
        const success = this.createBuffer(name, {
          type: BufferType.MarketData,
          capacity: 10000, // Binary buffers can efficiently hold more items
        });
        
        if (success) {
          telemetry.recordMetric('shared_memory_manager.create_binary_buffer', 1, {
            buffer: name,
            implementation: 'rust'
          });
        }
        
        return success;
      }
      
      // Fall back to JavaScript implementation
      return this.fallback.createBinaryBuffer(name, itemSchema);
    } catch (error) {
      telemetry.recordError('Error creating binary buffer', {
        buffer: name,
        error: error instanceof Error ? error.message : String(error)
      }, SeverityLevel.ERROR);
      
      // Try fallback on error
      try {
        return this.fallback.createBinaryBuffer(name, itemSchema);
      } catch (fallbackError) {
        logger.error(`Error creating binary buffer '${name}' (fallback failed): ${fallbackError}`);
        return false;
      }
    }
  }
}

/**
 * Create a batch processor for efficient market data processing
 * Falls back to JavaScript implementation if Rust is not available
 */
export class BatchProcessorRust<T, R> {
  private native: NapiBatchProcessor<T, R> | null = null;
  private fallback: BatchProcessorJs<T, R>;
  private useNative: boolean = false;
  
  /**
   * Create a new batch processor
   * @param processorFn Function to process batches
   * @param maxBatchSize Maximum batch size
   */
  constructor(
    private processorFn: (items: T[]) => { 
      successes: R[], 
      failures: Array<{ value: T, error: string }>,
      totalTimeUs?: number
    },
    maxBatchSize: number = 100
  ) {
    // Initialize JavaScript fallback
    this.fallback = new BatchProcessorJs<T, R>(processorFn, maxBatchSize);
    
    // Try to initialize the native Rust implementation
    try {
      telemetry.recordMetric('batch_processor.initialization.attempt', 1, {
        implementation: 'rust',
        max_batch_size: maxBatchSize.toString()
      });
      
      // Import dynamically to avoid circular dependencies
      import('@noderr/core').then(core => {
        this.native = core.NapiBatchProcessor.create(
          (batch: T[]) => {
            const result = this.processorFn(batch);
            return {
              successes: result.successes,
              failures: result.failures.map(f => ({ value: f.value, error: f.error })),
              total_time_us: result.totalTimeUs || 0
            };
          },
          maxBatchSize
        );
        
        this.useNative = true;
        
        telemetry.recordMetric('batch_processor.initialization.success', 1, {
          implementation: 'rust',
          max_batch_size: maxBatchSize.toString()
        });
        
        logger.info('Initialized Rust BatchProcessor');
      }).catch(error => {
        this.useNative = false;
        this.native = null;
        
        telemetry.recordError('Failed to initialize Rust BatchProcessor', {
          error: error.message,
          implementation: 'rust'
        }, SeverityLevel.WARNING);
        
        logger.warn(`Using JavaScript fallback for BatchProcessor: ${error.message}`);
      });
    } catch (error) {
      this.useNative = false;
      this.native = null;
      
      telemetry.recordError('Failed to initialize Rust BatchProcessor', {
        error: error instanceof Error ? error.message : String(error),
        implementation: 'rust'
      }, SeverityLevel.WARNING);
      
      logger.warn(`Using JavaScript fallback for BatchProcessor: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Add an item to the batch
   * @param item Item to add
   * @returns true if the batch is now full
   */
  public addItem(item: T): boolean {
    try {
      // Try native implementation first
      if (this.useNative && this.native) {
        const result = this.native.add_item(item);
        
        telemetry.recordMetric('batch_processor.add_item', 1, {
          implementation: 'rust'
        });
        
        return result;
      }
      
      // Fall back to JavaScript implementation
      return this.fallback.addItem(item);
    } catch (error) {
      telemetry.recordError('Error adding item to batch', {
        error: error instanceof Error ? error.message : String(error)
      }, SeverityLevel.ERROR);
      
      // Try fallback on error
      try {
        return this.fallback.addItem(item);
      } catch (fallbackError) {
        logger.error(`Error adding item to batch (fallback failed): ${fallbackError}`);
        return false;
      }
    }
  }
  
  /**
   * Process the current batch
   * @returns Processing results
   */
  public processBatch(): { 
    successes: R[], 
    failures: Array<{ value: T, error: string }>,
    totalTimeUs: number
  } {
    try {
      // Try native implementation first
      if (this.useNative && this.native) {
        const result = this.native.process_batch();
        
        telemetry.recordMetric('batch_processor.process_batch', 1, {
          implementation: 'rust',
          success_count: result.successes.length.toString(),
          failure_count: result.failures.length.toString(),
          time_us: result.total_time_us.toString()
        });
        
        return {
          successes: result.successes,
          failures: result.failures,
          totalTimeUs: result.total_time_us
        };
      }
      
      // Fall back to JavaScript implementation
      return this.fallback.processBatch();
    } catch (error) {
      telemetry.recordError('Error processing batch', {
        error: error instanceof Error ? error.message : String(error)
      }, SeverityLevel.ERROR);
      
      // Try fallback on error
      try {
        return this.fallback.processBatch();
      } catch (fallbackError) {
        logger.error(`Error processing batch (fallback failed): ${fallbackError}`);
        return { successes: [], failures: [], totalTimeUs: 0 };
      }
    }
  }
  
  /**
   * Get the number of pending items
   * @returns Number of pending items
   */
  public pendingCount(): number {
    try {
      // Try native implementation first
      if (this.useNative && this.native) {
        return this.native.pending_count();
      }
      
      // Fall back to JavaScript implementation
      return this.fallback.pendingCount();
    } catch (error) {
      telemetry.recordError('Error getting pending count', {
        error: error instanceof Error ? error.message : String(error)
      }, SeverityLevel.ERROR);
      
      // Try fallback on error
      try {
        return this.fallback.pendingCount();
      } catch (fallbackError) {
        logger.error(`Error getting pending count (fallback failed): ${fallbackError}`);
        return 0;
      }
    }
  }
  
  /**
   * Clear all pending items
   */
  public clearPending(): void {
    try {
      // Try native implementation first
      if (this.useNative && this.native) {
        this.native.clear_pending();
        
        telemetry.recordMetric('batch_processor.clear_pending', 1, {
          implementation: 'rust'
        });
        
        return;
      }
      
      // Fall back to JavaScript implementation
      this.fallback.clearPending();
    } catch (error) {
      telemetry.recordError('Error clearing pending items', {
        error: error instanceof Error ? error.message : String(error)
      }, SeverityLevel.ERROR);
      
      // Try fallback on error
      try {
        this.fallback.clearPending();
      } catch (fallbackError) {
        logger.error(`Error clearing pending items (fallback failed): ${fallbackError}`);
      }
    }
  }
} 