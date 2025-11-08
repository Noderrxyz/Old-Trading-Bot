import { createLogger } from '../common/logger.js';
import {
  Position,
  SpikeCollapseExitEvent,
  UnrealizedPnLProtectorConfig,
  DEFAULT_UNREALIZED_PNL_PROTECTOR_CONFIG
} from './types/unrealized_pnl.types.js';

/**
 * Monitors unrealized PnL and triggers exits on rapid profit collapses
 */
export class LiveUnrealizedPnLProtector {
  private readonly logger = createLogger('LiveUnrealizedPnLProtector');
  
  // Position PnL history
  private readonly pnlHistory: Map<string, { pnl: number; timestamp: number }[]> = new Map();
  
  // Check interval timer
  private checkTimer?: NodeJS.Timeout;
  
  constructor(
    private readonly config: UnrealizedPnLProtectorConfig = DEFAULT_UNREALIZED_PNL_PROTECTOR_CONFIG
  ) {
    if (!config.enabled) {
      this.logger.warn('Unrealized PnL protector is disabled');
    } else {
      this.startMonitoring();
    }
  }
  
  /**
   * Start monitoring positions
   */
  private startMonitoring(): void {
    if (!this.config.enabled) return;
    
    // Clear any existing timer
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
    }
    
    // Start new monitoring interval
    this.checkTimer = setInterval(() => {
      this.checkPositions();
    }, this.config.checkIntervalSec * 1000);
    
    this.logger.info(
      `Started PnL monitoring with ${this.config.checkIntervalSec}s interval, ` +
      `${this.config.spikeDropPct}% drop threshold, and ${this.config.spikeWindowSec}s window`
    );
  }
  
  /**
   * Monitor open positions
   * @param positions List of open positions
   */
  public monitor(positions: Position[]): void {
    if (!this.config.enabled) return;
    
    try {
      for (const position of positions) {
        // Initialize history if needed
        if (!this.pnlHistory.has(position.id)) {
          this.pnlHistory.set(position.id, []);
        }
        
        // Update PnL history
        const history = this.pnlHistory.get(position.id)!;
        history.push({
          pnl: position.unrealizedPnl,
          timestamp: position.timestamp
        });
        
        // Trim history to window size
        const windowMs = this.config.spikeWindowSec * 1000;
        const cutoffTime = position.timestamp - windowMs;
        while (history.length > 0 && history[0].timestamp < cutoffTime) {
          history.shift();
        }
        
        this.logger.debug(
          `Updated PnL for ${position.symbol}: ${position.unrealizedPnl} ` +
          `(history size: ${history.length})`
        );
      }
    } catch (error) {
      this.logger.error(`Error monitoring positions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Check all positions for spike collapses
   */
  private checkPositions(): void {
    if (!this.config.enabled) return;
    
    try {
      for (const [positionId, history] of this.pnlHistory.entries()) {
        if (history.length < 2) continue;
        
        // Find peak PnL in window
        const peakPnl = Math.max(...history.map(h => h.pnl));
        const currentPnl = history[history.length - 1].pnl;
        
        // Calculate drop percentage
        const dropPct = ((peakPnl - currentPnl) / Math.abs(peakPnl)) * 100;
        
        if (dropPct > this.config.spikeDropPct) {
          this.triggerExit({
            id: positionId,
            symbol: '', // Will be filled by the caller
            unrealizedPnl: currentPnl,
            size: 0, // Will be filled by the caller
            side: 'long', // Will be filled by the caller
            entryPrice: 0, // Will be filled by the caller
            currentPrice: 0, // Will be filled by the caller
            timestamp: Date.now()
          }, `PnL spike collapse detected: ${dropPct.toFixed(2)}% drop from peak`);
        }
      }
    } catch (error) {
      this.logger.error(`Error checking positions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Check for spike collapse in a position
   * @param position Position to check
   * @returns Whether spike collapse was detected
   */
  public checkSpikeCollapse(position: Position): boolean {
    if (!this.config.enabled) return false;
    
    try {
      const history = this.pnlHistory.get(position.id);
      if (!history || history.length < 2) return false;
      
      // Find peak PnL in window
      const peakPnl = Math.max(...history.map(h => h.pnl));
      
      // Calculate drop percentage
      const dropPct = ((peakPnl - position.unrealizedPnl) / Math.abs(peakPnl)) * 100;
      
      return dropPct > this.config.spikeDropPct;
    } catch (error) {
      this.logger.error(`Error checking spike collapse: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
  
  /**
   * Trigger position exit
   * @param position Position to exit
   * @param reason Exit reason
   */
  public triggerExit(position: Position, reason: string): void {
    try {
      // Create exit event
      const event: SpikeCollapseExitEvent = {
        positionId: position.id,
        symbol: position.symbol,
        spikeDropPct: this.config.spikeDropPct,
        peakPnl: Math.max(...this.pnlHistory.get(position.id)?.map(h => h.pnl) || [0]),
        currentPnl: position.unrealizedPnl,
        actionTaken: this.config.exitAction,
        timestamp: Date.now()
      };
      
      // Log event
      this.logger.warn(
        `PnL spike collapse exit triggered: ${reason}\n` +
        `Position: ${position.symbol}\n` +
        `Peak PnL: ${event.peakPnl}\n` +
        `Current PnL: ${event.currentPnl}\n` +
        `Action: ${event.actionTaken}`
      );
      
      // Send alert if webhook is configured
      if (this.config.alertWebhook) {
        this.sendAlert(event);
      }
      
      // TODO: Implement actual position exit logic
      this.logger.info(`Would execute ${this.config.exitAction} for ${position.symbol}`);
      
    } catch (error) {
      this.logger.error(`Error triggering exit: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Send alert via webhook
   * @param event Exit event
   */
  private async sendAlert(event: SpikeCollapseExitEvent): Promise<void> {
    if (!this.config.alertWebhook) return;
    
    try {
      const response = await fetch(this.config.alertWebhook, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          event: 'pnl_spike_collapse',
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
    this.pnlHistory.clear();
  }
} 