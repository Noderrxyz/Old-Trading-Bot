import { MarketDataSource } from '../types/DataSource.types';

export interface MarketDataEvent {
  source: MarketDataSource;
  symbol: string;
  timestamp: number;
  data: any; // To be replaced with canonical schema
}

export abstract class MarketDataAdapter {
  protected abstract source: MarketDataSource;

  /** Connect to the data source (WebSocket, REST, etc.) */
  abstract connect(): Promise<void>;

  /** Disconnect from the data source */
  abstract disconnect(): Promise<void>;

  /** Normalize provider-specific data to canonical schema */
  abstract normalize(raw: any): MarketDataEvent;

  /** Validate normalized data */
  validate(event: MarketDataEvent): boolean {
    // Basic validation: type, timestamp, symbol, data presence
    if (!event || !event.source || !event.symbol || !event.timestamp || !event.data) {
      this.logError('Invalid market data event structure', event);
      return false;
    }
    // TODO: Add more schema checks
    return true;
  }

  /** Publish validated data to downstream consumers */
  abstract publish(event: MarketDataEvent): Promise<void>;

  /** Handle errors robustly */
  protected logError(msg: string, data?: any) {
    // Replace with production logger
    // eslint-disable-next-line no-console
    console.error(`[MarketDataAdapter][${this.source}] ${msg}`, data);
  }
} 