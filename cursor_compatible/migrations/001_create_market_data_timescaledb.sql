-- 001_create_market_data_timescaledb.sql
-- Migration for MarketData table in TimescaleDB

CREATE TABLE IF NOT EXISTS market_data (
    id SERIAL PRIMARY KEY,
    source VARCHAR(32) NOT NULL,
    symbol VARCHAR(32) NOT NULL,
    timestamp BIGINT NOT NULL,
    type VARCHAR(16) NOT NULL,
    data JSONB NOT NULL
);

-- Convert to hypertable
SELECT create_hypertable('market_data', 'timestamp', chunk_time_interval => 86400000, if_not_exists => TRUE);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_market_data_symbol ON market_data(symbol);
CREATE INDEX IF NOT EXISTS idx_market_data_timestamp ON market_data(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_market_data_source ON market_data(source); 