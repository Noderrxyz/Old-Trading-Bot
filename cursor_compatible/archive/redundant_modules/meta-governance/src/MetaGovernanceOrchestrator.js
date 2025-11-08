"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetaGovernanceOrchestrator = void 0;
const events_1 = require("events");
const logger_1 = require("../../shared/utils/logger");
class MetaGovernanceOrchestrator extends events_1.EventEmitter {
    logger;
    strategyPerformance;
    governanceDecisions;
    riskPolicies;
    systemOrchestrator;
    metricsCollector;
    aiService;
    alphaService;
    constructor(systemOrchestrator, metricsCollector, aiService, alphaService) {
        super();
        this.logger = (0, logger_1.createLogger)('MetaGovernance');
        this.strategyPerformance = new Map();
        this.governanceDecisions = [];
        this.systemOrchestrator = systemOrchestrator;
        this.metricsCollector = metricsCollector;
        this.aiService = aiService;
        this.alphaService = alphaService;
        this.riskPolicies = {
            maxDrawdown: 0.20,
            maxLeverage: 3.0,
            maxConcentration: 0.30,
            minSharpe: 1.0,
            maxVaR: 0.05,
            correlationLimit: 0.7
        };
        this.initialize();
    }
    async initialize() {
        this.logger.info('Initializing Meta-Governance Orchestrator');
        // Subscribe to performance updates
        this.metricsCollector.on('strategy-performance', this.updateStrategyPerformance.bind(this));
        // Start governance cycles
        setInterval(() => this.runGovernanceCycle(), 60000); // Every minute
        setInterval(() => this.evaluateRiskPolicies(), 300000); // Every 5 minutes
        this.emit('initialized');
    }
    async updateStrategyPerformance(data) {
        const { strategyId, metrics, environment } = data;
        const performance = this.strategyPerformance.get(strategyId) || {
            strategyId,
            sharpeRatio: 0,
            maxDrawdown: 0,
            winRate: 0,
            profitFactor: 0,
            lastUpdated: new Date()
        };
        // Update performance based on environment
        switch (environment) {
            case 'live':
                performance.livePerformance = metrics;
                break;
            case 'paper':
                performance.paperPerformance = metrics;
                break;
            case 'backtest':
                performance.backtestPerformance = metrics;
                break;
        }
        // Calculate aggregate metrics
        performance.sharpeRatio = this.calculateSharpeRatio(metrics);
        performance.maxDrawdown = this.calculateMaxDrawdown(metrics);
        performance.winRate = metrics.successRate;
        performance.profitFactor = metrics.avgWin / Math.abs(metrics.avgLoss);
        performance.lastUpdated = new Date();
        this.strategyPerformance.set(strategyId, performance);
        // Check if immediate action needed
        if (performance.maxDrawdown > this.riskPolicies.maxDrawdown) {
            await this.createGovernanceDecision({
                type: 'DISABLE',
                targetStrategy: strategyId,
                reason: `Max drawdown exceeded: ${performance.maxDrawdown.toFixed(2)}`,
                confidence: 0.95,
                impact: 'HIGH'
            });
        }
    }
    async runGovernanceCycle() {
        this.logger.info('Running governance cycle');
        try {
            // Rank all strategies by performance
            const rankings = await this.rankStrategies();
            // Identify underperformers
            const underperformers = rankings.filter(r => r.performance.sharpeRatio < this.riskPolicies.minSharpe ||
                r.performance.maxDrawdown > this.riskPolicies.maxDrawdown);
            // Create governance decisions
            for (const strategy of underperformers) {
                await this.createGovernanceDecision({
                    type: 'DISABLE',
                    targetStrategy: strategy.strategyId,
                    reason: `Underperformance: Sharpe ${strategy.performance.sharpeRatio.toFixed(2)}`,
                    confidence: this.calculateDecisionConfidence(strategy.performance),
                    impact: 'MEDIUM'
                });
            }
            // Identify top performers for weight increase
            const topPerformers = rankings.slice(0, 3);
            for (const strategy of topPerformers) {
                if (strategy.performance.sharpeRatio > 2.0) {
                    await this.createGovernanceDecision({
                        type: 'ADJUST_WEIGHT',
                        targetStrategy: strategy.strategyId,
                        reason: `Strong performance: Sharpe ${strategy.performance.sharpeRatio.toFixed(2)}`,
                        confidence: this.calculateDecisionConfidence(strategy.performance),
                        impact: 'MEDIUM'
                    });
                }
            }
            // Execute approved decisions
            await this.executeGovernanceDecisions();
            this.emit('governance-cycle-complete', {
                strategiesEvaluated: rankings.length,
                decisionsCreated: this.governanceDecisions.filter(d => !d.executedAt).length
            });
        }
        catch (error) {
            this.logger.error('Governance cycle error:', error);
            this.emit('governance-error', error);
        }
    }
    async rankStrategies() {
        const strategies = Array.from(this.strategyPerformance.entries())
            .map(([id, perf]) => ({ strategyId: id, performance: perf }))
            .sort((a, b) => {
            // Multi-factor ranking
            const scoreA = this.calculateStrategyScore(a.performance);
            const scoreB = this.calculateStrategyScore(b.performance);
            return scoreB - scoreA;
        });
        return strategies;
    }
    calculateStrategyScore(performance) {
        // Weighted scoring system
        const weights = {
            sharpe: 0.30,
            drawdown: 0.25,
            winRate: 0.20,
            profitFactor: 0.15,
            consistency: 0.10
        };
        const sharpeScore = Math.min(performance.sharpeRatio / 3, 1) * weights.sharpe;
        const drawdownScore = Math.max(1 - performance.maxDrawdown, 0) * weights.drawdown;
        const winRateScore = performance.winRate * weights.winRate;
        const profitScore = Math.min(performance.profitFactor / 3, 1) * weights.profitFactor;
        // Consistency score based on performance across environments
        const consistency = this.calculateConsistencyScore(performance) * weights.consistency;
        return sharpeScore + drawdownScore + winRateScore + profitScore + consistency;
    }
    calculateConsistencyScore(performance) {
        const scores = [];
        if (performance.livePerformance)
            scores.push(performance.livePerformance.returns);
        if (performance.paperPerformance)
            scores.push(performance.paperPerformance.returns);
        if (performance.backtestPerformance)
            scores.push(performance.backtestPerformance.returns);
        if (scores.length < 2)
            return 0.5;
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        const variance = scores.reduce((sum, score) => sum + Math.pow(score - avg, 2), 0) / scores.length;
        const stdDev = Math.sqrt(variance);
        // Lower std dev = higher consistency
        return Math.max(1 - stdDev / avg, 0);
    }
    calculateDecisionConfidence(performance) {
        // Confidence based on data quality and consistency
        let confidence = 0.5;
        if (performance.livePerformance)
            confidence += 0.3;
        if (performance.paperPerformance)
            confidence += 0.15;
        if (performance.backtestPerformance)
            confidence += 0.05;
        // Adjust for consistency
        confidence *= this.calculateConsistencyScore(performance);
        return Math.min(confidence, 0.99);
    }
    calculateSharpeRatio(metrics) {
        if (metrics.volatility === 0)
            return 0;
        const riskFreeRate = 0.02; // 2% annual
        return (metrics.returns - riskFreeRate) / metrics.volatility;
    }
    calculateMaxDrawdown(metrics) {
        // Simplified calculation - in production would use equity curve
        return Math.abs(metrics.avgLoss * 5); // Assume 5 consecutive losses
    }
    async createGovernanceDecision(params) {
        const decision = {
            id: `gov_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date(),
            approved: params.confidence > 0.8, // Auto-approve high confidence decisions
            ...params
        };
        this.governanceDecisions.push(decision);
        this.logger.info('Governance decision created:', {
            id: decision.id,
            type: decision.type,
            target: decision.targetStrategy,
            approved: decision.approved
        });
        this.emit('governance-decision', decision);
        // Send to dashboard for human review if not auto-approved
        if (!decision.approved) {
            await this.notifyDashboard(decision);
        }
    }
    async executeGovernanceDecisions() {
        const pendingDecisions = this.governanceDecisions.filter(d => d.approved && !d.executedAt);
        for (const decision of pendingDecisions) {
            try {
                switch (decision.type) {
                    case 'DISABLE':
                        await this.disableStrategy(decision.targetStrategy);
                        break;
                    case 'ENABLE':
                        await this.enableStrategy(decision.targetStrategy);
                        break;
                    case 'ADJUST_WEIGHT':
                        await this.adjustStrategyWeight(decision.targetStrategy);
                        break;
                    case 'UPDATE_PARAMS':
                        await this.updateStrategyParams(decision.targetStrategy);
                        break;
                }
                decision.executedAt = new Date();
                this.logger.info('Governance decision executed:', {
                    id: decision.id,
                    type: decision.type
                });
                // Log to audit trail
                await this.logToAuditTrail(decision);
            }
            catch (error) {
                this.logger.error('Failed to execute governance decision:', error);
                this.emit('governance-execution-error', { decision, error });
            }
        }
    }
    async disableStrategy(strategyId) {
        await this.systemOrchestrator.disableModule(strategyId);
        await this.metricsCollector.trackEvent('strategy_disabled', { strategyId });
    }
    async enableStrategy(strategyId) {
        await this.systemOrchestrator.enableModule(strategyId);
        await this.metricsCollector.trackEvent('strategy_enabled', { strategyId });
    }
    async adjustStrategyWeight(strategyId) {
        const performance = this.strategyPerformance.get(strategyId);
        if (!performance)
            return;
        // Calculate new weight based on performance
        const newWeight = Math.min(0.3, performance.sharpeRatio / 10);
        await this.alphaService.updateStrategyWeight(strategyId, newWeight);
        await this.metricsCollector.trackEvent('strategy_weight_adjusted', {
            strategyId,
            newWeight
        });
    }
    async updateStrategyParams(strategyId) {
        // Use AI to suggest parameter updates
        const suggestions = await this.aiService.suggestParameterUpdates(strategyId);
        if (suggestions && suggestions.confidence > 0.8) {
            await this.alphaService.updateStrategyParameters(strategyId, suggestions.parameters);
            await this.metricsCollector.trackEvent('strategy_params_updated', {
                strategyId,
                parameters: suggestions.parameters
            });
        }
    }
    async evaluateRiskPolicies() {
        this.logger.info('Evaluating risk policies');
        // Get portfolio-wide metrics
        const portfolioMetrics = await this.systemOrchestrator.getPortfolioMetrics();
        // Check against policies
        const violations = [];
        if (portfolioMetrics.leverage > this.riskPolicies.maxLeverage) {
            violations.push({
                policy: 'maxLeverage',
                current: portfolioMetrics.leverage,
                limit: this.riskPolicies.maxLeverage
            });
        }
        if (portfolioMetrics.var > this.riskPolicies.maxVaR) {
            violations.push({
                policy: 'maxVaR',
                current: portfolioMetrics.var,
                limit: this.riskPolicies.maxVaR
            });
        }
        if (violations.length > 0) {
            this.emit('risk-policy-violation', violations);
            await this.handleRiskViolations(violations);
        }
    }
    async handleRiskViolations(violations) {
        for (const violation of violations) {
            await this.createGovernanceDecision({
                type: 'UPDATE_PARAMS',
                targetStrategy: 'PORTFOLIO',
                reason: `Risk policy violation: ${violation.policy}`,
                confidence: 0.95,
                impact: 'HIGH'
            });
        }
    }
    async notifyDashboard(decision) {
        await this.metricsCollector.trackEvent('governance_decision_pending', {
            id: decision.id,
            type: decision.type,
            target: decision.targetStrategy,
            reason: decision.reason,
            impact: decision.impact
        });
    }
    async logToAuditTrail(decision) {
        const auditEntry = {
            timestamp: new Date(),
            action: 'GOVERNANCE_DECISION_EXECUTED',
            decision: decision,
            executor: 'MetaGovernanceOrchestrator',
            result: 'SUCCESS'
        };
        await this.metricsCollector.trackEvent('governance_audit', auditEntry);
    }
    async getGovernanceStatus() {
        return {
            activeStrategies: Array.from(this.strategyPerformance.keys()),
            pendingDecisions: this.governanceDecisions.filter(d => !d.executedAt).length,
            executedDecisions: this.governanceDecisions.filter(d => d.executedAt).length,
            riskPolicies: this.riskPolicies,
            lastCycleRun: new Date()
        };
    }
    async approveDecision(decisionId) {
        const decision = this.governanceDecisions.find(d => d.id === decisionId);
        if (decision && !decision.approved) {
            decision.approved = true;
            await this.executeGovernanceDecisions();
        }
    }
    async updateRiskPolicy(policy) {
        this.riskPolicies = { ...this.riskPolicies, ...policy };
        this.emit('risk-policy-updated', this.riskPolicies);
        await this.evaluateRiskPolicies();
    }
}
exports.MetaGovernanceOrchestrator = MetaGovernanceOrchestrator;
//# sourceMappingURL=MetaGovernanceOrchestrator.js.map