import { EventEmitter } from 'events';

// Create logger inline instead of importing
const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => console.log(`[${name}] INFO:`, message, meta || ''),
  error: (message: string, error?: any) => console.error(`[${name}] ERROR:`, message, error || ''),
  debug: (message: string, meta?: any) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
  warn: (message: string, meta?: any) => console.warn(`[${name}] WARN:`, message, meta || '')
});

interface VotingParticipant {
  id: string;
  type: 'AI_MODEL' | 'PERFORMANCE_METRIC' | 'RISK_METRIC' | 'MARKET_CONDITION';
  weight: number;
  votingPower: number;
}

interface Vote {
  participantId: string;
  strategyId: string;
  score: number; // 0-100
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
  consensus: number; // 0-1 measure of agreement
  participation: number; // percentage of participants who voted
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

export class StrategyVotingEngine extends EventEmitter {
  private logger: ReturnType<typeof createLogger>;
  private votingRounds: Map<string, VotingRound>;
  private participants: Map<string, VotingParticipant>;
  private historicalDecisions: VotingResult[];
  
  constructor() {
    super();
    this.logger = createLogger('StrategyVoting');
    this.votingRounds = new Map();
    this.participants = new Map();
    this.historicalDecisions = [];
    
    this.initializeVotingParticipants();
  }
  
  private initializeVotingParticipants(): void {
    // AI Models vote based on predictions
    this.registerParticipant({
      id: 'transformer_predictor',
      type: 'AI_MODEL',
      weight: 0.25,
      votingPower: 1.0
    });
    
    this.registerParticipant({
      id: 'rl_agent',
      type: 'AI_MODEL',
      weight: 0.20,
      votingPower: 1.0
    });
    
    // Performance metrics vote based on historical data
    this.registerParticipant({
      id: 'sharpe_ratio_voter',
      type: 'PERFORMANCE_METRIC',
      weight: 0.15,
      votingPower: 1.0
    });
    
    this.registerParticipant({
      id: 'win_rate_voter',
      type: 'PERFORMANCE_METRIC',
      weight: 0.10,
      votingPower: 1.0
    });
    
    // Risk metrics provide conservative votes
    this.registerParticipant({
      id: 'var_voter',
      type: 'RISK_METRIC',
      weight: 0.15,
      votingPower: 1.0
    });
    
    this.registerParticipant({
      id: 'drawdown_voter',
      type: 'RISK_METRIC',
      weight: 0.10,
      votingPower: 1.0
    });
    
    // Market condition voter
    this.registerParticipant({
      id: 'market_regime_voter',
      type: 'MARKET_CONDITION',
      weight: 0.05,
      votingPower: 1.0
    });
  }
  
  private registerParticipant(participant: VotingParticipant): void {
    this.participants.set(participant.id, participant);
    this.logger.info(`Registered voting participant: ${participant.id}`);
  }
  
  public async initiateVoting(
    type: 'STRATEGY_SELECTION' | 'WEIGHT_ADJUSTMENT' | 'RISK_PARAMETER',
    candidates: StrategyCandidate[],
    duration: number = 30000 // 30 seconds default
  ): Promise<string> {
    const roundId = `vote_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const votingRound: VotingRound = {
      id: roundId,
      type,
      startTime: new Date(),
      endTime: new Date(Date.now() + duration),
      participants: Array.from(this.participants.values()),
      votes: [],
      status: 'ACTIVE'
    };
    
    this.votingRounds.set(roundId, votingRound);
    
    this.logger.info(`Initiated voting round: ${roundId}`, {
      type,
      candidateCount: candidates.length,
      duration
    });
    
    // Start collecting votes
    await this.collectVotes(roundId, candidates);
    
    // Schedule round completion
    setTimeout(() => this.completeVotingRound(roundId), duration);
    
    this.emit('voting-started', { roundId, type, candidates });
    
    return roundId;
  }
  
  private async collectVotes(roundId: string, candidates: StrategyCandidate[]): Promise<void> {
    const round = this.votingRounds.get(roundId);
    if (!round) return;
    
    // Collect votes from each participant
    for (const participant of round.participants) {
      try {
        const votes = await this.getParticipantVotes(participant, candidates, round.type);
        
        for (const vote of votes) {
          round.votes.push({
            ...vote,
            participantId: participant.id,
            timestamp: new Date()
          });
        }
        
        this.logger.debug(`Collected votes from ${participant.id}`, {
          voteCount: votes.length
        });
        
      } catch (error) {
        this.logger.error(`Failed to collect votes from ${participant.id}:`, error);
      }
    }
    
    this.votingRounds.set(roundId, round);
  }
  
  private async getParticipantVotes(
    participant: VotingParticipant,
    candidates: StrategyCandidate[],
    votingType: string
  ): Promise<Omit<Vote, 'participantId' | 'timestamp'>[]> {
    const votes: Omit<Vote, 'participantId' | 'timestamp'>[] = [];
    
    switch (participant.type) {
      case 'AI_MODEL':
        votes.push(...await this.getAIModelVotes(participant.id, candidates));
        break;
        
      case 'PERFORMANCE_METRIC':
        votes.push(...this.getPerformanceVotes(participant.id, candidates));
        break;
        
      case 'RISK_METRIC':
        votes.push(...this.getRiskVotes(participant.id, candidates));
        break;
        
      case 'MARKET_CONDITION':
        votes.push(...await this.getMarketConditionVotes(participant.id, candidates));
        break;
    }
    
    return votes;
  }
  
  private async getAIModelVotes(
    modelId: string,
    candidates: StrategyCandidate[]
  ): Promise<Omit<Vote, 'participantId' | 'timestamp'>[]> {
    const votes: Omit<Vote, 'participantId' | 'timestamp'>[] = [];
    
    for (const candidate of candidates) {
      let score = 50; // Base score
      let reasoning = '';
      
      if (modelId === 'transformer_predictor') {
        // Transformer focuses on pattern recognition and future performance
        score = this.calculateTransformerScore(candidate);
        reasoning = `Pattern analysis suggests ${score > 70 ? 'strong' : score > 50 ? 'moderate' : 'weak'} future performance`;
      } else if (modelId === 'rl_agent') {
        // RL agent focuses on reward optimization
        score = this.calculateRLScore(candidate);
        reasoning = `Reward optimization indicates ${score > 70 ? 'high' : score > 50 ? 'medium' : 'low'} expected returns`;
      }
      
      votes.push({
        strategyId: candidate.strategyId,
        score,
        reasoning,
        confidence: this.calculateVoteConfidence(candidate)
      });
    }
    
    return votes;
  }
  
  private getPerformanceVotes(
    metricId: string,
    candidates: StrategyCandidate[]
  ): Omit<Vote, 'participantId' | 'timestamp'>[] {
    const votes: Omit<Vote, 'participantId' | 'timestamp'>[] = [];
    
    for (const candidate of candidates) {
      let score = 50;
      let reasoning = '';
      
      if (metricId === 'sharpe_ratio_voter') {
        // Score based on risk-adjusted returns
        score = Math.min(100, candidate.historicalPerformance * 20);
        reasoning = `Historical Sharpe ratio indicates ${score > 70 ? 'excellent' : score > 50 ? 'good' : 'poor'} risk-adjusted returns`;
      } else if (metricId === 'win_rate_voter') {
        // Score based on consistency
        const winRate = (candidate.historicalPerformance + candidate.recentPerformance) / 2;
        score = Math.min(100, winRate * 100);
        reasoning = `Win rate of ${winRate.toFixed(2)} suggests ${score > 70 ? 'high' : score > 50 ? 'moderate' : 'low'} consistency`;
      }
      
      votes.push({
        strategyId: candidate.strategyId,
        score,
        reasoning,
        confidence: 0.8 // Performance metrics have high confidence in historical data
      });
    }
    
    return votes;
  }
  
  private getRiskVotes(
    metricId: string,
    candidates: StrategyCandidate[]
  ): Omit<Vote, 'participantId' | 'timestamp'>[] {
    const votes: Omit<Vote, 'participantId' | 'timestamp'>[] = [];
    
    for (const candidate of candidates) {
      let score = 50;
      let reasoning = '';
      
      if (metricId === 'var_voter') {
        // Inverse scoring - lower risk gets higher score
        score = Math.max(0, 100 - candidate.riskScore * 100);
        reasoning = `VaR analysis shows ${score > 70 ? 'low' : score > 50 ? 'moderate' : 'high'} downside risk`;
      } else if (metricId === 'drawdown_voter') {
        // Conservative voting based on max drawdown potential
        score = Math.max(0, 100 - candidate.riskScore * 80);
        reasoning = `Drawdown risk is ${score > 70 ? 'minimal' : score > 50 ? 'acceptable' : 'concerning'}`;
      }
      
      votes.push({
        strategyId: candidate.strategyId,
        score,
        reasoning,
        confidence: 0.9 // Risk metrics have high confidence
      });
    }
    
    return votes;
  }
  
  private async getMarketConditionVotes(
    voterId: string,
    candidates: StrategyCandidate[]
  ): Promise<Omit<Vote, 'participantId' | 'timestamp'>[]> {
    const votes: Omit<Vote, 'participantId' | 'timestamp'>[] = [];
    
    // Simulate market regime detection
    const currentRegime = this.detectMarketRegime();
    
    for (const candidate of candidates) {
      const score = this.calculateMarketFitScore(candidate, currentRegime);
      const reasoning = `Strategy ${score > 70 ? 'well-suited' : score > 50 ? 'moderately suited' : 'poorly suited'} for ${currentRegime} market`;
      
      votes.push({
        strategyId: candidate.strategyId,
        score,
        reasoning,
        confidence: 0.7 // Market conditions are less certain
      });
    }
    
    return votes;
  }
  
  private calculateTransformerScore(candidate: StrategyCandidate): number {
    // Weighted scoring based on pattern recognition
    const weights = {
      recent: 0.4,
      historical: 0.3,
      complexity: 0.2,
      marketFit: 0.1
    };
    
    const score = 
      candidate.recentPerformance * weights.recent * 100 +
      candidate.historicalPerformance * weights.historical * 100 +
      (1 - candidate.complexity) * weights.complexity * 100 +
      candidate.marketFit * weights.marketFit * 100;
      
    return Math.min(100, Math.max(0, score));
  }
  
  private calculateRLScore(candidate: StrategyCandidate): number {
    // RL focuses on reward maximization with risk consideration
    const rewardPotential = (candidate.historicalPerformance + candidate.recentPerformance) / 2;
    const riskPenalty = candidate.riskScore * 0.3;
    
    const score = (rewardPotential - riskPenalty) * 100;
    return Math.min(100, Math.max(0, score));
  }
  
  private calculateVoteConfidence(candidate: StrategyCandidate): number {
    // Confidence based on data quality and consistency
    const dataQuality = candidate.historicalPerformance > 0 ? 0.5 : 0;
    const consistency = 1 - Math.abs(candidate.historicalPerformance - candidate.recentPerformance);
    
    return Math.min(0.95, dataQuality + consistency * 0.5);
  }
  
  private detectMarketRegime(): string {
    // Simplified regime detection
    const regimes = ['TRENDING', 'RANGING', 'VOLATILE', 'CALM'];
    return regimes[Math.floor(Math.random() * regimes.length)];
  }
  
  private calculateMarketFitScore(candidate: StrategyCandidate, regime: string): number {
    const fitMatrix: Record<string, number> = {
      'TRENDING': candidate.marketFit * 0.8 + candidate.recentPerformance * 0.2,
      'RANGING': (1 - candidate.complexity) * 0.6 + candidate.marketFit * 0.4,
      'VOLATILE': (1 - candidate.riskScore) * 0.7 + candidate.marketFit * 0.3,
      'CALM': candidate.historicalPerformance * 0.5 + candidate.marketFit * 0.5
    };
    
    return Math.min(100, (fitMatrix[regime] || 0.5) * 100);
  }
  
  private async completeVotingRound(roundId: string): Promise<void> {
    const round = this.votingRounds.get(roundId);
    if (!round || round.status !== 'ACTIVE') return;
    
    this.logger.info(`Completing voting round: ${roundId}`);
    
    // Calculate results
    const result = this.calculateVotingResult(round);
    
    round.result = result;
    round.status = 'COMPLETED';
    
    this.votingRounds.set(roundId, round);
    this.historicalDecisions.push(result);
    
    this.logger.info(`Voting round completed: ${roundId}`, {
      winners: result.winners.slice(0, 3),
      consensus: result.consensus,
      participation: result.participation
    });
    
    this.emit('voting-completed', { roundId, result });
  }
  
  private calculateVotingResult(round: VotingRound): VotingResult {
    // Aggregate votes by strategy
    const strategyScores = new Map<string, { totalScore: number; voteCount: number; weightedScore: number }>();
    
    for (const vote of round.votes) {
      const participant = this.participants.get(vote.participantId);
      if (!participant) continue;
      
      const current = strategyScores.get(vote.strategyId) || { 
        totalScore: 0, 
        voteCount: 0, 
        weightedScore: 0 
      };
      
      current.totalScore += vote.score;
      current.voteCount += 1;
      current.weightedScore += vote.score * participant.weight * vote.confidence;
      
      strategyScores.set(vote.strategyId, current);
    }
    
    // Calculate winners
    const winners = Array.from(strategyScores.entries())
      .map(([strategyId, scores]) => ({
        strategyId,
        finalScore: scores.weightedScore / scores.voteCount,
        voteCount: scores.voteCount
      }))
      .sort((a, b) => b.finalScore - a.finalScore);
      
    // Calculate consensus (standard deviation of scores)
    const allScores = round.votes.map(v => v.score);
    const avgScore = allScores.reduce((a, b) => a + b, 0) / allScores.length;
    const variance = allScores.reduce((sum, score) => sum + Math.pow(score - avgScore, 2), 0) / allScores.length;
    const stdDev = Math.sqrt(variance);
    const consensus = 1 - (stdDev / 50); // Normalize to 0-1
    
    // Calculate participation
    const expectedVotes = round.participants.length * (strategyScores.size || 1);
    const actualVotes = round.votes.length;
    const participation = actualVotes / expectedVotes;
    
    // Generate decision
    const decision = this.generateDecision(winners, consensus, round.type);
    
    return {
      winners,
      consensus: Math.max(0, Math.min(1, consensus)),
      participation: Math.min(1, participation),
      decision
    };
  }
  
  private generateDecision(
    winners: Array<{ strategyId: string; finalScore: number }>,
    consensus: number,
    votingType: string
  ): string {
    if (winners.length === 0) {
      return 'No strategies selected due to insufficient votes';
    }
    
    const topStrategy = winners[0];
    const confidence = consensus > 0.8 ? 'high' : consensus > 0.6 ? 'moderate' : 'low';
    
    switch (votingType) {
      case 'STRATEGY_SELECTION':
        return `Select strategy ${topStrategy.strategyId} with ${confidence} confidence (score: ${topStrategy.finalScore.toFixed(2)})`;
        
      case 'WEIGHT_ADJUSTMENT':
        const weight = topStrategy.finalScore / 100;
        return `Adjust weight for ${topStrategy.strategyId} to ${(weight * 100).toFixed(1)}%`;
        
      case 'RISK_PARAMETER':
        return `Update risk parameters based on ${topStrategy.strategyId} profile`;
        
      default:
        return `Decision for ${topStrategy.strategyId} with score ${topStrategy.finalScore.toFixed(2)}`;
    }
  }
  
  public async getVotingHistory(limit: number = 10): Promise<VotingResult[]> {
    return this.historicalDecisions.slice(-limit);
  }
  
  public async getActiveVotingRounds(): Promise<VotingRound[]> {
    return Array.from(this.votingRounds.values())
      .filter(round => round.status === 'ACTIVE');
  }
  
  public async updateParticipantWeight(participantId: string, newWeight: number): Promise<void> {
    const participant = this.participants.get(participantId);
    if (participant) {
      participant.weight = Math.max(0, Math.min(1, newWeight));
      this.participants.set(participantId, participant);
      
      this.logger.info(`Updated participant weight: ${participantId} = ${newWeight}`);
      this.emit('participant-updated', participant);
    }
  }
  
  public async addCustomParticipant(participant: VotingParticipant): Promise<void> {
    this.registerParticipant(participant);
    this.emit('participant-added', participant);
  }
} 