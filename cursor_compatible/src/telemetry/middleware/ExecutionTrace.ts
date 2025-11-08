import { telemetry, SeverityLevel } from '../Telemetry';

/**
 * Options for trace decorator
 */
export interface TraceOptions {
  /**
   * Name of the component
   */
  component: string;

  /**
   * Category of the function
   */
  category?: string;

  /**
   * Custom tags to add to metrics
   */
  tags?: Record<string, string>;

  /**
   * Whether to record successful executions
   */
  recordSuccess?: boolean;

  /**
   * Whether to record errors
   */
  recordErrors?: boolean;

  /**
   * Error severity level
   */
  errorSeverity?: SeverityLevel;
}

/**
 * Default trace options
 */
const defaultTraceOptions: Partial<TraceOptions> = {
  category: 'unknown',
  recordSuccess: true,
  recordErrors: true,
  errorSeverity: SeverityLevel.ERROR
};

/**
 * Execution trace context
 */
interface TraceContext {
  method: string;
  component: string;
  category: string;
  tags: Record<string, string>;
  startTime: number;
}

/**
 * Decorator for tracing method execution
 * @param options Trace options
 */
export function trace(options: TraceOptions) {
  return function(
    target: any,
    methodName: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const component = options.component;
    const category = options.category || defaultTraceOptions.category;
    const recordSuccess = options.recordSuccess ?? defaultTraceOptions.recordSuccess;
    const recordErrors = options.recordErrors ?? defaultTraceOptions.recordErrors;
    const errorSeverity = options.errorSeverity ?? defaultTraceOptions.errorSeverity;
    const tags = options.tags || {};

    descriptor.value = function(...args: any[]) {
      const startTime = performance.now();
      const context: TraceContext = {
        method: methodName,
        component,
        category: category!,
        tags: { ...tags },
        startTime
      };

      try {
        const result = originalMethod.apply(this, args);

        // Handle promises
        if (result instanceof Promise) {
          return result
            .then((value) => {
              recordTraceSuccess(context);
              return value;
            })
            .catch((error) => {
              recordTraceError(context, error, errorSeverity!);
              throw error;
            });
        }

        // Handle synchronous results
        recordTraceSuccess(context);
        return result;
      } catch (error) {
        recordTraceError(context, error, errorSeverity!);
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Record successful method execution
 */
function recordTraceSuccess(context: TraceContext): void {
  const duration = performance.now() - context.startTime;
  
  telemetry.recordMetric(
    `${context.component}.${context.category}.${context.method}.duration_ms`,
    duration,
    {
      component: context.component,
      category: context.category,
      method: context.method,
      ...context.tags
    }
  );
  
  telemetry.recordMetric(
    `${context.component}.${context.category}.${context.method}.success_count`,
    1,
    {
      component: context.component,
      category: context.category,
      method: context.method,
      ...context.tags
    }
  );
}

/**
 * Record failed method execution
 */
function recordTraceError(
  context: TraceContext,
  error: any,
  severity: SeverityLevel
): void {
  const duration = performance.now() - context.startTime;
  
  // Record latency even for errors
  telemetry.recordMetric(
    `${context.component}.${context.category}.${context.method}.duration_ms`,
    duration,
    {
      component: context.component,
      category: context.category,
      method: context.method,
      status: 'error',
      ...context.tags
    }
  );
  
  // Record error count
  telemetry.recordMetric(
    `${context.component}.${context.category}.${context.method}.error_count`,
    1,
    {
      component: context.component,
      category: context.category,
      method: context.method,
      error_type: error.name || 'Error',
      ...context.tags
    }
  );
  
  // Record error
  telemetry.recordError(
    context.component,
    error,
    severity,
    {
      category: context.category,
      method: context.method,
      ...context.tags
    }
  );
}

/**
 * Helper for tracing standalone functions
 */
export class TraceFunctions {
  /**
   * Trace a function execution
   */
  static async traceAsync<T>(
    component: string,
    methodName: string,
    func: () => Promise<T>,
    options: Partial<TraceOptions> = {}
  ): Promise<T> {
    const category = options.category || defaultTraceOptions.category;
    const recordSuccess = options.recordSuccess ?? defaultTraceOptions.recordSuccess;
    const recordErrors = options.recordErrors ?? defaultTraceOptions.recordErrors;
    const errorSeverity = options.errorSeverity ?? defaultTraceOptions.errorSeverity;
    const tags = options.tags || {};
    
    const context: TraceContext = {
      method: methodName,
      component,
      category: category!,
      tags,
      startTime: performance.now()
    };
    
    try {
      const result = await func();
      if (recordSuccess) {
        recordTraceSuccess(context);
      }
      return result;
    } catch (error) {
      if (recordErrors) {
        recordTraceError(context, error, errorSeverity!);
      }
      throw error;
    }
  }
  
  /**
   * Trace a synchronous function execution
   */
  static traceSync<T>(
    component: string,
    methodName: string,
    func: () => T,
    options: Partial<TraceOptions> = {}
  ): T {
    const category = options.category || defaultTraceOptions.category;
    const recordSuccess = options.recordSuccess ?? defaultTraceOptions.recordSuccess;
    const recordErrors = options.recordErrors ?? defaultTraceOptions.recordErrors;
    const errorSeverity = options.errorSeverity ?? defaultTraceOptions.errorSeverity;
    const tags = options.tags || {};
    
    const context: TraceContext = {
      method: methodName,
      component,
      category: category!,
      tags,
      startTime: performance.now()
    };
    
    try {
      const result = func();
      if (recordSuccess) {
        recordTraceSuccess(context);
      }
      return result;
    } catch (error) {
      if (recordErrors) {
        recordTraceError(context, error, errorSeverity!);
      }
      throw error;
    }
  }
} 