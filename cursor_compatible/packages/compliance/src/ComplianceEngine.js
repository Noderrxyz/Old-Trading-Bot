"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComplianceEngine = exports.RegulationType = void 0;
const events_1 = require("events");
const CircuitBreaker_1 = require("../../core/src/CircuitBreaker");
var RegulationType;
(function (RegulationType) {
    RegulationType["MIFID2"] = "MIFID2";
    RegulationType["GDPR"] = "GDPR";
    RegulationType["DODD_FRANK"] = "DODD_FRANK";
    RegulationType["MAR"] = "MAR";
    RegulationType["BASEL_III"] = "BASEL_III";
    RegulationType["FATCA"] = "FATCA";
    RegulationType["PSD2"] = "PSD2";
})(RegulationType || (exports.RegulationType = RegulationType = {}));
class ComplianceEngine extends events_1.EventEmitter {
    logger;
    config;
    auditLog = [];
    complianceChecks = new Map();
    kycData = new Map();
    amlChecks = new Map();
    monitoringInterval = null;
    stateManager;
    circuitBreakerFactory;
    kycBreaker;
    amlBreaker;
    reportingBreaker;
    volumeTracker;
    // Performance optimization
    checkQueue = [];
    isProcessingQueue = false;
    MAX_CONCURRENT_CHECKS = 10;
    activeChecks = 0;
    constructor(logger, config, stateManager) {
        super();
        this.logger = logger;
        this.config = config;
        this.stateManager = stateManager;
        // Initialize circuit breakers
        this.circuitBreakerFactory = new CircuitBreaker_1.CircuitBreakerFactory(logger, {
            timeout: 5000,
            errorThresholdPercentage: 50,
            errorThresholdCount: 5,
            successThresholdCount: 3,
            resetTimeout: 30000,
            volumeThreshold: 10,
            rollingWindowSize: 60000
        });
        this.kycBreaker = this.circuitBreakerFactory.create({
            name: 'kyc-verification',
            fallbackFunction: async () => ({ status: 'pending' })
        });
        this.amlBreaker = this.circuitBreakerFactory.create({
            name: 'aml-check',
            fallbackFunction: async () => ({
                result: 'review_required',
                riskScore: 100,
                matchedLists: [],
                timestamp: new Date(),
                nextCheckDate: new Date(Date.now() + 24 * 60 * 60 * 1000)
            })
        });
        this.reportingBreaker = this.circuitBreakerFactory.create({
            name: 'regulatory-reporting'
        });
    }
    setVolumeTracker(volumeTracker) {
        this.volumeTracker = volumeTracker;
    }
    start() {
        this.logger.info('Starting compliance engine', {
            jurisdiction: this.config.jurisdiction,
            regulations: this.config.regulations
        });
        // Start queue processor
        this.startQueueProcessor();
        // Start periodic monitoring
        this.monitoringInterval = setInterval(() => {
            this.performPeriodicChecks();
        }, 3600000); // Every hour
        // Initial checks
        this.performPeriodicChecks();
    }
    startQueueProcessor() {
        if (this.isProcessingQueue)
            return;
        this.isProcessingQueue = true;
        const processNext = async () => {
            while (this.checkQueue.length > 0 && this.activeChecks < this.MAX_CONCURRENT_CHECKS) {
                const check = this.checkQueue.shift();
                if (check) {
                    this.activeChecks++;
                    check()
                        .catch(err => this.logger.error('Queued check failed', err))
                        .finally(() => {
                        this.activeChecks--;
                        processNext();
                    });
                }
            }
        };
        // Start processing
        processNext();
    }
    queueCheck(checkFn) {
        this.checkQueue.push(checkFn);
        this.startQueueProcessor();
    }
    stop() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        this.logger.info('Stopped compliance engine');
    }
    async checkPreTrade(trade) {
        const checkId = this.generateCheckId();
        const violations = [];
        // KYC Check
        if (this.config.kycRequired) {
            const kycStatus = await this.verifyKYC(trade.userId);
            if (kycStatus !== 'verified') {
                violations.push({
                    rule: 'KYC_REQUIRED',
                    severity: 'critical',
                    description: 'User KYC verification is not complete',
                    remediation: 'Complete KYC verification before trading'
                });
            }
        }
        // AML Check
        if (this.config.amlEnabled) {
            const amlResult = await this.performAMLCheck(trade.userId, 'transaction_monitoring');
            if (amlResult.result !== 'clear') {
                violations.push({
                    rule: 'AML_ALERT',
                    severity: 'high',
                    description: `AML check returned ${amlResult.result}`,
                    remediation: 'Review AML alerts before proceeding'
                });
            }
        }
        // Transaction Limits - Now using atomic Redis operations
        const limitViolation = await this.checkTransactionLimits(trade);
        if (limitViolation) {
            violations.push(limitViolation);
        }
        // Market Abuse Checks (MAR)
        if (this.config.regulations.includes(RegulationType.MAR)) {
            const marViolation = this.checkMarketAbuse(trade);
            if (marViolation) {
                violations.push(marViolation);
            }
        }
        // Best Execution (MiFID II)
        if (this.config.regulations.includes(RegulationType.MIFID2)) {
            const bestExViolation = this.checkBestExecution(trade);
            if (bestExViolation) {
                violations.push(bestExViolation);
            }
        }
        const check = {
            id: checkId,
            type: 'pre_trade',
            timestamp: new Date(),
            entity: trade.userId,
            checkType: 'comprehensive',
            result: violations.length === 0 ? 'pass' :
                violations.some(v => v.severity === 'critical') ? 'fail' : 'warning',
            details: {
                tradeId: trade.id,
                symbol: trade.symbol,
                quantity: trade.quantity,
                value: trade.quantity * trade.price
            },
            violations
        };
        this.complianceChecks.set(checkId, check);
        // Log audit entry
        this.logAudit({
            userId: 'system',
            action: 'pre_trade_check',
            entityType: 'trade',
            entityId: trade.id,
            changes: { checkId, result: check.result },
            result: 'success'
        });
        // Emit event
        this.emit('compliance-check', check);
        if (check.result === 'fail') {
            this.logger.error('Pre-trade compliance check failed', {
                checkId,
                violations: violations.filter(v => v.severity === 'critical')
            });
        }
        return check;
    }
    async checkPostTrade(execution) {
        const checkId = this.generateCheckId();
        const violations = [];
        // Transaction Reporting (MiFID II)
        if (this.config.regulations.includes(RegulationType.MIFID2)) {
            const reportingViolation = this.checkTransactionReporting(execution);
            if (reportingViolation) {
                violations.push(reportingViolation);
            }
        }
        // Large Transaction Reporting
        if (execution.value > this.config.reportingThresholds.largeTransaction) {
            this.scheduleLargeTransactionReport(execution);
        }
        // Settlement Risk
        const settlementViolation = this.checkSettlementRisk(execution);
        if (settlementViolation) {
            violations.push(settlementViolation);
        }
        const check = {
            id: checkId,
            type: 'post_trade',
            timestamp: new Date(),
            entity: execution.userId,
            checkType: 'post_execution',
            result: violations.length === 0 ? 'pass' : 'warning',
            details: {
                executionId: execution.id,
                symbol: execution.symbol,
                executedQuantity: execution.quantity,
                executedPrice: execution.price,
                venue: execution.venue
            },
            violations
        };
        this.complianceChecks.set(checkId, check);
        return check;
    }
    async checkTransactionLimits(trade) {
        const tradeValue = trade.quantity * trade.price;
        // Single transaction limit
        if (tradeValue > this.config.transactionLimits.singleTransactionLimit) {
            return {
                rule: 'SINGLE_TRANSACTION_LIMIT',
                severity: 'high',
                description: `Transaction value ${tradeValue} exceeds limit ${this.config.transactionLimits.singleTransactionLimit}`,
                remediation: 'Split order or seek approval for large transaction'
            };
        }
        // Daily limit check - NOW USING ATOMIC REDIS OPERATIONS
        if (this.volumeTracker) {
            // Use atomic check-and-increment for race condition safety
            const { allowed, currentVolume } = await this.volumeTracker.checkAndIncrementVolume(trade.userId, tradeValue, this.config.transactionLimits.dailyLimit);
            if (!allowed) {
                return {
                    rule: 'DAILY_LIMIT_EXCEEDED',
                    severity: 'medium',
                    description: `Daily trading limit would be exceeded (current: ${currentVolume}, limit: ${this.config.transactionLimits.dailyLimit})`,
                    remediation: 'Wait until next trading day or request limit increase'
                };
            }
            // Volume was atomically incremented if allowed
            return null;
        }
        else {
            // Fallback to old method if volume tracker not configured
            const dailyVolume = await this.getUserDailyVolume(trade.userId);
            if (dailyVolume + tradeValue > this.config.transactionLimits.dailyLimit) {
                return {
                    rule: 'DAILY_LIMIT_EXCEEDED',
                    severity: 'medium',
                    description: `Daily trading limit would be exceeded`,
                    remediation: 'Wait until next trading day or request limit increase'
                };
            }
        }
        return null;
    }
    checkMarketAbuse(trade) {
        // Simplified market abuse detection
        // In production, this would use sophisticated pattern detection
        // Check for potential spoofing (rapid order placement/cancellation)
        const recentOrders = this.getRecentUserOrders(trade.userId);
        const cancelRate = this.calculateCancelRate(recentOrders);
        if (cancelRate > 0.9) { // 90% cancel rate
            return {
                rule: 'POTENTIAL_SPOOFING',
                severity: 'high',
                description: 'High order cancellation rate detected',
                remediation: 'Review trading pattern for market manipulation',
                regulatoryReference: 'MAR Article 12'
            };
        }
        // Check for wash trading (self-matching)
        if (this.detectWashTrading(trade)) {
            return {
                rule: 'WASH_TRADING_RISK',
                severity: 'critical',
                description: 'Potential wash trading detected',
                remediation: 'Ensure orders do not self-match',
                regulatoryReference: 'MAR Article 12(1)(a)'
            };
        }
        return null;
    }
    checkBestExecution(trade) {
        // Check if best execution obligations are met
        const venues = this.getAvailableVenues(trade.symbol);
        const bestPrice = this.getBestPrice(venues, trade.symbol, trade.side);
        if (trade.price && trade.side === 'BUY' && trade.price > bestPrice * 1.01) {
            return {
                rule: 'BEST_EXECUTION',
                severity: 'medium',
                description: 'Order price significantly worse than best available',
                remediation: 'Route order to venue with best price',
                regulatoryReference: 'MiFID II Article 27'
            };
        }
        return null;
    }
    checkTransactionReporting(execution) {
        // Check if transaction needs regulatory reporting
        const reportingDeadline = this.getReportingDeadline(execution);
        if (reportingDeadline && !execution.reported) {
            return {
                rule: 'TRANSACTION_REPORTING',
                severity: 'high',
                description: 'Transaction requires regulatory reporting',
                remediation: `Submit transaction report by ${reportingDeadline}`,
                regulatoryReference: 'MiFID II Article 26'
            };
        }
        return null;
    }
    checkSettlementRisk(execution) {
        // Check settlement risk based on counterparty and value
        const settlementRisk = this.calculateSettlementRisk(execution);
        if (settlementRisk > 0.8) {
            return {
                rule: 'HIGH_SETTLEMENT_RISK',
                severity: 'medium',
                description: 'High settlement risk detected',
                remediation: 'Consider using CCP or requiring collateral'
            };
        }
        return null;
    }
    async verifyKYC(userId) {
        const kyc = this.kycData.get(userId);
        if (!kyc) {
            return 'pending';
        }
        // Check expiration
        if (kyc.expiresAt && kyc.expiresAt < new Date()) {
            return 'expired';
        }
        return kyc.status;
    }
    async performAMLCheck(userId, checkType) {
        // Simulate AML check
        const check = {
            userId,
            timestamp: new Date(),
            checkType,
            result: Math.random() > 0.95 ? 'potential_match' : 'clear', // 5% match rate
            matchedLists: [],
            riskScore: Math.random() * 100,
            nextCheckDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
        };
        // Store check result
        if (!this.amlChecks.has(userId)) {
            this.amlChecks.set(userId, []);
        }
        this.amlChecks.get(userId).push(check);
        if (check.result !== 'clear') {
            this.logger.warn('AML check flagged user', {
                userId,
                checkType,
                result: check.result,
                riskScore: check.riskScore
            });
            this.emit('aml-alert', check);
        }
        return check;
    }
    performPeriodicChecks() {
        this.logger.info('Performing periodic compliance checks');
        // Check for expired KYC
        for (const [userId, kyc] of this.kycData) {
            if (kyc.expiresAt && kyc.expiresAt < new Date()) {
                this.emit('kyc-expired', { userId, kyc });
            }
        }
        // Check for required AML reviews
        const now = new Date();
        for (const [userId, checks] of this.amlChecks) {
            const latestCheck = checks[checks.length - 1];
            if (latestCheck && latestCheck.nextCheckDate < now) {
                this.performAMLCheck(userId, 'sanctions').catch(err => {
                    this.logger.error('Periodic AML check failed', { userId, error: err });
                });
            }
        }
        // Generate periodic reports
        if (this.shouldGenerateReport('daily')) {
            this.generateComplianceReport('daily').catch(err => {
                this.logger.error('Failed to generate daily report', err);
            });
        }
    }
    async generateComplianceReport(type) {
        const period = this.getReportPeriod(type);
        const checks = Array.from(this.complianceChecks.values())
            .filter(c => c.timestamp >= period.start && c.timestamp <= period.end);
        const violations = checks.flatMap(c => c.violations);
        const summary = {
            totalTransactions: checks.length,
            totalVolume: this.calculateTotalVolume(checks),
            flaggedTransactions: checks.filter(c => c.result !== 'pass').length,
            violationsCount: violations.length,
            riskScore: this.calculateOverallRiskScore(checks),
            complianceRate: checks.filter(c => c.result === 'pass').length / checks.length
        };
        const report = {
            id: this.generateReportId(),
            type,
            period,
            generatedAt: new Date(),
            summary,
            violations: this.aggregateViolations(violations),
            recommendations: this.generateRecommendations(summary, violations),
            regulatoryFilings: this.getRequiredFilings(type, period)
        };
        this.logger.info('Generated compliance report', {
            reportId: report.id,
            type,
            period,
            summary
        });
        this.emit('report-generated', report);
        return report;
    }
    logAudit(entry) {
        const auditEntry = {
            ...entry,
            id: this.generateAuditId(),
            timestamp: new Date(),
            ipAddress: '127.0.0.1', // In production, get from request
            userAgent: 'ComplianceEngine/1.0' // In production, get from request
        };
        this.auditLog.push(auditEntry);
        // In production, persist to database
        // Ensure immutability and tamper-evidence
    }
    // Helper methods
    generateCheckId() {
        return `CHECK-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    generateAuditId() {
        return `AUDIT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    generateReportId() {
        return `REPORT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    async getUserDailyVolume(userId) {
        // Use distributed state for daily volume tracking
        if (this.stateManager) {
            const today = new Date().toISOString().split('T')[0];
            const key = `daily-volume:${userId}:${today}`;
            const volume = await this.stateManager.getState(key, { namespace: 'compliance' });
            return volume || 0;
        }
        // Fallback to simulated value
        return Math.random() * 1000000;
    }
    getRecentUserOrders(userId) {
        // In production, fetch from order management system
        return [];
    }
    calculateCancelRate(orders) {
        // In production, calculate actual cancel rate
        return Math.random();
    }
    detectWashTrading(trade) {
        // In production, check for self-matching patterns
        return false;
    }
    getAvailableVenues(symbol) {
        return ['VENUE1', 'VENUE2', 'VENUE3'];
    }
    getBestPrice(venues, symbol, side) {
        // In production, get real-time best price across venues
        return 100 + Math.random() * 10;
    }
    getReportingDeadline(execution) {
        // T+1 reporting for MiFID II
        if (this.config.regulations.includes(RegulationType.MIFID2)) {
            const deadline = new Date(execution.timestamp);
            deadline.setDate(deadline.getDate() + 1);
            deadline.setHours(23, 59, 59, 999);
            return deadline;
        }
        return null;
    }
    calculateSettlementRisk(execution) {
        // In production, use counterparty credit ratings and other factors
        return Math.random();
    }
    scheduleLargeTransactionReport(execution) {
        this.logger.info('Scheduling large transaction report', {
            executionId: execution.id,
            value: execution.value
        });
        // In production, create regulatory filing
        this.emit('large-transaction', execution);
    }
    shouldGenerateReport(type) {
        // In production, check schedule and last report time
        return Math.random() > 0.9;
    }
    getReportPeriod(type) {
        const end = new Date();
        const start = new Date();
        switch (type) {
            case 'daily':
                start.setDate(start.getDate() - 1);
                break;
            case 'weekly':
                start.setDate(start.getDate() - 7);
                break;
            case 'monthly':
                start.setMonth(start.getMonth() - 1);
                break;
            case 'quarterly':
                start.setMonth(start.getMonth() - 3);
                break;
            case 'annual':
                start.setFullYear(start.getFullYear() - 1);
                break;
        }
        return { start, end };
    }
    calculateTotalVolume(checks) {
        return checks.reduce((sum, check) => sum + (check.details.value || 0), 0);
    }
    calculateOverallRiskScore(checks) {
        // Weighted risk score based on violations
        const weights = { low: 1, medium: 2, high: 3, critical: 4 };
        let totalScore = 0;
        let totalWeight = 0;
        for (const check of checks) {
            for (const violation of check.violations) {
                totalScore += weights[violation.severity];
                totalWeight += 1;
            }
        }
        return totalWeight > 0 ? (totalScore / totalWeight) * 25 : 0; // Scale to 0-100
    }
    aggregateViolations(violations) {
        // Group and deduplicate violations
        const grouped = new Map();
        for (const violation of violations) {
            const existing = grouped.get(violation.rule);
            if (!existing || violation.severity > existing.severity) {
                grouped.set(violation.rule, violation);
            }
        }
        return Array.from(grouped.values());
    }
    generateRecommendations(summary, violations) {
        const recommendations = [];
        if (summary.complianceRate < 0.95) {
            recommendations.push('Increase pre-trade compliance checks to improve compliance rate');
        }
        if (summary.riskScore > 50) {
            recommendations.push('Review and update risk management procedures');
        }
        const criticalViolations = violations.filter(v => v.severity === 'critical');
        if (criticalViolations.length > 0) {
            recommendations.push('Immediate action required for critical violations');
        }
        return recommendations;
    }
    getRequiredFilings(type, period) {
        const filings = [];
        // MiFID II transaction reporting
        if (this.config.regulations.includes(RegulationType.MIFID2)) {
            filings.push({
                regulator: 'ESMA',
                filingType: 'Transaction Report',
                dueDate: new Date(period.end.getTime() + 24 * 60 * 60 * 1000), // T+1
                status: 'pending'
            });
        }
        // Other regulatory filings based on jurisdiction and regulations
        return filings;
    }
}
exports.ComplianceEngine = ComplianceEngine;
//# sourceMappingURL=ComplianceEngine.js.map