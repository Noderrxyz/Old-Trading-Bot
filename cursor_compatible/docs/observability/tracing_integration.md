# Distributed Tracing Integration Guide

This guide outlines how to implement distributed tracing in the Noderr trading protocol using OpenTelemetry.

## Tracing Fundamentals

### Core Concepts

1. **Trace** - Represents a complete request flow through a distributed system
2. **Span** - A single unit of work within a trace (e.g., HTTP request, database query)
3. **Context** - Carries trace information across service boundaries
4. **Attributes** - Key-value pairs that provide additional information about a span
5. **Events** - Time-stamped annotations within a span

### Benefits of Distributed Tracing

- **End-to-end visibility** across microservices
- **Performance bottleneck identification**
- **Error root cause analysis**
- **Service dependency mapping**
- **Anomaly detection**

## OpenTelemetry Implementation

### Setup

1. Install dependencies:

```bash
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
npm install @opentelemetry/exporter-trace-otlp-http @opentelemetry/semantic-conventions
```

2. Create a tracing setup file:

```typescript
// src/telemetry/tracing.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

export function initializeTracing() {
  const exporter = new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://jaeger:4318/v1/traces',
  });

  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: 'noderr-trading',
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '0.1.0',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
    }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Enable specific auto-instrumentations
        '@opentelemetry/instrumentation-http': { enabled: true },
        '@opentelemetry/instrumentation-express': { enabled: true },
        '@opentelemetry/instrumentation-pg': { enabled: true },
        '@opentelemetry/instrumentation-redis': { enabled: true },
      }),
    ],
  });

  // Start the SDK
  sdk.start();

  // Gracefully shut down the SDK on process exit
  process.on('SIGTERM', () => {
    sdk.shutdown()
      .then(() => console.log('Tracing terminated'))
      .catch(error => console.error('Error terminating tracing', error))
      .finally(() => process.exit(0));
  });

  return sdk;
}
```

3. Initialize tracing early in your application:

```typescript
// src/index.ts
import { initializeTracing } from './telemetry/tracing';

// Initialize tracing before importing other modules
const tracerProvider = initializeTracing();

// Continue with regular application imports and setup
import express from 'express';
import { routes } from './routes';
// ...
```

### Manual Instrumentation

While auto-instrumentation covers many common libraries, you'll need to manually instrument code for domain-specific operations:

```typescript
// src/services/orderService.ts
import { trace, context, SpanKind, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('noderr-order-service');

export class OrderService {
  async placeOrder(order) {
    // Create a new span for the order placement process
    return tracer.startActiveSpan('place_order', { kind: SpanKind.INTERNAL }, async (span) => {
      try {
        // Add attributes to the span
        span.setAttributes({
          'order.id': order.id,
          'order.symbol': order.symbol,
          'order.type': order.type,
          'order.side': order.side,
          'order.quantity': order.quantity,
        });

        // Record an event
        span.addEvent('Validating order');
        
        // Validate the order
        const validationResult = await this.validateOrder(order);
        
        if (!validationResult.isValid) {
          // Record validation failure
          span.addEvent('Order validation failed', {
            'validation.reason': validationResult.reason
          });
          
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `Order validation failed: ${validationResult.reason}`
          });
          
          return { success: false, reason: validationResult.reason };
        }

        // Record event for order routing
        span.addEvent('Routing order to exchange');
        
        // Route the order to the appropriate exchange
        const executionResult = await this.routeOrderToExchange(order);
        
        // Record the result
        span.setAttributes({
          'execution.success': executionResult.success,
          'execution.exchange': executionResult.exchange,
          'execution.latency_ms': executionResult.latencyMs
        });
        
        return executionResult;
      } catch (error) {
        // Record the error in the span
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message
        });
        
        throw error;
      } finally {
        // End the span
        span.end();
      }
    });
  }

  async validateOrder(order) {
    // Create a child span for order validation
    return tracer.startActiveSpan('validate_order', async (span) => {
      try {
        // Validation logic goes here
        const result = { isValid: true };
        
        // End the span
        span.end();
        
        return result;
      } catch (error) {
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message
        });
        span.end();
        
        throw error;
      }
    });
  }

  async routeOrderToExchange(order) {
    // Create a child span for order routing
    return tracer.startActiveSpan('route_order_to_exchange', async (span) => {
      const startTime = Date.now();
      
      try {
        // Exchange routing logic goes here
        const result = { 
          success: true, 
          exchange: 'binance',
          orderId: '12345' 
        };
        
        return result;
      } catch (error) {
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message
        });
        
        throw error;
      } finally {
        // Record latency
        const latencyMs = Date.now() - startTime;
        span.setAttribute('latency_ms', latencyMs);
        span.end();
      }
    });
  }
}
```

### Context Propagation

To maintain trace context across asynchronous operations and service boundaries:

#### HTTP Context Propagation

```typescript
// src/clients/marketDataClient.ts
import { trace, context } from '@opentelemetry/api';
import axios from 'axios';

const tracer = trace.getTracer('noderr-market-data-client');

export class MarketDataClient {
  async getOrderBook(symbol) {
    return tracer.startActiveSpan('get_order_book', async (span) => {
      try {
        span.setAttributes({
          'symbol': symbol,
          'operation': 'getOrderBook'
        });
        
        // Make HTTP request with trace context
        const response = await axios.get(`https://api.exchange.com/orderbook/${symbol}`, {
          headers: {
            // OpenTelemetry will automatically inject trace context headers
            // when using instrumented HTTP libraries
          }
        });
        
        span.setAttributes({
          'response.status': response.status,
          'response.size': JSON.stringify(response.data).length
        });
        
        return response.data;
      } catch (error) {
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }
}
```

#### Message Queue Context Propagation

```typescript
// src/services/messagePublisher.ts
import { trace, context, propagation } from '@opentelemetry/api';
import { SQS } from 'aws-sdk';

const tracer = trace.getTracer('noderr-message-publisher');
const sqs = new SQS();

export class MessagePublisher {
  async publishOrderEvent(order, eventType) {
    return tracer.startActiveSpan(`publish_${eventType}_event`, async (span) => {
      try {
        const currentContext = context.active();
        
        // Create carrier object for the trace context
        const carrier = {};
        propagation.inject(currentContext, carrier);
        
        // Create message with trace context
        const message = {
          orderId: order.id,
          eventType,
          timestamp: new Date().toISOString(),
          data: order,
          // Include trace context as attributes
          traceContext: carrier
        };
        
        // Send to SQS
        const result = await sqs.sendMessage({
          QueueUrl: process.env.ORDER_EVENTS_QUEUE_URL,
          MessageBody: JSON.stringify(message)
        }).promise();
        
        span.setAttributes({
          'messaging.system': 'sqs',
          'messaging.destination': process.env.ORDER_EVENTS_QUEUE_URL,
          'messaging.message_id': result.MessageId
        });
        
        return result;
      } catch (error) {
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }
}

// src/services/messageConsumer.ts
import { trace, context, propagation } from '@opentelemetry/api';

const tracer = trace.getTracer('noderr-message-consumer');

export class MessageConsumer {
  async processOrderEvent(message) {
    // Extract trace context from the message
    const parsedMessage = JSON.parse(message.Body);
    const traceContext = parsedMessage.traceContext;
    
    // Create context from carrier
    const extractedContext = propagation.extract(context.active(), traceContext);
    
    // Process the message with the extracted context
    return context.with(extractedContext, async () => {
      return tracer.startActiveSpan(`process_${parsedMessage.eventType}_event`, async (span) => {
        try {
          // Process message...
          
          return { success: true };
        } catch (error) {
          span.recordException(error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message
          });
          throw error;
        } finally {
          span.end();
        }
      });
    });
  }
}
```

## Best Practices

### Span Naming

Follow a consistent span naming convention:

- Use snake_case for span names
- Start with a verb that describes the operation
- Include the entity being operated on
- Be specific but not overly verbose

Examples:
- `fetch_order_book`
- `validate_order`
- `execute_trade`
- `update_position`

### Span Attributes

Include relevant attributes for each span:

| Category | Example Attributes | Purpose |
|----------|-------------------|---------|
| **Entity IDs** | `order.id`, `user.id`, `position.id` | Correlate with business entities |
| **Entity Properties** | `order.symbol`, `order.side`, `order.type` | Provide business context |
| **Operation Details** | `operation.name`, `operation.params` | Describe what was requested |
| **Outcome** | `outcome.success`, `error.code`, `error.message` | Indicate the result |
| **Performance** | `duration_ms`, `db.rows_affected` | Measure performance |

### When to Create Spans

Create spans for:

1. **Service boundaries** - API calls, database queries, message publishing/consuming
2. **Significant operations** - Order validation, risk checks, trade execution
3. **Potential bottlenecks** - Computationally expensive operations
4. **Error-prone areas** - Operations with error handling logic

Avoid creating spans for:

1. **Very frequent operations** - Ticks processing, market data updates
2. **Trivial operations** - Simple getter/setter methods
3. **Already instrumented code** - Operations covered by auto-instrumentation

### Sampling Strategy

Configure appropriate sampling based on environment and use case:

```typescript
// In tracing.ts
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-node';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

// Set up a parent-based sampler with different sampling rates
const sampler = new ParentBasedSampler({
  root: process.env.NODE_ENV === 'production' 
    ? new TraceIdRatioBasedSampler(0.1)  // 10% sampling in production
    : new TraceIdRatioBasedSampler(1.0), // 100% sampling in dev/test
});

const sdk = new NodeSDK({
  sampler,
  resource: new Resource({
    // ...resource attributes
  }),
  // ...other config
});
```

### Error Handling

Always record exceptions in spans:

```typescript
try {
  // Operation that might fail
} catch (error) {
  // Record the exception in the current span
  const span = trace.getSpan(context.active());
  if (span) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message
    });
  }
  
  // Then handle or rethrow the error
  throw error;
}
```

## Custom Implementation for Trading Systems

### Critical Trading Paths to Trace

1. **Order Lifecycle**

```typescript
// src/services/orderLifecycleService.ts
export async function executeOrderLifecycle(order) {
  return tracer.startActiveSpan('order_lifecycle', async (rootSpan) => {
    try {
      rootSpan.setAttributes({
        'order.id': order.id,
        'order.symbol': order.symbol,
        'order.type': order.type
      });
      
      // 1. Validate order
      rootSpan.addEvent('Starting order validation');
      const validationResult = await validateOrder(order);
      
      // 2. Check risk limits
      rootSpan.addEvent('Starting risk check');
      const riskResult = await checkRiskLimits(order);
      
      // 3. Route to exchange
      rootSpan.addEvent('Routing to exchange');
      const routingResult = await routeToExchange(order);
      
      // 4. Monitor execution
      rootSpan.addEvent('Monitoring execution');
      const executionResult = await monitorExecution(routingResult.exchangeOrderId);
      
      // 5. Update position
      rootSpan.addEvent('Updating position');
      const positionResult = await updatePosition(executionResult);
      
      rootSpan.setAttributes({
        'order.status': 'COMPLETED',
        'execution.price': executionResult.price,
        'execution.quantity': executionResult.quantity
      });
      
      return { success: true, executionResult };
    } catch (error) {
      rootSpan.recordException(error);
      rootSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message
      });
      throw error;
    } finally {
      rootSpan.end();
    }
  });
}
```

2. **Market Data Flow**

```typescript
// src/services/marketDataService.ts
export async function processMarketDataUpdate(update) {
  return tracer.startActiveSpan('process_market_data', async (span) => {
    try {
      span.setAttributes({
        'market_data.symbol': update.symbol,
        'market_data.exchange': update.exchange,
        'market_data.type': update.type
      });
      
      // 1. Normalize the data
      const normalizedData = await normalizeMarketData(update);
      
      // 2. Store the data
      await storeMarketData(normalizedData);
      
      // 3. Trigger strategy evaluation
      await triggerStrategyEvaluation(normalizedData);
      
      return { success: true };
    } catch (error) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

### Integration with Logs and Metrics

Correlate traces with logs and metrics:

```typescript
// src/middleware/loggingMiddleware.ts
import { trace, context } from '@opentelemetry/api';
import { logger } from '../utils/logger';

export function loggingMiddleware(req, res, next) {
  const span = trace.getSpan(context.active());
  const traceId = span?.spanContext().traceId;
  const spanId = span?.spanContext().spanId;
  
  // Add trace context to the logger
  req.logger = logger.child({
    traceId,
    spanId
  });
  
  req.logger.info('Request received', {
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip
  });
  
  // Continue with the request
  next();
}

// src/middleware/metricsMiddleware.ts
import { trace, context } from '@opentelemetry/api';
import { httpRequestDuration } from '../telemetry/metrics';

export function metricsMiddleware(req, res, next) {
  const span = trace.getSpan(context.active());
  const traceId = span?.spanContext().traceId;
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    // Record metrics with trace ID as a label
    httpRequestDuration.observe(
      { 
        method: req.method, 
        route: req.path, 
        status_code: res.statusCode,
        trace_id: traceId
      },
      duration
    );
  });
  
  next();
}
```

## Testing Tracing Implementation

```typescript
// src/services/__tests__/orderService.test.ts
import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { OrderService } from '../orderService';

describe('OrderService Tracing', () => {
  let orderService;
  let memoryExporter;
  
  beforeEach(() => {
    // Set up in-memory exporter to capture spans
    memoryExporter = new InMemorySpanExporter();
    
    // Configure test tracer provider with memory exporter
    const provider = configureMockTracerProvider(memoryExporter);
    
    // Create service instance
    orderService = new OrderService();
  });
  
  afterEach(() => {
    // Reset spans
    memoryExporter.reset();
  });
  
  it('should create spans for order placement', async () => {
    // Arrange
    const order = createTestOrder();
    
    // Act
    await orderService.placeOrder(order);
    
    // Assert
    const spans = memoryExporter.getFinishedSpans();
    
    // Should have at least 3 spans (placeOrder, validateOrder, routeOrderToExchange)
    expect(spans.length).toBeGreaterThanOrEqual(3);
    
    // Find the root span
    const rootSpan = spans.find(s => s.name === 'place_order');
    expect(rootSpan).toBeDefined();
    
    // Check span attributes
    expect(rootSpan.attributes['order.id']).toBe(order.id);
    expect(rootSpan.attributes['order.symbol']).toBe(order.symbol);
    
    // Check for child spans
    const validateSpan = spans.find(s => s.name === 'validate_order');
    expect(validateSpan).toBeDefined();
    expect(validateSpan.parentSpanId).toBe(rootSpan.spanId);
  });
  
  it('should record exceptions in spans', async () => {
    // Arrange
    const order = createInvalidOrder();
    
    // Act & Assert
    await expect(orderService.placeOrder(order)).rejects.toThrow();
    
    // Get finished spans
    const spans = memoryExporter.getFinishedSpans();
    
    // Find the root span
    const rootSpan = spans.find(s => s.name === 'place_order');
    
    // Check error status
    expect(rootSpan.status.code).toBe(SpanStatusCode.ERROR);
    expect(rootSpan.events.some(e => e.name === 'exception')).toBe(true);
  });
});
```

## Additional Resources

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Jaeger Documentation](https://www.jaegertracing.io/docs/latest/)
- [Distributed Tracing Blog](https://www.datadoghq.com/knowledge-center/distributed-tracing/)
- [Google Cloud Trace Documentation](https://cloud.google.com/trace/docs) 