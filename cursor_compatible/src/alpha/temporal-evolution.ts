import { AlphaFrame } from '../alphasources/types.js';

export enum SignalPhase {
  TRENDING = 'TRENDING',
  MEAN_REVERTING = 'MEAN_REVERTING',
  TRANSITION = 'TRANSITION'
}

export interface PhaseTransition {
  from: SignalPhase;
  to: SignalPhase;
  timestamp: number;
  confidence: number;
}

export class TemporalSignalEvolutionEngine {
  detectPhase(signals: AlphaFrame[]): SignalPhase {
    // Implementation will be added later
    return SignalPhase.TRENDING;
  }

  getPhaseTransitions(timeframe: number): PhaseTransition[] {
    // Implementation will be added later
    return [];
  }
} 