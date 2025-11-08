import { Request, Response, NextFunction } from 'express';

/**
 * In-memory rate limiter middleware (High)
 * Simple token-bucket per key with sliding window; for production, use Redis.
 */

interface RateLimiterOptions {
  windowMs: number; // time window in ms
  max: number; // max requests per window per key
  keyGenerator?: (req: Request) => string; // derive key (e.g., userId, IP)
}

type Bucket = { count: number; resetAt: number };

const buckets: Map<string, Bucket> = new Map();

export function rateLimiter(options: RateLimiterOptions) {
  const windowMs = Math.max(1000, options.windowMs);
  const max = Math.max(1, options.max);
  const keyGen = options.keyGenerator || ((req: Request) => (req.user?.sub || req.ip || 'anon'));

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyGen(req);
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader('X-RateLimit-Remaining', String(max - 1));
      res.setHeader('X-RateLimit-Reset', String(now + windowMs));
      next();
      return;
    }

    if (bucket.count >= max) {
      const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(bucket.resetAt));
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    bucket.count += 1;
    res.setHeader('X-RateLimit-Remaining', String(max - bucket.count));
    res.setHeader('X-RateLimit-Reset', String(bucket.resetAt));
    next();
  };
}

export default rateLimiter;


