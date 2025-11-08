import { EventEmitter } from 'events';
interface TradingSignal {
    id: string;
    source: string;
    symbol: string;
    direction: 'LONG' | 'SHORT' | 'NEUTRAL';
    strength: number;
    confidence: number;
    timestamp: Date;
    metadata: Record<string, any>;
}
interface SignalSource {
    id: string;
    name: string;
    type: 'AI' | 'TECHNICAL' | 'FUNDAMENTAL' | 'SENTIMENT' | 'ONCHAIN';
    reliability: number;
    weight: number;
    latency: number;
}
interface ElectedSignal {
    symbol: string;
    aggregatedDirection: 'LONG' | 'SHORT' | 'NEUTRAL';
    confidence: number;
    strength: number;
    sources: Array<{
        sourceId: string;
        signal: TradingSignal;
        contribution: number;
    }>;
    electionId: string;
    timestamp: Date;
}
interface SignalConflict {
    symbol: string;
    conflictingSignals: TradingSignal[];
    resolution: 'WEIGHTED_AVERAGE' | 'MAJORITY_VOTE' | 'HIGHEST_CONFIDENCE' | 'MANUAL';
    resolvedSignal?: ElectedSignal;
}
export declare class SignalElection extends EventEmitter {
    private logger;
    private signalSources;
    private activeSignals;
    private electionHistory;
    private conflictResolutions;
    private electionInterval;
    constructor();
    private initializeSignalSources;
    registerSource(source: SignalSource): void;
    submitSignal(signal: TradingSignal): Promise<void>;
    startElectionCycle(intervalMs?: number): void;
    stopElectionCycle(): void;
    private runAllElections;
    private runElection;
    private detectConflicts;
    private resolveConflicts;
    private aggregateSignals;
    private resolveByWeightedAverage;
    private resolveByMajorityVote;
    private resolveByHighestConfidence;
    getElectionHistory(symbol?: string, limit?: number): ElectedSignal[];
    getConflictHistory(limit?: number): SignalConflict[];
    updateSourceReliability(sourceId: string, newReliability: number): void;
    getSourcePerformance(): Map<string, {
        accuracy: number;
        signalCount: number;
    }>;
}
export {};
//# sourceMappingURL=SignalElection.d.ts.map