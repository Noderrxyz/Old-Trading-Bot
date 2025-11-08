/**
 * Example usage of the Social Scoring Pipeline
 */
import { SocialScoringPipeline } from './socialScoringPipeline.js';
import { RawSocialMessage, ScoringWeights, RedisKeys } from './types.js';

// Define Redis client interface matching what SocialScoringPipeline expects
interface RedisClient {
  zadd: (key: string, score: number, value: string) => Promise<number>;
  zrevrange: (key: string, start: number, end: number, withScores?: string) => Promise<string[]>;
  expire: (key: string, seconds: number) => Promise<number>;
  del: (key: string) => Promise<number>;
  keys: (pattern: string) => Promise<string[]>;
  zcard: (key: string) => Promise<number>;
}

// Mock Redis client for demonstration
const mockRedisClient: RedisClient = {
  zadd: async (key: string, score: number, value: string): Promise<number> => {
    console.log(`ZADD ${key} ${score} ${value.substring(0, 30)}...`);
    return 1;
  },
  zrevrange: async (key: string, start: number, end: number, withScores?: string): Promise<string[]> => {
    console.log(`ZREVRANGE ${key} ${start} ${end} ${withScores || ''}`);
    return ['{"source":"twitter","sentiment":0.8,"relevance":90,"importance":75,"tickers":["AAPL"]}'];
  },
  expire: async (key: string, seconds: number): Promise<number> => {
    console.log(`EXPIRE ${key} ${seconds}`);
    return 1;
  },
  del: async (key: string): Promise<number> => {
    console.log(`DEL ${key}`);
    return 1;
  },
  keys: async (pattern: string): Promise<string[]> => {
    console.log(`KEYS ${pattern}`);
    return [`${RedisKeys.TICKER_SIGNALS}AAPL`, `${RedisKeys.TICKER_SIGNALS}TSLA`];
  },
  zcard: async (key: string): Promise<number> => {
    console.log(`ZCARD ${key}`);
    return 42;
  }
};

// Mock metrics logger
const logMetric = (name: string, value: number, tags: Record<string, string>): void => {
  console.log(`METRIC: ${name} = ${value}`, tags);
};

/**
 * Example demonstration of using the Social Scoring Pipeline
 */
async function runExample(): Promise<void> {
  console.log("Starting Social Scoring Pipeline example...");
  
  // Initialize the scoring service
  const pipeline = new SocialScoringPipeline({
    redisClient: mockRedisClient,
    useLLMSummarization: false
  });
  
  // Example message
  const exampleMessage: RawSocialMessage = {
    id: "msg123456789",
    content: "I'm extremely bullish on $AAPL after seeing their latest earnings. The new product lineup looks promising! #investing #tech",
    source: "twitter",
    timestamp: Date.now(),
    author: {
      name: "techanalyst42",
      followers: 5280,
      karma: 98,
      channelSize: 0
    }
  };
  
  // Process a single message
  console.log("\n1. Processing a single message:");
  const scoredSignal = await pipeline.processMessage(exampleMessage);
  console.log("Processed Signal:", JSON.stringify(scoredSignal, null, 2));
  
  // Process a batch of messages
  console.log("\n2. Processing a batch of messages:");
  const batchMessages: RawSocialMessage[] = [
    exampleMessage,
    {
      id: "msg987654321",
      content: "Considering selling my $TSLA shares after the disappointing announcement. Not what I expected. #stocks",
      source: "reddit",
      timestamp: Date.now(),
      author: {
        name: "investor_jane",
        followers: 0,
        karma: 120,
        channelSize: 0
      }
    }
  ];
  
  const batchResults = await pipeline.batchProcessMessages(batchMessages);
  console.log(`Processed ${batchResults.length} messages in batch`);
  
  // Get top signals for a ticker
  console.log("\n3. Getting top signals for a ticker:");
  const topSignals = await pipeline.getTopSignalsForTicker("AAPL", 5);
  console.log(`Retrieved ${topSignals.length} top signals for AAPL`);
  
  // Update scoring weights
  console.log("\n4. Updating scoring weights:");
  const newWeights: Partial<ScoringWeights> = {
    sentiment: 0.4,
    relevance: 0.3,
    importance: 0.3
  };
  pipeline.updateScoringWeights(newWeights);
  console.log("Scoring weights updated");
  
  console.log("\nExample completed successfully!");
}

// Run the example
runExample().catch(error => {
  console.error("Error running example:", error);
});

export default runExample;