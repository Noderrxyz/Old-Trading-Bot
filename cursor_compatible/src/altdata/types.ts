/**
 * Types for headline scoring system
 */

/**
 * Raw headline from news source
 */
export interface RawHeadline {
  id: string;
  title: string;
  content?: string;
  summary?: string;
  source: string;
  url: string;
  publishedAt: string;
  author?: string;
  imageUrl?: string;
}

/**
 * Headline category types
 */
export type HeadlineCategory = 
  | 'Regulatory'
  | 'Market'
  | 'Hack'
  | 'Adoption'
  | 'Technology'
  | 'Partnership'
  | 'Opinion'
  | 'Other';

/**
 * Entity types for entity detection
 */
export type EntityType = 
  | 'Exchange'
  | 'Regulator'
  | 'Company'
  | 'Person'
  | 'Cryptocurrency'
  | 'Protocol'
  | 'Country'
  | 'Other';

/**
 * Entity detected in a headline
 */
export interface Entity {
  name: string;
  type: EntityType;
  confidence?: number;
}

/**
 * The result of headline classification
 */
export interface ClassificationResult {
  category: HeadlineCategory;
  tags: string[];
  entities: Entity[];
  assetMentions: string[]; // Crypto asset tickers
  confidence: number;
}

/**
 * The result of sentiment analysis
 */
export interface SentimentResult {
  score: number; // -1.0 to 1.0
  label: 'positive' | 'negative' | 'neutral';
  confidence: number; // 0 to 1
  subjectivity?: number; // 0 to 1 (optional)
}

/**
 * Impact score calculation result
 */
export interface ImpactResult {
  score: number; // 0 to 1
  factors: {
    sentimentContribution: number;
    categoryWeight: number;
    assetSpecificity: number;
    sourceReliability: number;
  };
}

/**
 * Fully processed and enriched headline
 */
export interface EnrichedHeadline {
  id: string;
  title: string;
  content?: string;
  summary?: string;
  source: string;
  url: string;
  publishedAt: string;
  author?: string;
  imageUrl?: string;
  
  // Classification data
  category: HeadlineCategory;
  tags: string[];
  entities: Entity[];
  assetMentions: string[];
  
  // Sentiment data
  sentiment: number;
  sentimentLabel?: 'positive' | 'negative' | 'neutral';
  confidence: number;
  subjectivity?: number;
  
  // Impact data
  impactScore: number;
  
  // Processing metadata
  processedAt: string;
  version: string;
}

// Configuration for the scoring pipeline
export interface ScoringConfig {
  minConfidence: number;
  minImpactScore: number;
  sourceTrustRatings: Record<string, number>;
  assetWeights: Record<string, number>;
  categoryWeights: Record<string, number>;
}

// Redis keys for the pipeline
export enum RedisKeys {
  INCOMING_NEWS = 'altdata:news:incoming',
  SCORED_NEWS = 'altdata:news:scored',
}

/**
 * Headline after classification
 */
export interface ClassifiedHeadline extends RawHeadline {
  category: HeadlineCategory;
  tags: string[];
  entities: Entity[];
  assetMentions: string[];
  confidence: number;
}

/**
 * Headline after sentiment analysis
 */
export interface SentimentHeadline extends ClassifiedHeadline {
  sentiment: number;
  confidence: number;
  subjectivity: number;
} 