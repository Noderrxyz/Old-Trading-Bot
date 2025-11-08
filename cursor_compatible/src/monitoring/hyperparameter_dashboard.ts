/**
 * Hyperparameter Dashboard
 * 
 * Provides visualization of hyperparameter tuning and performance metrics.
 */

import { HyperparameterAutoTuner, TuningMetrics } from '../evolution/hyperparameter_auto_tuner.js';
import logger from '../utils/logger.js';

/**
 * Dashboard configuration
 */
export interface HyperparameterDashboardConfig {
  updateIntervalMs: number;
  maxHistoryPoints: number;
  enableConsoleOutput: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_DASHBOARD_CONFIG: HyperparameterDashboardConfig = {
  updateIntervalMs: 5000,
  maxHistoryPoints: 100,
  enableConsoleOutput: true
};

/**
 * Hyperparameter Dashboard class
 */
export class HyperparameterDashboard {
  private static instance: HyperparameterDashboard | null = null;
  private config: HyperparameterDashboardConfig;
  private readonly logger = {
    debug: (msg: string, ...args: any[]) => logger.debug(`[HyperparameterDashboard] ${msg}`, ...args),
    info: (msg: string, ...args: any[]) => logger.info(`[HyperparameterDashboard] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => logger.warn(`[HyperparameterDashboard] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => logger.error(`[HyperparameterDashboard] ${msg}`, ...args)
  };
  private updateInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * Get singleton instance
   */
  public static getInstance(): HyperparameterDashboard {
    if (!HyperparameterDashboard.instance) {
      HyperparameterDashboard.instance = new HyperparameterDashboard();
    }
    return HyperparameterDashboard.instance;
  }

  private constructor(config: Partial<HyperparameterDashboardConfig> = {}) {
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
    this.logger.info('Hyperparameter dashboard started');
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
    this.logger.info('Hyperparameter dashboard stopped');
  }

  /**
   * Update dashboard display
   */
  private update(): void {
    const autoTuner = HyperparameterAutoTuner.getInstance();
    // TODO: Get strategy metrics and render visualization
    if (this.config.enableConsoleOutput) {
      this.renderConsoleMetrics();
    }
  }

  /**
   * Render metrics in console
   */
  private renderConsoleMetrics(): void {
    console.log('\nHyperparameter Tuning Metrics:');
    console.log('='.repeat(120));
    console.log(
      'Time'.padEnd(20) +
      'Strategy ID'.padEnd(20) +
      'Volatility'.padEnd(12) +
      'Win Rate'.padEnd(12) +
      'ROI'.padEnd(12) +
      'Trust'.padEnd(12) +
      'SL %'.padEnd(12) +
      'TP %'.padEnd(12)
    );
    console.log('-'.repeat(120));

    // TODO: Get and display actual metrics
    console.log('No metrics available yet');

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
    this.logger.info('Hyperparameter dashboard reset');
  }
} 