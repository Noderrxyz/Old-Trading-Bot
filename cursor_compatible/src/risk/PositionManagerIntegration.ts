import { PositionManagerRust, OrderSide, OrderOrFill } from './PositionManagerRust';
import { logger } from '../utils/logger';
import { EventEmitter } from 'events';

/**
 * Events emitted by the PositionManagerIntegration
 */
export enum PositionEvents {
  POSITION_UPDATED = 'position_updated',
  LIMIT_EXCEEDED = 'limit_exceeded',
  CASH_BALANCE_LOW = 'cash_balance_low',
  EXPOSURE_HIGH = 'exposure_high',
  PNL_THRESHOLD_REACHED = 'pnl_threshold_reached'
}

/**
 * Integration layer for the PositionManager with other system components
 */
export class PositionManagerIntegration extends EventEmitter {
  private static instance: PositionManagerIntegration;
  private positionManager: PositionManagerRust;
  private priceUpdateInterval: NodeJS.Timeout | null = null;
  private exposureCheckInterval: NodeJS.Timeout | null = null;
  private cashBalanceThreshold = 10000.0; // Alert when cash balance falls below this threshold
  private pnlAlertThreshold = 5000.0; // Alert when PnL exceeds this threshold (positive or negative)
  private symbols = new Set<string>(); // Tracked symbols
  
  private constructor() {
    super();
    this.positionManager = PositionManagerRust.getInstance();
    logger.info('PositionManagerIntegration initialized');
  }
  
  /**
   * Get the singleton instance of PositionManagerIntegration
   */
  public static getInstance(): PositionManagerIntegration {
    if (!PositionManagerIntegration.instance) {
      PositionManagerIntegration.instance = new PositionManagerIntegration();
    }
    return PositionManagerIntegration.instance;
  }
  
  /**
   * Start telemetry and periodic checks
   */
  public start(checkIntervalMs = 5000): void {
    // Start exposure check interval
    if (!this.exposureCheckInterval) {
      this.exposureCheckInterval = setInterval(() => this.checkExposureAndBalances(), checkIntervalMs);
      logger.info(`Started position monitoring with ${checkIntervalMs}ms interval`);
    }
  }
  
  /**
   * Stop telemetry and periodic checks
   */
  public stop(): void {
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = null;
    }
    
    if (this.exposureCheckInterval) {
      clearInterval(this.exposureCheckInterval);
      this.exposureCheckInterval = null;
    }
    
    logger.info('Stopped position monitoring');
  }
  
  /**
   * Handle a new order or fill by updating positions
   */
  public handleOrderOrFill(agentId: string, orderOrFill: OrderOrFill): boolean {
    const symbol = orderOrFill.symbol;
    
    // Add symbol to tracking set
    this.symbols.add(symbol);
    
    // Check if the order would exceed limits
    if (orderOrFill.isFill && 
        this.positionManager.checkLimits(agentId, symbol, orderOrFill.side, orderOrFill.size)) {
      logger.warn(`Position limit would be exceeded for ${agentId} on ${symbol}`);
      this.emit(PositionEvents.LIMIT_EXCEEDED, {
        agentId,
        symbol,
        side: orderOrFill.side,
        size: orderOrFill.size,
        currentPosition: this.positionManager.getSymbolPosition(agentId, symbol)
      });
      
      // We still update the position even if it exceeds limits
      // This approach allows for manual overrides but logs warnings
    }
    
    // Update the position
    const result = this.positionManager.updatePosition(agentId, orderOrFill);
    
    if (result) {
      // Get updated position
      const position = this.positionManager.getSymbolPosition(agentId, symbol);
      
      // Emit position updated event
      this.emit(PositionEvents.POSITION_UPDATED, {
        agentId,
        symbol,
        position
      });
      
      // Check if PnL threshold has been reached
      if (position && 
          (Math.abs(position.realizedPnl) >= this.pnlAlertThreshold || 
           Math.abs(position.unrealizedPnl) >= this.pnlAlertThreshold)) {
        this.emit(PositionEvents.PNL_THRESHOLD_REACHED, {
          agentId,
          symbol,
          realizedPnl: position.realizedPnl,
          unrealizedPnl: position.unrealizedPnl,
          threshold: this.pnlAlertThreshold
        });
      }
    }
    
    return result;
  }
  
  /**
   * Update market price and recalculate unrealized PnL
   */
  public updateMarketPrice(symbol: string, price: number): boolean {
    // Add symbol to tracking set
    this.symbols.add(symbol);
    
    return this.positionManager.updatePrice(symbol, price);
  }
  
  /**
   * Check exposure and cash balances for all agents
   */
  private checkExposureAndBalances(): void {
    try {
      // Get all agents with positions
      const agents = new Set<string>();
      
      // Since we don't have a direct way to get all agents, we check positions for known symbols
      this.symbols.forEach(symbol => {
        // For each symbol, we would need to query all agents
        // This is a simplified implementation
        // In a real system, you'd maintain a list of active agents
        
        // For demo purposes, assume we're tracking a specific set of agents
        ['agent1', 'agent2', 'agent3'].forEach(agentId => {
          const position = this.positionManager.getSymbolPosition(agentId, symbol);
          if (position) {
            agents.add(agentId);
          }
        });
      });
      
      // Check exposure and cash balance for each agent
      agents.forEach(agentId => {
        const exposure = this.positionManager.calculateExposure(agentId);
        const config = this.positionManager.getConfig();
        const agentPosition = this.positionManager.getPosition(agentId);
        
        if (!agentPosition) return;
        
        // Check if exposure is approaching the limit
        if (exposure > config.maxTotalExposure * 0.8) {
          this.emit(PositionEvents.EXPOSURE_HIGH, {
            agentId,
            exposure,
            limit: config.maxTotalExposure
          });
        }
        
        // Check if cash balance is low
        if (agentPosition.cashBalance < this.cashBalanceThreshold) {
          this.emit(PositionEvents.CASH_BALANCE_LOW, {
            agentId,
            cashBalance: agentPosition.cashBalance,
            threshold: this.cashBalanceThreshold
          });
        }
      });
    } catch (error) {
      logger.error('Error checking exposure and balances', error);
    }
  }
  
  /**
   * Set the PnL alert threshold
   */
  public setPnlAlertThreshold(threshold: number): void {
    this.pnlAlertThreshold = threshold;
    logger.info(`PnL alert threshold set to ${threshold}`);
  }
  
  /**
   * Set the cash balance alert threshold
   */
  public setCashBalanceThreshold(threshold: number): void {
    this.cashBalanceThreshold = threshold;
    logger.info(`Cash balance alert threshold set to ${threshold}`);
  }
  
  /**
   * Register for position events
   */
  public onPositionEvent(event: PositionEvents, callback: (data: any) => void): void {
    this.on(event, callback);
  }
}

// Export a singleton instance
export const positionManagerIntegration = PositionManagerIntegration.getInstance(); 