import { 
  Bar, 
  Fill, 
  LogLevel, 
  NotificationLevel, 
  Order, 
  OrderRequest, 
  Position, 
  Timeframe 
} from './types';

/**
 * Interface for filtering orders
 */
export interface OrderFilter {
  symbol?: string;
  status?: string | string[];
}

/**
 * Context provided to strategies during backtesting
 * Provides access to market data, order management, and portfolio information
 */
export interface BacktestContext {
  /**
   * Current simulation time
   */
  readonly currentTime: Date;
  
  /**
   * Data access methods
   */
  getHistoricalBars(symbol: string, timeframe: Timeframe, lookback: number): Promise<Bar[]>;
  getLastBar(symbol: string, timeframe: Timeframe): Promise<Bar | null>;
  getLastPrice(symbol: string): number | null;
  
  /**
   * Order management
   */
  placeOrder(order: OrderRequest): string; // Returns order ID
  cancelOrder(orderId: string): boolean;
  getOrder(orderId: string): Order | null;
  getOrders(filter?: OrderFilter): Order[];
  getOpenOrders(symbol?: string): Order[];
  
  /**
   * Portfolio information
   */
  getPosition(symbol: string): Position | null;
  getAllPositions(): Position[];
  getPortfolioValue(): number;
  getCash(): number;
  
  /**
   * Configuration and parameters
   */
  getParameters(): Map<string, any>;
  
  /**
   * Utilities
   */
  log(message: string, level?: LogLevel): void;
  notify(message: string, importance?: NotificationLevel): void;
}

/**
 * Implementation of BacktestContext for the simulation engine
 */
export class BacktestContextImpl implements BacktestContext {
  private _currentTime: Date;
  private _getHistoricalBarsFn: (symbol: string, timeframe: Timeframe, lookback: number) => Promise<Bar[]>;
  private _getLastBarFn: (symbol: string, timeframe: Timeframe) => Promise<Bar | null>;
  private _getLastPriceFn: (symbol: string) => number | null;
  private _placeOrderFn: (order: OrderRequest) => string;
  private _cancelOrderFn: (orderId: string) => boolean;
  private _getOrderFn: (orderId: string) => Order | null;
  private _getOrdersFn: (filter?: OrderFilter) => Order[];
  private _getOpenOrdersFn: (symbol?: string) => Order[];
  private _getPositionFn: (symbol: string) => Position | null;
  private _getAllPositionsFn: () => Position[];
  private _getPortfolioValueFn: () => number;
  private _getCashFn: () => number;
  private _parameters: Map<string, any>;
  private _logFn: (message: string, level: LogLevel) => void;
  private _notifyFn: (message: string, importance: NotificationLevel) => void;

  constructor(
    currentTime: Date,
    getHistoricalBarsFn: (symbol: string, timeframe: Timeframe, lookback: number) => Promise<Bar[]>,
    getLastBarFn: (symbol: string, timeframe: Timeframe) => Promise<Bar | null>,
    getLastPriceFn: (symbol: string) => number | null,
    placeOrderFn: (order: OrderRequest) => string,
    cancelOrderFn: (orderId: string) => boolean,
    getOrderFn: (orderId: string) => Order | null,
    getOrdersFn: (filter?: OrderFilter) => Order[],
    getOpenOrdersFn: (symbol?: string) => Order[],
    getPositionFn: (symbol: string) => Position | null,
    getAllPositionsFn: () => Position[],
    getPortfolioValueFn: () => number,
    getCashFn: () => number,
    parameters: Map<string, any>,
    logFn: (message: string, level: LogLevel) => void,
    notifyFn: (message: string, importance: NotificationLevel) => void
  ) {
    this._currentTime = currentTime;
    this._getHistoricalBarsFn = getHistoricalBarsFn;
    this._getLastBarFn = getLastBarFn;
    this._getLastPriceFn = getLastPriceFn;
    this._placeOrderFn = placeOrderFn;
    this._cancelOrderFn = cancelOrderFn;
    this._getOrderFn = getOrderFn;
    this._getOrdersFn = getOrdersFn;
    this._getOpenOrdersFn = getOpenOrdersFn;
    this._getPositionFn = getPositionFn;
    this._getAllPositionsFn = getAllPositionsFn;
    this._getPortfolioValueFn = getPortfolioValueFn;
    this._getCashFn = getCashFn;
    this._parameters = parameters;
    this._logFn = logFn;
    this._notifyFn = notifyFn;
  }

  get currentTime(): Date {
    return this._currentTime;
  }

  getHistoricalBars(symbol: string, timeframe: Timeframe, lookback: number): Promise<Bar[]> {
    return this._getHistoricalBarsFn(symbol, timeframe, lookback);
  }

  getLastBar(symbol: string, timeframe: Timeframe): Promise<Bar | null> {
    return this._getLastBarFn(symbol, timeframe);
  }

  getLastPrice(symbol: string): number | null {
    return this._getLastPriceFn(symbol);
  }

  placeOrder(order: OrderRequest): string {
    return this._placeOrderFn(order);
  }

  cancelOrder(orderId: string): boolean {
    return this._cancelOrderFn(orderId);
  }

  getOrder(orderId: string): Order | null {
    return this._getOrderFn(orderId);
  }

  getOrders(filter?: OrderFilter): Order[] {
    return this._getOrdersFn(filter);
  }

  getOpenOrders(symbol?: string): Order[] {
    return this._getOpenOrdersFn(symbol);
  }

  getPosition(symbol: string): Position | null {
    return this._getPositionFn(symbol);
  }

  getAllPositions(): Position[] {
    return this._getAllPositionsFn();
  }

  getPortfolioValue(): number {
    return this._getPortfolioValueFn();
  }

  getCash(): number {
    return this._getCashFn();
  }

  getParameters(): Map<string, any> {
    return this._parameters;
  }

  log(message: string, level: LogLevel = LogLevel.INFO): void {
    this._logFn(message, level);
  }

  notify(message: string, importance: NotificationLevel = NotificationLevel.MEDIUM): void {
    this._notifyFn(message, importance);
  }
  
  /**
   * Update the current time (internal use only)
   */
  updateCurrentTime(time: Date): void {
    this._currentTime = time;
  }
} 