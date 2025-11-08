export interface MonteCarloConfig {
    enabled: boolean;
    numSimulations: number;
    initialPrice: number;
    drift: number;
    volatility: number;
    garchAlpha: number;
    garchBeta: number;
    garchOmega: number;
    gasSpikeProbability: number;
    gasSpikeMultiplier: number;
    oracleLagProbability: number;
    oracleLagMs: number;
    orderbookThinningProbability: number;
    orderbookThinningFactor: number;
    randomSeed?: number;
    batchSize: number;
}

export interface SimulationResult {
    pathId: number;
    pnl: number;
    maxDrawdown: number;
    sharpeRatio: number;
    survival: boolean;
    forcedShutdown: boolean;
    maxGasSpike: number;
    totalGasCost: number;
    events: number;
    durationMs: number;
}

export interface AggregateStats {
    meanPnl: number;
    medianPnl: number;
    stdDevPnl: number;
    survivalRate: number;
    meanDrawdown: number;
    maxDrawdown: number;
    meanSharpe: number;
    meanGasCost: number;
    maxGasSpike: number;
    pnlDistribution: number[];
    drawdownDistribution: number[];
    gasCostDistribution: number[];
}

export interface MarketState {
    price: number;
    volatility: number;
    gasPrice: number;
    orderbookDepth: number;
    oracleLag: number;
    timestamp: number;
}

export interface MonteCarloProgressEvent {
    type: 'monte_carlo_progress';
    progress: number;
    currentSimulation: number;
    totalSimulations: number;
    currentBatch: number;
    totalBatches: number;
}

export interface ChaosEvent {
    type: 'chaos';
    eventType: 'gas_spike' | 'oracle_lag' | 'orderbook_thinning';
    severity: number;
    durationMs: number;
    timestamp: number;
}

export interface ChartUpdateEvent {
    type: 'chart_update';
    pathId: number;
    price: number;
    timestamp: number;
}

export interface RiskProfileUpdateEvent {
    type: 'risk_profile_update';
    drawdown: number;
    sharpeRatio: number;
    survivalProbability: number;
    timestamp: number;
}

export type SimulationEventType = 
    | 'monte_carlo_progress'
    | 'chaos'
    | 'chart_update'
    | 'risk_profile_update';

export interface RiskProfile {
    drawdown: number;
    sharpeRatio: number;
    survivalProbability: number;
    gasSensitivity: number;
    volatilitySensitivity: number;
}

export interface SimulationReport {
    config: MonteCarloConfig;
    results: SimulationResult[];
    aggregateStats: AggregateStats;
    riskProfile: RiskProfile;
    executionTimeMs: number;
    timestamp: number;
} 