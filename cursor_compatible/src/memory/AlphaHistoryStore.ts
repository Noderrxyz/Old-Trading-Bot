import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

interface AgentPerformance {
  agentId: string;
  timestamp: number;
  pnl: number;
  sharpe: number;
  drawdown: number;
  volatility: number;
  trust: number;
  regimeAlignment: number;
}

export class AlphaHistoryStore {
  private static instance: AlphaHistoryStore;
  private performanceHistory: Map<string, AgentPerformance[]>;
  private readonly SNAPSHOT_DIR = 'logs/alpha_memory_snapshots';
  private readonly SNAPSHOT_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours in milliseconds
  private lastSnapshotTime: number;

  private constructor() {
    this.performanceHistory = new Map();
    this.lastSnapshotTime = Date.now();
    this.ensureSnapshotDirectory();
  }

  public static getInstance(): AlphaHistoryStore {
    if (!AlphaHistoryStore.instance) {
      AlphaHistoryStore.instance = new AlphaHistoryStore();
    }
    return AlphaHistoryStore.instance;
  }

  private ensureSnapshotDirectory() {
    if (!fs.existsSync(this.SNAPSHOT_DIR)) {
      fs.mkdirSync(this.SNAPSHOT_DIR, { recursive: true });
    }
  }

  public recordPerformance(performance: AgentPerformance) {
    const history = this.performanceHistory.get(performance.agentId) || [];
    history.push(performance);
    this.performanceHistory.set(performance.agentId, history);

    // Check if it's time for a snapshot
    if (Date.now() - this.lastSnapshotTime >= this.SNAPSHOT_INTERVAL) {
      this.takeSnapshot();
    }
  }

  public get24hPerformance(agentId: string): AgentPerformance[] {
    const history = this.performanceHistory.get(agentId) || [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago
    return history.filter(entry => entry.timestamp >= cutoff);
  }

  public getAllAgents24hPerformance(): Map<string, AgentPerformance[]> {
    const result = new Map<string, AgentPerformance[]>();
    for (const [agentId, history] of this.performanceHistory.entries()) {
      result.set(agentId, this.get24hPerformance(agentId));
    }
    return result;
  }

  private takeSnapshot() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const snapshotPath = path.join(this.SNAPSHOT_DIR, `snapshot-${timestamp}.json`);
      
      const snapshot = {
        timestamp: Date.now(),
        performanceHistory: Array.from(this.performanceHistory.entries())
      };

      fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
      this.lastSnapshotTime = Date.now();
      logger.info(`Alpha history snapshot saved to ${snapshotPath}`);
    } catch (error) {
      logger.error('Failed to take alpha history snapshot:', error);
    }
  }

  public clearHistory() {
    this.performanceHistory.clear();
  }
} 