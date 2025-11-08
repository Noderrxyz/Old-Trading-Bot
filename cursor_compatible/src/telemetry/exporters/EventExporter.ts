import { Exporter } from './Exporter';
import { Metric, ErrorRecord, EventRecord, SeverityLevel, TelemetryEvents } from '../Telemetry';
import { logger } from '../../utils/logger';
import { EventEmitter } from 'events';

/**
 * Event exporter configuration
 */
export interface EventExporterConfig {
  /**
   * Whether to convert errors to events
   */
  convertErrorsToEvents: boolean;
  
  /**
   * Whether to emit higher-level events for significant metrics
   */
  emitMetricEvents: boolean;
  
  /**
   * Threshold for metric values that should trigger events
   */
  metricEventThresholds: Record<string, number>;
  
  /**
   * Listener for events (if not using subscription)
   */
  eventListener?: (event: EventRecord) => void;
  
  /**
   * Minimum error severity to convert to events
   */
  minErrorSeverity: SeverityLevel;
}

/**
 * Default event exporter configuration
 */
const defaultConfig: EventExporterConfig = {
  convertErrorsToEvents: true,
  emitMetricEvents: true,
  metricEventThresholds: {
    'order_execution_latency': 500, // ms
    'position_update_latency': 100, // ms
    'risk_check_duration': 50, // ms
    'tick_processing_latency': 20, // ms
    'strategy_eval_latency': 200, // ms
  },
  minErrorSeverity: SeverityLevel.ERROR
};

/**
 * Events that can be emitted by the event exporter
 */
export enum TradingSystemEvents {
  VENUE_LATENCY_SPIKE = 'VENUE_LATENCY_SPIKE',
  ORDER_EXECUTION_DELAY = 'ORDER_EXECUTION_DELAY',
  POSITION_SYNC_ERROR = 'POSITION_SYNC_ERROR',
  RISK_CHECK_FAILURE = 'RISK_CHECK_FAILURE',
  MARKET_DATA_ANOMALY = 'MARKET_DATA_ANOMALY',
  STRATEGY_ERROR = 'STRATEGY_ERROR',
  SYSTEM_RESOURCE_WARNING = 'SYSTEM_RESOURCE_WARNING',
  TRADING_THRESHOLD_BREACHED = 'TRADING_THRESHOLD_BREACHED'
}

/**
 * Exports telemetry data as structured events
 */
export class EventExporter extends EventEmitter implements Exporter {
  private config: EventExporterConfig;
  private lastEvents: Map<string, number> = new Map();
  private eventThrottleMs: number = 5000; // Don't repeat similar events within 5 seconds

  /**
   * Create a new event exporter
   */
  constructor(config: Partial<EventExporterConfig> = {}) {
    super();
    this.config = { ...defaultConfig, ...config };
    
    // Set up listener if provided
    if (this.config.eventListener) {
      this.on('event', this.config.eventListener);
    }
    
    logger.debug('Event exporter initialized');
  }

  /**
   * Export a single metric
   */
  exportMetric(metric: Metric): void {
    if (!this.config.emitMetricEvents) {
      return;
    }
    
    const { name, value, timestamp, tags = {} } = metric;
    
    // Check if this metric should trigger an event
    this.checkMetricThresholds(name, value, timestamp, tags);
  }
  
  /**
   * Export multiple metrics in batch
   */
  exportMetrics(metrics: Metric[]): void {
    if (!this.config.emitMetricEvents) {
      return;
    }
    
    for (const metric of metrics) {
      this.exportMetric(metric);
    }
  }
  
  /**
   * Export a single error
   */
  exportError(error: ErrorRecord): void {
    if (!this.config.convertErrorsToEvents || error.severity < this.config.minErrorSeverity) {
      return;
    }
    
    // Convert error to event
    const event: EventRecord = {
      name: this.determineEventNameFromError(error),
      component: error.component,
      timestamp: error.timestamp,
      tags: {
        ...error.tags,
        severity: SeverityLevel[error.severity],
        error_message: error.message
      },
      metadata: error.metadata
    };
    
    this.exportEvent(event);
  }
  
  /**
   * Export multiple errors in batch
   */
  exportErrors(errors: ErrorRecord[]): void {
    if (!this.config.convertErrorsToEvents) {
      return;
    }
    
    for (const error of errors) {
      this.exportError(error);
    }
  }
  
  /**
   * Export a single event
   */
  exportEvent(event: EventRecord): void {
    // Throttle similar events
    const eventKey = `${event.component}:${event.name}`;
    const now = Date.now();
    const lastTime = this.lastEvents.get(eventKey) || 0;
    
    if (now - lastTime < this.eventThrottleMs) {
      return;
    }
    
    // Update last event time
    this.lastEvents.set(eventKey, now);
    
    // Emit the event
    this.emit('event', event);
    this.emit(event.name, event);
    
    // Log the event
    const tags = event.tags ? ` ${JSON.stringify(event.tags)}` : '';
    logger.info(`EVENT: [${event.component}] ${event.name}${tags}`);
  }
  
  /**
   * Check if a metric should trigger an event
   */
  private checkMetricThresholds(name: string, value: number, timestamp: number, tags: Record<string, string>): void {
    // Check specific metric thresholds
    const thresholdValue = this.config.metricEventThresholds[name];
    if (thresholdValue && value > thresholdValue) {
      const eventName = this.determineEventNameFromMetric(name, value);
      if (!eventName) {
        return;
      }
      
      const event: EventRecord = {
        name: eventName,
        component: tags.component || name.split('.')[0],
        timestamp,
        tags: {
          ...tags,
          metric_name: name,
          metric_value: String(value),
          threshold: String(thresholdValue)
        }
      };
      
      this.exportEvent(event);
    }
    
    // Additional special case checks
    this.checkSpecialMetricCases(name, value, timestamp, tags);
  }
  
  /**
   * Check for special metric patterns that should trigger events
   */
  private checkSpecialMetricCases(name: string, value: number, timestamp: number, tags: Record<string, string>): void {
    // Example: Check for rapid changes in latency metrics
    if (name.endsWith('_latency') || name.endsWith('_duration')) {
      const metricKey = `prev:${name}`;
      const prevValue = this.lastEvents.get(metricKey) as number | undefined;
      
      if (prevValue && value > prevValue * 3 && value > 50) {
        // Latency spike (3x increase and above 50ms minimum)
        const event: EventRecord = {
          name: TradingSystemEvents.VENUE_LATENCY_SPIKE,
          component: tags.component || name.split('.')[0],
          timestamp,
          tags: {
            ...tags,
            metric_name: name,
            current_value: String(value),
            previous_value: String(prevValue),
            increase_factor: String((value / prevValue).toFixed(2))
          }
        };
        
        this.exportEvent(event);
      }
      
      // Update last value
      this.lastEvents.set(metricKey, value);
    }
  }
  
  /**
   * Determine event name based on metric name and value
   */
  private determineEventNameFromMetric(metricName: string, value: number): string {
    if (metricName.includes('order_execution_latency')) {
      return TradingSystemEvents.ORDER_EXECUTION_DELAY;
    } else if (metricName.includes('position_update_latency')) {
      return TradingSystemEvents.POSITION_SYNC_ERROR;
    } else if (metricName.includes('risk_check_duration')) {
      return TradingSystemEvents.RISK_CHECK_FAILURE;
    } else if (metricName.includes('tick_processing_latency')) {
      return TradingSystemEvents.MARKET_DATA_ANOMALY;
    } else if (metricName.includes('strategy_eval_latency')) {
      return TradingSystemEvents.STRATEGY_ERROR;
    } else if (metricName.includes('cpu') || metricName.includes('memory')) {
      return TradingSystemEvents.SYSTEM_RESOURCE_WARNING;
    } else if (metricName.includes('exposure') || metricName.includes('limit')) {
      return TradingSystemEvents.TRADING_THRESHOLD_BREACHED;
    }
    
    return '';
  }
  
  /**
   * Determine event name based on error
   */
  private determineEventNameFromError(error: ErrorRecord): string {
    const component = error.component.toLowerCase();
    
    if (component.includes('order') || component.includes('execution')) {
      return TradingSystemEvents.ORDER_EXECUTION_DELAY;
    } else if (component.includes('position')) {
      return TradingSystemEvents.POSITION_SYNC_ERROR;
    } else if (component.includes('risk')) {
      return TradingSystemEvents.RISK_CHECK_FAILURE;
    } else if (component.includes('market') || component.includes('data')) {
      return TradingSystemEvents.MARKET_DATA_ANOMALY;
    } else if (component.includes('strategy')) {
      return TradingSystemEvents.STRATEGY_ERROR;
    }
    
    return TradingSystemEvents.SYSTEM_RESOURCE_WARNING;
  }
  
  /**
   * Set the throttle interval for similar events
   */
  public setEventThrottleMs(throttleMs: number): void {
    this.eventThrottleMs = throttleMs;
  }
  
  /**
   * Update configuration
   */
  public updateConfig(config: Partial<EventExporterConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * Clean up resources
   */
  public stop(): void {
    this.removeAllListeners();
    logger.info('Event exporter stopped');
  }
} 