import logger from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';
import { AgentKillSwitch } from '../agents/AgentKillSwitch.js';
import {
  DrawdownConfig,
  DEFAULT_DRAWDOWN_CONFIG,
  TradeDataPoint,
  DrawdownWindow,
  DrawdownEvent,
  DrawdownEventType,
  DrawdownState
} from './types/drawdown.types.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Drawdown Manager
 */
export class DrawdownManager {
  private static instance: DrawdownManager;
  private config: DrawdownConfig;
  private killSwitch: AgentKillSwitch;
  private telemetryBus: TelemetryBus;
  private tradeHistory: Map<string, TradeDataPoint[]>;
  private drawdownStates: Map<string, DrawdownState>;
  private logStream: fs.WriteStream;

  private constructor(config: Partial<DrawdownConfig> = {}) {
    this.config = { ...DEFAULT_DRAWDOWN_CONFIG, ...config };
    this.killSwitch = AgentKillSwitch.getInstance();
    this.telemetryBus = TelemetryBus.getInstance();
    this.tradeHistory = new Map();
    this.drawdownStates = new Map();
    this.setupLogging();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<DrawdownConfig>): DrawdownManager {
    if (!DrawdownManager.instance) {
      DrawdownManager.instance = new DrawdownManager(config);
    }
    return DrawdownManager.instance;
  }

  /**
   * Setup logging
   */
  private setupLogging(): void {
    const logDir = path.join(process.cwd(), 'logs', 'risk');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.logStream = fs.createWriteStream(path.join(logDir, 'drawdowns.jsonl'), { flags: 'a' });
  }

  /**
   * Record trade
   */
  public recordTrade(agentId: string, trade: TradeDataPoint): void {
    // Initialize trade history if needed
    if (!this.tradeHistory.has(agentId)) {
      this.tradeHistory.set(agentId, []);
    }

    // Add trade to history
    const history = this.tradeHistory.get(agentId)!;
    history.push(trade);

    // Trim history to rolling window size
    if (history.length > this.config.rollingWindowSize) {
      history.splice(0, history.length - this.config.rollingWindowSize);
    }

    // Update drawdown state
    this.updateDrawdownState(agentId);
  }

  /**
   * Update drawdown state
   */
  private updateDrawdownState(agentId: string): void {
    const history = this.tradeHistory.get(agentId);
    if (!history || history.length < this.config.minTradesForDrawdown) {
      return;
    }

    // Calculate current drawdown
    const peakEquity = Math.max(...history.map(t => t.equity));
    const currentEquity = history[history.length - 1].equity;
    const drawdownPct = (peakEquity - currentEquity) / peakEquity;

    // Get or create state
    let state = this.drawdownStates.get(agentId);
    if (!state) {
      state = {
        agentId,
        isActive: true,
        currentDrawdownPct: 0,
        peakEquity: peakEquity,
        currentEquity: currentEquity,
        tradeHistory: history
      };
      this.drawdownStates.set(agentId, state);
    }

    // Update state
    state.currentDrawdownPct = drawdownPct;
    state.peakEquity = peakEquity;
    state.currentEquity = currentEquity;
    state.tradeHistory = history;

    // Check for drawdown events
    this.checkDrawdownEvents(agentId, state, drawdownPct);
  }

  /**
   * Check for drawdown events
   */
  private checkDrawdownEvents(agentId: string, state: DrawdownState, drawdownPct: number): void {
    // Check for breach
    if (drawdownPct >= this.config.maxDrawdownPct && state.isActive) {
      this.handleBreach(agentId, state, drawdownPct);
    }
    // Check for alert
    else if (drawdownPct >= this.config.alertThresholdPct && state.isActive) {
      this.handleAlert(agentId, state, drawdownPct);
    }
    // Check for recovery
    else if (drawdownPct < this.config.alertThresholdPct && !state.isActive) {
      this.handleRecovery(agentId, state, drawdownPct);
    }
  }

  /**
   * Handle breach
   */
  private handleBreach(agentId: string, state: DrawdownState, drawdownPct: number): void {
    state.isActive = false;
    state.cooldownEndTime = Date.now() + this.config.cooldownPeriodMs;

    const event: DrawdownEvent = {
      type: DrawdownEventType.BREACH,
      timestamp: Date.now(),
      agentId,
      drawdownPct,
      peakEquity: state.peakEquity,
      currentEquity: state.currentEquity,
      message: `Drawdown breach: ${(drawdownPct * 100).toFixed(2)}%`
    };

    this.logEvent(event);
    this.killSwitch.trigger(agentId, 'drawdown_breach', event.message);
  }

  /**
   * Handle alert
   */
  private handleAlert(agentId: string, state: DrawdownState, drawdownPct: number): void {
    const event: DrawdownEvent = {
      type: DrawdownEventType.ALERT,
      timestamp: Date.now(),
      agentId,
      drawdownPct,
      peakEquity: state.peakEquity,
      currentEquity: state.currentEquity,
      message: `Drawdown alert: ${(drawdownPct * 100).toFixed(2)}%`
    };

    this.logEvent(event);
    this.telemetryBus.emit('drawdown_alert', event);
  }

  /**
   * Handle recovery
   */
  private handleRecovery(agentId: string, state: DrawdownState, drawdownPct: number): void {
    state.isActive = true;
    state.cooldownEndTime = undefined;

    const event: DrawdownEvent = {
      type: DrawdownEventType.RECOVERY,
      timestamp: Date.now(),
      agentId,
      drawdownPct,
      peakEquity: state.peakEquity,
      currentEquity: state.currentEquity,
      message: `Drawdown recovery: ${(drawdownPct * 100).toFixed(2)}%`
    };

    this.logEvent(event);
    this.telemetryBus.emit('drawdown_recovery', event);
  }

  /**
   * Log event
   */
  private logEvent(event: DrawdownEvent): void {
    this.logStream.write(JSON.stringify(event) + '\n');
    logger.warn(`[DrawdownManager] ${event.message}`);
  }

  /**
   * Get current drawdown
   */
  public getCurrentDrawdown(agentId: string): number {
    const state = this.drawdownStates.get(agentId);
    return state ? state.currentDrawdownPct : 0;
  }

  /**
   * Check if agent is active
   */
  public isAgentActive(agentId: string): boolean {
    const state = this.drawdownStates.get(agentId);
    if (!state) return true;

    if (state.cooldownEndTime && Date.now() < state.cooldownEndTime) {
      return false;
    }

    return state.isActive;
  }

  /**
   * Cleanup
   */
  public cleanup(): void {
    this.logStream.end();
  }
} 