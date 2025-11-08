import { Bar, OrderBook, Tick } from '../../backtesting/models/types';
import Ajv from 'ajv';

// Initialize AJV (JSON Schema Validator)
const ajv = new Ajv();

/**
 * Data schemas for validation
 */
const tickSchema = {
  type: 'object',
  required: ['symbol', 'timestamp', 'price', 'volume'],
  properties: {
    symbol: { type: 'string' },
    timestamp: { instanceof: 'Date' },
    price: { type: 'number', minimum: 0 },
    volume: { type: 'number', minimum: 0 },
    side: { type: 'string', enum: ['buy', 'sell'] },
    id: { type: 'string' }
  },
  additionalProperties: false
};

const barSchema = {
  type: 'object',
  required: ['symbol', 'timestamp', 'open', 'high', 'low', 'close', 'volume'],
  properties: {
    symbol: { type: 'string' },
    timestamp: { instanceof: 'Date' },
    open: { type: 'number', minimum: 0 },
    high: { type: 'number', minimum: 0 },
    low: { type: 'number', minimum: 0 },
    close: { type: 'number', minimum: 0 },
    volume: { type: 'number', minimum: 0 }
  },
  additionalProperties: false
};

const orderBookSchema = {
  type: 'object',
  required: ['symbol', 'timestamp', 'bids', 'asks'],
  properties: {
    symbol: { type: 'string' },
    timestamp: { instanceof: 'Date' },
    bids: {
      type: 'array',
      items: {
        type: 'object',
        required: ['price', 'volume'],
        properties: {
          price: { type: 'number', minimum: 0 },
          volume: { type: 'number', minimum: 0 }
        }
      }
    },
    asks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['price', 'volume'],
        properties: {
          price: { type: 'number', minimum: 0 },
          volume: { type: 'number', minimum: 0 }
        }
      }
    }
  },
  additionalProperties: false
};

// Compile validators
const validateTick = ajv.compile(tickSchema);
const validateBar = ajv.compile(barSchema);
const validateOrderBook = ajv.compile(orderBookSchema);

// Add custom format for Date objects
ajv.addKeyword({
  keyword: 'instanceof',
  validate: (schema: string, data: any) => {
    return schema === 'Date' ? data instanceof Date : true;
  }
});

/**
 * Custom error class for invalid market data
 */
export class InvalidMarketDataError extends Error {
  constructor(message: string, public errors?: any[]) {
    super(message);
    this.name = 'InvalidMarketDataError';
  }
}

/**
 * Normalize a crypto symbol to standard format (BTC/USD)
 */
export function normalizeSymbol(symbol: string): string {
  // Common normalization patterns
  
  // Convert BTCUSDT to BTC/USD
  if (symbol.endsWith('USDT')) {
    return symbol.replace(/(\w+)USDT$/, '$1/USD');
  }
  
  // Convert BTC-USD to BTC/USD
  if (symbol.includes('-')) {
    return symbol.replace('-', '/');
  }
  
  // Convert ETHBTC to ETH/BTC
  if (/^[A-Z0-9]{6,8}$/.test(symbol) && !symbol.includes('/')) {
    // Attempt to parse common patterns
    // This is a heuristic and may need adjustments
    if (symbol.endsWith('BTC')) {
      return `${symbol.slice(0, -3)}/BTC`;
    } else if (symbol.endsWith('ETH')) {
      return `${symbol.slice(0, -3)}/ETH`;
    } else if (symbol.endsWith('USD')) {
      return `${symbol.slice(0, -3)}/USD`;
    }
  }
  
  // If already in desired format (e.g., BTC/USD), return as is
  if (symbol.includes('/')) {
    return symbol;
  }
  
  // Default case - can't normalize
  return symbol;
}

/**
 * Normalize timestamps to consistent format
 */
export function normalizeTimestamp(timestamp: number | string | Date): Date {
  if (timestamp instanceof Date) {
    return timestamp;
  }
  
  if (typeof timestamp === 'string') {
    return new Date(timestamp);
  }
  
  // For numeric timestamps, check if milliseconds or seconds
  if (typeof timestamp === 'number') {
    // If timestamp is in seconds (Unix timestamp), convert to ms
    if (timestamp < 10000000000) {
      return new Date(timestamp * 1000);
    } else {
      return new Date(timestamp);
    }
  }
  
  // Default - current time
  return new Date();
}

/**
 * Normalize a market tick
 */
export function normalizeTick(tick: any): Tick {
  if (!tick) {
    throw new InvalidMarketDataError('Tick data is null or undefined');
  }
  
  const normalized: Tick = {
    symbol: normalizeSymbol(tick.symbol || ''),
    timestamp: normalizeTimestamp(tick.timestamp || tick.time || Date.now()),
    price: parseFloat(tick.price || tick.p || '0'),
    volume: parseFloat(tick.volume || tick.quantity || tick.q || tick.size || '0'),
    side: tick.side || tick.S || 'buy',
    id: (tick.id || tick.tradeId || tick.trade_id || Date.now()).toString()
  };
  
  // Validate the normalized tick
  if (!validateTick(normalized)) {
    throw new InvalidMarketDataError(
      `Invalid tick data for ${normalized.symbol}`,
      validateTick.errors
    );
  }
  
  return normalized;
}

/**
 * Normalize a market bar/candle
 */
export function normalizeBar(bar: any): Bar {
  if (!bar) {
    throw new InvalidMarketDataError('Bar data is null or undefined');
  }
  
  const normalized: Bar = {
    symbol: normalizeSymbol(bar.symbol || ''),
    timestamp: normalizeTimestamp(bar.timestamp || bar.time || bar.openTime || Date.now()),
    open: parseFloat(bar.open || bar.o || '0'),
    high: parseFloat(bar.high || bar.h || '0'),
    low: parseFloat(bar.low || bar.l || '0'),
    close: parseFloat(bar.close || bar.c || '0'),
    volume: parseFloat(bar.volume || bar.v || '0')
  };
  
  // Ensure high is the highest value
  normalized.high = Math.max(
    normalized.high,
    normalized.open,
    normalized.close,
    normalized.low
  );
  
  // Ensure low is the lowest value
  normalized.low = Math.min(
    normalized.low,
    normalized.open,
    normalized.close,
    normalized.high
  );
  
  // Validate the normalized bar
  if (!validateBar(normalized)) {
    throw new InvalidMarketDataError(
      `Invalid bar data for ${normalized.symbol}`,
      validateBar.errors
    );
  }
  
  return normalized;
}

/**
 * Normalize an order book
 */
export function normalizeOrderBook(orderBook: any): OrderBook {
  if (!orderBook) {
    throw new InvalidMarketDataError('Order book data is null or undefined');
  }
  
  // Function to normalize order book entries
  const normalizeEntries = (entries: any[]): { price: number; volume: number }[] => {
    return entries.map(entry => {
      // Handle different formats:
      // [price, volume] array format
      if (Array.isArray(entry)) {
        return {
          price: parseFloat(entry[0]),
          volume: parseFloat(entry[1])
        };
      }
      // {price, volume} object format
      else if (typeof entry === 'object') {
        return {
          price: parseFloat(entry.price || entry.p || '0'),
          volume: parseFloat(entry.volume || entry.qty || entry.q || entry.size || '0')
        };
      }
      // Fallback
      return { price: 0, volume: 0 };
    }).filter(entry => entry.price > 0 && entry.volume > 0);
  };
  
  const normalized: OrderBook = {
    symbol: normalizeSymbol(orderBook.symbol || ''),
    timestamp: normalizeTimestamp(orderBook.timestamp || orderBook.time || Date.now()),
    bids: normalizeEntries(orderBook.bids || []),
    asks: normalizeEntries(orderBook.asks || [])
  };
  
  // Sort bids and asks properly (bids descending, asks ascending)
  normalized.bids.sort((a, b) => b.price - a.price);
  normalized.asks.sort((a, b) => a.price - b.price);
  
  // Validate the normalized order book
  if (!validateOrderBook(normalized)) {
    throw new InvalidMarketDataError(
      `Invalid order book data for ${normalized.symbol}`,
      validateOrderBook.errors
    );
  }
  
  return normalized;
}

/**
 * Validate a tick
 */
export function validateTickData(tick: any): boolean {
  return validateTick(tick);
}

/**
 * Validate a bar
 */
export function validateBarData(bar: any): boolean {
  return validateBar(bar);
}

/**
 * Validate an order book
 */
export function validateOrderBookData(orderBook: any): boolean {
  return validateOrderBook(orderBook);
}

/**
 * Get validation errors for last validation
 */
export function getLastValidationErrors(): any[] | undefined {
  return validateTick.errors || validateBar.errors || validateOrderBook.errors;
}

/**
 * Normalize market data based on type
 */
export function normalizeMarketData(data: any, type: 'tick' | 'bar' | 'orderbook'): Tick | Bar | OrderBook {
  switch (type) {
    case 'tick':
      return normalizeTick(data);
    case 'bar':
      return normalizeBar(data);
    case 'orderbook':
      return normalizeOrderBook(data);
    default:
      throw new InvalidMarketDataError(`Unknown market data type: ${type}`);
  }
} 