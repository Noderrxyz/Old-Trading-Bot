import { EventEmitter } from 'events';
interface RollbackTarget {
    deploymentId: string;
    strategyId: string;
    currentVersion: string;
    targetVersion: string;
    environment: 'CANARY' | 'PRODUCTION' | 'STAGING';
    dependencies: Dependency[];
    state: StateSnapshot;
}
interface Dependency {
    name: string;
    currentVersion: string;
    targetVersion: string;
    type: 'LIBRARY' | 'SERVICE' | 'CONFIG' | 'MODEL';
    rollbackRequired: boolean;
}
interface StateSnapshot {
    id: string;
    timestamp: Date;
    data: {
        positions: any[];
        orders: any[];
        balances: Record<string, number>;
        configuration: Record<string, any>;
        modelWeights?: Record<string, number>;
    };
    checksum: string;
}
interface Transaction {
    id: string;
    type: 'TRADE' | 'TRANSFER' | 'CONFIG_CHANGE' | 'MODEL_UPDATE';
    timestamp: Date;
    data: any;
    reversible: boolean;
    reverseAction?: () => Promise<void>;
}
interface RollbackPlan {
    id: string;
    target: RollbackTarget;
    steps: RollbackStep[];
    estimatedDuration: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    approvalRequired: boolean;
}
interface RollbackStep {
    order: number;
    name: string;
    action: () => Promise<void>;
    verificationCheck: () => Promise<boolean>;
    compensationAction?: () => Promise<void>;
    timeout: number;
    critical: boolean;
}
interface RollbackResult {
    id: string;
    status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
    startTime: Date;
    endTime: Date;
    stepsCompleted: number;
    stepsTotal: number;
    errors: Error[];
    stateVerified: boolean;
}
export declare class RollbackEngine extends EventEmitter {
    private logger;
    private stateSnapshots;
    private transactionLog;
    private rollbackHistory;
    private activeRollbacks;
    private stateVerificationEnabled;
    constructor();
    createStateSnapshot(deploymentId: string): Promise<StateSnapshot>;
    executeRollback(target: RollbackTarget): Promise<RollbackResult>;
    private createRollbackPlan;
    private executeWithTimeout;
    private calculateChecksum;
    private capturePositions;
    private captureOrders;
    private captureBalances;
    private captureConfiguration;
    private captureModelWeights;
    private pauseTrading;
    private isTradingPaused;
    private cancelPendingOrders;
    private getPendingOrders;
    private rollbackDependencies;
    private verifyDependencies;
    private restoreDependencies;
    private rollbackStrategyVersion;
    private getStrategyVersion;
    private restoreState;
    private restorePositions;
    private restoreBalances;
    private restoreConfiguration;
    private restoreModelWeights;
    private verifyStateRestoration;
    private reverseTransactions;
    private resumeTrading;
    private assessRollbackRisk;
    private requestApproval;
    private verifyStateIntegrity;
    recordTransaction(transaction: Transaction): void;
    getRollbackHistory(limit?: number): RollbackResult[];
    getActiveRollbacks(): RollbackPlan[];
    simulateRollback(target: RollbackTarget): Promise<{
        feasible: boolean;
        estimatedDuration: number;
        risks: string[];
        plan: RollbackPlan;
    }>;
}
export {};
//# sourceMappingURL=RollbackEngine.d.ts.map