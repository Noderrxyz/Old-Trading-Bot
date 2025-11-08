/**
 * SystemVanguard Types - Elite 0.1% Performance Types
 * 
 * These types define the cutting-edge features that separate
 * the top 0.1% trading systems from the rest.
 */

import { FeatureSet, PredictionResult, ModelPerformance } from '@noderr/ml';
import { ExecutionResult } from '@noderr/execution';

// Latency Monitoring
export interface LatencyMetrics {
  p50: number;    // 50th percentile
  p90: number;    // 90th percentile
  p99: number;    // 99th percentile
  p999: number;   // 99.9th percentile
  p9999: number;  // 99.99th percentile
  max: number;
  min: number;
  mean: number;
  std: number;
  samples: number;
  timestamp: number;
}

export interface ModuleLatency {
  module: string;
  operation: string;
  metrics: LatencyMetrics;
  bottlenecks: string[];
}

// GPS Time Synchronization
export interface GPSTimeSync {
  gpsTime: number;
  systemTime: number;
  offset: number;
  drift: number;
  accuracy: number;
  satelliteCount: number;
  hdop: number; // Horizontal dilution of precision
  synchronized: boolean;
}

// Adversarial Defense
export interface AdversarialThreat {
  id: string;
  type: ThreatType;
  source: string;
  pattern: string[];
  confidence: number;
  firstSeen: number;
  lastSeen: number;
  frequency: number;
  impact: ThreatImpact;
  countermeasures: string[];
}

export enum ThreatType {
  STRATEGY_COPYING = 'strategy_copying',
  LATENCY_GAMING = 'latency_gaming',
  FAKE_LIQUIDITY = 'fake_liquidity',
  WASH_TRADING = 'wash_trading',
  SPOOFING = 'spoofing',
  LAYERING = 'layering',
  FRONT_RUNNING = 'front_running',
  MOMENTUM_IGNITION = 'momentum_ignition',
  QUOTE_STUFFING = 'quote_stuffing'
}

export interface ThreatImpact {
  alphaLoss: number;
  executionDegradation: number;
  riskIncrease: number;
  estimatedCost: number;
}

// Deception System
export interface DeceptionConfig {
  enabled: boolean;
  fingerPrintRotation: number; // milliseconds
  walletRotation: boolean;
  decoyOrders?: boolean;
  orderRandomization: OrderRandomization;
  behaviorMasking: BehaviorMask[];
  syntheticNoise: NoiseConfig;
}

export interface OrderRandomization {
  sizeJitter: number; // percentage
  timingJitter: number; // milliseconds
  venueRotation: boolean;
  priceOffsets: number[]; // basis points
  sliceVariation: number; // percentage
}

export interface BehaviorMask {
  pattern: string;
  mask: string;
  frequency: number;
  effectiveness: number;
}

export interface NoiseConfig {
  enabled: boolean;
  intensity: number;
  patterns: string[];
  adaptiveNoise: boolean;
}

// Alpha Leak Detection
export interface AlphaLeak {
  id: string;
  type: 'execution' | 'prediction' | 'pattern';
  leakageRate: number; // bits per trade
  suspectedCopiers: string[];
  correlationStrength: number;
  detectedAt: number;
  mitigationApplied: boolean;
}

export interface AlphaProtection {
  encryptionEnabled: boolean;
  obfuscationLevel: number;
  decoyOrders: boolean;
  timingRandomization: boolean;
  multiVenueScattering: boolean;
}

// Advanced AI Features
export interface TransformerXLConfig {
  sequenceLength: number;
  memoryLength: number;
  numLayers: number;
  numHeads: number;
  hiddenDim: number;
  ffDim: number;
  dropoutRate: number;
  attentionDropout: number;
  memoryDropout: number;
  adaptiveSpan: boolean;
  compressiveMemory: boolean;
}

export interface GraphNeuralNetworkConfig {
  nodeFeatures: number;
  edgeFeatures: number;
  hiddenDim: number;
  numLayers: number;
  aggregation: 'mean' | 'max' | 'sum' | 'attention';
  pooling: 'global' | 'hierarchical' | 'diff';
  dropoutRate: number;
}

export interface AdversarialTrainingConfig {
  enabled: boolean;
  selfPlayFrequency: number;
  adversaryStrength: number;
  explorationBonus: number;
  robustnessWeight: number;
  diversityReward: number;
}

// Mempool Analysis
export interface MempoolState {
  chain: string;
  pendingTransactions: number;
  avgGasPrice: bigint;
  congestionLevel: number;
  priorityFees: bigint[];
  largeTransactions: MempoolTransaction[];
  dexActivity: DexMempoolActivity;
}

export interface MempoolTransaction {
  hash: string;
  from: string;
  to: string;
  value: bigint;
  gasPrice: bigint;
  maxPriorityFee: bigint;
  input: string;
  decodedAction?: DecodedAction;
  impact?: MarketImpact;
}

export interface DecodedAction {
  type: 'swap' | 'addLiquidity' | 'removeLiquidity' | 'arbitrage' | 'liquidation';
  protocol: string;
  tokens: string[];
  amounts: bigint[];
  expectedPrice?: number;
}

export interface MarketImpact {
  priceImpact: number;
  liquidityChange: number;
  arbitrageOpportunity: boolean;
  frontRunRisk: number;
}

export interface DexMempoolActivity {
  swapCount: number;
  totalVolume: bigint;
  uniqueTraders: number;
  arbBots: string[];
  sandwichAttacks: number;
}

// Bridge Flow Analysis
export interface BridgeFlow {
  bridge: string;
  sourceChain: string;
  targetChain: string;
  token: string;
  volume24h: bigint;
  uniqueUsers: number;
  avgTransferSize: bigint;
  netFlow: bigint;
  trend: 'increasing' | 'decreasing' | 'stable';
}

export interface CrossChainOpportunity {
  type: 'arbitrage' | 'liquidity' | 'yield';
  chains: string[];
  estimatedProfit: number;
  requiredCapital: bigint;
  executionTime: number;
  riskScore: number;
  gasEstimate: bigint;
}

// Dark Venue Detection
export interface DarkVenue {
  id: string;
  type: 'darkpool' | 'hidden' | 'iceberg' | 'synthetic';
  estimatedLiquidity: number;
  detectionConfidence: number;
  accessMethod?: string;
  historicalFills: number;
}

export interface IcebergOrder {
  venue: string;
  symbol: string;
  side: 'buy' | 'sell';
  visibleSize: number;
  estimatedTotalSize: number;
  priceLevel: number;
  detectionMethod: string;
  confidence: number;
}

// System Vanguard State
export interface VanguardState {
  status: 'active' | 'defensive' | 'stealth' | 'aggressive';
  threats: AdversarialThreat[];
  alphaLeaks: AlphaLeak[];
  deceptionActive: boolean;
  performanceMode: PerformanceMode;
  lastAdaptation: number;
}

export enum PerformanceMode {
  ULTRA_LOW_LATENCY = 'ultra_low_latency',
  STEALTH = 'stealth',
  AGGRESSIVE = 'aggressive',
  DEFENSIVE = 'defensive',
  ADAPTIVE = 'adaptive'
}

// Model Evolution
export interface ModelEvolution {
  generation: number;
  parentModels: string[];
  mutations: Mutation[];
  fitness: number;
  validation: ValidationMetrics;
  deployed: boolean;
}

export interface Mutation {
  type: 'architecture' | 'hyperparameter' | 'strategy' | 'data';
  description: string;
  impact: number;
  successful: boolean;
}

export interface ValidationMetrics {
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  alphaDecay: number;
  robustness: number;
}

// Vanguard Events
export interface VanguardEvent {
  type: VanguardEventType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: number;
  data: any;
  action?: string;
}

export enum VanguardEventType {
  THREAT_DETECTED = 'threat_detected',
  ALPHA_LEAK = 'alpha_leak',
  MODEL_EVOLVED = 'model_evolved',
  LATENCY_SPIKE = 'latency_spike',
  DECEPTION_ACTIVATED = 'deception_activated',
  OPPORTUNITY_FOUND = 'opportunity_found',
  SYSTEM_ADAPTED = 'system_adapted'
}

// Configuration
export interface SystemVanguardConfig {
  // Latency
  latencyTargets: {
    p50: number;
    p99: number;
    p999: number;
    p9999: number;
  };
  
  // GPS Sync
  gpsSync: {
    enabled: boolean;
    device: string;
    requiredAccuracy: number;
  };
  
  // Adversarial
  adversarial: {
    detectionEnabled: boolean;
    autoCountermeasures: boolean;
    aggressiveness: number;
  };
  
  // Deception
  deception: DeceptionConfig;
  
  // Evolution
  evolution: {
    enabled: boolean;
    generationInterval: number;
    populationSize: number;
    eliteRatio: number;
  };
  
  // Data Sources
  mempool: {
    chains: string[];
    providers: string[];
    updateFrequency: number;
  };
  
  // Dark Venues
  darkVenues: {
    detection: boolean;
    participation: boolean;
    minSize: number;
  };
}

// Service Interface
export interface ISystemVanguardService {
  // Core
  initialize(): Promise<void>;
  getState(): VanguardState;
  setMode(mode: PerformanceMode): void;
  
  // Monitoring
  getLatencyMetrics(module?: string): LatencyMetrics[];
  detectThreats(): AdversarialThreat[];
  checkAlphaLeakage(): AlphaLeak[];
  
  // Execution
  executeWithDeception(order: any): Promise<ExecutionResult>;
  adaptStrategy(threat: AdversarialThreat): void;
  
  // Evolution
  evolveModels(): Promise<ModelEvolution>;
  validateEvolution(evolution: ModelEvolution): ValidationMetrics;
  
  // Data
  analyzeMempools(): MempoolState[];
  findCrossChainOpportunities(): CrossChainOpportunity[];
  detectDarkLiquidity(symbol: string): DarkVenue[];
} 