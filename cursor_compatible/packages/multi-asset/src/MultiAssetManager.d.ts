import { EventEmitter } from 'events';
import * as winston from 'winston';
export declare enum AssetClass {
    CRYPTO = "CRYPTO",
    EQUITY = "EQUITY",
    FOREX = "FOREX",
    COMMODITY = "COMMODITY",
    FIXED_INCOME = "FIXED_INCOME",
    DERIVATIVE = "DERIVATIVE"
}
export interface AssetDefinition {
    symbol: string;
    name: string;
    assetClass: AssetClass;
    exchange: string;
    baseCurrency?: string;
    quoteCurrency?: string;
    contractSize: number;
    tickSize: number;
    minOrderSize: number;
    maxOrderSize: number;
    marginRequirement: number;
    tradingHours: TradingHours;
    metadata: Record<string, any>;
}
export interface TradingHours {
    timezone: string;
    sessions: TradingSession[];
    holidays: string[];
}
export interface TradingSession {
    day: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
    open: string;
    close: string;
    break?: {
        start: string;
        end: string;
    };
}
export interface MarketData {
    symbol: string;
    timestamp: Date;
    bid: number;
    ask: number;
    last: number;
    volume: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    vwap?: number;
    metadata?: Record<string, any>;
}
export interface OrderRequest {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    orderType: OrderType;
    price?: number;
    stopPrice?: number;
    timeInForce: TimeInForce;
    metadata?: Record<string, any>;
}
export declare enum OrderType {
    MARKET = "MARKET",
    LIMIT = "LIMIT",
    STOP = "STOP",
    STOP_LIMIT = "STOP_LIMIT",
    TRAILING_STOP = "TRAILING_STOP",
    ICEBERG = "ICEBERG"
}
export declare enum TimeInForce {
    GTC = "GTC",// Good Till Cancelled
    IOC = "IOC",// Immediate or Cancel
    FOK = "FOK",// Fill or Kill
    GTD = "GTD",// Good Till Date
    DAY = "DAY",// Day Order
    GTX = "GTX"
}
export interface AssetAdapter {
    assetClass: AssetClass;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    subscribe(symbols: string[]): Promise<void>;
    unsubscribe(symbols: string[]): Promise<void>;
    placeOrder(order: OrderRequest): Promise<string>;
    cancelOrder(orderId: string): Promise<void>;
    getOrderStatus(orderId: string): Promise<any>;
    getPositions(): Promise<Map<string, any>>;
    getBalance(): Promise<any>;
}
export declare class MultiAssetManager extends EventEmitter {
    private logger;
    private assets;
    private adapters;
    private marketData;
    private subscriptions;
    private unifiedOrderBook;
    constructor(logger: winston.Logger);
    initialize(): Promise<void>;
    registerAsset(asset: AssetDefinition): Promise<void>;
    registerAdapter(adapter: AssetAdapter): Promise<void>;
    subscribe(symbols: string[]): Promise<void>;
    unsubscribe(symbols: string[]): Promise<void>;
    placeOrder(order: OrderRequest): Promise<string>;
    cancelOrder(orderId: string, symbol: string): Promise<void>;
    getMarketData(symbol: string): MarketData | undefined;
    getAssetDefinition(symbol: string): AssetDefinition | undefined;
    isMarketOpen(asset: AssetDefinition): boolean;
    getUnifiedPositions(): Promise<Map<string, UnifiedPosition>>;
    getUnifiedBalance(): Promise<UnifiedBalance>;
    private validateAssetDefinition;
    private validateOrder;
    private normalizeOrder;
    private setupAdapterHandlers;
    private simulateMarketData;
    private loadAssetDefinitions;
    private initializeAdapters;
    private convertToTimezone;
    private get247Sessions;
    private getUSEquitySession;
    private getForexSessions;
    private getUSHolidays;
}
interface UnifiedPosition {
    symbol: string;
    assetClass: AssetClass;
    quantity: number;
    averagePrice: number;
    currentPrice: number;
    unrealizedPnl: number;
    realizedPnl: number;
    value: number;
    marginUsed: number;
}
interface UnifiedBalance {
    totalEquity: number;
    totalCash: number;
    totalMarginUsed: number;
    totalUnrealizedPnl: number;
    byAssetClass: Map<AssetClass, AssetClassBalance>;
    byCurrency: Map<string, number>;
}
interface AssetClassBalance {
    equity: number;
    cash: number;
    marginUsed: number;
    unrealizedPnl: number;
}
export {};
//# sourceMappingURL=MultiAssetManager.d.ts.map