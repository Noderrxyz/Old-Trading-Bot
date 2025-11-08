/**
 * ApiClient - HTTP client with retry logic, circuit breaking, and telemetry
 */

import { createLogger } from './logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';

const logger = createLogger('ApiClient');

export interface ApiClientConfig {
  baseUrl: string;
  timeout?: number;
  retries?: number;
  headers?: Record<string, string>;
  circuitBreakerThreshold?: number;
  circuitBreakerResetTime?: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
  params?: Record<string, any>;
  timeout?: number;
}

export class ApiClient {
  private config: Required<ApiClientConfig>;
  private telemetryBus: TelemetryBus;
  private circuitBreaker: Map<string, {
    failures: number;
    lastFailure: number;
    isOpen: boolean;
  }> = new Map();

  constructor(config: ApiClientConfig) {
    this.config = {
      timeout: 30000,
      retries: 3,
      headers: {},
      circuitBreakerThreshold: 5,
      circuitBreakerResetTime: 60000,
      ...config
    };
    this.telemetryBus = TelemetryBus.getInstance();
  }

  /**
   * Make a GET request
   */
  async get<T = any>(path: string, params?: Record<string, any>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  /**
   * Make a POST request
   */
  async post<T = any>(path: string, body?: any): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }

  /**
   * Make a PUT request
   */
  async put<T = any>(path: string, body?: any): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body });
  }

  /**
   * Make a DELETE request
   */
  async delete<T = any>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  /**
   * Make an HTTP request with retry logic
   */
  private async request<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.params);
    const endpoint = `${options.method || 'GET'} ${path}`;

    // Check circuit breaker
    if (this.isCircuitOpen(endpoint)) {
      throw new Error(`Circuit breaker is open for ${endpoint}`);
    }

    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        // Add delay for retries
        if (attempt > 0) {
          await this.delay(Math.min(1000 * Math.pow(2, attempt - 1), 10000));
          logger.info(`Retrying request ${endpoint} (attempt ${attempt + 1}/${this.config.retries + 1})`);
        }

        const response = await this.performRequest(url, options);
        
        // Record success
        this.recordSuccess(endpoint);
        
        // Emit telemetry
        this.telemetryBus.emit('api_request_success', {
          endpoint,
          url,
          duration: Date.now() - startTime,
          attempt: attempt + 1,
          timestamp: Date.now()
        });

        return response;
      } catch (error) {
        lastError = error as Error;
        logger.error(`Request failed ${endpoint}: ${lastError.message}`);
        
        // Record failure
        this.recordFailure(endpoint);
        
        // Emit telemetry
        this.telemetryBus.emit('api_request_failure', {
          endpoint,
          url,
          error: lastError.message,
          attempt: attempt + 1,
          timestamp: Date.now()
        });

        // Don't retry on client errors (4xx)
        if (this.isClientError(lastError)) {
          throw lastError;
        }
      }
    }

    throw lastError || new Error(`Failed to complete request to ${endpoint}`);
  }

  /**
   * Perform the actual HTTP request
   */
  private async performRequest(url: string, options: RequestOptions): Promise<any> {
    const controller = new AbortController();
    const timeout = options.timeout || this.config.timeout;
    
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          ...this.config.headers,
          ...options.headers,
          'Content-Type': 'application/json'
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }
      
      return await response.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Build URL with query parameters
   */
  private buildUrl(path: string, params?: Record<string, any>): string {
    const url = new URL(path, this.config.baseUrl);
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  /**
   * Check if circuit breaker is open
   */
  private isCircuitOpen(endpoint: string): boolean {
    const state = this.circuitBreaker.get(endpoint);
    if (!state || !state.isOpen) return false;

    // Check if reset time has passed
    if (Date.now() - state.lastFailure > this.config.circuitBreakerResetTime) {
      state.isOpen = false;
      state.failures = 0;
      return false;
    }

    return true;
  }

  /**
   * Record a successful request
   */
  private recordSuccess(endpoint: string): void {
    const state = this.circuitBreaker.get(endpoint);
    if (state && state.failures > 0) {
      state.failures = 0;
      state.isOpen = false;
    }
  }

  /**
   * Record a failed request
   */
  private recordFailure(endpoint: string): void {
    let state = this.circuitBreaker.get(endpoint);
    if (!state) {
      state = { failures: 0, lastFailure: 0, isOpen: false };
      this.circuitBreaker.set(endpoint, state);
    }

    state.failures++;
    state.lastFailure = Date.now();

    if (state.failures >= this.config.circuitBreakerThreshold) {
      state.isOpen = true;
      logger.warn(`Circuit breaker opened for ${endpoint} after ${state.failures} failures`);
    }
  }

  /**
   * Check if error is a client error (4xx)
   */
  private isClientError(error: Error): boolean {
    const match = error.message.match(/HTTP (\d{3}):/);
    if (match) {
      const statusCode = parseInt(match[1]);
      return statusCode >= 400 && statusCode < 500;
    }
    return false;
  }

  /**
   * Delay helper for retries
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
} 