-- Create the evolution_scores table to store strategy evaluation results

CREATE TABLE IF NOT EXISTS evolution_scores (
  id SERIAL PRIMARY KEY,
  strategy_id VARCHAR(50) NOT NULL,
  agent_id VARCHAR(50) NOT NULL,
  generation_id VARCHAR(50) NOT NULL,
  score FLOAT NOT NULL,
  passed BOOLEAN NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  notes TEXT,
  sharpe FLOAT NOT NULL,
  max_drawdown FLOAT NOT NULL,
  win_rate FLOAT NOT NULL,
  volatility_resilience FLOAT NOT NULL,
  regret_index FLOAT NOT NULL,
  mutation_type VARCHAR(30),
  
  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes
  INDEX idx_strategy (strategy_id),
  INDEX idx_agent (agent_id),
  INDEX idx_generation (generation_id),
  INDEX idx_timestamp (timestamp),
  INDEX idx_score (score)
);

-- Create a view to get the best strategy for each agent
CREATE OR REPLACE VIEW best_agent_strategies AS
SELECT 
  agent_id,
  strategy_id,
  score,
  generation_id,
  timestamp
FROM evolution_scores
WHERE (agent_id, score) IN (
  SELECT 
    agent_id, 
    MAX(score) 
  FROM evolution_scores 
  WHERE passed = true
  GROUP BY agent_id
);

-- Create a view for evolution performance metrics
CREATE OR REPLACE VIEW evolution_performance AS
SELECT
  generation_id,
  COUNT(*) AS total_strategies,
  SUM(CASE WHEN passed THEN 1 ELSE 0 END) AS passed_strategies,
  AVG(score) AS avg_score,
  MAX(score) AS max_score,
  MIN(score) AS min_score,
  AVG(sharpe) AS avg_sharpe,
  AVG(max_drawdown) AS avg_drawdown,
  AVG(win_rate) AS avg_win_rate
FROM evolution_scores
GROUP BY generation_id
ORDER BY generation_id; 