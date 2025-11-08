/**
 * Telemetry Layer - Production-grade monitoring and observability
 * 
 * Provides comprehensive system monitoring with metrics, logging,
 * tracing, and alerting capabilities.
 */

// Export types
export * from './types/telemetry';

// Export core components
export { TelemetryService } from './core/TelemetryService';
export { MetricExporter } from './exporters/MetricExporter';
export { LogBridge } from './loggers/LogBridge';
export { Tracer } from './tracers/Tracer';
export { ErrorAlertRouter } from './ErrorAlertRouter';
export { MetricsCollector } from './collectors/MetricsCollector';

// Export dashboard templates
import dashboardTemplates from './dashboards/DashboardTemplates.json';
export { dashboardTemplates };

// Re-export commonly used external types
export {
  Logger,
  createLogger,
  format,
  transports
} from 'winston';

export {
  Counter,
  Gauge,
  Histogram,
  Summary,
  Registry
} from 'prom-client';

export {
  trace,
  context,
  SpanKind,
  SpanStatusCode,
  propagation
} from '@opentelemetry/api'; 