import { EventEmitter } from 'events';
import * as winston from 'winston';
import { DistributedStateManager } from '../../core/src/DistributedStateManager';
import { VolumeTracker } from '../../core/src/VolumeTracker';
export interface ComplianceConfig {
    jurisdiction: 'US' | 'EU' | 'UK' | 'APAC' | 'GLOBAL';
    regulations: RegulationType[];
    kycRequired: boolean;
    amlEnabled: boolean;
    transactionLimits: TransactionLimits;
    reportingThresholds: ReportingThresholds;
    dataRetentionDays: number;
}
export declare enum RegulationType {
    MIFID2 = "MIFID2",
    GDPR = "GDPR",
    DODD_FRANK = "DODD_FRANK",
    MAR = "MAR",
    BASEL_III = "BASEL_III",
    FATCA = "FATCA",
    PSD2 = "PSD2"
}
export interface TransactionLimits {
    dailyLimit: number;
    singleTransactionLimit: number;
    monthlyLimit: number;
    requiresApprovalAbove: number;
}
export interface ReportingThresholds {
    largeTransaction: number;
    suspiciousPattern: number;
    aggregateDaily: number;
}
export interface ComplianceCheck {
    id: string;
    type: 'pre_trade' | 'post_trade' | 'periodic';
    timestamp: Date;
    entity: string;
    checkType: string;
    result: 'pass' | 'fail' | 'warning' | 'review';
    details: Record<string, any>;
    violations: Violation[];
}
export interface Violation {
    rule: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    remediation: string;
    regulatoryReference?: string;
}
export interface AuditEntry {
    id: string;
    timestamp: Date;
    userId: string;
    action: string;
    entityType: string;
    entityId: string;
    changes: Record<string, any>;
    ipAddress: string;
    userAgent: string;
    result: 'success' | 'failure';
    metadata?: Record<string, any>;
}
export interface ComplianceReport {
    id: string;
    type: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual' | 'ad_hoc';
    period: {
        start: Date;
        end: Date;
    };
    generatedAt: Date;
    summary: ReportSummary;
    violations: Violation[];
    recommendations: string[];
    regulatoryFilings: RegulatoryFiling[];
}
export interface ReportSummary {
    totalTransactions: number;
    totalVolume: number;
    flaggedTransactions: number;
    violationsCount: number;
    riskScore: number;
    complianceRate: number;
}
export interface RegulatoryFiling {
    regulator: string;
    filingType: string;
    dueDate: Date;
    status: 'pending' | 'submitted' | 'accepted' | 'rejected';
    reference?: string;
}
export interface KYCData {
    userId: string;
    status: 'pending' | 'verified' | 'rejected' | 'expired';
    verificationLevel: 'basic' | 'enhanced' | 'full';
    verifiedAt?: Date;
    expiresAt?: Date;
    documents: KYCDocument[];
    riskScore: number;
}
export interface KYCDocument {
    type: 'passport' | 'drivers_license' | 'utility_bill' | 'bank_statement' | 'other';
    status: 'pending' | 'verified' | 'rejected';
    uploadedAt: Date;
    verifiedAt?: Date;
    hash: string;
}
export interface AMLCheck {
    userId: string;
    timestamp: Date;
    checkType: 'sanctions' | 'pep' | 'adverse_media' | 'transaction_monitoring';
    result: 'clear' | 'match' | 'potential_match' | 'review_required';
    matchedLists: string[];
    riskScore: number;
    nextCheckDate: Date;
}
export declare class ComplianceEngine extends EventEmitter {
    private logger;
    private config;
    private auditLog;
    private complianceChecks;
    private kycData;
    private amlChecks;
    private monitoringInterval;
    private stateManager?;
    private circuitBreakerFactory;
    private kycBreaker;
    private amlBreaker;
    private reportingBreaker;
    private volumeTracker?;
    private checkQueue;
    private isProcessingQueue;
    private readonly MAX_CONCURRENT_CHECKS;
    private activeChecks;
    constructor(logger: winston.Logger, config: ComplianceConfig, stateManager?: DistributedStateManager);
    setVolumeTracker(volumeTracker: VolumeTracker): void;
    start(): void;
    private startQueueProcessor;
    private queueCheck;
    stop(): void;
    checkPreTrade(trade: TradeRequest): Promise<ComplianceCheck>;
    checkPostTrade(execution: TradeExecution): Promise<ComplianceCheck>;
    private checkTransactionLimits;
    private checkMarketAbuse;
    private checkBestExecution;
    private checkTransactionReporting;
    private checkSettlementRisk;
    private verifyKYC;
    private performAMLCheck;
    private performPeriodicChecks;
    generateComplianceReport(type: ComplianceReport['type']): Promise<ComplianceReport>;
    private logAudit;
    private generateCheckId;
    private generateAuditId;
    private generateReportId;
    private getUserDailyVolume;
    private getRecentUserOrders;
    private calculateCancelRate;
    private detectWashTrading;
    private getAvailableVenues;
    private getBestPrice;
    private getReportingDeadline;
    private calculateSettlementRisk;
    private scheduleLargeTransactionReport;
    private shouldGenerateReport;
    private getReportPeriod;
    private calculateTotalVolume;
    private calculateOverallRiskScore;
    private aggregateViolations;
    private generateRecommendations;
    private getRequiredFilings;
}
interface TradeRequest {
    id: string;
    userId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    orderType: string;
}
interface TradeExecution {
    id: string;
    userId: string;
    symbol: string;
    quantity: number;
    price: number;
    value: number;
    venue: string;
    timestamp: Date;
    reported?: boolean;
}
export {};
//# sourceMappingURL=ComplianceEngine.d.ts.map