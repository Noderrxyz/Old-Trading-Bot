import { PanicManager } from '../risk/PanicManager';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { logger } from '../utils/logger';

export class Guardrails {
  private static instance: Guardrails;
  private panicManager: PanicManager;
  private telemetryBus: TelemetryBus;

  private constructor() {
    this.panicManager = PanicManager.getInstance();
    this.telemetryBus = TelemetryBus.getInstance();
    this.setupTelemetry();
  }

  public static getInstance(): Guardrails {
    if (!Guardrails.instance) {
      Guardrails.instance = new Guardrails();
    }
    return Guardrails.instance;
  }

  private setupTelemetry() {
    // Monitor system health
    this.telemetryBus.on('system_metrics', (event: any) => {
      this.checkSystemHealth(event);
    });

    // Monitor agent performance
    this.telemetryBus.on('agent_metrics', (event: any) => {
      this.checkAgentHealth(event);
    });

    // Monitor transaction execution
    this.telemetryBus.on('transaction', (event: any) => {
      this.checkTransactionSafety(event);
    });
  }

  private checkSystemHealth(metrics: any) {
    // Check memory usage
    if (metrics.memory_usage > 0.9) { // 90% memory usage
      logger.warn('High memory usage detected:', metrics.memory_usage);
    }

    // Check CPU usage
    if (metrics.cpu_usage > 0.8) { // 80% CPU usage
      logger.warn('High CPU usage detected:', metrics.cpu_usage);
    }

    // Check error rate
    if (metrics.error_rate > 0.1) { // 10% error rate
      logger.warn('High error rate detected:', metrics.error_rate);
    }
  }

  private checkAgentHealth(metrics: any) {
    // Check drawdown
    if (metrics.drawdown > 0.05) { // 5% drawdown
      logger.warn(`Agent ${metrics.id} drawdown detected:`, metrics.drawdown);
    }

    // Check trust score
    if (metrics.trust < 0.3) { // 30% trust
      logger.warn(`Agent ${metrics.id} low trust score:`, metrics.trust);
    }

    // Check retry count
    if (metrics.retry_count > 3) { // 3 retries
      logger.warn(`Agent ${metrics.id} high retry count:`, metrics.retry_count);
    }
  }

  private checkTransactionSafety(tx: any) {
    // Check gas price
    if (tx.gas_price > 100) { // 100 gwei
      logger.warn('High gas price detected:', tx.gas_price);
    }

    // Check slippage
    if (tx.slippage > 0.01) { // 1% slippage
      logger.warn('High slippage detected:', tx.slippage);
    }

    // Check Flashbots rejection
    if (tx.flashbots_rejected) {
      logger.warn('Flashbots bundle rejected');
    }
  }

  public async triggerPanic() {
    await this.panicManager.triggerPanic();
  }

  public async resetPanic() {
    await this.panicManager.resetPanic();
  }

  public isInPanic(): boolean {
    return this.panicManager.isInPanic();
  }
} 