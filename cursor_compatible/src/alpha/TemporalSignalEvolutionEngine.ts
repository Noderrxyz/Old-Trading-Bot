import { AlphaFrame } from '../alphasources/types.js';
import { 
  TemporalEvolutionConfig, 
  TemporalEvolutionReport, 
  DetectedPhaseShift,
  AlphaLabel,
  SignalPhase 
} from './types/temporal.types.js';
import { DEFAULT_TEMPORAL_EVOLUTION_CONFIG } from './config/temporal.config.js';
import { createLogger } from '../common/logger.js';
import { RedisClient } from '../infra/core/RedisClient.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Engine for analyzing how signals evolve over time and detecting phase shifts
 */
export class TemporalSignalEvolutionEngine {
  private readonly logger = createLogger('TemporalSignalEvolutionEngine');
  private readonly signalHistory: Map<string, AlphaFrame[]> = new Map();
  private readonly lastPhaseShifts: Map<string, DetectedPhaseShift> = new Map();
  private readonly currentLabels: Map<string, AlphaLabel> = new Map();
  
  /**
   * Create a new temporal signal evolution engine
   * @param config Configuration options
   * @param redis Redis client for persistence
   */
  constructor(
    private readonly config: TemporalEvolutionConfig = DEFAULT_TEMPORAL_EVOLUTION_CONFIG,
    private readonly redis?: RedisClient
  ) {
    if (!config.enabled) {
      this.logger.warn('Temporal signal evolution is disabled');
    }
  }
  
  /**
   * Update signal history with new batch of signals
   * @param signalBatch New signals to process
   */
  public async update(signalBatch: AlphaFrame[]): Promise<void> {
    if (!this.config.enabled) return;
    
    try {
      // Group signals by ID
      const signalGroups = this.groupSignalsBySource(signalBatch);
      
      // Update history for each signal
      for (const [signalId, signals] of signalGroups.entries()) {
        await this.updateSignalHistory(signalId, signals);
      }
      
      // Analyze temporal patterns
      const report = await this.analyzeTemporalPatterns();
      
      // Store report
      await this.storeReport(report);
      
      this.logger.debug(`Updated ${signalBatch.length} signals from ${signalGroups.size} sources`);
    } catch (error) {
      this.logger.error(`Error updating signals: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Analyze temporal patterns across all signals
   * @returns Analysis report
   */
  public async analyzeTemporalPatterns(): Promise<TemporalEvolutionReport> {
    const timestamp = Date.now();
    const labels: AlphaLabel[] = [];
    const phaseShifts: DetectedPhaseShift[] = [];
    
    // Analyze each signal
    for (const [signalId, history] of this.signalHistory.entries()) {
      // Skip if not enough history
      if (history.length < this.config.driftDetection.windowSize) {
        continue;
      }
      
      // Calculate metrics
      const metrics = this.calculateSignalMetrics(history);
      
      // Determine current phase
      const currentPhase = this.determineSignalPhase(metrics);
      
      // Create label
      const label: AlphaLabel = {
        signalId,
        currentPhase,
        stabilityScore: metrics.stabilityScore,
        driftScore: metrics.driftScore,
        timestamp,
        metadata: {
          trendStrength: metrics.trendStrength,
          meanReversionStrength: metrics.meanReversionStrength,
          sampleSize: history.length
        }
      };
      
      // Check for phase shift
      const lastLabel = this.currentLabels.get(signalId);
      if (lastLabel && lastLabel.currentPhase !== currentPhase) {
        const shift = this.detectPhaseShift(lastLabel, label, metrics);
        if (shift) {
          phaseShifts.push(shift);
          this.lastPhaseShifts.set(signalId, shift);
        }
      }
      
      labels.push(label);
      this.currentLabels.set(signalId, label);
    }
    
    // Calculate system metrics
    const systemMetrics = this.calculateSystemMetrics(labels);
    
    return {
      timestamp,
      labels,
      phaseShifts,
      systemMetrics
    };
  }
  
  /**
   * Get detected phase shifts
   * @returns List of detected phase shifts
   */
  public getDetectedPhaseShifts(): DetectedPhaseShift[] {
    return Array.from(this.lastPhaseShifts.values());
  }
  
  /**
   * Get current label for a signal
   * @param signalId Signal identifier
   * @returns Current label or null if not found
   */
  public getCurrentLabel(signalId: string): AlphaLabel | null {
    return this.currentLabels.get(signalId) || null;
  }
  
  /**
   * Group signals by their source ID
   * @param signals Signals to group
   * @returns Map of signal ID to signals
   */
  private groupSignalsBySource(signals: AlphaFrame[]): Map<string, AlphaFrame[]> {
    const groups = new Map<string, AlphaFrame[]>();
    
    for (const signal of signals) {
      const signalId = `${signal.source}_${signal.symbol}`;
      const group = groups.get(signalId) || [];
      group.push(signal);
      groups.set(signalId, group);
    }
    
    return groups;
  }
  
  /**
   * Update history for a signal
   * @param signalId Signal identifier
   * @param signals New signals
   */
  private async updateSignalHistory(signalId: string, signals: AlphaFrame[]): Promise<void> {
    // Get existing history
    let history = this.signalHistory.get(signalId) || [];
    
    // Add new signals
    history = [...history, ...signals];
    
    // Sort by timestamp
    history.sort((a, b) => a.timestamp - b.timestamp);
    
    // Trim to window size
    if (history.length > this.config.driftDetection.windowSize) {
      history = history.slice(history.length - this.config.driftDetection.windowSize);
    }
    
    // Update history
    this.signalHistory.set(signalId, history);
    
    // Persist to Redis if available
    if (this.redis) {
      const key = `temporal:history:${signalId}`;
      const serializedSignals = signals.map(s => JSON.stringify(s));
      await this.redis.lpush(key, serializedSignals.join('\n'));
      await this.redis.ltrim(key, 0, this.config.driftDetection.windowSize - 1);
    }
  }
  
  /**
   * Calculate metrics for a signal
   * @param history Signal history
   * @returns Signal metrics
   */
  private calculateSignalMetrics(history: AlphaFrame[]): {
    stabilityScore: number;
    driftScore: number;
    trendStrength: number;
    meanReversionStrength: number;
  } {
    const scores = history.map(s => s.score);
    const confidences = history.map(s => s.confidence);
    
    // Calculate stability (inverse of volatility)
    const stabilityScore = 1 - this.calculateVolatility(scores);
    
    // Calculate drift from original behavior
    const driftScore = this.calculateDrift(scores);
    
    // Calculate trend strength
    const trendStrength = this.calculateTrendStrength(scores);
    
    // Calculate mean reversion strength
    const meanReversionStrength = this.calculateMeanReversionStrength(scores);
    
    return {
      stabilityScore,
      driftScore,
      trendStrength,
      meanReversionStrength
    };
  }
  
  /**
   * Calculate volatility of a series
   * @param values Series of values
   * @returns Volatility score (0-1)
   */
  private calculateVolatility(values: number[]): number {
    if (values.length < 2) return 0;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    
    return Math.min(1, Math.sqrt(variance));
  }
  
  /**
   * Calculate drift from original behavior
   * @param values Series of values
   * @returns Drift score (0-1)
   */
  private calculateDrift(values: number[]): number {
    if (values.length < this.config.driftDetection.windowSize) return 0;
    
    // Split into two windows
    const mid = Math.floor(values.length / 2);
    const firstHalf = values.slice(0, mid);
    const secondHalf = values.slice(mid);
    
    // Calculate means and standard deviations
    const mean1 = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const mean2 = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    const std1 = Math.sqrt(firstHalf.reduce((a, b) => a + Math.pow(b - mean1, 2), 0) / firstHalf.length);
    const std2 = Math.sqrt(secondHalf.reduce((a, b) => a + Math.pow(b - mean2, 2), 0) / secondHalf.length);
    
    // Calculate drift as combination of mean shift and volatility change
    const meanShift = Math.abs(mean2 - mean1) / Math.max(Math.abs(mean1), 0.0001);
    const volChange = Math.abs(std2 - std1) / Math.max(std1, 0.0001);
    
    return Math.min(1, (meanShift + volChange) / 2);
  }
  
  /**
   * Calculate trend strength
   * @param values Series of values
   * @returns Trend strength (0-1)
   */
  private calculateTrendStrength(values: number[]): number {
    if (values.length < 2) return 0;
    
    let momentum = 0;
    for (let i = 1; i < values.length; i++) {
      momentum += Math.sign(values[i] - values[i-1]);
    }
    
    return Math.abs(momentum) / (values.length - 1);
  }
  
  /**
   * Calculate mean reversion strength
   * @param values Series of values
   * @returns Mean reversion strength (0-1)
   */
  private calculateMeanReversionStrength(values: number[]): number {
    if (values.length < 2) return 0;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    let reversionCount = 0;
    
    for (let i = 1; i < values.length; i++) {
      const prevDiff = values[i-1] - mean;
      const currDiff = values[i] - mean;
      if (Math.sign(prevDiff) !== Math.sign(currDiff)) {
        reversionCount++;
      }
    }
    
    return reversionCount / (values.length - 1);
  }
  
  /**
   * Determine current phase of a signal
   * @param metrics Signal metrics
   * @returns Current phase
   */
  private determineSignalPhase(metrics: {
    stabilityScore: number;
    driftScore: number;
    trendStrength: number;
    meanReversionStrength: number;
  }): SignalPhase {
    const { stabilityScore, driftScore, trendStrength, meanReversionStrength } = metrics;
    
    // Check for decay
    if (driftScore > this.config.driftDetection.driftThreshold) {
      return SignalPhase.DECAY;
    }
    
    // Check for instability
    if (stabilityScore < 0.3) {
      return SignalPhase.UNSTABLE;
    }
    
    // Determine between trending and mean reverting
    if (trendStrength > 0.6 && meanReversionStrength < 0.3) {
      return SignalPhase.TRENDING;
    } else if (meanReversionStrength > 0.6 && trendStrength < 0.3) {
      return SignalPhase.MEAN_REVERTING;
    }
    
    return SignalPhase.UNKNOWN;
  }
  
  /**
   * Detect phase shift between labels
   * @param oldLabel Previous label
   * @param newLabel Current label
   * @param metrics Current metrics
   * @returns Phase shift if detected, null otherwise
   */
  private detectPhaseShift(
    oldLabel: AlphaLabel,
    newLabel: AlphaLabel,
    metrics: {
      stabilityScore: number;
      driftScore: number;
      trendStrength: number;
      meanReversionStrength: number;
    }
  ): DetectedPhaseShift | null {
    // Check cooloff period
    const lastShift = this.lastPhaseShifts.get(newLabel.signalId);
    if (lastShift && 
        newLabel.timestamp - lastShift.timestamp < this.config.phaseShiftDetection.cooloffPeriodSeconds * 1000) {
      return null;
    }
    
    // Calculate shift magnitude
    const magnitude = Math.abs(newLabel.stabilityScore - oldLabel.stabilityScore) +
                     Math.abs(newLabel.driftScore - oldLabel.driftScore);
    
    // Check minimum magnitude
    if (magnitude < this.config.phaseShiftDetection.minShiftMagnitude) {
      return null;
    }
    
    // Calculate confidence based on metrics stability
    const confidence = metrics.stabilityScore * (1 - metrics.driftScore);
    
    return {
      signalId: newLabel.signalId,
      previousPhase: oldLabel.currentPhase,
      newPhase: newLabel.currentPhase,
      magnitude,
      timestamp: newLabel.timestamp,
      confidence,
      metrics
    };
  }
  
  /**
   * Calculate system-wide metrics
   * @param labels Current labels
   * @returns System metrics
   */
  private calculateSystemMetrics(labels: AlphaLabel[]): {
    phaseDistribution: Record<SignalPhase, number>;
    avgStability: number;
    avgDrift: number;
    signalCount: number;
  } {
    if (labels.length === 0) {
      return {
        phaseDistribution: {
          [SignalPhase.TRENDING]: 0,
          [SignalPhase.MEAN_REVERTING]: 0,
          [SignalPhase.DECAY]: 0,
          [SignalPhase.UNSTABLE]: 0,
          [SignalPhase.UNKNOWN]: 0
        },
        avgStability: 0,
        avgDrift: 0,
        signalCount: 0
      };
    }
    
    // Calculate phase distribution
    const phaseCounts = labels.reduce((counts, label) => {
      counts[label.currentPhase] = (counts[label.currentPhase] || 0) + 1;
      return counts;
    }, {
      [SignalPhase.TRENDING]: 0,
      [SignalPhase.MEAN_REVERTING]: 0,
      [SignalPhase.DECAY]: 0,
      [SignalPhase.UNSTABLE]: 0,
      [SignalPhase.UNKNOWN]: 0
    } as Record<SignalPhase, number>);
    
    const phaseDistribution = Object.fromEntries(
      Object.values(SignalPhase).map(phase => [
        phase,
        (phaseCounts[phase] || 0) / labels.length
      ])
    ) as Record<SignalPhase, number>;
    
    // Calculate averages
    const avgStability = labels.reduce((sum, l) => sum + l.stabilityScore, 0) / labels.length;
    const avgDrift = labels.reduce((sum, l) => sum + l.driftScore, 0) / labels.length;
    
    return {
      phaseDistribution,
      avgStability,
      avgDrift,
      signalCount: labels.length
    };
  }
  
  /**
   * Store evolution report
   * @param report Report to store
   */
  private async storeReport(report: TemporalEvolutionReport): Promise<void> {
    if (!this.redis) return;
    
    try {
      // Store full report
      const reportId = uuidv4();
      const reportKey = `temporal:report:${reportId}`;
      await this.redis.set(reportKey, JSON.stringify(report));
      
      // Store latest labels by signal
      for (const label of report.labels) {
        const labelKey = `temporal:label:${label.signalId}`;
        await this.redis.set(labelKey, JSON.stringify(label));
      }
      
      // Store phase shifts
      for (const shift of report.phaseShifts) {
        const shiftKey = `temporal:shift:${shift.signalId}`;
        await this.redis.lpush(shiftKey, JSON.stringify(shift));
        await this.redis.ltrim(shiftKey, 0, 99); // Keep last 100 shifts
      }
      
      // Store system metrics
      const metricsKey = 'temporal:metrics';
      await this.redis.lpush(metricsKey, JSON.stringify(report.systemMetrics));
      await this.redis.ltrim(metricsKey, 0, 999); // Keep last 1000 metrics
      
      this.logger.debug(`Stored temporal evolution report ${reportId}`);
    } catch (error) {
      this.logger.error(`Error storing report: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} 