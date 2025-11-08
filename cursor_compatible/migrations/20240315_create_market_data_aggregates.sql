-- Create market_data_aggregates table for storing aggregated market data
CREATE TABLE IF NOT EXISTS market_data_aggregates (
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
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS market_data_aggregates_symbol_idx 
ON market_data_aggregates (symbol);

CREATE INDEX IF NOT EXISTS market_data_aggregates_hour_idx 
ON market_data_aggregates (hour);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create a trigger to automatically update the updated_at column
CREATE TRIGGER update_market_data_aggregates_updated_at
  BEFORE UPDATE ON market_data_aggregates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create a view for daily aggregations
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
ORDER BY symbol, day;

-- Create a view for weekly aggregations
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
ORDER BY symbol, week;

-- Create a view for monthly aggregations
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
ORDER BY symbol, month; 