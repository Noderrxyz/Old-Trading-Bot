/**
 * Data Pipeline Service
 * 
 * Handles data flow and processing with TimescaleDB integration
 */

import { Pool, PoolClient } from 'pg';
import { createLogger } from '../../common/logger.js';
import { PostgresService } from './PostgresService.js';

const logger = createLogger('DataPipelineService');

/**
 * Data pipeline configuration
 */
export interface DataPipelineConfig {
  batchSize: number;
  flushIntervalMs: number;
  maxRetries: number;
  retryDelayMs: number;
  enableCompression: boolean;
  enableCaching: boolean;
  cacheTtlSeconds: number;
}

/**
 * Default pipeline configuration
 */
const DEFAULT_CONFIG: DataPipelineConfig = {
  batchSize: 1000,
  flushIntervalMs: 5000,
  maxRetries: 3,
  retryDelayMs: 1000,
  enableCompression: true,
  enableCaching: true,
  cacheTtlSeconds: 3600
};

/**
 * Data point interface
 */
export interface DataPoint {
  timestamp: Date;
  symbol: string;
  price: number;
  volume: number;
  liquidity: number;
  volatility: number;
  orderbook?: any;
  trades?: any;
  metadata?: Record<string, any>;
}

/**
 * Data pipeline service for handling data flow and processing
 */
export class DataPipelineService {
  private static instance: DataPipelineService | null = null;
  private postgresService: PostgresService;
  private config: DataPipelineConfig;
  private batchBuffer: DataPoint[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private isInitialized: boolean = false;

  /**
   * Create a new data pipeline service
   * @param postgresService PostgreSQL service instance
   * @param config Pipeline configuration
   */
  constructor(
    postgresService: PostgresService,
    config: Partial<DataPipelineConfig> = {}
  ) {
    this.postgresService = postgresService;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get data pipeline service instance (singleton)
   * @param postgresService PostgreSQL service instance
   * @param config Pipeline configuration
   * @returns Data pipeline service instance
   */
  public static getInstance(
    postgresService: PostgresService,
    config?: Partial<DataPipelineConfig>
  ): DataPipelineService {
    if (!DataPipelineService.instance) {
      DataPipelineService.instance = new DataPipelineService(postgresService, config);
    }
    return DataPipelineService.instance;
  }

  /**
   * Initialize the data pipeline
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Initialize PostgreSQL service
      await this.postgresService.initialize();

      // Start flush interval
      this.startFlushInterval();

      this.isInitialized = true;
      logger.info('Data pipeline initialized successfully');
    } catch (error) {
      logger.error('Error initializing data pipeline:', error);
      throw error;
    }
  }

  /**
   * Process a data point
   * @param dataPoint Data point to process
   */
  public async processDataPoint(dataPoint: DataPoint): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Data pipeline not initialized');
    }

    // Add to batch buffer
    this.batchBuffer.push(dataPoint);

    // Flush if buffer is full
    if (this.batchBuffer.length >= this.config.batchSize) {
      await this.flush();
    }
  }

  /**
   * Process multiple data points
   * @param dataPoints Array of data points to process
   */
  public async processDataPoints(dataPoints: DataPoint[]): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Data pipeline not initialized');
    }

    // Add to batch buffer
    this.batchBuffer.push(...dataPoints);

    // Flush if buffer is full
    if (this.batchBuffer.length >= this.config.batchSize) {
      await this.flush();
    }
  }

  /**
   * Start the flush interval
   */
  private startFlushInterval(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    this.flushInterval = setInterval(async () => {
      if (this.batchBuffer.length > 0) {
        await this.flush();
      }
    }, this.config.flushIntervalMs);
  }

  /**
   * Flush the batch buffer to the database
   */
  private async flush(): Promise<void> {
    if (this.batchBuffer.length === 0) return;

    const batch = [...this.batchBuffer];
    this.batchBuffer = [];

    let retries = 0;
    while (retries < this.config.maxRetries) {
      try {
        const client = await this.postgresService.getClient();
        try {
          await client.query('BEGIN');

          // Prepare batch insert
          const values = batch.map((point, i) => {
            const offset = i * 8;
            return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`;
          }).join(',');

          const params = batch.flatMap(point => [
            point.timestamp,
            point.symbol,
            point.price,
            point.volume,
            point.liquidity,
            point.volatility,
            point.orderbook ? JSON.stringify(point.orderbook) : null,
            point.trades ? JSON.stringify(point.trades) : null
          ]);

          await client.query(`
            INSERT INTO market_data (
              timestamp, symbol, price, volume, liquidity, volatility, orderbook, trades
            ) VALUES ${values}
            ON CONFLICT (timestamp, symbol) DO UPDATE SET
              price = EXCLUDED.price,
              volume = EXCLUDED.volume,
              liquidity = EXCLUDED.liquidity,
              volatility = EXCLUDED.volatility,
              orderbook = EXCLUDED.orderbook,
              trades = EXCLUDED.trades
          `, params);

          await client.query('COMMIT');
          logger.debug(`Flushed ${batch.length} data points to database`);
          return;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      } catch (error) {
        retries++;
        if (retries === this.config.maxRetries) {
          logger.error('Failed to flush data points after max retries:', error);
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelayMs));
      }
    }
  }

  /**
   * Close the data pipeline
   */
  public async close(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    if (this.batchBuffer.length > 0) {
      await this.flush();
    }

    logger.info('Data pipeline closed');
  }
} 