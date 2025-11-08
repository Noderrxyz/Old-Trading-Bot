import logger from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';
import { AlphaMemoryEngine } from '../memory/AlphaMemoryEngine.js';
import { AgentSupervisor } from '../runtime/AgentSupervisor.js';
import fs from 'fs/promises';
import path from 'path';

interface PostMortemConfig {
  entropyLogPath: string;
  blacklistPath: string;
  telemetryEnabled: boolean;
}

const DEFAULT_CONFIG: PostMortemConfig = {
  entropyLogPath: 'logs/entropy_fingerprint.jsonl',
  blacklistPath: 'config/strategy_blacklist.json',
  telemetryEnabled: true
};

interface FailureAnalysis {
  agentId: string;
  timestamp: number;
  failurePoint: string;
  metrics: {
    gasSpike?: boolean;
    oracleLag?: number;
    slippage?: number;
    drawdown?: number;
    volatility?: number;
  };
  logs: string[];
  finalState: any;
}

export class PostMortemAnalyzer {
  private static instance: PostMortemAnalyzer;
  private config: PostMortemConfig;
  private telemetryBus: TelemetryBus;
  private memoryEngine: AlphaMemoryEngine;
  private supervisor: AgentSupervisor;
  private blacklist: Set<string>;

  private constructor(config: Partial<PostMortemConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.memoryEngine = AlphaMemoryEngine.getInstance();
    this.supervisor = AgentSupervisor.getInstance();
    this.blacklist = new Set();
    this.loadBlacklist();
  }

  public static getInstance(config?: Partial<PostMortemConfig>): PostMortemAnalyzer {
    if (!PostMortemAnalyzer.instance) {
      PostMortemAnalyzer.instance = new PostMortemAnalyzer(config);
    }
    return PostMortemAnalyzer.instance;
  }

  public async capture(agentId: string): Promise<void> {
    try {
      const state = this.supervisor.getAgentState(agentId);
      if (!state) return;

      const analysis: FailureAnalysis = {
        agentId,
        timestamp: Date.now(),
        failurePoint: this.determineFailurePoint(state),
        metrics: this.analyzeMetrics(state),
        logs: state.finalState?.logs || [],
        finalState: state.finalState
      };

      // Log to entropy fingerprint
      await this.logEntropy(analysis);

      // Update blacklist if necessary
      if (this.shouldBlacklist(analysis)) {
        await this.updateBlacklist(agentId);
      }

      this.emitTelemetry('post_mortem_captured', analysis);
    } catch (error) {
      logger.error(`Failed to capture post-mortem for agent ${agentId}:`, error);
    }
  }

  private determineFailurePoint(state: any): string {
    if (state.finalState?.gasSpike) return 'gas_spike';
    if (state.finalState?.oracleLag) return 'oracle_lag';
    if (state.finalState?.slippage) return 'slippage';
    if (state.finalState?.drawdown) return 'drawdown';
    return 'unknown';
  }

  private analyzeMetrics(state: any): FailureAnalysis['metrics'] {
    return {
      gasSpike: state.finalState?.gasSpike,
      oracleLag: state.finalState?.oracleLag,
      slippage: state.finalState?.slippage,
      drawdown: state.finalState?.drawdown,
      volatility: state.finalState?.volatility
    };
  }

  private async logEntropy(analysis: FailureAnalysis): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.config.entropyLogPath), { recursive: true });
      await fs.appendFile(
        this.config.entropyLogPath,
        JSON.stringify(analysis) + '\n'
      );
    } catch (error) {
      logger.error('Failed to log entropy fingerprint:', error);
    }
  }

  private shouldBlacklist(analysis: FailureAnalysis): boolean {
    return (
      analysis.metrics.gasSpike === true ||
      (analysis.metrics.oracleLag !== undefined && analysis.metrics.oracleLag > 1000) ||
      (analysis.metrics.slippage !== undefined && analysis.metrics.slippage > 0.05) ||
      (analysis.metrics.drawdown !== undefined && analysis.metrics.drawdown > 0.3)
    );
  }

  private async updateBlacklist(agentId: string): Promise<void> {
    this.blacklist.add(agentId);
    try {
      await fs.writeFile(
        this.config.blacklistPath,
        JSON.stringify(Array.from(this.blacklist))
      );
    } catch (error) {
      logger.error('Failed to update blacklist:', error);
    }
  }

  private async loadBlacklist(): Promise<void> {
    try {
      const data = await fs.readFile(this.config.blacklistPath, 'utf-8');
      this.blacklist = new Set(JSON.parse(data));
    } catch (error) {
      logger.error('Failed to load blacklist:', error);
    }
  }

  public isBlacklisted(agentId: string): boolean {
    return this.blacklist.has(agentId);
  }

  private emitTelemetry(event: string, data: any): void {
    if (this.config.telemetryEnabled) {
      this.telemetryBus.emit('post_mortem', {
        type: event,
        timestamp: Date.now(),
        data
      });
    }
  }

  public cleanup(): void {
    this.blacklist.clear();
  }
} 