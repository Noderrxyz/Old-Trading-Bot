export interface ScoredSocialSignal {
  source: 'twitter' | 'reddit' | 'telegram';
  sentiment: number;         // -1.0 to 1.0
  relevance: number;         // 0–100
  importance: number;        // 0–100
  summary: string;           // LLM or TF-IDF compressed summary
  tickers: string[];         // ["ETH", "SOL"]
  tags: string[];            // ["whale", "binance", "pump"]
  timestamp: number;
  raw: string;               // Full post/message
  author?: {
    name: string;
    followers?: number;
    karma?: number;
    channelSize?: number;
  };
}

export interface RawSocialMessage {
  id: string;
  source: 'twitter' | 'reddit' | 'telegram';
  content: string;
  timestamp: number;
  author: {
    name: string;
    followers?: number;
    karma?: number;
    channelSize?: number;
  };
  metadata?: Record<string, any>;
}

export interface SentimentResult {
  score: number;       // -1.0 to 1.0
  label: 'positive' | 'negative' | 'neutral';
  confidence: number;  // 0-1
}

export interface RelevanceResult {
  score: number;       // 0-100
  tickers: string[];
  tags: string[];
  reasons: string[];
}

export interface ImportanceResult {
  score: number;       // 0-100
  factors: {
    authorWeight: number;
    engagement: number;
    uniqueness: number;
  };
}

export type ScoringWeights = {
  sentiment: number;
  relevance: number;
  importance: number;
};

// Redis keys for the scoring pipeline
export enum RedisKeys {
  INCOMING_SOCIAL = 'social:incoming',
  SCORED_SOCIAL = 'social:scored',
  TICKER_SIGNALS = 'scored_social:'
} 