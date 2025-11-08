import { MarketDataAdapter, MarketDataEvent } from './MarketDataAdapter';
import { MarketDataSource } from '../types/DataSource.types';
import WebSocket from 'ws';

const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws/btcusdt@trade';

export class BinanceMarketDataAdapter extends MarketDataAdapter {
  protected source: MarketDataSource = 'L1_TICK';
  private ws: WebSocket | null = null;

  async connect(): Promise<void> {
    try {
      this.ws = new WebSocket(BINANCE_WS_URL);
      this.ws.on('open', () => {
        console.log('[BinanceMarketDataAdapter] Connected to Binance WebSocket');
      });
      this.ws.on('message', (data: any) => {
        try {
          const raw = JSON.parse(data.toString());
          const event = this.normalize(raw);
          if (this.validate(event)) {
            this.publish(event);
          }
        } catch (err) {
          this.logError('Error processing Binance message', err);
        }
      });
      this.ws.on('error', (err: any) => {
        this.logError('WebSocket error', err);
      });
      this.ws.on('close', () => {
        this.logError('WebSocket closed, attempting reconnect');
        setTimeout(() => this.connect(), 5000);
      });
    } catch (err) {
      this.logError('Failed to connect to Binance WebSocket', err);
    }
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  normalize(raw: any): MarketDataEvent {
    // Binance trade event normalization
    return {
      source: this.source,
      symbol: raw.s,
      timestamp: raw.T,
      data: {
        price: raw.p,
        quantity: raw.q,
        tradeId: raw.t,
        buyer: raw.b,
        seller: raw.a,
        isBuyerMaker: raw.m
      }
    };
  }

  async publish(event: MarketDataEvent): Promise<void> {
    // TODO: Integrate with event bus or downstream consumers
    // For now, just log
    console.log('[BinanceMarketDataAdapter] Publish:', event);
  }
} 