/**
 * Behavioral Risk Memory
 * 
 * Tracks and analyzes patterns in trading behavior to identify risky situations
 * and prevent future losses.
 */

import { FusedAlphaFrame } from '../alphasources/fusion-engine.js';
import { RiskScore, RiskTier } from './risk.types.js';
import { ExecutionResult } from '../execution/ExecutionMemory.js';
import { createLogger } from '../common/logger.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Severity level of a detected risk pattern
 */
export enum RiskPatternSeverity {
  LOW = 'low',
  MODERATE = 'moderate',
  HIGH = 'high',
  CRITICAL = 'critical'
}

/**
 * A detected risk pattern in trading behavior
 */
export interface DetectedRiskPattern {
  /** Unique pattern ID */
  id: string;
  
  /** Type of risk pattern */
  patternType: string;
  
  /** Human-readable description of the pattern */
  description: string;
  
  /** Severity level */
  severity: RiskPatternSeverity;
  
  /** Affected trading pairs */
  affectedSymbols: string[];
  
  /** When the pattern was detected */
  timestamp: number;
  
  /** Additional pattern-specific data */
  metadata: Record<string, any>;
}

/**
 * Configuration for the behavioral risk memory system
 */
export interface BehavioralRiskMemoryConfig {
  /** Whether the system is enabled */
  enabled: boolean;
  
  /** Maximum number of records to keep in memory */
  maxRecords: number;
  
  /** Number of trades after which to save to disk */
  saveIntervalTrades: number;
  
  /** Time window for risk pattern detection in seconds */
  riskPatternDetectionWindow: number;
  
  /** Thresholds for pattern detection */
  detectionThresholds: {
    /** Slippage threshold in percentage */
    slippageSpike: number;
    
    /** Number of errors in a burst to trigger detection */
    errorBurstCount: number;
    
    /** Minimum number of trades to consider for pattern detection */
    minTradesForPattern: number;
    
    /** Confidence threshold for pattern detection (0-1) */
    confidenceThreshold: number;
  };
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: BehavioralRiskMemoryConfig = {
  enabled: true,
  maxRecords: 10000,
  saveIntervalTrades: 100,
  riskPatternDetectionWindow: 7200, // 2 hours
  detectionThresholds: {
    slippageSpike: 5.0,
    errorBurstCount: 5,
    minTradesForPattern: 10,
    confidenceThreshold: 0.7
  }
};

/**
 * Trade record stored in memory
 */
interface TradeRecord {
  /** Trade ID */
  id: string;
  
  /** Trading pair */
  symbol: string;
  
  /** Original alpha signal */
  signal: FusedAlphaFrame;
  
  /** Execution result */
  execution: ExecutionResult;
  
  /** Risk score at time of trade */
  riskScore: RiskScore;
  
  /** Timestamp of the trade */
  timestamp: number;
}

/**
 * Manages behavioral risk memory and pattern detection
 */
export class BehavioralRiskMemory {
  private readonly logger = createLogger('BehavioralRiskMemory');
  private readonly config: BehavioralRiskMemoryConfig;
  private readonly tradeRecords: TradeRecord[] = [];
  private tradeCountSinceLastSave = 0;
  private readonly dataDir = 'data';
  private readonly dataFile = 'behavioral_risk_memory.jsonl';
  
  /**
   * Create a new behavioral risk memory instance
   * @param config Optional configuration override
   */
  constructor(config: Partial<BehavioralRiskMemoryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    
    // Load existing data if available
    this.loadData();
    
    if (!this.config.enabled) {
      this.logger.warn('Behavioral risk memory is disabled');
    } else {
      this.logger.info('Behavioral risk memory initialized');
    }
  }
  
  /**
   * Record a trade and its associated risk score
   * @param signal Original alpha signal
   * @param execution Execution result
   * @param riskScore Risk score at time of trade
   */
  public recordTrade(
    signal: FusedAlphaFrame,
    execution: ExecutionResult,
    riskScore: RiskScore
  ): void {
    if (!this.config.enabled) {
      return;
    }
    
    try {
      // Create trade record
      const record: TradeRecord = {
        id: execution.id,
        symbol: signal.symbol,
        signal,
        execution,
        riskScore,
        timestamp: Date.now()
      };
      
      // Add to memory
      this.tradeRecords.push(record);
      
      // Trim if exceeding maximum
      if (this.tradeRecords.length > this.config.maxRecords) {
        this.tradeRecords.shift();
      }
      
      // Increment save counter
      this.tradeCountSinceLastSave++;
      
      // Save to disk if needed
      if (this.tradeCountSinceLastSave >= this.config.saveIntervalTrades) {
        this.saveData();
        this.tradeCountSinceLastSave = 0;
      }
      
      this.logger.debug(`Recorded trade ${execution.id} for ${signal.symbol}`);
    } catch (error) {
      this.logger.error(
        `Error recording trade ${execution.id}: ` +
        `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  
  /**
   * Detect risk patterns in recent trading activity
   * @param timeHorizonSeconds Time window to analyze in seconds
   * @returns Array of detected risk patterns
   */
  public detectRiskPatterns(timeHorizonSeconds: number = this.config.riskPatternDetectionWindow): DetectedRiskPattern[] {
    if (!this.config.enabled) {
      return [];
    }
    
    try {
      const patterns: DetectedRiskPattern[] = [];
      const cutoffTime = Date.now() - (timeHorizonSeconds * 1000);
      
      // Filter to recent trades
      const recentTrades = this.tradeRecords.filter(r => r.timestamp >= cutoffTime);
      
      if (recentTrades.length < this.config.detectionThresholds.minTradesForPattern) {
        return [];
      }
      
      // Group trades by symbol
      const tradesBySymbol = new Map<string, TradeRecord[]>();
      for (const trade of recentTrades) {
        if (!tradesBySymbol.has(trade.symbol)) {
          tradesBySymbol.set(trade.symbol, []);
        }
        tradesBySymbol.get(trade.symbol)!.push(trade);
      }
      
      // Detect patterns for each symbol
      for (const [symbol, trades] of tradesBySymbol.entries()) {
        // Detect slippage spikes
        const slippagePattern = this.detectSlippageSpike(symbol, trades);
        if (slippagePattern) {
          patterns.push(slippagePattern);
        }
        
        // Detect error bursts
        const errorPattern = this.detectErrorBurst(symbol, trades);
        if (errorPattern) {
          patterns.push(errorPattern);
        }
        
        // Detect risk score degradation
        const riskPattern = this.detectRiskScoreDegradation(symbol, trades);
        if (riskPattern) {
          patterns.push(riskPattern);
        }
      }
      
      return patterns;
    } catch (error) {
      this.logger.error(
        'Error detecting risk patterns: ' +
        `${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }
  
  /**
   * Load trade records from disk
   */
  private loadData(): void {
    try {
      const filePath = path.join(this.dataDir, this.dataFile);
      if (!fs.existsSync(filePath)) {
        return;
      }
      
      const data = fs.readFileSync(filePath, 'utf-8');
      const lines = data.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          const record = JSON.parse(line) as TradeRecord;
          this.tradeRecords.push(record);
        } catch (e) {
          this.logger.warn(`Failed to parse trade record: ${e}`);
        }
      }
      
      // Trim to max records
      if (this.tradeRecords.length > this.config.maxRecords) {
        this.tradeRecords.splice(0, this.tradeRecords.length - this.config.maxRecords);
      }
      
      this.logger.info(`Loaded ${this.tradeRecords.length} trade records from disk`);
    } catch (error) {
      this.logger.error(
        'Error loading trade records: ' +
        `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  
  /**
   * Save trade records to disk
   */
  private saveData(): void {
    try {
      const filePath = path.join(this.dataDir, this.dataFile);
      const lines = this.tradeRecords.map(r => JSON.stringify(r));
      fs.writeFileSync(filePath, lines.join('\n') + '\n');
      this.logger.info(`Saved ${this.tradeRecords.length} trade records to disk`);
    } catch (error) {
      this.logger.error(
        'Error saving trade records: ' +
        `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  
  /**
   * Detect slippage spikes in recent trades
   * @param symbol Trading pair
   * @param trades Recent trades
   * @returns Detected pattern or null
   */
  private detectSlippageSpike(
    symbol: string,
    trades: TradeRecord[]
  ): DetectedRiskPattern | null {
    const threshold = this.config.detectionThresholds.slippageSpike;
    const spikeTrades = trades.filter(t => 
      t.execution.slippageBps && t.execution.slippageBps > threshold
    );
    
    if (spikeTrades.length >= 3) {
      return {
        id: `slippage_spike_${Date.now()}`,
        patternType: 'high_slippage_spike',
        description: `Repeated >${threshold}% slippage in recent trades`,
        severity: this.determineSlippageSeverity(spikeTrades),
        affectedSymbols: [symbol],
        timestamp: Date.now(),
        metadata: {
          spikeCount: spikeTrades.length,
          maxSlippage: Math.max(...spikeTrades.map(t => t.execution.slippageBps || 0)),
          averageSlippage: spikeTrades.reduce((sum, t) => sum + (t.execution.slippageBps || 0), 0) / spikeTrades.length
        }
      };
    }
    
    return null;
  }
  
  /**
   * Detect bursts of execution errors
   * @param symbol Trading pair
   * @param trades Recent trades
   * @returns Detected pattern or null
   */
  private detectErrorBurst(
    symbol: string,
    trades: TradeRecord[]
  ): DetectedRiskPattern | null {
    const threshold = this.config.detectionThresholds.errorBurstCount;
    const errorTrades = trades.filter(t => 
      t.execution.status === 'failed' || t.execution.status === 'rejected'
    );
    
    if (errorTrades.length >= threshold) {
      return {
        id: `error_burst_${Date.now()}`,
        patternType: 'error_burst',
        description: `Burst of ${errorTrades.length} execution errors`,
        severity: RiskPatternSeverity.HIGH,
        affectedSymbols: [symbol],
        timestamp: Date.now(),
        metadata: {
          errorCount: errorTrades.length,
          errorTypes: [...new Set(errorTrades.map(t => t.execution.failureReason))],
          timeWindow: trades[trades.length - 1].timestamp - trades[0].timestamp
        }
      };
    }
    
    return null;
  }
  
  /**
   * Detect degradation in risk scores
   * @param symbol Trading pair
   * @param trades Recent trades
   * @returns Detected pattern or null
   */
  private detectRiskScoreDegradation(
    symbol: string,
    trades: TradeRecord[]
  ): DetectedRiskPattern | null {
    if (trades.length < 5) {
      return null;
    }
    
    // Calculate average risk score for first and last half of trades
    const midPoint = Math.floor(trades.length / 2);
    const firstHalf = trades.slice(0, midPoint);
    const secondHalf = trades.slice(midPoint);
    
    const firstAvg = firstHalf.reduce((sum, t) => sum + t.riskScore.score, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, t) => sum + t.riskScore.score, 0) / secondHalf.length;
    
    // If risk scores have degraded significantly
    if (secondAvg < firstAvg * 0.7) {
      return {
        id: `risk_degradation_${Date.now()}`,
        patternType: 'risk_score_degradation',
        description: 'Significant degradation in risk scores',
        severity: RiskPatternSeverity.MODERATE,
        affectedSymbols: [symbol],
        timestamp: Date.now(),
        metadata: {
          initialAverage: firstAvg,
          finalAverage: secondAvg,
          degradation: (firstAvg - secondAvg) / firstAvg
        }
      };
    }
    
    return null;
  }
  
  /**
   * Determine severity level based on slippage statistics
   * @param spikeTrades Trades with high slippage
   * @returns Severity level
   */
  private determineSlippageSeverity(spikeTrades: TradeRecord[]): RiskPatternSeverity {
    const maxSlippage = Math.max(...spikeTrades.map(t => t.execution.slippageBps || 0));
    const avgSlippage = spikeTrades.reduce((sum, t) => sum + (t.execution.slippageBps || 0), 0) / spikeTrades.length;
    
    if (maxSlippage > 10 || avgSlippage > 7) {
      return RiskPatternSeverity.CRITICAL;
    } else if (maxSlippage > 7 || avgSlippage > 5) {
      return RiskPatternSeverity.HIGH;
    } else if (maxSlippage > 5 || avgSlippage > 3) {
      return RiskPatternSeverity.MODERATE;
    } else {
      return RiskPatternSeverity.LOW;
    }
  }
} 