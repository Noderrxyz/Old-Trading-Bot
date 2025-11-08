// DataSource.types.ts
// Canonical inventory of all required data sources and types for Noderr

export type MarketDataSource =
  | 'L1_TICK'           // Trades, quotes, best bid/ask, last price, volume
  | 'L2_ORDERBOOK'      // Full order book depth, snapshots
  | 'HISTORICAL'        // OHLCV, tick-by-tick, aggregated intervals
  | 'ALTERNATIVE';      // On-chain analytics, sentiment, news, funding rates

export type OperationalDataSource =
  | 'TRADES'            // Executed trades, fills, slippage
  | 'ORDERS'            // Order lifecycle events
  | 'POSITIONS'         // Real-time and historical positions
  | 'PNL';              // Realized/unrealized P&L, fees

export type ConfigDataSource =
  | 'STRATEGY_CONFIG'   // Strategy parameters, risk settings
  | 'RISK_CONFIG'       // Risk settings
  | 'TRADING_HOURS'     // Trading hours
  | 'WHITELIST'         // Whitelists/blacklists
  | 'BLACKLIST';

export type UserDataSource =
  | 'USER_PROFILE'      // User profiles
  | 'API_KEYS'          // API keys
  | 'PERMISSIONS'       // Permissions
  | 'AUDIT_LOGS';       // Audit logs

export interface DataSourceInventory {
  market: MarketDataSource[];
  operational: OperationalDataSource[];
  config: ConfigDataSource[];
  user: UserDataSource[];
}

export const DATA_SOURCE_INVENTORY: DataSourceInventory = {
  market: ['L1_TICK', 'L2_ORDERBOOK', 'HISTORICAL', 'ALTERNATIVE'],
  operational: ['TRADES', 'ORDERS', 'POSITIONS', 'PNL'],
  config: ['STRATEGY_CONFIG', 'RISK_CONFIG', 'TRADING_HOURS', 'WHITELIST', 'BLACKLIST'],
  user: ['USER_PROFILE', 'API_KEYS', 'PERMISSIONS', 'AUDIT_LOGS'],
}; 