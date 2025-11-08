/**
 * Replay Types
 * 
 * Defines types and interfaces for historical market replay functionality.
 */

export interface ReplayConfig {
    enabled: boolean;
    source: string;
    playbackMode: 'realtime' | 'fastforward' | 'step';
    injectFaults: boolean;
    startTime: number;
    endTime: number;
    checkIntervalMs: number;
    simulationSpeedMultiplier: number;  // 1.0 = real time, 5.0 = 5x faster
    maxInactiveFastForwardSeconds: number;  // Skip ahead if no trades for N seconds
    gasPriceReplayMode: 'live' | 'smoothed';
}

export interface TradeEvent {
    timestamp: number;
    price: number;
    volume: number;
    side: 'buy' | 'sell';
    maker: string;
    taker: string;
    gasPrice: number;
    success: boolean;
    slippage?: number;
    status?: 'success' | 'failed' | 'partial';
    type: 'trade' | 'orderbook_update' | 'gas_price_update';
    data: TradeData | OrderbookUpdate | GasPriceUpdate;
}

export interface ReplayState {
    isRunning: boolean;
    isPaused: boolean;
    currentTime: number;
    startTime: number;
    endTime: number;
    playbackMode: 'realtime' | 'fastforward' | 'step';
    lastEventTime: number;
    speedMultiplier: number;
    eventsProcessed: number;
}

export interface ReplaySummary {
    totalEvents: number;
    totalTrades: number;
    totalOrderbookUpdates: number;
    totalGasPriceUpdates: number;
    startTime: number;
    endTime: number;
    durationMs: number;
    averageEventIntervalMs: number;
    metrics: ReplayMetrics;
    botTrades: BotTrade[];
    executionStats: ExecutionStats;
}

export interface ChaosConfig {
    enabled: boolean;
    networkLatency: {
        min: number;
        max: number;
        probability: number;
    };
    transactionFailure: {
        probability: number;
        maxDelay: number;
    };
    gasSpikes: {
        probability: number;
        multiplier: number;
    };
}

export interface ReplayMetrics {
    totalEvents: number;
    totalTrades: number;
    totalOrderbookUpdates: number;
    totalGasUpdates: number;
    averageEventInterval: number;
    averageGasPrice: number;
    successRate: number;
    averageSlippage: number;
    maxSlippage: number;
    totalVolume: number;
}

export interface BotTrade {
    timestamp: number;
    price: number;
    volume: number;
    side: 'buy' | 'sell';
    botId: string;
    strategyId: string;
    pnl: number;
    status: 'success' | 'failed' | 'partial';
    slippage: number;
    executionTime: number;
    gasUsed: number;
}

export interface TradeData {
    timestamp: number;
    price: number;
    volume: number;
    side: 'buy' | 'sell';
    maker: string;
    taker: string;
    gasPrice: number;
    gasUsed: number;
    slippage?: number;
    status?: 'success' | 'failed' | 'partial';
}

export interface OrderbookUpdate {
    timestamp: number;
    bids: Array<[number, number]>;
    asks: Array<[number, number]>;
    midPrice: number;
    spread: number;
    depth: number;
}

export interface GasPriceUpdate {
    timestamp: number;
    gasPrice: number;
    baseFee: number;
    priorityFee: number;
}

export interface ExecutionStats {
    totalTrades: number;
    totalVolume: number;
    averagePrice: number;
    averageGasPrice: number;
    totalGasUsed: number;
    totalFees: number;
    averageExecutionTimeMs: number;
    successRate: number;
    errorRate: number;
    averageSlippage: number;
    maxDrawdown: number;
    profitFactor: number;
} 