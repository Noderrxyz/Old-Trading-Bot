import * as fs from 'fs';
import * as path from 'path';
import { MarketRegime } from '../regime/RegimeClassifier';

/**
 * Alpha memory record representing a strategy's performance
 */
export interface AlphaMemoryRecord {
  /**
   * Unique identifier for the strategy
   */
  strategyId: string;
  
  /**
   * Market symbol (e.g., BTC/USD)
   */
  symbol: string;
  
  /**
   * Market regime active during this performance record
   */
  regime: MarketRegime;
  
  /**
   * Trading parameters used (serialized JSON)
   */
  parameters: Record<string, any>;
  
  /**
   * Performance metrics
   */
  performance: {
    /**
     * Total return (e.g., 0.05 for 5%)
     */
    totalReturn: number;
    
    /**
     * Sharpe ratio
     */
    sharpeRatio: number;
    
    /**
     * Maximum drawdown (e.g., 0.10 for 10%)
     */
    maxDrawdown: number;
    
    /**
     * Win rate (e.g., 0.65 for 65%)
     */
    winRate: number;
    
    /**
     * Number of trades
     */
    tradeCount: number;
    
    /**
     * Average profit per trade
     */
    avgProfitPerTrade: number;
    
    /**
     * Profit factor (gross profit / gross loss)
     */
    profitFactor: number;
  };
  
  /**
   * Time period of the performance
   */
  period: {
    /**
     * Start time
     */
    start: Date;
    
    /**
     * End time
     */
    end: Date;
    
    /**
     * Duration in milliseconds
     */
    durationMs: number;
  };
  
  /**
   * Metadata and tags
   */
  metadata: {
    /**
     * Timestamp of record creation
     */
    created: Date;
    
    /**
     * Strategy type/category
     */
    strategyType: string;
    
    /**
     * Additional tags for filtering
     */
    tags: string[];
    
    /**
     * Custom properties
     */
    [key: string]: any;
  };
}

/**
 * Configuration for alpha memory
 */
export interface AlphaMemoryConfig {
  /**
   * Path to the alpha memory file
   */
  filePath: string;
  
  /**
   * Maximum number of records to keep per strategy
   */
  maxRecordsPerStrategy: number;
  
  /**
   * Maximum number of records to keep per symbol
   */
  maxRecordsPerSymbol: number;
  
  /**
   * Maximum number of records to keep per regime
   */
  maxRecordsPerRegime: number;
  
  /**
   * Auto-save interval in milliseconds (0 to disable)
   */
  autoSaveIntervalMs: number;
  
  /**
   * Whether to compress old records
   */
  compressOldRecords: boolean;
}

/**
 * Default configuration for alpha memory
 */
export const DEFAULT_ALPHA_MEMORY_CONFIG: AlphaMemoryConfig = {
  filePath: 'alpha_memory.jsonl',
  maxRecordsPerStrategy: 20,
  maxRecordsPerSymbol: 50,
  maxRecordsPerRegime: 30,
  autoSaveIntervalMs: 60000, // 1 minute
  compressOldRecords: true
};

/**
 * Filter options for querying alpha memory
 */
export interface AlphaMemoryFilter {
  /**
   * Filter by strategy ID
   */
  strategyId?: string;
  
  /**
   * Filter by symbol
   */
  symbol?: string;
  
  /**
   * Filter by regime
   */
  regime?: MarketRegime;
  
  /**
   * Filter by minimum total return
   */
  minTotalReturn?: number;
  
  /**
   * Filter by minimum Sharpe ratio
   */
  minSharpeRatio?: number;
  
  /**
   * Filter by minimum win rate
   */
  minWinRate?: number;
  
  /**
   * Filter by maximum drawdown
   */
  maxDrawdown?: number;
  
  /**
   * Filter by strategy type
   */
  strategyType?: string;
  
  /**
   * Filter by tags (must match all)
   */
  tags?: string[];
  
  /**
   * Filter by time period (start)
   */
  periodStart?: Date;
  
  /**
   * Filter by time period (end)
   */
  periodEnd?: Date;
}

/**
 * Alpha memory for storing and recalling strategy performance
 */
export class AlphaMemory {
  private config: AlphaMemoryConfig;
  private records: AlphaMemoryRecord[];
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private dirty: boolean = false;
  private static instance: AlphaMemory | null = null;
  
  /**
   * Create a new AlphaMemory instance
   * @param config Configuration options
   */
  private constructor(config: Partial<AlphaMemoryConfig> = {}) {
    this.config = {
      ...DEFAULT_ALPHA_MEMORY_CONFIG,
      ...config
    };
    
    this.records = [];
    this.loadRecords();
    
    // Set up auto-save timer if enabled
    if (this.config.autoSaveIntervalMs > 0) {
      this.autoSaveTimer = setInterval(() => {
        if (this.dirty) {
          this.saveRecords();
          this.dirty = false;
        }
      }, this.config.autoSaveIntervalMs);
    }
  }
  
  /**
   * Get singleton instance
   * @param config Configuration options
   */
  public static getInstance(config: Partial<AlphaMemoryConfig> = {}): AlphaMemory {
    if (!AlphaMemory.instance) {
      AlphaMemory.instance = new AlphaMemory(config);
    }
    return AlphaMemory.instance;
  }
  
  /**
   * Dispose resources (e.g., auto-save timer)
   */
  public dispose(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    
    // Save any pending changes
    if (this.dirty) {
      this.saveRecords();
      this.dirty = false;
    }
  }
  
  /**
   * Add a performance record to the alpha memory
   * @param record Performance record
   */
  public addRecord(record: AlphaMemoryRecord): void {
    // Add record to memory
    this.records.push(record);
    this.dirty = true;
    
    // Enforce limits and trim if necessary
    this.enforceLimits();
    
    // Save immediately if auto-save is disabled
    if (this.config.autoSaveIntervalMs <= 0) {
      this.saveRecords();
      this.dirty = false;
    }
  }
  
  /**
   * Get all records matching a filter
   * @param filter Filter criteria (if empty, returns all records)
   * @returns Array of matching records
   */
  public getRecords(filter: AlphaMemoryFilter = {}): AlphaMemoryRecord[] {
    return this.records.filter(record => this.matchesFilter(record, filter));
  }
  
  /**
   * Find the best parameter set for a strategy in a given regime
   * @param strategyId Strategy ID
   * @param symbol Market symbol
   * @param regime Current market regime
   * @returns Best parameters or null if no records found
   */
  public findBestParameters(
    strategyId: string, 
    symbol: string, 
    regime: MarketRegime
  ): Record<string, any> | null {
    // Get all records for this strategy, symbol, and regime
    const records = this.getRecords({ 
      strategyId, 
      symbol, 
      regime
    });
    
    if (records.length === 0) {
      return null;
    }
    
    // Find record with highest Sharpe ratio
    const bestRecord = records.reduce((best, current) => {
      return current.performance.sharpeRatio > best.performance.sharpeRatio ? current : best;
    }, records[0]);
    
    // Return a copy of the parameters
    return { ...bestRecord.parameters };
  }
  
  /**
   * Get a summary of all memory records
   */
  public getMemorySummary(): {
    totalRecords: number,
    strategiesCount: number,
    symbolsCount: number,
    regimesCount: number,
    bestSharpe: number,
    bestReturn: number
  } {
    const strategies = new Set(this.records.map(r => r.strategyId));
    const symbols = new Set(this.records.map(r => r.symbol));
    const regimes = new Set(this.records.map(r => r.regime));
    
    let bestSharpe = 0;
    let bestReturn = 0;
    
    this.records.forEach(record => {
      bestSharpe = Math.max(bestSharpe, record.performance.sharpeRatio);
      bestReturn = Math.max(bestReturn, record.performance.totalReturn);
    });
    
    return {
      totalRecords: this.records.length,
      strategiesCount: strategies.size,
      symbolsCount: symbols.size,
      regimesCount: regimes.size,
      bestSharpe,
      bestReturn
    };
  }
  
  /**
   * Delete records matching a filter
   * @param filter Filter criteria
   * @returns Number of records deleted
   */
  public deleteRecords(filter: AlphaMemoryFilter): number {
    const initialCount = this.records.length;
    this.records = this.records.filter(record => !this.matchesFilter(record, filter));
    const deletedCount = initialCount - this.records.length;
    
    if (deletedCount > 0) {
      this.dirty = true;
      
      // Save immediately if auto-save is disabled
      if (this.config.autoSaveIntervalMs <= 0) {
        this.saveRecords();
        this.dirty = false;
      }
    }
    
    return deletedCount;
  }
  
  /**
   * Clear all records
   */
  public clearAll(): void {
    this.records = [];
    this.dirty = true;
    
    // Save immediately if auto-save is disabled
    if (this.config.autoSaveIntervalMs <= 0) {
      this.saveRecords();
      this.dirty = false;
    }
  }
  
  /**
   * Force saving of alpha memory to disk
   */
  public save(): void {
    this.saveRecords();
    this.dirty = false;
  }
  
  /**
   * Load records from disk
   */
  private loadRecords(): void {
    try {
      if (!fs.existsSync(this.config.filePath)) {
        this.records = [];
        return;
      }
      
      const content = fs.readFileSync(this.config.filePath, 'utf8');
      const lines = content.trim().split('\n');
      
      this.records = lines.map(line => {
        const record = JSON.parse(line) as AlphaMemoryRecord;
        
        // Convert string dates back to Date objects
        record.period.start = new Date(record.period.start);
        record.period.end = new Date(record.period.end);
        record.metadata.created = new Date(record.metadata.created);
        
        return record;
      });
    } catch (error) {
      console.error('Failed to load alpha memory:', error);
      this.records = [];
    }
  }
  
  /**
   * Save records to disk
   */
  private saveRecords(): void {
    try {
      // Create directory if it doesn't exist
      const dir = path.dirname(this.config.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Convert records to JSON Lines format
      const content = this.records.map(record => JSON.stringify(record)).join('\n');
      
      // Write to file
      fs.writeFileSync(this.config.filePath, content, 'utf8');
    } catch (error) {
      console.error('Failed to save alpha memory:', error);
    }
  }
  
  /**
   * Enforce record limits
   */
  private enforceLimits(): void {
    // Group records by strategy
    const byStrategy = this.groupBy(this.records, 'strategyId');
    
    // Group records by symbol
    const bySymbol = this.groupBy(this.records, 'symbol');
    
    // Group records by regime
    const byRegime = this.groupBy(this.records, 'regime');
    
    // Trim records if needed
    let didTrim = false;
    
    // Trim by strategy
    Object.keys(byStrategy).forEach(strategyId => {
      const records = byStrategy[strategyId];
      if (records.length > this.config.maxRecordsPerStrategy) {
        // Sort by Sharpe ratio (highest first) and trim
        records.sort((a, b) => b.performance.sharpeRatio - a.performance.sharpeRatio);
        byStrategy[strategyId] = records.slice(0, this.config.maxRecordsPerStrategy);
        didTrim = true;
      }
    });
    
    // Trim by symbol
    Object.keys(bySymbol).forEach(symbol => {
      const records = bySymbol[symbol];
      if (records.length > this.config.maxRecordsPerSymbol) {
        // Sort by Sharpe ratio (highest first) and trim
        records.sort((a, b) => b.performance.sharpeRatio - a.performance.sharpeRatio);
        bySymbol[symbol] = records.slice(0, this.config.maxRecordsPerSymbol);
        didTrim = true;
      }
    });
    
    // Trim by regime
    Object.keys(byRegime).forEach(regime => {
      const records = byRegime[regime];
      if (records.length > this.config.maxRecordsPerRegime) {
        // Sort by Sharpe ratio (highest first) and trim
        records.sort((a, b) => b.performance.sharpeRatio - a.performance.sharpeRatio);
        byRegime[regime] = records.slice(0, this.config.maxRecordsPerRegime);
        didTrim = true;
      }
    });
    
    // Rebuild records array if trimmed
    if (didTrim) {
      // Use a Set to deduplicate records that might be in multiple groups
      const recordSet = new Set<AlphaMemoryRecord>();
      
      // Add records from each group
      Object.values(byStrategy).forEach(records => {
        records.forEach(record => recordSet.add(record));
      });
      
      this.records = Array.from(recordSet);
    }
  }
  
  /**
   * Check if a record matches a filter
   * @param record Alpha memory record
   * @param filter Filter criteria
   * @returns True if the record matches the filter
   */
  private matchesFilter(record: AlphaMemoryRecord, filter: AlphaMemoryFilter): boolean {
    // Check each filter criterion
    if (filter.strategyId !== undefined && record.strategyId !== filter.strategyId) {
      return false;
    }
    
    if (filter.symbol !== undefined && record.symbol !== filter.symbol) {
      return false;
    }
    
    if (filter.regime !== undefined && record.regime !== filter.regime) {
      return false;
    }
    
    if (filter.minTotalReturn !== undefined && record.performance.totalReturn < filter.minTotalReturn) {
      return false;
    }
    
    if (filter.minSharpeRatio !== undefined && record.performance.sharpeRatio < filter.minSharpeRatio) {
      return false;
    }
    
    if (filter.minWinRate !== undefined && record.performance.winRate < filter.minWinRate) {
      return false;
    }
    
    if (filter.maxDrawdown !== undefined && record.performance.maxDrawdown > filter.maxDrawdown) {
      return false;
    }
    
    if (filter.strategyType !== undefined && record.metadata.strategyType !== filter.strategyType) {
      return false;
    }
    
    if (filter.tags !== undefined) {
      // Check if record has all the required tags
      const recordTags = new Set(record.metadata.tags);
      const hasAllTags = filter.tags.every(tag => recordTags.has(tag));
      if (!hasAllTags) {
        return false;
      }
    }
    
    if (filter.periodStart !== undefined && record.period.end < filter.periodStart) {
      return false;
    }
    
    if (filter.periodEnd !== undefined && record.period.start > filter.periodEnd) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Group records by a property
   * @param records Array of records
   * @param property Property to group by
   * @returns Record groups indexed by property value
   */
  private groupBy<T>(records: T[], property: keyof T): Record<string, T[]> {
    return records.reduce((groups, record) => {
      const key = String(record[property]);
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(record);
      return groups;
    }, {} as Record<string, T[]>);
  }
} 