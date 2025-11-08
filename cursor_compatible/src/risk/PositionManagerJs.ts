import { logger } from '../utils/logger';
import {
  OrderSide,
  OrderOrFill,
  SymbolPosition,
  AgentPosition,
  PositionManagerConfig,
  DEFAULT_POSITION_MANAGER_CONFIG
} from './PositionManagerRust';

/**
 * JavaScript fallback implementation for the Position Manager
 * Used when the native Rust implementation is unavailable
 */
export class PositionManagerJs {
  private config: PositionManagerConfig;
  private positions: Map<string, AgentPosition> = new Map();
  private prices: Map<string, number> = new Map();

  /**
   * Create a new PositionManagerJs
   * @param config Configuration
   */
  constructor(config: Partial<PositionManagerConfig> = {}) {
    this.config = {
      ...DEFAULT_POSITION_MANAGER_CONFIG,
      ...config
    };
    logger.info('PositionManagerJs initialized with config:', this.config);
  }

  /**
   * Update position with a new order or fill
   * @param agentId Agent identifier
   * @param order Order or fill data
   * @returns True if successful
   */
  public updatePosition(agentId: string, order: OrderOrFill): boolean {
    try {
      // Validate order data
      if (order.size <= 0) {
        logger.error('Order size must be positive');
        return false;
      }

      if (order.price <= 0) {
        logger.error('Order price must be positive');
        return false;
      }

      // Update current price
      this.prices.set(order.symbol, order.price);

      // Get or create agent position
      const agentPosition = this.getOrCreateAgentPosition(agentId);

      // Get or create symbol position
      let symbolPosition = agentPosition.positions[order.symbol];
      if (!symbolPosition) {
        symbolPosition = this.createSymbolPosition(order.symbol);
        agentPosition.positions[order.symbol] = symbolPosition;
      }

      // Update position
      if (order.isFill) {
        // Remove from open orders if this is a fill for an existing order
        if (order.fillId) {
          delete symbolPosition.openOrders[order.fillId];
        }

        // Update position size and average price
        const oldPositionValue = symbolPosition.netSize * symbolPosition.averagePrice;
        const tradeValue = order.size * order.price;

        if (order.side === OrderSide.Buy) {
          // Buying increases position
          const newSize = symbolPosition.netSize + order.size;

          // Calculate new average price (weighted)
          if (newSize > 0) {
            symbolPosition.averagePrice = (oldPositionValue + tradeValue) / newSize;
          }

          symbolPosition.netSize = newSize;
        } else {
          // Selling decreases position
          const oldSize = symbolPosition.netSize;
          const newSize = oldSize - order.size;

          // Calculate realized P&L if reducing or closing position
          if (oldSize > 0 && order.size > 0) {
            const sizeClosed = newSize < 0 ? oldSize : order.size;
            symbolPosition.realizedPnl += sizeClosed * (order.price - symbolPosition.averagePrice);
          }

          // If crossing from long to short, reset average price
          if (oldSize > 0 && newSize < 0) {
            symbolPosition.averagePrice = order.price;
          } else if (newSize < 0) {
            // For short positions, calculate new average price
            const shortValue = oldSize < 0 ? oldPositionValue : 0;
            symbolPosition.averagePrice = (shortValue - tradeValue) / newSize;
          }

          symbolPosition.netSize = newSize;
        }

        // Add to fills history
        symbolPosition.fills.push({ ...order });

        // Keep only the last 100 fills
        if (symbolPosition.fills.length > 100) {
          symbolPosition.fills = symbolPosition.fills.slice(-100);
        }

        // Update cash balance
        if (order.side === OrderSide.Buy) {
          // Buying decreases cash
          agentPosition.cashBalance -= order.size * order.price;
        } else {
          // Selling increases cash
          agentPosition.cashBalance += order.size * order.price;
        }
      } else {
        // This is an open order - add to open orders
        symbolPosition.openOrders[order.orderId] = { ...order };
      }

      // Update timestamps
      symbolPosition.lastUpdate = Date.now();
      agentPosition.lastUpdate = Date.now();

      return true;
    } catch (error) {
      logger.error(`Error updating position: ${error}`);
      return false;
    }
  }

  /**
   * Calculate exposure for an agent
   * @param agentId Agent identifier
   * @returns Total exposure or -1 if calculation failed
   */
  public calculateExposure(agentId: string): number {
    try {
      const agentPosition = this.positions.get(agentId);
      if (!agentPosition) {
        return 0; // No position yet
      }

      let totalExposure = 0;

      for (const [symbol, position] of Object.entries(agentPosition.positions)) {
        const price = this.prices.get(symbol) || position.averagePrice;
        totalExposure += Math.abs(position.netSize) * price;
      }

      return totalExposure;
    } catch (error) {
      logger.error(`Error calculating exposure: ${error}`);
      return -1;
    }
  }

  /**
   * Check if a new position would exceed limits
   * @param agentId Agent identifier
   * @param symbol Symbol/ticker
   * @param side Order side (buy/sell)
   * @param size Order size
   * @returns True if limits would be exceeded
   */
  public checkLimits(agentId: string, symbol: string, side: OrderSide, size: number): boolean {
    try {
      const agentPosition = this.positions.get(agentId);
      if (!agentPosition) {
        // No position yet, just check against symbol limit
        const symbolLimit = this.config.maxPositionPerSymbol[symbol] || this.config.defaultMaxPosition;
        return size > symbolLimit;
      }

      const symbolPosition = agentPosition.positions[symbol];
      const symbolLimit = this.config.maxPositionPerSymbol[symbol] || this.config.defaultMaxPosition;

      // Calculate new position size
      let newSize: number;
      if (!symbolPosition) {
        newSize = side === OrderSide.Buy ? size : -size;
      } else {
        newSize = side === OrderSide.Buy
          ? symbolPosition.netSize + size
          : symbolPosition.netSize - size;
      }

      // Check symbol limit
      if (Math.abs(newSize) > symbolLimit) {
        return true; // Exceeds symbol limit
      }

      // Check total exposure limit
      const price = this.prices.get(symbol) || (symbolPosition?.averagePrice || 0);
      if (price <= 0) {
        logger.warn(`No price data for ${symbol}`);
        return true; // Safety first
      }

      // Calculate new total exposure
      let newTotalExposure = 0;
      for (const [sym, pos] of Object.entries(agentPosition.positions)) {
        if (sym === symbol) {
          newTotalExposure += Math.abs(newSize) * price;
        } else {
          const symPrice = this.prices.get(sym) || pos.averagePrice;
          newTotalExposure += Math.abs(pos.netSize) * symPrice;
        }
      }

      // If symbol is not in current positions, add it
      if (!symbolPosition) {
        newTotalExposure += Math.abs(newSize) * price;
      }

      return newTotalExposure > this.config.maxTotalExposure;
    } catch (error) {
      logger.error(`Error checking limits: ${error}`);
      return true; // Safety first
    }
  }

  /**
   * Update price for a symbol
   * @param symbol Symbol/ticker
   * @param price Current price
   * @returns True if successful
   */
  public updatePrice(symbol: string, price: number): boolean {
    try {
      if (price <= 0) {
        logger.error('Price must be positive');
        return false;
      }

      this.prices.set(symbol, price);

      // Update unrealized P&L for all positions with this symbol
      for (const agentPosition of this.positions.values()) {
        const symbolPosition = agentPosition.positions[symbol];
        if (symbolPosition) {
          this.updateUnrealizedPnl(symbolPosition, price);
        }
      }

      return true;
    } catch (error) {
      logger.error(`Error updating price: ${error}`);
      return false;
    }
  }

  /**
   * Get position for a specific symbol
   * @param agentId Agent identifier
   * @param symbol Symbol/ticker
   * @returns Symbol position or null if not found
   */
  public getSymbolPosition(agentId: string, symbol: string): SymbolPosition | null {
    try {
      const agentPosition = this.positions.get(agentId);
      if (!agentPosition) {
        return null;
      }

      const symbolPosition = agentPosition.positions[symbol];
      if (!symbolPosition) {
        return null;
      }

      // Update unrealized P&L
      const price = this.prices.get(symbol) || symbolPosition.averagePrice;
      this.updateUnrealizedPnl(symbolPosition, price);

      return { ...symbolPosition };
    } catch (error) {
      logger.error(`Error getting symbol position: ${error}`);
      return null;
    }
  }

  /**
   * Get position for an agent
   * @param agentId Agent identifier
   * @returns Agent position or null if not found
   */
  public getPosition(agentId: string): AgentPosition | null {
    try {
      const agentPosition = this.positions.get(agentId);
      if (!agentPosition) {
        return null;
      }

      // Update unrealized P&L for all symbols
      for (const [symbol, position] of Object.entries(agentPosition.positions)) {
        const price = this.prices.get(symbol) || position.averagePrice;
        this.updateUnrealizedPnl(position, price);
      }

      return { ...agentPosition };
    } catch (error) {
      logger.error(`Error getting agent position: ${error}`);
      return null;
    }
  }

  /**
   * Update configuration
   * @param configOverride Partial configuration to update
   */
  public updateConfig(configOverride: Partial<PositionManagerConfig>): void {
    this.config = {
      ...this.config,
      ...configOverride
    };
    logger.info('PositionManagerJs config updated:', this.config);
  }

  /**
   * Get current configuration
   * @returns Current configuration
   */
  public getConfig(): PositionManagerConfig {
    return { ...this.config };
  }

  /**
   * Calculate unrealized P&L based on current market price
   * @param position Symbol position
   * @param currentPrice Current market price
   */
  private updateUnrealizedPnl(position: SymbolPosition, currentPrice: number): void {
    if (position.netSize === 0) {
      position.unrealizedPnl = 0;
      return;
    }

    if (position.netSize > 0) {
      // Long position
      position.unrealizedPnl = position.netSize * (currentPrice - position.averagePrice);
    } else {
      // Short position
      position.unrealizedPnl = -position.netSize * (position.averagePrice - currentPrice);
    }
  }

  /**
   * Get or create agent position
   * @param agentId Agent identifier
   * @returns Agent position
   */
  private getOrCreateAgentPosition(agentId: string): AgentPosition {
    let agentPosition = this.positions.get(agentId);
    if (!agentPosition) {
      agentPosition = {
        agentId,
        cashBalance: this.config.initialCashBalance,
        lastUpdate: Date.now(),
        positions: {}
      };
      this.positions.set(agentId, agentPosition);
    }
    return agentPosition;
  }

  /**
   * Create a new symbol position
   * @param symbol Symbol/ticker
   * @returns Symbol position
   */
  private createSymbolPosition(symbol: string): SymbolPosition {
    return {
      symbol,
      netSize: 0,
      averagePrice: 0,
      unrealizedPnl: 0,
      realizedPnl: 0,
      lastUpdate: Date.now(),
      openOrders: {},
      fills: []
    };
  }
} 