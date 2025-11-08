import { ChaosScenario, ChaosEvent, ChaosEventType, ChaosSeverity } from '../types/chaos.types.js';

/**
 * Gas spike scenario configuration
 */
export const GAS_SPIKE_SCENARIO: ChaosScenario = {
  name: 'Gas Spike Simulation',
  description: 'Simulates a severe gas price spike with cascading effects on execution',
  durationMs: 180000,  // 3 minutes
  repeatCount: 1,
  events: [
    // Initial gas spike
    {
      type: ChaosEventType.GasSpike,
      severity: ChaosSeverity.High,
      timestamp: 0,
      duration: 60000,  // 1 minute
      probability: 1.0,
      multiplier: 100,
      affectedRoutes: ['Uniswap', 'SushiSwap', 'Curve']
    },
    // Chain congestion due to gas spike
    {
      type: ChaosEventType.ChainCongestion,
      severity: ChaosSeverity.Medium,
      timestamp: 30000,  // 30 seconds after spike starts
      duration: 90000,
      probability: 0.9,
      blockDelay: 3,
      affectedChains: ['Ethereum', 'Arbitrum', 'Optimism']
    },
    // Trade rejections due to high gas
    {
      type: ChaosEventType.TradeRejection,
      severity: ChaosSeverity.High,
      timestamp: 45000,  // 45 seconds after spike starts
      duration: 60000,
      probability: 0.8,
      rejectionRate: 0.6,
      affectedVenues: ['Uniswap', 'SushiSwap']
    },
    // DEX downtime due to congestion
    {
      type: ChaosEventType.DEXDowntime,
      severity: ChaosSeverity.Critical,
      timestamp: 60000,  // 1 minute after spike starts
      duration: 60000,
      probability: 0.7,
      affectedDEXs: ['Uniswap', 'SushiSwap'],
      downtimeMs: 60000
    },
    // Oracle delays during congestion
    {
      type: ChaosEventType.OracleDelay,
      severity: ChaosSeverity.Medium,
      timestamp: 90000,  // 1.5 minutes after spike starts
      duration: 30000,
      probability: 0.6,
      delayMs: 10000,
      affectedOracles: ['Chainlink', 'Pyth']
    },
    // Latency spikes
    {
      type: ChaosEventType.LatencySpike,
      severity: ChaosSeverity.Medium,
      timestamp: 120000,  // 2 minutes after spike starts
      duration: 30000,
      probability: 0.7,
      delayMs: 3000,
      affectedEndpoints: ['RPC', 'WebSocket']
    },
    // Slippage bursts due to reduced liquidity
    {
      type: ChaosEventType.SlippageBurst,
      severity: ChaosSeverity.High,
      timestamp: 150000,  // 2.5 minutes after spike starts
      duration: 30000,
      probability: 0.8,
      slippageMultiplier: 3,
      affectedPairs: ['ETH/USD', 'USDC/USDT']
    }
  ]
}; 