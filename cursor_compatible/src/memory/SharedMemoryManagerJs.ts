import { telemetry } from '../telemetry';
import { logger } from '../utils/logger';

/**
 * Buffer types available in the SharedMemoryManager
 */
export enum BufferType {
  MarketData = 'MarketData',
  OrderBookDeltas = 'OrderBookDeltas', 
  OrderEvents = 'OrderEvents',
  TradeEvents = 'TradeEvents',
  LatencyMetrics = 'LatencyMetrics',
  StrategyStates = 'StrategyStates',
  RiskStates = 'RiskStates',
  Custom = 'Custom'
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
  bufferType: BufferType;
  /**
   * Whether to allow overwrites when buffer is full
   */
  allowOverwrites: boolean;
  /**
   * Whether to automatically compact the buffer when needed
   */
  autoCompact: boolean;
}

/**
 * Default buffer configuration
 */
export const DEFAULT_BUFFER_CONFIG: BufferConfig = {
  capacity: 1000,
  bufferType: BufferType.MarketData,
  allowOverwrites: true,
  autoCompact: true
};

/**
 * A ring buffer implementation for the SharedMemoryManager
 * @internal
 */
class RingBuffer<T> {
  private buffer: T[] = [];
  private head: number = 0;
  private tail: number = 0;
  private size: number = 0;
  private sequences: number[] = [];
  private timestamps: number[] = [];
  private nextSequence: number = 1;
  private config: BufferConfig;

  /**
   * Create a new ring buffer
   * @param config Buffer configuration
   */
  constructor(config: BufferConfig) {
    this.config = config;
    // Pre-allocate the buffer to avoid resizing
    this.buffer = new Array<T>(config.capacity);
    this.sequences = new Array<number>(config.capacity);
    this.timestamps = new Array<number>(config.capacity);
  }

  /**
   * Push an item to the buffer
   * @param item Item to push
   * @returns Sequence number of the pushed item
   */
  push(item: T): number {
    // Check if buffer is full
    if (this.size === this.config.capacity) {
      if (!this.config.allowOverwrites) {
        throw new Error('Buffer is full and overwrites are not allowed');
      }
      // Overwrites allowed, move head forward
      this.head = (this.head + 1) % this.config.capacity;
      this.size--;
    }

    // Add item to tail
    this.buffer[this.tail] = item;
    this.sequences[this.tail] = this.nextSequence++;
    this.timestamps[this.tail] = Date.now() * 1000; // Convert to microseconds
    const sequence = this.sequences[this.tail];
    
    // Move tail forward
    this.tail = (this.tail + 1) % this.config.capacity;
    this.size++;

    return sequence;
  }

  /**
   * Get recent items from the buffer
   * @param limit Maximum number of items to retrieve
   * @returns Array of recent items, newest first
   */
  getRecent(limit: number): T[] {
    const count = Math.min(limit, this.size);
    const result: T[] = [];

    // Start from tail - 1 (most recent item)
    let index = (this.tail - 1 + this.config.capacity) % this.config.capacity;
    for (let i = 0; i < count; i++) {
      result.push(this.buffer[index]);
      index = (index - 1 + this.config.capacity) % this.config.capacity;
    }

    return result;
  }

  /**
   * Get items after a specific sequence number
   * @param sequence Sequence number
   * @returns Array of items that came after the specified sequence
   */
  getAfterSequence(sequence: number): T[] {
    const result: T[] = [];

    // Start from head and scan to tail
    let index = this.head;
    for (let i = 0; i < this.size; i++) {
      if (this.sequences[index] > sequence) {
        result.push(this.buffer[index]);
      }
      index = (index + 1) % this.config.capacity;
    }

    return result;
  }

  /**
   * Get items after a specific timestamp
   * @param timestamp Timestamp in microseconds
   * @returns Array of items that came after the specified timestamp
   */
  getAfterTimestamp(timestamp: number): T[] {
    const result: T[] = [];

    // Start from head and scan to tail
    let index = this.head;
    for (let i = 0; i < this.size; i++) {
      if (this.timestamps[index] > timestamp) {
        result.push(this.buffer[index]);
      }
      index = (index + 1) % this.config.capacity;
    }

    return result;
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.head = 0;
    this.tail = 0;
    this.size = 0;
    this.nextSequence = 1;
  }

  /**
   * Get the number of items in the buffer
   * @returns Number of items
   */
  getSize(): number {
    return this.size;
  }

  /**
   * Get the capacity of the buffer
   * @returns Buffer capacity
   */
  getCapacity(): number {
    return this.config.capacity;
  }

  /**
   * Get buffer configuration
   * @returns Buffer configuration
   */
  getConfig(): BufferConfig {
    return this.config;
  }
}

/**
 * JavaScript fallback implementation of SharedMemoryManager
 * Provides data sharing between components using in-memory ring buffers
 */
export class SharedMemoryManagerJs {
  private buffers: Map<string, RingBuffer<any>> = new Map();
  private static instance: SharedMemoryManagerJs | null = null;
  
  /**
   * Private constructor for singleton pattern
   */
  private constructor() {
    telemetry.recordMetric('shared_memory_manager.initialization', 1, {
      implementation: 'javascript'
    });
    
    logger.info('Initialized JavaScript fallback SharedMemoryManager');
  }
  
  /**
   * Get singleton instance of SharedMemoryManagerJs
   */
  public static getInstance(): SharedMemoryManagerJs {
    if (!SharedMemoryManagerJs.instance) {
      SharedMemoryManagerJs.instance = new SharedMemoryManagerJs();
    }
    return SharedMemoryManagerJs.instance;
  }
  
  /**
   * Create a new buffer for market data
   * @param name Buffer name (must be unique)
   * @param config Buffer configuration
   * @returns true if successful
   */
  public createBuffer(name: string, config: Partial<BufferConfig> = {}): boolean {
    try {
      if (this.buffers.has(name)) {
        logger.warn(`Buffer with name '${name}' already exists`);
        return false;
      }
      
      const finalConfig: BufferConfig = {
        ...DEFAULT_BUFFER_CONFIG,
        ...config
      };
      
      this.buffers.set(name, new RingBuffer<any>(finalConfig));
      
      telemetry.recordMetric('shared_memory_manager.create_buffer', 1, {
        buffer_name: name,
        buffer_type: finalConfig.bufferType,
        capacity: finalConfig.capacity.toString(),
        implementation: 'javascript'
      });
      
      return true;
    } catch (error) {
      logger.error(`Error creating buffer '${name}': ${error}`);
      return false;
    }
  }
  
  /**
   * Push market data to a buffer
   * @param bufferName Name of the buffer
   * @param data Data to push (must be JSON serializable)
   * @returns Sequence number of the pushed data or -1 if error
   */
  public push(bufferName: string, data: any): number {
    try {
      const buffer = this.buffers.get(bufferName);
      if (!buffer) {
        logger.warn(`Buffer '${bufferName}' not found`);
        return -1;
      }
      
      // Clone the data to avoid modifying the original
      const clonedData = this.deepClone(data);
      const sequence = buffer.push(clonedData);
      
      telemetry.recordMetric('shared_memory_manager.push', 1, {
        buffer_name: bufferName,
        implementation: 'javascript'
      });
      
      return sequence;
    } catch (error) {
      logger.error(`Error pushing to buffer '${bufferName}': ${error}`);
      return -1;
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
      const buffer = this.buffers.get(bufferName);
      if (!buffer) {
        logger.warn(`Buffer '${bufferName}' not found`);
        return [];
      }
      
      const sequences: number[] = [];
      
      for (const item of items) {
        // Clone the data to avoid modifying the original
        const clonedItem = this.deepClone(item);
        sequences.push(buffer.push(clonedItem));
      }
      
      telemetry.recordMetric('shared_memory_manager.push_batch', 1, {
        buffer_name: bufferName,
        count: items.length.toString(),
        implementation: 'javascript'
      });
      
      return sequences;
    } catch (error) {
      logger.error(`Error pushing batch to buffer '${bufferName}': ${error}`);
      return [];
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
      const buffer = this.buffers.get(bufferName);
      if (!buffer) {
        logger.warn(`Buffer '${bufferName}' not found`);
        return [];
      }
      
      const items = buffer.getRecent(limit);
      
      telemetry.recordMetric('shared_memory_manager.get_recent', 1, {
        buffer_name: bufferName,
        limit: limit.toString(),
        count_returned: items.length.toString(),
        implementation: 'javascript'
      });
      
      return this.deepClone(items);
    } catch (error) {
      logger.error(`Error getting recent data from buffer '${bufferName}': ${error}`);
      return [];
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
      const buffer = this.buffers.get(bufferName);
      if (!buffer) {
        logger.warn(`Buffer '${bufferName}' not found`);
        return [];
      }
      
      const items = buffer.getAfterSequence(sequence);
      
      telemetry.recordMetric('shared_memory_manager.get_after_sequence', 1, {
        buffer_name: bufferName,
        sequence: sequence.toString(),
        count_returned: items.length.toString(),
        implementation: 'javascript'
      });
      
      return this.deepClone(items);
    } catch (error) {
      logger.error(`Error getting data after sequence from buffer '${bufferName}': ${error}`);
      return [];
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
      const buffer = this.buffers.get(bufferName);
      if (!buffer) {
        logger.warn(`Buffer '${bufferName}' not found`);
        return [];
      }
      
      const items = buffer.getAfterTimestamp(timestamp);
      
      telemetry.recordMetric('shared_memory_manager.get_after_timestamp', 1, {
        buffer_name: bufferName,
        timestamp: timestamp.toString(),
        count_returned: items.length.toString(),
        implementation: 'javascript'
      });
      
      return this.deepClone(items);
    } catch (error) {
      logger.error(`Error getting data after timestamp from buffer '${bufferName}': ${error}`);
      return [];
    }
  }
  
  /**
   * Clear all data from a buffer
   * @param bufferName Name of the buffer
   * @returns true if successful
   */
  public clearBuffer(bufferName: string): boolean {
    try {
      const buffer = this.buffers.get(bufferName);
      if (!buffer) {
        logger.warn(`Buffer '${bufferName}' not found`);
        return false;
      }
      
      buffer.clear();
      
      telemetry.recordMetric('shared_memory_manager.clear_buffer', 1, {
        buffer_name: bufferName,
        implementation: 'javascript'
      });
      
      return true;
    } catch (error) {
      logger.error(`Error clearing buffer '${bufferName}': ${error}`);
      return false;
    }
  }
  
  /**
   * List all buffers
   * @returns Array of buffer names
   */
  public listBuffers(): string[] {
    try {
      const bufferNames = Array.from(this.buffers.keys());
      
      telemetry.recordMetric('shared_memory_manager.list_buffers', 1, {
        count: bufferNames.length.toString(),
        implementation: 'javascript'
      });
      
      return bufferNames;
    } catch (error) {
      logger.error(`Error listing buffers: ${error}`);
      return [];
    }
  }
  
  /**
   * Remove a buffer
   * @param bufferName Name of the buffer to remove
   * @returns true if successful
   */
  public removeBuffer(bufferName: string): boolean {
    try {
      const existed = this.buffers.delete(bufferName);
      
      if (existed) {
        telemetry.recordMetric('shared_memory_manager.remove_buffer', 1, {
          buffer_name: bufferName,
          implementation: 'javascript'
        });
      }
      
      return existed;
    } catch (error) {
      logger.error(`Error removing buffer '${bufferName}': ${error}`);
      return false;
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
      // Create a SharedArrayBuffer
      const sharedBuffer = new SharedArrayBuffer(byteLength);
      
      // Return a view to the buffer
      return new Float64Array(sharedBuffer);
    } catch (error) {
      logger.error(`Error creating SharedArrayBuffer: ${error}`);
      // Fall back to regular ArrayBuffer
      return new Float64Array(byteLength / 8);
    }
  }
  
  /**
   * Create a market data buffer with binary format optimized for performance
   * @param name Buffer name
   * @param itemSchema Schema defining the binary layout
   * @returns true if successful
   */
  public createBinaryBuffer(name: string, itemSchema: { [key: string]: string }): boolean {
    // For JavaScript implementation, we're just creating a regular buffer
    return this.createBuffer(name, {
      bufferType: BufferType.MarketData,
      capacity: 10000, // Binary buffers can efficiently hold more items
    });
  }
  
  /**
   * Deep clone an object to avoid reference issues
   * @param obj Object to clone
   * @returns Cloned object
   * @private
   */
  private deepClone<T>(obj: T): T {
    // Use structured clone if available (modern browsers and Node.js)
    if (typeof structuredClone === 'function') {
      return structuredClone(obj);
    }
    
    // Fall back to JSON.parse/stringify for older environments
    return JSON.parse(JSON.stringify(obj));
  }
}

/**
 * JavaScript fallback implementation of BatchProcessor
 * Provides efficient batch processing of data
 */
export class BatchProcessorJs<T, R> {
  private pendingItems: T[] = [];
  private maxBatchSize: number;
  
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
    this.maxBatchSize = maxBatchSize;
    
    telemetry.recordMetric('batch_processor.initialization', 1, {
      implementation: 'javascript',
      max_batch_size: maxBatchSize.toString()
    });
  }
  
  /**
   * Add an item to the batch
   * @param item Item to add
   * @returns true if the batch is now full
   */
  public addItem(item: T): boolean {
    try {
      this.pendingItems.push(item);
      
      // Return true if batch is full
      return this.pendingItems.length >= this.maxBatchSize;
    } catch (error) {
      logger.error(`Error adding item to batch: ${error}`);
      return false;
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
      if (this.pendingItems.length === 0) {
        return { successes: [], failures: [], totalTimeUs: 0 };
      }
      
      // Copy the pending items and clear the original array
      const batch = [...this.pendingItems];
      this.pendingItems = [];
      
      // Measure processing time
      const startTime = performance.now();
      const result = this.processorFn(batch);
      const endTime = performance.now();
      
      // Convert time to microseconds (1ms = 1000us)
      const totalTimeUs = Math.round((endTime - startTime) * 1000);
      
      telemetry.recordMetric('batch_processor.process_batch', batch.length, {
        implementation: 'javascript',
        success_count: result.successes.length.toString(),
        failure_count: result.failures.length.toString(),
        time_us: totalTimeUs.toString()
      });
      
      return {
        successes: result.successes,
        failures: result.failures,
        totalTimeUs
      };
    } catch (error) {
      logger.error(`Error processing batch: ${error}`);
      
      // Return all items as failures
      const failures = this.pendingItems.map(item => ({
        value: item,
        error: `Batch processing error: ${error}`
      }));
      
      // Clear pending items
      this.pendingItems = [];
      
      return {
        successes: [],
        failures,
        totalTimeUs: 0
      };
    }
  }
  
  /**
   * Get the number of pending items
   * @returns Number of pending items
   */
  public pendingCount(): number {
    return this.pendingItems.length;
  }
  
  /**
   * Clear all pending items
   */
  public clearPending(): void {
    try {
      const count = this.pendingItems.length;
      this.pendingItems = [];
      
      telemetry.recordMetric('batch_processor.clear_pending', 1, {
        implementation: 'javascript',
        item_count: count.toString()
      });
    } catch (error) {
      logger.error(`Error clearing pending items: ${error}`);
    }
  }
} 