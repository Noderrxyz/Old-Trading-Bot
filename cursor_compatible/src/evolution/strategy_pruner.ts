import logger from '../utils/logger.js';
import { ExecutionTelemetryEngine } from '../telemetry/execution_telemetry_engine.js';
import { 
    PruningConfig, 
    StrategyMetrics, 
    PruningReason, 
    PruningAction,
    PruningEvent,
    ReallocationResult,
    DEFAULT_PRUNING_CONFIG
} from './types/strategy_pruner.types.js';
import { SimulationEventType, RiskProfileUpdateEvent } from '../simulation/types/simulation.types.js';

export class StrategyPruner {
    private static instance: StrategyPruner | null = null;
    private config: PruningConfig;
    private metrics: Map<string, StrategyMetrics>;
    private telemetry: ExecutionTelemetryEngine;
    private pruningHistory: PruningEvent[];
    private lastPruningTime: number;

    private constructor(config: Partial<PruningConfig> = {}) {
        this.config = { ...DEFAULT_PRUNING_CONFIG, ...config };
        this.metrics = new Map();
        this.telemetry = ExecutionTelemetryEngine.getInstance();
        this.pruningHistory = [];
        this.lastPruningTime = Date.now();
    }

    public static getInstance(config?: Partial<PruningConfig>): StrategyPruner {
        if (!StrategyPruner.instance) {
            StrategyPruner.instance = new StrategyPruner(config);
        }
        return StrategyPruner.instance;
    }

    public updateStrategyMetrics(strategyId: string, metrics: Partial<StrategyMetrics>): void {
        const currentMetrics = this.metrics.get(strategyId) || {
            strategyId,
            pnl: 0,
            sharpeRatio: 0,
            maxDrawdown: 0,
            winRate: 0,
            lastUpdate: Date.now()
        };

        this.metrics.set(strategyId, {
            ...currentMetrics,
            ...metrics,
            lastUpdate: Date.now()
        });

        this.checkForPruning(strategyId);
    }

    private checkForPruning(strategyId: string): void {
        const metrics = this.metrics.get(strategyId);
        if (!metrics) return;

        const now = Date.now();
        if (now - this.lastPruningTime < this.config.minPruningIntervalMs) {
            return;
        }

        const reasons: PruningReason[] = [];
        let action: PruningAction = PruningAction.NONE;

        // Check performance metrics
        if (metrics.sharpeRatio < this.config.softPruneThresholds.sharpeRatio) {
            reasons.push(PruningReason.PERFORMANCE_DECAY);
        }
        if (metrics.maxDrawdown > this.config.softPruneThresholds.maxDrawdown) {
            reasons.push(PruningReason.RISK_EXCEEDED);
        }
        if (metrics.winRate < this.config.softPruneThresholds.winRate) {
            reasons.push(PruningReason.WIN_RATE_DECAY);
        }

        // Check capital pressure
        if (metrics.pnl < this.config.capitalPressureThresholds.pnl) {
            reasons.push(PruningReason.CAPITAL_PRESSURE);
        }

        // Determine action based on severity
        if (reasons.length > 0) {
            const severity = this.calculateSeverity(reasons, metrics);
            if (severity >= this.config.hardPruneThreshold) {
                action = PruningAction.HARD_PRUNE;
            } else if (severity >= this.config.softPruneThreshold) {
                action = PruningAction.SOFT_PRUNE;
            }
        }

        if (action !== PruningAction.NONE) {
            this.executePruning(strategyId, action, reasons);
        }
    }

    private calculateSeverity(reasons: PruningReason[], metrics: StrategyMetrics): number {
        let severity = 0;
        
        // Base severity from number of reasons
        severity += reasons.length * 0.2;

        // Add severity based on metric values
        if (metrics.sharpeRatio < this.config.softPruneThresholds.sharpeRatio) {
            severity += (this.config.softPruneThresholds.sharpeRatio - metrics.sharpeRatio) * 0.3;
        }
        if (metrics.maxDrawdown > this.config.softPruneThresholds.maxDrawdown) {
            severity += (metrics.maxDrawdown - this.config.softPruneThresholds.maxDrawdown) * 0.3;
        }
        if (metrics.winRate < this.config.softPruneThresholds.winRate) {
            severity += (this.config.softPruneThresholds.winRate - metrics.winRate) * 0.2;
        }

        return Math.min(severity, 1.0);
    }

    private executePruning(strategyId: string, action: PruningAction, reasons: PruningReason[]): void {
        const event: PruningEvent = {
            timestamp: Date.now(),
            strategyId,
            action,
            reasons,
            metrics: this.metrics.get(strategyId)!
        };

        this.pruningHistory.push(event);
        this.lastPruningTime = Date.now();

        // Emit telemetry event
        const riskProfileEvent: RiskProfileUpdateEvent = {
            type: SimulationEventType.RiskProfileUpdate,
            timestamp: Date.now(),
            metrics: {
                var95: 0,
                var99: 0,
                expectedShortfall: 0,
                tailRisk: event.metrics.maxDrawdown
            }
        };

        this.telemetry.emitSimulationEvent(riskProfileEvent);

        logger.warn(`Strategy pruning executed: ${strategyId}`, {
            action,
            reasons,
            metrics: event.metrics
        });

        // Handle capital reallocation if needed
        if (action === PruningAction.HARD_PRUNE) {
            this.reallocateCapital(strategyId);
        }
    }

    private reallocateCapital(prunedStrategyId: string): ReallocationResult {
        const strategies = Array.from(this.metrics.entries())
            .filter(([id]) => id !== prunedStrategyId)
            .map(([id, metrics]) => ({ id, metrics }));

        // Sort strategies by performance
        strategies.sort((a, b) => b.metrics.sharpeRatio - a.metrics.sharpeRatio);

        // Calculate allocation weights
        const weights = this.calculateAllocationWeights(strategies);

        const result: ReallocationResult = {
            timestamp: Date.now(),
            prunedStrategyId,
            allocations: weights.map((weight, index) => ({
                strategyId: strategies[index].id,
                weight
            }))
        };

        // Emit telemetry event
        const riskProfileEvent: RiskProfileUpdateEvent = {
            type: SimulationEventType.RiskProfileUpdate,
            timestamp: Date.now(),
            metrics: {
                var95: 0,
                var99: 0,
                expectedShortfall: 0,
                tailRisk: result.allocations.reduce((max, alloc) => 
                    Math.max(max, this.metrics.get(alloc.strategyId)?.maxDrawdown || 0), 0)
            }
        };

        this.telemetry.emitSimulationEvent(riskProfileEvent);

        logger.info('Capital reallocation completed', result);

        return result;
    }

    private calculateAllocationWeights(strategies: { id: string; metrics: StrategyMetrics }[]): number[] {
        if (strategies.length === 0) return [];

        // Calculate base weights from performance metrics
        const performanceScores = strategies.map(s => 
            s.metrics.sharpeRatio * this.config.reallocationWeights.sharpeRatio +
            (1 - s.metrics.maxDrawdown) * this.config.reallocationWeights.maxDrawdown +
            s.metrics.winRate * this.config.reallocationWeights.winRate
        );

        // Normalize weights
        const sum = performanceScores.reduce((a, b) => a + b, 0);
        return performanceScores.map(score => score / sum);
    }

    public getPruningHistory(): PruningEvent[] {
        return [...this.pruningHistory];
    }

    public getStrategyMetrics(strategyId: string): StrategyMetrics | undefined {
        return this.metrics.get(strategyId);
    }

    public getAllStrategyMetrics(): Map<string, StrategyMetrics> {
        return new Map(this.metrics);
    }
} 