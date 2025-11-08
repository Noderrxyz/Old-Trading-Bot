/**
 * Custom error classes for the data pipeline
 */

/**
 * Base class for all data-related errors
 */
export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataError';
  }
}

/**
 * Error thrown when an exchange API request fails
 */
export class ExchangeAPIError extends DataError {
  constructor(
    message: string,
    public exchange: string,
    public endpoint?: string,
    public statusCode?: number,
    public originalError?: Error
  ) {
    super(`Exchange API Error (${exchange}): ${message}`);
    this.name = 'ExchangeAPIError';
  }
}

/**
 * Error thrown when data validation fails
 */
export class InvalidDataError extends DataError {
  constructor(
    message: string,
    public dataType: string,
    public validationErrors?: any[]
  ) {
    super(`Invalid ${dataType} data: ${message}`);
    this.name = 'InvalidDataError';
  }
}

/**
 * Error thrown when a rate limit is exceeded
 */
export class RateLimitError extends ExchangeAPIError {
  constructor(
    message: string,
    exchange: string,
    public retryAfterMs?: number
  ) {
    super(`Rate limit exceeded: ${message}`, exchange);
    this.name = 'RateLimitError';
  }
}

/**
 * Error thrown when authentication fails
 */
export class AuthenticationError extends ExchangeAPIError {
  constructor(
    message: string,
    exchange: string
  ) {
    super(`Authentication failed: ${message}`, exchange);
    this.name = 'AuthenticationError';
  }
}

/**
 * Error thrown when a requested symbol is not supported
 */
export class SymbolNotSupportedError extends DataError {
  constructor(
    public symbol: string,
    public exchange?: string
  ) {
    super(`Symbol ${symbol} is not supported${exchange ? ` by ${exchange}` : ''}`);
    this.name = 'SymbolNotSupportedError';
  }
}

/**
 * Error thrown when a connection to an exchange fails
 */
export class ConnectionError extends DataError {
  constructor(
    message: string,
    public exchange?: string,
    public originalError?: Error
  ) {
    super(`Connection error${exchange ? ` to ${exchange}` : ''}: ${message}`);
    this.name = 'ConnectionError';
  }
}

/**
 * Error thrown when data cannot be found in cache
 */
export class CacheError extends DataError {
  constructor(
    message: string,
    public cacheKey?: string
  ) {
    super(`Cache error: ${message}`);
    this.name = 'CacheError';
  }
}

/**
 * Error thrown when WebSocket connection fails or drops
 */
export class WebSocketError extends ConnectionError {
  constructor(
    message: string,
    public exchange: string,
    public code?: number,
    public reason?: string
  ) {
    super(`WebSocket error: ${message}`, exchange);
    this.name = 'WebSocketError';
  }
}

/**
 * Error thrown when subscription to a data feed fails
 */
export class SubscriptionError extends DataError {
  constructor(
    message: string,
    public exchange: string,
    public symbol?: string,
    public channel?: string
  ) {
    super(`Subscription error: ${message}`);
    this.name = 'SubscriptionError';
  }
}

/**
 * Helper function to wrap API calls with retry logic
 * @param fn Function to retry
 * @param maxRetries Maximum number of retries
 * @param initialDelayMs Initial delay in milliseconds
 * @param shouldRetry Function to determine if error should trigger a retry
 * @returns Promise with the result or last error
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelayMs = 1000,
  shouldRetry = (error: Error): boolean => {
    // By default, retry all network errors and rate limit errors
    return (
      error instanceof ConnectionError ||
      error instanceof RateLimitError ||
      (error instanceof ExchangeAPIError && error.statusCode !== 400 && error.statusCode !== 401)
    );
  }
): Promise<T> {
  let lastError: Error = new Error('Unknown error occurred');
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt === maxRetries || !shouldRetry(lastError)) {
        throw lastError;
      }
      
      // Calculate backoff delay with exponential strategy
      const delay = initialDelayMs * Math.pow(2, attempt);
      
      // If rate limit error has a retryAfter, use that instead
      if (lastError instanceof RateLimitError) {
        const rateLimitError = lastError as RateLimitError;
        if (rateLimitError.retryAfterMs) {
          await new Promise(resolve => setTimeout(resolve, rateLimitError.retryAfterMs));
          continue;
        }
      }
      
      // Default exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // This should never be reached due to the throw in the loop, but TypeScript needs it
  throw lastError;
} 