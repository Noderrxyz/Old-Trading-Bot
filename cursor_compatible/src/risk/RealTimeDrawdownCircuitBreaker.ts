import { createLogger } from '../common/logger.js';
import {
  DrawdownBreachEvent,
  DrawdownCircuitConfig,
  DEFAULT_DRAWDOWN_CIRCUIT_CONFIG
} from './types/drawdown_circuit.types.js';

/**
 * Monitors account drawdown and triggers circuit breaker if threshold is breached
 */
export class RealTimeDrawdownCircuitBreaker {
  private readonly logger = createLogger('RealTimeDrawdownCircuitBreaker');
  
  // Account equity history
  private readonly equityHistory: number[] = [];
  
  // Maximum equity seen
  private maxEquity: number = 0;
  
  // Check interval timer
  private checkTimer?: NodeJS.Timeout;
  
  // Circuit breaker state
  private isTriggered: boolean = false;
  
  constructor(
    private readonly config: DrawdownCircuitConfig = DEFAULT_DRAWDOWN_CIRCUIT_CONFIG
  ) {
    if (!config.enabled) {
      this.logger.warn('Drawdown circuit breaker is disabled');
    } else {
      this.startMonitoring();
    }
  }
  
  /**
   * Start monitoring account equity
   */
  private startMonitoring(): void {
    if (!this.config.enabled) return;
    
    // Clear any existing timer
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
    }
    
    // Start new monitoring interval
    this.checkTimer = setInterval(() => {
      this.checkDrawdown();
    }, this.config.checkInterval * 1000);
    
    this.logger.info(
      `Started drawdown monitoring with ${this.config.checkInterval}s interval ` +
      `and ${this.config.maxDrawdownPct}% threshold`
    );
  }
  
  /**
   * Monitor account equity
   * @param equity Current account equity
   */
  public monitor(equity: number): void {
    if (!this.config.enabled) return;
    
    try {
      // Update equity history
      this.equityHistory.push(equity);
      
      // Update maximum equity
      this.maxEquity = Math.max(this.maxEquity, equity);
      
      // Trim history if needed
      const maxHistorySize = 1000; // Keep last 1000 samples
      if (this.equityHistory.length > maxHistorySize) {
        this.equityHistory.shift();
      }
      
      this.logger.debug(`Updated account equity: ${equity}`);
    } catch (error) {
      this.logger.error(`Error monitoring equity: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Check for drawdown breach
   * @returns Whether drawdown threshold was breached
   */
  public checkDrawdown(): boolean {
    if (!this.config.enabled || this.equityHistory.length === 0) {
      return false;
    }
    
    try {
      const currentEquity = this.equityHistory[this.equityHistory.length - 1];
      
      // Calculate current drawdown
      const drawdownPct = ((this.maxEquity - currentEquity) / this.maxEquity) * 100;
      
      // Check if threshold is breached
      if (drawdownPct > this.config.maxDrawdownPct) {
        this.triggerShutdown(
          `Drawdown threshold breached: ${drawdownPct.toFixed(2)}% > ${this.config.maxDrawdownPct}%`
        );
        return true;
      }
      
      return false;
    } catch (error) {
      this.logger.error(`Error checking drawdown: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
  
  /**
   * Trigger circuit breaker shutdown
   * @param reason Shutdown reason
   */
  private triggerShutdown(reason: string): void {
    if (this.isTriggered) return;
    
    try {
      this.isTriggered = true;
      
      // Create breach event
      const event: DrawdownBreachEvent = {
        currentDrawdownPct: ((this.maxEquity - this.equityHistory[this.equityHistory.length - 1]) / this.maxEquity) * 100,
        thresholdPct: this.config.maxDrawdownPct,
        actionTaken: this.config.actionOnTrigger,
        timestamp: Date.now()
      };
      
      // Log event
      this.logger.warn(
        `Drawdown circuit breaker triggered: ${reason}\n` +
        `Current drawdown: ${event.currentDrawdownPct.toFixed(2)}%\n` +
        `Action taken: ${event.actionTaken}`
      );
      
      // Send alert if webhook is configured
      if (this.config.alertWebhook) {
        this.sendAlert(event);
      }
      
      // Take action based on configuration
      if (this.config.actionOnTrigger === 'shutdown') {
        this.shutdownSystem();
      } else {
        this.pauseSystem();
      }
    } catch (error) {
      this.logger.error(`Error triggering shutdown: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Shutdown the trading system
   */
  private shutdownSystem(): void {
    // TODO: Implement system shutdown logic
    this.logger.error('SYSTEM SHUTDOWN TRIGGERED - All trading halted');
  }
  
  /**
   * Pause the trading system
   */
  private pauseSystem(): void {
    // TODO: Implement system pause logic
    this.logger.warn('SYSTEM PAUSED - Trading suspended until manual resume');
  }
  
  /**
   * Send alert via webhook
   * @param event Breach event
   */
  private async sendAlert(event: DrawdownBreachEvent): Promise<void> {
    if (!this.config.alertWebhook) return;
    
    try {
      const response = await fetch(this.config.alertWebhook, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          event: 'drawdown_breach',
          data: event
        })
      });
      
      if (!response.ok) {
        throw new Error(`Webhook request failed: ${response.statusText}`);
      }
    } catch (error) {
      this.logger.error(`Error sending alert: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Clean up resources
   */
  public destroy(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
    }
  }
} 