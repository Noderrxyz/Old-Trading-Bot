import { ChaosScenario, ChaosEvent, ChaosEventType, ChaosSeverity } from '../types/chaos.types.js';

/**
 * Oracle delay scenario configuration
 */
export const ORACLE_DELAY_SCENARIO: ChaosScenario = {
  name: 'Oracle Delay Simulation',
  description: 'Simulates oracle delays and their impact on price feeds and execution',
  durationMs: 240000,  // 4 minutes
  repeatCount: 1,
  events: [
    // Initial oracle delay
    {
      type: ChaosEventType.OracleDelay,
      severity: ChaosSeverity.High,
      timestamp: 0,
      duration: 120000,  // 2 minutes
      probability: 1.0,
      delayMs: 30000,
      affectedOracles: ['Chainlink', 'Pyth', 'Band']
    },
    // Market impact due to stale prices
    {
      type: ChaosEventType.MarketCrash,
      severity: ChaosSeverity.Medium,
      timestamp: 30000,  // 30 seconds after delay starts
      duration: 60000,
      probability: 0.7,
      dropPercentage: 15,
      durationMs: 60000,
      affectedMarkets: ['BTC/USD', 'ETH/USD']
    },
    // Trade rejections due to price staleness
    {
      type: ChaosEventType.TradeRejection,
      severity: ChaosSeverity.Medium,
      timestamp: 60000,  // 1 minute after delay starts
      duration: 90000,
      probability: 0.8,
      rejectionRate: 0.5,
      affectedVenues: ['Uniswap', 'SushiSwap']
    },
    // Gas spikes due to retries
    {
      type: ChaosEventType.GasSpike,
      severity: ChaosSeverity.Medium,
      timestamp: 90000,  // 1.5 minutes after delay starts
      duration: 60000,
      probability: 0.6,
      multiplier: 20,
      affectedRoutes: ['Uniswap', 'SushiSwap']
    },
    // Chain congestion due to retries
    {
      type: ChaosEventType.ChainCongestion,
      severity: ChaosSeverity.Medium,
      timestamp: 120000,  // 2 minutes after delay starts
      duration: 60000,
      probability: 0.5,
      blockDelay: 2,
      affectedChains: ['Ethereum', 'Arbitrum']
    },
    // Latency spikes
    {
      type: ChaosEventType.LatencySpike,
      severity: ChaosSeverity.Low,
      timestamp: 150000,  // 2.5 minutes after delay starts
      duration: 30000,
      probability: 0.4,
      delayMs: 2000,
      affectedEndpoints: ['RPC', 'WebSocket']
    },
    // Slippage bursts due to price uncertainty
    {
      type: ChaosEventType.SlippageBurst,
      severity: ChaosSeverity.Medium,
      timestamp: 180000,  // 3 minutes after delay starts
      duration: 30000,
      probability: 0.7,
      slippageMultiplier: 2,
      affectedPairs: ['ETH/USD', 'BTC/USD']
    }
  ]
}; 