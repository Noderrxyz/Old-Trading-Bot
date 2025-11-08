/**
 * OpenTelemetry tracing setup for the Noderr trading protocol
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-node';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

/**
 * Initialize OpenTelemetry tracing
 * 
 * This function sets up distributed tracing with OpenTelemetry.
 * It should be called as early as possible in the application lifecycle.
 * 
 * @param serviceName The name of the service (default: 'noderr-trading')
 * @param samplingRatio The sampling ratio (0.0-1.0), where 1.0 means sample everything
 * @returns The initialized OpenTelemetry SDK instance
 */
export function initializeTracing(
  serviceName: string = 'noderr-trading',
  samplingRatio: number = process.env.NODE_ENV === 'production' ? 0.1 : 1.0
): NodeSDK {
  // Set up diagnostic logging for OpenTelemetry itself
  if (process.env.OTEL_DEBUG === 'true') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  // Create a trace exporter
  const exporter = new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
  });

  // Configure a parent-based sampler with different sampling rates
  const sampler = new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(samplingRatio),
  });

  // Create the OpenTelemetry SDK with appropriate resources and instrumentations
  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '0.1.0',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
    }),
    traceExporter: exporter,
    sampler,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Enable specific instrumentations with configuration
        '@opentelemetry/instrumentation-http': { 
          enabled: true,
          ignoreIncomingPaths: ['/health', '/metrics', '/favicon.ico'],
        },
        '@opentelemetry/instrumentation-express': { enabled: true },
        '@opentelemetry/instrumentation-pg': { 
          enabled: true,
          enhancedDatabaseReporting: true,
        },
        '@opentelemetry/instrumentation-redis': { enabled: true },
        '@opentelemetry/instrumentation-pino': { enabled: true },
        '@opentelemetry/instrumentation-winston': { enabled: true },
      }),
    ],
  });

  // Start the SDK
  sdk.start();
  console.log(`OpenTelemetry tracing initialized for service: ${serviceName}`);

  // Gracefully shut down the SDK on process exit
  process.on('SIGTERM', () => {
    sdk.shutdown()
      .then(() => console.log('Tracing terminated'))
      .catch(error => console.error('Error terminating tracing', error))
      .finally(() => process.exit(0));
  });

  return sdk;
}

/**
 * This function creates a partial wrapper around the OpenTelemetry tracing API
 * to make it easier to use in our codebase.
 * 
 * It provides common trace helpers with trading-specific context.
 */
export function createTraceHelpers() {
  return {
    /**
     * Record an order lifecycle trace with all the key stages
     * 
     * @param order The order object
     * @param traceCallback Async function containing all operations to trace
     * @returns The result of the callback
     */
    traceOrderLifecycle: async (order: any, traceCallback: () => Promise<any>) => {
      // Implementation will be added here
      return traceCallback();
    },

    /**
     * Record market data processing with appropriate attributes
     * 
     * @param marketData The market data update
     * @param traceCallback Async function containing processing logic
     * @returns The result of the callback
     */
    traceMarketDataProcessing: async (marketData: any, traceCallback: () => Promise<any>) => {
      // Implementation will be added here
      return traceCallback();
    }
  };
}

// Singleton instance
let tracerSdk: NodeSDK | null = null;

/**
 * Get or create the tracer SDK
 */
export function getTracerSdk(serviceName?: string, samplingRatio?: number): NodeSDK {
  if (!tracerSdk) {
    tracerSdk = initializeTracing(serviceName, samplingRatio);
  }
  return tracerSdk;
}

export default { 
  initializeTracing, 
  createTraceHelpers,
  getTracerSdk
}; 