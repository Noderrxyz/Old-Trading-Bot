/**
 * Data Pipeline Manager
 * 
 * Coordinates data flow and processing across the system
 */

import { createLogger } from '../../common/logger.js';
import { PostgresService } from './PostgresService.js';
import { DataPipelineService, DataPoint } from './DataPipelineService.js';

const logger = createLogger('DataPipelineManager');

/**
 * Pipeline manager configuration
 */
export interface PipelineManagerConfig {
  maxConcurrentPipelines: number;
  pipelineTimeoutMs: number;
  enableValidation: boolean;
  enableTransformation: boolean;
  enableEnrichment: boolean;
  enableAggregation: boolean;
}

/**
 * Default pipeline manager configuration
 */
const DEFAULT_CONFIG: PipelineManagerConfig = {
  maxConcurrentPipelines: 5,
  pipelineTimeoutMs: 30000,
  enableValidation: true,
  enableTransformation: true,
  enableEnrichment: true,
  enableAggregation: true
};

/**
 * Pipeline processing result
 */
export interface PipelineResult {
  success: boolean;
  processedCount: number;
  errorCount: number;
  startTime: Date;
  endTime: Date;
  errors?: Error[];
}

/**
 * Data pipeline manager for coordinating data flow and processing
 */
export class DataPipelineManager {
  private static instance: DataPipelineManager | null = null;
  private postgresService: PostgresService;
  private dataPipelineService: DataPipelineService;
  private config: PipelineManagerConfig;
  private activePipelines: number = 0;
  private isInitialized: boolean = false;

  /**
   * Create a new data pipeline manager
   * @param postgresService PostgreSQL service instance
   * @param config Pipeline manager configuration
   */
  constructor(
    postgresService: PostgresService,
    config: Partial<PipelineManagerConfig> = {}
  ) {
    this.postgresService = postgresService;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dataPipelineService = DataPipelineService.getInstance(postgresService);
  }

  /**
   * Get pipeline manager instance (singleton)
   * @param postgresService PostgreSQL service instance
   * @param config Pipeline manager configuration
   * @returns Pipeline manager instance
   */
  public static getInstance(
    postgresService: PostgresService,
    config?: Partial<PipelineManagerConfig>
  ): DataPipelineManager {
    if (!DataPipelineManager.instance) {
      DataPipelineManager.instance = new DataPipelineManager(postgresService, config);
    }
    return DataPipelineManager.instance;
  }

  /**
   * Initialize the pipeline manager
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Initialize data pipeline service
      await this.dataPipelineService.initialize();

      this.isInitialized = true;
      logger.info('Pipeline manager initialized successfully');
    } catch (error) {
      logger.error('Error initializing pipeline manager:', error);
      throw error;
    }
  }

  /**
   * Process data through the pipeline
   * @param dataPoints Array of data points to process
   * @returns Pipeline processing result
   */
  public async processData(dataPoints: DataPoint[]): Promise<PipelineResult> {
    if (!this.isInitialized) {
      throw new Error('Pipeline manager not initialized');
    }

    if (this.activePipelines >= this.config.maxConcurrentPipelines) {
      throw new Error('Maximum number of concurrent pipelines reached');
    }

    const result: PipelineResult = {
      success: true,
      processedCount: 0,
      errorCount: 0,
      startTime: new Date(),
      endTime: new Date(),
      errors: []
    };

    this.activePipelines++;

    try {
      // Validate data points
      if (this.config.enableValidation) {
        const validationResult = await this.validateData(dataPoints);
        if (!validationResult.success) {
          throw new Error('Data validation failed: ' + validationResult.errors?.join(', '));
        }
      }

      // Transform data points
      let transformedData = dataPoints;
      if (this.config.enableTransformation) {
        transformedData = await this.transformData(dataPoints);
      }

      // Enrich data points
      if (this.config.enableEnrichment) {
        transformedData = await this.enrichData(transformedData);
      }

      // Process data points
      await this.dataPipelineService.processDataPoints(transformedData);

      // Aggregate data if enabled
      if (this.config.enableAggregation) {
        await this.aggregateData(transformedData);
      }

      result.processedCount = transformedData.length;
      result.endTime = new Date();
    } catch (error) {
      result.success = false;
      result.errorCount++;
      result.errors = result.errors || [];
      result.errors.push(error as Error);
      logger.error('Error processing data pipeline:', error);
    } finally {
      this.activePipelines--;
    }

    return result;
  }

  /**
   * Validate data points
   * @param dataPoints Array of data points to validate
   */
  private async validateData(dataPoints: DataPoint[]): Promise<{ success: boolean; errors?: string[] }> {
    const errors: string[] = [];

    for (const point of dataPoints) {
      // Validate required fields
      if (!point.timestamp || !point.symbol || !point.price || !point.volume) {
        errors.push(`Invalid data point: missing required fields for ${point.symbol}`);
        continue;
      }

      // Validate numeric fields
      if (isNaN(point.price) || isNaN(point.volume) || isNaN(point.liquidity) || isNaN(point.volatility)) {
        errors.push(`Invalid data point: non-numeric values for ${point.symbol}`);
        continue;
      }

      // Validate timestamp
      if (point.timestamp > new Date()) {
        errors.push(`Invalid data point: future timestamp for ${point.symbol}`);
        continue;
      }
    }

    return {
      success: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Transform data points
   * @param dataPoints Array of data points to transform
   */
  private async transformData(dataPoints: DataPoint[]): Promise<DataPoint[]> {
    return dataPoints.map(point => ({
      ...point,
      // Normalize numeric values
      price: Number(point.price.toFixed(8)),
      volume: Number(point.volume.toFixed(8)),
      liquidity: Number(point.liquidity.toFixed(8)),
      volatility: Number(point.volatility.toFixed(8)),
      // Add transformation metadata
      metadata: {
        ...point.metadata,
        transformed: true,
        transformationTimestamp: new Date()
      }
    }));
  }

  /**
   * Enrich data points with additional information
   * @param dataPoints Array of data points to enrich
   */
  private async enrichData(dataPoints: DataPoint[]): Promise<DataPoint[]> {
    // Group by symbol for efficient processing
    const symbolGroups = new Map<string, DataPoint[]>();
    dataPoints.forEach(point => {
      const group = symbolGroups.get(point.symbol) || [];
      group.push(point);
      symbolGroups.set(point.symbol, group);
    });

    const enrichedPoints: DataPoint[] = [];

    // Process each symbol group
    for (const [symbol, points] of symbolGroups) {
      // Calculate additional metrics
      const prices = points.map(p => p.price);
      const volumes = points.map(p => p.volume);
      
      const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
      const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
      
      // Enrich each point in the group
      for (const point of points) {
        enrichedPoints.push({
          ...point,
          metadata: {
            ...point.metadata,
            enriched: true,
            enrichmentTimestamp: new Date(),
            averagePrice: avgPrice,
            averageVolume: avgVolume,
            priceDeviation: point.price - avgPrice,
            volumeDeviation: point.volume - avgVolume
          }
        });
      }
    }

    return enrichedPoints;
  }

  /**
   * Aggregate data points
   * @param dataPoints Array of data points to aggregate
   */
  private async aggregateData(dataPoints: DataPoint[]): Promise<void> {
    // Group by symbol and time window
    const aggregations = new Map<string, {
      count: number;
      totalPrice: number;
      totalVolume: number;
      totalLiquidity: number;
      totalVolatility: number;
      minPrice: number;
      maxPrice: number;
      minVolume: number;
      maxVolume: number;
    }>();

    for (const point of dataPoints) {
      const key = `${point.symbol}_${point.timestamp.toISOString().slice(0, 13)}`; // Hourly aggregation
      const agg = aggregations.get(key) || {
        count: 0,
        totalPrice: 0,
        totalVolume: 0,
        totalLiquidity: 0,
        totalVolatility: 0,
        minPrice: Infinity,
        maxPrice: -Infinity,
        minVolume: Infinity,
        maxVolume: -Infinity
      };

      agg.count++;
      agg.totalPrice += point.price;
      agg.totalVolume += point.volume;
      agg.totalLiquidity += point.liquidity;
      agg.totalVolatility += point.volatility;
      agg.minPrice = Math.min(agg.minPrice, point.price);
      agg.maxPrice = Math.max(agg.maxPrice, point.price);
      agg.minVolume = Math.min(agg.minVolume, point.volume);
      agg.maxVolume = Math.max(agg.maxVolume, point.volume);

      aggregations.set(key, agg);
    }

    // Store aggregations in database
    const client = await this.postgresService.getClient();
    try {
      await client.query('BEGIN');

      for (const [key, agg] of aggregations) {
        const [symbol, hour] = key.split('_');
        await client.query(`
          INSERT INTO market_data_aggregates (
            symbol,
            hour,
            count,
            avg_price,
            avg_volume,
            avg_liquidity,
            avg_volatility,
            min_price,
            max_price,
            min_volume,
            max_volume
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (symbol, hour) DO UPDATE SET
            count = EXCLUDED.count,
            avg_price = EXCLUDED.avg_price,
            avg_volume = EXCLUDED.avg_volume,
            avg_liquidity = EXCLUDED.avg_liquidity,
            avg_volatility = EXCLUDED.avg_volatility,
            min_price = EXCLUDED.min_price,
            max_price = EXCLUDED.max_price,
            min_volume = EXCLUDED.min_volume,
            max_volume = EXCLUDED.max_volume
        `, [
          symbol,
          hour,
          agg.count,
          agg.totalPrice / agg.count,
          agg.totalVolume / agg.count,
          agg.totalLiquidity / agg.count,
          agg.totalVolatility / agg.count,
          agg.minPrice,
          agg.maxPrice,
          agg.minVolume,
          agg.maxVolume
        ]);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Close the pipeline manager
   */
  public async close(): Promise<void> {
    await this.dataPipelineService.close();
    logger.info('Pipeline manager closed');
  }
} 