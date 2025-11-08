/**
 * Order side enum (buy or sell)
 */
export enum OrderSide {
  Buy = 'buy',
  Sell = 'sell',
}

/**
 * Order type enum
 */
export enum OrderType {
  Market = 'market',
  Limit = 'limit',
  StopLoss = 'stop_loss',
  TakeProfit = 'take_profit',
  TrailingStop = 'trailing_stop',
}

/**
 * Time in force enum
 */
export enum TimeInForce {
  GoodTilCancelled = 'GTC',
  ImmediateOrCancel = 'IOC',
  FillOrKill = 'FOK',
  GoodTilDate = 'GTD',
}

/**
 * Order model for execution
 */
export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  type?: OrderType;
  amount: number;
  price: number;
  venues: string[];
  maxSlippage?: number;
  maxRetries?: number;
  timeInForce?: TimeInForce;
  expireTime?: Date;
  additionalParams?: Record<string, any>;
} 