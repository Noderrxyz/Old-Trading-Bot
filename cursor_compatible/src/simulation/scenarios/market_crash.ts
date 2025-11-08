import { ChaosScenario, ChaosEvent, ChaosEventType, ChaosSeverity } from '../types/chaos.types.js';

/**
 * Market crash scenario configuration
 */
export const MARKET_CRASH_SCENARIO: ChaosScenario = {
  name: 'Market Crash Simulation',
  description: 'Simulates a severe market crash with multiple cascading effects',
  durationMs: 300000,  // 5 minutes
  repeatCount: 1,
  events: [
    // Initial price drop
    {
      type: ChaosEventType.MarketCrash,
      severity: ChaosSeverity.High,
      timestamp: 0,
      duration: 60000,  // 1 minute
      probability: 1.0,
      dropPercentage: 30,
      durationMs: 60000,
      affectedMarkets: ['BTC/USD', 'ETH/USD', 'SOL/USD']
    },
    // Oracle delays during crash
    {
      type: ChaosEventType.OracleDelay,
      severity: ChaosSeverity.Medium,
      timestamp: 30000,  // 30 seconds after crash starts
      duration: 30000,
      probability: 0.8,
      delayMs: 15000,
      affectedOracles: ['Chainlink', 'Pyth']
    },
    // Gas spikes due to panic selling
    {
      type: ChaosEventType.GasSpike,
      severity: ChaosSeverity.High,
      timestamp: 45000,  // 45 seconds after crash starts
      duration: 30000,
      probability: 0.9,
      multiplier: 50,
      affectedRoutes: ['Uniswap', 'SushiSwap']
    },
    // DEX downtime due to congestion
    {
      type: ChaosEventType.DEXDowntime,
      severity: ChaosSeverity.Critical,
      timestamp: 60000,  // 1 minute after crash starts
      duration: 120000,
      probability: 0.7,
      affectedDEXs: ['Uniswap', 'SushiSwap'],
      downtimeMs: 120000
    },
    // Chain congestion
    {
      type: ChaosEventType.ChainCongestion,
      severity: ChaosSeverity.High,
      timestamp: 90000,  // 1.5 minutes after crash starts
      duration: 120000,
      probability: 0.8,
      blockDelay: 5,
      affectedChains: ['Ethereum', 'Arbitrum']
    },
    // Trade rejections due to slippage
    {
      type: ChaosEventType.TradeRejection,
      severity: ChaosSeverity.Medium,
      timestamp: 120000,  // 2 minutes after crash starts
      duration: 90000,
      probability: 0.6,
      rejectionRate: 0.4,
      affectedVenues: ['Uniswap', 'SushiSwap']
    },
    // Latency spikes
    {
      type: ChaosEventType.LatencySpike,
      severity: ChaosSeverity.Medium,
      timestamp: 150000,  // 2.5 minutes after crash starts
      duration: 60000,
      probability: 0.7,
      delayMs: 5000,
      affectedEndpoints: ['RPC', 'WebSocket']
    },
    // Slippage bursts
    {
      type: ChaosEventType.SlippageBurst,
      severity: ChaosSeverity.High,
      timestamp: 180000,  // 3 minutes after crash starts
      duration: 60000,
      probability: 0.8,
      slippageMultiplier: 5,
      affectedPairs: ['BTC/USD', 'ETH/USD']
    }
  ]
}; 