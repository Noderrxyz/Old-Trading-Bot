import { FeedGraphEngine } from './feed_graph/FeedGraphEngine.js';
import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

interface EmitterConfig {
  emitIntervalMs: number;
  outputPath: string;
  maxFileSize: number;
  maxFiles: number;
  historyEnabled: boolean;
  historyIntervalMs: number;
  maxHistoryFiles: number;
}

const DEFAULT_CONFIG: EmitterConfig = {
  emitIntervalMs: 30000, // 30 seconds
  outputPath: path.join(process.cwd(), 'data', 'telemetry'),
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5,
  historyEnabled: true,
  historyIntervalMs: 300000, // 5 minutes
  maxHistoryFiles: 24 // 2 hours of history
};

export class FeedGraphEmitter {
  private static instance: FeedGraphEmitter;
  private engine: FeedGraphEngine;
  private config: EmitterConfig;
  private emitInterval: NodeJS.Timeout | null;
  private historyInterval: NodeJS.Timeout | null;
  private logStream: fs.WriteStream | null;
  private historyStream: fs.WriteStream | null;

  private constructor(config: Partial<EmitterConfig> = {}) {
    this.engine = FeedGraphEngine.getInstance();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.emitInterval = null;
    this.historyInterval = null;
    this.logStream = null;
    this.historyStream = null;
    this.setupOutputDirectory();
  }

  public static getInstance(config?: Partial<EmitterConfig>): FeedGraphEmitter {
    if (!FeedGraphEmitter.instance) {
      FeedGraphEmitter.instance = new FeedGraphEmitter(config);
    }
    return FeedGraphEmitter.instance;
  }

  private setupOutputDirectory(): void {
    if (!fs.existsSync(this.config.outputPath)) {
      fs.mkdirSync(this.config.outputPath, { recursive: true });
    }
  }

  public start(): void {
    if (this.emitInterval) {
      logger.warn('FeedGraphEmitter is already running');
      return;
    }

    this.emitInterval = setInterval(() => {
      this.emitGraphSnapshot();
    }, this.config.emitIntervalMs);

    if (this.config.historyEnabled) {
      this.historyInterval = setInterval(() => {
        this.emitHistorySnapshot();
      }, this.config.historyIntervalMs);
    }

    logger.info('FeedGraphEmitter started');
  }

  public stop(): void {
    if (this.emitInterval) {
      clearInterval(this.emitInterval);
      this.emitInterval = null;
    }
    if (this.historyInterval) {
      clearInterval(this.historyInterval);
      this.historyInterval = null;
    }
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
    if (this.historyStream) {
      this.historyStream.end();
      this.historyStream = null;
    }
    logger.info('FeedGraphEmitter stopped');
  }

  private emitGraphSnapshot(): void {
    try {
      const graph = this.engine.generateGraph();
      const outputFile = path.join(this.config.outputPath, 'feed_graph.json');
      
      // Check file size and rotate if needed
      if (fs.existsSync(outputFile)) {
        const stats = fs.statSync(outputFile);
        if (stats.size > this.config.maxFileSize) {
          this.rotateLogFile();
        }
      }

      // Write the graph snapshot
      fs.writeFileSync(outputFile, JSON.stringify(graph, null, 2));
      logger.debug('Emitted feed graph snapshot');
    } catch (error) {
      logger.error('Error emitting feed graph snapshot:', error);
    }
  }

  private emitHistorySnapshot(): void {
    try {
      const graph = this.engine.generateGraph();
      const historyFile = path.join(this.config.outputPath, 'feed_graph_history.jsonl');
      
      // Check history file size and rotate if needed
      if (fs.existsSync(historyFile)) {
        const stats = fs.statSync(historyFile);
        if (stats.size > this.config.maxFileSize) {
          this.rotateHistoryFile();
        }
      }

      // Append to history file
      if (!this.historyStream) {
        this.historyStream = fs.createWriteStream(historyFile, { flags: 'a' });
      }
      
      this.historyStream.write(JSON.stringify(graph) + '\n');
      logger.debug('Emitted feed graph history snapshot');
    } catch (error) {
      logger.error('Error emitting feed graph history snapshot:', error);
    }
  }

  private rotateLogFile(): void {
    const basePath = path.join(this.config.outputPath, 'feed_graph');
    const currentPath = `${basePath}.json`;
    
    // Find the highest numbered backup file
    let maxNumber = 0;
    for (let i = 1; i <= this.config.maxFiles; i++) {
      const backupPath = `${basePath}.${i}.json`;
      if (fs.existsSync(backupPath)) {
        maxNumber = i;
      }
    }

    // Remove the oldest backup if we've reached maxFiles
    if (maxNumber === this.config.maxFiles) {
      fs.unlinkSync(`${basePath}.${maxNumber}.json`);
      maxNumber--;
    }

    // Shift all backup files up by one
    for (let i = maxNumber; i >= 1; i--) {
      const oldPath = `${basePath}.${i}.json`;
      const newPath = `${basePath}.${i + 1}.json`;
      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
      }
    }

    // Move current file to backup.1
    if (fs.existsSync(currentPath)) {
      fs.renameSync(currentPath, `${basePath}.1.json`);
    }
  }

  private rotateHistoryFile(): void {
    const basePath = path.join(this.config.outputPath, 'feed_graph_history');
    const currentPath = `${basePath}.jsonl`;
    
    // Find the highest numbered backup file
    let maxNumber = 0;
    for (let i = 1; i <= this.config.maxHistoryFiles; i++) {
      const backupPath = `${basePath}.${i}.jsonl`;
      if (fs.existsSync(backupPath)) {
        maxNumber = i;
      }
    }

    // Remove the oldest backup if we've reached maxHistoryFiles
    if (maxNumber === this.config.maxHistoryFiles) {
      fs.unlinkSync(`${basePath}.${maxNumber}.jsonl`);
      maxNumber--;
    }

    // Shift all backup files up by one
    for (let i = maxNumber; i >= 1; i--) {
      const oldPath = `${basePath}.${i}.jsonl`;
      const newPath = `${basePath}.${i + 1}.jsonl`;
      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
      }
    }

    // Move current file to backup.1
    if (fs.existsSync(currentPath)) {
      fs.renameSync(currentPath, `${basePath}.1.jsonl`);
    }

    // Create new history stream
    if (this.historyStream) {
      this.historyStream.end();
      this.historyStream = fs.createWriteStream(currentPath, { flags: 'a' });
    }
  }
} 