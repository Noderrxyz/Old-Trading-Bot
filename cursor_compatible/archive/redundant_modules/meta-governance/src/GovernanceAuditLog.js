"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GovernanceAuditLog = void 0;
const events_1 = require("events");
const crypto = __importStar(require("crypto"));
const createLogger = (name) => ({
    info: (message, meta) => console.log(`[${name}] INFO:`, message, meta || ''),
    error: (message, error) => console.error(`[${name}] ERROR:`, message, error || ''),
    debug: (message, meta) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
    warn: (message, meta) => console.warn(`[${name}] WARN:`, message, meta || '')
});
class GovernanceAuditLog extends events_1.EventEmitter {
    logger;
    auditEntries;
    lastHash;
    maxEntries = 1000000; // 1M entries before archival
    constructor() {
        super();
        this.logger = createLogger('GovernanceAudit');
        this.auditEntries = [];
        this.lastHash = this.generateGenesisHash();
        this.initializeAuditLog();
    }
    initializeAuditLog() {
        // Create genesis block
        const genesisEntry = {
            id: 'audit_genesis',
            timestamp: new Date(),
            action: 'STRATEGY_ENABLED',
            actor: 'SYSTEM',
            target: 'AUDIT_LOG',
            details: {
                message: 'Governance audit log initialized',
                version: '1.0.0'
            },
            impact: 'LOW',
            hash: this.lastHash,
            previousHash: '0',
            signature: this.signEntry('SYSTEM', this.lastHash)
        };
        this.auditEntries.push(genesisEntry);
        this.logger.info('Governance audit log initialized');
    }
    generateGenesisHash() {
        return crypto
            .createHash('sha256')
            .update('NODERR_GOVERNANCE_AUDIT_LOG_GENESIS')
            .digest('hex');
    }
    async logAction(params) {
        const entry = {
            id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date(),
            action: params.action,
            actor: params.actor,
            target: params.target,
            details: params.details,
            impact: params.impact,
            hash: '',
            previousHash: this.lastHash,
            signature: ''
        };
        // Generate hash for this entry
        entry.hash = this.generateHash(entry);
        // Sign the entry
        entry.signature = this.signEntry(params.actor, entry.hash);
        // Add to audit trail
        this.auditEntries.push(entry);
        this.lastHash = entry.hash;
        this.logger.info('Governance action logged', {
            id: entry.id,
            action: entry.action,
            actor: entry.actor,
            target: entry.target,
            impact: entry.impact
        });
        // Emit event for real-time monitoring
        this.emit('audit-entry', entry);
        // Check if we need to archive
        if (this.auditEntries.length >= this.maxEntries) {
            await this.archiveOldEntries();
        }
        return entry;
    }
    generateHash(entry) {
        const data = JSON.stringify({
            id: entry.id,
            timestamp: entry.timestamp.toISOString(),
            action: entry.action,
            actor: entry.actor,
            target: entry.target,
            details: entry.details,
            impact: entry.impact,
            previousHash: entry.previousHash
        });
        return crypto
            .createHash('sha256')
            .update(data)
            .digest('hex');
    }
    signEntry(actor, hash) {
        // In production, this would use proper digital signatures
        // For now, we'll use a simple HMAC
        const secret = `${actor}_SECRET_KEY`;
        return crypto
            .createHmac('sha256', secret)
            .update(hash)
            .digest('hex');
    }
    verifyIntegrity(startIndex = 0) {
        if (this.auditEntries.length === 0)
            return true;
        for (let i = startIndex; i < this.auditEntries.length; i++) {
            const entry = this.auditEntries[i];
            // Verify hash
            const recalculatedHash = this.generateHash({
                ...entry,
                hash: undefined
            });
            if (entry.hash !== recalculatedHash) {
                this.logger.error('Audit trail integrity violation detected', {
                    entryId: entry.id,
                    index: i,
                    expectedHash: recalculatedHash,
                    actualHash: entry.hash
                });
                return false;
            }
            // Verify chain
            if (i > 0 && entry.previousHash !== this.auditEntries[i - 1].hash) {
                this.logger.error('Audit trail chain broken', {
                    entryId: entry.id,
                    index: i
                });
                return false;
            }
        }
        return true;
    }
    getEntries(filters) {
        let entries = [...this.auditEntries];
        if (filters) {
            if (filters.action) {
                entries = entries.filter(e => e.action === filters.action);
            }
            if (filters.actor) {
                entries = entries.filter(e => e.actor === filters.actor);
            }
            if (filters.target) {
                entries = entries.filter(e => e.target === filters.target);
            }
            if (filters.impact) {
                entries = entries.filter(e => e.impact === filters.impact);
            }
            if (filters.startDate) {
                entries = entries.filter(e => e.timestamp >= filters.startDate);
            }
            if (filters.endDate) {
                entries = entries.filter(e => e.timestamp <= filters.endDate);
            }
        }
        if (filters?.limit) {
            entries = entries.slice(-filters.limit);
        }
        return entries;
    }
    generateSummary(startDate, endDate) {
        const filteredEntries = this.getEntries({ startDate, endDate });
        const actionBreakdown = {};
        const impactBreakdown = {};
        const actorActivity = {};
        for (const entry of filteredEntries) {
            // Action breakdown
            actionBreakdown[entry.action] = (actionBreakdown[entry.action] || 0) + 1;
            // Impact breakdown
            impactBreakdown[entry.impact] = (impactBreakdown[entry.impact] || 0) + 1;
            // Actor activity
            actorActivity[entry.actor] = (actorActivity[entry.actor] || 0) + 1;
        }
        const timeRange = filteredEntries.length > 0 ? {
            start: filteredEntries[0].timestamp,
            end: filteredEntries[filteredEntries.length - 1].timestamp
        } : {
            start: new Date(),
            end: new Date()
        };
        return {
            totalEntries: filteredEntries.length,
            actionBreakdown,
            impactBreakdown,
            actorActivity,
            timeRange
        };
    }
    generateComplianceReport(startDate, endDate) {
        const entries = this.getEntries({ startDate, endDate });
        const emergencyActions = entries.filter(e => e.action === 'EMERGENCY_ACTION').length;
        const criticalActions = entries.filter(e => e.impact === 'CRITICAL').length;
        const policyViolations = entries.filter(e => e.details.violation === true || e.action === 'RISK_OVERRIDE').length;
        const auditTrailIntegrity = this.verifyIntegrity();
        const recommendations = [];
        if (emergencyActions > 5) {
            recommendations.push('High number of emergency actions detected. Review risk management procedures.');
        }
        if (criticalActions > entries.length * 0.1) {
            recommendations.push('More than 10% of actions are critical. Consider reviewing decision thresholds.');
        }
        if (!auditTrailIntegrity) {
            recommendations.push('CRITICAL: Audit trail integrity compromised. Immediate investigation required.');
        }
        if (policyViolations > 0) {
            recommendations.push(`${policyViolations} policy violations detected. Review and update policies.`);
        }
        return {
            period: { start: startDate, end: endDate },
            totalActions: entries.length,
            criticalActions,
            emergencyActions,
            policyViolations,
            auditTrailIntegrity,
            recommendations
        };
    }
    async archiveOldEntries() {
        const entriesToArchive = this.auditEntries.slice(0, this.maxEntries / 2);
        const remainingEntries = this.auditEntries.slice(this.maxEntries / 2);
        // In production, this would write to persistent storage
        const archiveData = {
            entries: entriesToArchive,
            archiveDate: new Date(),
            startHash: entriesToArchive[0].hash,
            endHash: entriesToArchive[entriesToArchive.length - 1].hash,
            integrity: this.verifyIntegrity(0)
        };
        this.logger.info('Archiving old audit entries', {
            entriesArchived: entriesToArchive.length,
            remainingEntries: remainingEntries.length
        });
        // Simulate archive write
        await this.writeToArchive(archiveData);
        // Update current entries
        this.auditEntries = remainingEntries;
        this.emit('entries-archived', {
            count: entriesToArchive.length,
            archiveDate: archiveData.archiveDate
        });
    }
    async writeToArchive(data) {
        // In production, this would write to:
        // - Distributed file system (IPFS)
        // - Cloud storage (S3)
        // - Blockchain for critical entries
        // Simulate async write
        await new Promise(resolve => setTimeout(resolve, 100));
        this.logger.info('Archive written successfully');
    }
    exportForAuditor(format = 'JSON') {
        const entries = this.getEntries();
        if (format === 'JSON') {
            return JSON.stringify({
                auditLog: entries,
                metadata: {
                    totalEntries: entries.length,
                    integrityVerified: this.verifyIntegrity(),
                    exportDate: new Date(),
                    lastHash: this.lastHash
                }
            }, null, 2);
        }
        else {
            // CSV format
            const headers = ['ID', 'Timestamp', 'Action', 'Actor', 'Target', 'Impact', 'Hash'];
            const rows = entries.map(e => [
                e.id,
                e.timestamp.toISOString(),
                e.action,
                e.actor,
                e.target,
                e.impact,
                e.hash
            ]);
            return [headers, ...rows].map(row => row.join(',')).join('\n');
        }
    }
    searchEntries(query) {
        const lowerQuery = query.toLowerCase();
        return this.auditEntries.filter(entry => entry.id.toLowerCase().includes(lowerQuery) ||
            entry.action.toLowerCase().includes(lowerQuery) ||
            entry.actor.toLowerCase().includes(lowerQuery) ||
            entry.target.toLowerCase().includes(lowerQuery) ||
            JSON.stringify(entry.details).toLowerCase().includes(lowerQuery));
    }
    getMetrics() {
        if (this.auditEntries.length === 0) {
            return {
                totalEntries: 0,
                averageEntriesPerDay: 0,
                mostActiveActor: 'N/A',
                mostCommonAction: 'STRATEGY_ENABLED',
                criticalActionRate: 0
            };
        }
        const timeRange = this.auditEntries[this.auditEntries.length - 1].timestamp.getTime() -
            this.auditEntries[0].timestamp.getTime();
        const days = timeRange / (1000 * 60 * 60 * 24) || 1;
        const actorCounts = new Map();
        const actionCounts = new Map();
        let criticalCount = 0;
        for (const entry of this.auditEntries) {
            actorCounts.set(entry.actor, (actorCounts.get(entry.actor) || 0) + 1);
            actionCounts.set(entry.action, (actionCounts.get(entry.action) || 0) + 1);
            if (entry.impact === 'CRITICAL')
                criticalCount++;
        }
        const mostActiveActor = Array.from(actorCounts.entries())
            .sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
        const mostCommonAction = Array.from(actionCounts.entries())
            .sort((a, b) => b[1] - a[1])[0]?.[0] || 'STRATEGY_ENABLED';
        return {
            totalEntries: this.auditEntries.length,
            averageEntriesPerDay: this.auditEntries.length / days,
            mostActiveActor,
            mostCommonAction,
            criticalActionRate: criticalCount / this.auditEntries.length
        };
    }
}
exports.GovernanceAuditLog = GovernanceAuditLog;
//# sourceMappingURL=GovernanceAuditLog.js.map