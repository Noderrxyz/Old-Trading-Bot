# Metrics Instrumentation Guide

This guide provides best practices for instrumenting your code with metrics in the Noderr trading protocol.

## Metrics Fundamentals

### Types of Metrics

1. **Counters** - Cumulative values that only increase (e.g., number of orders processed)
2. **Gauges** - Current value measurements that can go up or down (e.g., active connections)
3. **Histograms** - Distribution of values across predefined buckets (e.g., response time distribution)
4. **Summaries** - Similar to histograms but with quantile calculations (e.g., p50, p90, p99 latencies)

### When to Use Each Type

| Metric Type | Use Cases | Examples |
|-------------|-----------|----------|
| **Counter** | Counting events, operations, errors | Total orders, API calls, errors |
| **Gauge** | Point-in-time measurements | CPU usage, memory, queue depth |
| **Histogram** | Distribution of values, SLOs | Request latency, order size |
| **Summary** | Percentile calculations | Performance SLOs, latency quantiles |

## Metric Naming Conventions

Follow a consistent naming convention for all metrics:

```
domain_component_metric_name_unit
```

For example:
- `noderr_marketdata_request_latency_milliseconds`
- `noderr_orders_processed_total`
- `noderr_position_current_value_usd`

### Naming Guidelines

1. **Use snake_case** for metric names
2. **Include units** in the metric name (e.g., `_seconds`, `_bytes`, `_total`)
3. **Be consistent** with naming across the application
4. **Be descriptive** but concise
5. **Use domain-specific prefixes** to group related metrics

## Key Metrics to Instrument

### System Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `system_cpu_usage_percent` | Gauge | CPU usage percentage |
| `system_memory_usage_bytes` | Gauge | Memory usage in bytes |
| `system_disk_usage_bytes` | Gauge | Disk space usage |
| `system_network_receive_bytes_total` | Counter | Total bytes received |
| `system_network_transmit_bytes_total` | Counter | Total bytes transmitted |

### Application Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `app_requests_total` | Counter | Total number of requests |
| `app_request_duration_milliseconds` | Histogram | Request latency distribution |
| `app_errors_total` | Counter | Total number of errors |
| `app_active_users` | Gauge | Number of active users |
| `app_uptime_seconds` | Gauge | Application uptime |

### Trading-Specific Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `trading_orders_placed_total` | Counter | Total orders placed |
| `trading_orders_filled_total` | Counter | Total orders filled |
| `trading_order_latency_milliseconds` | Histogram | Order execution latency |
| `trading_position_value_usd` | Gauge | Current position value |
| `trading_profit_loss_usd` | Gauge | Current P&L |
| `trading_slippage_percent` | Histogram | Order execution slippage |

### Database Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `db_query_duration_milliseconds` | Histogram | Query execution time |
| `db_connections_active` | Gauge | Active database connections |
| `db_errors_total` | Counter | Database errors |
| `db_pool_size` | Gauge | Connection pool size |
| `db_pool_utilization_percent` | Gauge | Connection pool utilization |

## Labels/Tags

Add contextual information to metrics using labels:

```typescript
// Good label usage
orderLatency.observe({ exchange: 'binance', pair: 'BTC-USDT', order_type: 'market' }, 150);
```

### Label Best Practices

1. **Use descriptive names** - Choose clear, self-explanatory label names
2. **Limit cardinality** - Avoid high-cardinality labels (e.g., user IDs, timestamps)
3. **Be consistent** - Use the same label names across related metrics
4. **Provide context** - Include enough labels to make the metric useful
5. **Avoid redundancy** - Don't duplicate information in metric name and labels

### Common Labels for Noderr

| Label | Example Values | Used For |
|-------|---------------|----------|
| `exchange` | binance, coinbase | Exchange-specific metrics |
| `symbol` | BTC-USDT, ETH-USDT | Trading pair metrics |
| `order_type` | market, limit | Order-related metrics |
| `status` | success, failure | Outcome metrics |
| `component` | market-data, order-executor | Component-level metrics |

## Implementing Metrics in Code

### Using Prometheus Client

```typescript
import * as prom from 'prom-client';

// Create a registry (or use the global one)
const register = new prom.Registry();

// Define metrics
const httpRequestDuration = new prom.Histogram({
  name: 'http_request_duration_milliseconds',
  help: 'Duration of HTTP requests in milliseconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000], // milliseconds
  registers: [register]
});

const activeConnections = new prom.Gauge({
  name: 'active_connections',
  help: 'Current number of active connections',
  labelNames: ['service'],
  registers: [register]
});

const errorCounter = new prom.Counter({
  name: 'errors_total',
  help: 'Total number of errors',
  labelNames: ['service', 'error_type'],
  registers: [register]
});

// Middleware to record HTTP request duration
function metricsMiddleware(req, res, next) {
  const start = Date.now();
  
  // Record the end time when the response is sent
  res.on('finish', () => {
    const duration = Date.now() - start;
    httpRequestDuration.observe(
      { method: req.method, route: req.route.path, status_code: res.statusCode },
      duration
    );
  });
  
  next();
}

// Tracking connections
function trackConnections(serviceId) {
  return {
    connect: () => {
      activeConnections.inc({ service: serviceId });
    },
    disconnect: () => {
      activeConnections.dec({ service: serviceId });
    }
  };
}

// Create route for Prometheus to scrape
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

### Using Our Telemetry System

```typescript
import { Telemetry } from '../../telemetry/Telemetry';
import {
  tradeExecutionLatency,
  tradeVolumeUsd,
  tradeSlippage,
  recordTradeExecution
} from '../../telemetry/metrics';

export class OrderExecutor {
  async executeOrder(order) {
    const startTime = Date.now();
    
    try {
      // Execute the order...
      const result = await this.executeTrade(order);
      
      // Record metrics
      recordTradeExecution(
        order.chainId,
        order.fromAsset,
        order.toAsset,
        order.isMainnet,
        startTime,
        order.volumeUsd,
        true // success
      );
      
      return result;
    } catch (error) {
      // Record failure metrics
      recordTradeExecution(
        order.chainId,
        order.fromAsset,
        order.toAsset,
        order.isMainnet,
        startTime,
        order.volumeUsd,
        false // failure
      );
      
      throw error;
    }
  }
}
```

## Common Instrumentation Patterns

### The RED Pattern

For services, measure:
- **Rate** - Requests per second
- **Errors** - Number of failed requests
- **Duration** - Amount of time to process requests

```typescript
// RED pattern implementation
const requestCounter = new prom.Counter({
  name: 'service_requests_total',
  help: 'Total number of requests received',
  labelNames: ['service', 'endpoint', 'status']
});

const requestDuration = new prom.Histogram({
  name: 'service_request_duration_milliseconds',
  help: 'Request duration in milliseconds',
  labelNames: ['service', 'endpoint'],
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000]
});

// Usage in middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    // Rate
    requestCounter.inc({
      service: 'order-service',
      endpoint: req.path,
      status: res.statusCode < 400 ? 'success' : 'error'
    });
    
    // Errors (tracked by status in the counter)
    
    // Duration
    requestDuration.observe({
      service: 'order-service',
      endpoint: req.path
    }, Date.now() - start);
  });
  
  next();
});
```

### The USE Pattern

For resources, measure:
- **Utilization** - Percentage of time the resource is busy
- **Saturation** - Amount of work resource has to do (often queue length)
- **Errors** - Count of error events

```typescript
// USE pattern implementation for connection pool
const poolUtilization = new prom.Gauge({
  name: 'db_pool_utilization_percent',
  help: 'Database connection pool utilization percentage',
  labelNames: ['database']
});

const poolSaturation = new prom.Gauge({
  name: 'db_pool_queue_length',
  help: 'Number of requests waiting for a database connection',
  labelNames: ['database']
});

const poolErrors = new prom.Counter({
  name: 'db_pool_errors_total',
  help: 'Total number of database connection errors',
  labelNames: ['database', 'error_type']
});

// Update metrics periodically
setInterval(() => {
  const stats = getPoolStats();
  poolUtilization.set({ database: 'orders' }, stats.utilization * 100);
  poolSaturation.set({ database: 'orders' }, stats.queueLength);
}, 5000);

// Record errors when they happen
pool.on('error', (err) => {
  poolErrors.inc({ database: 'orders', error_type: err.code });
});
```

## Handling High-Cardinality

Avoid high-cardinality labels that can cause performance issues:

### Bad Practice

```typescript
// ❌ High cardinality - Using user ID as label
requestCounter.inc({ userId: user.id, endpoint: '/api/orders' });

// ❌ High cardinality - Using exact values for numeric data
errorCounter.inc({ errorCode: err.code.toString(), message: err.message });
```

### Good Practice

```typescript
// ✅ Better - Group users by type or role
requestCounter.inc({ userType: user.type, endpoint: '/api/orders' });

// ✅ Better - Bucket numeric values
const latencyBucket = bucketLatency(latencyMs); // e.g., "0-10ms", "10-50ms"
latencyCounter.inc({ latencyBucket });

// ✅ Better - Categorize error codes
const errorCategory = categorizeError(err.code);
errorCounter.inc({ errorCategory });
```

## Performance Considerations

1. **Avoid expensive computations** in metric collection
2. **Batch metric updates** when possible
3. **Use client-side aggregation** for high-frequency events
4. **Monitor the overhead** of your instrumentation
5. **Use appropriate bucket sizes** for histograms

## Integration with Alerts and Dashboards

Design metrics with alerting and dashboarding in mind:

```typescript
// Good for alerting - Clear threshold indicators
const orderBookFreshness = new prom.Gauge({
  name: 'market_data_orderbook_age_seconds',
  help: 'Age of the latest order book data in seconds',
  labelNames: ['exchange', 'symbol']
});

// Good for dashboards - Comprehensive view of system state
const orderTypeDistribution = new prom.Counter({
  name: 'orders_by_type_total',
  help: 'Distribution of orders by type',
  labelNames: ['exchange', 'symbol', 'order_type', 'side']
});
```

## Testing Metrics

Always test your metrics instrumentation:

```typitten
describe('Order Executor Metrics', () => {
  let registry;
  
  beforeEach(() => {
    registry = new prom.Registry();
    // Re-register metrics with test registry
  });
  
  it('should record successful trade execution', async () => {
    // Arrange
    const order = createTestOrder();
    const executor = new OrderExecutor();
    
    // Act
    await executor.executeOrder(order);
    
    // Assert
    const metrics = await registry.getMetricsAsJSON();
    const tradeCounter = metrics.find(m => m.name === 'trade_executions_total');
    
    expect(tradeCounter).toBeDefined();
    expect(tradeCounter.values.find(v => 
      v.labels.status === 'success' && 
      v.labels.exchange === order.exchange
    )).toBeDefined();
  });
});
```

## Additional Resources

- [Prometheus Best Practices](https://prometheus.io/docs/practices/naming/)
- [RED Method](https://www.weave.works/blog/the-red-method-key-metrics-for-microservices-architecture/)
- [USE Method](http://www.brendangregg.com/usemethod.html)
- [SRE Book: Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) 