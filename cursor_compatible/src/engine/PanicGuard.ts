import logger from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';
import { DiscordWebhookManager } from '../notifications/DiscordWebhookManager.js';

/**
 * Panic guard configuration
 */
export interface PanicGuardConfig {
  maxDrawdownPct: number;
  volatilityThreshold: number;
  maxFailuresInWindow: number;
  failureWindowMs: number;
  cooldownMs: number;
  alertThreshold: number;
  webhookUrl?: string;
}

/**
 * Default panic guard configuration
 */
export const DEFAULT_PANIC_CONFIG: PanicGuardConfig = {
  maxDrawdownPct: 0.1, // 10% max drawdown
  volatilityThreshold: 0.05, // 5% volatility
  maxFailuresInWindow: 3,
  failureWindowMs: 5 * 60 * 1000, // 5 minutes
  cooldownMs: 15 * 60 * 1000, // 15 minutes
  alertThreshold: 2 // Alert after 2 panic triggers
};

/**
 * Panic trigger
 */
export interface PanicTrigger {
  type: 'drawdown' | 'volatility' | 'failures' | 'chaos';
  timestamp: number;
  severity: number;
  data: any;
}

/**
 * Panic state
 */
export interface PanicState {
  isPanic: boolean;
  triggers: PanicTrigger[];
  cooldownEndTime?: number;
  alertCount: number;
}

/**
 * Panic Guard
 */
export class PanicGuard {
  private static instance: PanicGuard | null = null;
  private config: PanicGuardConfig;
  private telemetryBus: TelemetryBus;
  private discordManager: DiscordWebhookManager | null;
  private panicStates: Map<string, PanicState>;

  private constructor(config: Partial<PanicGuardConfig> = {}) {
    this.config = { ...DEFAULT_PANIC_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.panicStates = new Map();
    
    if (this.config.webhookUrl) {
      this.discordManager = new DiscordWebhookManager(this.config.webhookUrl);
    } else {
      this.discordManager = null;
    }
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<PanicGuardConfig>): PanicGuard {
    if (!PanicGuard.instance) {
      PanicGuard.instance = new PanicGuard(config);
    }
    return PanicGuard.instance;
  }

  /**
   * Check for panic conditions
   */
  public checkPanic(
    agentId: string,
    data: {
      drawdownPct?: number;
      volatility?: number;
      failures?: number;
      chaosEvents?: any[];
    }
  ): boolean {
    const state = this.getOrCreateState(agentId);
    const triggers: PanicTrigger[] = [];

    // Check drawdown
    if (data.drawdownPct && data.drawdownPct > this.config.maxDrawdownPct) {
      triggers.push({
        type: 'drawdown',
        timestamp: Date.now(),
        severity: data.drawdownPct / this.config.maxDrawdownPct,
        data: { drawdownPct: data.drawdownPct }
      });
    }

    // Check volatility
    if (data.volatility && data.volatility > this.config.volatilityThreshold) {
      triggers.push({
        type: 'volatility',
        timestamp: Date.now(),
        severity: data.volatility / this.config.volatilityThreshold,
        data: { volatility: data.volatility }
      });
    }

    // Check failures
    if (data.failures && data.failures > this.config.maxFailuresInWindow) {
      triggers.push({
        type: 'failures',
        timestamp: Date.now(),
        severity: data.failures / this.config.maxFailuresInWindow,
        data: { failures: data.failures }
      });
    }

    // Check chaos events
    if (data.chaosEvents && data.chaosEvents.length > 0) {
      triggers.push({
        type: 'chaos',
        timestamp: Date.now(),
        severity: data.chaosEvents.length,
        data: { events: data.chaosEvents }
      });
    }

    // If any triggers, activate panic mode
    if (triggers.length > 0) {
      this.activatePanic(agentId, triggers);
      return true;
    }

    return false;
  }

  /**
   * Activate panic mode
   */
  private activatePanic(agentId: string, triggers: PanicTrigger[]): void {
    const state = this.getOrCreateState(agentId);
    state.isPanic = true;
    state.triggers.push(...triggers);
    state.cooldownEndTime = Date.now() + this.config.cooldownMs;
    state.alertCount++;

    // Emit events
    this.telemetryBus.emit('panic_activated', {
      agentId,
      triggers,
      cooldownEndTime: state.cooldownEndTime
    });

    // Send alerts if threshold reached
    if (state.alertCount >= this.config.alertThreshold) {
      this.sendAlerts(agentId, triggers);
    }

    logger.warn(`Panic mode activated for agent ${agentId}`);
  }

  /**
   * Send alerts
   */
  private sendAlerts(agentId: string, triggers: PanicTrigger[]): void {
    const message = {
      title: '🚨 Panic Mode Activated',
      description: `Agent ${agentId} has entered panic mode`,
      fields: triggers.map(trigger => ({
        name: `Trigger: ${trigger.type}`,
        value: `Severity: ${trigger.severity.toFixed(2)}\nData: ${JSON.stringify(trigger.data)}`
      }))
    };

    // Send to Discord if configured
    if (this.discordManager) {
      this.discordManager.sendMessage(message);
    }

    // Emit alert event
    this.telemetryBus.emit('panic_alert', {
      agentId,
      message
    });
  }

  /**
   * Get or create panic state
   */
  private getOrCreateState(agentId: string): PanicState {
    if (!this.panicStates.has(agentId)) {
      this.panicStates.set(agentId, {
        isPanic: false,
        triggers: [],
        alertCount: 0
      });
    }
    return this.panicStates.get(agentId)!;
  }

  /**
   * Check if agent is in panic mode
   */
  public isInPanic(agentId: string): boolean {
    const state = this.getOrCreateState(agentId);
    
    // Check if cooldown has expired
    if (state.isPanic && state.cooldownEndTime && Date.now() >= state.cooldownEndTime) {
      this.deactivatePanic(agentId);
      return false;
    }

    return state.isPanic;
  }

  /**
   * Deactivate panic mode
   */
  private deactivatePanic(agentId: string): void {
    const state = this.getOrCreateState(agentId);
    state.isPanic = false;
    state.cooldownEndTime = undefined;

    this.telemetryBus.emit('panic_deactivated', {
      agentId,
      triggers: state.triggers
    });

    logger.info(`Panic mode deactivated for agent ${agentId}`);
  }

  /**
   * Get panic state
   */
  public getState(agentId: string): PanicState {
    return { ...this.getOrCreateState(agentId) };
  }

  /**
   * Cleanup old panic data
   */
  public cleanupOldData(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    for (const [agentId, state] of this.panicStates.entries()) {
      const oldestTrigger = state.triggers[0];
      if (oldestTrigger && now - oldestTrigger.timestamp > maxAgeMs) {
        this.panicStates.delete(agentId);
      }
    }
  }
} 