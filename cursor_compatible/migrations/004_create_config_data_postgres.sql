-- 004_create_config_data_postgres.sql
-- Migration for ConfigData table in PostgreSQL

CREATE TABLE IF NOT EXISTS config_data (
    id VARCHAR(64) PRIMARY KEY,
    type VARCHAR(32) NOT NULL,
    timestamp BIGINT NOT NULL,
    payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_config_data_type ON config_data(type);
CREATE INDEX IF NOT EXISTS idx_config_data_timestamp ON config_data(timestamp DESC); 