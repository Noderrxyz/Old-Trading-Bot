import { EventEmitter } from 'events';
interface VotingParticipant {
    id: string;
    type: 'AI_MODEL' | 'PERFORMANCE_METRIC' | 'RISK_METRIC' | 'MARKET_CONDITION';
    weight: number;
    votingPower: number;
}
interface Vote {
    participantId: string;
    strategyId: string;
    score: number;
    reasoning: string;
    confidence: number;
    timestamp: Date;
}
interface VotingRound {
    id: string;
    type: 'STRATEGY_SELECTION' | 'WEIGHT_ADJUSTMENT' | 'RISK_PARAMETER';
    startTime: Date;
    endTime: Date;
    participants: VotingParticipant[];
    votes: Vote[];
    result?: VotingResult;
    status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
}
interface VotingResult {
    winners: Array<{
        strategyId: string;
        finalScore: number;
        voteCount: number;
    }>;
    consensus: number;
    participation: number;
    decision: string;
}
interface StrategyCandidate {
    strategyId: string;
    historicalPerformance: number;
    recentPerformance: number;
    riskScore: number;
    marketFit: number;
    complexity: number;
}
export declare class StrategyVotingEngine extends EventEmitter {
    private logger;
    private votingRounds;
    private participants;
    private historicalDecisions;
    constructor();
    private initializeVotingParticipants;
    private registerParticipant;
    initiateVoting(type: 'STRATEGY_SELECTION' | 'WEIGHT_ADJUSTMENT' | 'RISK_PARAMETER', candidates: StrategyCandidate[], duration?: number): Promise<string>;
    private collectVotes;
    private getParticipantVotes;
    private getAIModelVotes;
    private getPerformanceVotes;
    private getRiskVotes;
    private getMarketConditionVotes;
    private calculateTransformerScore;
    private calculateRLScore;
    private calculateVoteConfidence;
    private detectMarketRegime;
    private calculateMarketFitScore;
    private completeVotingRound;
    private calculateVotingResult;
    private generateDecision;
    getVotingHistory(limit?: number): Promise<VotingResult[]>;
    getActiveVotingRounds(): Promise<VotingRound[]>;
    updateParticipantWeight(participantId: string, newWeight: number): Promise<void>;
    addCustomParticipant(participant: VotingParticipant): Promise<void>;
}
export {};
//# sourceMappingURL=StrategyVotingEngine.d.ts.map