# Logging Best Practices

This guide outlines the best practices for implementing logging in the Noderr trading protocol.

## Logging Principles

1. **Be selective** - Log important information, not everything
2. **Be descriptive** - Include contextual information
3. **Be consistent** - Follow a standardized format
4. **Be searchable** - Use structured logging
5. **Be secure** - Never log sensitive information

## Log Levels

Use the appropriate log level for the message:

| Level | When to Use |
|-------|-------------|
| **ERROR** | Use for unrecoverable errors that prevent a function from completing successfully. These typically require immediate attention. |
| **WARN** | Use for recoverable issues, unexpected situations that don't prevent the system from functioning but might indicate potential problems. |
| **INFO** | Use for important events in the normal operation of the application. These should be infrequent enough to not create noise. |
| **DEBUG** | Use for detailed development-time information that helps diagnose problems. |
| **TRACE** | Use for the most granular, high-volume information, typically only enabled during specific debugging scenarios. |

## Structured Logging Format

Always use structured logging with JSON format. Include the following standard fields:

```typescript
logger.info('Message description', {
  // Standard context fields
  component: 'market-data-adapter', // Component that generated the log
  operation: 'fetchOrderBook',       // Operation being performed
  correlationId: 'abc-123',         // Request or transaction ID for correlation
  
  // Domain-specific context
  symbol: 'BTC-USDT',               // Trading pair
  exchange: 'binance',              // Exchange name
  
  // Performance metrics (if applicable)
  durationMs: 127,                  // How long the operation took
  
  // Additional contextual information
  metadata: {                       // Any other relevant data
    depth: 10,
    status: 'success'
  }
});
```

## What to Log

### Always Log

1. **Application lifecycle events**
   - Startup and shutdown
   - Configuration loading
   - Service initialization

2. **Critical state changes**
   - Connection establishment/loss
   - Authentication events
   - Order state transitions

3. **Errors and exceptions**
   - Include stack traces
   - Include context about the operation
   - Include correlation IDs

4. **Security events**
   - Authentication attempts
   - Authorization failures
   - Access control modifications

### Sometimes Log (INFO or DEBUG)

1. **Business transactions**
   - Order placement/execution
   - Position changes
   - Configuration changes

2. **Performance metrics**
   - Latency for critical operations
   - Resource utilization thresholds
   - Cache hit/miss ratios

### Rarely Log (DEBUG or TRACE)

1. **Routine operations**
   - Heartbeats
   - Scheduled task execution
   - High-frequency market data updates

2. **Development details**
   - Variable values
   - Control flow paths
   - Method entry/exit

## What NOT to Log

1. **Sensitive information**
   - API keys, passwords, tokens
   - Personal identifiable information (PII)
   - Trading strategy parameters
   - Account balances (in exact terms)

2. **Redundant information**
   - Information already available through metrics
   - Duplicate logs from multiple layers

3. **Very high-volume data**
   - Raw market data ticks
   - Detailed order execution steps (use metrics instead)

## Code Examples

### Bad Examples

```typescript
// ❌ Too generic, no context
logger.error('Database connection failed');

// ❌ Sensitive information exposed
logger.info(`User ${username} logged in with password ${password}`);

// ❌ Unstructured, hard to parse
logger.debug('Processing order: ' + orderId + ' status: ' + status);
```

### Good Examples

```typescript
// ✅ Structured, contains context
logger.error('Database connection failed', {
  component: 'database-service',
  database: 'postgres-main',
  error: err.message,
  connectionId: conn.id,
  retryAttempt: 3
});

// ✅ Security-conscious
logger.info('User authentication successful', {
  component: 'auth-service',
  userId: user.id,
  authMethod: 'oauth',
  ipAddress: request.ip
});

// ✅ Detailed operational context
logger.debug('Processing order state change', {
  component: 'order-service',
  orderId: order.id,
  previousState: 'PENDING',
  newState: 'FILLED',
  latencyMs: Date.now() - startTime
});
```

## Implementation in Noderr

### Using the Logger

```typescript
import { logger } from '../../utils/logger';

export class MarketDataAdapter {
  async fetchOrderBook(symbol: string): Promise<OrderBook> {
    const startTime = Date.now();
    const correlationId = generateCorrelationId();
    
    logger.debug('Fetching order book', {
      component: 'MarketDataAdapter',
      operation: 'fetchOrderBook',
      correlationId,
      symbol,
      exchange: this.exchangeName
    });
    
    try {
      const result = await this.client.getOrderBook(symbol);
      const duration = Date.now() - startTime;
      
      logger.info('Order book fetched successfully', {
        component: 'MarketDataAdapter',
        operation: 'fetchOrderBook',
        correlationId,
        symbol,
        exchange: this.exchangeName,
        durationMs: duration,
        levels: result.bids.length
      });
      
      return result;
    } catch (error) {
      logger.error('Failed to fetch order book', {
        component: 'MarketDataAdapter',
        operation: 'fetchOrderBook',
        correlationId,
        symbol,
        exchange: this.exchangeName,
        error: error.message,
        stack: error.stack,
        durationMs: Date.now() - startTime
      });
      
      throw error;
    }
  }
}
```

### Configuring Log Levels

Configure the log level based on the environment:

```typescript
// In configuration.ts
export const logLevel = process.env.NODE_ENV === 'production'
  ? 'info'
  : (process.env.LOG_LEVEL || 'debug');
```

## Correlation Between Logs, Metrics, and Traces

Always include correlation IDs in logs to connect them with traces and metrics:

```typescript
// When handling a request that has a trace ID
app.use((req, res, next) => {
  const traceId = req.headers['x-trace-id'] || uuidv4();
  req.traceId = traceId;
  
  // Set the trace ID in the logger context for this request
  req.logger = logger.child({ traceId });
  
  next();
});

// In your route handlers
app.get('/api/orders', (req, res) => {
  req.logger.info('Fetching orders', {
    component: 'orders-api',
    userId: req.user.id
  });
  
  // ...
});
```

## Performance Considerations

1. **Use sampling for high-volume logs**
   - Log only a percentage of high-frequency events
   - Always log errors and important events

2. **Be mindful of logger performance**
   - Use asynchronous logging where possible
   - Buffer logs for batch processing
   - Consider the impact of serializing large objects

3. **Configure appropriate retention policies**
   - Keep ERROR logs longer than INFO logs
   - Archive older logs for compliance
   - Set size limits for log storage

## Monitoring and Alerting on Logs

Set up monitoring and alerts based on log patterns:

1. **Error rate alerting**
   - Alert when ERROR logs exceed a threshold
   - Set up pattern matching for critical failures

2. **Anomaly detection**
   - Monitor for unusual patterns in logs
   - Alert on security-related log events

3. **SLA monitoring**
   - Use logs to track service level objectives
   - Set up alerts for SLA violations

## Additional Resources

- [ELK Stack Documentation](https://www.elastic.co/guide/index.html)
- [OpenTelemetry Logging](https://opentelemetry.io/docs/concepts/signals/logs/)
- [Structured Logging Best Practices](https://www.honeycomb.io/blog/structured-logging-best-practices) 