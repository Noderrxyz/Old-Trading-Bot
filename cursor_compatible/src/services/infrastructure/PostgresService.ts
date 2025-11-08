/**
 * PostgreSQL Service
 * 
 * Service for interacting with PostgreSQL database
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { createLogger } from '../../common/logger.js';

const logger = createLogger('PostgresService');

/**
 * PostgreSQL Service for database operations
 */
export class PostgresService {
  private static instance: PostgresService | null = null;
  private pool: Pool;
  private isInitialized: boolean = false;

  /**
   * Create a new PostgreSQL service
   * @param connectionString Database connection string
   */
  constructor(connectionString: string = process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/noderr') {
    this.pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Set up error handler
    this.pool.on('error', (err: Error) => {
      logger.error('PostgreSQL pool error:', err);
    });
  }

  /**
   * Get PostgreSQL service instance (singleton)
   * @param connectionString Optional connection string
   * @returns PostgreSQL service instance
   */
  public static getInstance(connectionString?: string): PostgresService {
    if (!PostgresService.instance) {
      PostgresService.instance = new PostgresService(connectionString);
    }
    return PostgresService.instance;
  }

  /**
   * Initialize the database
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    const client = await this.getClient();
    try {
      // Check if the strategy_evolution_log table exists
      const tableExists = await this.checkTableExists('strategy_evolution_log');

      if (!tableExists) {
        // Create strategy_evolution_log table
        await client.query(`
          CREATE TABLE strategy_evolution_log (
            id UUID PRIMARY KEY,
            agent_id TEXT NOT NULL,
            strategy_id TEXT NOT NULL,
            parent_strategy_id TEXT,
            mutation_type TEXT,
            performance_snapshot JSONB,
            timestamp TIMESTAMPTZ DEFAULT now()
          )
        `);

        // Create indexes
        await client.query(`
          CREATE INDEX strategy_evolution_log_agent_id_idx 
          ON strategy_evolution_log (agent_id)
        `);

        await client.query(`
          CREATE INDEX strategy_evolution_log_strategy_id_idx 
          ON strategy_evolution_log (strategy_id)
        `);

        await client.query(`
          CREATE INDEX strategy_evolution_log_parent_strategy_id_idx 
          ON strategy_evolution_log (parent_strategy_id)
        `);

        logger.info('Created strategy_evolution_log table and indexes');
      }

      // Create evolution_metrics table if it doesn't exist
      const metricsTableExists = await this.checkTableExists('evolution_metrics');
      
      if (!metricsTableExists) {
        await client.query(`
          CREATE TABLE evolution_metrics (
            id UUID PRIMARY KEY,
            agent_id TEXT NOT NULL,
            strategy_id TEXT NOT NULL,
            metric_type TEXT NOT NULL,
            value FLOAT NOT NULL,
            prev_value FLOAT,
            delta FLOAT,
            timestamp TIMESTAMPTZ DEFAULT now()
          )
        `);

        await client.query(`
          CREATE INDEX evolution_metrics_agent_id_idx 
          ON evolution_metrics (agent_id)
        `);

        await client.query(`
          CREATE INDEX evolution_metrics_strategy_id_idx 
          ON evolution_metrics (strategy_id)
        `);

        logger.info('Created evolution_metrics table and indexes');
      }

      // Create market_data hypertable if it doesn't exist
      await this.createMarketDataHypertable(client);

      // Create market_data_aggregates table if it doesn't exist
      const aggregatesTableExists = await this.checkTableExists('market_data_aggregates');
      
      if (!aggregatesTableExists) {
        await client.query(`
          CREATE TABLE market_data_aggregates (
            symbol VARCHAR(32) NOT NULL,
            hour TIMESTAMPTZ NOT NULL,
            count INTEGER NOT NULL,
            avg_price NUMERIC NOT NULL,
            avg_volume NUMERIC NOT NULL,
            avg_liquidity NUMERIC NOT NULL,
            avg_volatility NUMERIC NOT NULL,
            min_price NUMERIC NOT NULL,
            max_price NUMERIC NOT NULL,
            min_volume NUMERIC NOT NULL,
            max_volume NUMERIC NOT NULL,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (symbol, hour)
          )
        `);

        // Create indexes
        await client.query(`
          CREATE INDEX market_data_aggregates_symbol_idx 
          ON market_data_aggregates (symbol)
        `);

        await client.query(`
          CREATE INDEX market_data_aggregates_hour_idx 
          ON market_data_aggregates (hour)
        `);

        // Create updated_at trigger function if it doesn't exist
        await client.query(`
          CREATE OR REPLACE FUNCTION update_updated_at_column()
          RETURNS TRIGGER AS $$
          BEGIN
            NEW.updated_at = CURRENT_TIMESTAMP;
            RETURN NEW;
          END;
          $$ language 'plpgsql'
        `);

        // Create trigger
        await client.query(`
          CREATE TRIGGER update_market_data_aggregates_updated_at
            BEFORE UPDATE ON market_data_aggregates
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column()
        `);

        // Create aggregation views
        await client.query(`
          CREATE OR REPLACE VIEW market_data_daily_aggregates AS
          SELECT
            symbol,
            date_trunc('day', hour) as day,
            SUM(count) as total_count,
            AVG(avg_price) as avg_price,
            AVG(avg_volume) as avg_volume,
            AVG(avg_liquidity) as avg_liquidity,
            AVG(avg_volatility) as avg_volatility,
            MIN(min_price) as min_price,
            MAX(max_price) as max_price,
            MIN(min_volume) as min_volume,
            MAX(max_volume) as max_volume
          FROM market_data_aggregates
          GROUP BY symbol, date_trunc('day', hour)
          ORDER BY symbol, day
        `);

        await client.query(`
          CREATE OR REPLACE VIEW market_data_weekly_aggregates AS
          SELECT
            symbol,
            date_trunc('week', hour) as week,
            SUM(count) as total_count,
            AVG(avg_price) as avg_price,
            AVG(avg_volume) as avg_volume,
            AVG(avg_liquidity) as avg_liquidity,
            AVG(avg_volatility) as avg_volatility,
            MIN(min_price) as min_price,
            MAX(max_price) as max_price,
            MIN(min_volume) as min_volume,
            MAX(max_volume) as max_volume
          FROM market_data_aggregates
          GROUP BY symbol, date_trunc('week', hour)
          ORDER BY symbol, week
        `);

        await client.query(`
          CREATE OR REPLACE VIEW market_data_monthly_aggregates AS
          SELECT
            symbol,
            date_trunc('month', hour) as month,
            SUM(count) as total_count,
            AVG(avg_price) as avg_price,
            AVG(avg_volume) as avg_volume,
            AVG(avg_liquidity) as avg_liquidity,
            AVG(avg_volatility) as avg_volatility,
            MIN(min_price) as min_price,
            MAX(max_price) as max_price,
            MIN(min_volume) as min_volume,
            MAX(max_volume) as max_volume
          FROM market_data_aggregates
          GROUP BY symbol, date_trunc('month', hour)
          ORDER BY symbol, month
        `);

        logger.info('Created market_data_aggregates table, indexes, and views');
      }

      this.isInitialized = true;
      logger.info('PostgreSQL database initialized successfully');
    } catch (error) {
      logger.error('Error initializing PostgreSQL database:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check if a table exists in the database
   * @param tableName Table name to check
   * @returns Boolean indicating if table exists
   */
  private async checkTableExists(tableName: string): Promise<boolean> {
    const client = await this.getClient();
    try {
      const result = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = $1
        )
      `, [tableName]);
      
      return result.rows[0].exists;
    } finally {
      client.release();
    }
  }

  /**
   * Get a client from the connection pool
   * @returns Database client
   */
  public async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  /**
   * Execute a query with parameters
   * @param text Query text
   * @param params Query parameters
   * @returns Query result
   */
  public async query<T extends QueryResultRow = any>(text: string, params: any[] = []): Promise<QueryResult<T>> {
    const client = await this.getClient();
    try {
      return await client.query<T>(text, params);
    } finally {
      client.release();
    }
  }

  /**
   * Close all database connections
   */
  public async close(): Promise<void> {
    await this.pool.end();
    logger.info('PostgreSQL connections closed');
  }

  /**
   * Create TimescaleDB hypertable for market data points
   * @param client Database client
   */
  private async createMarketDataHypertable(client: PoolClient): Promise<void> {
    // Create table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS market_data (
        timestamp TIMESTAMPTZ NOT NULL,
        symbol VARCHAR(32) NOT NULL,
        price NUMERIC NOT NULL,
        volume NUMERIC NOT NULL,
        liquidity NUMERIC NOT NULL,
        volatility NUMERIC NOT NULL,
        orderbook JSONB,
        trades JSONB,
        PRIMARY KEY (timestamp, symbol)
      )
    `);
    // Convert to hypertable (idempotent)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = 'market_data'
        ) THEN
          PERFORM create_hypertable('market_data', 'timestamp', if_not_exists => TRUE);
        END IF;
      END$$;
    `);
    // Index for fast symbol/timestamp queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS market_data_symbol_timestamp_idx
      ON market_data (symbol, timestamp DESC)
    `);
    logger.info('market_data hypertable ensured in TimescaleDB');
  }
} 