import { Order, OrderSide, OrderType, TimeInForce } from '../order';
import { Position, PositionDirection } from '../../types/position';
import { Signal } from '../../strategy/AdaptiveStrategy';
import { MarketRegime } from '../../regime/RegimeClassifier';

/**
 * Paper trading configuration
 */
export interface PaperTradingConfig {
  /**
   * Initial cash balance for the account
   */
  initialBalance: number;
  
  /**
   * Default commission rate as percentage (0-100)
   */
  defaultCommissionRate: number;
  
  /**
   * Commission rates per venue (exchange)
   */
  commissionRates: Record<string, number>;
  
  /**
   * Default slippage model
   */
  defaultSlippageModel: SlippageModel;
  
  /**
   * Slippage models per venue (exchange)
   */
  slippageModels: Record<string, SlippageModel>;
  
  /**
   * Default execution latency in milliseconds
   */
  defaultLatencyMs: number;
  
  /**
   * Enforce realistic constraints like limit price and available liquidity
   */
  enforceRealisticConstraints: boolean;
  
  /**
   * Maximum position size as percentage of account balance
   */
  maxPositionSizePercent: number;
  
  /**
   * Maximum leverage allowed
   */
  maxLeverage: number;
  
  /**
   * Order fill probability (0-1), used for simulating partial fills
   */
  orderFillProbability: number;
  
  /**
   * Random seed for reproducible simulations
   */
  randomSeed?: number;
  
  /**
   * Whether to log detailed execution information
   */
  verboseLogging: boolean;
  
  /**
   * Enforce market hours (if applicable)
   */
  enforceMarketHours: boolean;
  
  /**
   * Market hours by symbol (if enforceMarketHours is true)
   */
  marketHours?: Record<string, MarketHours>;
}

/**
 * Market hours configuration
 */
export interface MarketHours {
  timezone: string;
  openHour: number;
  openMinute: number;
  closeHour: number;
  closeMinute: number;
  tradingDays: number[]; // 0 = Sunday, 1 = Monday, etc.
}

/**
 * Slippage model for simulating realistic execution
 */
export enum SlippageModel {
  // Fixed percentage slippage
  Fixed = 'fixed',
  
  // Slippage based on order size (larger orders = more slippage)
  SizeDependent = 'size_dependent',
  
  // Slippage based on market volatility
  VolatilityBased = 'volatility_based',
  
  // Slippage based on order book depth (if available)
  OrderBookBased = 'order_book_based',
  
  // Custom slippage model
  Custom = 'custom',
  
  // No slippage
  None = 'none'
}

/**
 * Order status enum
 */
export enum OrderStatus {
  Created = 'created',
  Submitted = 'submitted',
  PartiallyFilled = 'partially_filled',
  Filled = 'filled',
  Canceled = 'canceled',
  Rejected = 'rejected',
  Expired = 'expired'
}

/**
 * Paper order model extending the base order with paper trading specific fields
 */
export interface PaperOrder extends Order {
  /**
   * Current status of the order
   */
  status: OrderStatus;
  
  /**
   * Creation timestamp
   */
  createdAt: Date;
  
  /**
   * Last update timestamp
   */
  updatedAt: Date;
  
  /**
   * Filled amount
   */
  filledAmount: number;
  
  /**
   * Average fill price
   */
  avgFillPrice: number;
  
  /**
   * Remaining amount to fill
   */
  remainingAmount: number;
  
  /**
   * Commission paid
   */
  commission: number;
  
  /**
   * Slippage experienced
   */
  slippage: number;
  
  /**
   * Related signal ID
   */
  signalId?: string;
  
  /**
   * Related position ID
   */
  positionId?: string;
  
  /**
   * Market regime at execution time
   */
  marketRegime?: MarketRegime;
  
  /**
   * Execution latency in milliseconds
   */
  executionLatencyMs?: number;
  
  /**
   * Fill history for partial fills
   */
  fills: OrderFill[];
}

/**
 * Order fill details
 */
export interface OrderFill {
  /**
   * Fill ID
   */
  id: string;
  
  /**
   * Order ID
   */
  orderId: string;
  
  /**
   * Fill timestamp
   */
  timestamp: Date;
  
  /**
   * Filled amount
   */
  amount: number;
  
  /**
   * Fill price
   */
  price: number;
  
  /**
   * Fee paid for this fill
   */
  fee: number;
}

/**
 * Paper trading execution report
 */
export interface ExecutionReport {
  /**
   * Order that was executed
   */
  order: PaperOrder | null;
  
  /**
   * Position after execution
   */
  position: Position | null;
  
  /**
   * Account balance after execution
   */
  balance: number;
  
  /**
   * Account value (balance + position values)
   */
  accountValue: number;
  
  /**
   * Profit/loss from this execution
   */
  pnl: number;
  
  /**
   * True if this is a simulation
   */
  isSimulation: boolean;
  
  /**
   * Signal that triggered this execution
   */
  signal?: Signal;
  
  /**
   * Timestamp of the execution
   */
  timestamp: Date;
  
  /**
   * Any warnings or informational messages
   */
  messages: string[];
}

/**
 * Position update event
 */
export interface PositionUpdateEvent {
  /**
   * Position ID
   */
  positionId: string;
  
  /**
   * Position details
   */
  position: Position;
  
  /**
   * Update type
   */
  updateType: 'open' | 'update' | 'close';
  
  /**
   * Related order
   */
  order?: PaperOrder | null;
  
  /**
   * Timestamp of the update
   */
  timestamp: Date;
}

/**
 * Portfolio snapshot
 */
export interface PortfolioSnapshot {
  /**
   * Timestamp of the snapshot
   */
  timestamp: Date;
  
  /**
   * Cash balance
   */
  cashBalance: number;
  
  /**
   * Open positions
   */
  positions: Position[];
  
  /**
   * Open orders
   */
  openOrders: PaperOrder[];
  
  /**
   * Portfolio value (cash + positions)
   */
  portfolioValue: number;
  
  /**
   * Day's profit/loss
   */
  dayPnl: number;
  
  /**
   * Total profit/loss
   */
  totalPnl: number;
}

/**
 * Default paper trading configuration
 */
export const DEFAULT_PAPER_TRADING_CONFIG: PaperTradingConfig = {
  initialBalance: 10000,
  defaultCommissionRate: 0.1, // 0.1%
  commissionRates: {
    'binance': 0.1,
    'coinbase': 0.5,
    'kraken': 0.26
  },
  defaultSlippageModel: SlippageModel.SizeDependent,
  slippageModels: {
    'binance': SlippageModel.OrderBookBased,
    'coinbase': SlippageModel.SizeDependent,
    'kraken': SlippageModel.VolatilityBased
  },
  defaultLatencyMs: 250,
  enforceRealisticConstraints: true,
  maxPositionSizePercent: 20,
  maxLeverage: 3,
  orderFillProbability: 0.95,
  verboseLogging: true,
  enforceMarketHours: false
}; 