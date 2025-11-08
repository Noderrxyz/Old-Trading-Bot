import { EventEmitter } from 'events';
interface Strategy {
    id: string;
    name: string;
    version: string;
    type: 'AI' | 'TECHNICAL' | 'FUNDAMENTAL' | 'HYBRID';
    dependencies: string[];
    requiredApprovals: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}
interface DeploymentStage {
    name: 'DEVELOPMENT' | 'BACKTEST' | 'PAPER' | 'CANARY' | 'PRODUCTION';
    requirements: StageRequirement[];
    approvalNeeded: boolean;
    rollbackEnabled: boolean;
    maxDuration: number;
}
interface StageRequirement {
    metric: string;
    operator: '<' | '>' | '=' | '<=' | '>=';
    threshold: number;
    critical: boolean;
}
interface Deployment {
    id: string;
    strategy: Strategy;
    currentStage: DeploymentStage['name'];
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';
    startTime: Date;
    endTime?: Date;
    metrics: DeploymentMetrics;
    approvals: Approval[];
    history: DeploymentEvent[];
}
interface DeploymentMetrics {
    backtestSharpe?: number;
    backtestMaxDrawdown?: number;
    paperTradingReturns?: number;
    paperTradingWinRate?: number;
    canaryAllocation?: number;
    productionReadiness?: number;
    latency?: number;
    errorRate?: number;
}
interface Approval {
    stage: DeploymentStage['name'];
    approver: string;
    timestamp: Date;
    decision: 'APPROVED' | 'REJECTED';
    reason?: string;
}
interface DeploymentEvent {
    timestamp: Date;
    type: 'STAGE_STARTED' | 'STAGE_COMPLETED' | 'VALIDATION_PASSED' | 'VALIDATION_FAILED' | 'ROLLBACK' | 'ERROR';
    stage: DeploymentStage['name'];
    details: string;
    metrics?: Record<string, number>;
}
export declare class DeploymentOrchestrator extends EventEmitter {
    private logger;
    private deployments;
    private stages;
    private activeDeployments;
    private deploymentQueue;
    constructor();
    private initializeStages;
    private startOrchestrationLoop;
    deployStrategy(strategy: Strategy, startStage?: DeploymentStage['name']): Promise<string>;
    private processDeploymentQueue;
    private executeDeploymentStage;
    private runStageExecution;
    private checkRequirement;
    private requestApproval;
    private promoteToNextStage;
    private rollbackDeployment;
    private handleDeploymentError;
    private recordDeploymentEvent;
    private monitorActiveDeployments;
    getDeploymentStatus(deploymentId: string): Deployment | undefined;
    getActiveDeployments(): Deployment[];
    getDeploymentHistory(limit?: number): Deployment[];
    forcePromote(deploymentId: string): Promise<void>;
    cancelDeployment(deploymentId: string, reason: string): Promise<void>;
}
export {};
//# sourceMappingURL=DeploymentOrchestrator.d.ts.map