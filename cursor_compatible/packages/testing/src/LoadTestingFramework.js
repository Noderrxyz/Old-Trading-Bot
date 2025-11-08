"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoadTestingFramework = void 0;
const events_1 = require("events");
const perf_hooks_1 = require("perf_hooks");
class LoadTestingFramework extends events_1.EventEmitter {
    logger;
    config;
    virtualUsers = [];
    metrics;
    isRunning = false;
    startTime;
    stopRequested = false;
    constructor(logger) {
        super();
        this.logger = logger;
        this.metrics = new MetricsCollector();
    }
    async runTest(config, target) {
        this.config = config;
        this.startTime = new Date();
        this.isRunning = true;
        this.stopRequested = false;
        this.logger.info('Starting load test', {
            name: config.name,
            duration: config.duration,
            targetRPS: config.targetRPS
        });
        try {
            // Initialize metrics collection
            this.metrics.reset();
            this.startResourceMonitoring();
            // Ramp up virtual users
            await this.rampUp(target);
            // Run test for specified duration
            const testPromise = this.runTestDuration();
            // Wait for test completion or timeout
            await Promise.race([
                testPromise,
                new Promise(resolve => setTimeout(resolve, (config.duration + 10) * 1000))
            ]);
            // Ramp down
            await this.rampDown();
            // Collect final metrics
            const result = this.generateResult();
            this.logger.info('Load test completed', {
                name: config.name,
                passed: result.summary.passed,
                score: result.summary.score
            });
            return result;
        }
        finally {
            this.isRunning = false;
            this.stopResourceMonitoring();
        }
    }
    stop() {
        this.logger.info('Stopping load test');
        this.stopRequested = true;
    }
    async rampUp(target) {
        const rampUpSteps = 10;
        const stepDuration = (this.config.rampUpTime * 1000) / rampUpSteps;
        const usersPerStep = Math.ceil(this.config.targetRPS / rampUpSteps);
        for (let step = 0; step < rampUpSteps && !this.stopRequested; step++) {
            const usersToAdd = Math.min(usersPerStep, this.config.targetRPS - this.virtualUsers.length);
            for (let i = 0; i < usersToAdd; i++) {
                const user = new VirtualUser(`user-${this.virtualUsers.length}`, this.config, target, this.metrics);
                this.virtualUsers.push(user);
                user.start();
            }
            this.logger.debug(`Ramp up step ${step + 1}/${rampUpSteps}`, {
                activeUsers: this.virtualUsers.length
            });
            await new Promise(resolve => setTimeout(resolve, stepDuration));
        }
    }
    async runTestDuration() {
        const endTime = Date.now() + (this.config.duration * 1000);
        while (Date.now() < endTime && !this.stopRequested) {
            // Emit progress
            const elapsed = (Date.now() - this.startTime.getTime()) / 1000;
            const progress = (elapsed / this.config.duration) * 100;
            this.emit('progress', {
                elapsed,
                progress,
                activeUsers: this.virtualUsers.filter(u => u.isActive()).length,
                currentRPS: this.metrics.getCurrentRPS(),
                errors: this.metrics.getErrorCount()
            });
            // Check thresholds
            this.checkThresholds();
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    async rampDown() {
        this.logger.info('Ramping down virtual users');
        // Stop all virtual users
        for (const user of this.virtualUsers) {
            user.stop();
        }
        // Wait for users to complete current operations
        const timeout = Date.now() + 10000; // 10 second timeout
        while (this.virtualUsers.some(u => u.isActive()) && Date.now() < timeout) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    startResourceMonitoring() {
        // In production, use actual system metrics
        // For demo, simulate resource usage
        const monitoringInterval = setInterval(() => {
            if (!this.isRunning) {
                clearInterval(monitoringInterval);
                return;
            }
            const cpuUsage = 20 + Math.random() * 60; // 20-80%
            const memoryUsage = 30 + Math.random() * 50; // 30-80%
            this.metrics.recordResourceUsage({
                cpu: cpuUsage,
                memory: memoryUsage,
                timestamp: Date.now()
            });
        }, 1000);
    }
    stopResourceMonitoring() {
        // Cleanup handled by interval
    }
    checkThresholds() {
        const currentMetrics = this.metrics.getCurrentMetrics();
        const violations = [];
        // Check latency thresholds
        if (currentMetrics.latencyP95 > this.config.thresholds.maxLatencyP95) {
            violations.push({
                metric: 'latencyP95',
                threshold: this.config.thresholds.maxLatencyP95,
                actual: currentMetrics.latencyP95,
                timestamp: new Date(),
                severity: 'warning'
            });
        }
        if (currentMetrics.latencyP99 > this.config.thresholds.maxLatencyP99) {
            violations.push({
                metric: 'latencyP99',
                threshold: this.config.thresholds.maxLatencyP99,
                actual: currentMetrics.latencyP99,
                timestamp: new Date(),
                severity: 'critical'
            });
        }
        // Check error rate
        if (currentMetrics.errorRate > this.config.thresholds.maxErrorRate) {
            violations.push({
                metric: 'errorRate',
                threshold: this.config.thresholds.maxErrorRate,
                actual: currentMetrics.errorRate,
                timestamp: new Date(),
                severity: 'critical'
            });
        }
        // Emit violations
        for (const violation of violations) {
            this.logger.warn('Threshold violation', violation);
            this.emit('threshold-violation', violation);
            this.metrics.recordViolation(violation);
        }
    }
    generateResult() {
        const endTime = new Date();
        const duration = (endTime.getTime() - this.startTime.getTime()) / 1000;
        const metrics = this.metrics.getAggregatedMetrics();
        const violations = this.metrics.getViolations();
        const summary = this.generateSummary(metrics, violations);
        return {
            config: this.config,
            startTime: this.startTime,
            endTime,
            duration,
            totalRequests: metrics.throughput.totalRequests,
            successfulRequests: metrics.throughput.totalRequests - metrics.errors.totalErrors,
            failedRequests: metrics.errors.totalErrors,
            metrics,
            violations,
            summary
        };
    }
    generateSummary(metrics, violations) {
        const score = this.calculateScore(metrics, violations);
        const passed = violations.filter(v => v.severity === 'critical').length === 0 && score >= 70;
        const recommendations = [];
        const bottlenecks = [];
        // Analyze results and generate recommendations
        if (metrics.latency.p95 > this.config.thresholds.maxLatencyP95 * 0.8) {
            recommendations.push('Consider optimizing request processing to reduce latency');
            bottlenecks.push('High latency detected in 95th percentile');
        }
        if (metrics.errors.errorRate > 0.01) {
            recommendations.push('Investigate and fix errors to improve reliability');
            bottlenecks.push(`Error rate of ${(metrics.errors.errorRate * 100).toFixed(2)}% is concerning`);
        }
        if (metrics.resources.peakCpuUsage > 80) {
            recommendations.push('CPU usage is high, consider scaling horizontally');
            bottlenecks.push('CPU appears to be a bottleneck');
        }
        if (metrics.throughput.avgRPS < this.config.targetRPS * 0.9) {
            recommendations.push('System unable to achieve target throughput');
            bottlenecks.push('Throughput below target');
        }
        return {
            passed,
            score,
            recommendations,
            bottlenecks
        };
    }
    calculateScore(metrics, violations) {
        let score = 100;
        // Deduct points for violations
        score -= violations.filter(v => v.severity === 'critical').length * 20;
        score -= violations.filter(v => v.severity === 'warning').length * 10;
        // Deduct points for poor performance
        if (metrics.errors.errorRate > 0.01) {
            score -= Math.min(20, metrics.errors.errorRate * 1000);
        }
        if (metrics.latency.p95 > this.config.thresholds.maxLatencyP95) {
            const excess = (metrics.latency.p95 - this.config.thresholds.maxLatencyP95) / this.config.thresholds.maxLatencyP95;
            score -= Math.min(15, excess * 50);
        }
        if (metrics.throughput.avgRPS < this.config.targetRPS * 0.9) {
            const deficit = 1 - (metrics.throughput.avgRPS / this.config.targetRPS);
            score -= Math.min(15, deficit * 50);
        }
        return Math.max(0, Math.round(score));
    }
}
exports.LoadTestingFramework = LoadTestingFramework;
class VirtualUser {
    id;
    config;
    target;
    metrics;
    active = false;
    currentScenario = null;
    constructor(id, config, target, metrics) {
        this.id = id;
        this.config = config;
        this.target = target;
        this.metrics = metrics;
    }
    start() {
        this.active = true;
        this.runScenarios().catch(err => {
            console.error(`Virtual user ${this.id} error:`, err);
        });
    }
    stop() {
        this.active = false;
    }
    isActive() {
        return this.active;
    }
    async runScenarios() {
        while (this.active) {
            // Select scenario based on weights
            const scenario = this.selectScenario();
            this.currentScenario = scenario;
            // Execute scenario steps
            for (const step of scenario.steps) {
                if (!this.active)
                    break;
                await this.executeStep(step, scenario.name);
                // Think time between steps
                if (scenario.thinkTime > 0) {
                    await new Promise(resolve => setTimeout(resolve, scenario.thinkTime));
                }
            }
        }
    }
    selectScenario() {
        const random = Math.random() * 100;
        let cumulative = 0;
        for (const scenario of this.config.scenarios) {
            cumulative += scenario.weight;
            if (random <= cumulative) {
                return scenario;
            }
        }
        return this.config.scenarios[0];
    }
    async executeStep(step, scenarioName) {
        const startTime = perf_hooks_1.performance.now();
        let success = false;
        let error = null;
        try {
            // Execute action based on step type
            let response;
            switch (step.action) {
                case 'placeOrder':
                    response = await this.target.placeOrder(this.generateOrder(step.params));
                    break;
                case 'cancelOrder':
                    response = await this.target.cancelOrder(step.params.orderId);
                    break;
                case 'getPositions':
                    response = await this.target.getPositions();
                    break;
                case 'getMarketData':
                    response = await this.target.getMarketData(step.params.symbol);
                    break;
                case 'custom':
                    response = await step.params.handler(this.target);
                    break;
            }
            // Validate response if validator provided
            if (step.validation) {
                success = step.validation(response);
            }
            else {
                success = true;
            }
        }
        catch (err) {
            error = err;
            success = false;
        }
        const latency = perf_hooks_1.performance.now() - startTime;
        // Record metrics
        this.metrics.recordRequest({
            scenario: scenarioName,
            action: step.action,
            success,
            latency,
            error: error?.message,
            timestamp: Date.now()
        });
    }
    generateOrder(params) {
        return this.config.dataGenerator.generateOrder();
    }
}
class MetricsCollector {
    requests = [];
    resourceUsage = [];
    violations = [];
    windowSize = 60000; // 1 minute window
    reset() {
        this.requests = [];
        this.resourceUsage = [];
        this.violations = [];
    }
    recordRequest(request) {
        this.requests.push(request);
        // Clean old data
        const cutoff = Date.now() - this.windowSize;
        this.requests = this.requests.filter(r => r.timestamp > cutoff);
    }
    recordResourceUsage(usage) {
        this.resourceUsage.push(usage);
        // Clean old data
        const cutoff = Date.now() - this.windowSize;
        this.resourceUsage = this.resourceUsage.filter(u => u.timestamp > cutoff);
    }
    recordViolation(violation) {
        this.violations.push(violation);
    }
    getCurrentRPS() {
        const now = Date.now();
        const oneSecondAgo = now - 1000;
        const recentRequests = this.requests.filter(r => r.timestamp > oneSecondAgo);
        return recentRequests.length;
    }
    getErrorCount() {
        return this.requests.filter(r => !r.success).length;
    }
    getCurrentMetrics() {
        const latencies = this.requests.map(r => r.latency).sort((a, b) => a - b);
        const errors = this.requests.filter(r => !r.success);
        return {
            latencyP95: this.percentile(latencies, 0.95),
            latencyP99: this.percentile(latencies, 0.99),
            errorRate: errors.length / Math.max(1, this.requests.length),
            currentRPS: this.getCurrentRPS()
        };
    }
    getAggregatedMetrics() {
        const latencies = this.requests.map(r => r.latency).sort((a, b) => a - b);
        const successfulRequests = this.requests.filter(r => r.success);
        const failedRequests = this.requests.filter(r => !r.success);
        // Throughput metrics
        const throughput = {
            avgRPS: this.requests.length / (this.windowSize / 1000),
            peakRPS: this.calculatePeakRPS(),
            totalRequests: this.requests.length,
            requestsPerScenario: this.groupByScenario()
        };
        // Latency metrics
        const latency = {
            min: Math.min(...latencies),
            max: Math.max(...latencies),
            mean: latencies.reduce((a, b) => a + b, 0) / latencies.length,
            median: this.percentile(latencies, 0.5),
            p90: this.percentile(latencies, 0.9),
            p95: this.percentile(latencies, 0.95),
            p99: this.percentile(latencies, 0.99),
            histogram: this.createHistogram(latencies)
        };
        // Error metrics
        const errors = {
            totalErrors: failedRequests.length,
            errorRate: failedRequests.length / Math.max(1, this.requests.length),
            errorsByType: this.groupErrorsByType(failedRequests),
            errorsByScenario: this.groupErrorsByScenario(failedRequests)
        };
        // Resource metrics
        const resources = {
            avgCpuUsage: this.calculateAvgResource('cpu'),
            peakCpuUsage: this.calculatePeakResource('cpu'),
            avgMemoryUsage: this.calculateAvgResource('memory'),
            peakMemoryUsage: this.calculatePeakResource('memory'),
            networkIO: {
                bytesIn: 0, // Would be calculated from actual network metrics
                bytesOut: 0
            }
        };
        return {
            throughput,
            latency,
            errors,
            resources,
            custom: new Map()
        };
    }
    getViolations() {
        return this.violations;
    }
    percentile(sorted, p) {
        if (sorted.length === 0)
            return 0;
        const index = Math.ceil(sorted.length * p) - 1;
        return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
    }
    calculatePeakRPS() {
        let peakRPS = 0;
        const buckets = new Map();
        // Group requests by second
        for (const request of this.requests) {
            const second = Math.floor(request.timestamp / 1000);
            buckets.set(second, (buckets.get(second) || 0) + 1);
        }
        // Find peak
        for (const count of buckets.values()) {
            peakRPS = Math.max(peakRPS, count);
        }
        return peakRPS;
    }
    groupByScenario() {
        const groups = new Map();
        for (const request of this.requests) {
            groups.set(request.scenario, (groups.get(request.scenario) || 0) + 1);
        }
        return groups;
    }
    groupErrorsByType(errors) {
        const groups = new Map();
        for (const error of errors) {
            const type = error.error || 'unknown';
            groups.set(type, (groups.get(type) || 0) + 1);
        }
        return groups;
    }
    groupErrorsByScenario(errors) {
        const groups = new Map();
        for (const error of errors) {
            groups.set(error.scenario, (groups.get(error.scenario) || 0) + 1);
        }
        return groups;
    }
    createHistogram(latencies) {
        const buckets = 20;
        const histogram = new Array(buckets).fill(0);
        if (latencies.length === 0)
            return histogram;
        const min = Math.min(...latencies);
        const max = Math.max(...latencies);
        const bucketSize = (max - min) / buckets;
        for (const latency of latencies) {
            const bucket = Math.min(Math.floor((latency - min) / bucketSize), buckets - 1);
            histogram[bucket]++;
        }
        return histogram;
    }
    calculateAvgResource(type) {
        const values = this.resourceUsage.map(u => u[type]);
        return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    }
    calculatePeakResource(type) {
        const values = this.resourceUsage.map(u => u[type]);
        return values.length > 0 ? Math.max(...values) : 0;
    }
}
//# sourceMappingURL=LoadTestingFramework.js.map