import { EventEmitter } from 'events';
import { SystemOrchestrator } from '../../integration-layer/src/core/SystemOrchestrator';
import { MetricsCollector } from '../../telemetry-layer/src/MetricsCollector';
import { AIModuleService } from '../../ai-core/src/AIModuleService';
import { AlphaExploitationService } from '../../alpha-exploitation/src/AlphaExploitationService';
interface RiskPolicy {
    maxDrawdown: number;
    maxLeverage: number;
    maxConcentration: number;
    minSharpe: number;
    maxVaR: number;
    correlationLimit: number;
}
export declare class MetaGovernanceOrchestrator extends EventEmitter {
    private logger;
    private strategyPerformance;
    private governanceDecisions;
    private riskPolicies;
    private systemOrchestrator;
    private metricsCollector;
    private aiService;
    private alphaService;
    constructor(systemOrchestrator: SystemOrchestrator, metricsCollector: MetricsCollector, aiService: AIModuleService, alphaService: AlphaExploitationService);
    private initialize;
    private updateStrategyPerformance;
    private runGovernanceCycle;
    private rankStrategies;
    private calculateStrategyScore;
    private calculateConsistencyScore;
    private calculateDecisionConfidence;
    private calculateSharpeRatio;
    private calculateMaxDrawdown;
    private createGovernanceDecision;
    private executeGovernanceDecisions;
    private disableStrategy;
    private enableStrategy;
    private adjustStrategyWeight;
    private updateStrategyParams;
    private evaluateRiskPolicies;
    private handleRiskViolations;
    private notifyDashboard;
    private logToAuditTrail;
    getGovernanceStatus(): Promise<any>;
    approveDecision(decisionId: string): Promise<void>;
    updateRiskPolicy(policy: Partial<RiskPolicy>): Promise<void>;
}
export {};
//# sourceMappingURL=MetaGovernanceOrchestrator.d.ts.map