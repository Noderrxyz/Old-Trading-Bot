/**
 * Rate Limiting Middleware
 * 
 * Provides rate limiting functionality to protect against brute force
 * attacks and prevent API abuse.
 */
import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('RateLimitMiddleware');

// Create different rate limiters for different endpoints
const loginRateLimiter = new RateLimiterMemory({
  points: 5, // 5 attempts
  duration: 60, // per 60 seconds
  blockDuration: 300, // Block for 5 minutes if exceeded
});

const apiRateLimiter = new RateLimiterMemory({
  points: 30, // 30 requests
  duration: 60, // per 60 seconds
});

const highVolumeApiRateLimiter = new RateLimiterMemory({
  points: 300, // 300 requests
  duration: 60, // per 60 seconds
});

/**
 * Get client identifier for rate limiting
 * More sophisticated implementations might use a combination of factors
 */
function getClientIdentifier(req: Request): string {
  // X-Forwarded-For can be easily spoofed, consider using a more
  // sophisticated identification method in production
  const clientIp = (req.headers['x-forwarded-for'] as string) || 
    req.socket.remoteAddress || 
    'unknown';
    
  // For API keys, consider using the key ID as part of the identifier
  const apiKey = req.headers['x-api-key'] as string;
  const keyId = apiKey ? apiKey.substring(0, 10) : '';
  
  return keyId || clientIp;
}

/**
 * Rate limiting middleware for login attempts
 * Stricter limits to prevent brute force attacks
 */
export function loginRateLimit(req: Request, res: Response, next: NextFunction): void {
  const clientId = getClientIdentifier(req);
  
  loginRateLimiter.consume(clientId)
    .then(() => {
      next();
    })
    .catch((rateLimiterRes) => {
      const secondsToRetry = Math.round(rateLimiterRes.msBeforeNext / 1000) || 1;
      
      logger.warn('Rate limit exceeded for login', {
        clientId,
        path: req.path,
        method: req.method,
        retryAfter: secondsToRetry
      });
      
      res.setHeader('Retry-After', secondsToRetry);
      res.status(429).json({
        error: 'Too many login attempts',
        retryAfter: secondsToRetry
      });
    });
}

/**
 * Standard API rate limiting middleware
 * For most API endpoints
 */
export function apiRateLimit(req: Request, res: Response, next: NextFunction): void {
  const clientId = getClientIdentifier(req);
  
  apiRateLimiter.consume(clientId)
    .then(() => {
      next();
    })
    .catch((rateLimiterRes) => {
      const secondsToRetry = Math.round(rateLimiterRes.msBeforeNext / 1000) || 1;
      
      logger.warn('API rate limit exceeded', {
        clientId,
        path: req.path,
        method: req.method,
        retryAfter: secondsToRetry
      });
      
      res.setHeader('Retry-After', secondsToRetry);
      res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: secondsToRetry
      });
    });
}

/**
 * Higher limit rate limiting middleware
 * For endpoints that expect higher traffic
 */
export function highVolumeRateLimit(req: Request, res: Response, next: NextFunction): void {
  const clientId = getClientIdentifier(req);
  
  highVolumeApiRateLimiter.consume(clientId)
    .then(() => {
      next();
    })
    .catch((rateLimiterRes) => {
      const secondsToRetry = Math.round(rateLimiterRes.msBeforeNext / 1000) || 1;
      
      logger.warn('High volume API rate limit exceeded', {
        clientId,
        path: req.path,
        method: req.method,
        retryAfter: secondsToRetry
      });
      
      res.setHeader('Retry-After', secondsToRetry);
      res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: secondsToRetry
      });
    });
}

/**
 * Factory function to create custom rate limiters
 */
export function createRateLimiter(points: number, duration: number, blockDuration?: number) {
  const limiter = new RateLimiterMemory({
    points,
    duration,
    blockDuration
  });
  
  return (req: Request, res: Response, next: NextFunction): void => {
    const clientId = getClientIdentifier(req);
    
    limiter.consume(clientId)
      .then(() => {
        next();
      })
      .catch((rateLimiterRes) => {
        const secondsToRetry = Math.round(rateLimiterRes.msBeforeNext / 1000) || 1;
        
        logger.warn('Custom rate limit exceeded', {
          clientId,
          path: req.path,
          method: req.method,
          retryAfter: secondsToRetry,
          points,
          duration
        });
        
        res.setHeader('Retry-After', secondsToRetry);
        res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter: secondsToRetry
        });
      });
  };
}

export default {
  loginRateLimit,
  apiRateLimit,
  highVolumeRateLimit,
  createRateLimiter
}; 