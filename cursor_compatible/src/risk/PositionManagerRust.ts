import { logger } from '../utils/logger';
import { FALLBACK_ENABLED } from '../utils/constants';
import { PositionManagerJs } from './PositionManagerJs';
import { telemetry } from '../telemetry';
import { SeverityLevel } from '../telemetry/Telemetry';
import { TraceFunctions } from '../telemetry/middleware/ExecutionTrace';

/**
 * Order or fill side
 */
export enum OrderSide {
  Buy = 0,
  Sell = 1
}

/**
 * Order or fill data
 */
export interface OrderOrFill {
  /** Symbol/ticker of the instrument */
  symbol: string;
  /** Buy or sell */
  side: OrderSide;
  /** Size/quantity of the order */
  size: number;
  /** Price of the order */
  price: number;
  /** Timestamp in milliseconds */
  timestamp: number;
  /** Unique order ID */
  orderId: string;
  /** Fill ID if this is a fill of an existing order */
  fillId?: string;
  /** Whether this is a fill (execution) or just an open order */
  isFill: boolean;
  /** Trading venue */
  venue?: string;
  /** Strategy that generated this order */
  strategyId?: string;
}

/**
 * Position for a specific symbol
 */
export interface SymbolPosition {
  /** Symbol/ticker of the instrument */
  symbol: string;
  /** Net position size (positive for long, negative for short) */
  netSize: number;
  /** Average entry price */
  averagePrice: number;
  /** Unrealized profit and loss */
  unrealizedPnl: number;
  /** Realized profit and loss */
  realizedPnl: number;
  /** Last update timestamp */
  lastUpdate: number;
  /** Open orders for this symbol */
  openOrders: Record<string, OrderOrFill>;
  /** Recent fills for this symbol */
  fills: OrderOrFill[];
}

/**
 * Position for an agent (trader/strategy)
 */
export interface AgentPosition {
  /** Agent identifier */
  agentId: string;
  /** Cash balance */
  cashBalance: number;
  /** Last update timestamp */
  lastUpdate: number;
  /** Positions by symbol */
  positions: Record<string, SymbolPosition>;
}

/**
 * Position manager configuration
 */
export interface PositionManagerConfig {
  /** Maximum position size per symbol */
  maxPositionPerSymbol: Record<string, number>;
  /** Default maximum position size for symbols not explicitly set */
  defaultMaxPosition: number;
  /** Maximum total exposure across all positions */
  maxTotalExposure: number;
  /** Initial cash balance for new agents */
  initialCashBalance: number;
}

/**
 * Default position manager configuration
 */
export const DEFAULT_POSITION_MANAGER_CONFIG: PositionManagerConfig = {
  maxPositionPerSymbol: {},
  defaultMaxPosition: 10.0,
  maxTotalExposure: 100.0,
  initialCashBalance: 1000.0
};

/**
 * Position Manager - TypeScript wrapper for the Rust native implementation
 * with JavaScript fallback implementation
 */
export class PositionManagerRust {
  private static instance: PositionManagerRust | null = null;
  private nativeManager: any = null; // Using 'any' to avoid NapiPositionManager import errors
  private fallbackManager: PositionManagerJs | null = null;
  private usingFallback = false;

  /**
   * Get singleton instance of PositionManagerRust
   * @param config Optional configuration
   * @param forceRefresh Force creation of a new instance
   * @returns The singleton instance
   */
  public static getInstance(
    config?: Partial<PositionManagerConfig>,
    forceRefresh = false
  ): PositionManagerRust {
    return TraceFunctions.traceSync<PositionManagerRust>(
      'PositionManager',
      'getInstance',
      () => {
        if (!this.instance || forceRefresh) {
          this.instance = new PositionManagerRust(config);
        } else if (config) {
          // Update config if provided
          this.instance.updateConfig(config);
        }
        return this.instance;
      },
      {
        category: 'initialization',
        tags: { singleton: 'true' }
      }
    );
  }

  /**
   * Private constructor - use getInstance() instead
   * @param configOverride Optional configuration override
   */
  private constructor(configOverride?: Partial<PositionManagerConfig>) {
    // Initialize with default config and override with provided values
    const config = {
      ...DEFAULT_POSITION_MANAGER_CONFIG,
      ...configOverride
    };

    // Initialize the native Rust implementation
    try {
      // Using dynamic import to avoid direct reference to NapiPositionManager
      this.nativeManager = new (require('@noderr/core').NapiPositionManager)();
      
      // Set configuration
      this.nativeManager.update_config({
        max_position_per_symbol: JSON.stringify(config.maxPositionPerSymbol),
        default_max_position: config.defaultMaxPosition,
        max_total_exposure: config.maxTotalExposure,
        initial_cash_balance: config.initialCashBalance
      });
      
      logger.info('Initialized native Rust PositionManager');
      telemetry.recordMetric('position_manager.initialization', 1, {
        implementation: 'rust',
        success: 'true'
      });
    } catch (error) {
      logger.error(`Failed to initialize native PositionManager: ${error}`);
      telemetry.recordError('position_manager.initialization.failed', error as Error, SeverityLevel.ERROR, {
        implementation: 'rust'
      });
      this.nativeManager = null;
    }

    // Initialize the JavaScript fallback if needed
    if (this.nativeManager === null || FALLBACK_ENABLED) {
      try {
        this.fallbackManager = new PositionManagerJs(config);
        logger.info('Initialized JavaScript fallback PositionManager');
        telemetry.recordMetric('position_manager.initialization', 1, {
          implementation: 'javascript',
          success: 'true',
          fallback: (this.nativeManager === null).toString()
        });
      } catch (error) {
        logger.error(`Failed to initialize fallback PositionManager: ${error}`);
        telemetry.recordError('position_manager.initialization.failed', error as Error, SeverityLevel.ERROR, {
          implementation: 'javascript'
        });
        this.fallbackManager = null;
      }
    }

    // Throw error if both implementations failed
    if (this.nativeManager === null && this.fallbackManager === null) {
      const error = new Error('Failed to initialize both native and fallback PositionManager');
      telemetry.recordError('position_manager.initialization.failed.both', error, SeverityLevel.CRITICAL);
      throw error;
    }

    // Set using fallback flag
    this.usingFallback = this.nativeManager === null;
  }

  /**
   * Update position with a new order or fill
   * @param agentId Agent identifier
   * @param order Order or fill data
   * @returns True if successful
   */
  public updatePosition(agentId: string, order: OrderOrFill): boolean {
    return TraceFunctions.traceSync<boolean>(
      'PositionManager', 
      'updatePosition',
      () => {
        try {
          const success = this.tryNativeOrFallback<boolean>(
            () => {
              this.nativeManager!.update_position(agentId, {
                symbol: order.symbol,
                side: order.side,
                size: order.size,
                price: order.price,
                timestamp: order.timestamp,
                order_id: order.orderId,
                fill_id: order.fillId,
                is_fill: order.isFill,
                venue: order.venue,
                strategy_id: order.strategyId
              });
              return true;
            },
            () => this.fallbackManager!.updatePosition(agentId, order)
          );

          // Record metrics for position updates
          telemetry.recordMetric('position_manager.update', 1, {
            agent: agentId,
            symbol: order.symbol,
            side: order.side === OrderSide.Buy ? 'buy' : 'sell',
            is_fill: order.isFill.toString(),
            success: success.toString(),
            fallback: this.usingFallback.toString()
          });

          if (order.isFill) {
            telemetry.recordMetric('position_manager.fill', order.size, {
              agent: agentId,
              symbol: order.symbol,
              side: order.side === OrderSide.Buy ? 'buy' : 'sell',
              price: order.price.toString()
            });
          }

          return success;
        } catch (error) {
          logger.error(`Error updating position: ${error}`);
          telemetry.recordError('position_manager.update.failed', error as Error, SeverityLevel.ERROR, {
            agent: agentId,
            symbol: order.symbol,
            side: order.side === OrderSide.Buy ? 'buy' : 'sell',
            is_fill: order.isFill.toString()
          });
          return false;
        }
      },
      {
        category: 'update',
        tags: { agent: agentId, symbol: order.symbol }
      }
    );
  }

  /**
   * Calculate exposure for an agent
   * @param agentId Agent identifier
   * @returns Total exposure or -1 if calculation failed
   */
  public calculateExposure(agentId: string): number {
    return TraceFunctions.traceSync<number>(
      'PositionManager',
      'calculateExposure',
      () => {
        try {
          const exposure = this.tryNativeOrFallback<number>(
            () => this.nativeManager!.calculate_exposure(agentId),
            () => this.fallbackManager!.calculateExposure(agentId)
          );

          // Record metric for exposure
          telemetry.recordMetric('position_manager.exposure', exposure, {
            agent: agentId,
            fallback: this.usingFallback.toString()
          });

          return exposure;
        } catch (error) {
          logger.error(`Error calculating exposure: ${error}`);
          telemetry.recordError('position_manager.exposure.failed', error as Error, SeverityLevel.ERROR, {
            agent: agentId
          });
          return -1;
        }
      },
      {
        category: 'exposure',
        tags: { agent: agentId }
      }
    );
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
    return TraceFunctions.traceSync<boolean>(
      'PositionManager',
      'checkLimits',
      () => {
        try {
          const limitsExceeded = this.tryNativeOrFallback<boolean>(
            () => this.nativeManager!.check_limits(agentId, symbol, side, size),
            () => this.fallbackManager!.checkLimits(agentId, symbol, side, size)
          );

          // Record metric for limit checks
          telemetry.recordMetric('position_manager.limits_check', 1, {
            agent: agentId,
            symbol: symbol,
            side: side === OrderSide.Buy ? 'buy' : 'sell',
            exceeded: limitsExceeded.toString(),
            fallback: this.usingFallback.toString()
          });

          return limitsExceeded;
        } catch (error) {
          logger.error(`Error checking limits: ${error}`);
          telemetry.recordError('position_manager.limits_check.failed', error as Error, SeverityLevel.ERROR, {
            agent: agentId,
            symbol: symbol
          });
          // If we can't check limits, assume they would be exceeded (safety first)
          return true;
        }
      },
      {
        category: 'limits',
        tags: { agent: agentId, symbol: symbol }
      }
    );
  }

  /**
   * Update price for a symbol
   * @param symbol Symbol/ticker
   * @param price Current price
   * @returns True if successful
   */
  public updatePrice(symbol: string, price: number): boolean {
    return TraceFunctions.traceSync<boolean>(
      'PositionManager',
      'updatePrice',
      () => {
        try {
          const success = this.tryNativeOrFallback<boolean>(
            () => {
              this.nativeManager!.update_price(symbol, price);
              return true;
            },
            () => this.fallbackManager!.updatePrice(symbol, price)
          );

          // Record metric for price updates
          telemetry.recordMetric('position_manager.price_update', 1, {
            symbol: symbol,
            price: price.toString(),
            success: success.toString(),
            fallback: this.usingFallback.toString()
          });

          return success;
        } catch (error) {
          logger.error(`Error updating price: ${error}`);
          telemetry.recordError('position_manager.price_update.failed', error as Error, SeverityLevel.ERROR, {
            symbol: symbol,
            price: price.toString()
          });
          return false;
        }
      },
      {
        category: 'price',
        tags: { symbol: symbol }
      }
    );
  }

  /**
   * Get position for a specific symbol
   * @param agentId Agent identifier
   * @param symbol Symbol/ticker
   * @returns Symbol position or null if not found
   */
  public getSymbolPosition(agentId: string, symbol: string): SymbolPosition | null {
    return TraceFunctions.traceSync<SymbolPosition | null>(
      'PositionManager',
      'getSymbolPosition',
      () => {
        try {
          const position = this.tryNativeOrFallback<SymbolPosition | null>(
            () => {
              const positionParams = this.nativeManager!.get_symbol_position(agentId, symbol);
              
              // Parse JSON strings
              const openOrders = JSON.parse(positionParams.open_orders);
              const fills = JSON.parse(positionParams.fills);
              
              return {
                symbol: positionParams.symbol,
                netSize: positionParams.net_size,
                averagePrice: positionParams.average_price,
                unrealizedPnl: positionParams.unrealized_pnl,
                realizedPnl: positionParams.realized_pnl,
                lastUpdate: positionParams.last_update,
                openOrders: this.convertOpenOrders(openOrders),
                fills: this.convertFills(fills)
              };
            },
            () => this.fallbackManager!.getSymbolPosition(agentId, symbol)
          );

          // Record metric for position retrieval
          telemetry.recordMetric('position_manager.get_symbol_position', 1, {
            agent: agentId,
            symbol: symbol,
            found: (position !== null).toString(),
            fallback: this.usingFallback.toString()
          });

          if (position) {
            telemetry.recordMetric('position_manager.position_size', position.netSize, {
              agent: agentId,
              symbol: symbol,
              avg_price: position.averagePrice.toString()
            });
          }

          return position;
        } catch (error) {
          logger.error(`Error getting symbol position: ${error}`);
          telemetry.recordError('position_manager.get_symbol_position.failed', error as Error, SeverityLevel.ERROR, {
            agent: agentId,
            symbol: symbol
          });
          return null;
        }
      },
      {
        category: 'query',
        tags: { agent: agentId, symbol: symbol }
      }
    );
  }

  /**
   * Get position for an agent
   * @param agentId Agent identifier
   * @returns Agent position or null if not found
   */
  public getPosition(agentId: string): AgentPosition | null {
    return TraceFunctions.traceSync<AgentPosition | null>(
      'PositionManager',
      'getPosition',
      () => {
        try {
          const position = this.tryNativeOrFallback<AgentPosition | null>(
            () => {
              const positionParams = this.nativeManager!.get_position(agentId);
              
              // Parse JSON string
              const positions = JSON.parse(positionParams.positions);
              
              return {
                agentId: positionParams.agent_id,
                cashBalance: positionParams.cash_balance,
                lastUpdate: positionParams.last_update,
                positions: this.convertPositions(positions)
              };
            },
            () => this.fallbackManager!.getPosition(agentId)
          );

          // Record metric for agent position retrieval
          telemetry.recordMetric('position_manager.get_agent_position', 1, {
            agent: agentId,
            found: (position !== null).toString(),
            fallback: this.usingFallback.toString()
          });

          if (position) {
            telemetry.recordMetric('position_manager.cash_balance', position.cashBalance, {
              agent: agentId
            });
            
            const symbolCount = Object.keys(position.positions).length;
            telemetry.recordMetric('position_manager.symbol_count', symbolCount, {
              agent: agentId
            });
          }

          return position;
        } catch (error) {
          logger.error(`Error getting agent position: ${error}`);
          telemetry.recordError('position_manager.get_agent_position.failed', error as Error, SeverityLevel.ERROR, {
            agent: agentId
          });
          return null;
        }
      },
      {
        category: 'query',
        tags: { agent: agentId }
      }
    );
  }

  /**
   * Update configuration
   * @param configOverride Partial configuration to update
   */
  public updateConfig(configOverride: Partial<PositionManagerConfig>): void {
    TraceFunctions.traceSync<void>(
      'PositionManager',
      'updateConfig',
      () => {
        try {
          // Get current config
          const currentConfig = this.getConfig();
          
          // Merge with overrides
          const newConfig = {
            ...currentConfig,
            ...configOverride
          };
          
          // Update in native implementation
          if (this.nativeManager) {
            this.nativeManager.update_config({
              max_position_per_symbol: JSON.stringify(newConfig.maxPositionPerSymbol),
              default_max_position: newConfig.defaultMaxPosition,
              max_total_exposure: newConfig.maxTotalExposure,
              initial_cash_balance: newConfig.initialCashBalance
            });
          }
          
          // Update in fallback implementation
          if (this.fallbackManager) {
            this.fallbackManager.updateConfig(newConfig);
          }

          // Record config update metric
          telemetry.recordMetric('position_manager.config_update', 1, {
            max_total_exposure: newConfig.maxTotalExposure.toString(),
            default_max_position: newConfig.defaultMaxPosition.toString(),
            success: 'true',
            fallback: this.usingFallback.toString()
          });
        } catch (error) {
          logger.error(`Error updating config: ${error}`);
          telemetry.recordError('position_manager.config_update.failed', error as Error, SeverityLevel.ERROR);
        }
      },
      {
        category: 'configuration'
      }
    );
  }

  /**
   * Get current configuration
   * @returns Current configuration
   */
  public getConfig(): PositionManagerConfig {
    return TraceFunctions.traceSync<PositionManagerConfig>(
      'PositionManager',
      'getConfig',
      () => {
        try {
          const config = this.tryNativeOrFallback<PositionManagerConfig>(
            () => {
              const configParams = this.nativeManager!.get_config();
              
              return {
                maxPositionPerSymbol: JSON.parse(configParams.max_position_per_symbol),
                defaultMaxPosition: configParams.default_max_position,
                maxTotalExposure: configParams.max_total_exposure,
                initialCashBalance: configParams.initial_cash_balance
              };
            },
            () => this.fallbackManager!.getConfig()
          );

          // Record metric for config retrieval
          telemetry.recordMetric('position_manager.get_config', 1, {
            fallback: this.usingFallback.toString()
          });

          return config;
        } catch (error) {
          logger.error(`Error getting config: ${error}`);
          telemetry.recordError('position_manager.get_config.failed', error as Error, SeverityLevel.ERROR);
          return DEFAULT_POSITION_MANAGER_CONFIG;
        }
      },
      {
        category: 'configuration'
      }
    );
  }

  /**
   * Check if using fallback implementation
   * @returns True if using JavaScript fallback
   */
  public isUsingFallback(): boolean {
    return this.usingFallback;
  }

  /**
   * Convert open orders from Rust format to TypeScript format
   * @param openOrders Open orders from Rust
   * @returns Converted open orders
   */
  private convertOpenOrders(openOrders: Record<string, any>): Record<string, OrderOrFill> {
    const result: Record<string, OrderOrFill> = {};
    
    for (const [orderId, order] of Object.entries(openOrders)) {
      result[orderId] = this.convertOrderOrFill(order);
    }
    
    return result;
  }

  /**
   * Convert fills from Rust format to TypeScript format
   * @param fills Fills from Rust
   * @returns Converted fills
   */
  private convertFills(fills: any[]): OrderOrFill[] {
    return fills.map(fill => this.convertOrderOrFill(fill));
  }

  /**
   * Convert positions from Rust format to TypeScript format
   * @param positions Positions from Rust
   * @returns Converted positions
   */
  private convertPositions(positions: Record<string, any>): Record<string, SymbolPosition> {
    const result: Record<string, SymbolPosition> = {};
    
    for (const [symbol, position] of Object.entries(positions)) {
      result[symbol] = {
        symbol: position.symbol,
        netSize: position.net_size,
        averagePrice: position.average_price,
        unrealizedPnl: position.unrealized_pnl,
        realizedPnl: position.realized_pnl,
        lastUpdate: new Date(position.last_update).getTime(),
        openOrders: this.convertOpenOrders(position.open_orders),
        fills: this.convertFills(position.fills)
      };
    }
    
    return result;
  }

  /**
   * Convert order/fill from Rust format to TypeScript format
   * @param order Order or fill from Rust
   * @returns Converted order or fill
   */
  private convertOrderOrFill(order: any): OrderOrFill {
    return {
      symbol: order.symbol,
      side: order.side === 0 ? OrderSide.Buy : OrderSide.Sell,
      size: order.size,
      price: order.price,
      timestamp: new Date(order.timestamp).getTime(),
      orderId: order.order_id,
      fillId: order.fill_id,
      isFill: order.is_fill,
      venue: order.venue,
      strategyId: order.strategy_id
    };
  }

  /**
   * Try to use native implementation, fall back to JavaScript if needed
   * @param nativeImpl Function to call for native implementation
   * @param fallbackImpl Function to call for fallback implementation
   * @returns Result from either implementation
   */
  private tryNativeOrFallback<T>(nativeImpl: () => T, fallbackImpl: () => T): T {
    // If we know we're using fallback, skip trying native
    if (this.usingFallback) {
      return fallbackImpl();
    }
    
    // Try native implementation first
    try {
      if (this.nativeManager) {
        return nativeImpl();
      }
    } catch (error) {
      logger.warn(`Native implementation failed, falling back to JavaScript: ${error}`);
      telemetry.recordError('position_manager.native_fallback', error as Error, SeverityLevel.WARNING);
      this.usingFallback = true;
    }
    
    // Fall back to JavaScript implementation
    if (this.fallbackManager) {
      return fallbackImpl();
    }
    
    // No implementation available
    const error = new Error('Both native and fallback implementations failed');
    telemetry.recordError('position_manager.implementation.failed.both', error, SeverityLevel.CRITICAL);
    throw error;
  }
} 