import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { ChaosInjectors } from './ChaosInjectors.js';

interface TradeEvent {
  timestamp: number;
  blockNumber: number;
  pair: string;
  price: number;
  size: number;
  gasPrice: number;
  venue: string;
  type: 'swap' | 'add_liquidity' | 'remove_liquidity';
}

interface ReplayConfig {
  dataPath: string;
  startBlock: number;
  endBlock: number;
  speedMultiplier: number;
  injectChaos: boolean;
  outputDir: string;
}

const DEFAULT_CONFIG: ReplayConfig = {
  dataPath: path.join(process.cwd(), 'data', 'historical', 'uniswap_v3_trades.jsonl'),
  startBlock: 0,
  endBlock: Infinity,
  speedMultiplier: 1,
  injectChaos: true,
  outputDir: path.join(process.cwd(), 'replay_results')
};

export class HistoricalReplayEngine {
  private static instance: HistoricalReplayEngine;
  private config: ReplayConfig;
  private chaosInjectors: ChaosInjectors;
  private currentBlock: number;
  private tradeEvents: TradeEvent[];
  private replayMetrics: ReplayMetrics;

  private constructor(config: Partial<ReplayConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.chaosInjectors = ChaosInjectors.getInstance();
    this.currentBlock = this.config.startBlock;
    this.tradeEvents = [];
    this.replayMetrics = {
      totalTrades: 0,
      totalVolume: 0,
      avgGasPrice: 0,
      maxDrawdown: 0,
      latencyStats: {
        min: Infinity,
        max: 0,
        avg: 0
      }
    };
    this.setupOutputDirectory();
  }

  public static getInstance(config?: Partial<ReplayConfig>): HistoricalReplayEngine {
    if (!HistoricalReplayEngine.instance) {
      HistoricalReplayEngine.instance = new HistoricalReplayEngine(config);
    }
    return HistoricalReplayEngine.instance;
  }

  private setupOutputDirectory(): void {
    if (!fs.existsSync(this.config.outputDir)) {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
    }
  }

  public async loadHistoricalData(): Promise<void> {
    try {
      const data = fs.readFileSync(this.config.dataPath, 'utf-8');
      this.tradeEvents = data
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line))
        .filter(event => 
          event.blockNumber >= this.config.startBlock && 
          event.blockNumber <= this.config.endBlock
        )
        .sort((a, b) => a.blockNumber - b.blockNumber);

      logger.info(`Loaded ${this.tradeEvents.length} historical trade events`);
    } catch (error) {
      logger.error('Failed to load historical data:', error);
      throw error;
    }
  }

  public async startReplay(): Promise<void> {
    logger.info('Starting historical replay...');
    
    for (const event of this.tradeEvents) {
      await this.processEvent(event);
      this.updateMetrics(event);
      
      if (this.config.injectChaos) {
        this.maybeInjectChaos(event.blockNumber);
      }
    }

    this.generateReplayReport();
    logger.info('Historical replay completed');
  }

  private async processEvent(event: TradeEvent): Promise<void> {
    // Simulate network latency
    const latency = this.simulateLatency();
    await new Promise(resolve => setTimeout(resolve, latency));

    // Process the trade event
    logger.debug(`Processing trade at block ${event.blockNumber}: ${event.type} ${event.size} ${event.pair} @ ${event.price}`);

    // Update replay metrics
    this.replayMetrics.totalTrades++;
    this.replayMetrics.totalVolume += event.size;
    this.replayMetrics.avgGasPrice = (this.replayMetrics.avgGasPrice * (this.replayMetrics.totalTrades - 1) + event.gasPrice) / this.replayMetrics.totalTrades;
    
    // Update latency stats
    this.replayMetrics.latencyStats.min = Math.min(this.replayMetrics.latencyStats.min, latency);
    this.replayMetrics.latencyStats.max = Math.max(this.replayMetrics.latencyStats.max, latency);
    this.replayMetrics.latencyStats.avg = (this.replayMetrics.latencyStats.avg * (this.replayMetrics.totalTrades - 1) + latency) / this.replayMetrics.totalTrades;
  }

  private simulateLatency(): number {
    // Simulate network latency with some randomness
    const baseLatency = 100; // ms
    const jitter = Math.random() * 50; // Random jitter up to 50ms
    return (baseLatency + jitter) / this.config.speedMultiplier;
  }

  private maybeInjectChaos(blockNumber: number): void {
    const chaosTypes = ['oracle_freeze', 'gas_spike', 'block_stall', 'liquidity_cliff'];
    const randomType = chaosTypes[Math.floor(Math.random() * chaosTypes.length)];
    
    if (Math.random() < 0.1) { // 10% chance to inject chaos
      this.chaosInjectors.inject(randomType, blockNumber);
    }
  }

  private updateMetrics(event: TradeEvent): void {
    // Update max drawdown based on price movements
    const priceChange = (event.price - this.getPreviousPrice(event.pair)) / this.getPreviousPrice(event.pair);
    this.replayMetrics.maxDrawdown = Math.min(this.replayMetrics.maxDrawdown, priceChange);
  }

  private getPreviousPrice(pair: string): number {
    // Find the most recent price for the given pair
    const previousEvent = this.tradeEvents
      .slice(0, this.tradeEvents.findIndex(e => e.pair === pair))
      .reverse()
      .find(e => e.pair === pair);
    
    return previousEvent?.price || 0;
  }

  private generateReplayReport(): void {
    const report = {
      timestamp: new Date().toISOString(),
      config: this.config,
      metrics: this.replayMetrics,
      chaosEvents: this.chaosInjectors.getActiveEvents()
    };

    const reportPath = path.join(this.config.outputDir, 'replay_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  public cleanup(): void {
    this.tradeEvents = [];
    this.replayMetrics = {
      totalTrades: 0,
      totalVolume: 0,
      avgGasPrice: 0,
      maxDrawdown: 0,
      latencyStats: {
        min: Infinity,
        max: 0,
        avg: 0
      }
    };
    this.chaosInjectors.reset();
  }
}

interface ReplayMetrics {
  totalTrades: number;
  totalVolume: number;
  avgGasPrice: number;
  maxDrawdown: number;
  latencyStats: {
    min: number;
    max: number;
    avg: number;
  };
} 