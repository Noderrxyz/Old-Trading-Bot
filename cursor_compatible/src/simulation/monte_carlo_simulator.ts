/**
 * Monte Carlo Simulator
 * 
 * Generates simulated price paths using various statistical models
 * and analyzes strategy performance across simulations.
 */

import { 
    MonteCarloConfig, 
    SimulationResult, 
    AggregateStats, 
    MarketState, 
    RiskProfile,
    SimulationReport,
    SimulationEventType
} from './types/monte_carlo.types.js';
import logger from '../utils/logger.js';
import { ExecutionTelemetryEngine } from '../telemetry/execution_telemetry_engine.js';
import { HistoricalMarketReplayEngine } from './historical_market_replay_engine.js';

const DEFAULT_CONFIG: MonteCarloConfig = {
    enabled: true,
    numSimulations: 1000,
    initialPrice: 1000,
    drift: 0.0001,
    volatility: 0.02,
    garchAlpha: 0.1,
    garchBeta: 0.85,
    garchOmega: 0.0001,
    gasSpikeProbability: 0.01,
    gasSpikeMultiplier: 2.0,
    oracleLagProbability: 0.005,
    oracleLagMs: 1000,
    orderbookThinningProbability: 0.01,
    orderbookThinningFactor: 0.5,
    batchSize: 100
};

export class MonteCarloSimulator {
    private static instance: MonteCarloSimulator;
    private config: MonteCarloConfig;
    private results: SimulationResult[] = [];
    private isRunning: boolean = false;
    private currentSimulation: number = 0;
    private startTime: number = 0;
    private random: () => number;

    private constructor(config: Partial<MonteCarloConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.random = this.config.randomSeed ? 
            this.createSeededRandom(this.config.randomSeed) : 
            Math.random;
    }

    public static getInstance(config: Partial<MonteCarloConfig> = {}): MonteCarloSimulator {
        if (!MonteCarloSimulator.instance) {
            MonteCarloSimulator.instance = new MonteCarloSimulator(config);
        }
        return MonteCarloSimulator.instance;
    }

    public async runSimulations(): Promise<SimulationReport> {
        if (this.isRunning) {
            logger.warn('Monte Carlo simulation is already running');
            return this.generateReport();
        }

        try {
            this.isRunning = true;
            this.startTime = Date.now();
            this.results = [];
            this.currentSimulation = 0;

            const numBatches = Math.ceil(this.config.numSimulations / this.config.batchSize);
            
            for (let batch = 0; batch < numBatches; batch++) {
                const batchStart = batch * this.config.batchSize;
                const batchEnd = Math.min(batchStart + this.config.batchSize, this.config.numSimulations);
                
                await this.runBatch(batchStart, batchEnd, batch, numBatches);
            }

            return this.generateReport();
        } catch (error) {
            logger.error('Failed to run Monte Carlo simulations:', error);
            throw error;
        } finally {
            this.isRunning = false;
        }
    }

    private async runBatch(start: number, end: number, batch: number, totalBatches: number): Promise<void> {
        const batchPromises = [];
        
        for (let i = start; i < end; i++) {
            batchPromises.push(this.runSingleSimulation(i));
        }

        await Promise.all(batchPromises);

        const progress = (end / this.config.numSimulations) * 100;
        ExecutionTelemetryEngine.getInstance().emitSimulationEvent({
            type: 'MONTE_CARLO_PROGRESS',
            progress,
            currentSimulation: end,
            totalSimulations: this.config.numSimulations
        });
    }

    private async runSingleSimulation(pathId: number): Promise<void> {
        const startTime = Date.now();
        const state: MarketState = {
            price: this.config.initialPrice,
            volatility: this.config.volatility,
            gasPrice: 1.0,
            orderbookDepth: 1.0,
            oracleLag: 0,
            timestamp: Date.now()
        };

        let pnl = 0;
        let maxDrawdown = 0;
        let peakValue = 0;
        let maxGasSpike = 1.0;
        let totalGasCost = 0;
        let events = 0;
        let survival = true;
        let forcedShutdown = false;

        // Simulate market events
        while (survival && !forcedShutdown && events < 10000) {
            // Update market state
            this.updateMarketState(state);
            
            // Apply chaos events
            this.applyChaosEvents(state);

            // Calculate metrics
            pnl += this.calculatePnl(state);
            peakValue = Math.max(peakValue, pnl);
            maxDrawdown = Math.max(maxDrawdown, (peakValue - pnl) / peakValue);
            maxGasSpike = Math.max(maxGasSpike, state.gasPrice);
            totalGasCost += state.gasPrice;

            // Check survival conditions
            if (maxDrawdown > 0.5) { // 50% drawdown threshold
                forcedShutdown = true;
            }

            events++;
        }

        const durationMs = Date.now() - startTime;
        const sharpeRatio = this.calculateSharpeRatio(pnl, state.volatility, durationMs);

        this.results.push({
            pathId,
            pnl,
            maxDrawdown,
            sharpeRatio,
            survival,
            forcedShutdown,
            maxGasSpike,
            totalGasCost,
            events,
            durationMs
        });
    }

    private updateMarketState(state: MarketState): void {
        // Update price using GARCH model
        const epsilon = this.random() - 0.5;
        const sigma = Math.sqrt(
            this.config.garchOmega +
            this.config.garchAlpha * Math.pow(epsilon, 2) +
            this.config.garchBeta * Math.pow(state.volatility, 2)
        );
        
        state.volatility = sigma;
        state.price *= Math.exp(
            this.config.drift + 
            state.volatility * epsilon
        );

        // Update timestamp
        state.timestamp += 1000; // 1 second per step
    }

    private applyChaosEvents(state: MarketState): void {
        // Gas spike
        if (this.random() < this.config.gasSpikeProbability) {
            state.gasPrice *= this.config.gasSpikeMultiplier;
        }

        // Oracle lag
        if (this.random() < this.config.oracleLagProbability) {
            state.oracleLag = this.config.oracleLagMs;
        }

        // Orderbook thinning
        if (this.random() < this.config.orderbookThinningProbability) {
            state.orderbookDepth *= this.config.orderbookThinningFactor;
        }
    }

    private calculatePnl(state: MarketState): number {
        // Simple PnL calculation based on price movement
        // This should be replaced with actual strategy PnL calculation
        return (state.price - this.config.initialPrice) / this.config.initialPrice;
    }

    private calculateSharpeRatio(pnl: number, volatility: number, durationMs: number): number {
        const annualizedReturn = pnl * (365 * 24 * 60 * 60 * 1000) / durationMs;
        const annualizedVol = volatility * Math.sqrt(365 * 24 * 60 * 60 * 1000 / durationMs);
        return annualizedVol === 0 ? 0 : annualizedReturn / annualizedVol;
    }

    private generateReport(): SimulationReport {
        const aggregateStats = this.calculateAggregateStats();
        const riskProfile = this.calculateRiskProfile(aggregateStats);
        
        return {
            config: this.config,
            results: this.results,
            aggregateStats,
            riskProfile,
            executionTimeMs: Date.now() - this.startTime,
            timestamp: Date.now()
        };
    }

    private calculateAggregateStats(): AggregateStats {
        const pnls = this.results.map(r => r.pnl);
        const drawdowns = this.results.map(r => r.maxDrawdown);
        const gasCosts = this.results.map(r => r.totalGasCost);
        
        const meanPnl = pnls.reduce((a, b) => a + b, 0) / pnls.length;
        const medianPnl = this.calculateMedian(pnls);
        const stdDevPnl = Math.sqrt(
            pnls.reduce((a, b) => a + Math.pow(b - meanPnl, 2), 0) / pnls.length
        );
        
        return {
            meanPnl,
            medianPnl,
            stdDevPnl,
            survivalRate: this.results.filter(r => r.survival).length / this.results.length,
            meanDrawdown: drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length,
            maxDrawdown: Math.max(...drawdowns),
            meanSharpe: this.results.reduce((a, b) => a + b.sharpeRatio, 0) / this.results.length,
            meanGasCost: gasCosts.reduce((a, b) => a + b, 0) / gasCosts.length,
            maxGasSpike: Math.max(...this.results.map(r => r.maxGasSpike)),
            pnlDistribution: this.createDistribution(pnls, 20),
            drawdownDistribution: this.createDistribution(drawdowns, 20),
            gasCostDistribution: this.createDistribution(gasCosts, 20)
        };
    }

    private calculateRiskProfile(stats: AggregateStats): RiskProfile {
        return {
            drawdown: stats.meanDrawdown,
            sharpeRatio: stats.meanSharpe,
            survivalProbability: stats.survivalRate,
            gasSensitivity: stats.meanGasCost / stats.meanPnl,
            volatilitySensitivity: stats.stdDevPnl / stats.meanPnl
        };
    }

    private calculateMedian(values: number[]): number {
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ?
            (sorted[mid - 1] + sorted[mid]) / 2 :
            sorted[mid];
    }

    private createDistribution(values: number[], bins: number): number[] {
        const min = Math.min(...values);
        const max = Math.max(...values);
        const binSize = (max - min) / bins;
        
        const distribution = new Array(bins).fill(0);
        values.forEach(value => {
            const binIndex = Math.min(
                Math.floor((value - min) / binSize),
                bins - 1
            );
            distribution[binIndex]++;
        });
        
        return distribution;
    }

    private createSeededRandom(seed: number): () => number {
        const x = Math.sin(seed) * 10000;
        return () => {
            const x2 = Math.sin(x) * 10000;
            return x2 - Math.floor(x2);
        };
    }
} 