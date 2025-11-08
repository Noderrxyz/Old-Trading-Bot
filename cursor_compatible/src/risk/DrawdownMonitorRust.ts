import { NapiDrawdownMonitor, DrawdownConfigParams, TradeDataPointParams } from '@noderr/core';

/**
 * Configuration for the Rust-powered drawdown monitor
 */
export interface DrawdownMonitorConfig {
  maxDrawdownPct: number;
  alertThresholdPct: number;
  rollingWindowSize: number;
  minTradesForDrawdown: number;
  cooldownPeriodMs: number;
}

/**
 * Trade data point for drawdown calculation
 */
export interface TradeDataPoint {
  agentId: string;
  symbol: string;
  amount: number;
  price: number;
  tradeType: 'buy' | 'sell' | 'close';
  equity: number;
  tradeId: string;
  pnl: number;
}

/**
 * Drawdown state for an agent
 */
export interface DrawdownState {
  agentId: string;
  isActive: boolean;
  currentDrawdownPct: number;
  peakEquity: number;
  currentEquity: number;
  cooldownEndTime: string | null;
}

/**
 * Rust-powered drawdown monitor for high-performance drawdown tracking
 * and circuit breaker functionality
 */
export class DrawdownMonitorRust {
  private monitor: NapiDrawdownMonitor;

  /**
   * Create a new DrawdownMonitorRust instance
   * @param config Drawdown monitor configuration
   * @param killSwitchCallback Callback function for when the kill switch is triggered
   */
  constructor(
    config: DrawdownMonitorConfig,
    killSwitchCallback: (agentId: string, reason: string, message: string) => boolean
  ) {
    // Convert config to format expected by Rust
    const params: DrawdownConfigParams = {
      max_drawdown_pct: config.maxDrawdownPct,
      alert_threshold_pct: config.alertThresholdPct,
      rolling_window_size: config.rollingWindowSize,
      min_trades_for_drawdown: config.minTradesForDrawdown,
      cooldown_period_ms: config.cooldownPeriodMs,
    };

    this.monitor = NapiDrawdownMonitor.create(params, killSwitchCallback);
  }

  /**
   * Record a trade for drawdown tracking
   * @param trade Trade data
   */
  async recordTrade(trade: TradeDataPoint): Promise<void> {
    try {
      // Convert trade to format expected by Rust
      const params: TradeDataPointParams = {
        agent_id: trade.agentId,
        symbol: trade.symbol,
        amount: trade.amount,
        price: trade.price,
        trade_type: trade.tradeType,
        equity: trade.equity,
        trade_id: trade.tradeId,
        pnl: trade.pnl,
      };

      await this.monitor.record_trade(params);
    } catch (err) {
      console.error('Error recording trade for drawdown monitoring:', err);
    }
  }

  /**
   * Get current drawdown percentage for an agent
   * @param agentId Agent ID
   * @returns Current drawdown percentage or 0 if agent not found
   */
  async getCurrentDrawdown(agentId: string): Promise<number> {
    try {
      return await this.monitor.get_current_drawdown(agentId);
    } catch (err) {
      console.error('Error getting drawdown:', err);
      return 0;
    }
  }

  /**
   * Check if an agent is active (not in cooldown)
   * @param agentId Agent ID
   * @returns true if agent is active, false otherwise
   */
  async isAgentActive(agentId: string): Promise<boolean> {
    try {
      return await this.monitor.is_agent_active(agentId);
    } catch (err) {
      console.error('Error checking if agent is active:', err);
      return true; // Default to active on error
    }
  }

  /**
   * Reset state for an agent
   * @param agentId Agent ID
   */
  async resetAgent(agentId: string): Promise<void> {
    try {
      await this.monitor.reset_agent(agentId);
    } catch (err) {
      console.error('Error resetting agent:', err);
    }
  }

  /**
   * Get all drawdown states
   * @returns Map of agent IDs to drawdown states
   */
  async getAllStates(): Promise<Record<string, DrawdownState>> {
    try {
      return await this.monitor.get_all_states() as Record<string, DrawdownState>;
    } catch (err) {
      console.error('Error getting drawdown states:', err);
      return {};
    }
  }
} 