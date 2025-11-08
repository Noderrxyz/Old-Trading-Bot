/**
 * Trade Lifecycle Tracker
 * 
 * Links every trade to its originating alpha signal and tracks the complete
 * lifecycle of execution and resolution, enabling traceable accountability
 * and enhancing alpha feedback loops.
 */

import { createLogger } from '../common/logger.js';
import { RedisClient } from '../common/redis.js';
import { FusedAlphaFrame } from '../alphasources/fusion-engine.js';
import { TradeExecutionResult } from '../agents/utils/tradeTelemetry.js';
import { ExecutedOrder } from '../types/execution.types.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Trade lifecycle configuration
 */
export interface TradeLifecycleConfig {
  /** Whether lifecycle tracking is enabled */
  enabled: boolean;
  
  /** Maximum retention time in seconds */
  maxRetentionSeconds: number;
  
  /** Storage backend type */
  storage: 'redis' | 'file' | 'memory';
  
  /** Export path for file storage */
  exportPath?: string;
  
  /** Whether to include full alpha signal details (can be large) */
  includeFullSignalDetails: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: TradeLifecycleConfig = {
  enabled: true,
  maxRetentionSeconds: 172800, // 48 hours
  storage: 'redis',
  exportPath: 'data/trade_lifecycle_logs.jsonl',
  includeFullSignalDetails: false
};

/**
 * Trade execution entry
 */
export interface TradeLifecycleExecution {
  /** Trade execution data */
  execution: TradeExecutionResult | ExecutedOrder;
  
  /** When this execution was recorded */
  recordedAt: number;
  
  /** Original signal ID that led to this trade */
  signalId: string;
}

/**
 * Trade resolution with PnL
 */
export interface TradeLifecycleResolution {
  /** Profit and loss from the trade */
  pnl: number;
  
  /** Whether the trade was profitable */
  profitable: boolean;
  
  /** When this resolution was recorded */
  recordedAt: number;
  
  /** Any additional resolution metadata */
  metadata?: Record<string, any>;
}

/**
 * Complete trade lifecycle information
 */
export interface TradeLifecycle {
  /** Original alpha signal that initiated the trade */
  signal: FusedAlphaFrame;
  
  /** Unique signal identifier */
  signalId: string;
  
  /** Trade execution details */
  execution?: TradeLifecycleExecution;
  
  /** Trade resolution details */
  resolution?: TradeLifecycleResolution;
  
  /** When this entry was first created */
  createdAt: number;
  
  /** When this entry was last updated */
  updatedAt: number;
}

/**
 * Trade lifecycle query result
 */
export interface TradeLifecycleQueryResult {
  /** Number of results found */
  count: number;
  
  /** Lifecycle entries */
  items: TradeLifecycle[];
}

/**
 * Trade Lifecycle Tracker
 * 
 * Tracks every step of the trade lifecycle from signal generation
 * to execution and final resolution, enabling transparent 
 * traceability and performance analysis.
 */
export class TradeLifecycleTracker {
  private readonly logger;
  private readonly config: TradeLifecycleConfig;
  private readonly redis?: RedisClient;
  
  /** In-memory storage (always used as a cache even with persistent storage) */
  private memoryStore: Map<string, TradeLifecycle> = new Map();
  
  /** Signal-to-trade mapping */
  private signalToTrades: Map<string, Set<string>> = new Map();
  
  /** Trade-to-signal mapping */
  private tradeToSignal: Map<string, string> = new Map();
  
  /**
   * Create a new TradeLifecycleTracker
   * @param config Lifecycle configuration
   * @param redis Optional Redis client
   */
  constructor(
    config: Partial<TradeLifecycleConfig> = {}, 
    redis?: RedisClient
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = createLogger('TradeLifecycleTracker');
    
    // Store Redis client if provided and storage is set to redis
    if (this.config.storage === 'redis' && redis) {
      this.redis = redis;
    } else if (this.config.storage === 'redis' && !redis) {
      this.logger.warn('Redis storage configured but no Redis client provided. Falling back to memory storage.');
      this.config.storage = 'memory';
    }
    
    // Create export directory if using file storage
    if (this.config.storage === 'file' && this.config.exportPath) {
      const directory = path.dirname(this.config.exportPath);
      if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
      }
    }
    
    this.logger.info(`Trade Lifecycle Tracker initialized with ${this.config.storage} storage`);
    
    // Setup periodic cleanup
    setInterval(() => this.cleanup(), 3600000); // Run cleanup every hour
  }
  
  /**
   * Generate a unique ID for a signal
   * @param signal Alpha signal
   * @returns Unique signal ID
   */
  private generateSignalId(signal: FusedAlphaFrame): string {
    const signalData = `${signal.symbol}:${signal.direction}:${signal.timestamp}:${signal.confidence}`;
    return crypto.createHash('md5').update(signalData).digest('hex');
  }
  
  /**
   * Register an alpha signal for lifecycle tracking
   * @param signal Alpha signal to register
   * @returns Signal ID
   */
  public registerSignal(signal: FusedAlphaFrame): string {
    if (!this.config.enabled) return '';
    
    const signalId = this.generateSignalId(signal);
    const now = Date.now();
    
    // Create lifecycle entry
    const lifecycle: TradeLifecycle = {
      signal: this.config.includeFullSignalDetails ? 
        signal : 
        {
          symbol: signal.symbol,
          direction: signal.direction,
          confidence: signal.confidence,
          size: signal.size,
          sources: signal.sources,
          details: [],
          timestamp: signal.timestamp
        },
      signalId,
      createdAt: now,
      updatedAt: now
    };
    
    // Store in memory
    this.memoryStore.set(signalId, lifecycle);
    
    // Initialize signal-to-trades mapping
    this.signalToTrades.set(signalId, new Set());
    
    // Persist to storage
    this.persistLifecycle(signalId, lifecycle);
    
    this.logger.debug(`Registered alpha signal ${signalId} for ${signal.symbol}`);
    
    return signalId;
  }
  
  /**
   * Record trade execution linked to an alpha signal
   * @param trade Trade execution to record
   * @param signalId Original signal ID
   * @returns Trade ID
   */
  public recordExecution(
    trade: TradeExecutionResult | ExecutedOrder, 
    signalId: string
  ): string {
    if (!this.config.enabled || !signalId) return '';
    
    const now = Date.now();
    let tradeId: string;
    
    // Extract trade ID based on type
    if ('orderId' in trade) {
      tradeId = trade.orderId;
    } else if ('intent' in trade) {
      if (trade.intent && 'tags' in trade.intent && Array.isArray(trade.intent.tags)) {
        const orderIdTag = trade.intent.tags.find((tag: string) => tag.startsWith('orderId:'));
        tradeId = orderIdTag ? orderIdTag.slice(8) : `trade-${crypto.randomBytes(8).toString('hex')}`;
      } else {
        tradeId = `trade-${crypto.randomBytes(8).toString('hex')}`;
      }
    } else {
      tradeId = `trade-${crypto.randomBytes(8).toString('hex')}`;
    }
    
    // Check if signal exists
    const lifecycle = this.memoryStore.get(signalId) || this.loadLifecycleSync(signalId);
    
    if (!lifecycle) {
      this.logger.warn(`Cannot record execution for unknown signal ID: ${signalId}`);
      return tradeId;
    }
    
    // Update lifecycle with execution
    const updatedLifecycle: TradeLifecycle = {
      ...lifecycle,
      execution: {
        execution: trade,
        recordedAt: now,
        signalId
      },
      updatedAt: now
    };
    
    // Update in-memory store
    this.memoryStore.set(signalId, updatedLifecycle);
    
    // Update mappings
    const tradeSet = this.signalToTrades.get(signalId);
    if (tradeSet) {
      tradeSet.add(tradeId);
    } else {
      this.signalToTrades.set(signalId, new Set([tradeId]));
    }
    
    this.tradeToSignal.set(tradeId, signalId);
    
    // Persist to storage
    this.persistLifecycle(signalId, updatedLifecycle);
    
    this.logger.debug(`Recorded execution of trade ${tradeId} for signal ${signalId}`);
    
    return tradeId;
  }
  
  /**
   * Finalize a trade with PnL information
   * @param tradeId Trade ID to finalize
   * @param pnl Profit and loss
   * @param metadata Optional additional metadata
   * @returns Whether the finalization was successful
   */
  public finalizeTrade(
    tradeId: string, 
    pnl: number,
    metadata?: Record<string, any>
  ): boolean {
    if (!this.config.enabled || !tradeId) return false;
    
    // Get signal ID for this trade
    const signalId = this.tradeToSignal.get(tradeId);
    
    if (!signalId) {
      this.logger.warn(`Cannot finalize unknown trade ID: ${tradeId}`);
      return false;
    }
    
    // Get lifecycle entry
    const lifecycle = this.memoryStore.get(signalId) || this.loadLifecycleSync(signalId);
    
    if (!lifecycle) {
      this.logger.warn(`Cannot finalize trade with unknown signal lifecycle: ${signalId}`);
      return false;
    }
    
    const now = Date.now();
    
    // Update lifecycle with resolution
    const updatedLifecycle: TradeLifecycle = {
      ...lifecycle,
      resolution: {
        pnl,
        profitable: pnl > 0,
        recordedAt: now,
        metadata
      },
      updatedAt: now
    };
    
    // Update in-memory store
    this.memoryStore.set(signalId, updatedLifecycle);
    
    // Persist to storage
    this.persistLifecycle(signalId, updatedLifecycle);
    
    this.logger.debug(
      `Finalized trade ${tradeId} with ${pnl > 0 ? 'profit' : 'loss'} of ${pnl.toFixed(4)}`
    );
    
    return true;
  }
  
  /**
   * Get the complete lineage for a trade
   * @param tradeId Trade ID to query
   * @returns Trade lifecycle or null if not found
   */
  public getTradeLineage(tradeId: string): TradeLifecycle | null {
    if (!this.config.enabled || !tradeId) return null;
    
    // Get signal ID for this trade
    const signalId = this.tradeToSignal.get(tradeId);
    
    if (!signalId) {
      this.logger.debug(`No signal found for trade ID: ${tradeId}`);
      return null;
    }
    
    // Get lifecycle entry
    const lifecycle = this.memoryStore.get(signalId) || this.loadLifecycleSync(signalId);
    
    if (!lifecycle) {
      this.logger.debug(`No lifecycle found for signal ID: ${signalId}`);
      return null;
    }
    
    return lifecycle;
  }
  
  /**
   * Get trades originating from a specific signal
   * @param signalId Signal ID
   * @returns Array of trade IDs
   */
  public getTradesFromSignal(signalId: string): string[] {
    if (!this.config.enabled || !signalId) return [];
    
    const trades = this.signalToTrades.get(signalId);
    
    if (!trades) {
      this.logger.debug(`No trades found for signal ID: ${signalId}`);
      return [];
    }
    
    return Array.from(trades);
  }
  
  /**
   * Query trades that match specific filters
   * @param filters Filter options
   * @param limit Maximum number of results
   * @returns Query results
   */
  public queryTrades(
    filters: {
      symbol?: string;
      startTime?: number;
      endTime?: number;
      profitable?: boolean;
      minPnl?: number;
      maxPnl?: number;
    },
    limit: number = 100
  ): TradeLifecycleQueryResult {
    if (!this.config.enabled) {
      return { count: 0, items: [] };
    }
    
    // Filter lifecycle entries
    const matches: TradeLifecycle[] = [];
    
    for (const lifecycle of this.memoryStore.values()) {
      let include = true;
      
      // Apply filters
      if (filters.symbol && lifecycle.signal.symbol !== filters.symbol) {
        include = false;
      }
      
      if (filters.startTime && lifecycle.createdAt < filters.startTime) {
        include = false;
      }
      
      if (filters.endTime && lifecycle.createdAt > filters.endTime) {
        include = false;
      }
      
      if (filters.profitable !== undefined && 
          lifecycle.resolution?.profitable !== filters.profitable) {
        include = false;
      }
      
      if (filters.minPnl !== undefined && 
          (lifecycle.resolution?.pnl === undefined || lifecycle.resolution.pnl < filters.minPnl)) {
        include = false;
      }
      
      if (filters.maxPnl !== undefined && 
          (lifecycle.resolution?.pnl === undefined || lifecycle.resolution.pnl > filters.maxPnl)) {
        include = false;
      }
      
      if (include) {
        matches.push(lifecycle);
        
        if (matches.length >= limit) {
          break;
        }
      }
    }
    
    return {
      count: matches.length,
      items: matches
    };
  }
  
  /**
   * Export all lifecycle data to a file
   * @param filePath Path to export file
   * @returns Number of entries exported
   */
  public async exportToFile(filePath?: string): Promise<number> {
    const exportPath = filePath || this.config.exportPath;
    
    if (!exportPath) {
      this.logger.error('No export path specified');
      return 0;
    }
    
    try {
      const directory = path.dirname(exportPath);
      if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
      }
      
      // Export each lifecycle entry as a JSON line
      const writeStream = fs.createWriteStream(exportPath);
      let count = 0;
      
      for (const [signalId, lifecycle] of this.memoryStore.entries()) {
        writeStream.write(JSON.stringify({
          signalId,
          ...lifecycle
        }) + '\n');
        count++;
      }
      
      writeStream.end();
      
      this.logger.info(`Exported ${count} lifecycle entries to ${exportPath}`);
      return count;
    } catch (error) {
      this.logger.error(`Failed to export lifecycle data: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }
  
  /**
   * Cleanup old lifecycle entries based on retention policy
   */
  private cleanup(): void {
    if (!this.config.enabled) return;
    
    const now = Date.now();
    const maxAge = this.config.maxRetentionSeconds * 1000;
    const expiredBefore = now - maxAge;
    
    let expiredCount = 0;
    
    // Cleanup memory store
    for (const [signalId, lifecycle] of this.memoryStore.entries()) {
      if (lifecycle.updatedAt < expiredBefore) {
        // Cleanup signal-to-trades mapping
        this.signalToTrades.delete(signalId);
        
        // Cleanup trade-to-signal mapping
        if (lifecycle.execution) {
          const tradeId = this.getTradeIdFromExecution(lifecycle.execution.execution);
          if (tradeId) {
            this.tradeToSignal.delete(tradeId);
          }
        }
        
        // Remove from memory store
        this.memoryStore.delete(signalId);
        
        // Remove from persistent storage
        this.deleteLifecycle(signalId);
        
        expiredCount++;
      }
    }
    
    if (expiredCount > 0) {
      this.logger.info(`Cleaned up ${expiredCount} expired lifecycle entries`);
    }
  }
  
  /**
   * Extract trade ID from execution data
   * @param execution Trade execution
   * @returns Trade ID
   */
  private getTradeIdFromExecution(execution: TradeExecutionResult | ExecutedOrder): string | null {
    if ('orderId' in execution) {
      return execution.orderId;
    } else if ('intent' in execution) {
      if (execution.intent && 'tags' in execution.intent && Array.isArray(execution.intent.tags)) {
        const orderIdTag = execution.intent.tags.find((tag: string) => tag.startsWith('orderId:'));
        if (orderIdTag) {
          return orderIdTag.slice(8);
        }
      }
    }
    
    return null;
  }
  
  /**
   * Persist lifecycle to storage
   * @param signalId Signal ID
   * @param lifecycle Lifecycle data
   */
  private persistLifecycle(signalId: string, lifecycle: TradeLifecycle): void {
    if (this.config.storage === 'redis' && this.redis) {
      // Store in Redis
      this.persistToRedis(signalId, lifecycle).catch(error => {
        this.logger.error(`Failed to persist to Redis: ${error instanceof Error ? error.message : String(error)}`);
      });
    } else if (this.config.storage === 'file' && this.config.exportPath) {
      // Store in file
      this.persistToFile(signalId, lifecycle);
    }
    // Memory storage is handled implicitly through this.memoryStore
  }
  
  /**
   * Persist lifecycle to Redis
   * @param signalId Signal ID
   * @param lifecycle Lifecycle data
   */
  private async persistToRedis(signalId: string, lifecycle: TradeLifecycle): Promise<void> {
    if (!this.redis) return;
    
    try {
      const key = `trade_lifecycle:${signalId}`;
      
      // Store as JSON
      await this.redis.set(key, JSON.stringify(lifecycle));
      
      // Set expiration
      await this.redis.expire(key, this.config.maxRetentionSeconds);
      
      // If this has a trade ID, store the mapping
      if (lifecycle.execution) {
        const tradeId = this.getTradeIdFromExecution(lifecycle.execution.execution);
        if (tradeId) {
          const tradeKey = `trade_to_signal:${tradeId}`;
          await this.redis.set(tradeKey, signalId);
          await this.redis.expire(tradeKey, this.config.maxRetentionSeconds);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to persist to Redis: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Persist lifecycle to file
   * @param signalId Signal ID
   * @param lifecycle Lifecycle data
   */
  private persistToFile(signalId: string, lifecycle: TradeLifecycle): void {
    if (!this.config.exportPath) return;
    
    try {
      // Append to file as JSON line
      const data = JSON.stringify({ 
        id: signalId,
        lifecycle
      });
      fs.appendFileSync(this.config.exportPath, data + '\n');
    } catch (error) {
      this.logger.error(`Failed to persist to file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Load lifecycle from storage (sync wrapper for async operations)
   * @param signalId Signal ID
   * @returns Lifecycle or null if not found
   */
  private loadLifecycleSync(signalId: string): TradeLifecycle | null {
    if (this.config.storage === 'redis' && this.redis) {
      // For Redis, we need to use a sync approach since our public methods are sync
      // In a real implementation, you might want to make the public methods async as well
      this.loadFromRedis(signalId).then(lifecycle => {
        if (lifecycle) {
          this.memoryStore.set(signalId, lifecycle);
        }
      }).catch(error => {
        this.logger.error(`Failed to load from Redis: ${error instanceof Error ? error.message : String(error)}`);
      });
      
      // For now, return null and the data will be loaded into memory for next access
      return null;
    } else if (this.config.storage === 'file' && this.config.exportPath) {
      // Load from file
      return this.loadFromFile(signalId);
    }
    
    return null;
  }
  
  /**
   * Load lifecycle from Redis
   * @param signalId Signal ID
   * @returns Lifecycle or null if not found
   */
  private async loadFromRedis(signalId: string): Promise<TradeLifecycle | null> {
    if (!this.redis) return null;
    
    try {
      const key = `trade_lifecycle:${signalId}`;
      const data = await this.redis.get(key);
      
      if (!data) {
        return null;
      }
      
      return JSON.parse(data) as TradeLifecycle;
    } catch (error) {
      this.logger.error(`Failed to load from Redis: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Load lifecycle from file
   * @param signalId Signal ID
   * @returns Lifecycle or null if not found
   */
  private loadFromFile(signalId: string): TradeLifecycle | null {
    if (!this.config.exportPath || !fs.existsSync(this.config.exportPath)) {
      return null;
    }
    
    try {
      // Read file line by line looking for matching signal ID
      const data = fs.readFileSync(this.config.exportPath, 'utf8');
      const lines = data.split('\n').filter(line => line.trim().length > 0);
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          
          if (entry.id === signalId) {
            // Extract the lifecycle data
            return entry.lifecycle as TradeLifecycle;
          }
        } catch (e) {
          // Skip invalid lines
          continue;
        }
      }
      
      return null;
    } catch (error) {
      this.logger.error(`Failed to load from file: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Delete lifecycle from storage
   * @param signalId Signal ID
   */
  private deleteLifecycle(signalId: string): void {
    if (this.config.storage === 'redis' && this.redis) {
      // Delete from Redis
      this.deleteFromRedis(signalId).catch(error => {
        this.logger.error(`Failed to delete from Redis: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    // For file storage, we don't delete individual entries
    // Instead, a new export will be created on next export
  }
  
  /**
   * Delete lifecycle from Redis
   * @param signalId Signal ID
   */
  private async deleteFromRedis(signalId: string): Promise<void> {
    if (!this.redis) return;
    
    try {
      const key = `trade_lifecycle:${signalId}`;
      await this.redis.del(key);
      
      // Also clean up trade-to-signal mapping if it exists
      const lifecycle = this.memoryStore.get(signalId);
      
      if (lifecycle?.execution) {
        const tradeId = this.getTradeIdFromExecution(lifecycle.execution.execution);
        if (tradeId) {
          const tradeKey = `trade_to_signal:${tradeId}`;
          await this.redis.del(tradeKey);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to delete from Redis: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} 