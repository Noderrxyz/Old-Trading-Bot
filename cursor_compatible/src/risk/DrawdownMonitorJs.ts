import { telemetry } from '../telemetry';
import { SeverityLevel } from '../telemetry/types';
import { logger } from '../utils/logger';

/**
 * Configuration for the JavaScript drawdown monitor
 */
export interface DrawdownMonitorConfig {
  maxDrawdownPct: number;
  alertThresholdPct: number;
  rollingWindowSize: number;
  minTradesForDrawdown: number;
  cooldownPeriodMs: number;
}

/**
 * Default configuration for the drawdown monitor
 */
const DEFAULT_CONFIG: DrawdownMonitorConfig = {
  maxDrawdownPct: 0.1,         // 10% max drawdown
  alertThresholdPct: 0.07,     // 7% alert threshold
  rollingWindowSize: 20,       // Consider last 20 trades
  minTradesForDrawdown: 5,     // Need at least 5 trades to trigger
  cooldownPeriodMs: 3600000,   // 1 hour cooldown
};

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
 * JavaScript fallback implementation of the drawdown monitor
 * for drawdown tracking and circuit breaker functionality
 */
export class DrawdownMonitorJs {
  private config: DrawdownMonitorConfig;
  private killSwitchCallback: (agentId: string, reason: string, message: string) => boolean;
  private tradeHistory: Map<string, TradeDataPoint[]> = new Map();
  private agentStates: Map<string, DrawdownState> = new Map();
  
  /**
   * Create a new DrawdownMonitorJs instance
   * @param config Drawdown monitor configuration
   * @param killSwitchCallback Callback function for when the kill switch is triggered
   */
  constructor(
    config: Partial<DrawdownMonitorConfig> = {},
    killSwitchCallback: (agentId: string, reason: string, message: string) => boolean
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.killSwitchCallback = killSwitchCallback;
    
    telemetry.recordMetric('drawdown_monitor.initialization', 1, {
      implementation: 'javascript'
    });
    
    logger.info('Initialized JavaScript fallback DrawdownMonitor');
  }
  
  /**
   * Record a trade for drawdown tracking
   * @param trade Trade data
   */
  async recordTrade(trade: TradeDataPoint): Promise<void> {
    try {
      const startTime = performance.now();
      
      // Validate trade data
      if (!trade.agentId) {
        throw new Error('Agent ID is required');
      }
      
      if (!trade.symbol) {
        throw new Error('Symbol is required');
      }
      
      if (trade.equity <= 0) {
        throw new Error(`Invalid equity value: ${trade.equity}`);
      }
      
      // Get or initialize trade history for this agent
      if (!this.tradeHistory.has(trade.agentId)) {
        this.tradeHistory.set(trade.agentId, []);
        
        telemetry.recordMetric('drawdown_monitor.new_agent', 1, {
          agent_id: trade.agentId,
          implementation: 'javascript'
        });
      }
      
      // Get or initialize agent state
      if (!this.agentStates.has(trade.agentId)) {
        this.agentStates.set(trade.agentId, {
          agentId: trade.agentId,
          isActive: true,
          currentDrawdownPct: 0,
          peakEquity: trade.equity,
          currentEquity: trade.equity,
          cooldownEndTime: null
        });
        
        telemetry.recordMetric('drawdown_monitor.agent_initialized', 1, {
          agent_id: trade.agentId,
          initial_equity: trade.equity.toString(),
          implementation: 'javascript'
        });
      }
      
      // Add trade to history and keep within rolling window
      const trades = this.tradeHistory.get(trade.agentId)!;
      trades.push(trade);
      
      if (trades.length > this.config.rollingWindowSize) {
        trades.shift(); // Remove oldest trade
      }
      
      // Update agent state
      const state = this.agentStates.get(trade.agentId)!;
      const previousEquity = state.currentEquity;
      state.currentEquity = trade.equity;
      
      // Track equity change between trades
      const equityChangePct = (trade.equity - previousEquity) / previousEquity;
      
      telemetry.recordMetric('drawdown_monitor.equity_change_pct', equityChangePct, {
        agent_id: trade.agentId,
        symbol: trade.symbol,
        trade_type: trade.tradeType,
        implementation: 'javascript'
      });
      
      // Update peak equity if current equity is higher
      if (trade.equity > state.peakEquity) {
        const previousPeak = state.peakEquity;
        state.peakEquity = trade.equity;
        
        telemetry.recordMetric('drawdown_monitor.peak_equity_updated', 1, {
          agent_id: trade.agentId,
          previous_peak: previousPeak.toString(),
          new_peak: state.peakEquity.toString(),
          implementation: 'javascript'
        });
      }
      
      // Calculate current drawdown
      const previousDrawdownPct = state.currentDrawdownPct;
      if (state.peakEquity > 0) {
        state.currentDrawdownPct = (state.peakEquity - state.currentEquity) / state.peakEquity;
      } else {
        state.currentDrawdownPct = 0;
      }
      
      // Record drawdown change
      telemetry.recordMetric('drawdown_monitor.current_drawdown', state.currentDrawdownPct, {
        agent_id: trade.agentId,
        symbol: trade.symbol,
        implementation: 'javascript'
      });
      
      // Check if drawdown exceeds maximum allowed
      if (trades.length >= this.config.minTradesForDrawdown && 
          state.currentDrawdownPct >= this.config.maxDrawdownPct && 
          state.isActive) {
        
        // Trigger kill switch
        const message = `Maximum drawdown exceeded: ${(state.currentDrawdownPct * 100).toFixed(2)}%`;
        const killSwitchResult = this.killSwitchCallback(trade.agentId, 'drawdown_limit', message);
        
        if (killSwitchResult) {
          // Set agent to inactive and start cooldown
          state.isActive = false;
          const cooldownEnd = new Date(Date.now() + this.config.cooldownPeriodMs);
          state.cooldownEndTime = cooldownEnd.toISOString();
          
          telemetry.recordEvent(
            'kill_switch_triggered',
            'DrawdownMonitorJs',
            {
              agent_id: trade.agentId,
              drawdown: state.currentDrawdownPct.toString(),
              cooldown_end: state.cooldownEndTime,
              implementation: 'javascript'
            },
            {
              peak_equity: state.peakEquity,
              current_equity: state.currentEquity,
              max_drawdown_pct: this.config.maxDrawdownPct,
              trades_count: trades.length,
              cooldown_period_ms: this.config.cooldownPeriodMs
            }
          );
          
          logger.warn(`[DrawdownMonitorJs] Kill switch triggered for agent ${trade.agentId} - Drawdown: ${(state.currentDrawdownPct * 100).toFixed(2)}%`);
        }
      } 
      // Check if drawdown is approaching alert threshold
      else if (trades.length >= this.config.minTradesForDrawdown && 
               state.currentDrawdownPct >= this.config.alertThresholdPct &&
               state.isActive) {
        
        // Record more detailed data for approaching threshold
        const drawdownIncrease = state.currentDrawdownPct - previousDrawdownPct;
        const drawdownRatio = state.currentDrawdownPct / this.config.maxDrawdownPct;
        
        telemetry.recordMetric('drawdown_monitor.alert_threshold', 1, {
          agent_id: trade.agentId,
          drawdown: state.currentDrawdownPct.toString(),
          drawdown_increase: drawdownIncrease.toString(),
          drawdown_ratio: drawdownRatio.toString(),
          implementation: 'javascript'
        });
        
        // Record an event for approaching the threshold
        telemetry.recordEvent(
          'drawdown_alert_threshold',
          'DrawdownMonitorJs',
          {
            agent_id: trade.agentId,
            drawdown: state.currentDrawdownPct.toString(),
            implementation: 'javascript'
          },
          {
            peak_equity: state.peakEquity,
            current_equity: state.currentEquity,
            alert_threshold_pct: this.config.alertThresholdPct,
            max_threshold_pct: this.config.maxDrawdownPct,
            trades_count: trades.length,
            drawdown_ratio: drawdownRatio
          }
        );
        
        logger.warn(`[DrawdownMonitorJs] Alert threshold approached for agent ${trade.agentId} - Drawdown: ${(state.currentDrawdownPct * 100).toFixed(2)}%`);
      }
      
      // Check if cooldown period has passed
      if (!state.isActive && state.cooldownEndTime) {
        const cooldownEndTime = new Date(state.cooldownEndTime).getTime();
        if (Date.now() >= cooldownEndTime) {
          state.isActive = true;
          state.cooldownEndTime = null;
          
          // Reset peak equity to current equity
          state.peakEquity = state.currentEquity;
          state.currentDrawdownPct = 0;
          
          telemetry.recordEvent(
            'agent_reactivated',
            'DrawdownMonitorJs',
            {
              agent_id: trade.agentId,
              implementation: 'javascript'
            },
            {
              cooldown_period_ms: this.config.cooldownPeriodMs,
              initial_equity: state.currentEquity
            }
          );
          
          logger.info(`[DrawdownMonitorJs] Agent ${trade.agentId} reactivated after cooldown period`);
        }
      }
      
      // Update agent state
      this.agentStates.set(trade.agentId, state);
      
      const endTime = performance.now();
      
      telemetry.recordMetric('drawdown_monitor.record_trade_time', endTime - startTime, {
        agent_id: trade.agentId,
        implementation: 'javascript'
      });
      
    } catch (err) {
      const error = err as Error;
      
      telemetry.recordError(
        'DrawdownMonitorJs',
        `Error recording trade: ${error.message}`,
        SeverityLevel.ERROR,
        { 
          agent_id: trade?.agentId || 'unknown',
          method: 'recordTrade',
          error_type: error.name,
          stack: error.stack || '',
          trade_data: JSON.stringify({
            symbol: trade?.symbol,
            tradeType: trade?.tradeType,
            equity: trade?.equity
          })
        }
      );
      
      logger.error(`[DrawdownMonitorJs] Error recording trade: ${error.message}`, {
        agent_id: trade?.agentId,
        symbol: trade?.symbol,
        error_stack: error.stack
      });
      
      // Re-throw error only if it's critical (missing trade data)
      if (!trade || !trade.agentId) {
        throw new Error(`Invalid trade data: ${error.message}`);
      }
    }
  }
  
  /**
   * Get current drawdown percentage for an agent
   * @param agentId Agent ID
   * @returns Current drawdown percentage or 0 if agent not found
   */
  async getCurrentDrawdown(agentId: string): Promise<number> {
    try {
      const state = this.agentStates.get(agentId);
      if (!state) {
        return 0;
      }
      return state.currentDrawdownPct;
    } catch (err) {
      const error = err as Error;
      
      telemetry.recordError(
        'DrawdownMonitorJs',
        `Error getting drawdown: ${error.message}`,
        SeverityLevel.ERROR,
        { 
          agent_id: agentId,
          method: 'getCurrentDrawdown' 
        }
      );
      
      logger.error(`[DrawdownMonitorJs] Error getting drawdown: ${error.message}`);
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
      const state = this.agentStates.get(agentId);
      if (!state) {
        return true; // Default to active if no state exists
      }
      return state.isActive;
    } catch (err) {
      const error = err as Error;
      
      telemetry.recordError(
        'DrawdownMonitorJs',
        `Error checking if agent is active: ${error.message}`,
        SeverityLevel.ERROR,
        { 
          agent_id: agentId,
          method: 'isAgentActive' 
        }
      );
      
      logger.error(`[DrawdownMonitorJs] Error checking if agent is active: ${error.message}`);
      return true; // Default to active on error
    }
  }
  
  /**
   * Reset state for an agent
   * @param agentId Agent ID
   */
  async resetAgent(agentId: string): Promise<void> {
    try {
      // Clear trade history
      this.tradeHistory.delete(agentId);
      
      // Reset agent state - initialize with defaults if we have any equity info
      const currentState = this.agentStates.get(agentId);
      if (currentState) {
        this.agentStates.set(agentId, {
          agentId,
          isActive: true,
          currentDrawdownPct: 0,
          peakEquity: currentState.currentEquity,
          currentEquity: currentState.currentEquity,
          cooldownEndTime: null
        });
      } else {
        // Remove agent state completely if no data
        this.agentStates.delete(agentId);
      }
      
      telemetry.recordMetric('drawdown_monitor.reset_agent', 1, {
        agent_id: agentId,
        implementation: 'javascript'
      });
      
      logger.info(`[DrawdownMonitorJs] Reset agent ${agentId}`);
    } catch (err) {
      const error = err as Error;
      
      telemetry.recordError(
        'DrawdownMonitorJs',
        `Error resetting agent: ${error.message}`,
        SeverityLevel.ERROR,
        { 
          agent_id: agentId,
          method: 'resetAgent' 
        }
      );
      
      logger.error(`[DrawdownMonitorJs] Error resetting agent: ${error.message}`);
    }
  }
  
  /**
   * Get all drawdown states
   * @returns Record of agent IDs to drawdown states
   */
  async getAllStates(): Promise<Record<string, DrawdownState>> {
    try {
      const result: Record<string, DrawdownState> = {};
      
      for (const [agentId, state] of this.agentStates.entries()) {
        result[agentId] = { ...state };
      }
      
      return result;
    } catch (err) {
      const error = err as Error;
      
      telemetry.recordError(
        'DrawdownMonitorJs',
        `Error getting drawdown states: ${error.message}`,
        SeverityLevel.ERROR,
        { method: 'getAllStates' }
      );
      
      logger.error(`[DrawdownMonitorJs] Error getting drawdown states: ${error.message}`);
      return {};
    }
  }
} 