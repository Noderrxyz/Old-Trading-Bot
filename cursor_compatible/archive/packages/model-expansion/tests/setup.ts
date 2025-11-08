/**
 * Test setup for Model Expansion package
 */

// Mock TensorFlow.js for tests
jest.mock('@tensorflow/tfjs-node', () => ({
  tensor: jest.fn(() => ({
    dataSync: () => new Float32Array([0.5, 0.3, 0.2]),
    dispose: jest.fn()
  })),
  tensor2d: jest.fn(() => ({
    dataSync: () => new Float32Array([0.5, 0.3, 0.2]),
    dispose: jest.fn()
  })),
  sequential: jest.fn(() => ({
    add: jest.fn(),
    compile: jest.fn(),
    fit: jest.fn(() => Promise.resolve()),
    predict: jest.fn(() => [
      { dataSync: () => new Float32Array([0.3, 0.4, 0.3]) },
      { dataSync: () => new Float32Array([0.05]) },
      { dataSync: () => new Float32Array([0.8]) }
    ]),
    save: jest.fn(() => Promise.resolve()),
    load: jest.fn(() => Promise.resolve())
  })),
  layers: {
    dense: jest.fn(() => ({})),
    dropout: jest.fn(() => ({})),
    activation: jest.fn(() => ({}))
  },
  train: {
    adam: jest.fn(() => ({}))
  },
  losses: {
    meanSquaredError: jest.fn()
  },
  tidy: jest.fn((fn) => fn()),
  dispose: jest.fn()
}));

// Mock external APIs
global.fetch = jest.fn();

// Mock Winston logger
jest.mock('winston', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })),
  format: {
    combine: jest.fn(),
    timestamp: jest.fn(),
    errors: jest.fn(),
    json: jest.fn()
  },
  transports: {
    Console: jest.fn(),
    File: jest.fn()
  }
}));

// Mock crypto for consistent test results
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: jest.fn(() => 'test-uuid-1234')
}));

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

// Global test utilities
global.createMockMarketState = () => ({
  prices: {
    'BTC-USD': 50000,
    'ETH-USD': 3000,
    'BNB-USD': 400,
    'SOL-USD': 100
  },
  volumes: {
    'BTC-USD': 1000000000,
    'ETH-USD': 500000000,
    'BNB-USD': 100000000,
    'SOL-USD': 50000000
  },
  orderBook: {
    'BTC-USD': {
      bids: [[49900, 10], [49800, 20]],
      asks: [[50100, 10], [50200, 20]]
    }
  },
  technicalIndicators: {
    'BTC-USD': {
      rsi: 45,
      macd: { value: 100, signal: 90, histogram: 10 },
      sma20: 49000,
      sma50: 48000,
      ema12: 49500,
      ema26: 49000
    }
  },
  sentimentScores: {
    'BTC-USD': 0.65,
    'ETH-USD': 0.70
  },
  customFeatures: {},
  timestamp: Date.now(),
  accountBalance: 100000,
  positions: []
});

// Extend Jest matchers
expect.extend({
  toBeWithinRange(received: number, floor: number, ceiling: number) {
    const pass = received >= floor && received <= ceiling;
    if (pass) {
      return {
        message: () => `expected ${received} not to be within range ${floor} - ${ceiling}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be within range ${floor} - ${ceiling}`,
        pass: false,
      };
    }
  },
}); 