import { TemporalEvolutionConfig } from '../types/temporal.types.js';

/**
 * Default configuration for temporal signal evolution
 */
export const DEFAULT_TEMPORAL_EVOLUTION_CONFIG: TemporalEvolutionConfig = {
  enabled: true,
  
  driftDetection: {
    windowSize: 1000,
    driftThreshold: 0.4
  },
  
  phaseShiftDetection: {
    minShiftMagnitude: 0.3,
    cooloffPeriodSeconds: 3600
  },
  
  history: {
    retentionDays: 30,
    maxEntriesPerSignal: 10000
  }
}; 