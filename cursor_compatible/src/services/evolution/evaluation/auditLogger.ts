/**
 * Evaluation Audit Logger
 * 
 * Specialized logger for creating audit trails of strategy evaluations.
 */

import fs from 'fs';
import path from 'path';
import { createWriteStream, WriteStream } from 'fs';
import logger from '../../../utils/logger.js';

/**
 * Configuration for the audit logger
 */
export interface AuditLoggerConfig {
  /** Base directory for audit logs */
  baseDir: string;
  
  /** Whether to enable audit logging */
  enabled: boolean;
  
  /** Maximum log file size in bytes */
  maxFileSize: number;
  
  /** Maximum number of log files to keep */
  maxFiles: number;
  
  /** Log format (text or json) */
  format: 'text' | 'json';
}

/**
 * Default configuration for audit logger
 */
const DEFAULT_CONFIG: AuditLoggerConfig = {
  baseDir: 'logs/evolution',
  enabled: true,
  maxFileSize: 10 * 1024 * 1024, // 10 MB
  maxFiles: 10,
  format: 'json'
};

/**
 * Service for generating audit logs of strategy evaluations
 */
export class AuditLogger {
  private config: AuditLoggerConfig;
  private writeStream: WriteStream | null = null;
  private currentLogFile: string = '';
  private currentFileSize: number = 0;
  
  /**
   * Create a new AuditLogger instance
   * 
   * @param config - Configuration options
   */
  constructor(config: Partial<AuditLoggerConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config
    };
    
    if (this.config.enabled) {
      this.setupLogDirectory();
      this.openLogFile();
    }
  }
  
  /**
   * Set up the log directory
   */
  private setupLogDirectory(): void {
    try {
      if (!fs.existsSync(this.config.baseDir)) {
        fs.mkdirSync(this.config.baseDir, { recursive: true });
        logger.info(`Created audit log directory: ${this.config.baseDir}`);
      }
    } catch (error) {
      logger.error(`Failed to create audit log directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Open a new log file
   */
  private openLogFile(): void {
    try {
      // Close existing stream if any
      if (this.writeStream) {
        this.writeStream.end();
        this.writeStream = null;
      }
      
      // Generate a new log file name
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      this.currentLogFile = path.join(this.config.baseDir, `evaluation-${timestamp}.log`);
      
      // Create a new write stream
      this.writeStream = createWriteStream(this.currentLogFile, { flags: 'a' });
      this.currentFileSize = 0;
      
      logger.info(`Opened new audit log file: ${this.currentLogFile}`);
      
      // Rotate old logs if needed
      this.rotateOldLogs();
    } catch (error) {
      logger.error(`Failed to open audit log file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Rotate old log files
   */
  private rotateOldLogs(): void {
    try {
      const files = fs.readdirSync(this.config.baseDir)
        .filter(file => file.startsWith('evaluation-') && file.endsWith('.log'))
        .map(file => path.join(this.config.baseDir, file))
        .sort((a, b) => {
          const statA = fs.statSync(a);
          const statB = fs.statSync(b);
          return statB.mtime.getTime() - statA.mtime.getTime();
        });
        
      // Remove oldest files if we have too many
      if (files.length > this.config.maxFiles) {
        for (let i = this.config.maxFiles; i < files.length; i++) {
          if (files[i] !== this.currentLogFile) {
            fs.unlinkSync(files[i]);
            logger.info(`Deleted old audit log file: ${files[i]}`);
          }
        }
      }
    } catch (error) {
      logger.error(`Failed to rotate audit logs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Log an evaluation event
   * 
   * @param eventType - Type of event
   * @param data - Event data
   */
  public log(eventType: string, data: any): void {
    if (!this.config.enabled || !this.writeStream) {
      return;
    }
    
    try {
      // Create log entry
      const entry = {
        timestamp: new Date().toISOString(),
        eventType,
        ...data
      };
      
      // Format the entry
      let logLine: string;
      
      if (this.config.format === 'json') {
        logLine = JSON.stringify(entry) + '\n';
      } else {
        logLine = `[${entry.timestamp}] ${eventType}: ${JSON.stringify(data)}\n`;
      }
      
      // Write to the log file
      this.writeStream.write(logLine);
      this.currentFileSize += logLine.length;
      
      // Check if we need to rotate
      if (this.currentFileSize >= this.config.maxFileSize) {
        this.openLogFile();
      }
    } catch (error) {
      logger.error(`Failed to write to audit log: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Log an evaluation start event
   * 
   * @param evaluationId - ID of the evaluation
   * @param strategyId - ID of the strategy
   * @param agentId - ID of the agent
   * @param generationId - ID of the generation
   */
  public logEvaluationStart(
    evaluationId: string,
    strategyId: string,
    agentId: string,
    generationId: string
  ): void {
    this.log('EVALUATION_START', {
      evaluationId,
      strategyId,
      agentId,
      generationId
    });
  }
  
  /**
   * Log an evaluation result
   * 
   * @param result - Evaluation result
   */
  public logEvaluationResult(result: any): void {
    this.log('EVALUATION_RESULT', result);
  }
  
  /**
   * Log a promotion event
   * 
   * @param intent - Promotion intent
   */
  public logPromotion(intent: any): void {
    this.log('PROMOTION', intent);
  }
  
  /**
   * Log a re-mutation event
   * 
   * @param intent - Re-mutation intent
   */
  public logRemutation(intent: any): void {
    this.log('REMUTATION', intent);
  }
  
  /**
   * Close the logger and release resources
   */
  public close(): void {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
      logger.info(`Closed audit log file: ${this.currentLogFile}`);
    }
  }
} 