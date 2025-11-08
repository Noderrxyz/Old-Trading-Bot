"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationTestSuite = void 0;
const events_1 = require("events");
const PositionReconciliation_1 = require("../../execution-engine/src/PositionReconciliation");
const OrderLifecycleManager_1 = require("../../execution-engine/src/OrderLifecycleManager");
const DynamicRiskLimits_1 = require("../../risk-engine/src/DynamicRiskLimits");
const ComplianceEngine_1 = require("../../compliance/src/ComplianceEngine");
const MultiAssetManager_1 = require("../../multi-asset/src/MultiAssetManager");
const LoadTestingFramework_1 = require("./LoadTestingFramework");
class IntegrationTestSuite extends events_1.EventEmitter {
    logger;
    config;
    testCases = [];
    systems = new Map();
    results = [];
    constructor(logger, config) {
        super();
        this.logger = logger;
        this.config = config;
    }
    async initialize() {
        this.logger.info('Initializing integration test suite', {
            name: this.config.name,
            environment: this.config.environment
        });
        // Initialize all systems
        await this.initializeSystems();
        // Register test cases
        this.registerTestCases();
        this.logger.info('Test suite initialized', {
            systems: Array.from(this.systems.keys()),
            testCases: this.testCases.length
        });
    }
    async initializeSystems() {
        // Position Reconciliation
        const positionReconciliation = new PositionReconciliation_1.PositionReconciliation(this.logger);
        this.systems.set('positionReconciliation', positionReconciliation);
        // Order Lifecycle Manager
        const orderManager = new OrderLifecycleManager_1.OrderLifecycleManager(this.logger);
        this.systems.set('orderManager', orderManager);
        // Risk Limits
        const riskLimits = new DynamicRiskLimits_1.DynamicRiskLimits(this.logger, {
            basePositionLimit: 100000,
            baseExposureLimit: 1000000,
            baseLeverageLimit: 10,
            baseDrawdownLimit: 0.2,
            volatilityWindow: 20,
            adjustmentFactor: 0.5,
            updateInterval: 5000
        });
        this.systems.set('riskLimits', riskLimits);
        // Compliance Engine
        const compliance = new ComplianceEngine_1.ComplianceEngine(this.logger, {
            jurisdiction: 'US',
            regulations: [],
            kycRequired: true,
            amlEnabled: true,
            transactionLimits: {
                dailyLimit: 1000000,
                singleTransactionLimit: 100000,
                monthlyLimit: 10000000,
                requiresApprovalAbove: 50000
            },
            reportingThresholds: {
                largeTransaction: 10000,
                suspiciousPattern: 5000,
                aggregateDaily: 100000
            },
            dataRetentionDays: 2555
        });
        this.systems.set('compliance', compliance);
        // Multi-Asset Manager
        const multiAsset = new MultiAssetManager_1.MultiAssetManager(this.logger);
        await multiAsset.initialize();
        this.systems.set('multiAsset', multiAsset);
        // Start systems
        positionReconciliation.start();
        riskLimits.start();
        compliance.start();
    }
    registerTestCases() {
        // Critical Path Tests
        this.addTestCase({
            id: 'CP001',
            name: 'End-to-End Order Flow',
            category: 'critical-path',
            priority: 'critical',
            execute: async () => {
                const orderManager = this.systems.get('orderManager');
                const compliance = this.systems.get('compliance');
                const riskLimits = this.systems.get('riskLimits');
                // Pre-trade compliance check
                const complianceCheck = await compliance.checkPreTrade({
                    id: 'TEST001',
                    userId: 'user123',
                    symbol: 'BTCUSD',
                    side: 'BUY',
                    quantity: 1,
                    price: 50000,
                    orderType: 'LIMIT'
                });
                if (complianceCheck.result === 'fail') {
                    throw new Error('Compliance check failed');
                }
                // Risk check
                const canTrade = riskLimits.canTakePosition('BTCUSD', 1, new Map());
                if (!canTrade) {
                    throw new Error('Risk check failed');
                }
                // Submit order
                const order = await orderManager.submitOrder({
                    symbol: 'BTCUSD',
                    side: 'BUY',
                    quantity: 1,
                    price: 50000
                });
                // Simulate fill
                orderManager.processFill({
                    orderId: order.id,
                    fillId: 'FILL001',
                    quantity: 1,
                    price: 50000,
                    fee: 50,
                    feeCurrency: 'USD',
                    timestamp: new Date(),
                    venue: 'primary'
                });
            },
            validate: async () => {
                const orderManager = this.systems.get('orderManager');
                const orders = orderManager.getActiveOrders();
                return orders.length === 0; // All orders should be filled
            }
        });
        // Position Reconciliation Tests
        this.addTestCase({
            id: 'PR001',
            name: 'Position Drift Detection',
            category: 'reconciliation',
            priority: 'high',
            execute: async () => {
                const reconciliation = this.systems.get('positionReconciliation');
                // Update internal position
                reconciliation.updateInternalPosition('BTCUSD', {
                    symbol: 'BTCUSD',
                    quantity: 10,
                    avgPrice: 50000,
                    unrealizedPnl: 1000,
                    realizedPnl: 500,
                    lastUpdate: new Date()
                });
                // Force reconciliation
                await reconciliation.reconcile();
            },
            validate: async () => {
                const reconciliation = this.systems.get('positionReconciliation');
                return !reconciliation.isPausedForReconciliation();
            }
        });
        // Risk Management Tests
        this.addTestCase({
            id: 'RM001',
            name: 'Dynamic Risk Limit Adjustment',
            category: 'risk-management',
            priority: 'critical',
            execute: async () => {
                const riskLimits = this.systems.get('riskLimits');
                // Simulate high volatility
                riskLimits.updateMarketConditions({
                    volatility: 0.05, // 5% daily vol
                    regime: 'stressed'
                });
                // Wait for limits to adjust
                await new Promise(resolve => setTimeout(resolve, 1000));
            },
            validate: async () => {
                const riskLimits = this.systems.get('riskLimits');
                const limits = riskLimits.getCurrentLimits();
                // Limits should be reduced in stressed conditions
                return limits.positionLimit < 100000;
            }
        });
        // Multi-Asset Tests
        this.addTestCase({
            id: 'MA001',
            name: 'Cross-Asset Order Routing',
            category: 'multi-asset',
            priority: 'high',
            execute: async () => {
                const multiAsset = this.systems.get('multiAsset');
                // Subscribe to multiple assets
                await multiAsset.subscribe(['BTCUSD', 'AAPL', 'EURUSD']);
                // Place orders across asset classes
                const orders = await Promise.all([
                    multiAsset.placeOrder({
                        symbol: 'BTCUSD',
                        side: 'BUY',
                        quantity: 0.1,
                        orderType: 'MARKET',
                        timeInForce: 'IOC'
                    }),
                    multiAsset.placeOrder({
                        symbol: 'AAPL',
                        side: 'BUY',
                        quantity: 10,
                        orderType: 'LIMIT',
                        price: 150,
                        timeInForce: 'GTC'
                    })
                ]);
                this.logger.info('Cross-asset orders placed', { orders });
            },
            validate: async () => {
                const multiAsset = this.systems.get('multiAsset');
                const positions = await multiAsset.getUnifiedPositions();
                return positions.size >= 2;
            }
        });
        // Compliance Tests
        this.addTestCase({
            id: 'CM001',
            name: 'Transaction Limit Enforcement',
            category: 'compliance',
            priority: 'critical',
            execute: async () => {
                const compliance = this.systems.get('compliance');
                // Try to exceed single transaction limit
                const check = await compliance.checkPreTrade({
                    id: 'TEST002',
                    userId: 'user123',
                    symbol: 'BTCUSD',
                    side: 'BUY',
                    quantity: 10,
                    price: 20000, // Total: 200,000 > limit
                    orderType: 'LIMIT'
                });
                if (check.result !== 'fail' && check.result !== 'warning') {
                    throw new Error('Expected compliance violation');
                }
            },
            validate: async () => true
        });
        // Load Testing
        this.addTestCase({
            id: 'LT001',
            name: 'System Load Test',
            category: 'performance',
            priority: 'medium',
            timeout: 120000, // 2 minutes
            execute: async () => {
                const loadTester = new LoadTestingFramework_1.LoadTestingFramework(this.logger);
                const orderManager = this.systems.get('orderManager');
                const result = await loadTester.runTest({
                    name: 'Order Processing Load Test',
                    duration: 30,
                    rampUpTime: 5,
                    targetRPS: 100,
                    scenarios: [{
                            name: 'Place Orders',
                            weight: 100,
                            steps: [{
                                    action: 'placeOrder',
                                    params: {}
                                }],
                            thinkTime: 10
                        }],
                    thresholds: {
                        maxLatencyP95: 100,
                        maxLatencyP99: 200,
                        minThroughput: 80,
                        maxErrorRate: 0.01,
                        maxCpuUsage: 80,
                        maxMemoryUsage: 80
                    },
                    dataGenerator: {
                        generateOrder: () => ({
                            symbol: 'BTCUSD',
                            side: Math.random() > 0.5 ? 'BUY' : 'SELL',
                            quantity: Math.random() * 10,
                            price: 50000 + Math.random() * 1000
                        }),
                        generateSymbol: () => 'BTCUSD',
                        generatePrice: () => 50000 + Math.random() * 1000,
                        generateQuantity: () => Math.random() * 10
                    }
                }, orderManager);
                if (!result.summary.passed) {
                    throw new Error(`Load test failed with score ${result.summary.score}`);
                }
            },
            validate: async () => true
        });
        // Failure Recovery Tests
        this.addTestCase({
            id: 'FR001',
            name: 'Order Recovery After Failure',
            category: 'resilience',
            priority: 'high',
            execute: async () => {
                const orderManager = this.systems.get('orderManager');
                // Submit order
                const order = await orderManager.submitOrder({
                    symbol: 'BTCUSD',
                    side: 'BUY',
                    quantity: 1,
                    price: 50000
                });
                // Wait for stuck order detection
                await new Promise(resolve => setTimeout(resolve, 65000));
            },
            validate: async () => {
                const orderManager = this.systems.get('orderManager');
                const stuckOrders = orderManager.getOrdersByStatus('STUCK');
                // System should detect and handle stuck orders
                return stuckOrders.length === 0;
            },
            timeout: 70000
        });
    }
    addTestCase(testCase) {
        this.testCases.push(testCase);
    }
    async runTests(filter) {
        const startTime = new Date();
        this.results = [];
        // Filter test cases
        let testsToRun = this.testCases;
        if (filter) {
            testsToRun = this.testCases.filter(tc => {
                if (filter.ids && !filter.ids.includes(tc.id))
                    return false;
                if (filter.categories && !filter.categories.includes(tc.category))
                    return false;
                if (filter.priorities && !filter.priorities.includes(tc.priority))
                    return false;
                return true;
            });
        }
        this.logger.info('Starting test run', {
            totalTests: testsToRun.length,
            filter
        });
        // Run tests
        if (this.config.parallel) {
            await this.runTestsParallel(testsToRun);
        }
        else {
            await this.runTestsSequential(testsToRun);
        }
        // Generate report
        const report = this.generateReport(startTime);
        this.logger.info('Test run completed', {
            passed: report.passed,
            failed: report.failed,
            duration: report.duration
        });
        return report;
    }
    async runTestsSequential(testCases) {
        for (const testCase of testCases) {
            const result = await this.runSingleTest(testCase);
            this.results.push(result);
            this.emit('test-complete', result);
            if (result.status === 'error' && this.config.retries > 0) {
                // Retry on error
                for (let retry = 0; retry < this.config.retries; retry++) {
                    this.logger.info(`Retrying test ${testCase.id} (${retry + 1}/${this.config.retries})`);
                    const retryResult = await this.runSingleTest(testCase);
                    if (retryResult.status !== 'error') {
                        this.results[this.results.length - 1] = retryResult;
                        break;
                    }
                }
            }
        }
    }
    async runTestsParallel(testCases) {
        const promises = testCases.map(async (testCase) => {
            const result = await this.runSingleTest(testCase);
            this.emit('test-complete', result);
            return result;
        });
        const results = await Promise.all(promises);
        this.results.push(...results);
    }
    async runSingleTest(testCase) {
        const startTime = Date.now();
        const logs = [];
        // Create test logger
        const testLogger = {
            info: (msg) => logs.push(`[INFO] ${msg}`),
            warn: (msg) => logs.push(`[WARN] ${msg}`),
            error: (msg) => logs.push(`[ERROR] ${msg}`)
        };
        try {
            this.logger.info(`Running test: ${testCase.name}`);
            // Setup
            if (testCase.setup) {
                await this.withTimeout(testCase.setup(), testCase.timeout || this.config.timeout);
            }
            // Execute
            await this.withTimeout(testCase.execute(), testCase.timeout || this.config.timeout);
            // Validate
            const isValid = await this.withTimeout(testCase.validate(), 5000);
            // Teardown
            if (testCase.teardown) {
                await this.withTimeout(testCase.teardown(), 5000);
            }
            const status = isValid ? 'passed' : 'failed';
            return {
                testCase,
                status,
                duration: Date.now() - startTime,
                logs
            };
        }
        catch (error) {
            return {
                testCase,
                status: 'error',
                duration: Date.now() - startTime,
                error: error,
                logs
            };
        }
    }
    async withTimeout(promise, timeout) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Test timeout')), timeout))
        ]);
    }
    generateReport(startTime) {
        const endTime = new Date();
        const duration = endTime.getTime() - startTime.getTime();
        const passed = this.results.filter(r => r.status === 'passed').length;
        const failed = this.results.filter(r => r.status === 'failed').length;
        const skipped = this.results.filter(r => r.status === 'skipped').length;
        const errors = this.results.filter(r => r.status === 'error').length;
        const coverage = this.calculateCoverage();
        const recommendations = this.generateRecommendations();
        return {
            suite: this.config.name,
            startTime,
            endTime,
            duration,
            totalTests: this.results.length,
            passed,
            failed,
            skipped,
            errors,
            results: this.results,
            coverage,
            recommendations
        };
    }
    calculateCoverage() {
        const totalPossibleTests = this.testCases.length;
        const executedTests = this.results.length;
        const overall = (executedTests / totalPossibleTests) * 100;
        // Coverage by category
        const byCategory = new Map();
        const categories = new Set(this.testCases.map(tc => tc.category));
        for (const category of categories) {
            const categoryTests = this.testCases.filter(tc => tc.category === category);
            const executedCategoryTests = this.results.filter(r => r.testCase.category === category);
            byCategory.set(category, (executedCategoryTests.length / categoryTests.length) * 100);
        }
        // Coverage by priority
        const byPriority = new Map();
        const priorities = ['critical', 'high', 'medium', 'low'];
        for (const priority of priorities) {
            const priorityTests = this.testCases.filter(tc => tc.priority === priority);
            const executedPriorityTests = this.results.filter(r => r.testCase.priority === priority);
            byPriority.set(priority, (executedPriorityTests.length / priorityTests.length) * 100);
        }
        // Uncovered areas
        const uncoveredAreas = [];
        for (const [category, coverage] of byCategory) {
            if (coverage < 80) {
                uncoveredAreas.push(`${category} (${coverage.toFixed(1)}% coverage)`);
            }
        }
        return {
            overall,
            byCategory,
            byPriority,
            uncoveredAreas
        };
    }
    generateRecommendations() {
        const recommendations = [];
        const failureRate = this.results.filter(r => r.status === 'failed' || r.status === 'error').length / this.results.length;
        if (failureRate > 0.1) {
            recommendations.push('High failure rate detected. Review test stability and system reliability.');
        }
        const criticalFailures = this.results.filter(r => r.testCase.priority === 'critical' && r.status !== 'passed');
        if (criticalFailures.length > 0) {
            recommendations.push('Critical tests are failing. Immediate attention required.');
        }
        const performanceTests = this.results.filter(r => r.testCase.category === 'performance');
        const performanceFailures = performanceTests.filter(r => r.status !== 'passed');
        if (performanceFailures.length > 0) {
            recommendations.push('Performance tests failing. Consider system optimization.');
        }
        return recommendations;
    }
    async cleanup() {
        this.logger.info('Cleaning up test suite');
        // Stop all systems
        const positionReconciliation = this.systems.get('positionReconciliation');
        const orderManager = this.systems.get('orderManager');
        const riskLimits = this.systems.get('riskLimits');
        const compliance = this.systems.get('compliance');
        if (positionReconciliation)
            positionReconciliation.stop();
        if (orderManager)
            orderManager.stop();
        if (riskLimits)
            riskLimits.stop();
        if (compliance)
            compliance.stop();
        this.systems.clear();
    }
}
exports.IntegrationTestSuite = IntegrationTestSuite;
//# sourceMappingURL=IntegrationTestSuite.js.map