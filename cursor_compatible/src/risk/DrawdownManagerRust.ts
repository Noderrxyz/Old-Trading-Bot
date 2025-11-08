import { NapiDrawdownMonitor, DrawdownConfigParams, TradeDataPointParams } from '@noderr/core';
import { logger } from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';
import { AgentKillSwitch } from '../agents/AgentKillSwitch.js';
import {
  DrawdownConfig,
  DEFAULT_DRAWDOWN_CONFIG,
  TradeDataPoint,
  DrawdownEvent,
  DrawdownEventType
} from './types/drawdown.types.js';

/**
 * Configuration for the Rust-powered drawdown monitor
 */
export interface DrawdownMonitorConfig {
  max_drawdown_pct: number;
  alert_threshold_pct: number;
  rolling_window_size: number;
  min_trades_for_drawdown: number;
  cooldown_period_ms: number;
}

/**
 * Rust-powered Drawdown Manager for high-performance drawdown monitoring
 */
export class DrawdownManagerRust {
  private static instance: DrawdownManagerRust;
  private config: DrawdownConfig;
  private monitor: NapiDrawdownMonitor;
  private killSwitch: AgentKillSwitch;
  private telemetryBus: TelemetryBus;

  private constructor(config: Partial<DrawdownConfig> = {}) {
    this.config = { ...DEFAULT_DRAWDOWN_CONFIG, ...config };
    this.killSwitch = AgentKillSwitch.getInstance();
    this.telemetryBus = TelemetryBus.getInstance();
    
    // Create the Rust drawdown monitor with config and kill switch callback
    const monitorConfig: DrawdownConfigParams = {
      max_drawdown_pct: this.config.maxDrawdownPct,
      alert_threshold_pct: this.config.alertThresholdPct,
      rolling_window_size: this.config.rollingWindowSize,
      min_trades_for_drawdown: this.config.minTradesForDrawdown,
      cooldown_period_ms: this.config.cooldownPeriodMs
    };
    
    // Create the monitor with a kill switch callback
    this.monitor = NapiDrawdownMonitor.create(
      monitorConfig, 
      (agentId: string, reason: string, message: string) => {
        this.killSwitch.trigger(agentId, reason, message);
        return true;
      }
    );
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<DrawdownConfig>): DrawdownManagerRust {
    if (!DrawdownManagerRust.instance) {
      DrawdownManagerRust.instance = new DrawdownManagerRust(config);
    }
    return DrawdownManagerRust.instance;
  }

  /**
   * Record trade and monitor for drawdown events
   * @param agentId Agent identifier
   * @param trade Trade data point
   */
  public async recordTrade(agentId: string, trade: TradeDataPoint): Promise<void> {
    try {
      // Create trade data for Rust using the fields we know are present
      const tradeData: TradeDataPointParams = {
        agent_id: agentId,
        symbol: '',              // Not in TradeDataPoint, using default
        amount: 0,               // Not in TradeDataPoint, using default
        price: 0,                // Not in TradeDataPoint, using default
        trade_type: 'trade',     // Not in TradeDataPoint, using default
        equity: trade.equity,
        trade_id: trade.tradeId,
        pnl: trade.pnl
      };
      
      await this.monitor.record_trade(tradeData);
      
      // Emit telemetry event
      this.telemetryBus.emit('drawdown_trade_recorded', {
        agentId,
        timestamp: trade.timestamp,
        equity: trade.equity,
        pnl: trade.pnl
      });
    } catch (error) {
      logger.error(`[DrawdownManagerRust] Error recording trade: ${error}`);
    }
  }

  /**
   * Get current drawdown for an agent
   * @param agentId Agent identifier
   * @returns Current drawdown percentage
   */
  public async getCurrentDrawdown(agentId: string): Promise<number> {
    try {
      return await this.monitor.get_current_drawdown(agentId);
    } catch (error) {
      logger.error(`[DrawdownManagerRust] Error getting current drawdown: ${error}`);
      return 0;
    }
  }

  /**
   * Check if agent is active or in cooldown
   * @param agentId Agent identifier
   * @returns Whether agent is active
   */
  public async isAgentActive(agentId: string): Promise<boolean> {
    try {
      return await this.monitor.is_agent_active(agentId);
    } catch (error) {
      logger.error(`[DrawdownManagerRust] Error checking if agent is active: ${error}`);
      return true; // Default to active in case of error
    }
  }

  /**
   * Get all agent states
   * @returns Record of agent states
   */
  public async getAllStates(): Promise<Record<string, any>> {
    try {
      return await this.monitor.get_all_states();
    } catch (error) {
      logger.error(`[DrawdownManagerRust] Error getting all states: ${error}`);
      return {};
    }
  }

  /**
   * Reset agent state
   * @param agentId Agent identifier
   */
  public async resetAgent(agentId: string): Promise<void> {
    try {
      await this.monitor.reset_agent(agentId);
    } catch (error) {
      logger.error(`[DrawdownManagerRust] Error resetting agent: ${error}`);
    }
  }

  /**
   * Handle a drawdown event
   * @param event Drawdown event data
   */
  private handleDrawdownEvent(event: any): void {
    // This would be used if the event is raised from Rust
    // Currently, we're using the kill switch callback directly
    logger.warn(`[DrawdownManagerRust] Drawdown event: ${event.message}`);
  }
} 