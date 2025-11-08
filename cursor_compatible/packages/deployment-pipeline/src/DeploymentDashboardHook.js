"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeploymentDashboardHook = void 0;
const events_1 = require("events");
const createLogger = (name) => ({
    info: (message, meta) => console.log(`[${name}] INFO:`, message, meta || ''),
    error: (message, error) => console.error(`[${name}] ERROR:`, message, error || ''),
    debug: (message, meta) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
    warn: (message, meta) => console.warn(`[${name}] WARN:`, message, meta || '')
});
class DeploymentDashboardHook extends events_1.EventEmitter {
    logger;
    widgets;
    deploymentStatuses;
    approvalRequests;
    alerts;
    grafanaPanels;
    metricsBuffer;
    refreshIntervals;
    constructor() {
        super();
        this.logger = createLogger('DeploymentDashboard');
        this.widgets = new Map();
        this.deploymentStatuses = new Map();
        this.approvalRequests = new Map();
        this.alerts = [];
        this.grafanaPanels = new Map();
        this.metricsBuffer = new Map();
        this.refreshIntervals = new Map();
        this.initializeDashboard();
    }
    initializeDashboard() {
        // Initialize default widgets
        this.createWidget({
            id: 'deployment-timeline',
            type: 'TIMELINE',
            title: 'Deployment Timeline',
            data: [],
            refreshInterval: 5000,
            position: { x: 0, y: 0, width: 12, height: 4 }
        });
        this.createWidget({
            id: 'deployment-metrics',
            type: 'METRICS',
            title: 'Deployment Metrics',
            data: {},
            refreshInterval: 10000,
            position: { x: 0, y: 4, width: 6, height: 4 }
        });
        this.createWidget({
            id: 'active-deployments',
            type: 'STATUS',
            title: 'Active Deployments',
            data: [],
            refreshInterval: 3000,
            position: { x: 6, y: 4, width: 6, height: 4 }
        });
        this.createWidget({
            id: 'pending-approvals',
            type: 'APPROVALS',
            title: 'Pending Approvals',
            data: [],
            refreshInterval: 5000,
            position: { x: 0, y: 8, width: 6, height: 4 }
        });
        this.createWidget({
            id: 'system-alerts',
            type: 'ALERTS',
            title: 'System Alerts',
            data: [],
            refreshInterval: 3000,
            position: { x: 6, y: 8, width: 6, height: 4 }
        });
        // Initialize Grafana panels
        this.initializeGrafanaPanels();
        // Start refresh cycles
        this.startRefreshCycles();
        this.logger.info('Deployment dashboard initialized');
    }
    initializeGrafanaPanels() {
        // Deployment success rate panel
        this.grafanaPanels.set('deployment-success-rate', {
            id: 'deployment-success-rate',
            title: 'Deployment Success Rate',
            type: 'stat',
            datasource: 'prometheus',
            query: 'rate(deployments_total{status="completed"}[1h])/rate(deployments_total[1h])',
            refreshInterval: '30s'
        });
        // Deployment duration panel
        this.grafanaPanels.set('deployment-duration', {
            id: 'deployment-duration',
            title: 'Deployment Duration by Stage',
            type: 'graph',
            datasource: 'prometheus',
            query: 'deployment_duration_seconds',
            refreshInterval: '1m'
        });
        // Rollback frequency panel
        this.grafanaPanels.set('rollback-frequency', {
            id: 'rollback-frequency',
            title: 'Rollback Frequency',
            type: 'gauge',
            datasource: 'prometheus',
            query: 'rate(rollbacks_total[24h])',
            refreshInterval: '5m'
        });
        // Strategy performance comparison
        this.grafanaPanels.set('strategy-performance', {
            id: 'strategy-performance',
            title: 'Strategy Performance Comparison',
            type: 'table',
            datasource: 'prometheus',
            query: 'strategy_performance_score',
            refreshInterval: '1m'
        });
        // System health heatmap
        this.grafanaPanels.set('system-health', {
            id: 'system-health',
            title: 'System Health Heatmap',
            type: 'heatmap',
            datasource: 'prometheus',
            query: 'system_health_score',
            refreshInterval: '30s'
        });
    }
    createWidget(widget) {
        this.widgets.set(widget.id, widget);
        // Set up refresh interval
        if (widget.refreshInterval > 0) {
            const interval = setInterval(() => {
                this.refreshWidget(widget.id);
            }, widget.refreshInterval);
            this.refreshIntervals.set(widget.id, interval);
        }
    }
    startRefreshCycles() {
        // Refresh deployment statuses
        setInterval(() => {
            this.updateDeploymentStatuses();
        }, 3000);
        // Process metrics buffer
        setInterval(() => {
            this.flushMetricsBuffer();
        }, 10000);
        // Check for stale approvals
        setInterval(() => {
            this.checkStaleApprovals();
        }, 60000);
    }
    trackDeployment(status) {
        this.deploymentStatuses.set(status.deploymentId, status);
        this.logger.info('Tracking deployment', {
            deploymentId: status.deploymentId,
            stage: status.stage,
            status: status.status,
            progress: status.progress
        });
        // Update timeline widget
        this.updateTimelineWidget(status);
        // Emit metrics
        this.recordMetric('deployment_stage', {
            deploymentId: status.deploymentId,
            stage: status.stage,
            status: status.status
        });
        this.emit('deployment-tracked', status);
    }
    createApprovalRequest(request) {
        const approvalId = `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const approval = {
            id: approvalId,
            requestTime: new Date(),
            ...request
        };
        this.approvalRequests.set(approvalId, approval);
        this.logger.info('Approval request created', {
            approvalId,
            type: approval.type,
            deploymentId: approval.deploymentId
        });
        // Send notifications
        this.notifyApprovers(approval);
        // Update approvals widget
        this.refreshWidget('pending-approvals');
        this.emit('approval-requested', approval);
        return approvalId;
    }
    submitApproval(approvalId, approver, decision, comments) {
        const approval = this.approvalRequests.get(approvalId);
        if (!approval)
            return;
        approval.currentApprovals.push({
            approver,
            decision,
            timestamp: new Date(),
            comments
        });
        this.logger.info('Approval submitted', {
            approvalId,
            approver,
            decision
        });
        // Check if approval is complete
        const approved = this.checkApprovalComplete(approval);
        if (approved !== null) {
            this.emit('approval-complete', {
                approvalId,
                approved,
                approval
            });
            // Remove from pending
            this.approvalRequests.delete(approvalId);
        }
        this.refreshWidget('pending-approvals');
    }
    checkApprovalComplete(approval) {
        const approvedCount = approval.currentApprovals.filter(a => a.decision === 'APPROVED').length;
        const rejectedCount = approval.currentApprovals.filter(a => a.decision === 'REJECTED').length;
        // Any rejection = rejected
        if (rejectedCount > 0) {
            return false;
        }
        // All required approvers approved = approved
        if (approvedCount >= approval.requiredApprovers.length) {
            return true;
        }
        // Still pending
        return null;
    }
    createAlert(alert) {
        const newAlert = {
            id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date(),
            acknowledged: false,
            ...alert
        };
        this.alerts.push(newAlert);
        this.logger.warn('Alert created', {
            alertId: newAlert.id,
            severity: newAlert.severity,
            title: newAlert.title
        });
        // Keep only recent alerts (last 1000)
        if (this.alerts.length > 1000) {
            this.alerts = this.alerts.slice(-1000);
        }
        this.refreshWidget('system-alerts');
        this.emit('alert-created', newAlert);
    }
    acknowledgeAlert(alertId) {
        const alert = this.alerts.find(a => a.id === alertId);
        if (alert) {
            alert.acknowledged = true;
            this.refreshWidget('system-alerts');
        }
    }
    updateTimelineWidget(status) {
        const widget = this.widgets.get('deployment-timeline');
        if (!widget)
            return;
        // Update timeline data
        const timelineData = widget.data;
        const existingIndex = timelineData.findIndex(d => d.deploymentId === status.deploymentId);
        const timelineEntry = {
            deploymentId: status.deploymentId,
            strategyName: status.strategyName,
            version: status.version,
            stages: this.getStageTimeline(status),
            currentStage: status.stage,
            status: status.status,
            startTime: status.startTime,
            endTime: status.status === 'COMPLETED' || status.status === 'FAILED'
                ? new Date() : undefined
        };
        if (existingIndex >= 0) {
            timelineData[existingIndex] = timelineEntry;
        }
        else {
            timelineData.push(timelineEntry);
        }
        // Keep only recent deployments (last 20)
        widget.data = timelineData.slice(-20);
    }
    getStageTimeline(status) {
        // Mock stage timeline - in production would track actual stages
        const stages = ['DEVELOPMENT', 'BACKTEST', 'PAPER', 'CANARY', 'PRODUCTION'];
        const currentIndex = stages.indexOf(status.stage);
        return stages.map((stage, index) => ({
            stage,
            status: index < currentIndex ? 'COMPLETED' :
                index === currentIndex ? status.status :
                    'PENDING',
            startTime: index <= currentIndex ? new Date(status.startTime.getTime() + index * 3600000) : undefined,
            endTime: index < currentIndex ? new Date(status.startTime.getTime() + (index + 1) * 3600000) : undefined
        }));
    }
    refreshWidget(widgetId) {
        const widget = this.widgets.get(widgetId);
        if (!widget)
            return;
        switch (widget.type) {
            case 'TIMELINE':
                // Timeline data is updated in real-time
                break;
            case 'METRICS':
                widget.data = this.calculateDeploymentMetrics();
                break;
            case 'STATUS':
                widget.data = Array.from(this.deploymentStatuses.values())
                    .filter(s => s.status === 'IN_PROGRESS');
                break;
            case 'APPROVALS':
                widget.data = Array.from(this.approvalRequests.values());
                break;
            case 'ALERTS':
                widget.data = this.alerts
                    .filter(a => !a.acknowledged)
                    .slice(-10); // Last 10 unacknowledged alerts
                break;
        }
        this.emit('widget-updated', widget);
    }
    calculateDeploymentMetrics() {
        const statuses = Array.from(this.deploymentStatuses.values());
        const completed = statuses.filter(s => s.status === 'COMPLETED');
        const failed = statuses.filter(s => s.status === 'FAILED');
        return {
            totalDeployments: statuses.length,
            successRate: statuses.length > 0 ? completed.length / statuses.length : 0,
            failureRate: statuses.length > 0 ? failed.length / statuses.length : 0,
            averageDeploymentTime: this.calculateAverageDeploymentTime(completed),
            activeDeployments: statuses.filter(s => s.status === 'IN_PROGRESS').length,
            pendingApprovals: this.approvalRequests.size,
            recentAlerts: this.alerts.filter(a => !a.acknowledged).length
        };
    }
    calculateAverageDeploymentTime(deployments) {
        if (deployments.length === 0)
            return 0;
        const totalTime = deployments.reduce((sum, d) => {
            return sum + (d.duration || 0);
        }, 0);
        return totalTime / deployments.length;
    }
    updateDeploymentStatuses() {
        // Update progress for in-progress deployments
        for (const [id, status] of this.deploymentStatuses) {
            if (status.status === 'IN_PROGRESS') {
                // Simulate progress
                status.progress = Math.min(100, status.progress + Math.random() * 5);
                if (status.progress >= 100) {
                    status.status = Math.random() > 0.1 ? 'COMPLETED' : 'FAILED';
                    status.duration = Date.now() - status.startTime.getTime();
                }
            }
        }
        this.refreshWidget('active-deployments');
        this.refreshWidget('deployment-metrics');
    }
    notifyApprovers(approval) {
        for (const approver of approval.requiredApprovers) {
            this.emit('notification', {
                recipient: approver,
                type: 'APPROVAL_REQUEST',
                title: `Approval Required: ${approval.type}`,
                message: `Deployment ${approval.deploymentId} requires your approval for ${approval.stage}`,
                link: `/approvals/${approval.id}`
            });
        }
    }
    checkStaleApprovals() {
        const now = Date.now();
        for (const [id, approval] of this.approvalRequests) {
            if (approval.deadline && approval.deadline.getTime() < now) {
                this.createAlert({
                    severity: 'WARNING',
                    title: 'Stale Approval Request',
                    message: `Approval request ${id} has passed its deadline`,
                    deploymentId: approval.deploymentId
                });
                // Auto-reject stale approvals
                this.submitApproval(id, 'SYSTEM', 'REJECTED', 'Deadline exceeded');
            }
        }
    }
    recordMetric(name, labels) {
        const buffer = this.metricsBuffer.get(name) || [];
        buffer.push({
            timestamp: new Date(),
            labels,
            value: 1
        });
        this.metricsBuffer.set(name, buffer);
    }
    flushMetricsBuffer() {
        for (const [metric, buffer] of this.metricsBuffer) {
            if (buffer.length > 0) {
                this.emit('metrics-batch', {
                    metric,
                    data: buffer
                });
            }
        }
        this.metricsBuffer.clear();
    }
    getGrafanaDashboardConfig() {
        return {
            panels: Array.from(this.grafanaPanels.values()),
            variables: [
                {
                    name: 'deployment_id',
                    type: 'query',
                    query: 'label_values(deployment_stage, deployment_id)'
                },
                {
                    name: 'strategy_id',
                    type: 'query',
                    query: 'label_values(strategy_performance_score, strategy_id)'
                }
            ],
            time: {
                from: 'now-6h',
                to: 'now'
            }
        };
    }
    getDeploymentHistory(filters, limit = 100) {
        let deployments = Array.from(this.deploymentStatuses.values());
        if (filters) {
            if (filters.strategyId) {
                deployments = deployments.filter(d => d.strategyId === filters.strategyId);
            }
            if (filters.status) {
                deployments = deployments.filter(d => d.status === filters.status);
            }
            if (filters.startDate) {
                deployments = deployments.filter(d => d.startTime >= filters.startDate);
            }
            if (filters.endDate) {
                deployments = deployments.filter(d => d.startTime <= filters.endDate);
            }
        }
        return deployments
            .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
            .slice(0, limit);
    }
    exportDashboardData(format = 'JSON') {
        const data = {
            deployments: Array.from(this.deploymentStatuses.values()),
            approvals: Array.from(this.approvalRequests.values()),
            alerts: this.alerts,
            metrics: this.calculateDeploymentMetrics(),
            exportTime: new Date()
        };
        if (format === 'JSON') {
            return JSON.stringify(data, null, 2);
        }
        else {
            // Simple CSV export for deployments
            const headers = ['DeploymentID', 'Strategy', 'Version', 'Stage', 'Status', 'StartTime'];
            const rows = data.deployments.map(d => [
                d.deploymentId,
                d.strategyName,
                d.version,
                d.stage,
                d.status,
                d.startTime.toISOString()
            ]);
            return [headers, ...rows].map(row => row.join(',')).join('\n');
        }
    }
    destroy() {
        // Clear all intervals
        for (const interval of this.refreshIntervals.values()) {
            clearInterval(interval);
        }
        this.refreshIntervals.clear();
        this.logger.info('Deployment dashboard destroyed');
    }
}
exports.DeploymentDashboardHook = DeploymentDashboardHook;
//# sourceMappingURL=DeploymentDashboardHook.js.map