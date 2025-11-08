import { logger } from '../utils/logger.js';
import { TelemetryBus } from '../telemetry/TelemetryBus.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Replay configuration
 */
export interface ReplayConfig {
  dataDir: string;
  speedMultiplier: number;
  startTime?: number;
  endTime?: number;
}

/**
 * Default replay configuration
 */
export const DEFAULT_REPLAY_CONFIG: ReplayConfig = {
  dataDir: 'data/replays',
  speedMultiplier: 1.0
};

/**
 * Market tick
 */
export interface MarketTick {
  timestamp: number;
  price: number;
  volume: number;
  bid: number;
  ask: number;
  orderbook?: {
    bids: [number, number][];
    asks: [number, number][];
  };
}

/**
 * Replay state
 */
export interface ReplayState {
  isPlaying: boolean;
  currentTime: number;
  startTime: number;
  endTime: number;
  speedMultiplier: number;
  totalTicks: number;
  processedTicks: number;
}

/**
 * Replay Engine
 */
export class ReplayEngine {
  private static instance: ReplayEngine | null = null;
  private config: ReplayConfig;
  private telemetryBus: TelemetryBus;
  private state: ReplayState;
  private currentFile: string | null = null;
  private fileStream: fs.ReadStream | null = null;
  private playInterval: NodeJS.Timeout | null = null;
  private attachedStrategies: Map<string, (tick: MarketTick) => void>;

  private constructor(config: Partial<ReplayConfig> = {}) {
    this.config = { ...DEFAULT_REPLAY_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.attachedStrategies = new Map();
    this.state = {
      isPlaying: false,
      currentTime: 0,
      startTime: 0,
      endTime: 0,
      speedMultiplier: this.config.speedMultiplier,
      totalTicks: 0,
      processedTicks: 0
    };
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<ReplayConfig>): ReplayEngine {
    if (!ReplayEngine.instance) {
      ReplayEngine.instance = new ReplayEngine(config);
    }
    return ReplayEngine.instance;
  }

  /**
   * Load replay data
   */
  public async load(filePath: string): Promise<void> {
    try {
      this.currentFile = path.join(this.config.dataDir, filePath);
      
      // Read file metadata
      const stats = fs.statSync(this.currentFile);
      this.state.startTime = this.config.startTime || 0;
      this.state.endTime = this.config.endTime || stats.mtimeMs;
      this.state.currentTime = this.state.startTime;

      // Count total ticks
      this.state.totalTicks = await this.countTicks();
      this.state.processedTicks = 0;

      logger.info(`Loaded replay data: ${filePath}`);
      this.telemetryBus.emit('replay_loaded', {
        filePath,
        startTime: this.state.startTime,
        endTime: this.state.endTime,
        totalTicks: this.state.totalTicks
      });
    } catch (error) {
      logger.error(`Error loading replay data: ${error}`);
      throw error;
    }
  }

  /**
   * Count total ticks in file
   */
  private async countTicks(): Promise<number> {
    if (!this.currentFile) return 0;

    return new Promise((resolve, reject) => {
      let count = 0;
      const stream = fs.createReadStream(this.currentFile!);
      
      stream.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        count += lines.length;
      });

      stream.on('end', () => resolve(count));
      stream.on('error', reject);
    });
  }

  /**
   * Start replay
   */
  public start(): void {
    if (this.state.isPlaying) return;
    if (!this.currentFile) {
      logger.error('No replay data loaded');
      return;
    }

    this.state.isPlaying = true;
    this.fileStream = fs.createReadStream(this.currentFile);
    
    this.playInterval = setInterval(
      () => this.processNextTick(),
      1000 / this.state.speedMultiplier
    );

    this.telemetryBus.emit('replay_started', {
      currentTime: this.state.currentTime,
      speedMultiplier: this.state.speedMultiplier
    });
  }

  /**
   * Pause replay
   */
  public pause(): void {
    if (!this.state.isPlaying) return;

    this.state.isPlaying = false;
    if (this.playInterval) {
      clearInterval(this.playInterval);
      this.playInterval = null;
    }

    this.telemetryBus.emit('replay_paused', {
      currentTime: this.state.currentTime,
      processedTicks: this.state.processedTicks
    });
  }

  /**
   * Step forward one tick
   */
  public stepForward(): void {
    if (this.state.isPlaying) {
      this.pause();
    }
    this.processNextTick();
  }

  /**
   * Jump to specific timestamp
   */
  public jumpTo(timestamp: number): void {
    if (timestamp < this.state.startTime || timestamp > this.state.endTime) {
      logger.error('Invalid timestamp for jump');
      return;
    }

    this.state.currentTime = timestamp;
    this.telemetryBus.emit('replay_jumped', {
      timestamp,
      processedTicks: this.state.processedTicks
    });
  }

  /**
   * Process next tick
   */
  private processNextTick(): void {
    if (!this.fileStream) return;

    const line = this.fileStream.read();
    if (!line) {
      this.endReplay();
      return;
    }

    try {
      const tick: MarketTick = JSON.parse(line.toString());
      
      // Update state
      this.state.currentTime = tick.timestamp;
      this.state.processedTicks++;

      // Process tick for all attached strategies
      for (const strategy of this.attachedStrategies.values()) {
        strategy(tick);
      }

      // Emit tick event
      this.telemetryBus.emit('market_tick', tick);

      // Check if we've reached the end
      if (this.state.currentTime >= this.state.endTime) {
        this.endReplay();
      }
    } catch (error) {
      logger.error(`Error processing tick: ${error}`);
    }
  }

  /**
   * End replay
   */
  private endReplay(): void {
    this.pause();
    if (this.fileStream) {
      this.fileStream.close();
      this.fileStream = null;
    }

    this.telemetryBus.emit('replay_ended', {
      endTime: this.state.endTime,
      processedTicks: this.state.processedTicks,
      totalTicks: this.state.totalTicks
    });
  }

  /**
   * Attach strategy to replay
   */
  public attachStrategy(
    strategyId: string,
    handler: (tick: MarketTick) => void
  ): void {
    this.attachedStrategies.set(strategyId, handler);
    logger.info(`Attached strategy ${strategyId} to replay engine`);
  }

  /**
   * Detach strategy from replay
   */
  public detachStrategy(strategyId: string): void {
    this.attachedStrategies.delete(strategyId);
    logger.info(`Detached strategy ${strategyId} from replay engine`);
  }

  /**
   * Get current replay state
   */
  public getState(): ReplayState {
    return { ...this.state };
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    this.pause();
    if (this.fileStream) {
      this.fileStream.close();
      this.fileStream = null;
    }
    this.attachedStrategies.clear();
  }
} 