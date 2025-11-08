import { Exporter } from './Exporter';
import { Metric, ErrorRecord, SeverityLevel } from '../Telemetry';
import { logger } from '../../utils/logger';

/**
 * Console exporter configuration
 */
export interface ConsoleExporterConfig {
  /**
   * Print detailed metric information
   */
  detailedMetrics: boolean;
  
  /**
   * Print detailed error information
   */
  detailedErrors: boolean;
  
  /**
   * Minimum severity level for errors to be exported
   */
  minErrorSeverity: SeverityLevel;
  
  /**
   * Pretty print JSON output
   */
  prettyPrint: boolean;
}

/**
 * Default console exporter configuration
 */
const defaultConfig: ConsoleExporterConfig = {
  detailedMetrics: false,
  detailedErrors: true,
  minErrorSeverity: SeverityLevel.WARNING,
  prettyPrint: true
};

/**
 * Exports telemetry data to the console
 */
export class ConsoleExporter implements Exporter {
  private config: ConsoleExporterConfig;

  /**
   * Create a new console exporter
   */
  constructor(config: Partial<ConsoleExporterConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Export a single metric
   */
  exportMetric(metric: Metric): void {
    if (this.config.detailedMetrics) {
      logger.debug(
        `METRIC: ${metric.name} = ${metric.value}`,
        this.config.prettyPrint 
          ? JSON.stringify(metric, null, 2) 
          : metric
      );
    } else {
      logger.debug(`METRIC: ${metric.name} = ${metric.value}`);
    }
  }
  
  /**
   * Export multiple metrics in batch
   */
  exportMetrics(metrics: Metric[]): void {
    if (metrics.length === 0) {
      return;
    }
    
    logger.debug(`Exporting ${metrics.length} metrics to console`);
    
    if (this.config.detailedMetrics) {
      // Group metrics by name for better readability
      const metricsByName: Record<string, Metric[]> = {};
      
      for (const metric of metrics) {
        if (!metricsByName[metric.name]) {
          metricsByName[metric.name] = [];
        }
        metricsByName[metric.name].push(metric);
      }
      
      logger.debug('METRICS BY NAME:', this.config.prettyPrint 
        ? JSON.stringify(metricsByName, null, 2) 
        : metricsByName
      );
    } else {
      // Just print a summary
      const summary: Record<string, number> = {};
      
      for (const metric of metrics) {
        summary[metric.name] = metric.value;
      }
      
      logger.debug('METRICS SUMMARY:', this.config.prettyPrint 
        ? JSON.stringify(summary, null, 2) 
        : summary
      );
    }
  }
  
  /**
   * Export a single error
   */
  exportError(error: ErrorRecord): void {
    if (error.severity < this.config.minErrorSeverity) {
      return;
    }
    
    const severityStr = SeverityLevel[error.severity];
    
    if (this.config.detailedErrors) {
      logger.error(
        `[${severityStr}] ERROR in ${error.component}: ${error.message}`,
        this.config.prettyPrint 
          ? JSON.stringify(error, null, 2) 
          : error
      );
    } else {
      logger.error(`[${severityStr}] ERROR in ${error.component}: ${error.message}`);
    }
  }
  
  /**
   * Export multiple errors in batch
   */
  exportErrors(errors: ErrorRecord[]): void {
    if (errors.length === 0) {
      return;
    }
    
    const filteredErrors = errors.filter(e => e.severity >= this.config.minErrorSeverity);
    
    if (filteredErrors.length === 0) {
      return;
    }
    
    logger.debug(`Exporting ${filteredErrors.length} errors to console`);
    
    for (const error of filteredErrors) {
      this.exportError(error);
    }
  }
} 