// Execution Optimizer Module - World-class Smart Order Routing and Execution
// Export all public APIs

// Types
export * from './types';

// Core Components
export { SmartOrderRouter } from './core/SmartOrderRouter';
export { LiquidityAggregator } from './core/LiquidityAggregator';
export { CostOptimizer } from './core/CostOptimizer';
export { LatencyManager } from './core/LatencyManager';

// Algorithms
export { TWAPAlgorithm } from './algorithms/TWAPAlgorithm';
export { VWAPAlgorithm } from './algorithms/VWAPAlgorithm';
export { POVAlgorithm } from './algorithms/POVAlgorithm';
export { IcebergAlgorithm } from './algorithms/IcebergAlgorithm';

// MEV Protection
export { MEVProtectionManager } from './mev/MEVProtectionManager';

// Machine Learning
export { PredictiveExecutionEngine } from './ml/PredictiveExecutionEngine';

// Main Service
export { ExecutionOptimizerService } from './services/ExecutionOptimizerService';

// Version
export const VERSION = '1.0.0';

// Default configuration factory
export function createDefaultConfig(): any {
  return {
    exchanges: [
      {
        id: 'binance',
        enabled: true,
        preferences: {
          priority: 1,
          maxOrderSize: 100000,
          minOrderSize: 10,
          allowedPairs: ['BTC/USDT', 'ETH/USDT'],
          feeOverride: {
            maker: 0.001,
            taker: 0.001,
            withdrawal: {},
            deposit: {}
          }
        },
        rateLimit: {
          requests: 1200,
          period: 60
        }
      },
      {
        id: 'coinbase',
        enabled: true,
        preferences: {
          priority: 2,
          maxOrderSize: 50000,
          minOrderSize: 10,
          allowedPairs: ['BTC/USD', 'ETH/USD']
        },
        rateLimit: {
          requests: 600,
          period: 60
        }
      }
    ],
    routing: {
      mode: 'smart',
      splitThreshold: 1000,
      maxSplits: 5,
      routingObjective: 'balanced',
      venueAnalysis: true,
      darkPoolAccess: false,
      crossVenueArbitrage: true,
      latencyOptimization: true,
      mevProtection: true
    },
    algorithms: [
      {
        type: 'TWAP',
        enabled: true,
        constraints: {
          minOrderSize: 1000,
          maxExecutionTime: 3600000,
          maxSlippage: 0.005,
          minFillRate: 0.95
        },
        parameters: {
          slices: 10,
          duration: 3600000,
          randomization: 0.1,
          aggressiveness: 0.5
        }
      }
    ],
    mevProtection: {
      enabled: true,
      strategies: ['FLASHBOTS', 'PRIVATE_MEMPOOL', 'STEALTH_TRANSACTIONS'],
      flashbotsEnabled: true,
      privateRelays: [],
      priorityFeeStrategy: 'dynamic',
      maxPriorityFee: 50,
      bundleTimeout: 3
    },
    execution: {
      objectives: {
        primary: 'balanced',
        slippageWeight: 0.4,
        speedWeight: 0.3,
        costWeight: 0.3
      },
      constraints: {
        maxSlippage: 0.005,
        maxExecutionTime: 300000,
        maxRetries: 3,
        minFillRate: 0.95
      },
      urgency: 'medium',
      monitoring: {
        realtimeMetrics: true,
        alertThresholds: {
          slippage: 0.01,
          executionTime: 600000,
          failureRate: 0.05
        },
        reporting: {
          interval: 3600000,
          includeDetails: true
        }
      }
    },
    telemetry: {
      enabled: true,
      endpoint: 'console',
      interval: 60000,
      includePerformanceMetrics: true,
      includeSystemMetrics: false
    }
  };
}

// Utility functions
export function createOrder(params: {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  type?: 'market' | 'limit';
  price?: number;
  metadata?: any;
}): any {
  return {
    id: `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    clientOrderId: `client-${Date.now()}`,
    symbol: params.symbol,
    side: params.side === 'buy' ? 'BUY' : 'SELL',
    type: params.type?.toUpperCase() || 'MARKET',
    quantity: params.quantity,
    price: params.price,
    timeInForce: 'IOC',
    status: 'NEW',
    exchange: 'auto',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: params.metadata || {}
  };
}

// Quick start example
export const QuickStartExample = `
import { ExecutionOptimizerService, createDefaultConfig, createOrder } from '@noderr/execution-optimizer';
import winston from 'winston';

// Create logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

// Create service
const config = createDefaultConfig();
const optimizer = new ExecutionOptimizerService(config, logger);

// Start service
await optimizer.start();

// Execute order
const order = createOrder({
  symbol: 'BTC/USDT',
  side: 'buy',
  quantity: 0.1,
  type: 'market'
});

const result = await optimizer.executeOrder(order);
console.log('Execution result:', result);

// Get analytics
const analytics = optimizer.getAnalytics();
console.log('Analytics:', analytics);

// Stop service
await optimizer.stop();
`; 