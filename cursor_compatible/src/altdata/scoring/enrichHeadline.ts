import { RawHeadline, EnrichedHeadline, ScoringConfig } from '../types';
import { classifyHeadline } from './headlineClassifier';
import { analyzeSentimentForHeadline } from './sentimentAnalyzer';
import { scoreHeadlineImpact } from './impactScorer';

/**
 * Generate a deterministic ID for a headline if one is not provided
 */
function generateHeadlineId(headline: RawHeadline): string {
  if (headline.id) {
    return headline.id;
  }
  
  // Create a simple hash from headline title and publication date
  const normalizeStr = (str: string) => str.replace(/\W+/g, '').toLowerCase();
  const titleHash = normalizeStr(headline.title).substring(0, 10);
  const sourceHash = normalizeStr(headline.source).substring(0, 4);
  const dateStr = headline.publishedAt.replace(/\D/g, '').substring(0, 8);
  
  // Combine into a single ID string
  return `${titleHash}-${sourceHash}-${dateStr}`;
}

/**
 * Ensure the headline has an ISO-formatted timestamp
 */
function ensureISOTimestamp(headline: RawHeadline): RawHeadline {
  if (!headline.publishedAt) {
    headline.publishedAt = new Date().toISOString();
    return headline;
  }
  
  // Check if the timestamp is already ISO format
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(headline.publishedAt)) {
    return headline;
  }
  
  // Try to convert to ISO format
  try {
    const date = new Date(headline.publishedAt);
    headline.publishedAt = date.toISOString();
  } catch (e) {
    // If parsing fails, use current date
    headline.publishedAt = new Date().toISOString();
  }
  
  return headline;
}

/**
 * Normalize URLs to ensure they're proper
 */
function normalizeUrl(headline: RawHeadline): RawHeadline {
  if (!headline.url) {
    return headline;
  }
  
  // Ensure URL has a protocol
  if (!headline.url.startsWith('http://') && !headline.url.startsWith('https://')) {
    headline.url = `https://${headline.url}`;
  }
  
  return headline;
}

/**
 * Check if a headline meets the minimum criteria to be included
 */
function isHeadlineValid(headline: EnrichedHeadline, config: ScoringConfig): boolean {
  // Check confidence threshold
  if (headline.confidence < config.minConfidence) {
    return false;
  }
  
  // Check impact score threshold
  if (headline.impactScore < config.minImpactScore) {
    return false;
  }
  
  return true;
}

/**
 * Process a raw headline through the entire pipeline:
 * 1. Normalize and validate the headline
 * 2. Classify by category, entities and assets
 * 3. Analyze sentiment
 * 4. Score market impact
 */
export function enrichHeadline(headline: RawHeadline, config: ScoringConfig): EnrichedHeadline | null {
  // 1. Validate and normalize the input headline
  const normalizedHeadline = { ...headline };
  
  // Generate ID if not present
  if (!normalizedHeadline.id) {
    normalizedHeadline.id = generateHeadlineId(normalizedHeadline);
  }
  
  // Ensure proper timestamp
  ensureISOTimestamp(normalizedHeadline);
  
  // Normalize URL
  normalizeUrl(normalizedHeadline);
  
  // 2. Classify headline
  const classifiedHeadline = classifyHeadline(normalizedHeadline);
  
  // 3. Analyze sentiment
  const sentimentHeadline = analyzeSentimentForHeadline(classifiedHeadline);
  
  // 4. Score impact
  const enrichedHeadline = scoreHeadlineImpact(sentimentHeadline, config);
  
  // 5. Final validation
  if (!isHeadlineValid(enrichedHeadline, config)) {
    return null; // Discard headlines that don't meet quality criteria
  }
  
  return enrichedHeadline;
} 