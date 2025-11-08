// Integration tests for Rust wrappers
import { 
  SmartOrderRouterRust, 
  RiskCalculatorRust, 
  DynamicTradeSizerRust,
  DrawdownMonitorRust,
  ExecutionStrategyRouterRust,
  ExecutionAlgorithm
} from '../src/index.js';

import { OrderSide } from '../src/execution/order.js';
import { PositionDirection } from '../src/types/position.js';

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

// SmartOrderRouter Tests
describe('SmartOrderRouterRust', () => {
  test('should initialize with trust scores', () => {
    const trustScores = {
      'binance': 0.9,
      'coinbase': 0.8,
    };
    
    const router = SmartOrderRouterRust.withTrustScores(trustScores);
    expect(router).toBeDefined();
  });
  
  test('should execute an order', async () => {
    const router = new SmartOrderRouterRust();
    
    const order = {
      id: 'test-order-1',
      symbol: 'BTC-USD',
      side: OrderSide.Buy,
      amount: 1.0,
      price: 50000.0,
      venues: ['binance', 'coinbase'],
    };
    
    const result = await router.executeOrder(order);
    expect(result).toBeDefined();
    expect(result.request_id).toBe(order.id);
  });
});

// RiskCalculator Tests
describe('RiskCalculatorRust', () => {
  test('should initialize with config', () => {
    const risk = new RiskCalculatorRust(riskConfig, 100000.0);
    expect(risk).toBeDefined();
  });
  
  test('should validate a position', async () => {
    const risk = new RiskCalculatorRust(riskConfig, 100000.0);
    
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
  
  test('should perform a fast risk check', async () => {
    const risk = new RiskCalculatorRust(riskConfig, 100000.0);
    
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
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('violations');
  });
});

// DynamicTradeSizer Tests
describe('DynamicTradeSizerRust', () => {
  test('should initialize with default config', () => {
    const sizer = new DynamicTradeSizerRust();
    expect(sizer).toBeDefined();
  });
  
  test('should initialize with custom config', () => {
    const sizer = DynamicTradeSizerRust.withConfig(sizerConfig);
    expect(sizer).toBeDefined();
  });
  
  test('should calculate position size', async () => {
    const sizer = new DynamicTradeSizerRust();
    
    const result = await sizer.calculatePositionSize('BTC-USD', 1000.0);
    expect(typeof result).toBe('number');
  });
  
  test('should update volatility', async () => {
    const sizer = new DynamicTradeSizerRust();
    
    const result = await sizer.updateVolatility('BTC-USD', 50000.0);
    expect(typeof result).toBe('number');
  });
});

// DrawdownMonitor Tests
describe('DrawdownMonitorRust', () => {
  test('should initialize with config and callback', () => {
    const killSwitchCallback = (agentId, reason, message) => {
      console.log(`Kill switch triggered for ${agentId}: ${reason} - ${message}`);
      return true;
    };
    
    const monitor = new DrawdownMonitorRust(drawdownConfig, killSwitchCallback);
    expect(monitor).toBeDefined();
  });
  
  test('should record a trade', async () => {
    const killSwitchCallback = () => true;
    const monitor = new DrawdownMonitorRust(drawdownConfig, killSwitchCallback);
    
    const trade = {
      agentId: 'test-agent-1',
      symbol: 'BTC-USD',
      amount: 1.0,
      price: 50000.0,
      tradeType: 'buy',
      equity: 100000.0,
      tradeId: 'trade-1',
      pnl: 0.0,
    };
    
    await monitor.recordTrade(trade);
    // If no exception is thrown, test passes
  });
  
  test('should get current drawdown', async () => {
    const killSwitchCallback = () => true;
    const monitor = new DrawdownMonitorRust(drawdownConfig, killSwitchCallback);
    
    const result = await monitor.getCurrentDrawdown('test-agent-1');
    expect(typeof result).toBe('number');
  });
});

// ExecutionStrategyRouter Tests
describe('ExecutionStrategyRouterRust', () => {
  test('should initialize with config', () => {
    const router = new ExecutionStrategyRouterRust(strategyConfig);
    expect(router).toBeDefined();
  });
  
  test('should execute with callback', async () => {
    const router = new ExecutionStrategyRouterRust(strategyConfig);
    
    const order = {
      id: 'test-order-1',
      symbol: 'BTC-USD',
      side: OrderSide.Buy,
      amount: 1.0,
      price: 50000.0,
      venues: ['binance'],
    };
    
    const resultPromise = new Promise(resolve => {
      router.execute(order, result => {
        resolve(result);
      });
    });
    
    const result = await resultPromise;
    expect(result).toBeDefined();
    expect(result.request_id).toBe(order.id);
  });
  
  test('should estimate impact', async () => {
    const router = new ExecutionStrategyRouterRust(strategyConfig);
    
    const order = {
      id: 'test-order-1',
      symbol: 'BTC-USD',
      side: OrderSide.Buy,
      amount: 1.0,
      price: 50000.0,
      venues: ['binance'],
    };
    
    const result = await router.estimateImpact(order);
    expect(typeof result).toBe('number');
  });
}); 