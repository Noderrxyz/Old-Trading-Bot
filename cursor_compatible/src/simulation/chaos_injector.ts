/**
 * Chaos Injector
 * 
 * Injects chaotic conditions during simulations to test system resilience.
 * Focuses on gas spikes, oracle delays, and chain congestion.
 */

import logger from '../utils/logger.js';
import { ExecutionTelemetryEngine } from '../telemetry/execution_telemetry_engine.js';
import { MarketMetrics } from '../market/types/market.types.js';
import { SimulationEventType } from './types/simulation.types.js';

/**
 * Configuration for chaos injector
 */
export interface ChaosInjectorConfig {
    enabled: boolean;
    gasSpike: {
        probability: number;
        minMultiplier: number;
        maxMultiplier: number;
        durationMs: number;
    };
    oracleDelay: {
        probability: number;
        minDelayMs: number;
        maxDelayMs: number;
    };
    chainCongestion: {
        probability: number;
        minDelayMs: number;
        maxDelayMs: number;
        dropProbability: number;
    };
    checkIntervalMs: number;
}

const DEFAULT_CONFIG: ChaosInjectorConfig = {
    enabled: true,
    gasSpike: {
        probability: 0.01,
        minMultiplier: 2.0,
        maxMultiplier: 10.0,
        durationMs: 60000 // 1 minute
    },
    oracleDelay: {
        probability: 0.005,
        minDelayMs: 1000,
        maxDelayMs: 10000
    },
    chainCongestion: {
        probability: 0.01,
        minDelayMs: 2000,
        maxDelayMs: 30000,
        dropProbability: 0.1
    },
    checkIntervalMs: 1000
};

/**
 * Chaos event metrics
 */
interface ChaosMetrics {
    gasSpikes: {
        count: number;
        totalGasCost: number;
        skippedTrades: number;
        maxMultiplier: number;
    };
    oracleDelays: {
        count: number;
        totalDelayMs: number;
        staleTrades: number;
        maxDelayMs: number;
    };
    chainCongestion: {
        count: number;
        totalDelayMs: number;
        droppedTrades: number;
        maxDelayMs: number;
    };
    startTime: number;
    endTime: number;
}

/**
 * Chaos event
 */
interface ChaosEvent {
    type: 'GAS_SPIKE' | 'ORACLE_DELAY' | 'CHAIN_CONGESTION';
    severity: number;
    durationMs: number;
    startTime: number;
    endTime: number;
    params: Record<string, any>;
}

export class ChaosInjector {
    private static instance: ChaosInjector | null = null;
    private config: ChaosInjectorConfig;
    private metrics: ChaosMetrics;
    private activeEvents: ChaosEvent[] = [];
    private checkInterval: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;

    private constructor(config: Partial<ChaosInjectorConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.metrics = {
            gasSpikes: {
                count: 0,
                totalGasCost: 0,
                skippedTrades: 0,
                maxMultiplier: 0
            },
            oracleDelays: {
                count: 0,
                totalDelayMs: 0,
                staleTrades: 0,
                maxDelayMs: 0
            },
            chainCongestion: {
                count: 0,
                totalDelayMs: 0,
                droppedTrades: 0,
                maxDelayMs: 0
            },
            startTime: 0,
            endTime: 0
        };
    }

    public static getInstance(config: Partial<ChaosInjectorConfig> = {}): ChaosInjector {
        if (!ChaosInjector.instance) {
            ChaosInjector.instance = new ChaosInjector(config);
        }
        return ChaosInjector.instance;
    }

    public start(): void {
        if (this.isRunning) {
            logger.warn('Chaos injector is already running');
            return;
        }

        this.isRunning = true;
        this.metrics.startTime = Date.now();
        this.checkInterval = setInterval(() => this.checkForNewEvents(), this.config.checkIntervalMs);
        logger.info('Chaos injector started');
    }

    public stop(): void {
        if (!this.isRunning) {
            logger.warn('Chaos injector is not running');
            return;
        }

        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }

        this.isRunning = false;
        this.metrics.endTime = Date.now();
        logger.info('Chaos injector stopped');
    }

    public getMetrics(): ChaosMetrics {
        return this.metrics;
    }

    public getActiveEvents(): ChaosEvent[] {
        return this.activeEvents;
    }

    public shouldSkipTrade(gasPrice: number): boolean {
        const activeGasSpike = this.activeEvents.find(
            event => event.type === 'GAS_SPIKE' && event.endTime > Date.now()
        );

        if (activeGasSpike) {
            const multiplier = activeGasSpike.params.multiplier as number;
            const threshold = gasPrice * multiplier;
            this.metrics.gasSpikes.skippedTrades++;
            return true;
        }

        return false;
    }

    public getOracleDelay(): number {
        const activeDelay = this.activeEvents.find(
            event => event.type === 'ORACLE_DELAY' && event.endTime > Date.now()
        );

        if (activeDelay) {
            this.metrics.oracleDelays.staleTrades++;
            return activeDelay.params.delayMs as number;
        }

        return 0;
    }

    public shouldDropTransaction(): boolean {
        const activeCongestion = this.activeEvents.find(
            event => event.type === 'CHAIN_CONGESTION' && event.endTime > Date.now()
        );

        if (activeCongestion) {
            if (Math.random() < this.config.chainCongestion.dropProbability) {
                this.metrics.chainCongestion.droppedTrades++;
                return true;
            }
        }

        return false;
    }

    private checkForNewEvents(): void {
        const now = Date.now();

        // Clean up expired events
        this.activeEvents = this.activeEvents.filter(event => event.endTime > now);

        // Check for new gas spike
        if (Math.random() < this.config.gasSpike.probability) {
            this.triggerGasSpike();
        }

        // Check for new oracle delay
        if (Math.random() < this.config.oracleDelay.probability) {
            this.triggerOracleDelay();
        }

        // Check for new chain congestion
        if (Math.random() < this.config.chainCongestion.probability) {
            this.triggerChainCongestion();
        }
    }

    private triggerGasSpike(): void {
        const multiplier = Math.random() * 
            (this.config.gasSpike.maxMultiplier - this.config.gasSpike.minMultiplier) + 
            this.config.gasSpike.minMultiplier;

        const event: ChaosEvent = {
            type: 'GAS_SPIKE',
            severity: multiplier,
            durationMs: this.config.gasSpike.durationMs,
            startTime: Date.now(),
            endTime: Date.now() + this.config.gasSpike.durationMs,
            params: { multiplier },
        };

        this.activeEvents.push(event);
        this.metrics.gasSpikes.count++;
        this.metrics.gasSpikes.maxMultiplier = Math.max(
            this.metrics.gasSpikes.maxMultiplier,
            multiplier
        );

        ExecutionTelemetryEngine.getInstance().emitSimulationEvent({
            type: SimulationEventType.ChaosEvent,
            eventType: 'gas_spike',
            severity: multiplier,
            durationMs: this.config.gasSpike.durationMs,
            timestamp: Date.now()
        });

        logger.warn(`Gas spike triggered: ${multiplier}x multiplier for ${this.config.gasSpike.durationMs}ms`);
    }

    private triggerOracleDelay(): void {
        const delayMs = Math.floor(
            Math.random() * (this.config.oracleDelay.maxDelayMs - this.config.oracleDelay.minDelayMs) +
            this.config.oracleDelay.minDelayMs
        );

        const event: ChaosEvent = {
            type: 'ORACLE_DELAY',
            severity: delayMs / this.config.oracleDelay.maxDelayMs,
            durationMs: delayMs,
            startTime: Date.now(),
            endTime: Date.now() + delayMs,
            params: { delayMs },
        };

        this.activeEvents.push(event);
        this.metrics.oracleDelays.count++;
        this.metrics.oracleDelays.totalDelayMs += delayMs;
        this.metrics.oracleDelays.maxDelayMs = Math.max(
            this.metrics.oracleDelays.maxDelayMs,
            delayMs
        );

        ExecutionTelemetryEngine.getInstance().emitSimulationEvent({
            type: SimulationEventType.ChaosEvent,
            eventType: 'oracle_delay',
            severity: delayMs / this.config.oracleDelay.maxDelayMs,
            durationMs: delayMs,
            timestamp: Date.now()
        });

        logger.warn(`Oracle delay triggered: ${delayMs}ms delay`);
    }

    private triggerChainCongestion(): void {
        const delayMs = Math.floor(
            Math.random() * (this.config.chainCongestion.maxDelayMs - this.config.chainCongestion.minDelayMs) +
            this.config.chainCongestion.minDelayMs
        );

        const event: ChaosEvent = {
            type: 'CHAIN_CONGESTION',
            severity: delayMs / this.config.chainCongestion.maxDelayMs,
            durationMs: delayMs,
            startTime: Date.now(),
            endTime: Date.now() + delayMs,
            params: { delayMs },
        };

        this.activeEvents.push(event);
        this.metrics.chainCongestion.count++;
        this.metrics.chainCongestion.totalDelayMs += delayMs;
        this.metrics.chainCongestion.maxDelayMs = Math.max(
            this.metrics.chainCongestion.maxDelayMs,
            delayMs
        );

        ExecutionTelemetryEngine.getInstance().emitSimulationEvent({
            type: SimulationEventType.ChaosEvent,
            eventType: 'chain_congestion',
            severity: delayMs / this.config.chainCongestion.maxDelayMs,
            durationMs: delayMs,
            timestamp: Date.now()
        });

        logger.warn(`Chain congestion triggered: ${delayMs}ms delay`);
    }
} 