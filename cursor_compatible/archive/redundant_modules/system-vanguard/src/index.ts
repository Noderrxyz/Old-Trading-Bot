/**
 * SystemVanguard - Elite 0.1% Performance Module
 * 
 * This module implements cutting-edge features that push the Noderr Protocol
 * into the top 0.1% of trading systems globally:
 * 
 * - Ultra-low latency monitoring (sub-1ms targets)
 * - GPS time synchronization for microsecond precision
 * - Adversarial defense against strategy copying and gaming
 * - Deception engine for order obfuscation
 * - Alpha leak detection and protection
 * - Real-time mempool analysis across chains
 * - Dark venue detection
 * - Continuous model evolution through adversarial training
 * 
 * WARNING: This module implements aggressive trading strategies.
 * Use with appropriate risk management and compliance measures.
 */

// Core exports
export * from './types';
export { SystemVanguardService } from './core/SystemVanguardService';

// Latency monitoring
export { LatencyMonitor } from './latency/LatencyMonitor';

// Adversarial components
export { AdversarialDefense } from './adversarial/AdversarialDefense';

// Edge data
export { MempoolAnalyzer } from './edge-data/MempoolAnalyzer';

// Default configuration
export const DEFAULT_VANGUARD_CONFIG = {
  latencyTargets: {
    p50: 1,     // 1ms
    p99: 5,     // 5ms
    p999: 10,   // 10ms
    p9999: 25   // 25ms
  },
  gpsSync: {
    enabled: false, // Requires GPS hardware
    device: '/dev/ttyUSB0',
    requiredAccuracy: 100 // nanoseconds
  },
  adversarial: {
    detectionEnabled: true,
    autoCountermeasures: true,
    aggressiveness: 0.7
  },
  deception: {
    enabled: true,
    fingerPrintRotation: 300000, // 5 minutes
    walletRotation: false,
    orderRandomization: {
      sizeJitter: 0.05,
      timingJitter: 100,
      venueRotation: true,
      priceOffsets: [0, 1, 2, 5],
      sliceVariation: 0.2
    },
    behaviorMasking: [],
    syntheticNoise: {
      enabled: true,
      intensity: 0.3,
      patterns: ['random_walk', 'mean_reversion'],
      adaptiveNoise: true
    }
  },
  evolution: {
    enabled: true,
    generationInterval: 3600000, // 1 hour
    populationSize: 100,
    eliteRatio: 0.1
  },
  mempool: {
    chains: ['ethereum', 'polygon', 'arbitrum'],
    providers: [],
    updateFrequency: 100 // 100ms
  },
  darkVenues: {
    detection: true,
    participation: false,
    minSize: 100000 // $100k minimum
  }
}; 