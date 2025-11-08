import { EventEmitter } from 'events';
interface DeploymentStatus {
    deploymentId: string;
    strategyId: string;
    strategyName: string;
    version: string;
    stage: string;
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';
    progress: number;
    startTime: Date;
    duration?: number;
    metrics: DeploymentMetrics;
}
interface DeploymentMetrics {
    testsRun: number;
    testsPassed: number;
    codeCoverage: number;
    performanceScore: number;
    securityScore: number;
    deploymentTime: number;
    rollbackCount: number;
}
interface ApprovalRequest {
    id: string;
    type: 'DEPLOYMENT' | 'ROLLBACK' | 'CONFIGURATION';
    deploymentId: string;
    stage: string;
    requestTime: Date;
    requiredApprovers: string[];
    currentApprovals: Array<{
        approver: string;
        decision: 'APPROVED' | 'REJECTED';
        timestamp: Date;
        comments?: string;
    }>;
    deadline?: Date;
    metadata: Record<string, any>;
}
interface GrafanaPanel {
    id: string;
    title: string;
    type: 'graph' | 'stat' | 'gauge' | 'table' | 'heatmap';
    datasource: string;
    query: string;
    refreshInterval: string;
}
interface Alert {
    id: string;
    severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
    title: string;
    message: string;
    timestamp: Date;
    deploymentId?: string;
    acknowledged: boolean;
}
export declare class DeploymentDashboardHook extends EventEmitter {
    private logger;
    private widgets;
    private deploymentStatuses;
    private approvalRequests;
    private alerts;
    private grafanaPanels;
    private metricsBuffer;
    private refreshIntervals;
    constructor();
    private initializeDashboard;
    private initializeGrafanaPanels;
    private createWidget;
    private startRefreshCycles;
    trackDeployment(status: DeploymentStatus): void;
    createApprovalRequest(request: Omit<ApprovalRequest, 'id' | 'requestTime'>): string;
    submitApproval(approvalId: string, approver: string, decision: 'APPROVED' | 'REJECTED', comments?: string): void;
    private checkApprovalComplete;
    createAlert(alert: Omit<Alert, 'id' | 'timestamp' | 'acknowledged'>): void;
    acknowledgeAlert(alertId: string): void;
    private updateTimelineWidget;
    private getStageTimeline;
    private refreshWidget;
    private calculateDeploymentMetrics;
    private calculateAverageDeploymentTime;
    private updateDeploymentStatuses;
    private notifyApprovers;
    private checkStaleApprovals;
    private recordMetric;
    private flushMetricsBuffer;
    getGrafanaDashboardConfig(): {
        panels: GrafanaPanel[];
        variables: any[];
        time: any;
    };
    getDeploymentHistory(filters?: {
        strategyId?: string;
        status?: string;
        startDate?: Date;
        endDate?: Date;
    }, limit?: number): DeploymentStatus[];
    exportDashboardData(format?: 'JSON' | 'CSV'): string;
    destroy(): void;
}
export {};
//# sourceMappingURL=DeploymentDashboardHook.d.ts.map