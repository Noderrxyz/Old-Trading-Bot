// Integration tests for JavaScript fallbacks
import { 
  ExecutionStrategyRouterJs,
  RiskCalculatorJs,
  DynamicTradeSizerJs,
  DrawdownMonitorJs,
  ExecutionAlgorithm
} from '../src/index.js';

import { OrderSide, OrderType } from '../src/execution/order.js';
import { PositionDirection } from '../src/risk/RiskCalculatorJs.js';
import { telemetry } from '../src/telemetry';
import { SeverityLevel } from '../src/telemetry/types';

// Mock telemetry for testing
jest.mock('../src/telemetry', () => {
  const recordedMetrics = [];
  const recordedErrors = [];
  const recordedEvents = [];
  
  return {
    recordedMetrics,
    recordedErrors,
    recordedEvents,
    telemetry: {
      recordMetric: (name, value, tags) => {
        recordedMetrics.push({ name, value, tags });
      },
      recordError: (component, message, severity, tags) => {
        recordedErrors.push({ component, message, severity, tags });
      },
      recordEvent: (name, component, tags, metadata) => {
        recordedEvents.push({ name, component, tags, metadata });
      }
    }
  };
});

// Test configs
const riskConfig = {
  maxPositionSizePct: 0.1,
  maxLeverage: 3.0,
  maxDrawdownPct: 0.2,
  minTrustScore: 0.7,
  maxExposurePerSymbol: 0.3,
  maxExposurePerVenue: 0.4,
  exemptStrategies: [],
  fastRiskMode: true,
};

const sizerConfig = {
  baseSize: 1000.0,
  maxVolatilityThreshold: 0.05,
  volatilityWindowSize: 20,
  minSizeFactor: 0.5,
  maxSizeFactor: 2.0,
  enableLogging: false,
  symbolScaleFactors: {
    'BTC-USD': 1.0,
    'ETH-USD': 0.8,
  },
};

const drawdownConfig = {
  maxDrawdownPct: 0.1,
  alertThresholdPct: 0.05,
  rollingWindowSize: 20,
  minTradesForDrawdown: 5,
  cooldownPeriodMs: 3600000,
};

const strategyConfig = {
  defaultStrategy: ExecutionAlgorithm.TWAP,
  minOrderSizeForTwap: 1000.0,
  minOrderSizeForVwap: 5000.0,
  maxExecutionTimeMs: 300000,
  symbolStrategyMap: {},
};

// Clear telemetry records before each test
beforeEach(() => {
  telemetry.recordedMetrics = [];
  telemetry.recordedErrors = [];
  telemetry.recordedEvents = [];
});

// Mock kill switch callback for DrawdownMonitor
const mockKillSwitchCallback = jest.fn().mockImplementation((agentId, reason, message) => {
  console.log(`Kill switch triggered: ${agentId}, ${reason}, ${message}`);
  return true;
});

// DynamicTradeSizer Tests
describe('DynamicTradeSizerJs', () => {
  test('should initialize with config', () => {
    const sizer = DynamicTradeSizerJs.withConfig(sizerConfig);
    expect(sizer).toBeDefined();
    
    // Check if initialization telemetry is recorded
    const initMetric = telemetry.recordedMetrics.find(m => 
      m.name === 'dynamic_trade_sizer.initialization');
    expect(initMetric).toBeDefined();
    expect(initMetric.tags.implementation).toBe('javascript');
  });
  
  test('should calculate position size based on volatility', async () => {
    const sizer = DynamicTradeSizerJs.withConfig(sizerConfig);
    
    // Update volatility first
    await sizer.updateVolatility('BTC-USD', 50000);
    await sizer.updateVolatility('BTC-USD', 51000);
    await sizer.updateVolatility('BTC-USD', 50500);
    
    const size = await sizer.calculatePositionSize('BTC-USD', 1000);
    expect(size).toBeGreaterThan(0);
    
    // Check detailed telemetry
    const baseMetric = telemetry.recordedMetrics.find(m => 
      m.name === 'dynamic_trade_sizer.base_size');
    expect(baseMetric).toBeDefined();
    expect(baseMetric.value).toBe(1000);
    
    const finalMetric = telemetry.recordedMetrics.find(m => 
      m.name === 'dynamic_trade_sizer.final_size');
    expect(finalMetric).toBeDefined();
  });
  
  test('should handle errors in calculatePositionSize', async () => {
    const sizer = DynamicTradeSizerJs.withConfig(sizerConfig);
    
    // Invalid negative base size should be handled
    const size = await sizer.calculatePositionSize('BTC-USD', -100);
    
    // Should return a safe fallback value
    expect(size).toBe(-90); // 90% of base size
    
    // Check error telemetry
    const errorRecord = telemetry.recordedErrors.find(e => 
      e.component === 'DynamicTradeSizerJs');
    expect(errorRecord).toBeDefined();
    expect(errorRecord.message).toContain('Invalid base size');
    expect(errorRecord.tags.error_type).toBe('Error');
  });
  
  test('should handle errors in updateVolatility', async () => {
    const sizer = DynamicTradeSizerJs.withConfig(sizerConfig);
    
    // Invalid negative price should be handled
    const volatility = await sizer.updateVolatility('BTC-USD', -100);
    
    // Should return a safe fallback value
    expect(volatility).toBe(0.02); // default moderate volatility
    
    // Check error telemetry
    const errorRecord = telemetry.recordedErrors.find(e => 
      e.component === 'DynamicTradeSizerJs' && e.tags.method === 'updateVolatility');
    expect(errorRecord).toBeDefined();
    expect(errorRecord.message).toContain('Invalid price');
  });
});

// DrawdownMonitor Tests
describe('DrawdownMonitorJs', () => {
  test('should initialize with config', () => {
    const monitor = new DrawdownMonitorJs(drawdownConfig, mockKillSwitchCallback);
    expect(monitor).toBeDefined();
    
    // Check if initialization telemetry is recorded
    const initMetric = telemetry.recordedMetrics.find(m => 
      m.name === 'drawdown_monitor.initialization');
    expect(initMetric).toBeDefined();
    expect(initMetric.tags.implementation).toBe('javascript');
  });
  
  test('should record trades and track drawdown', async () => {
    const monitor = new DrawdownMonitorJs(drawdownConfig, mockKillSwitchCallback);
    
    // Record a series of trades
    await monitor.recordTrade({
      agentId: 'test-agent',
      symbol: 'BTC-USD',
      amount: 1.0,
      price: 50000,
      tradeType: 'buy',
      equity: 100000,
      tradeId: 'trade-1',
      pnl: 0
    });
    
    await monitor.recordTrade({
      agentId: 'test-agent',
      symbol: 'BTC-USD',
      amount: 1.0,
      price: 49000,
      tradeType: 'sell',
      equity: 99000, // 1% drawdown
      tradeId: 'trade-2',
      pnl: -1000
    });
    
    // Check current drawdown
    const drawdown = await monitor.getCurrentDrawdown('test-agent');
    expect(drawdown).toBe(0.01); // 1% drawdown
    
    // Check drawdown telemetry
    const drawdownMetric = telemetry.recordedMetrics.find(m => 
      m.name === 'drawdown_monitor.current_drawdown');
    expect(drawdownMetric).toBeDefined();
    expect(parseFloat(drawdownMetric.value)).toBeCloseTo(0.01);
  });
  
  test('should handle errors in recordTrade', async () => {
    const monitor = new DrawdownMonitorJs(drawdownConfig, mockKillSwitchCallback);
    
    // Missing required fields
    const invalidTrade = {
      symbol: 'BTC-USD',
      price: 50000,
      tradeType: 'buy'
      // Missing agentId and equity
    };
    
    // Should throw for critical errors
    await expect(monitor.recordTrade(invalidTrade)).rejects.toThrow();
    
    // Check error telemetry
    const errorRecord = telemetry.recordedErrors.find(e => 
      e.component === 'DrawdownMonitorJs');
    expect(errorRecord).toBeDefined();
    expect(errorRecord.message).toContain('Error recording trade');
    expect(errorRecord.tags.agent_id).toBe('unknown');
  });
  
  test('should trigger kill switch on excessive drawdown', async () => {
    // Use a lower threshold for testing
    const testConfig = {
      ...drawdownConfig,
      maxDrawdownPct: 0.05, // 5%
      minTradesForDrawdown: 2
    };
    
    const monitor = new DrawdownMonitorJs(testConfig, mockKillSwitchCallback);
    mockKillSwitchCallback.mockClear(); // Clear previous calls
    
    // Record initial trade to establish peak equity
    await monitor.recordTrade({
      agentId: 'test-agent',
      symbol: 'BTC-USD',
      amount: 1.0,
      price: 50000,
      tradeType: 'buy',
      equity: 100000,
      tradeId: 'trade-1',
      pnl: 0
    });
    
    // Record trade with significant drawdown
    await monitor.recordTrade({
      agentId: 'test-agent',
      symbol: 'BTC-USD',
      amount: 1.0,
      price: 47500,
      tradeType: 'sell',
      equity: 94000, // 6% drawdown, exceeds 5% max
      tradeId: 'trade-2',
      pnl: -6000
    });
    
    // Kill switch should be triggered
    expect(mockKillSwitchCallback).toHaveBeenCalled();
    
    // Check event telemetry
    const killSwitchEvent = telemetry.recordedEvents.find(e => 
      e.name === 'kill_switch_triggered');
    expect(killSwitchEvent).toBeDefined();
    expect(killSwitchEvent.tags.agent_id).toBe('test-agent');
  });
});

// ExecutionStrategyRouter Tests
describe('ExecutionStrategyRouterJs', () => {
  test('should initialize with config', () => {
    const router = ExecutionStrategyRouterJs.getInstance(strategyConfig);
    expect(router).toBeDefined();
    
    // Check if initialization telemetry is recorded
    const initMetric = telemetry.recordedMetrics.find(m => 
      m.name === 'execution_strategy_router.initialization');
    expect(initMetric).toBeDefined();
    expect(initMetric.tags.implementation).toBe('javascript');
  });
  
  test('should execute with callback', async () => {
    const router = ExecutionStrategyRouterJs.getInstance(strategyConfig);
    
    const order = {
      id: 'test-order-1',
      symbol: 'BTC-USD',
      side: OrderSide.Buy,
      type: OrderType.Limit,
      amount: 1.0,
      price: 50000.0,
    };
    
    const resultPromise = new Promise(resolve => {
      router.execute(order, result => {
        resolve(result);
      });
    });
    
    // Wait for execution to complete (simulated)
    jest.useFakeTimers();
    jest.advanceTimersByTime(10000);
    jest.useRealTimers();
    
    const result = await resultPromise;
    expect(result).toBeDefined();
    expect(result.request_id).toBe(order.id);
    expect(result.status).toBe('completed');
    
    // Check detailed telemetry
    const strategyMetric = telemetry.recordedMetrics.find(m => 
      m.name === 'execution_strategy_router.strategy_selected');
    expect(strategyMetric).toBeDefined();
    
    const completionMetric = telemetry.recordedMetrics.find(m => 
      m.name === 'execution_strategy_router.execution_completed');
    expect(completionMetric).toBeDefined();
    expect(completionMetric.tags.symbol).toBe('BTC-USD');
  });
  
  test('should handle validation errors properly', async () => {
    const router = ExecutionStrategyRouterJs.getInstance(strategyConfig);
    
    const invalidOrder = {
      // Missing id
      symbol: 'BTC-USD',
      side: OrderSide.Buy,
      type: OrderType.Limit,
      amount: 1.0,
      price: 50000.0,
    };
    
    const resultPromise = new Promise(resolve => {
      router.execute(invalidOrder, result => {
        resolve(result);
      });
    });
    
    const result = await resultPromise;
    expect(result).toBeDefined();
    expect(result.status).toBe('failed');
    expect(result.error_message).toContain('Order ID is required');
    
    // Check error telemetry
    const errorRecord = telemetry.recordedErrors.find(e => 
      e.component === 'ExecutionStrategyRouterJs');
    expect(errorRecord).toBeDefined();
    expect(errorRecord.message).toContain('Execution error');
    expect(errorRecord.tags.error_type).toBe('Error');
  });
  
  test('should handle errors during execution callback', async () => {
    // Need to mock setTimeout to simulate error in callback
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = (callback) => {
      return originalSetTimeout(() => {
        // Replace original callback with one that will throw
        const original = Object.getPrototypeOf(router).simulateExecutedPrice;
        Object.getPrototypeOf(router).simulateExecutedPrice = () => {
          throw new Error('Simulated execution error');
        };
        
        try {
          callback();
        } finally {
          // Restore original after test
          Object.getPrototypeOf(router).simulateExecutedPrice = original;
        }
      }, 10);
    };
    
    const router = ExecutionStrategyRouterJs.getInstance(strategyConfig);
    
    const order = {
      id: 'test-order-2',
      symbol: 'BTC-USD',
      side: OrderSide.Buy,
      type: OrderType.Limit,
      amount: 1.0,
      price: 50000.0,
    };
    
    const resultPromise = new Promise(resolve => {
      router.execute(order, result => {
        resolve(result);
      });
    });
    
    const result = await resultPromise;
    expect(result).toBeDefined();
    expect(result.status).toBe('failed');
    expect(result.error_message).toContain('Execution callback error');
    
    // Check error telemetry
    const errorRecord = telemetry.recordedErrors.find(e => 
      e.component === 'ExecutionStrategyRouterJs' && 
      e.message.includes('Execution callback error'));
    expect(errorRecord).toBeDefined();
    
    // Restore setTimeout
    global.setTimeout = originalSetTimeout;
  });
});

// RiskCalculator Tests
describe('RiskCalculatorJs', () => {
  test('should initialize with config', () => {
    const risk = RiskCalculatorJs.getInstance(riskConfig, 100000.0);
    expect(risk).toBeDefined();
    
    // Check if initialization telemetry is recorded
    const initMetric = telemetry.recordedMetrics.find(m => 
      m.name === 'risk_calculator.initialization');
    expect(initMetric).toBeDefined();
    expect(initMetric.tags.implementation).toBe('javascript');
  });
  
  test('should validate a position', async () => {
    const risk = RiskCalculatorJs.getInstance(riskConfig, 100000.0);
    
    const position = {
      symbol: 'BTC-USD',
      venue: 'binance',
      size: 1.0,
      value: 50000.0,
      leverage: 1.0,
      trustScore: 0.9,
      direction: PositionDirection.Long,
    };
    
    const result = await risk.validatePosition(position);
    expect(typeof result).toBe('boolean');
  });
  
  test('should perform a fast risk check with detailed results', async () => {
    const risk = RiskCalculatorJs.getInstance(riskConfig, 100000.0);
    
    const position = {
      symbol: 'BTC-USD',
      venue: 'binance',
      size: 1.0,
      value: 50000.0,
      leverage: 1.0,
      trustScore: 0.9,
      direction: PositionDirection.Long,
    };
    
    const result = await risk.fastRiskCheck(position);
    expect(result).toBeDefined();
    expect(result).toHaveProperty('allowed');
    expect(result).toHaveProperty('violations');
    expect(result.allowed).toBe(true);
    expect(result.violations.length).toBe(0);
  });
  
  test('should identify risk violations correctly', async () => {
    const risk = RiskCalculatorJs.getInstance(riskConfig, 100000.0);
    
    // Over-leveraged position
    const position = {
      symbol: 'BTC-USD',
      venue: 'binance',
      size: 1.0,
      value: 50000.0,
      leverage: 5.0, // Exceeds maxLeverage of 3.0
      trustScore: 0.9,
      direction: PositionDirection.Long,
    };
    
    const result = await risk.fastRiskCheck(position);
    expect(result).toBeDefined();
    expect(result.allowed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    
    // Ensure the violation type is correctly identified
    const leverageViolation = result.violations.find(v => 
      v.type === 'leverage');
    expect(leverageViolation).toBeDefined();
    expect(leverageViolation.message).toContain('Leverage');
  });
}); 