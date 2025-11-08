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
  getHistoricalBars(symbol: string, timeframe: Timeframe, lookback: number): Bar[];
  getLastBar(symbol: string, timeframe: Timeframe): Bar | null;
  getLastPrice(symbol: string): number | null;
  
  /**
   * Order management
   */
  placeOrder(order: OrderRequest): string;
  cancelOrder(orderId: string): boolean;
  getOrder(orderId: string): Order | null;
  getOrders(filter?: OrderFilter): Order[];
  getOpenOrders(symbol?: string): Order[];
  
  /**
   * Portfolio management
   */
  getPosition(symbol: string): Position | null;
  getAllPositions(): Position[];
  getPortfolioValue(): number;
  getCash(): number;
  
  /**
   * Parameters access
   */
  getParameters(): Map<string, any>;
  
  /**
   * Logging and notifications
   */
  log(message: string, level?: LogLevel): void;
  notify(message: string, importance?: NotificationLevel): void;
}

/**
 * Implementation of the BacktestContext interface
 * Used internally by the simulation engine
 */
export class BacktestContextImpl implements BacktestContext {
  private _currentTime: Date;
  private _getHistoricalBars: (symbol: string, timeframe: Timeframe, lookback: number) => Bar[];
  private _getLastBar: (symbol: string, timeframe: Timeframe) => Bar | null;
  private _getLastPrice: (symbol: string) => number | null;
  private _placeOrder: (order: OrderRequest) => string;
  private _cancelOrder: (orderId: string) => boolean;
  private _getOrder: (orderId: string) => Order | null;
  private _getOrders: (filter?: OrderFilter) => Order[];
  private _getOpenOrders: (symbol?: string) => Order[];
  private _getPosition: (symbol: string) => Position | null;
  private _getAllPositions: () => Position[];
  private _getPortfolioValue: () => number;
  private _getCash: () => number;
  private _parameters: Map<string, any>;
  private _log: (message: string, level?: LogLevel) => void;
  private _notify: (message: string, importance?: NotificationLevel) => void;
  
  constructor(
    currentTime: Date,
    getHistoricalBars: (symbol: string, timeframe: Timeframe, lookback: number) => Bar[],
    getLastBar: (symbol: string, timeframe: Timeframe) => Bar | null,
    getLastPrice: (symbol: string) => number | null,
    placeOrder: (order: OrderRequest) => string,
    cancelOrder: (orderId: string) => boolean,
    getOrder: (orderId: string) => Order | null,
    getOrders: (filter?: OrderFilter) => Order[],
    getOpenOrders: (symbol?: string) => Order[],
    getPosition: (symbol: string) => Position | null,
    getAllPositions: () => Position[],
    getPortfolioValue: () => number,
    getCash: () => number,
    parameters: Map<string, any>,
    log: (message: string, level?: LogLevel) => void,
    notify: (message: string, importance?: NotificationLevel) => void
  ) {
    this._currentTime = currentTime;
    this._getHistoricalBars = getHistoricalBars;
    this._getLastBar = getLastBar;
    this._getLastPrice = getLastPrice;
    this._placeOrder = placeOrder;
    this._cancelOrder = cancelOrder;
    this._getOrder = getOrder;
    this._getOrders = getOrders;
    this._getOpenOrders = getOpenOrders;
    this._getPosition = getPosition;
    this._getAllPositions = getAllPositions;
    this._getPortfolioValue = getPortfolioValue;
    this._getCash = getCash;
    this._parameters = parameters;
    this._log = log;
    this._notify = notify;
  }
  
  get currentTime(): Date {
    return new Date(this._currentTime);
  }
  
  getHistoricalBars(symbol: string, timeframe: Timeframe, lookback: number): Bar[] {
    return this._getHistoricalBars(symbol, timeframe, lookback);
  }
  
  getLastBar(symbol: string, timeframe: Timeframe): Bar | null {
    return this._getLastBar(symbol, timeframe);
  }
  
  getLastPrice(symbol: string): number | null {
    return this._getLastPrice(symbol);
  }
  
  placeOrder(order: OrderRequest): string {
    return this._placeOrder(order);
  }
  
  cancelOrder(orderId: string): boolean {
    return this._cancelOrder(orderId);
  }
  
  getOrder(orderId: string): Order | null {
    return this._getOrder(orderId);
  }
  
  getOrders(filter?: OrderFilter): Order[] {
    return this._getOrders(filter);
  }
  
  getOpenOrders(symbol?: string): Order[] {
    return this._getOpenOrders(symbol);
  }
  
  getPosition(symbol: string): Position | null {
    return this._getPosition(symbol);
  }
  
  getAllPositions(): Position[] {
    return this._getAllPositions();
  }
  
  getPortfolioValue(): number {
    return this._getPortfolioValue();
  }
  
  getCash(): number {
    return this._getCash();
  }
  
  getParameters(): Map<string, any> {
    return new Map(this._parameters);
  }
  
  log(message: string, level: LogLevel = LogLevel.INFO): void {
    this._log(message, level);
  }
  
  notify(message: string, importance: NotificationLevel = NotificationLevel.MEDIUM): void {
    this._notify(message, importance);
  }
  
  /**
   * Update the current time (used internally by the simulation engine)
   */
  updateCurrentTime(time: Date): void {
    this._currentTime = new Date(time);
  }
  
  /**
   * Set parameters (used internally by the simulation engine)
   */
  setParameters(parameters: Map<string, any>): void {
    this._parameters = new Map(parameters);
  }
} 