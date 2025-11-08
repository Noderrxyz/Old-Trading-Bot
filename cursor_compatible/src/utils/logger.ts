/**
 * Structured logging for the Noderr trading protocol.
 * 
 * This module provides a configured Pino logger that outputs
 * structured logs in JSON format with the appropriate log level
 * based on the environment.
 */
import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';

// Default configuration for the logger
const defaultConfig = {
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'body.password',
    '*.apiKey',
    '*.apiSecret',
    '*.privateKey',
    '*.secret',
    '*.password'
  ],
  base: {
    service: 'noderr-trading',
    environment: process.env.NODE_ENV || 'development',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label: string) => {
      return { level: label };
    },
  },
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    }
  } : undefined
};

// Create the logger
export const logger = pino(defaultConfig);

// Create a child logger with request ID
export function createRequestLogger(req: any) {
  const requestId = req.headers['x-request-id'] || uuidv4();
  const traceId = req.headers['traceparent']?.split('-')[1] || undefined;

  return logger.child({
    requestId,
    traceId,
    method: req.method,
    url: req.url,
    ip: req.ip || req.socket.remoteAddress,
  });
}

// Create a child logger with component information
export function createComponentLogger(component: string, metadata: Record<string, any> = {}) {
  return logger.child({
    component,
    ...metadata
  });
}

// Convenience function to create a logger for a class
export function createClassLogger(className: string) {
  return createComponentLogger(className);
}

/**
 * Middleware for Express to add a logger to each request
 */
export function loggingMiddleware(req: any, res: any, next: () => void) {
  const requestLogger = createRequestLogger(req);
  req.logger = requestLogger;

  // Log request information
  requestLogger.info({
    msg: 'Request received',
    query: req.query,
  });

  // Track response time
  const startTime = process.hrtime();

  // Log response when finished
  res.on('finish', () => {
    const hrTime = process.hrtime(startTime);
    const responseTimeMs = hrTime[0] * 1000 + hrTime[1] / 1000000;

    const logMethod = res.statusCode >= 500 ? 'error' 
      : res.statusCode >= 400 ? 'warn' 
      : 'info';

    requestLogger[logMethod]({
      msg: 'Request completed',
      statusCode: res.statusCode,
      responseTimeMs: Math.round(responseTimeMs),
    });
  });

  next();
}

/**
 * Error handler middleware that logs errors
 */
export function errorLoggerMiddleware(err: Error, req: any, res: any, next: (error?: any) => void) {
  const requestLogger = req.logger || logger;
  
  requestLogger.error({
    msg: 'Request error',
    error: {
      message: err.message,
      stack: err.stack,
      name: err.name,
    }
  });
  
  next(err);
}

export default logger; 