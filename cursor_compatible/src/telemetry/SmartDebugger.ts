/**
 * Smart Debugger
 * 
 * Analyzes transaction telemetry data to detect issues and generate alerts.
 */

import { createLogger } from '../common/logger.js';
import { TransactionTelemetry, DebugAlert, TelemetryConfig, DEFAULT_TELEMETRY_CONFIG } from './types/execution_telemetry.types.js';

const logger = createLogger('SmartDebugger');

/**
 * Smart debugger for analyzing transaction telemetry
 */
export class SmartDebugger {
  private readonly config: TelemetryConfig;
  private readonly telemetryEngine: ExecutionTelemetryEngine;
  private readonly alertBuffer: DebugAlert[];
  private readonly maxAlertBufferSize: number = 1000;

  /**
   * Create a new smart debugger
   * @param telemetryEngine Telemetry engine instance
   * @param config Telemetry configuration
   */
  constructor(
    telemetryEngine: ExecutionTelemetryEngine,
    config: TelemetryConfig = DEFAULT_TELEMETRY_CONFIG
  ) {
    this.config = config;
    this.telemetryEngine = telemetryEngine;
    this.alertBuffer = [];

    if (this.config.smartDebuggerEnabled) {
      logger.info('Smart Debugger initialized');
    } else {
      logger.warn('Smart Debugger disabled in configuration');
    }
  }

  /**
   * Analyze telemetry data and generate alerts
   * @param telemetry Transaction telemetry data
   */
  public analyze(telemetry: TransactionTelemetry): void {
    if (!this.config.smartDebuggerEnabled) {
      return;
    }

    const alerts: DebugAlert[] = [];

    // Check for high gas usage
    if (telemetry.gasUsed > this.config.gasUsageThreshold) {
      alerts.push({
        severity: 'Warning',
        message: `High gas usage detected: ${telemetry.gasUsed} gas`,
        timestamp: telemetry.timestamp,
        agentId: telemetry.agentId,
        strategyId: telemetry.strategyId,
        recommendedAction: 'Review contract interactions and optimize gas usage'
      });
    }

    // Check for high slippage
    if (telemetry.slippage > this.config.slippageThreshold) {
      alerts.push({
        severity: 'Warning',
        message: `High slippage detected: ${telemetry.slippage}%`,
        timestamp: telemetry.timestamp,
        agentId: telemetry.agentId,
        strategyId: telemetry.strategyId,
        recommendedAction: 'Consider reducing trade size or using alternative DEX'
      });
    }

    // Check for transaction failures
    if (telemetry.status !== 'Success') {
      alerts.push({
        severity: 'Error',
        message: `Transaction failed: ${telemetry.errorCode}`,
        timestamp: telemetry.timestamp,
        agentId: telemetry.agentId,
        strategyId: telemetry.strategyId,
        recommendedAction: this.getErrorRecommendation(telemetry.errorCode)
      });
    }

    // Check for high latency
    if (telemetry.latencyMs > this.config.latencyThreshold) {
      alerts.push({
        severity: 'Warning',
        message: `High transaction latency: ${telemetry.latencyMs}ms`,
        timestamp: telemetry.timestamp,
        agentId: telemetry.agentId,
        strategyId: telemetry.strategyId,
        recommendedAction: 'Check network conditions and RPC node health'
      });
    }

    // Add alerts to buffer
    alerts.forEach(alert => this.addAlert(alert));
  }

  /**
   * Get recommended action for an error code
   * @param errorCode Error code
   * @returns Recommended action
   */
  private getErrorRecommendation(errorCode: string): string {
    switch (errorCode) {
      case 'OutOfGas':
        return 'Increase gas limit or optimize contract interactions';
      case 'Underpriced':
        return 'Increase gas price or wait for network congestion to subside';
      case 'Reverted':
        return 'Review contract interaction parameters';
      case 'NonceTooLow':
        return 'Reset nonce or wait for pending transactions to clear';
      case 'InsufficientFunds':
        return 'Check wallet balance and funding';
      default:
        return 'Review transaction parameters and network conditions';
    }
  }

  /**
   * Add alert to buffer
   * @param alert Debug alert
   */
  private addAlert(alert: DebugAlert): void {
    this.alertBuffer.push(alert);

    // Maintain buffer size
    if (this.alertBuffer.length > this.maxAlertBufferSize) {
      this.alertBuffer.shift();
    }

    // Log alerts based on severity
    if (alert.severity === 'Error') {
      logger.error('Debug Alert:', alert);
    } else if (alert.severity === 'Warning') {
      logger.warn('Debug Alert:', alert);
    } else {
      logger.info('Debug Alert:', alert);
    }
  }

  /**
   * Get recent alerts for an agent
   * @param agentId Agent identifier
   * @param limit Maximum number of alerts to return
   * @returns Array of debug alerts
   */
  public getAgentAlerts(agentId: string, limit: number = 100): DebugAlert[] {
    return this.alertBuffer
      .filter(alert => alert.agentId === agentId)
      .slice(-limit);
  }

  /**
   * Get recent alerts for a strategy
   * @param strategyId Strategy identifier
   * @param limit Maximum number of alerts to return
   * @returns Array of debug alerts
   */
  public getStrategyAlerts(strategyId: string, limit: number = 100): DebugAlert[] {
    return this.alertBuffer
      .filter(alert => alert.strategyId === strategyId)
      .slice(-limit);
  }

  /**
   * Get all recent alerts
   * @param limit Maximum number of alerts to return
   * @returns Array of debug alerts
   */
  public getAllAlerts(limit: number = 100): DebugAlert[] {
    return this.alertBuffer.slice(-limit);
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    // Clear alert buffer
    this.alertBuffer.length = 0;
  }
} 