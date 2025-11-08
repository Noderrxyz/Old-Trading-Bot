import { EventEmitter } from 'events';
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
export declare class RiskPolicyManager extends EventEmitter {
    private logger;
    private policies;
    private adjustmentHistory;
    private riskEvents;
    private currentMarketCondition;
    private monitoringInterval;
    constructor();
    private initializeDefaultPolicies;
    registerPolicy(policy: RiskPolicy): void;
    updateMarketCondition(condition: Partial<MarketCondition>): Promise<void>;
    private adjustPoliciesForMarketCondition;
    private getVolatilityMultiplier;
    private executeAdjustment;
    checkConstraints(metrics: Record<string, any>): Promise<RiskEvent[]>;
    private isConstraintViolated;
    private mapConstraintSeverity;
    startMonitoring(intervalMs?: number): void;
    stopMonitoring(): void;
    private runMonitoringCycle;
    private generateMockMetrics;
    private triggerEmergencyAdjustments;
    private cleanupResolvedEvents;
    getPolicyStatus(): Array<{
        policy: RiskPolicy;
        activeConstraints: number;
        violations: number;
        lastAdjustment?: RiskAdjustment;
    }>;
    overridePolicy(policyId: string, parameters: Record<string, any>, reason: string): Promise<void>;
    getAdjustmentHistory(limit?: number): RiskAdjustment[];
    getRiskEvents(resolved?: boolean, limit?: number): RiskEvent[];
}
export {};
//# sourceMappingURL=RiskPolicyManager.d.ts.map