import * as fs from 'fs';
import * as path from 'path';
import { Exporter } from './Exporter';
import { Metric, ErrorRecord, SeverityLevel } from '../Telemetry';
import { logger } from '../../utils/logger';

/**
 * JSON file exporter configuration
 */
export interface JsonExporterConfig {
  /**
   * Directory to store JSON files
   */
  outputDir: string;
  
  /**
   * File path for metrics (relative to outputDir)
   */
  metricsFile: string;
  
  /**
   * File path for errors (relative to outputDir)
   */
  errorsFile: string;
  
  /**
   * Create a new file each day
   */
  rotateDaily: boolean;
  
  /**
   * Maximum number of old files to keep (0 = keep all)
   */
  maxHistoryFiles: number;
  
  /**
   * Append to existing file or overwrite
   */
  append: boolean;
  
  /**
   * Create output directory if it doesn't exist
   */
  createDir: boolean;
  
  /**
   * Include full timestamp with each record
   */
  includeTimestamp: boolean;
  
  /**
   * Minimum severity level for errors to be exported
   */
  minErrorSeverity: SeverityLevel;
}

/**
 * Default JSON exporter configuration
 */
const defaultConfig: JsonExporterConfig = {
  outputDir: './logs/telemetry',
  metricsFile: 'metrics.jsonl',
  errorsFile: 'errors.jsonl',
  rotateDaily: true,
  maxHistoryFiles: 7,
  append: true,
  createDir: true,
  includeTimestamp: true,
  minErrorSeverity: SeverityLevel.INFO
};

/**
 * Exports telemetry data to JSON files
 */
export class JsonExporter implements Exporter {
  private config: JsonExporterConfig;
  private currentDate: string = '';
  private metricsPath: string = '';
  private errorsPath: string = '';

  /**
   * Create a new JSON exporter
   */
  constructor(config: Partial<JsonExporterConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    this.updatePaths();
    this.ensureDirectoryExists();
  }

  /**
   * Export a single metric
   */
  exportMetric(metric: Metric): void {
    this.checkRotation();
    
    try {
      const line = JSON.stringify({
        ...metric,
        timestamp: this.config.includeTimestamp 
          ? new Date(metric.timestamp).toISOString() 
          : undefined
      });
      
      fs.appendFileSync(this.metricsPath, line + '\n');
    } catch (error) {
      logger.error(`Error exporting metric to JSON: ${error}`);
    }
  }
  
  /**
   * Export multiple metrics in batch
   */
  exportMetrics(metrics: Metric[]): void {
    if (metrics.length === 0) {
      return;
    }
    
    this.checkRotation();
    
    try {
      const lines = metrics.map(metric => JSON.stringify({
        ...metric,
        timestamp: this.config.includeTimestamp 
          ? new Date(metric.timestamp).toISOString() 
          : undefined
      }));
      
      fs.appendFileSync(this.metricsPath, lines.join('\n') + '\n');
    } catch (error) {
      logger.error(`Error exporting metrics to JSON: ${error}`);
    }
  }
  
  /**
   * Export a single error
   */
  exportError(error: ErrorRecord): void {
    if (error.severity < this.config.minErrorSeverity) {
      return;
    }
    
    this.checkRotation();
    
    try {
      const line = JSON.stringify({
        ...error,
        severity: SeverityLevel[error.severity],
        timestamp: this.config.includeTimestamp 
          ? new Date(error.timestamp).toISOString() 
          : undefined
      });
      
      fs.appendFileSync(this.errorsPath, line + '\n');
    } catch (e) {
      logger.error(`Error exporting error to JSON: ${e}`);
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
    
    this.checkRotation();
    
    try {
      const lines = filteredErrors.map(error => JSON.stringify({
        ...error,
        severity: SeverityLevel[error.severity],
        timestamp: this.config.includeTimestamp 
          ? new Date(error.timestamp).toISOString() 
          : undefined
      }));
      
      fs.appendFileSync(this.errorsPath, lines.join('\n') + '\n');
    } catch (error) {
      logger.error(`Error exporting errors to JSON: ${error}`);
    }
  }
  
  /**
   * Update file paths based on configuration
   */
  private updatePaths(): void {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    if (this.config.rotateDaily) {
      const metricsFile = this.config.metricsFile.replace(/\.(json|jsonl)$/, `-${date}.$1`);
      const errorsFile = this.config.errorsFile.replace(/\.(json|jsonl)$/, `-${date}.$1`);
      
      this.metricsPath = path.join(this.config.outputDir, metricsFile);
      this.errorsPath = path.join(this.config.outputDir, errorsFile);
    } else {
      this.metricsPath = path.join(this.config.outputDir, this.config.metricsFile);
      this.errorsPath = path.join(this.config.outputDir, this.config.errorsFile);
    }
    
    this.currentDate = date;
  }
  
  /**
   * Check if files need to be rotated
   */
  private checkRotation(): void {
    if (this.config.rotateDaily) {
      const date = new Date().toISOString().split('T')[0];
      
      if (date !== this.currentDate) {
        this.updatePaths();
        this.cleanupOldFiles();
      }
    }
  }
  
  /**
   * Clean up old log files
   */
  private cleanupOldFiles(): void {
    if (this.config.maxHistoryFiles <= 0) {
      return;
    }
    
    try {
      // Get list of files
      const files = fs.readdirSync(this.config.outputDir);
      
      // Group by base name (metrics vs errors)
      const metricsBase = this.config.metricsFile.replace(/\.(json|jsonl)$/, '');
      const errorsBase = this.config.errorsFile.replace(/\.(json|jsonl)$/, '');
      
      // Regular expressions to match rotated files
      const metricsRegex = new RegExp(`^${metricsBase}-\\d{4}-\\d{2}-\\d{2}\\.(json|jsonl)$`);
      const errorsRegex = new RegExp(`^${errorsBase}-\\d{4}-\\d{2}-\\d{2}\\.(json|jsonl)$`);
      
      // Find and sort rotated files
      const metricsFiles = files
        .filter(f => metricsRegex.test(f))
        .sort()
        .reverse();
      
      const errorsFiles = files
        .filter(f => errorsRegex.test(f))
        .sort()
        .reverse();
      
      // Delete old files
      metricsFiles
        .slice(this.config.maxHistoryFiles)
        .forEach(file => {
          fs.unlinkSync(path.join(this.config.outputDir, file));
          logger.debug(`Deleted old metrics file: ${file}`);
        });
      
      errorsFiles
        .slice(this.config.maxHistoryFiles)
        .forEach(file => {
          fs.unlinkSync(path.join(this.config.outputDir, file));
          logger.debug(`Deleted old errors file: ${file}`);
        });
    } catch (error) {
      logger.error(`Error cleaning up old log files: ${error}`);
    }
  }
  
  /**
   * Create output directory if it doesn't exist
   */
  private ensureDirectoryExists(): void {
    if (!this.config.createDir) {
      return;
    }
    
    try {
      if (!fs.existsSync(this.config.outputDir)) {
        fs.mkdirSync(this.config.outputDir, { recursive: true });
        logger.debug(`Created telemetry output directory: ${this.config.outputDir}`);
      }
    } catch (error) {
      logger.error(`Error creating output directory: ${error}`);
    }
  }
} 