/**
 * Capital Error Handling - Comprehensive error management for capital operations
 * 
 * Features:
 * - CapitalSyncFailure enum for categorizing errors
 * - Retry logic with exponential backoff
 * - Transaction-safe memory cache for pending operations
 * - Operation recovery mechanisms
 */

import { EventEmitter } from 'events';

export enum CapitalSyncFailure {
  // Write operation failures
  WRITE_ERROR = 'WRITE_ERROR',
  PERSISTENCE_FAILED = 'PERSISTENCE_FAILED',
  STATE_CORRUPTION = 'STATE_CORRUPTION',
  
  // Data consistency failures
  MISSING_SYMBOL_DATA = 'MISSING_SYMBOL_DATA',
  INVALID_POSITION_DATA = 'INVALID_POSITION_DATA',
  NEGATIVE_CAPITAL = 'NEGATIVE_CAPITAL',
  
  // Capital mismatch failures
  CAPITAL_MISMATCH = 'CAPITAL_MISMATCH',
  INSUFFICIENT_CAPITAL = 'INSUFFICIENT_CAPITAL',
  ALLOCATION_OVERFLOW = 'ALLOCATION_OVERFLOW',
  
  // Agent-related failures
  AGENT_NOT_FOUND = 'AGENT_NOT_FOUND',
  AGENT_STATE_INVALID = 'AGENT_STATE_INVALID',
  DUPLICATE_AGENT = 'DUPLICATE_AGENT',
  
  // Operational failures
  DECOMMISSION_FAILED = 'DECOMMISSION_FAILED',
  POSITION_UPDATE_FAILED = 'POSITION_UPDATE_FAILED',
  ORDER_CANCELLATION_FAILED = 'ORDER_CANCELLATION_FAILED',
  
  // System failures
  TIMEOUT = 'TIMEOUT',
  CIRCUIT_BREAKER_OPEN = 'CIRCUIT_BREAKER_OPEN',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export interface CapitalOperation {
  id: string;
  type: 'REGISTER_AGENT' | 'UPDATE_POSITION' | 'DECOMMISSION' | 'REBALANCE' | 'PERSIST_STATE';
  agentId?: string;
  data: any;
  timestamp: number;
  attempts: number;
  lastError?: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
}

export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  timeoutMs: number;
}

export class PendingOperationsCache extends EventEmitter {
  private operations: Map<string, CapitalOperation> = new Map();
  private processingQueue: string[] = [];
  private retryConfig: RetryConfig;
  private retryTimers: Map<string, NodeJS.Timeout> = new Map();
  private circuitBreakerOpen: boolean = false;
  private consecutiveFailures: number = 0;
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private readonly CIRCUIT_BREAKER_RESET_TIME = 60000; // 1 minute
  
  constructor(retryConfig?: Partial<RetryConfig>) {
    super();
    this.retryConfig = {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
      timeoutMs: 30000,
      ...retryConfig
    };
  }
  
  /**
   * Add operation to cache for retry
   */
  addOperation(operation: Omit<CapitalOperation, 'id' | 'timestamp' | 'attempts' | 'status'>): string {
    const id = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fullOperation: CapitalOperation = {
      ...operation,
      id,
      timestamp: Date.now(),
      attempts: 0,
      status: 'PENDING'
    };
    
    this.operations.set(id, fullOperation);
    this.processingQueue.push(id);
    
    this.emit('operation-added', { operation: fullOperation });
    
    // Start processing if not in circuit breaker
    if (!this.circuitBreakerOpen) {
      this.processNext();
    }
    
    return id;
  }
  
  /**
   * Process next operation in queue
   */
  private async processNext(): Promise<void> {
    if (this.processingQueue.length === 0) return;
    
    const operationId = this.processingQueue[0];
    const operation = this.operations.get(operationId);
    
    if (!operation || operation.status === 'PROCESSING') return;
    
    operation.status = 'PROCESSING';
    operation.attempts++;
    
    this.emit('operation-processing', { operation });
  }
  
  /**
   * Mark operation as successful
   */
  markSuccess(operationId: string): void {
    const operation = this.operations.get(operationId);
    if (!operation) return;
    
    operation.status = 'SUCCESS';
    this.operations.delete(operationId);
    this.processingQueue = this.processingQueue.filter(id => id !== operationId);
    
    // Clear retry timer if exists
    const timer = this.retryTimers.get(operationId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(operationId);
    }
    
    // Reset consecutive failures
    this.consecutiveFailures = 0;
    
    this.emit('operation-success', { operationId });
    
    // Process next
    this.processNext();
  }
  
  /**
   * Mark operation as failed and schedule retry
   */
  markFailed(operationId: string, error: string, syncFailure: CapitalSyncFailure): void {
    const operation = this.operations.get(operationId);
    if (!operation) return;
    
    operation.status = 'FAILED';
    operation.lastError = error;
    this.consecutiveFailures++;
    
    this.emit('operation-failed', {
      operationId,
      error,
      syncFailure,
      attempts: operation.attempts
    });
    
    // Check if we should retry
    if (operation.attempts >= this.retryConfig.maxAttempts) {
      this.emit('operation-exhausted', {
        operation,
        error,
        syncFailure
      });
      
      this.operations.delete(operationId);
      this.processingQueue = this.processingQueue.filter(id => id !== operationId);
      
      // Check circuit breaker
      if (this.consecutiveFailures >= this.CIRCUIT_BREAKER_THRESHOLD) {
        this.openCircuitBreaker();
      }
      
      return;
    }
    
    // Schedule retry with exponential backoff
    const delay = Math.min(
      this.retryConfig.initialDelay * Math.pow(this.retryConfig.backoffMultiplier, operation.attempts - 1),
      this.retryConfig.maxDelay
    );
    
    operation.status = 'PENDING';
    
    const timer = setTimeout(() => {
      this.retryTimers.delete(operationId);
      this.processNext();
    }, delay);
    
    this.retryTimers.set(operationId, timer);
    
    this.emit('operation-retry-scheduled', {
      operationId,
      delay,
      attempt: operation.attempts + 1
    });
  }
  
  /**
   * Open circuit breaker
   */
  private openCircuitBreaker(): void {
    this.circuitBreakerOpen = true;
    
    this.emit('circuit-breaker-open', {
      failures: this.consecutiveFailures,
      timestamp: Date.now()
    });
    
    // Schedule circuit breaker reset
    setTimeout(() => {
      this.circuitBreakerOpen = false;
      this.consecutiveFailures = 0;
      
      this.emit('circuit-breaker-reset', {
        timestamp: Date.now()
      });
      
      // Resume processing
      this.processNext();
    }, this.CIRCUIT_BREAKER_RESET_TIME);
  }
  
  /**
   * Get pending operations
   */
  getPendingOperations(): CapitalOperation[] {
    return Array.from(this.operations.values())
      .filter(op => op.status === 'PENDING' || op.status === 'PROCESSING');
  }
  
  /**
   * Get operation by ID
   */
  getOperation(operationId: string): CapitalOperation | undefined {
    return this.operations.get(operationId);
  }
  
  /**
   * Clear all operations
   */
  clear(): void {
    // Clear all retry timers
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    
    this.operations.clear();
    this.processingQueue = [];
    this.retryTimers.clear();
    this.consecutiveFailures = 0;
    this.circuitBreakerOpen = false;
  }
  
  /**
   * Get cache statistics
   */
  getStats(): {
    pending: number;
    processing: number;
    failed: number;
    circuitBreakerOpen: boolean;
    consecutiveFailures: number;
  } {
    const operations = Array.from(this.operations.values());
    
    return {
      pending: operations.filter(op => op.status === 'PENDING').length,
      processing: operations.filter(op => op.status === 'PROCESSING').length,
      failed: operations.filter(op => op.status === 'FAILED').length,
      circuitBreakerOpen: this.circuitBreakerOpen,
      consecutiveFailures: this.consecutiveFailures
    };
  }
}

/**
 * Error wrapper with retry support
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  cache?: PendingOperationsCache,
  options?: {
    maxAttempts?: number;
    onError?: (error: any, attempt: number) => void;
  }
): Promise<T> {
  const maxAttempts = options?.maxAttempts || 3;
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      if (options?.onError) {
        options.onError(error, attempt);
      }
      
      if (attempt < maxAttempts) {
        // Calculate delay with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

/**
 * Classify error into CapitalSyncFailure category
 */
export function classifyError(error: any): CapitalSyncFailure {
  const message = error?.message?.toLowerCase() || '';
  
  if (message.includes('write') || message.includes('persist')) {
    return CapitalSyncFailure.WRITE_ERROR;
  }
  
  if (message.includes('symbol') || message.includes('missing')) {
    return CapitalSyncFailure.MISSING_SYMBOL_DATA;
  }
  
  if (message.includes('insufficient') || message.includes('not enough')) {
    return CapitalSyncFailure.INSUFFICIENT_CAPITAL;
  }
  
  if (message.includes('mismatch') || message.includes('inconsistent')) {
    return CapitalSyncFailure.CAPITAL_MISMATCH;
  }
  
  if (message.includes('agent') && message.includes('not found')) {
    return CapitalSyncFailure.AGENT_NOT_FOUND;
  }
  
  if (message.includes('timeout')) {
    return CapitalSyncFailure.TIMEOUT;
  }
  
  if (message.includes('negative') || message.includes('invalid')) {
    return CapitalSyncFailure.NEGATIVE_CAPITAL;
  }
  
  return CapitalSyncFailure.UNKNOWN_ERROR;
}

/**
 * Validate capital state consistency
 */
export function validateCapitalState(state: {
  totalCapital: number;
  reserveCapital: number;
  allocatedCapital: number;
  agentAllocations: Map<string, number>;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Check for negative values
  if (state.totalCapital < 0) {
    errors.push('Total capital cannot be negative');
  }
  
  if (state.reserveCapital < 0) {
    errors.push('Reserve capital cannot be negative');
  }
  
  // Check capital consistency
  const totalAllocated = Array.from(state.agentAllocations.values())
    .reduce((sum, amount) => sum + amount, 0);
    
  if (Math.abs(totalAllocated - state.allocatedCapital) > 0.01) {
    errors.push(`Capital mismatch: allocated=${state.allocatedCapital}, sum=${totalAllocated}`);
  }
  
  const expectedTotal = state.reserveCapital + state.allocatedCapital;
  if (Math.abs(expectedTotal - state.totalCapital) > 0.01) {
    errors.push(`Total capital mismatch: expected=${expectedTotal}, actual=${state.totalCapital}`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
} 