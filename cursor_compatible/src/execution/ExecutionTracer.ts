import { logger } from '../utils/logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';

/**
 * Execution trace event types
 */
export enum TraceEventType {
  EXECUTION_START = 'execution_start',
  CHAIN_SELECTION = 'chain_selection',
  ADAPTER_CALL = 'adapter_call',
  BRIDGE_OPERATION = 'bridge_operation',
  MEV_PROTECTION = 'mev_protection',
  LIQUIDITY_QUERY = 'liquidity_query',
  RETRY_ATTEMPT = 'retry_attempt',
  EXECUTION_COMPLETE = 'execution_complete',
  ERROR_OCCURRED = 'error_occurred'
}

/**
 * Execution trace event
 */
export interface TraceEvent {
  traceId: string;
  eventType: TraceEventType;
  timestamp: number;
  duration?: number;
  metadata: Record<string, any>;
  parentEventId?: string;
  chainId?: string;
  success?: boolean;
  error?: string;
}

/**
 * Execution trace context
 */
export interface TraceContext {
  traceId: string;
  startTime: number;
  strategyId: string;
  market: string;
  amount: number;
  chainPath: string[];
  events: TraceEvent[];
  metadata: Record<string, any>;
}

/**
 * Execution tracer for unified tracing across all modules
 */
export class ExecutionTracer {
  private static instance: ExecutionTracer | null = null;
  private activeTraces: Map<string, TraceContext> = new Map();
  private telemetryBus: TelemetryBus;
  private readonly TRACE_TTL = 3600000; // 1 hour

  private constructor() {
    this.telemetryBus = TelemetryBus.getInstance();
    
    // Start cleanup of old traces
    setInterval(() => this.cleanupOldTraces(), 300000); // Every 5 minutes
  }

  public static getInstance(): ExecutionTracer {
    if (!ExecutionTracer.instance) {
      ExecutionTracer.instance = new ExecutionTracer();
    }
    return ExecutionTracer.instance;
  }

  /**
   * Start a new execution trace
   */
  public startTrace(
    strategyId: string,
    market: string,
    amount: number,
    metadata: Record<string, any> = {}
  ): string {
    const traceId = this.generateTraceId();
    const startTime = Date.now();
    
    const context: TraceContext = {
      traceId,
      startTime,
      strategyId,
      market,
      amount,
      chainPath: [],
      events: [],
      metadata: {
        ...metadata,
        startTime
      }
    };
    
    this.activeTraces.set(traceId, context);
    
    // Add initial event
    this.addEvent(traceId, TraceEventType.EXECUTION_START, {
      strategyId,
      market,
      amount,
      ...metadata
    });
    
    logger.debug(`Started execution trace ${traceId}`, {
      strategyId,
      market,
      amount
    });
    
    return traceId;
  }

  /**
   * Add an event to a trace
   */
  public addEvent(
    traceId: string,
    eventType: TraceEventType,
    metadata: Record<string, any> = {},
    parentEventId?: string
  ): string {
    const trace = this.activeTraces.get(traceId);
    if (!trace) {
      logger.warn(`Trace ${traceId} not found`);
      return '';
    }
    
    const eventId = `${traceId}-${trace.events.length}`;
    const event: TraceEvent = {
      traceId,
      eventType,
      timestamp: Date.now(),
      metadata,
      parentEventId,
      chainId: metadata.chainId
    };
    
    trace.events.push(event);
    
    // Emit telemetry
    this.telemetryBus.emit('trace_event', {
      traceId,
      eventType,
      eventId,
      metadata,
      timestamp: event.timestamp
    });
    
    return eventId;
  }

  /**
   * Update an event with completion data
   */
  public completeEvent(
    traceId: string,
    eventId: string,
    success: boolean,
    metadata: Record<string, any> = {},
    error?: string
  ): void {
    const trace = this.activeTraces.get(traceId);
    if (!trace) return;
    
    const event = trace.events.find(e => `${traceId}-${trace.events.indexOf(e)}` === eventId);
    if (!event) return;
    
    event.success = success;
    event.duration = Date.now() - event.timestamp;
    event.metadata = { ...event.metadata, ...metadata };
    if (error) event.error = error;
    
    // Emit completion telemetry
    this.telemetryBus.emit('trace_event_completed', {
      traceId,
      eventId,
      success,
      duration: event.duration,
      error,
      timestamp: Date.now()
    });
  }

  /**
   * Add chain to execution path
   */
  public addChainToPath(traceId: string, chainId: string): void {
    const trace = this.activeTraces.get(traceId);
    if (!trace) return;
    
    if (!trace.chainPath.includes(chainId)) {
      trace.chainPath.push(chainId);
    }
  }

  /**
   * Complete a trace
   */
  public completeTrace(
    traceId: string,
    success: boolean,
    result: Record<string, any> = {},
    error?: string
  ): TraceContext | null {
    const trace = this.activeTraces.get(traceId);
    if (!trace) return null;
    
    const completionTime = Date.now();
    const totalDuration = completionTime - trace.startTime;
    
    // Add completion event
    this.addEvent(traceId, TraceEventType.EXECUTION_COMPLETE, {
      success,
      totalDuration,
      chainPath: trace.chainPath,
      eventCount: trace.events.length,
      ...result
    });
    
    // Update trace metadata
    trace.metadata.completedAt = completionTime;
    trace.metadata.totalDuration = totalDuration;
    trace.metadata.success = success;
    if (error) trace.metadata.error = error;
    
    // Emit completion telemetry
    this.telemetryBus.emit('trace_completed', {
      traceId,
      success,
      totalDuration,
      chainPath: trace.chainPath,
      eventCount: trace.events.length,
      strategyId: trace.strategyId,
      market: trace.market,
      amount: trace.amount,
      timestamp: completionTime
    });
    
    logger.info(`Completed execution trace ${traceId}`, {
      success,
      totalDuration,
      chainPath: trace.chainPath,
      eventCount: trace.events.length
    });
    
    // Keep trace for analysis but mark as completed
    trace.metadata.completed = true;
    
    return trace;
  }

  /**
   * Get trace context
   */
  public getTrace(traceId: string): TraceContext | null {
    return this.activeTraces.get(traceId) || null;
  }

  /**
   * Get all active traces
   */
  public getActiveTraces(): TraceContext[] {
    return Array.from(this.activeTraces.values())
      .filter(trace => !trace.metadata.completed);
  }

  /**
   * Get trace summary
   */
  public getTraceSummary(traceId: string): {
    traceId: string;
    duration: number;
    eventCount: number;
    chainPath: string[];
    success?: boolean;
    error?: string;
  } | null {
    const trace = this.activeTraces.get(traceId);
    if (!trace) return null;
    
    const duration = trace.metadata.completedAt 
      ? trace.metadata.totalDuration 
      : Date.now() - trace.startTime;
    
    return {
      traceId,
      duration,
      eventCount: trace.events.length,
      chainPath: trace.chainPath,
      success: trace.metadata.success,
      error: trace.metadata.error
    };
  }

  /**
   * Get execution analytics for a time period
   */
  public getExecutionAnalytics(
    startTime: number,
    endTime: number
  ): {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageDuration: number;
    chainUsage: Record<string, number>;
    commonErrors: Record<string, number>;
  } {
    const traces = Array.from(this.activeTraces.values())
      .filter(trace => 
        trace.startTime >= startTime && 
        trace.startTime <= endTime &&
        trace.metadata.completed
      );
    
    const totalExecutions = traces.length;
    const successfulExecutions = traces.filter(t => t.metadata.success).length;
    const failedExecutions = totalExecutions - successfulExecutions;
    
    const totalDuration = traces.reduce((sum, t) => sum + (t.metadata.totalDuration || 0), 0);
    const averageDuration = totalExecutions > 0 ? totalDuration / totalExecutions : 0;
    
    const chainUsage: Record<string, number> = {};
    const commonErrors: Record<string, number> = {};
    
    traces.forEach(trace => {
      // Count chain usage
      trace.chainPath.forEach(chainId => {
        chainUsage[chainId] = (chainUsage[chainId] || 0) + 1;
      });
      
      // Count errors
      if (trace.metadata.error) {
        const errorType = trace.metadata.error.split(':')[0]; // Get error type
        commonErrors[errorType] = (commonErrors[errorType] || 0) + 1;
      }
    });
    
    return {
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      averageDuration,
      chainUsage,
      commonErrors
    };
  }

  /**
   * Generate unique trace ID
   */
  private generateTraceId(): string {
    // Critical: replace Math.random with secure random
    const timestamp = Date.now().toString(36);
    const { randomId } = require('../utils/secureRandom');
    return `trace-${timestamp}-${randomId('', 8)}`;
  }

  /**
   * Clean up old traces
   */
  private cleanupOldTraces(): void {
    const cutoff = Date.now() - this.TRACE_TTL;
    let cleanedCount = 0;
    
    for (const [traceId, trace] of this.activeTraces) {
      if (trace.startTime < cutoff && trace.metadata.completed) {
        this.activeTraces.delete(traceId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      logger.debug(`Cleaned up ${cleanedCount} old traces`);
    }
  }

  /**
   * Export trace data for analysis
   */
  public exportTrace(traceId: string): TraceContext | null {
    const trace = this.activeTraces.get(traceId);
    if (!trace) return null;
    
    // Return a deep copy to prevent modification
    return JSON.parse(JSON.stringify(trace));
  }

  /**
   * Get system-wide tracing statistics
   */
  public getTracingStats(): {
    activeTraces: number;
    completedTraces: number;
    totalEvents: number;
    averageEventsPerTrace: number;
    memoryUsage: number;
  } {
    const allTraces = Array.from(this.activeTraces.values());
    const activeTraces = allTraces.filter(t => !t.metadata.completed).length;
    const completedTraces = allTraces.length - activeTraces;
    const totalEvents = allTraces.reduce((sum, t) => sum + t.events.length, 0);
    const averageEventsPerTrace = allTraces.length > 0 ? totalEvents / allTraces.length : 0;
    
    // Rough memory usage estimate
    const memoryUsage = JSON.stringify(allTraces).length;
    
    return {
      activeTraces,
      completedTraces,
      totalEvents,
      averageEventsPerTrace,
      memoryUsage
    };
  }
} 