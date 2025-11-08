// AI Core Types - World-class Machine Learning Types for Trading
// Comprehensive type definitions for institutional-grade AI trading system

import { EventEmitter } from 'events';

// Core Model Types
export interface ModelConfig {
  id: string;
  name: string;
  type: ModelType;
  version: string;
  architecture: ModelArchitecture;
  hyperparameters: Record<string, any>; // Generic hyperparameters
  performance: ModelPerformance;
  metadata: ModelMetadata;
  status: ModelStatus;
}

export enum ModelType {
  TRANSFORMER = 'transformer',
  LSTM = 'lstm',
  GRU = 'gru',
  CNN = 'cnn',
  REINFORCEMENT = 'reinforcement',
  ENSEMBLE = 'ensemble',
  RANDOM_FOREST = 'random_forest',
  GRADIENT_BOOST = 'gradient_boost',
  NEURAL_NETWORK = 'neural_network'
}

export enum ModelStatus {
  TRAINING = 'training',
  VALIDATING = 'validating',
  READY = 'ready',
  DEPLOYED = 'deployed',
  FAILED = 'failed',
  DEPRECATED = 'deprecated'
}

// Transformer Architecture
export interface TransformerConfig {
  sequenceLength: number;      // 100-500 time steps
  embeddingDim: number;        // 256-512
  numHeads: number;            // 8-16
  numLayers: number;           // 4-8
  ffDim: number;               // 1024-2048
  dropoutRate: number;         // 0.1-0.3
  attentionDropout: number;    // 0.1-0.2
  warmupSteps: number;         // 1000-5000
  learningRate: number;        // 1e-4
  batchSize: number;           // 32-128
  maxGradNorm: number;         // 1.0
  labelSmoothing: number;      // 0.1
  useRelativePositions: boolean;
  useCausalMask: boolean;
}

// Reinforcement Learning
export interface RLEnvironment {
  stateSpace: StateSpace;
  actionSpace: ActionSpace;
  rewardFunction: RewardFunction;
  episodeLength: number;
  maxStepsPerEpisode: number;
  discountFactor: number;
  explorationStrategy: ExplorationStrategy;
}

export interface StateSpace {
  dimensions: number;
  features: StateFeatures;
  normalization: NormalizationMethod;
  history: number; // lookback periods
}

export interface StateFeatures {
  priceFeatures: string[];
  volumeFeatures: string[];
  technicalFeatures: string[];
  marketFeatures: string[];
  sentimentFeatures: string[];
  onChainFeatures: string[];
}

export interface ActionSpace {
  type: 'discrete' | 'continuous' | 'hybrid';
  actions: TradingAction[];
  positionSizing: PositionSizingMethod;
  constraints: ActionConstraints;
}

export interface TradingAction {
  type: 'buy' | 'sell' | 'hold' | 'close';
  confidence: number;
  size: number;
  stopLoss?: number;
  takeProfit?: number;
  timeInForce?: number;
}

export interface RewardFunction {
  type: 'sharpe' | 'sortino' | 'calmar' | 'custom';
  riskFreeRate: number;
  targetReturn: number;
  penaltyFactors: {
    drawdown: number;
    volatility: number;
    turnover: number;
    slippage: number;
  };
}

// Feature Engineering
export interface FeatureSet {
  timestamp: number;
  symbol: string;
  priceFeatures: PriceFeatures;
  volumeFeatures: VolumeFeatures;
  technicalFeatures: TechnicalFeatures;
  marketFeatures: MarketFeatures;
  sentimentFeatures: SentimentFeatures;
  onChainFeatures: OnChainFeatures;
  customFeatures: Record<string, number>;
}

export interface PriceFeatures {
  // Raw price data
  open: number;
  high: number;
  low: number;
  close: number;
  
  // Returns
  returns1m: number;
  returns5m: number;
  returns15m: number;
  returns1h: number;
  returns4h: number;
  returns1d: number;
  
  // Log returns
  logReturns: number[];
  
  // Price ratios
  hlRatio: number;  // high/low
  ocRatio: number;  // open/close
  
  // Volatility
  realizedVol1h: number;
  realizedVol24h: number;
  garchVol: number;
  
  // Microstructure
  bidAskSpread: number;
  midPrice: number;
  microPrice: number;
  
  // Price levels
  vwap: number;
  twap: number;
  percentileRank: number;
}

export interface VolumeFeatures {
  volume: number;
  volumeMA: number;
  volumeRatio: number;
  buyVolume: number;
  sellVolume: number;
  volumeImbalance: number;
  largeOrderRatio: number;
  
  // Volume profile
  volumeProfile: number[];
  poc: number; // point of control
  valueAreaHigh: number;
  valueAreaLow: number;
  
  // Order flow
  orderFlowImbalance: number;
  aggressiveBuyRatio: number;
  aggressiveSellRatio: number;
  
  // Liquidity
  liquidityScore: number;
  marketDepth: number;
  resilience: number;
}

export interface TechnicalFeatures {
  // Moving averages
  sma: Record<number, number>;
  ema: Record<number, number>;
  wma: Record<number, number>;
  
  // Momentum
  rsi: Record<number, number>;
  macd: MACDValues;
  stochastic: StochasticValues;
  momentum: Record<number, number>;
  roc: Record<number, number>;
  
  // Volatility
  atr: Record<number, number>;
  bollingerBands: BollingerBands;
  keltnerChannels: KeltnerChannels;
  
  // Trend
  adx: number;
  aroon: AroonValues;
  ichimoku: IchimokuValues;
  supertrend: SupertrendValues;
  
  // Volume-based
  obv: number;
  cmf: number;
  mfi: number;
  vwma: Record<number, number>;
  
  // Market structure
  pivotPoints: PivotPoints;
  fibonacciLevels: FibonacciLevels;
  marketProfile: MarketProfile;
}

// Technical Indicator Values
export interface MACDValues {
  macd: number;
  signal: number;
  histogram: number;
}

export interface StochasticValues {
  k: number;
  d: number;
}

export interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
  width: number;
  percentB: number;
}

export interface KeltnerChannels {
  upper: number;
  middle: number;
  lower: number;
}

export interface AroonValues {
  up: number;
  down: number;
  oscillator: number;
}

export interface IchimokuValues {
  tenkan: number;
  kijun: number;
  senkouA: number;
  senkouB: number;
  chikou: number;
}

export interface SupertrendValues {
  trend: 'up' | 'down';
  value: number;
}

export interface PivotPoints {
  r3: number;
  r2: number;
  r1: number;
  pivot: number;
  s1: number;
  s2: number;
  s3: number;
}

export interface FibonacciLevels {
  levels: Record<number, number>;
  trend: 'up' | 'down';
}

export interface MarketProfile {
  valueArea: [number, number];
  pointOfControl: number;
  balanceArea: [number, number];
}

// Market Features
export interface MarketFeatures {
  // Market regime
  regime: MarketRegime;
  trendStrength: number;
  volatilityRegime: 'low' | 'normal' | 'high' | 'extreme';
  
  // Cross-asset
  correlations: Record<string, number>;
  beta: Record<string, number>;
  
  // Market breadth
  advanceDeclineRatio: number;
  newHighsLows: number;
  percentAbove20MA: number;
  
  // Risk metrics
  vix: number;
  termStructure: number;
  creditSpread: number;
  
  // Macro
  dollarIndex: number;
  yieldCurve: number;
  commodityIndex: number;
}

export enum MarketRegime {
  BULL_QUIET = 'bull_quiet',
  BULL_VOLATILE = 'bull_volatile',
  BEAR_QUIET = 'bear_quiet',
  BEAR_VOLATILE = 'bear_volatile',
  RANGING = 'ranging',
  TRANSITION = 'transition'
}

// Sentiment Features
export interface SentimentFeatures {
  // Social sentiment
  twitterSentiment: number;
  redditSentiment: number;
  newsSentiment: number;
  
  // Sentiment metrics
  bullBearRatio: number;
  fearGreedIndex: number;
  putCallRatio: number;
  
  // Momentum
  socialVolume: number;
  mentionGrowth: number;
  viralScore: number;
  
  // Quality metrics
  sentimentConfidence: number;
  sentimentDispersion: number;
}

// On-chain Features
export interface OnChainFeatures {
  // Network metrics
  hashRate: number;
  difficulty: number;
  blockTime: number;
  
  // Transaction metrics
  transactionCount: number;
  transactionVolume: number;
  averageFee: number;
  
  // Supply metrics
  circulatingSupply: number;
  inflationRate: number;
  burnRate: number;
  
  // DeFi metrics
  tvl: number;
  dexVolume: number;
  stablecoinSupply: number;
  
  // Holder metrics
  activeAddresses: number;
  whaleActivity: number;
  exchangeInflow: number;
  exchangeOutflow: number;
  
  // Mining metrics
  minerRevenue: number;
  minerBalance: number;
  hashRibbons: number;
}

// Prediction Types
export interface PredictionResult {
  id: string;
  timestamp: number;
  symbol: string;
  modelId: string;
  predictions: Predictions;
  confidence: ConfidenceMetrics;
  features: FeatureImportance;
  metadata: PredictionMetadata;
}

export interface Predictions {
  // Price predictions
  priceDirection: 'up' | 'down' | 'neutral';
  priceTarget: number;
  priceRange: [number, number];
  
  // Returns predictions
  expectedReturn: number;
  returnDistribution: ReturnDistribution;
  
  // Timing predictions
  entryTiming: TimingSignal;
  exitTiming: TimingSignal;
  holdingPeriod: number;
  
  // Risk predictions
  volatilityForecast: number;
  drawdownRisk: number;
  tailRisk: number;
  
  // Trading signals
  signal: TradingSignal;
  alternativeSignals: TradingSignal[];
}

export interface ReturnDistribution {
  mean: number;
  median: number;
  std: number;
  skew: number;
  kurtosis: number;
  percentiles: Record<number, number>;
  var: number; // Value at Risk
  cvar: number; // Conditional VaR
}

export interface TimingSignal {
  timestamp: number;
  confidence: number;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  window: [number, number]; // time window
}

export interface TradingSignal {
  action: TradingAction;
  strength: number; // 0-1
  stopLoss: number;
  takeProfit: number[];
  riskReward: number;
  kellyFraction: number;
}

export interface ConfidenceMetrics {
  overall: number;
  direction: number;
  magnitude: number;
  timing: number;
  modelAgreement: number;
  predictionInterval: [number, number];
}

export interface FeatureImportance {
  global: Record<string, number>;
  local: Record<string, number>;
  shap: Record<string, number>;
  interactions: FeatureInteraction[];
}

export interface FeatureInteraction {
  features: [string, string];
  importance: number;
  type: 'synergistic' | 'redundant';
}

// Model Performance
export interface ModelPerformance {
  // Accuracy metrics
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  auc: number;
  
  // Trading metrics
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  
  // Statistical metrics
  mse: number;
  mae: number;
  rmse: number;
  mape: number;
  r2: number;
  
  // Directional metrics
  directionalAccuracy: number;
  upAccuracy: number;
  downAccuracy: number;
  
  // Risk metrics
  var95: number;
  cvar95: number;
  tailRatio: number;
  
  // Robustness metrics
  stabilityScore: number;
  consistencyScore: number;
  outOfSamplePerformance: number;
}

// Training Configuration
export interface TrainingConfig {
  // Data configuration
  dataConfig: DataConfig;
  
  // Model configuration
  modelConfig: ModelArchitecture;
  
  // Training parameters
  trainingParams: TrainingParameters;
  
  // Validation configuration
  validationConfig: ValidationConfig;
  
  // Optimization
  optimization: OptimizationConfig;
  
  // Hardware
  hardware: HardwareConfig;
}

export interface DataConfig {
  sources: DataSource[];
  features: string[];
  target: string;
  sequenceLength: number;
  batchSize: number;
  shuffle: boolean;
  augmentation: DataAugmentation;
  preprocessing: PreprocessingConfig;
}

export interface DataSource {
  type: 'price' | 'volume' | 'orderbook' | 'trades' | 'sentiment' | 'onchain';
  provider: string;
  symbols: string[];
  timeframe: string;
  startDate: Date;
  endDate: Date;
}

export interface DataAugmentation {
  enabled: boolean;
  methods: AugmentationMethod[];
  noiseLevel: number;
  syntheticRatio: number;
}

export enum AugmentationMethod {
  NOISE_INJECTION = 'noise_injection',
  TIME_WARPING = 'time_warping',
  MAGNITUDE_WARPING = 'magnitude_warping',
  WINDOW_SLICING = 'window_slicing',
  MIXUP = 'mixup',
  SMOTE = 'smote'
}

export interface PreprocessingConfig {
  normalization: NormalizationMethod;
  outlierHandling: OutlierMethod;
  missingData: MissingDataMethod;
  featureEngineering: FeatureEngineeringConfig;
}

export enum NormalizationMethod {
  STANDARD = 'standard',
  MINMAX = 'minmax',
  ROBUST = 'robust',
  QUANTILE = 'quantile',
  LOG = 'log',
  ADAPTIVE = 'adaptive'
}

export enum OutlierMethod {
  CLIP = 'clip',
  REMOVE = 'remove',
  WINSORIZE = 'winsorize',
  TRANSFORM = 'transform'
}

export enum MissingDataMethod {
  DROP = 'drop',
  FORWARD_FILL = 'forward_fill',
  INTERPOLATE = 'interpolate',
  MEAN = 'mean',
  MEDIAN = 'median',
  MODEL = 'model'
}

export interface FeatureEngineeringConfig {
  polynomial: boolean;
  interactions: boolean;
  lags: number[];
  rollingWindows: number[];
  technicalIndicators: string[];
  customFeatures: CustomFeature[];
}

export interface CustomFeature {
  name: string;
  formula: string;
  dependencies: string[];
}

// Model Architecture
export interface ModelArchitecture {
  type: ModelType;
  layers: LayerConfig[];
  optimizer: OptimizerConfig;
  loss: LossConfig;
  metrics: string[];
  regularization: RegularizationConfig;
}

export interface LayerConfig {
  type: string;
  units?: number;
  activation?: string;
  dropout?: number;
  recurrentDropout?: number;
  kernelRegularizer?: any;
  biasRegularizer?: any;
  activityRegularizer?: any;
}

export interface OptimizerConfig {
  type: 'adam' | 'sgd' | 'rmsprop' | 'adamw' | 'lamb';
  learningRate: number | LearningRateSchedule;
  beta1?: number;
  beta2?: number;
  epsilon?: number;
  momentum?: number;
  weightDecay?: number;
  clipNorm?: number;
  clipValue?: number;
}

export interface LearningRateSchedule {
  type: 'constant' | 'exponential' | 'cosine' | 'warmup' | 'cyclic';
  initialLearningRate: number;
  decaySteps?: number;
  decayRate?: number;
  warmupSteps?: number;
  minLearningRate?: number;
  maxLearningRate?: number;
}

export interface LossConfig {
  type: string;
  parameters?: Record<string, any>;
  weights?: Record<string, number>;
  customLoss?: string;
}

export interface RegularizationConfig {
  l1?: number;
  l2?: number;
  dropout?: number;
  dropoutSchedule?: DropoutSchedule;
  earlyStop: EarlyStopConfig;
  gradientClipping?: number;
}

export interface DropoutSchedule {
  initial: number;
  final: number;
  epochs: number;
}

export interface EarlyStopConfig {
  monitor: string;
  patience: number;
  minDelta: number;
  mode: 'min' | 'max';
  restoreBestWeights: boolean;
}

// Training Parameters
export interface TrainingParameters {
  epochs: number;
  stepsPerEpoch: number;
  validationSteps: number;
  callbacks: CallbackConfig[];
  checkpointing: CheckpointConfig;
  tensorboard: TensorBoardConfig;
  distributed: DistributedConfig;
}

export interface CallbackConfig {
  type: string;
  parameters: Record<string, any>;
}

export interface CheckpointConfig {
  enabled: boolean;
  frequency: number;
  path: string;
  saveWeightsOnly: boolean;
  saveBestOnly: boolean;
  monitor: string;
}

export interface TensorBoardConfig {
  enabled: boolean;
  logDir: string;
  updateFreq: string | number;
  histogram: boolean;
  profile: boolean;
  embeddings: boolean;
}

export interface DistributedConfig {
  enabled: boolean;
  strategy: 'mirrored' | 'multiworker' | 'tpu';
  devices: string[];
  communication: 'ring' | 'nccl' | 'auto';
}

// Validation Configuration
export interface ValidationConfig {
  method: ValidationMethod;
  splits: number;
  testSize: number;
  gap: number; // temporal gap for time series
  purge: boolean;
  embargo: number;
  scoring: string[];
}

export enum ValidationMethod {
  HOLDOUT = 'holdout',
  KFOLD = 'kfold',
  TIME_SERIES_SPLIT = 'time_series_split',
  WALK_FORWARD = 'walk_forward',
  COMBINATORIAL = 'combinatorial'
}

// Optimization Configuration
export interface OptimizationConfig {
  hyperparameterTuning: HyperparameterTuning;
  ensembling: EnsemblingConfig;
  pruning: PruningConfig;
  quantization: QuantizationConfig;
}

export interface HyperparameterTuning {
  enabled: boolean;
  method: 'grid' | 'random' | 'bayesian' | 'genetic' | 'hyperband';
  parameters: Record<string, any>;
  trials: number;
  objective: string;
  earlyStopping: boolean;
}

export interface EnsemblingConfig {
  enabled: boolean;
  method: 'voting' | 'stacking' | 'blending' | 'bayesian';
  models: string[];
  weights?: number[];
  metaLearner?: string;
}

export interface PruningConfig {
  enabled: boolean;
  method: 'magnitude' | 'structured' | 'unstructured';
  sparsity: number;
  fineTune: boolean;
}

export interface QuantizationConfig {
  enabled: boolean;
  method: 'dynamic' | 'static' | 'qat';
  bits: number;
  calibration: number;
}

// Hardware Configuration
export interface HardwareConfig {
  device: 'cpu' | 'gpu' | 'tpu';
  gpuMemoryFraction?: number;
  mixedPrecision: boolean;
  xla: boolean;
  parallelIterations: number;
}

// Model Metadata
export interface ModelMetadata {
  id: string;
  name: string;
  description: string;
  version: string;
  created: Date;
  updated: Date;
  author: string;
  tags: string[];
  framework: string;
  language: string;
  dependencies: Record<string, string>;
  performance: ModelPerformance;
  deployment: DeploymentInfo;
}

export interface DeploymentInfo {
  environment: 'development' | 'staging' | 'production';
  endpoint: string;
  region: string;
  replicas: number;
  autoscaling: boolean;
  monitoring: boolean;
}

// Prediction Metadata
export interface PredictionMetadata {
  modelVersion: string;
  inferenceTime: number;
  preprocessingTime: number;
  postprocessingTime: number;
  dataQuality: DataQualityMetrics;
  anomalyScore: number;
  explanations?: ModelExplanation;
}

export interface DataQualityMetrics {
  completeness: number;
  validity: number;
  consistency: number;
  timeliness: number;
  uniqueness: number;
  accuracy: number;
}

export interface ModelExplanation {
  method: 'shap' | 'lime' | 'gradcam' | 'attention';
  globalImportance: Record<string, number>;
  localImportance: Record<string, number>;
  interactions: FeatureInteraction[];
  visualization?: string; // base64 encoded image
}

// Reinforcement Learning Specific
export interface RLConfig extends TrainingConfig {
  environment: RLEnvironment;
  algorithm: RLAlgorithm;
  hyperparameters: RLHyperparameters;
  exploration: ExplorationStrategy;
  memory: MemoryConfig;
}

export enum RLAlgorithm {
  DQN = 'dqn',
  DOUBLE_DQN = 'double_dqn',
  DUELING_DQN = 'dueling_dqn',
  A3C = 'a3c',
  PPO = 'ppo',
  SAC = 'sac',
  TD3 = 'td3',
  RAINBOW = 'rainbow'
}

export interface RLHyperparameters {
  gamma: number; // discount factor
  tau: number; // soft update parameter
  bufferSize: number;
  batchSize: number;
  updateFrequency: number;
  targetUpdateFrequency: number;
  gradientSteps: number;
  learningStarts: number;
  prioritizedReplay: boolean;
  priorityAlpha: number;
  priorityBeta: number;
}

export interface ExplorationStrategy {
  type: 'epsilon_greedy' | 'boltzmann' | 'ucb' | 'thompson' | 'parameter_noise';
  initialValue: number;
  finalValue: number;
  decaySteps: number;
  temperature?: number;
  c?: number; // UCB parameter
}

export interface MemoryConfig {
  type: 'uniform' | 'prioritized' | 'hindsight';
  capacity: number;
  alpha?: number; // prioritization exponent
  beta?: number; // importance sampling
  n_step?: number; // n-step returns
}

// Position Sizing
export enum PositionSizingMethod {
  FIXED = 'fixed',
  KELLY = 'kelly',
  RISK_PARITY = 'risk_parity',
  VOLATILITY_TARGETING = 'volatility_targeting',
  MACHINE_LEARNING = 'machine_learning'
}

export interface ActionConstraints {
  maxPosition: number;
  maxLeverage: number;
  minHoldingPeriod: number;
  maxHoldingPeriod: number;
  stopLoss: number;
  maxDrawdown: number;
  maxTurnover: number;
}

// Fractal Pattern Detection
export interface FractalPattern {
  type: FractalType;
  scale: number;
  dimension: number;
  persistence: number;
  location: [number, number]; // time range
  confidence: number;
  predictivePower: number;
}

export enum FractalType {
  ELLIOTT_WAVE = 'elliott_wave',
  HARMONIC = 'harmonic',
  WYCKOFF = 'wyckoff',
  MARKET_PROFILE = 'market_profile',
  CUSTOM = 'custom'
}

// Cross-Market Correlation
export interface CrossMarketAnalysis {
  timestamp: number;
  correlationMatrix: number[][];
  leadLagRelationships: LeadLagRelation[];
  regimeAlignment: RegimeAlignment;
  contagionRisk: number;
  diversificationBenefit: number;
}

export interface LeadLagRelation {
  leader: string;
  follower: string;
  lag: number; // in periods
  correlation: number;
  granger: GrangerCausality;
}

export interface GrangerCausality {
  fStatistic: number;
  pValue: number;
  significant: boolean;
  lag: number;
}

export interface RegimeAlignment {
  assets: string[];
  currentRegimes: Record<string, MarketRegime>;
  alignment: number; // 0-1
  divergences: string[];
}

// Service Interfaces
export interface MLService {
  train(config: TrainingConfig): Promise<ModelConfig>;
  predict(features: FeatureSet): Promise<PredictionResult>;
  evaluate(testData: any): Promise<ModelPerformance>;
  optimize(config: OptimizationConfig): Promise<ModelConfig>;
  deploy(modelId: string, environment: string): Promise<DeploymentInfo>;
  monitor(modelId: string): ModelPerformance;
  explain(prediction: PredictionResult): ModelExplanation;
}

// Event Types
export interface MLEvents {
  'modelTrained': (model: ModelConfig) => void;
  'predictionMade': (prediction: PredictionResult) => void;
  'anomalyDetected': (anomaly: AnomalyEvent) => void;
  'driftDetected': (drift: DriftEvent) => void;
  'retrainRequired': (reason: string) => void;
  'performanceUpdate': (performance: ModelPerformance) => void;
}

export interface AnomalyEvent {
  timestamp: number;
  type: 'feature' | 'prediction' | 'market';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  affectedFeatures: string[];
  anomalyScore: number;
}

export interface DriftEvent {
  timestamp: number;
  type: 'concept' | 'data' | 'prediction';
  magnitude: number;
  features: string[];
  action: 'monitor' | 'retrain' | 'alert';
}

// Error Handling
export enum MLErrorCode {
  INSUFFICIENT_DATA = 'ML001',
  MODEL_NOT_FOUND = 'ML002',
  TRAINING_FAILED = 'ML003',
  PREDICTION_FAILED = 'ML004',
  INVALID_FEATURES = 'ML005',
  MODEL_DRIFT = 'ML006',
  HARDWARE_ERROR = 'ML007',
  TIMEOUT = 'ML008',
  INVALID_CONFIG = 'ML009',
  DEPLOYMENT_FAILED = 'ML010'
}

export class MLError extends Error {
  constructor(
    public code: MLErrorCode,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'MLError';
  }
}

// Utility Types
export type FeatureVector = number[];
export type PredictionConfidence = number; // 0-1
export type ModelId = string;
export type Timestamp = number;
export type Symbol = string; 