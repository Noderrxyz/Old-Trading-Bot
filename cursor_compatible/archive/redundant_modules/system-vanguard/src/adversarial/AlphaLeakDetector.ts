/**
 * AlphaLeakDetector - Elite alpha protection and strategy leak detection
 * 
 * Detects and prevents strategy copying, alpha decay, and information leakage
 * through correlation analysis, pattern matching, and behavioral monitoring.
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import { AlphaLeak, AlphaProtection } from '../types';

interface ExecutionRecord {
  timestamp: number;
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  size: number;
  price: number;
  venue: string;
  strategy: string;
  features: number[];
  outcome: number; // profit/loss
}

interface CorrelationData {
  actor: string;
  correlation: number;
  lag: number; // milliseconds
  confidence: number;
  samples: number;
}

interface PatternSignature {
  id: string;
  pattern: number[];
  frequency: number;
  uniqueness: number;
  lastSeen: number;
}

export class AlphaLeakDetector extends EventEmitter {
  private logger: Logger;
  private executionHistory: ExecutionRecord[] = [];
  private patternSignatures: Map<string, PatternSignature> = new Map();
  private correlationMatrix: Map<string, CorrelationData[]> = new Map();
  private detectedLeaks: Map<string, AlphaLeak> = new Map();
  private sensitivity: number = 0.7;
  private maximalProtection: boolean = false;
  private highSensitivity: boolean = false;
  
  // Detection parameters
  private readonly CORRELATION_THRESHOLD = 0.7;
  private readonly MIN_SAMPLES = 20;
  private readonly PATTERN_WINDOW = 100; // trades
  private readonly TIME_WINDOW = 3600000; // 1 hour
  private readonly LEAKAGE_RATE_THRESHOLD = 0.1; // bits per trade
  
  constructor(logger: Logger) {
    super();
    this.logger = logger;
  }
  
  /**
   * Initialize the alpha leak detector
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing AlphaLeakDetector');
    
    // Start continuous monitoring
    this.startLeakDetection();
    
    // Load historical patterns if available
    await this.loadHistoricalPatterns();
  }
  
  /**
   * Detect alpha leaks
   */
  detectLeaks(): AlphaLeak[] {
    const leaks: AlphaLeak[] = [];
    
    // Analyze execution patterns
    const executionLeaks = this.detectExecutionLeaks();
    leaks.push(...executionLeaks);
    
    // Analyze prediction patterns
    const predictionLeaks = this.detectPredictionLeaks();
    leaks.push(...predictionLeaks);
    
    // Analyze behavioral patterns
    const patternLeaks = this.detectPatternLeaks();
    leaks.push(...patternLeaks);
    
    // Update detected leaks
    leaks.forEach(leak => {
      this.detectedLeaks.set(leak.id, leak);
      this.emit('leakDetected', leak);
    });
    
    return leaks;
  }
  
  /**
   * Track execution for leak detection
   */
  trackExecution(order: any, result: any): void {
    const record: ExecutionRecord = {
      timestamp: Date.now(),
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      size: order.size,
      price: result.price,
      venue: order.venue,
      strategy: order.strategy || 'unknown',
      features: this.extractFeatures(order),
      outcome: result.pnl || 0
    };
    
    this.executionHistory.push(record);
    
    // Keep only recent history
    const cutoff = Date.now() - this.TIME_WINDOW * 2;
    this.executionHistory = this.executionHistory.filter(r => r.timestamp > cutoff);
    
    // Update pattern signatures
    this.updatePatternSignatures(record);
    
    // Check for immediate correlations
    this.updateCorrelations(record);
  }
  
  /**
   * Increase sensitivity
   */
  increaseSensitivity(): void {
    this.sensitivity = Math.min(1.0, this.sensitivity * 1.2);
    this.logger.info(`Alpha leak detection sensitivity increased to ${this.sensitivity}`);
  }
  
  /**
   * Set high sensitivity mode
   */
  setHighSensitivity(): void {
    this.highSensitivity = true;
    this.sensitivity = 0.9;
    this.logger.info('High sensitivity alpha leak detection enabled');
  }
  
  /**
   * Set maximal protection
   */
  setMaximalProtection(): void {
    this.maximalProtection = true;
    this.sensitivity = 1.0;
    this.highSensitivity = true;
    this.logger.info('Maximal alpha protection enabled');
  }
  
  /**
   * Get protection recommendations
   */
  getProtectionRecommendations(): AlphaProtection {
    const leakCount = this.detectedLeaks.size;
    const recentLeaks = Array.from(this.detectedLeaks.values())
      .filter(leak => Date.now() - leak.detectedAt < 3600000).length;
    
    return {
      encryptionEnabled: leakCount > 0,
      obfuscationLevel: Math.min(1.0, leakCount * 0.2),
      decoyOrders: recentLeaks > 2,
      timingRandomization: this.hasTimingLeaks(),
      multiVenueScattering: this.hasVenueLeaks()
    };
  }
  
  /**
   * Private: Start leak detection
   */
  private startLeakDetection(): void {
    // Run detection every 30 seconds
    setInterval(() => {
      const leaks = this.detectLeaks();
      if (leaks.length > 0) {
        this.logger.warn(`Detected ${leaks.length} alpha leaks`);
      }
    }, 30000);
  }
  
  /**
   * Private: Load historical patterns
   */
  private async loadHistoricalPatterns(): Promise<void> {
    // In production, this would load from a database
    this.logger.info('Historical patterns loaded');
  }
  
  /**
   * Private: Detect execution leaks
   */
  private detectExecutionLeaks(): AlphaLeak[] {
    const leaks: AlphaLeak[] = [];
    
    // Group executions by time windows
    const timeWindows = this.groupByTimeWindow(this.executionHistory);
    
    // Check each window for suspicious patterns
    for (const [windowStart, executions] of timeWindows) {
      const leak = this.analyzeExecutionWindow(executions);
      if (leak) {
        leaks.push(leak);
      }
    }
    
    return leaks;
  }
  
  /**
   * Private: Detect prediction leaks
   */
  private detectPredictionLeaks(): AlphaLeak[] {
    const leaks: AlphaLeak[] = [];
    
    // Analyze prediction accuracy decay
    const accuracyDecay = this.calculateAccuracyDecay();
    
    if (accuracyDecay > 0.1) { // 10% decay
      const leak: AlphaLeak = {
        id: `pred_leak_${Date.now()}`,
        type: 'prediction',
        leakageRate: accuracyDecay,
        suspectedCopiers: this.identifyCopiers('prediction'),
        correlationStrength: accuracyDecay,
        detectedAt: Date.now(),
        mitigationApplied: false
      };
      
      leaks.push(leak);
    }
    
    return leaks;
  }
  
  /**
   * Private: Detect pattern leaks
   */
  private detectPatternLeaks(): AlphaLeak[] {
    const leaks: AlphaLeak[] = [];
    
    // Check for pattern replication
    for (const [patternId, signature] of this.patternSignatures) {
      if (signature.frequency > 10 && signature.uniqueness < 0.5) {
        const leak: AlphaLeak = {
          id: `pattern_leak_${patternId}`,
          type: 'pattern',
          leakageRate: 1 - signature.uniqueness,
          suspectedCopiers: this.identifyCopiers('pattern', patternId),
          correlationStrength: signature.frequency / 100,
          detectedAt: Date.now(),
          mitigationApplied: false
        };
        
        leaks.push(leak);
      }
    }
    
    return leaks;
  }
  
  /**
   * Private: Extract features from order
   */
  private extractFeatures(order: any): number[] {
    return [
      order.size,
      order.price,
      this.encodeVenue(order.venue),
      order.side === 'buy' ? 1 : -1,
      this.getTimeOfDayFeature(),
      this.getMarketConditionFeature()
    ];
  }
  
  /**
   * Private: Update pattern signatures
   */
  private updatePatternSignatures(record: ExecutionRecord): void {
    const pattern = this.extractPattern(record);
    const patternHash = this.hashPattern(pattern);
    
    if (this.patternSignatures.has(patternHash)) {
      const signature = this.patternSignatures.get(patternHash)!;
      signature.frequency++;
      signature.lastSeen = Date.now();
      signature.uniqueness = this.calculateUniqueness(signature);
    } else {
      this.patternSignatures.set(patternHash, {
        id: patternHash,
        pattern,
        frequency: 1,
        uniqueness: 1.0,
        lastSeen: Date.now()
      });
    }
  }
  
  /**
   * Private: Update correlations
   */
  private updateCorrelations(record: ExecutionRecord): void {
    const recentExecutions = this.executionHistory.slice(-100);
    const correlations: CorrelationData[] = [];
    
    // Group by venue/time to find potential copiers
    const groups = this.groupBySimilarity(recentExecutions);
    
    for (const [groupKey, group] of groups) {
      if (group.length > this.MIN_SAMPLES) {
        const correlation = this.calculateCorrelation(record, group);
        if (correlation.correlation > this.CORRELATION_THRESHOLD) {
          correlations.push(correlation);
        }
      }
    }
    
    if (correlations.length > 0) {
      this.correlationMatrix.set(record.orderId, correlations);
    }
  }
  
  /**
   * Private: Group by time window
   */
  private groupByTimeWindow(
    executions: ExecutionRecord[]
  ): Map<number, ExecutionRecord[]> {
    const windows = new Map<number, ExecutionRecord[]>();
    const windowSize = 300000; // 5 minutes
    
    for (const execution of executions) {
      const windowStart = Math.floor(execution.timestamp / windowSize) * windowSize;
      
      if (!windows.has(windowStart)) {
        windows.set(windowStart, []);
      }
      
      windows.get(windowStart)!.push(execution);
    }
    
    return windows;
  }
  
  /**
   * Private: Analyze execution window
   */
  private analyzeExecutionWindow(executions: ExecutionRecord[]): AlphaLeak | null {
    if (executions.length < this.MIN_SAMPLES) return null;
    
    // Calculate entropy of the execution pattern
    const entropy = this.calculateEntropy(executions);
    
    // Low entropy indicates information leakage
    if (entropy < 2.0) { // bits
      const leakageRate = (2.0 - entropy) / executions.length;
      
      if (leakageRate > this.LEAKAGE_RATE_THRESHOLD) {
        return {
          id: `exec_leak_${Date.now()}`,
          type: 'execution',
          leakageRate,
          suspectedCopiers: this.identifyCopiers('execution'),
          correlationStrength: 1 - (entropy / 2.0),
          detectedAt: Date.now(),
          mitigationApplied: false
        };
      }
    }
    
    return null;
  }
  
  /**
   * Private: Calculate accuracy decay
   */
  private calculateAccuracyDecay(): number {
    // Group executions by time periods
    const periods = 10;
    const periodSize = Math.floor(this.executionHistory.length / periods);
    
    if (periodSize < 10) return 0;
    
    const accuracies: number[] = [];
    
    for (let i = 0; i < periods; i++) {
      const start = i * periodSize;
      const end = start + periodSize;
      const periodExecutions = this.executionHistory.slice(start, end);
      
      const accuracy = this.calculatePeriodAccuracy(periodExecutions);
      accuracies.push(accuracy);
    }
    
    // Calculate decay trend
    const decay = this.calculateTrend(accuracies);
    return Math.max(0, -decay); // Negative trend is decay
  }
  
  /**
   * Private: Calculate entropy
   */
  private calculateEntropy(executions: ExecutionRecord[]): number {
    // Create feature distribution
    const features = executions.map(e => e.features);
    const distribution = this.createDistribution(features);
    
    // Calculate Shannon entropy
    let entropy = 0;
    for (const prob of distribution.values()) {
      if (prob > 0) {
        entropy -= prob * Math.log2(prob);
      }
    }
    
    return entropy;
  }
  
  /**
   * Private: Identify copiers
   */
  private identifyCopiers(
    type: 'execution' | 'prediction' | 'pattern',
    patternId?: string
  ): string[] {
    const copiers: Set<string> = new Set();
    
    // Check correlation matrix
    for (const [orderId, correlations] of this.correlationMatrix) {
      for (const correlation of correlations) {
        if (correlation.correlation > this.CORRELATION_THRESHOLD) {
          copiers.add(correlation.actor);
        }
      }
    }
    
    // In production, this would use more sophisticated analysis
    return Array.from(copiers);
  }
  
  /**
   * Private: Has timing leaks
   */
  private hasTimingLeaks(): boolean {
    // Check for consistent timing patterns
    const timings = this.executionHistory.map(e => e.timestamp % 86400000); // Time of day
    const variance = this.calculateVariance(timings);
    
    return variance < 1000000; // Low variance indicates timing pattern
  }
  
  /**
   * Private: Has venue leaks
   */
  private hasVenueLeaks(): boolean {
    // Check venue distribution
    const venues = new Map<string, number>();
    
    for (const execution of this.executionHistory) {
      venues.set(execution.venue, (venues.get(execution.venue) || 0) + 1);
    }
    
    // High concentration on single venue
    const maxConcentration = Math.max(...venues.values()) / this.executionHistory.length;
    return maxConcentration > 0.7;
  }
  
  /**
   * Private: Encode venue
   */
  private encodeVenue(venue: string): number {
    // Simple hash encoding
    let hash = 0;
    for (let i = 0; i < venue.length; i++) {
      hash = ((hash << 5) - hash) + venue.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) % 1000;
  }
  
  /**
   * Private: Get time of day feature
   */
  private getTimeOfDayFeature(): number {
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60;
  }
  
  /**
   * Private: Get market condition feature
   */
  private getMarketConditionFeature(): number {
    // In production, this would use real market data
    return Math.random();
  }
  
  /**
   * Private: Extract pattern
   */
  private extractPattern(record: ExecutionRecord): number[] {
    return [
      Math.round(record.size / 100) * 100, // Rounded size
      record.side === 'buy' ? 1 : -1,
      Math.floor(record.timestamp % 3600000 / 300000), // 5-minute bucket
      this.encodeVenue(record.venue) % 10 // Venue category
    ];
  }
  
  /**
   * Private: Hash pattern
   */
  private hashPattern(pattern: number[]): string {
    return pattern.join('_');
  }
  
  /**
   * Private: Calculate uniqueness
   */
  private calculateUniqueness(signature: PatternSignature): number {
    // Compare with all other patterns
    let similarCount = 0;
    
    for (const [id, otherSig] of this.patternSignatures) {
      if (id !== signature.id) {
        const similarity = this.patternSimilarity(signature.pattern, otherSig.pattern);
        if (similarity > 0.8) {
          similarCount++;
        }
      }
    }
    
    return 1 / (1 + similarCount);
  }
  
  /**
   * Private: Pattern similarity
   */
  private patternSimilarity(p1: number[], p2: number[]): number {
    if (p1.length !== p2.length) return 0;
    
    let matches = 0;
    for (let i = 0; i < p1.length; i++) {
      if (p1[i] === p2[i]) matches++;
    }
    
    return matches / p1.length;
  }
  
  /**
   * Private: Group by similarity
   */
  private groupBySimilarity(
    executions: ExecutionRecord[]
  ): Map<string, ExecutionRecord[]> {
    const groups = new Map<string, ExecutionRecord[]>();
    
    for (const execution of executions) {
      const key = `${execution.symbol}_${execution.venue}_${Math.floor(execution.timestamp / 60000)}`;
      
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      
      groups.get(key)!.push(execution);
    }
    
    return groups;
  }
  
  /**
   * Private: Calculate correlation
   */
  private calculateCorrelation(
    record: ExecutionRecord,
    group: ExecutionRecord[]
  ): CorrelationData {
    // Simple correlation based on timing and features
    let correlation = 0;
    let totalLag = 0;
    let count = 0;
    
    for (const other of group) {
      if (other.orderId !== record.orderId) {
        const timeDiff = Math.abs(record.timestamp - other.timestamp);
        const featureSim = this.featureSimilarity(record.features, other.features);
        
        if (timeDiff < 60000 && featureSim > 0.7) { // Within 1 minute
          correlation += featureSim;
          totalLag += timeDiff;
          count++;
        }
      }
    }
    
    return {
      actor: 'unknown', // Would identify actual actor in production
      correlation: count > 0 ? correlation / count : 0,
      lag: count > 0 ? totalLag / count : 0,
      confidence: Math.min(count / 10, 1.0),
      samples: count
    };
  }
  
  /**
   * Private: Feature similarity
   */
  private featureSimilarity(f1: number[], f2: number[]): number {
    if (f1.length !== f2.length) return 0;
    
    let distance = 0;
    for (let i = 0; i < f1.length; i++) {
      distance += Math.pow(f1[i] - f2[i], 2);
    }
    
    return 1 / (1 + Math.sqrt(distance));
  }
  
  /**
   * Private: Create distribution
   */
  private createDistribution(features: number[][]): Map<string, number> {
    const counts = new Map<string, number>();
    const total = features.length;
    
    for (const feature of features) {
      const key = this.discretizeFeatures(feature);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    
    const distribution = new Map<string, number>();
    for (const [key, count] of counts) {
      distribution.set(key, count / total);
    }
    
    return distribution;
  }
  
  /**
   * Private: Discretize features
   */
  private discretizeFeatures(features: number[]): string {
    return features.map(f => Math.round(f / 10) * 10).join('_');
  }
  
  /**
   * Private: Calculate period accuracy
   */
  private calculatePeriodAccuracy(executions: ExecutionRecord[]): number {
    if (executions.length === 0) return 0;
    
    const profitable = executions.filter(e => e.outcome > 0).length;
    return profitable / executions.length;
  }
  
  /**
   * Private: Calculate trend
   */
  private calculateTrend(values: number[]): number {
    if (values.length < 2) return 0;
    
    // Simple linear regression
    const n = values.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope;
  }
  
  /**
   * Private: Calculate variance
   */
  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    
    return variance;
  }
} 