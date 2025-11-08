import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';
import { AlphaSnapshot, AlphaQuery, AlphaMetrics, MarketRegime } from '../types/AlphaSnapshot.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';

interface MemoryConfig {
  memoryPath: string;
  maxSnapshots: number;
  cleanupInterval: number;
  minTrustThreshold: number;
}

const DEFAULT_CONFIG: MemoryConfig = {
  memoryPath: './data/memory',
  maxSnapshots: 1000,
  cleanupInterval: 3600000, // 1 hour
  minTrustThreshold: 0.7
};

export class AlphaMemoryEngine {
  private static instance: AlphaMemoryEngine;
  private config: MemoryConfig;
  private telemetryBus: TelemetryBus;
  private snapshots: AlphaSnapshot[];
  private cleanupInterval: NodeJS.Timeout;

  private constructor(config: Partial<MemoryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.snapshots = [];
    this.cleanupInterval = setInterval(() => this.cleanupOldSnapshots(), this.config.cleanupInterval);
  }

  public static getInstance(config?: Partial<MemoryConfig>): AlphaMemoryEngine {
    if (!AlphaMemoryEngine.instance) {
      AlphaMemoryEngine.instance = new AlphaMemoryEngine(config);
    }
    return AlphaMemoryEngine.instance;
  }

  private async loadFromFile(): Promise<void> {
    try {
      const data = await fs.readFile(this.config.memoryPath, 'utf-8');
      this.snapshots = JSON.parse(data);
    } catch (error) {
      logger.warn('Failed to load memory file, starting fresh');
      this.snapshots = [];
    }
  }

  private async saveToFile(): Promise<void> {
    try {
      const dir = path.dirname(this.config.memoryPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.config.memoryPath, JSON.stringify(this.snapshots, null, 2));
    } catch (error) {
      logger.error('Failed to save memory file:', error);
    }
  }

  private validateSnapshot(snapshot: AlphaSnapshot): boolean {
    return (
      typeof snapshot.id === 'string' &&
      typeof snapshot.timestamp === 'string' &&
      ['bull', 'bear', 'chop'].includes(snapshot.regime) &&
      typeof snapshot.strategy === 'string' &&
      typeof snapshot.metrics === 'object' &&
      Array.isArray(snapshot.tags) &&
      Array.isArray(snapshot.lineage)
    );
  }

  public async querySnapshots(query: AlphaQuery): Promise<AlphaSnapshot[]> {
    return this.snapshots.filter(snapshot => {
      if (query.regime && snapshot.regime !== query.regime) return false;
      if (query.minSharpeRatio && snapshot.metrics.sharpeRatio < query.minSharpeRatio) return false;
      if (query.minTrust && snapshot.metrics.trust < query.minTrust) return false;
      if (query.maxDrawdown && snapshot.metrics.maxDrawdown > query.maxDrawdown) return false;
      if (query.minWinRate && snapshot.metrics.winRate < query.minWinRate) return false;
      return true;
    });
  }

  public async saveSnapshot(snapshot: AlphaSnapshot): Promise<void> {
    if (!this.validateSnapshot(snapshot)) {
      throw new Error('Invalid snapshot');
    }

    this.snapshots.push(snapshot);
    await this.saveToFile();

    this.emitTelemetry('snapshot_added', {
      id: snapshot.id,
      regime: snapshot.regime,
      strategy: snapshot.strategy
    });
  }

  private cleanupOldSnapshots(): void {
    if (this.snapshots.length > this.config.maxSnapshots) {
      this.snapshots = this.snapshots
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, this.config.maxSnapshots);
      this.saveToFile();
    }
  }

  private emitTelemetry(event: string, data: any): void {
    // TODO: Implement telemetry emission
  }

  public async destroy(): Promise<void> {
    clearInterval(this.cleanupInterval);
    this.snapshots = [];
  }

  public remember(snapshot: AlphaSnapshot): void {
    // Validate snapshot
    if (!this.validateSnapshot(snapshot)) {
      logger.warn('Invalid snapshot, skipping:', snapshot);
      return;
    }

    // Add to memory
    this.snapshots.unshift(snapshot);
    
    // Save to file
    this.saveSnapshot(snapshot);

    // Emit telemetry
    this.telemetryBus.emit('alpha_memory', {
      type: 'snapshot_added',
      timestamp: Date.now(),
      data: snapshot
    });

    // Cleanup if needed
    if (this.snapshots.length > this.config.maxSnapshots) {
      this.cleanupOldSnapshots();
    }
  }

  public query(query: AlphaQuery): AlphaSnapshot[] {
    let results = [...this.snapshots];

    // Apply filters
    if (query.regime) {
      results = results.filter(s => s.regime === query.regime);
    }
    if (query.minSharpe) {
      results = results.filter(s => s.metrics.sharpe >= query.minSharpe);
    }
    if (query.minTrust) {
      results = results.filter(s => s.metrics.trust >= query.minTrust);
    }
    if (query.maxDrawdown) {
      results = results.filter(s => s.metrics.maxDrawdown <= query.maxDrawdown);
    }
    if (query.minWinRate) {
      results = results.filter(s => s.metrics.winRate >= query.minWinRate);
    }
    if (query.tags?.length) {
      results = results.filter(s => 
        query.tags!.every(tag => s.tags.includes(tag))
      );
    }
    if (query.timeWindow) {
      const cutoff = Date.now() - query.timeWindow * 60 * 60 * 1000;
      results = results.filter(s => 
        new Date(s.timestamp).getTime() >= cutoff
      );
    }

    // Sort by trust score
    results.sort((a, b) => b.metrics.trust - a.metrics.trust);

    // Return top N results
    return query.top ? results.slice(0, query.top) : results;
  }

  public getRegimePerformance(regime: MarketRegime): AlphaMetrics {
    const regimeSnapshots = this.snapshots.filter(s => s.regime === regime);
    
    if (regimeSnapshots.length === 0) {
      return {
        roi: 0,
        sharpe: 0,
        maxDrawdown: 0,
        trust: 0,
        volatility: 0,
        winRate: 0,
        avgTradeDuration: 0
      };
    }

    return {
      roi: this.calculateAverage(regimeSnapshots, 'roi'),
      sharpe: this.calculateAverage(regimeSnapshots, 'sharpe'),
      maxDrawdown: this.calculateAverage(regimeSnapshots, 'maxDrawdown'),
      trust: this.calculateAverage(regimeSnapshots, 'trust'),
      volatility: this.calculateAverage(regimeSnapshots, 'volatility'),
      winRate: this.calculateAverage(regimeSnapshots, 'winRate'),
      avgTradeDuration: this.calculateAverage(regimeSnapshots, 'avgTradeDuration')
    };
  }

  private calculateAverage(snapshots: AlphaSnapshot[], metric: keyof AlphaMetrics): number {
    const sum = snapshots.reduce((acc, s) => acc + s.metrics[metric], 0);
    return sum / snapshots.length;
  }
} 