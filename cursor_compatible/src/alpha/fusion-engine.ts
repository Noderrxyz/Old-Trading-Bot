import { AlphaFrame } from '../alphasources/types.js';

export enum SignalDirection {
  LONG = 'LONG',
  SHORT = 'SHORT',
  NEUTRAL = 'NEUTRAL'
}

export interface SignalDetail {
  source: string;
  weight: number;
}

export interface FusedSignal {
  symbol: string;
  direction: SignalDirection;
  confidence: number;
  size: number;
  sources: string[];
  details: SignalDetail[];
}

export class AlphaFusionEngine {
  fuse(signals: AlphaFrame[]): FusedSignal[] {
    // Implementation will be added later
    return [];
  }
} 