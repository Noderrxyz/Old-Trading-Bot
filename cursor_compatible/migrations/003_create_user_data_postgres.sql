-- 003_create_user_data_postgres.sql
-- Migration for UserData table in PostgreSQL

CREATE TABLE IF NOT EXISTS user_data (
    id SERIAL PRIMARY KEY,
    type VARCHAR(16) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    timestamp BIGINT NOT NULL,
    payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_data_type ON user_data(type);
CREATE INDEX IF NOT EXISTS idx_user_data_user ON user_data(user_id);
CREATE INDEX IF NOT EXISTS idx_user_data_timestamp ON user_data(timestamp DESC); 