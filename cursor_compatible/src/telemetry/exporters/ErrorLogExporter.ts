import * as fs from 'fs';
import * as path from 'path';
import { Exporter } from './Exporter';
import { Metric, ErrorRecord, SeverityLevel } from '../Telemetry';
import { logger } from '../../utils/logger';

/**
 * Error Log exporter configuration
 */
export interface ErrorLogExporterConfig {
  /**
   * Directory to store error logs
   */
  outputDir: string;
  
  /**
   * File name for error logs
   */
  errorLogFile: string;
  
  /**
   * Create a new file each day
   */
  rotateDaily: boolean;
  
  /**
   * Maximum number of old files to keep (0 = keep all)
   */
  maxHistoryFiles: number;
  
  /**
   * Create detailed error logs with stack traces
   */
  includeStackTraces: boolean;
  
  /**
   * Group similar errors together
   */
  groupSimilarErrors: boolean;
  
  /**
   * Minimum severity level for errors to be exported
   */
  minErrorSeverity: SeverityLevel;
  
  /**
   * Create directory if it doesn't exist
   */
  createDir: boolean;
}

/**
 * Default Error Log exporter configuration
 */
const defaultConfig: ErrorLogExporterConfig = {
  outputDir: './logs/errors',
  errorLogFile: 'errors.log',
  rotateDaily: true,
  maxHistoryFiles: 7,
  includeStackTraces: true,
  groupSimilarErrors: true,
  minErrorSeverity: SeverityLevel.WARNING,
  createDir: true
};

/**
 * Error grouping bucket
 */
interface ErrorGroup {
  count: number;
  firstSeen: number;
  lastSeen: number;
  instances: ErrorRecord[];
  severityCount: Record<number, number>;
}

/**
 * Exports detailed error logs in structured format
 */
export class ErrorLogExporter implements Exporter {
  private config: ErrorLogExporterConfig;
  private currentDate: string = '';
  private errorLogPath: string = '';
  private errorGroups: Map<string, ErrorGroup> = new Map();
  private lastFlush: number = Date.now();
  private flushInterval: NodeJS.Timeout | null = null;

  /**
   * Create a new Error Log exporter
   */
  constructor(config: Partial<ErrorLogExporterConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    this.updatePaths();
    this.ensureDirectoryExists();
    
    // Set up auto-flush for grouped errors
    if (this.config.groupSimilarErrors) {
      this.flushInterval = setInterval(() => this.flushGroups(), 60000); // Flush every minute
    }
  }

  /**
   * Export a single metric (not used directly)
   */
  exportMetric(metric: Metric): void {
    // Metrics are ignored in ErrorLogExporter
  }
  
  /**
   * Export multiple metrics in batch (not used directly)
   */
  exportMetrics(metrics: Metric[]): void {
    // Metrics are ignored in ErrorLogExporter
  }
  
  /**
   * Export a single error
   */
  exportError(error: ErrorRecord): void {
    if (error.severity < this.config.minErrorSeverity) {
      return;
    }
    
    this.checkRotation();
    
    if (this.config.groupSimilarErrors) {
      this.addToGroup(error);
    } else {
      this.writeErrorToLog(error);
    }
  }
  
  /**
   * Export multiple errors in batch
   */
  exportErrors(errors: ErrorRecord[]): void {
    if (errors.length === 0) {
      return;
    }
    
    this.checkRotation();
    
    const filteredErrors = errors.filter(e => e.severity >= this.config.minErrorSeverity);
    
    if (filteredErrors.length === 0) {
      return;
    }
    
    logger.debug(`Exporting ${filteredErrors.length} errors to log file`);
    
    if (this.config.groupSimilarErrors) {
      for (const error of filteredErrors) {
        this.addToGroup(error);
      }
      
      // Flush groups immediately if there are many errors
      if (filteredErrors.length > 20) {
        this.flushGroups();
      }
    } else {
      for (const error of filteredErrors) {
        this.writeErrorToLog(error);
      }
    }
  }
  
  /**
   * Add an error to its group
   */
  private addToGroup(error: ErrorRecord): void {
    // Create a key based on component and message (without variables)
    const normalizedMessage = this.normalizeErrorMessage(error.message);
    const key = `${error.component}:${normalizedMessage}`;
    
    if (!this.errorGroups.has(key)) {
      this.errorGroups.set(key, {
        count: 0,
        firstSeen: error.timestamp,
        lastSeen: error.timestamp,
        instances: [],
        severityCount: {}
      });
    }
    
    const group = this.errorGroups.get(key)!;
    
    // Update group stats
    group.count++;
    group.lastSeen = error.timestamp;
    group.severityCount[error.severity] = (group.severityCount[error.severity] || 0) + 1;
    
    // Store instance if we haven't reached limit
    if (group.instances.length < 10) {
      group.instances.push(error);
    }
    
    // If this is a high severity error or we've collected many errors, flush immediately
    if (error.severity >= SeverityLevel.ERROR || group.count >= 100) {
      this.flushGroups();
    }
  }
  
  /**
   * Normalize error message to group similar errors
   */
  private normalizeErrorMessage(message: string): string {
    return message
      // Replace numbers with placeholder
      .replace(/\d+/g, '{N}')
      // Replace UUIDs and similar long hex strings
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{UUID}')
      // Replace common variable values
      .replace(/(["'])(?:(?=(\\?))\2.)*?\1/g, "'{STR}'");
  }
  
  /**
   * Flush error groups to log
   */
  private flushGroups(): void {
    const now = Date.now();
    
    // Don't flush if no groups or last flush was recent (unless forced)
    if (this.errorGroups.size === 0 || (now - this.lastFlush < 30000)) {
      return;
    }
    
    try {
      for (const [key, group] of this.errorGroups.entries()) {
        // Format group summary
        const summary = {
          component: group.instances[0]?.component || key.split(':')[0],
          message: key.split(':')[1],
          count: group.count,
          first_seen: new Date(group.firstSeen).toISOString(),
          last_seen: new Date(group.lastSeen).toISOString(),
          duration_ms: group.lastSeen - group.firstSeen,
          severity_counts: Object.entries(group.severityCount)
            .map(([sev, count]) => `${SeverityLevel[Number(sev)]}: ${count}`)
            .join(', '),
          examples: group.instances.map(err => ({
            timestamp: new Date(err.timestamp).toISOString(),
            message: err.message,
            severity: SeverityLevel[err.severity],
            tags: err.tags,
            stack: this.config.includeStackTraces ? err.stack : undefined
          }))
        };
        
        const logEntry = JSON.stringify(summary, null, 2);
        fs.appendFileSync(this.errorLogPath, `\n--- ERROR GROUP (${group.count} occurrences) ---\n${logEntry}\n`);
      }
      
      // Clear groups after flush
      this.errorGroups.clear();
      this.lastFlush = now;
    } catch (error) {
      logger.error(`Error flushing error groups: ${error}`);
    }
  }
  
  /**
   * Write a single error to log
   */
  private writeErrorToLog(error: ErrorRecord): void {
    try {
      const timestamp = new Date(error.timestamp).toISOString();
      const severity = SeverityLevel[error.severity];
      
      let logEntry = `[${timestamp}] [${severity}] ${error.component}: ${error.message}`;
      
      // Add tags if present
      if (error.tags && Object.keys(error.tags).length > 0) {
        logEntry += `\nTags: ${JSON.stringify(error.tags)}`;
      }
      
      // Add metadata if present
      if (error.metadata && Object.keys(error.metadata).length > 0) {
        logEntry += `\nMetadata: ${JSON.stringify(error.metadata)}`;
      }
      
      // Add stack trace if configured and available
      if (this.config.includeStackTraces && error.stack) {
        logEntry += `\nStack: ${error.stack.split('\n').join('\n  ')}`;
      }
      
      fs.appendFileSync(this.errorLogPath, `${logEntry}\n\n`);
    } catch (e) {
      logger.error(`Error writing to error log: ${e}`);
    }
  }
  
  /**
   * Update file paths based on configuration
   */
  private updatePaths(): void {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    if (this.config.rotateDaily) {
      const errorFile = this.config.errorLogFile.replace(/\.log$/, `-${date}.log`);
      this.errorLogPath = path.join(this.config.outputDir, errorFile);
    } else {
      this.errorLogPath = path.join(this.config.outputDir, this.config.errorLogFile);
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
        // Flush any pending groups before rotation
        this.flushGroups();
        
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
      
      // Regular expression to match rotated files
      const errorBase = this.config.errorLogFile.replace(/\.log$/, '');
      const errorRegex = new RegExp(`^${errorBase}-\\d{4}-\\d{2}-\\d{2}\\.log$`);
      
      // Find and sort rotated files
      const errorFiles = files
        .filter(f => errorRegex.test(f))
        .sort()
        .reverse();
      
      // Delete old files
      errorFiles
        .slice(this.config.maxHistoryFiles)
        .forEach(file => {
          fs.unlinkSync(path.join(this.config.outputDir, file));
          logger.debug(`Deleted old error log file: ${file}`);
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
        logger.debug(`Created error log directory: ${this.config.outputDir}`);
      }
    } catch (error) {
      logger.error(`Error creating output directory: ${error}`);
    }
  }
  
  /**
   * Stop exporter and perform cleanup
   */
  public stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    
    this.flushGroups();
    logger.info('Error Log exporter stopped');
  }
} 