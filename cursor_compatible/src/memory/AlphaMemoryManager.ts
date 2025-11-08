import logger from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Market regime type
 */
export type MarketRegime = 'bull' | 'bear' | 'sideways' | 'volatile';

/**
 * Strategy pattern
 */
export interface StrategyPattern {
  regime: MarketRegime;
  strategy: string;
  pnl: number;
  timestamp: number;
  trustScore: number;
  consistency: number;
  metadata: {
    venue?: string;
    slippage?: number;
    gas?: number;
    latency?: number;
    [key: string]: any;
  };
}

/**
 * Alpha memory configuration
 */
interface AlphaMemoryConfig {
  decayRate: number;
  minTrustScore: number;
  minConsistency: number;
  maxPatternsPerAgent: number;
  maxPatternsPerStrategy: number;
  memoryDir: string;
  cleanupIntervalMs: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: AlphaMemoryConfig = {
  decayRate: 0.95, // 5% decay per day
  minTrustScore: 0.7,
  minConsistency: 0.6,
  maxPatternsPerAgent: 1000,
  maxPatternsPerStrategy: 100,
  memoryDir: 'memory/alpha',
  cleanupIntervalMs: 3600000 // 1 hour
};

/**
 * Alpha Memory Manager
 */
export class AlphaMemoryManager {
  private static instance: AlphaMemoryManager;
  private config: AlphaMemoryConfig;
  private telemetryBus: TelemetryBus;
  private patterns: Map<string, StrategyPattern[]>;
  private cleanupInterval: NodeJS.Timeout;

  private constructor(config: Partial<AlphaMemoryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.patterns = new Map();
    this.ensureMemoryDir();
    this.cleanupInterval = setInterval(
      () => this.cleanupOldPatterns(),
      this.config.cleanupIntervalMs
    );
  }

  public static getInstance(config?: Partial<AlphaMemoryConfig>): AlphaMemoryManager {
    if (!AlphaMemoryManager.instance) {
      AlphaMemoryManager.instance = new AlphaMemoryManager(config);
    }
    return AlphaMemoryManager.instance;
  }

  /**
   * Remember successful pattern
   */
  public rememberSuccess(agentId: string, pattern: Omit<StrategyPattern, 'timestamp'>): void {
    const fullPattern: StrategyPattern = {
      ...pattern,
      timestamp: Date.now()
    };

    const agentPatterns = this.patterns.get(agentId) || [];
    agentPatterns.push(fullPattern);

    // Sort by PnL and trim if needed
    agentPatterns.sort((a, b) => b.pnl - a.pnl);
    if (agentPatterns.length > this.config.maxPatternsPerAgent) {
      agentPatterns.length = this.config.maxPatternsPerAgent;
    }

    this.patterns.set(agentId, agentPatterns);
    this.savePatterns(agentId);

    this.telemetryBus.emit('alpha_memory_pattern_added', {
      agentId,
      pattern: fullPattern
    });
  }

  /**
   * Forget failed pattern
   */
  public forgetFailure(agentId: string, strategy: string, regime: MarketRegime): void {
    const agentPatterns = this.patterns.get(agentId) || [];
    const filteredPatterns = agentPatterns.filter(
      p => !(p.strategy === strategy && p.regime === regime)
    );

    this.patterns.set(agentId, filteredPatterns);
    this.savePatterns(agentId);

    this.telemetryBus.emit('alpha_memory_pattern_removed', {
      agentId,
      strategy,
      regime
    });
  }

  /**
   * Get patterns for agent and regime
   */
  public getPatterns(
    agentId: string,
    regime: MarketRegime,
    minTrustScore: number = this.config.minTrustScore
  ): StrategyPattern[] {
    const agentPatterns = this.patterns.get(agentId) || [];
    const now = Date.now();

    return agentPatterns
      .filter(pattern => {
        const ageInDays = (now - pattern.timestamp) / (24 * 60 * 60 * 1000);
        const decayedTrust = pattern.trustScore * Math.pow(this.config.decayRate, ageInDays);
        
        return (
          pattern.regime === regime &&
          decayedTrust >= minTrustScore &&
          pattern.consistency >= this.config.minConsistency
        );
      })
      .sort((a, b) => b.pnl - a.pnl);
  }

  /**
   * Calculate alpha score
   */
  public calculateAlphaScore(pattern: StrategyPattern): number {
    const now = Date.now();
    const ageInDays = (now - pattern.timestamp) / (24 * 60 * 60 * 1000);
    const decayedTrust = pattern.trustScore * Math.pow(this.config.decayRate, ageInDays);
    
    return (
      pattern.pnl * 0.4 + // PnL weight
      decayedTrust * 0.3 + // Trust weight
      pattern.consistency * 0.3 // Consistency weight
    );
  }

  /**
   * Save patterns to disk
   */
  private savePatterns(agentId: string): void {
    const agentPatterns = this.patterns.get(agentId) || [];
    const filePath = path.join(this.config.memoryDir, `${agentId}.json`);

    try {
      fs.writeFileSync(filePath, JSON.stringify(agentPatterns, null, 2));
    } catch (error) {
      logger.error(`Error saving patterns for agent ${agentId}:`, error);
    }
  }

  /**
   * Load patterns from disk
   */
  private loadPatterns(agentId: string): void {
    const filePath = path.join(this.config.memoryDir, `${agentId}.json`);

    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const patterns = JSON.parse(content) as StrategyPattern[];
        this.patterns.set(agentId, patterns);
      }
    } catch (error) {
      logger.error(`Error loading patterns for agent ${agentId}:`, error);
    }
  }

  /**
   * Cleanup old patterns
   */
  private cleanupOldPatterns(): void {
    const now = Date.now();
    const maxAgeMs = 30 * 24 * 60 * 60 * 1000; // 30 days

    for (const [agentId, patterns] of this.patterns.entries()) {
      const filteredPatterns = patterns.filter(
        pattern => now - pattern.timestamp <= maxAgeMs
      );

      if (filteredPatterns.length !== patterns.length) {
        this.patterns.set(agentId, filteredPatterns);
        this.savePatterns(agentId);
      }
    }
  }

  /**
   * Ensure memory directory exists
   */
  private ensureMemoryDir(): void {
    try {
      if (!fs.existsSync(this.config.memoryDir)) {
        fs.mkdirSync(this.config.memoryDir, { recursive: true });
      }
    } catch (error) {
      logger.error('Error creating memory directory:', error);
    }
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    clearInterval(this.cleanupInterval);
  }
} 