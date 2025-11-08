import { EventEmitter } from 'events';

const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => console.log(`[${name}] INFO:`, message, meta || ''),
  error: (message: string, error?: any) => console.error(`[${name}] ERROR:`, message, error || ''),
  debug: (message: string, meta?: any) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
  warn: (message: string, meta?: any) => console.warn(`[${name}] WARN:`, message, meta || '')
});

interface RiskPolicy {
  id: string;
  name: string;
  category: 'POSITION' | 'PORTFOLIO' | 'EXECUTION' | 'MARKET';
  parameters: Record<string, any>;
  constraints: RiskConstraint[];
  priority: number;
  enabled: boolean;
  lastUpdated: Date;
}

interface RiskConstraint {
  parameter: string;
  operator: '<' | '>' | '=' | '<=' | '>=';
  value: number;
  unit?: string;
  severity: 'WARNING' | 'CRITICAL' | 'EMERGENCY';
}

interface MarketCondition {
  volatility: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  liquidity: 'HIGH' | 'MEDIUM' | 'LOW';
  correlation: number;
  vix: number;
}

interface RiskAdjustment {
  policyId: string;
  parameter: string;
  oldValue: any;
  newValue: any;
  reason: string;
  marketCondition: MarketCondition;
  timestamp: Date;
  approved: boolean;
  executedAt?: Date;
}

interface RiskEvent {
  id: string;
  type: 'BREACH' | 'WARNING' | 'ADJUSTMENT' | 'RECOVERY';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  policy: string;
  details: string;
  metrics: Record<string, number>;
  timestamp: Date;
  resolved: boolean;
}

export class RiskPolicyManager extends EventEmitter {
  private logger: ReturnType<typeof createLogger>;
  private policies: Map<string, RiskPolicy>;
  private adjustmentHistory: RiskAdjustment[];
  private riskEvents: RiskEvent[];
  private currentMarketCondition: MarketCondition;
  private monitoringInterval: NodeJS.Timeout | null = null;
  
  constructor() {
    super();
    this.logger = createLogger('RiskPolicyManager');
    this.policies = new Map();
    this.adjustmentHistory = [];
    this.riskEvents = [];
    
    this.currentMarketCondition = {
      volatility: 'MEDIUM',
      trend: 'NEUTRAL',
      liquidity: 'HIGH',
      correlation: 0.5,
      vix: 20
    };
    
    this.initializeDefaultPolicies();
  }
  
  private initializeDefaultPolicies(): void {
    // Position-level policies
    this.registerPolicy({
      id: 'position_sizing',
      name: 'Position Sizing Limits',
      category: 'POSITION',
      parameters: {
        maxPositionSize: 0.10, // 10% of portfolio
        maxLeverage: 3.0,
        minPositionSize: 0.01, // 1% of portfolio
        concentrationLimit: 0.25 // 25% in single asset
      },
      constraints: [
        { parameter: 'maxPositionSize', operator: '<=', value: 0.10, severity: 'CRITICAL' },
        { parameter: 'maxLeverage', operator: '<=', value: 3.0, severity: 'EMERGENCY' },
        { parameter: 'concentrationLimit', operator: '<=', value: 0.25, severity: 'WARNING' }
      ],
      priority: 1,
      enabled: true,
      lastUpdated: new Date()
    });
    
    // Portfolio-level policies
    this.registerPolicy({
      id: 'portfolio_risk',
      name: 'Portfolio Risk Limits',
      category: 'PORTFOLIO',
      parameters: {
        maxDrawdown: 0.20, // 20%
        maxDailyLoss: 0.05, // 5%
        maxVaR95: 0.10, // 10% VaR at 95% confidence
        maxCorrelation: 0.70,
        targetSharpe: 1.5
      },
      constraints: [
        { parameter: 'maxDrawdown', operator: '<=', value: 0.20, severity: 'CRITICAL' },
        { parameter: 'maxDailyLoss', operator: '<=', value: 0.05, severity: 'EMERGENCY' },
        { parameter: 'maxVaR95', operator: '<=', value: 0.10, severity: 'WARNING' }
      ],
      priority: 1,
      enabled: true,
      lastUpdated: new Date()
    });
    
    // Execution policies
    this.registerPolicy({
      id: 'execution_limits',
      name: 'Execution Risk Controls',
      category: 'EXECUTION',
      parameters: {
        maxSlippage: 0.005, // 0.5%
        maxMarketImpact: 0.003, // 0.3%
        minLiquidity: 1000000, // $1M daily volume
        maxOrderSize: 0.10, // 10% of daily volume
        maxExecutionTime: 300000 // 5 minutes
      },
      constraints: [
        { parameter: 'maxSlippage', operator: '<=', value: 0.005, unit: '%', severity: 'WARNING' },
        { parameter: 'maxMarketImpact', operator: '<=', value: 0.003, unit: '%', severity: 'WARNING' },
        { parameter: 'minLiquidity', operator: '>=', value: 1000000, unit: 'USD', severity: 'CRITICAL' }
      ],
      priority: 2,
      enabled: true,
      lastUpdated: new Date()
    });
    
    // Market condition policies
    this.registerPolicy({
      id: 'market_adaptation',
      name: 'Market Condition Adaptations',
      category: 'MARKET',
      parameters: {
        volatilityScalar: 1.0,
        liquidityMultiplier: 1.0,
        correlationThreshold: 0.8,
        emergencyStopLoss: 0.30,
        riskOffThreshold: 40 // VIX level
      },
      constraints: [
        { parameter: 'correlationThreshold', operator: '<=', value: 0.8, severity: 'WARNING' },
        { parameter: 'riskOffThreshold', operator: '>=', value: 40, severity: 'CRITICAL' }
      ],
      priority: 3,
      enabled: true,
      lastUpdated: new Date()
    });
  }
  
  public registerPolicy(policy: RiskPolicy): void {
    this.policies.set(policy.id, policy);
    this.logger.info(`Registered risk policy: ${policy.name}`, {
      category: policy.category,
      parameters: Object.keys(policy.parameters).length,
      constraints: policy.constraints.length
    });
    this.emit('policy-registered', policy);
  }
  
  public async updateMarketCondition(condition: Partial<MarketCondition>): Promise<void> {
    const oldCondition = { ...this.currentMarketCondition };
    this.currentMarketCondition = { ...this.currentMarketCondition, ...condition };
    
    this.logger.info('Market condition updated', {
      old: oldCondition,
      new: this.currentMarketCondition
    });
    
    // Trigger dynamic adjustment based on new conditions
    await this.adjustPoliciesForMarketCondition();
    
    this.emit('market-condition-updated', {
      old: oldCondition,
      new: this.currentMarketCondition
    });
  }
  
  private async adjustPoliciesForMarketCondition(): Promise<void> {
    const adjustments: RiskAdjustment[] = [];
    
    // Adjust position sizing based on volatility
    const positionPolicy = this.policies.get('position_sizing');
    if (positionPolicy) {
      const volatilityMultiplier = this.getVolatilityMultiplier();
      const newMaxPosition = 0.10 * volatilityMultiplier;
      
      if (newMaxPosition !== positionPolicy.parameters.maxPositionSize) {
        adjustments.push({
          policyId: 'position_sizing',
          parameter: 'maxPositionSize',
          oldValue: positionPolicy.parameters.maxPositionSize,
          newValue: newMaxPosition,
          reason: `Volatility adjustment: ${this.currentMarketCondition.volatility}`,
          marketCondition: this.currentMarketCondition,
          timestamp: new Date(),
          approved: true
        });
      }
    }
    
    // Adjust portfolio risk based on market regime
    const portfolioPolicy = this.policies.get('portfolio_risk');
    if (portfolioPolicy && this.currentMarketCondition.vix > 30) {
      const riskReduction = 0.7; // Reduce risk by 30%
      
      adjustments.push({
        policyId: 'portfolio_risk',
        parameter: 'maxDrawdown',
        oldValue: portfolioPolicy.parameters.maxDrawdown,
        newValue: portfolioPolicy.parameters.maxDrawdown * riskReduction,
        reason: `High VIX (${this.currentMarketCondition.vix}) risk reduction`,
        marketCondition: this.currentMarketCondition,
        timestamp: new Date(),
        approved: true
      });
    }
    
    // Execute approved adjustments
    for (const adjustment of adjustments) {
      await this.executeAdjustment(adjustment);
    }
  }
  
  private getVolatilityMultiplier(): number {
    switch (this.currentMarketCondition.volatility) {
      case 'LOW':
        return 1.2;
      case 'MEDIUM':
        return 1.0;
      case 'HIGH':
        return 0.7;
      case 'EXTREME':
        return 0.4;
      default:
        return 1.0;
    }
  }
  
  private async executeAdjustment(adjustment: RiskAdjustment): Promise<void> {
    const policy = this.policies.get(adjustment.policyId);
    if (!policy || !adjustment.approved) return;
    
    // Update policy parameter
    policy.parameters[adjustment.parameter] = adjustment.newValue;
    policy.lastUpdated = new Date();
    
    adjustment.executedAt = new Date();
    this.adjustmentHistory.push(adjustment);
    
    this.logger.info('Risk adjustment executed', {
      policy: adjustment.policyId,
      parameter: adjustment.parameter,
      change: `${adjustment.oldValue} -> ${adjustment.newValue}`,
      reason: adjustment.reason
    });
    
    this.emit('policy-adjusted', adjustment);
  }
  
  public async checkConstraints(metrics: Record<string, any>): Promise<RiskEvent[]> {
    const events: RiskEvent[] = [];
    
    for (const policy of this.policies.values()) {
      if (!policy.enabled) continue;
      
      for (const constraint of policy.constraints) {
        const value = metrics[constraint.parameter];
        if (value === undefined) continue;
        
        const violated = this.isConstraintViolated(value, constraint);
        
        if (violated) {
          const event: RiskEvent = {
            id: `risk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: constraint.severity === 'EMERGENCY' ? 'BREACH' : 'WARNING',
            severity: this.mapConstraintSeverity(constraint.severity),
            policy: policy.name,
            details: `${constraint.parameter} ${constraint.operator} ${constraint.value} violated (current: ${value})`,
            metrics: { [constraint.parameter]: value },
            timestamp: new Date(),
            resolved: false
          };
          
          events.push(event);
          this.riskEvents.push(event);
          
          this.logger.warn('Risk constraint violated', {
            policy: policy.name,
            constraint: constraint.parameter,
            value,
            limit: constraint.value,
            severity: constraint.severity
          });
        }
      }
    }
    
    if (events.length > 0) {
      this.emit('risk-events', events);
    }
    
    return events;
  }
  
  private isConstraintViolated(value: number, constraint: RiskConstraint): boolean {
    switch (constraint.operator) {
      case '<':
        return value >= constraint.value;
      case '>':
        return value <= constraint.value;
      case '=':
        return value !== constraint.value;
      case '<=':
        return value > constraint.value;
      case '>=':
        return value < constraint.value;
      default:
        return false;
    }
  }
  
  private mapConstraintSeverity(severity: RiskConstraint['severity']): RiskEvent['severity'] {
    switch (severity) {
      case 'WARNING':
        return 'MEDIUM';
      case 'CRITICAL':
        return 'HIGH';
      case 'EMERGENCY':
        return 'CRITICAL';
      default:
        return 'LOW';
    }
  }
  
  public startMonitoring(intervalMs: number = 10000): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    this.monitoringInterval = setInterval(async () => {
      await this.runMonitoringCycle();
    }, intervalMs);
    
    this.logger.info(`Started risk monitoring with ${intervalMs}ms interval`);
  }
  
  public stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      this.logger.info('Stopped risk monitoring');
    }
  }
  
  private async runMonitoringCycle(): Promise<void> {
    try {
      // In production, this would fetch real metrics
      const mockMetrics = this.generateMockMetrics();
      
      // Check all constraints
      const events = await this.checkConstraints(mockMetrics);
      
      // Auto-adjust policies if needed
      if (events.some(e => e.severity === 'CRITICAL')) {
        await this.triggerEmergencyAdjustments();
      }
      
      // Clean up resolved events
      this.cleanupResolvedEvents();
      
    } catch (error) {
      this.logger.error('Monitoring cycle error:', error);
    }
  }
  
  private generateMockMetrics(): Record<string, number> {
    return {
      maxPositionSize: Math.random() * 0.15,
      maxLeverage: 1 + Math.random() * 4,
      concentrationLimit: Math.random() * 0.3,
      maxDrawdown: Math.random() * 0.25,
      maxDailyLoss: Math.random() * 0.08,
      maxVaR95: Math.random() * 0.15,
      maxCorrelation: 0.4 + Math.random() * 0.5,
      maxSlippage: Math.random() * 0.01,
      maxMarketImpact: Math.random() * 0.005,
      minLiquidity: 500000 + Math.random() * 2000000
    };
  }
  
  private async triggerEmergencyAdjustments(): Promise<void> {
    this.logger.warn('Triggering emergency risk adjustments');
    
    // Reduce all position sizes by 50%
    const positionPolicy = this.policies.get('position_sizing');
    if (positionPolicy) {
      await this.executeAdjustment({
        policyId: 'position_sizing',
        parameter: 'maxPositionSize',
        oldValue: positionPolicy.parameters.maxPositionSize,
        newValue: positionPolicy.parameters.maxPositionSize * 0.5,
        reason: 'Emergency risk reduction - critical events detected',
        marketCondition: this.currentMarketCondition,
        timestamp: new Date(),
        approved: true,
        executedAt: new Date()
      });
    }
    
    this.emit('emergency-adjustment');
  }
  
  private cleanupResolvedEvents(): void {
    const cutoffTime = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
    this.riskEvents = this.riskEvents.filter(event => 
      !event.resolved || event.timestamp.getTime() > cutoffTime
    );
  }
  
  public getPolicyStatus(): Array<{
    policy: RiskPolicy;
    activeConstraints: number;
    violations: number;
    lastAdjustment?: RiskAdjustment;
  }> {
    const status: Array<{
      policy: RiskPolicy;
      activeConstraints: number;
      violations: number;
      lastAdjustment?: RiskAdjustment;
    }> = [];
    
    for (const policy of this.policies.values()) {
      const violations = this.riskEvents.filter(e => 
        e.policy === policy.name && !e.resolved
      ).length;
      
      const lastAdjustment = this.adjustmentHistory
        .filter(a => a.policyId === policy.id)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
      
      status.push({
        policy,
        activeConstraints: policy.constraints.length,
        violations,
        lastAdjustment
      });
    }
    
    return status;
  }
  
  public async overridePolicy(
    policyId: string,
    parameters: Record<string, any>,
    reason: string
  ): Promise<void> {
    const policy = this.policies.get(policyId);
    if (!policy) {
      throw new Error(`Policy ${policyId} not found`);
    }
    
    const adjustments: RiskAdjustment[] = [];
    
    for (const [param, newValue] of Object.entries(parameters)) {
      if (policy.parameters[param] !== undefined) {
        adjustments.push({
          policyId,
          parameter: param,
          oldValue: policy.parameters[param],
          newValue,
          reason: `Manual override: ${reason}`,
          marketCondition: this.currentMarketCondition,
          timestamp: new Date(),
          approved: true
        });
      }
    }
    
    for (const adjustment of adjustments) {
      await this.executeAdjustment(adjustment);
    }
    
    this.emit('policy-override', { policyId, parameters, reason });
  }
  
  public getAdjustmentHistory(limit: number = 100): RiskAdjustment[] {
    return this.adjustmentHistory.slice(-limit);
  }
  
  public getRiskEvents(resolved: boolean = false, limit: number = 100): RiskEvent[] {
    return this.riskEvents
      .filter(e => resolved || !e.resolved)
      .slice(-limit);
  }
} 