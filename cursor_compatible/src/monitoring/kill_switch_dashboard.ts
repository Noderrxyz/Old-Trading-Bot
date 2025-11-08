/**
 * Kill Switch Dashboard
 * 
 * Provides visualization and monitoring of kill switch events.
 */

import { AlphaKillSwitch, KillEvent } from '../evolution/alpha_kill_switch.js';
import logger from '../utils/logger.js';

/**
 * Dashboard configuration
 */
export interface KillSwitchDashboardConfig {
  updateIntervalMs: number;
  maxEventsToShow: number;
  enableConsoleOutput: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_DASHBOARD_CONFIG: KillSwitchDashboardConfig = {
  updateIntervalMs: 5000,
  maxEventsToShow: 10,
  enableConsoleOutput: true
};

/**
 * Kill Switch Dashboard class
 */
export class KillSwitchDashboard {
  private static instance: KillSwitchDashboard | null = null;
  private config: KillSwitchDashboardConfig;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => logger.debug(`[KillSwitchDashboard] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => logger.info(`[KillSwitchDashboard] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => logger.warn(`[KillSwitchDashboard] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => logger.error(`[KillSwitchDashboard] ${msg}`, ...args)
  };
  private updateInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * Get singleton instance
   */
  public static getInstance(): KillSwitchDashboard {
    if (!KillSwitchDashboard.instance) {
      KillSwitchDashboard.instance = new KillSwitchDashboard();
    }
    return KillSwitchDashboard.instance;
  }

  private constructor(config: Partial<KillSwitchDashboardConfig> = {}) {
    this.config = { ...DEFAULT_DASHBOARD_CONFIG, ...config };
  }

  /**
   * Start the dashboard
   */
  public start(): void {
    if (this.isRunning) {
      this.logger.warn('Dashboard is already running');
      return;
    }

    this.isRunning = true;
    this.updateInterval = setInterval(() => this.update(), this.config.updateIntervalMs);
    this.logger.info('Kill switch dashboard started');
  }

  /**
   * Stop the dashboard
   */
  public stop(): void {
    if (!this.isRunning) return;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    this.isRunning = false;
    this.logger.info('Kill switch dashboard stopped');
  }

  /**
   * Update dashboard display
   */
  private update(): void {
    const killSwitch = AlphaKillSwitch.getInstance();
    const events = killSwitch.getRecentKillEvents(this.config.maxEventsToShow);

    if (this.config.enableConsoleOutput) {
      this.renderConsoleTable(events);
    }
  }

  /**
   * Render events as a console table
   */
  private renderConsoleTable(events: KillEvent[]): void {
    if (events.length === 0) {
      console.log('\nNo recent kill events\n');
      return;
    }

    console.log('\nRecent Kill Events:');
    console.log('='.repeat(120));
    console.log(
      'Timestamp'.padEnd(20) +
      'Strategy ID'.padEnd(20) +
      'Reason'.padEnd(15) +
      'ROI'.padEnd(10) +
      'Drawdown'.padEnd(10) +
      'Trades'.padEnd(10) +
      'vs Median'.padEnd(10)
    );
    console.log('-'.repeat(120));

    events.forEach(event => {
      const timestamp = new Date(event.timestamp).toISOString();
      console.log(
        timestamp.padEnd(20) +
        event.strategyId.padEnd(20) +
        event.reason.padEnd(15) +
        (event.metrics.roi * 100).toFixed(2) + '%'.padEnd(10) +
        (event.metrics.drawdown * 100).toFixed(2) + '%'.padEnd(10) +
        event.metrics.trades.toString().padEnd(10) +
        (event.metrics.performanceVsMedian * 100).toFixed(2) + '%'.padEnd(10)
      );
    });

    console.log('='.repeat(120) + '\n');
  }

  /**
   * Reset dashboard state
   */
  public reset(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.isRunning = false;
    this.logger.info('Kill switch dashboard reset');
  }
} 