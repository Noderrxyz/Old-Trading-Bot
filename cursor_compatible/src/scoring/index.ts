/**
 * Social Scoring Module
 * 
 * This module provides functionality for scoring and analyzing social media content
 * from various sources like Twitter, Reddit, and Telegram, transforming raw messages
 * into enriched, ranked signal events.
 */

// Export main service
export { SocialScoringService } from './service.js';

// Export core components
export { SocialScoringPipeline } from './socialScoringPipeline.js';
export { SentimentAnalyzer } from './sentimentAnalyzer.js';
export { RelevanceScorer } from './relevanceScorer.js';
export { ImportanceScorer } from './importanceScorer.js';

// Export types
export {
  ScoredSocialSignal,
  RawSocialMessage,
  SentimentResult,
  RelevanceResult,
  ImportanceResult,
  ScoringWeights,
  RedisKeys
} from './types.js'; 