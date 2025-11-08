import { 
    ReplayConfig, 
    TradeEvent, 
    ReplayState, 
    ReplaySummary, 
    ChaosConfig, 
    ReplayMetrics,
    BotTrade,
    TradeData,
    OrderbookUpdate,
    GasPriceUpdate,
    ExecutionStats
} from './types/replay.types.js';
import logger from '../utils/logger.js';
import { ExecutionTelemetryEngine } from '../telemetry/execution_telemetry_engine.js';
import { SimulationEventType } from './types/simulation.types.js';
import { ReplayEventLoader } from './replay_event_loader.js';

const DEFAULT_CONFIG: ReplayConfig = {
    enabled: true,
    source: 'data/historical_trades/',
    playbackMode: 'realtime',
    injectFaults: false,
    startTime: 0,
    endTime: 0,
    checkIntervalMs: 1000,
    simulationSpeedMultiplier: 1.0,
    maxInactiveFastForwardSeconds: 60,
    gasPriceReplayMode: 'live'
};

const DEFAULT_CHAOS_CONFIG: ChaosConfig = {
    enabled: false,
    networkLatency: {
        min: 100,
        max: 2000,
        probability: 0.1
    },
    transactionFailure: {
        probability: 0.05,
        maxDelay: 5000
    },
    gasSpikes: {
        probability: 0.1,
        multiplier: 2.0
    }
};

export class HistoricalMarketReplayEngine {
    private static instance: HistoricalMarketReplayEngine;
    private config: ReplayConfig;
    private chaosConfig: ChaosConfig;
    private state: ReplayState;
    private events: TradeEvent[] = [];
    private botTrades: BotTrade[] = [];
    private currentEventIndex: number = 0;
    private replayInterval: NodeJS.Timeout | null = null;
    private startTime: number = 0;
    private metrics: ReplayMetrics = {
        totalEvents: 0,
        totalTrades: 0,
        totalOrderbookUpdates: 0,
        totalGasUpdates: 0,
        averageEventInterval: 0,
        averageGasPrice: 0,
        successRate: 0,
        averageSlippage: 0,
        maxSlippage: 0,
        totalVolume: 0
    };
    private eventLoader: ReplayEventLoader;

    private constructor(config: Partial<ReplayConfig> = {}, chaosConfig: Partial<ChaosConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.chaosConfig = { ...DEFAULT_CHAOS_CONFIG, ...chaosConfig };
        this.state = {
            isRunning: false,
            isPaused: false,
            currentTime: 0,
            startTime: 0,
            endTime: 0,
            playbackMode: this.config.playbackMode,
            lastEventTime: 0,
            speedMultiplier: this.config.simulationSpeedMultiplier,
            eventsProcessed: 0
        };
        this.eventLoader = ReplayEventLoader.getInstance();
    }

    public static getInstance(config: Partial<ReplayConfig> = {}, chaosConfig: Partial<ChaosConfig> = {}): HistoricalMarketReplayEngine {
        if (!HistoricalMarketReplayEngine.instance) {
            HistoricalMarketReplayEngine.instance = new HistoricalMarketReplayEngine(config, chaosConfig);
        }
        return HistoricalMarketReplayEngine.instance;
    }

    public async start(): Promise<void> {
        if (this.state.isRunning) {
            logger.warn('Historical Market Replay Engine is already running');
            return;
        }

        try {
            await this.loadEvents();
            this.state.isRunning = true;
            this.startTime = Date.now();
            this.startReplay();
            logger.info('Historical Market Replay Engine started');
        } catch (error) {
            logger.error('Failed to start Historical Market Replay Engine:', error);
            throw error;
        }
    }

    public stop(): void {
        if (!this.state.isRunning) {
            logger.warn('Historical Market Replay Engine is not running');
            return;
        }

        this.state.isRunning = false;
        if (this.replayInterval) {
            clearInterval(this.replayInterval);
            this.replayInterval = null;
        }
        logger.info('Historical Market Replay Engine stopped');
    }

    public pause(): void {
        if (!this.state.isRunning || this.state.isPaused) {
            return;
        }

        this.state.isPaused = true;
        if (this.replayInterval) {
            clearInterval(this.replayInterval);
            this.replayInterval = null;
        }
        logger.info('Historical Market Replay Engine paused');
    }

    public resume(): void {
        if (!this.state.isRunning || !this.state.isPaused) {
            return;
        }

        this.state.isPaused = false;
        this.startReplay();
        logger.info('Historical Market Replay Engine resumed');
    }

    public setSpeedMultiplier(multiplier: number): void {
        this.state.speedMultiplier = multiplier;
        if (this.state.isRunning && !this.state.isPaused) {
            this.pause();
            this.resume();
        }
        logger.info(`Replay speed multiplier set to ${multiplier}x`);
    }

    public getState(): ReplayState {
        return { ...this.state };
    }

    public getSummary(): ReplaySummary {
        return {
            totalEvents: this.metrics.totalEvents,
            totalTrades: this.metrics.totalTrades,
            totalOrderbookUpdates: this.metrics.totalOrderbookUpdates,
            totalGasPriceUpdates: this.metrics.totalGasUpdates,
            startTime: this.startTime,
            endTime: Date.now(),
            durationMs: Date.now() - this.startTime,
            averageEventIntervalMs: this.metrics.averageEventInterval,
            metrics: this.metrics,
            botTrades: this.botTrades,
            executionStats: this.calculateExecutionStats()
        };
    }

    private async loadEvents(): Promise<void> {
        try {
            this.events = await this.eventLoader.loadEvents(this.config.source);
            this.metrics.totalEvents = this.events.length;
            
            if (this.events.length > 0) {
                this.state.startTime = this.events[0].timestamp;
                this.state.endTime = this.events[this.events.length - 1].timestamp;
                
                // Calculate average event interval
                const intervals = [];
                for (let i = 1; i < this.events.length; i++) {
                    intervals.push(this.events[i].timestamp - this.events[i - 1].timestamp);
                }
                this.metrics.averageEventInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
            }
            
            logger.info(`Loaded ${this.events.length} events from ${this.config.source}`);
        } catch (error) {
            logger.error('Failed to load events:', error);
            throw error;
        }
    }

    private startReplay(): void {
        const interval = Math.floor(1000 / this.state.speedMultiplier);
        this.replayInterval = setInterval(() => this.processNextEvent(), interval);
    }

    private processNextEvent(): void {
        if (this.currentEventIndex >= this.events.length) {
            this.stop();
            return;
        }

        const event = this.events[this.currentEventIndex];
        this.state.currentTime = event.timestamp;
        this.state.lastEventTime = event.timestamp;
        this.state.eventsProcessed++;

        // Apply chaos if enabled
        if (this.chaosConfig.enabled) {
            this.injectChaos(event);
        }

        // Process the event
        this.processEvent(event);

        // Emit progress
        if (this.state.eventsProcessed % 100 === 0) {
            const progress = (this.state.eventsProcessed / this.events.length) * 100;
            ExecutionTelemetryEngine.getInstance().emitSimulationEvent({
                type: SimulationEventType.MonteCarloProgress,
                progress,
                currentSimulation: this.state.eventsProcessed,
                totalSimulations: this.events.length
            });
        }

        this.currentEventIndex++;
    }

    private processEvent(event: TradeEvent): void {
        switch (event.type) {
            case 'trade':
                this.processTrade(event.data as TradeData);
                break;
            case 'orderbook_update':
                this.processOrderbookUpdate(event.data as OrderbookUpdate);
                break;
            case 'gas_price_update':
                this.processGasPriceUpdate(event.data as GasPriceUpdate);
                break;
        }
    }

    private processTrade(trade: TradeData): void {
        this.metrics.totalTrades++;
        this.metrics.totalVolume += trade.volume;
        this.metrics.averageGasPrice = (this.metrics.averageGasPrice * (this.metrics.totalTrades - 1) + trade.gasPrice) / this.metrics.totalTrades;
        
        if (trade.slippage) {
            this.metrics.averageSlippage = (this.metrics.averageSlippage * (this.metrics.totalTrades - 1) + trade.slippage) / this.metrics.totalTrades;
            this.metrics.maxSlippage = Math.max(this.metrics.maxSlippage, trade.slippage);
        }

        if (trade.status === 'success') {
            this.metrics.successRate = (this.metrics.successRate * (this.metrics.totalTrades - 1) + 1) / this.metrics.totalTrades;
        }
    }

    private processOrderbookUpdate(update: OrderbookUpdate): void {
        this.metrics.totalOrderbookUpdates++;
        // TODO: Update orderbook state
    }

    private processGasPriceUpdate(update: GasPriceUpdate): void {
        this.metrics.totalGasUpdates++;
        // TODO: Update gas price state
    }

    private injectChaos(event: TradeEvent): void {
        if (Math.random() < this.chaosConfig.networkLatency.probability) {
            const latency = Math.random() * (this.chaosConfig.networkLatency.max - this.chaosConfig.networkLatency.min) + this.chaosConfig.networkLatency.min;
            // TODO: Apply network latency
        }

        if (event.type === 'trade' && Math.random() < this.chaosConfig.transactionFailure.probability) {
            (event.data as TradeData).status = 'failed';
        }

        if (event.type === 'gas_price_update' && Math.random() < this.chaosConfig.gasSpikes.probability) {
            (event.data as GasPriceUpdate).gasPrice *= this.chaosConfig.gasSpikes.multiplier;
        }
    }

    private calculateExecutionStats(): ExecutionStats {
        const successfulTrades = this.botTrades.filter(t => t.status === 'success');
        const totalVolume = successfulTrades.reduce((sum, t) => sum + t.volume, 0);
        const totalValue = successfulTrades.reduce((sum, t) => sum + t.price * t.volume, 0);

        return {
            totalTrades: this.botTrades.length,
            totalVolume,
            averagePrice: totalValue / totalVolume,
            averageGasPrice: successfulTrades.reduce((sum, t) => sum + t.gasUsed, 0) / successfulTrades.length,
            totalGasUsed: successfulTrades.reduce((sum, t) => sum + t.gasUsed, 0),
            totalFees: successfulTrades.reduce((sum, t) => sum + t.gasUsed * t.price, 0),
            averageExecutionTimeMs: successfulTrades.reduce((sum, t) => sum + t.executionTime, 0) / successfulTrades.length,
            successRate: successfulTrades.length / this.botTrades.length,
            errorRate: 1 - (successfulTrades.length / this.botTrades.length),
            averageSlippage: this.botTrades.reduce((sum, t) => sum + t.slippage, 0) / this.botTrades.length,
            maxDrawdown: this.calculateMaxDrawdown(),
            profitFactor: this.calculateProfitFactor()
        };
    }

    private calculateMaxDrawdown(): number {
        let peak = 0;
        let maxDrawdown = 0;
        let currentValue = 0;

        for (const trade of this.botTrades) {
            currentValue += trade.side === 'buy' ? -trade.price * trade.volume : trade.price * trade.volume;
            if (currentValue > peak) {
                peak = currentValue;
            }
            const drawdown = (peak - currentValue) / peak;
            maxDrawdown = Math.max(maxDrawdown, drawdown);
        }

        return maxDrawdown;
    }

    private calculateProfitFactor(): number {
        const profits = this.botTrades
            .filter(t => t.status === 'success')
            .map(t => t.side === 'buy' ? -t.price * t.volume : t.price * t.volume);

        const totalProfit = profits.filter(p => p > 0).reduce((sum, p) => sum + p, 0);
        const totalLoss = Math.abs(profits.filter(p => p < 0).reduce((sum, p) => sum + p, 0));

        return totalLoss === 0 ? Infinity : totalProfit / totalLoss;
    }
} 