/**
 * AdversarialDefense - Elite threat detection and countermeasures
 * 
 * Detects and counters adversarial activity including strategy copying,
 * latency gaming, fake liquidity, and other market manipulation tactics.
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import { 
  AdversarialThreat, 
  ThreatType, 
  ThreatImpact 
} from '../types';

interface AdversarialConfig {
  detectionEnabled: boolean;
  autoCountermeasures: boolean;
  aggressiveness: number; // 0-1
}

interface ThreatPattern {
  type: ThreatType;
  indicators: string[];
  weight: number;
  minConfidence: number;
}

interface ActivityLog {
  timestamp: number;
  action: string;
  source: string;
  details: any;
}

export class AdversarialDefense extends EventEmitter {
  private logger: Logger;
  private config: AdversarialConfig;
  private threats: Map<string, AdversarialThreat> = new Map();
  private activityLog: ActivityLog[] = [];
  private patterns: ThreatPattern[];
  private stealthMode: boolean = false;
  private aggressiveMode: boolean = false;
  private defensiveMode: boolean = false;
  
  // Detection state
  private correlationWindow: number = 60000; // 1 minute
  private suspiciousActors: Set<string> = new Set();
  private executionFingerprints: Map<string, any[]> = new Map();
  
  constructor(logger: Logger, config: AdversarialConfig) {
    super();
    this.logger = logger;
    this.config = config;
    
    // Initialize threat patterns
    this.patterns = this.initializeThreatPatterns();
  }
  
  /**
   * Initialize the adversarial defense system
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing AdversarialDefense system');
    
    // Start continuous monitoring if enabled
    if (this.config.detectionEnabled) {
      this.startThreatDetection();
    }
    
    // Initialize ML models for pattern detection
    await this.initializeDetectionModels();
  }
  
  /**
   * Detect threats in current market activity
   */
  detectThreats(): AdversarialThreat[] {
    const detectedThreats: AdversarialThreat[] = [];
    
    // Analyze recent activity
    const recentActivity = this.getRecentActivity();
    
    // Check each threat pattern
    for (const pattern of this.patterns) {
      const threat = this.checkPattern(pattern, recentActivity);
      if (threat && threat.confidence >= pattern.minConfidence) {
        detectedThreats.push(threat);
        this.threats.set(threat.id, threat);
        
        // Emit threat event
        this.emit('threatDetected', threat);
      }
    }
    
    // Cross-correlate threats
    this.correlateThreats(detectedThreats);
    
    return detectedThreats;
  }
  
  /**
   * Record activity for analysis
   */
  recordActivity(action: string, source: string, details: any): void {
    const activity: ActivityLog = {
      timestamp: Date.now(),
      action,
      source,
      details
    };
    
    this.activityLog.push(activity);
    
    // Keep only recent activity
    const cutoff = Date.now() - this.correlationWindow * 2;
    this.activityLog = this.activityLog.filter(a => a.timestamp > cutoff);
    
    // Check for immediate threats
    if (this.config.detectionEnabled) {
      this.analyzeActivity(activity);
    }
  }
  
  /**
   * Track execution patterns
   */
  trackExecution(order: any, result: any): void {
    const fingerprint = this.createExecutionFingerprint(order, result);
    const key = `${order.symbol}:${order.venue}`;
    
    if (!this.executionFingerprints.has(key)) {
      this.executionFingerprints.set(key, []);
    }
    
    this.executionFingerprints.get(key)!.push(fingerprint);
    
    // Check for copying patterns
    this.checkForCopying(key, fingerprint);
  }
  
  /**
   * Enable stealth mode
   */
  enableStealthMode(): void {
    this.stealthMode = true;
    this.logger.info('Stealth mode enabled - minimizing detection surface');
  }
  
  /**
   * Set aggressive mode
   */
  setAggressiveMode(): void {
    this.aggressiveMode = true;
    this.defensiveMode = false;
    this.config.aggressiveness = 0.9;
    this.logger.info('Aggressive defense mode enabled');
  }
  
  /**
   * Set defensive mode
   */
  setDefensiveMode(): void {
    this.defensiveMode = true;
    this.aggressiveMode = false;
    this.config.aggressiveness = 0.3;
    this.logger.info('Defensive mode enabled');
  }
  
  /**
   * Generate countermeasures for a threat
   */
  generateCountermeasures(threat: AdversarialThreat): string[] {
    const countermeasures: string[] = [];
    
    switch (threat.type) {
      case ThreatType.STRATEGY_COPYING:
        countermeasures.push('increase_order_randomization');
        countermeasures.push('enable_execution_masking');
        countermeasures.push('rotate_trading_patterns');
        if (this.aggressiveMode) {
          countermeasures.push('deploy_decoy_strategies');
        }
        break;
        
      case ThreatType.LATENCY_GAMING:
        countermeasures.push('randomize_timing');
        countermeasures.push('use_multiple_routes');
        countermeasures.push('enable_jitter_injection');
        break;
        
      case ThreatType.FAKE_LIQUIDITY:
        countermeasures.push('verify_order_depth');
        countermeasures.push('test_liquidity_probes');
        countermeasures.push('avoid_suspicious_venues');
        break;
        
      case ThreatType.FRONT_RUNNING:
        countermeasures.push('use_private_mempool');
        countermeasures.push('split_orders');
        countermeasures.push('randomize_execution_venue');
        if (this.aggressiveMode) {
          countermeasures.push('deploy_honeypot_orders');
        }
        break;
        
      case ThreatType.SPOOFING:
        countermeasures.push('ignore_large_orders');
        countermeasures.push('focus_on_executed_trades');
        countermeasures.push('track_order_cancellations');
        break;
        
      default:
        countermeasures.push('increase_monitoring');
        countermeasures.push('reduce_exposure');
    }
    
    return countermeasures;
  }
  
  /**
   * Private: Initialize threat patterns
   */
  private initializeThreatPatterns(): ThreatPattern[] {
    return [
      {
        type: ThreatType.STRATEGY_COPYING,
        indicators: [
          'similar_execution_timing',
          'matching_order_sizes',
          'correlated_venue_selection',
          'delayed_mirror_trades'
        ],
        weight: 0.9,
        minConfidence: 0.7
      },
      {
        type: ThreatType.LATENCY_GAMING,
        indicators: [
          'systematic_delays',
          'order_racing',
          'timestamp_manipulation',
          'route_congestion'
        ],
        weight: 0.8,
        minConfidence: 0.6
      },
      {
        type: ThreatType.FAKE_LIQUIDITY,
        indicators: [
          'instant_order_cancellation',
          'layered_orders',
          'price_movement_on_approach',
          'vanishing_liquidity'
        ],
        weight: 0.85,
        minConfidence: 0.65
      },
      {
        type: ThreatType.FRONT_RUNNING,
        indicators: [
          'pre_trade_positioning',
          'mempool_monitoring',
          'sandwich_attacks',
          'gas_price_escalation'
        ],
        weight: 0.95,
        minConfidence: 0.7
      },
      {
        type: ThreatType.SPOOFING,
        indicators: [
          'large_visible_orders',
          'rapid_cancellations',
          'price_manipulation',
          'false_signals'
        ],
        weight: 0.75,
        minConfidence: 0.6
      }
    ];
  }
  
  /**
   * Private: Initialize detection models
   */
  private async initializeDetectionModels(): Promise<void> {
    // Initialize ML models for pattern detection
    // This would load pre-trained models or initialize new ones
    this.logger.info('Detection models initialized');
  }
  
  /**
   * Private: Start continuous threat detection
   */
  private startThreatDetection(): void {
    setInterval(() => {
      const threats = this.detectThreats();
      if (threats.length > 0) {
        this.logger.warn(`Detected ${threats.length} threats`);
      }
    }, 5000); // Check every 5 seconds
  }
  
  /**
   * Private: Get recent activity
   */
  private getRecentActivity(): ActivityLog[] {
    const cutoff = Date.now() - this.correlationWindow;
    return this.activityLog.filter(a => a.timestamp > cutoff);
  }
  
  /**
   * Private: Check a specific pattern
   */
  private checkPattern(pattern: ThreatPattern, activity: ActivityLog[]): AdversarialThreat | null {
    let confidence = 0;
    const matchedIndicators: string[] = [];
    
    // Check each indicator
    for (const indicator of pattern.indicators) {
      if (this.checkIndicator(indicator, activity)) {
        confidence += pattern.weight / pattern.indicators.length;
        matchedIndicators.push(indicator);
      }
    }
    
    if (confidence >= pattern.minConfidence) {
      const threat: AdversarialThreat = {
        id: `threat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: pattern.type,
        source: this.identifyThreatSource(activity, pattern.type),
        pattern: matchedIndicators,
        confidence,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        frequency: 1,
        impact: this.assessImpact(pattern.type, confidence),
        countermeasures: this.generateCountermeasures({} as AdversarialThreat)
      };
      
      return threat;
    }
    
    return null;
  }
  
  /**
   * Private: Check specific indicator
   */
  private checkIndicator(indicator: string, activity: ActivityLog[]): boolean {
    switch (indicator) {
      case 'similar_execution_timing':
        return this.checkTimingPatterns(activity);
      case 'matching_order_sizes':
        return this.checkOrderSizePatterns(activity);
      case 'instant_order_cancellation':
        return this.checkCancellationPatterns(activity);
      case 'pre_trade_positioning':
        return this.checkFrontRunning(activity);
      // Add more indicator checks
      default:
        return false;
    }
  }
  
  /**
   * Private: Check timing patterns
   */
  private checkTimingPatterns(activity: ActivityLog[]): boolean {
    const timings = activity.map(a => a.timestamp);
    if (timings.length < 5) return false;
    
    // Look for consistent delays
    const delays: number[] = [];
    for (let i = 1; i < timings.length; i++) {
      delays.push(timings[i] - timings[i-1]);
    }
    
    // Check for suspicious consistency
    const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
    const variance = delays.reduce((sum, d) => sum + Math.pow(d - avgDelay, 2), 0) / delays.length;
    
    return variance < avgDelay * 0.1; // Very consistent timing
  }
  
  /**
   * Private: Check order size patterns
   */
  private checkOrderSizePatterns(activity: ActivityLog[]): boolean {
    const orders = activity.filter(a => a.action === 'order_placed');
    if (orders.length < 3) return false;
    
    const sizes = orders.map(o => o.details.size);
    const uniqueSizes = new Set(sizes);
    
    // Suspicious if many orders have identical sizes
    return uniqueSizes.size < sizes.length * 0.3;
  }
  
  /**
   * Private: Check cancellation patterns
   */
  private checkCancellationPatterns(activity: ActivityLog[]): boolean {
    const orders = activity.filter(a => a.action === 'order_placed');
    const cancels = activity.filter(a => a.action === 'order_cancelled');
    
    if (orders.length === 0) return false;
    
    const cancelRate = cancels.length / orders.length;
    return cancelRate > 0.8; // High cancellation rate
  }
  
  /**
   * Private: Check for front-running
   */
  private checkFrontRunning(activity: ActivityLog[]): boolean {
    // Look for orders placed just before large trades
    const largeOrders = activity.filter(a => 
      a.action === 'order_executed' && a.details.size > 10000
    );
    
    for (const order of largeOrders) {
      const preOrders = activity.filter(a =>
        a.action === 'order_placed' &&
        a.timestamp < order.timestamp &&
        a.timestamp > order.timestamp - 1000 && // Within 1 second
        a.details.side === order.details.side
      );
      
      if (preOrders.length > 0) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Private: Identify threat source
   */
  private identifyThreatSource(activity: ActivityLog[], type: ThreatType): string {
    // Analyze activity to identify likely source
    const sources = activity.map(a => a.source);
    const sourceCounts = new Map<string, number>();
    
    for (const source of sources) {
      sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    }
    
    // Find most frequent source
    let maxCount = 0;
    let likelySource = 'unknown';
    
    for (const [source, count] of sourceCounts) {
      if (count > maxCount) {
        maxCount = count;
        likelySource = source;
      }
    }
    
    return likelySource;
  }
  
  /**
   * Private: Assess threat impact
   */
  private assessImpact(type: ThreatType, confidence: number): ThreatImpact {
    const baseImpact = {
      [ThreatType.STRATEGY_COPYING]: { alpha: 0.3, execution: 0.2, risk: 0.1, cost: 5000 },
      [ThreatType.LATENCY_GAMING]: { alpha: 0.1, execution: 0.4, risk: 0.2, cost: 3000 },
      [ThreatType.FAKE_LIQUIDITY]: { alpha: 0.15, execution: 0.5, risk: 0.3, cost: 10000 },
      [ThreatType.FRONT_RUNNING]: { alpha: 0.4, execution: 0.3, risk: 0.2, cost: 20000 },
      [ThreatType.SPOOFING]: { alpha: 0.2, execution: 0.3, risk: 0.25, cost: 7000 },
      [ThreatType.WASH_TRADING]: { alpha: 0.1, execution: 0.1, risk: 0.4, cost: 2000 },
      [ThreatType.LAYERING]: { alpha: 0.2, execution: 0.35, risk: 0.2, cost: 8000 },
      [ThreatType.MOMENTUM_IGNITION]: { alpha: 0.25, execution: 0.2, risk: 0.35, cost: 15000 },
      [ThreatType.QUOTE_STUFFING]: { alpha: 0.05, execution: 0.6, risk: 0.1, cost: 1000 }
    };
    
    const base = baseImpact[type];
    
    return {
      alphaLoss: base.alpha * confidence,
      executionDegradation: base.execution * confidence,
      riskIncrease: base.risk * confidence,
      estimatedCost: base.cost * confidence
    };
  }
  
  /**
   * Private: Correlate threats
   */
  private correlateThreats(threats: AdversarialThreat[]): void {
    // Look for correlated threats that might indicate coordinated attacks
    for (let i = 0; i < threats.length; i++) {
      for (let j = i + 1; j < threats.length; j++) {
        if (this.areThreatsCorrelated(threats[i], threats[j])) {
          // Increase confidence and impact for correlated threats
          threats[i].confidence = Math.min(1, threats[i].confidence * 1.2);
          threats[j].confidence = Math.min(1, threats[j].confidence * 1.2);
        }
      }
    }
  }
  
  /**
   * Private: Check if threats are correlated
   */
  private areThreatsCorrelated(t1: AdversarialThreat, t2: AdversarialThreat): boolean {
    // Same source
    if (t1.source === t2.source) return true;
    
    // Close timing
    if (Math.abs(t1.firstSeen - t2.firstSeen) < 5000) return true;
    
    // Complementary types
    const complementary = [
      [ThreatType.FAKE_LIQUIDITY, ThreatType.SPOOFING],
      [ThreatType.FRONT_RUNNING, ThreatType.LATENCY_GAMING],
      [ThreatType.LAYERING, ThreatType.MOMENTUM_IGNITION]
    ];
    
    for (const [type1, type2] of complementary) {
      if ((t1.type === type1 && t2.type === type2) ||
          (t1.type === type2 && t2.type === type1)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Private: Analyze single activity
   */
  private analyzeActivity(activity: ActivityLog): void {
    // Quick checks for immediate threats
    if (activity.action === 'large_order_cancelled' && 
        activity.details.timeAlive < 100) { // Less than 100ms
      this.suspiciousActors.add(activity.source);
    }
  }
  
  /**
   * Private: Create execution fingerprint
   */
  private createExecutionFingerprint(order: any, result: any): any {
    return {
      timestamp: Date.now(),
      size: order.size,
      price: result.price,
      venue: order.venue,
      latency: result.executionTime,
      slippage: Math.abs(result.price - order.price) / order.price
    };
  }
  
  /**
   * Private: Check for strategy copying
   */
  private checkForCopying(key: string, fingerprint: any): void {
    const fingerprints = this.executionFingerprints.get(key) || [];
    
    // Look for similar patterns in recent history
    const recent = fingerprints.slice(-20);
    let similarCount = 0;
    
    for (const fp of recent) {
      if (this.areFingerprintsSimilar(fingerprint, fp)) {
        similarCount++;
      }
    }
    
    if (similarCount > 5) {
      this.logger.warn(`Possible strategy copying detected for ${key}`);
      this.recordActivity('possible_copying', 'analysis', {
        key,
        similarCount,
        fingerprint
      });
    }
  }
  
  /**
   * Private: Check if fingerprints are similar
   */
  private areFingerprintsSimilar(fp1: any, fp2: any): boolean {
    const sizeDiff = Math.abs(fp1.size - fp2.size) / fp1.size;
    const timeDiff = Math.abs(fp1.timestamp - fp2.timestamp);
    
    return sizeDiff < 0.1 && timeDiff < 60000; // Within 10% size and 1 minute
  }
} 