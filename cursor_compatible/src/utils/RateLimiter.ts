/**
 * Rate Limiter - Token Bucket Implementation
 * 
 * Simulates realistic API rate limiting behavior for exchange connectors.
 * Uses token bucket algorithm with endpoint-specific configurations.
 */

export interface RateLimitConfig {
  maxTokens: number;           // Maximum tokens in bucket
  refillRate: number;          // Tokens per second refill rate
  refillInterval: number;      // Refill interval in milliseconds
  burstAllowance: number;      // Additional burst capacity
}

export interface EndpointLimits {
  orders: RateLimitConfig;
  market_data: RateLimitConfig;
  account: RateLimitConfig;
  websocket: RateLimitConfig;
}

export interface RateLimitResult {
  allowed: boolean;
  remainingTokens: number;
  resetTime: number;
  retryAfter?: number;        // Seconds to wait if rate limited
}

export class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private endpointLimits: EndpointLimits;
  private enabled: boolean;

  constructor(endpointLimits?: Partial<EndpointLimits>, enabled: boolean = true) {
    this.enabled = enabled;
    this.endpointLimits = {
      orders: {
        maxTokens: 10,
        refillRate: 10,         // 10 orders/second
        refillInterval: 1000,   // 1 second
        burstAllowance: 5
      },
      market_data: {
        maxTokens: 100,
        refillRate: 100,        // 100 requests/second
        refillInterval: 1000,
        burstAllowance: 50
      },
      account: {
        maxTokens: 20,
        refillRate: 20,         // 20 requests/second
        refillInterval: 1000,
        burstAllowance: 10
      },
      websocket: {
        maxTokens: 1000,
        refillRate: 1000,       // 1000 messages/second
        refillInterval: 1000,
        burstAllowance: 200
      },
      ...endpointLimits
    };
  }

  /**
   * Check and consume tokens for an API endpoint
   */
  checkLimit(endpoint: string, tokens: number = 1): RateLimitResult {
    if (!this.enabled) {
      return {
        allowed: true,
        remainingTokens: 1000,
        resetTime: Date.now() + 60000
      };
    }

    const bucket = this.getBucket(endpoint);
    const result = bucket.consume(tokens);

    return {
      allowed: result.success,
      remainingTokens: result.remainingTokens,
      resetTime: result.resetTime,
      retryAfter: result.success ? undefined : result.retryAfter
    };
  }

  /**
   * Get current token count for endpoint
   */
  getTokenCount(endpoint: string): number {
    if (!this.enabled) return 1000;
    
    const bucket = this.getBucket(endpoint);
    return bucket.getCurrentTokens();
  }

  /**
   * Reset all rate limiters
   */
  reset(): void {
    this.buckets.clear();
  }

  /**
   * Get or create token bucket for endpoint
   */
  private getBucket(endpoint: string): TokenBucket {
    const normalizedEndpoint = this.normalizeEndpoint(endpoint);
    
    if (!this.buckets.has(normalizedEndpoint)) {
      const config = this.getConfigForEndpoint(normalizedEndpoint);
      this.buckets.set(normalizedEndpoint, new TokenBucket(config));
    }
    
    return this.buckets.get(normalizedEndpoint)!;
  }

  /**
   * Normalize endpoint name to category
   */
  private normalizeEndpoint(endpoint: string): keyof EndpointLimits {
    const lower = endpoint.toLowerCase();
    
    if (lower.includes('order') || lower.includes('trade')) {
      return 'orders';
    } else if (lower.includes('account') || lower.includes('balance') || lower.includes('position')) {
      return 'account';
    } else if (lower.includes('ws') || lower.includes('websocket') || lower.includes('stream')) {
      return 'websocket';
    } else {
      return 'market_data';
    }
  }

  /**
   * Get rate limit configuration for endpoint category
   */
  private getConfigForEndpoint(endpoint: keyof EndpointLimits): RateLimitConfig {
    return this.endpointLimits[endpoint];
  }

  /**
   * Update configuration for specific endpoint
   */
  updateConfig(endpoint: keyof EndpointLimits, config: Partial<RateLimitConfig>): void {
    this.endpointLimits[endpoint] = {
      ...this.endpointLimits[endpoint],
      ...config
    };
    
    // Reset bucket to apply new config
    this.buckets.delete(endpoint);
  }

  /**
   * Enable or disable rate limiting
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Get current status of all rate limiters
   */
  getStatus(): Record<string, { tokens: number; resetTime: number }> {
    const status: Record<string, { tokens: number; resetTime: number }> = {};
    
    for (const [endpoint, bucket] of this.buckets) {
      status[endpoint] = {
        tokens: bucket.getCurrentTokens(),
        resetTime: bucket.getResetTime()
      };
    }
    
    return status;
  }
}

/**
 * Token Bucket Implementation
 */
class TokenBucket {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number;
  private refillInterval: number;
  private burstAllowance: number;
  private lastRefill: number;
  private refillTimer?: NodeJS.Timeout;

  constructor(config: RateLimitConfig) {
    this.maxTokens = config.maxTokens;
    this.refillRate = config.refillRate;
    this.refillInterval = config.refillInterval;
    this.burstAllowance = config.burstAllowance;
    this.tokens = config.maxTokens + config.burstAllowance;
    this.lastRefill = Date.now();
    
    this.startRefillTimer();
  }

  /**
   * Attempt to consume tokens
   */
  consume(tokens: number): { 
    success: boolean; 
    remainingTokens: number; 
    resetTime: number;
    retryAfter?: number;
  } {
    this.refill();
    
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return {
        success: true,
        remainingTokens: this.tokens,
        resetTime: this.getResetTime()
      };
    } else {
      // Calculate retry delay based on refill rate
      const tokensNeeded = tokens - this.tokens;
      const retryAfter = Math.ceil(tokensNeeded / this.refillRate);
      
      return {
        success: false,
        remainingTokens: this.tokens,
        resetTime: this.getResetTime(),
        retryAfter
      };
    }
  }

  /**
   * Get current token count
   */
  getCurrentTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Get next reset time
   */
  getResetTime(): number {
    return this.lastRefill + this.refillInterval;
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    
    if (elapsed >= this.refillInterval) {
      const intervals = Math.floor(elapsed / this.refillInterval);
      const tokensToAdd = intervals * this.refillRate;
      
      this.tokens = Math.min(
        this.tokens + tokensToAdd,
        this.maxTokens + this.burstAllowance
      );
      
      this.lastRefill = now;
    }
  }

  /**
   * Start automatic refill timer
   */
  private startRefillTimer(): void {
    if (this.refillTimer) {
      clearInterval(this.refillTimer);
    }
    
    this.refillTimer = setInterval(() => {
      this.refill();
    }, this.refillInterval);
  }

  /**
   * Stop refill timer
   */
  destroy(): void {
    if (this.refillTimer) {
      clearInterval(this.refillTimer);
      this.refillTimer = undefined;
    }
  }
} 