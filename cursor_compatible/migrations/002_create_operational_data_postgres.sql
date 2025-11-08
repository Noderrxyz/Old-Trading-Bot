-- 002_create_operational_data_postgres.sql
-- Migration for OperationalData table in PostgreSQL

CREATE TABLE IF NOT EXISTS operational_data (
    id VARCHAR(64) PRIMARY KEY,
    type VARCHAR(16) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    symbol VARCHAR(32) NOT NULL,
    timestamp BIGINT NOT NULL,
    payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operational_data_type ON operational_data(type);
CREATE INDEX IF NOT EXISTS idx_operational_data_user ON operational_data(user_id);
CREATE INDEX IF NOT EXISTS idx_operational_data_symbol ON operational_data(symbol);
CREATE INDEX IF NOT EXISTS idx_operational_data_timestamp ON operational_data(timestamp DESC); 