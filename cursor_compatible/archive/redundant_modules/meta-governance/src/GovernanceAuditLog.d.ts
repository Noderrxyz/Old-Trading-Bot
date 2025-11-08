import { EventEmitter } from 'events';
interface AuditEntry {
    id: string;
    timestamp: Date;
    action: GovernanceAction;
    actor: string;
    target: string;
    details: Record<string, any>;
    impact: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    hash: string;
    previousHash: string;
    signature?: string;
}
type GovernanceAction = 'STRATEGY_ENABLED' | 'STRATEGY_DISABLED' | 'WEIGHT_ADJUSTED' | 'PARAMETER_UPDATED' | 'POLICY_CHANGED' | 'EMERGENCY_ACTION' | 'VOTING_COMPLETED' | 'SIGNAL_ELECTED' | 'RISK_OVERRIDE' | 'DEPLOYMENT_APPROVED' | 'CAPITAL_ALLOCATED';
interface AuditSummary {
    totalEntries: number;
    actionBreakdown: Record<GovernanceAction, number>;
    impactBreakdown: Record<string, number>;
    actorActivity: Record<string, number>;
    timeRange: {
        start: Date;
        end: Date;
    };
}
interface ComplianceReport {
    period: {
        start: Date;
        end: Date;
    };
    totalActions: number;
    criticalActions: number;
    emergencyActions: number;
    policyViolations: number;
    auditTrailIntegrity: boolean;
    recommendations: string[];
}
export declare class GovernanceAuditLog extends EventEmitter {
    private logger;
    private auditEntries;
    private lastHash;
    private readonly maxEntries;
    constructor();
    private initializeAuditLog;
    private generateGenesisHash;
    logAction(params: {
        action: GovernanceAction;
        actor: string;
        target: string;
        details: Record<string, any>;
        impact: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    }): Promise<AuditEntry>;
    private generateHash;
    private signEntry;
    verifyIntegrity(startIndex?: number): boolean;
    getEntries(filters?: {
        action?: GovernanceAction;
        actor?: string;
        target?: string;
        impact?: string;
        startDate?: Date;
        endDate?: Date;
        limit?: number;
    }): AuditEntry[];
    generateSummary(startDate?: Date, endDate?: Date): AuditSummary;
    generateComplianceReport(startDate: Date, endDate: Date): ComplianceReport;
    private archiveOldEntries;
    private writeToArchive;
    exportForAuditor(format?: 'JSON' | 'CSV'): string;
    searchEntries(query: string): AuditEntry[];
    getMetrics(): {
        totalEntries: number;
        averageEntriesPerDay: number;
        mostActiveActor: string;
        mostCommonAction: GovernanceAction;
        criticalActionRate: number;
    };
}
export {};
//# sourceMappingURL=GovernanceAuditLog.d.ts.map