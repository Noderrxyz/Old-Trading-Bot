/**
 * Utility to manage fallbacks between native and JavaScript implementations
 */

/** Error thrown when a native module fails */
export class NativeModuleError extends Error {
  public readonly moduleName: string;
  public readonly originalError: Error;

  constructor(moduleName: string, originalError: Error) {
    super(`Native module '${moduleName}' failed: ${originalError.message}`);
    this.name = 'NativeModuleError';
    this.moduleName = moduleName;
    this.originalError = originalError;
    
    // Maintain proper stack trace in Node.js
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NativeModuleError);
    }
  }
}

/** Tracks fallback strategy usage */
export interface FallbackMetrics {
  name: string;
  nativeSuccessCount: number;
  nativeTotalMs: number;
  fallbackCount: number;
  fallbackTotalMs: number;
  permanentFallback: boolean;
  lastSwitchTimestamp: number;
  fallbackErrors: Record<string, number>;
}

/** Global fallback metrics registry */
const fallbackMetrics: Record<string, FallbackMetrics> = {};

/**
 * Get metrics for all fallback strategies
 */
export function getFallbackMetrics(): FallbackMetrics[] {
  return Object.values(fallbackMetrics);
}

/**
 * Get metrics for a specific fallback strategy
 * @param name Strategy name
 */
export function getStrategyMetrics(name: string): FallbackMetrics | null {
  return fallbackMetrics[name] || null;
}

/**
 * Reset all fallback metrics
 */
export function resetFallbackMetrics(): void {
  Object.keys(fallbackMetrics).forEach(key => {
    const metrics = fallbackMetrics[key];
    metrics.nativeSuccessCount = 0;
    metrics.nativeTotalMs = 0;
    metrics.fallbackCount = 0;
    metrics.fallbackTotalMs = 0;
    metrics.fallbackErrors = {};
  });
}

/** Configuration for native fallback behavior */
export interface FallbackOptions {
  /** Name of the module for logging and metrics */
  name: string;
  
  /** Maximum number of consecutive native failures before using fallback */
  maxConsecutiveFailures?: number;
  
  /** If true, permanently switch to fallback after maxConsecutiveFailures */
  permanentFallbackAfterMaxFailures?: boolean;
  
  /** Log errors to console */
  logErrors?: boolean;
  
  /** Collect metrics on fallback usage */
  collectMetrics?: boolean;
}

const DEFAULT_OPTIONS: FallbackOptions = {
  name: 'unknown',
  maxConsecutiveFailures: 3,
  permanentFallbackAfterMaxFailures: false,
  logErrors: true,
  collectMetrics: true,
};

/**
 * Try to use a native implementation, falling back to JavaScript if it fails
 * @param options Fallback options
 * @param nativeImpl Native implementation function
 * @param fallbackImpl JavaScript fallback implementation function
 * @param args Arguments to pass to both implementations
 * @returns Result from either native or fallback implementation
 */
export async function tryNativeOrFallback<T, Args extends any[]>(
  options: FallbackOptions,
  nativeImpl: (...args: Args) => Promise<T> | T,
  fallbackImpl: (...args: Args) => Promise<T> | T,
  ...args: Args
): Promise<T> {
  const finalOptions = { ...DEFAULT_OPTIONS, ...options };
  const { name, maxConsecutiveFailures, permanentFallbackAfterMaxFailures, logErrors, collectMetrics } = finalOptions;
  
  // Initialize metrics if needed
  if (collectMetrics && !fallbackMetrics[name]) {
    fallbackMetrics[name] = {
      name,
      nativeSuccessCount: 0,
      nativeTotalMs: 0,
      fallbackCount: 0,
      fallbackTotalMs: 0,
      permanentFallback: false,
      lastSwitchTimestamp: 0,
      fallbackErrors: {},
    };
  }
  
  const metrics = fallbackMetrics[name];
  
  // Check if we're permanently using fallback
  if (metrics?.permanentFallback) {
    return useFallback();
  }
  
  try {
    // Try to use the native implementation
    const startTime = performance.now();
    const result = await nativeImpl(...args);
    const endTime = performance.now();
    
    // Update metrics
    if (collectMetrics && metrics) {
      metrics.nativeSuccessCount++;
      metrics.nativeTotalMs += (endTime - startTime);
    }
    
    return result;
  } catch (error: any) {
    // Native implementation failed, use fallback
    if (logErrors) {
      console.error(`Native implementation '${name}' failed:`, error);
    }
    
    // Update metrics
    if (collectMetrics && metrics) {
      // Track error types
      const errorType = error.name || 'Unknown';
      metrics.fallbackErrors[errorType] = (metrics.fallbackErrors[errorType] || 0) + 1;
      
      // Check for consecutive failures
      if (metrics.fallbackErrors[errorType] >= maxConsecutiveFailures! && permanentFallbackAfterMaxFailures) {
        metrics.permanentFallback = true;
        metrics.lastSwitchTimestamp = Date.now();
        
        if (logErrors) {
          console.warn(`Permanently switching to fallback for '${name}' after ${maxConsecutiveFailures} consecutive failures`);
        }
      }
    }
    
    return useFallback();
  }
  
  async function useFallback(): Promise<T> {
    const startTime = performance.now();
    try {
      const result = await fallbackImpl(...args);
      const endTime = performance.now();
      
      // Update metrics
      if (collectMetrics && metrics) {
        metrics.fallbackCount++;
        metrics.fallbackTotalMs += (endTime - startTime);
      }
      
      return result;
    } catch (fallbackError: any) {
      // Both implementations failed
      if (logErrors) {
        console.error(`Fallback implementation '${name}' also failed:`, fallbackError);
      }
      
      // Re-throw the fallback error
      throw fallbackError;
    }
  }
}

/**
 * Try to use a native module or fallback to JavaScript
 * @param name Module name
 * @param nativeModule Native module (null if unavailable)
 * @param fallbackModule JavaScript fallback module
 * @returns Either the native module or fallback
 */
export function tryNativeModuleOrFallback<T>(
  name: string,
  nativeModule: T | null | undefined,
  fallbackModule: T
): T {
  if (!nativeModule) {
    console.warn(`Native module '${name}' not available, using fallback`);
    return fallbackModule;
  }
  
  return nativeModule;
}

/**
 * Create a wrapper around a native module that falls back to JavaScript
 * @param options Fallback options
 * @param nativeModule Native module (or null if unavailable)
 * @param fallbackModule JavaScript fallback module
 * @returns Proxy that tries native first, then fallback
 */
export function createFallbackProxy<T extends object>(
  options: FallbackOptions,
  nativeModule: T | null | undefined,
  fallbackModule: T
): T {
  const finalOptions = { ...DEFAULT_OPTIONS, ...options };
  
  // If native module is missing, just return the fallback
  if (!nativeModule) {
    if (finalOptions.logErrors) {
      console.warn(`Native module '${finalOptions.name}' not available, using fallback`);
    }
    return fallbackModule;
  }
  
  // Create a proxy that tries native first, then fallback
  return new Proxy({} as T, {
    get(target, prop, receiver) {
      const nativeMethod = Reflect.get(nativeModule, prop, receiver);
      const fallbackMethod = Reflect.get(fallbackModule, prop, receiver);
      
      // If the property isn't a function, return the native one
      if (typeof nativeMethod !== 'function' || typeof fallbackMethod !== 'function') {
        return nativeMethod !== undefined ? nativeMethod : fallbackMethod;
      }
      
      // Return a function that tries native first, then fallback
      return async function(...args: any[]) {
        return tryNativeOrFallback(
          { ...finalOptions, name: `${finalOptions.name}.${String(prop)}` },
          nativeMethod.bind(nativeModule),
          fallbackMethod.bind(fallbackModule),
          ...args
        );
      };
    }
  });
} 