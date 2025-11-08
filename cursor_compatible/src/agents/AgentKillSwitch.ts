import { logger } from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';

/**
 * Kill switch configuration
 */
export interface KillSwitchConfig {
  cooldownPeriodMs: number;
  maxTriggersPerDay: number;
  alertThreshold: number;
}

/**
 * Default kill switch configuration
 */
export const DEFAULT_KILL_SWITCH_CONFIG: KillSwitchConfig = {
  cooldownPeriodMs: 3600000, // 1 hour
  maxTriggersPerDay: 3,
  alertThreshold: 2 // Alert after 2 triggers
};

/**
 * Kill switch state
 */
interface KillSwitchState {
  agentId: string;
  isActive: boolean;
  cooldownEndTime: number;
  triggerCount: number;
  lastTriggerTime: number;
  triggers: {
    timestamp: number;
    reason: string;
    message: string;
  }[];
}

/**
 * Kill switch event
 */
export interface KillSwitchEvent {
  type: 'trigger' | 'reset' | 'alert';
  agentId: string;
  timestamp: number;
  reason: string;
  message: string;
}

/**
 * Agent Kill Switch
 */
export class AgentKillSwitch {
  private static instance: AgentKillSwitch | null = null;
  private config: KillSwitchConfig;
  private telemetryBus: TelemetryBus;
  private states: Map<string, KillSwitchState>;
  private cleanupInterval: NodeJS.Timeout | null = null;

  private constructor(config: Partial<KillSwitchConfig> = {}) {
    this.config = { ...DEFAULT_KILL_SWITCH_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.states = new Map();
    this.startCleanupInterval();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<KillSwitchConfig>): AgentKillSwitch {
    if (!AgentKillSwitch.instance) {
      AgentKillSwitch.instance = new AgentKillSwitch(config);
    }
    return AgentKillSwitch.instance;
  }

  /**
   * Trigger the kill switch for an agent
   */
  public trigger(agentId: string, reason: string, message: string): void {
    const now = Date.now();
    const state = this.getOrCreateState(agentId);

    // Check if agent is already in cooldown
    if (state.isActive && now < state.cooldownEndTime) {
      logger.warn(`Kill switch already active for agent ${agentId}`);
      return;
    }

    // Check daily trigger limit
    if (this.isDailyLimitExceeded(state, now)) {
      logger.warn(`Daily trigger limit exceeded for agent ${agentId}`);
      return;
    }

    // Update state
    state.isActive = true;
    state.cooldownEndTime = now + this.config.cooldownPeriodMs;
    state.triggerCount++;
    state.lastTriggerTime = now;
    state.triggers.push({ timestamp: now, reason, message });

    // Check alert threshold
    if (state.triggerCount >= this.config.alertThreshold) {
      this.handleAlert(agentId, reason, message);
    }

    // Emit event
    const event: KillSwitchEvent = {
      type: 'trigger',
      agentId,
      timestamp: now,
      reason,
      message
    };
    this.telemetryBus.emit('kill_switch_event', event);
    logger.warn(`Kill switch triggered for agent ${agentId}: ${message}`);
  }

  /**
   * Reset the kill switch for an agent
   */
  public reset(agentId: string): void {
    const state = this.states.get(agentId);
    if (!state) return;

    const now = Date.now();
    state.isActive = false;
    state.cooldownEndTime = 0;

    // Emit event
    const event: KillSwitchEvent = {
      type: 'reset',
      agentId,
      timestamp: now,
      reason: 'manual_reset',
      message: 'Kill switch manually reset'
    };
    this.telemetryBus.emit('kill_switch_event', event);
    logger.info(`Kill switch reset for agent ${agentId}`);
  }

  /**
   * Check if an agent is currently killed
   */
  public isKilled(agentId: string): boolean {
    const state = this.states.get(agentId);
    if (!state) return false;

    const now = Date.now();
    if (!state.isActive) return false;

    // Check if cooldown period has ended
    if (now >= state.cooldownEndTime) {
      this.reset(agentId);
      return false;
    }

    return true;
  }

  /**
   * Get kill switch state for an agent
   */
  public getState(agentId: string): KillSwitchState | null {
    return this.states.get(agentId) || null;
  }

  /**
   * Get or create kill switch state for an agent
   */
  private getOrCreateState(agentId: string): KillSwitchState {
    let state = this.states.get(agentId);
    if (!state) {
      state = {
        agentId,
        isActive: false,
        cooldownEndTime: 0,
        triggerCount: 0,
        lastTriggerTime: 0,
        triggers: []
      };
      this.states.set(agentId, state);
    }
    return state;
  }

  /**
   * Check if daily trigger limit is exceeded
   */
  private isDailyLimitExceeded(state: KillSwitchState, now: number): boolean {
    const oneDayAgo = now - 86400000; // 24 hours in milliseconds
    const dailyTriggers = state.triggers.filter(
      trigger => trigger.timestamp >= oneDayAgo
    );
    return dailyTriggers.length >= this.config.maxTriggersPerDay;
  }

  /**
   * Handle alert threshold
   */
  private handleAlert(agentId: string, reason: string, message: string): void {
    const event: KillSwitchEvent = {
      type: 'alert',
      agentId,
      timestamp: Date.now(),
      reason,
      message: `Alert: ${message} (${this.config.alertThreshold} triggers reached)`
    };
    this.telemetryBus.emit('kill_switch_event', event);
    logger.warn(event.message);
  }

  /**
   * Start cleanup interval
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(
      () => this.cleanupOldData(),
      3600000 // Cleanup every hour
    );
  }

  /**
   * Cleanup old data
   */
  private cleanupOldData(): void {
    const now = Date.now();
    const oneDayAgo = now - 86400000;

    for (const [agentId, state] of this.states.entries()) {
      // Remove triggers older than 24 hours
      state.triggers = state.triggers.filter(
        trigger => trigger.timestamp >= oneDayAgo
      );

      // Remove state if no recent triggers and not active
      if (state.triggers.length === 0 && !state.isActive) {
        this.states.delete(agentId);
      }
    }
  }
} 