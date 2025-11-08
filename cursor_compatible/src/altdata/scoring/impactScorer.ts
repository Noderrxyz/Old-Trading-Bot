import { SentimentHeadline, EnrichedHeadline, HeadlineCategory, ScoringConfig } from '../types';

// Default scoring config with weights
const DEFAULT_CONFIG: ScoringConfig = {
  minConfidence: 0.6,
  minImpactScore: 0.3,
  sourceTrustRatings: {
    'CoinDesk': 0.9,
    'CoinTelegraph': 0.85,
    'Bloomberg': 0.95,
    'Reuters': 0.95,
    'CNBC': 0.9,
    'The Block': 0.9,
    'Decrypt': 0.8,
    'Twitter': 0.7,
    'Reddit': 0.6,
    'Medium': 0.7,
  },
  assetWeights: {
    'BTC': 1.0,
    'ETH': 0.95,
    'SOL': 0.85,
    'ADA': 0.8,
    'XRP': 0.75,
    'DOT': 0.7,
    'AVAX': 0.7,
    'MATIC': 0.65,
    'LINK': 0.6,
    'DOGE': 0.5,
  },
  categoryWeights: {
    [HeadlineCategory.Regulatory]: 1.0,
    [HeadlineCategory.Market]: 0.9,
    [HeadlineCategory.Hack]: 0.95,
    [HeadlineCategory.Adoption]: 0.85,
    [HeadlineCategory.Technology]: 0.8,
    [HeadlineCategory.Partnership]: 0.75,
    [HeadlineCategory.Other]: 0.5,
  }
};

/**
 * Calculate the asset specificity factor
 * Higher scores for headlines mentioning significant assets
 */
function calculateAssetSpecificity(headline: SentimentHeadline, config: ScoringConfig): number {
  const { assetMentions } = headline;
  
  if (assetMentions.length === 0) {
    return 0.5; // Generic crypto news
  }
  
  // Calculate average asset weight
  let totalWeight = 0;
  for (const asset of assetMentions) {
    totalWeight += config.assetWeights[asset] || 0.5; // Default weight if not found
  }
  
  // Normalize to 0-1 range and apply a bonus for specific asset focus
  const avgWeight = totalWeight / assetMentions.length;
  const specificityBonus = Math.max(0, 1 - (0.1 * (assetMentions.length - 1)));
  
  return Math.min(1, avgWeight * specificityBonus);
}

/**
 * Calculate the source reliability factor
 * Higher scores for more trusted sources
 */
function calculateSourceReliability(headline: SentimentHeadline, config: ScoringConfig): number {
  const { source } = headline;
  return config.sourceTrustRatings[source] || 0.5; // Default to medium trust if source unknown
}

/**
 * Calculate the category significance factor
 * Different categories have different market impact potential
 */
function calculateCategorySignificance(headline: SentimentHeadline, config: ScoringConfig): number {
  const { category } = headline;
  return config.categoryWeights[category];
}

/**
 * Check if the headline contains market mover keywords
 * These are terms that historically have had outsized market impact
 */
function detectMarketMoverKeywords(headline: SentimentHeadline): number {
  const marketMovers = [
    /\b(ban|banned|banning)\b/i,
    /\b(approve|approved|approval)\b/i,
    /\b(etf)\b/i,
    /\b(sec)\b/i,
    /\b(hack|hacked|hacking)\b/i,
    /\b(lawsuit|sue|court)\b/i,
    /\b(partnership with|partners with)\b/i,
    /\b(acquisition|acquire|acquired)\b/i,
    /\b(adoption by|adopted by)\b/i,
    /\b(integration|integrate with)\b/i
  ];
  
  const title = headline.title;
  const content = headline.content || '';
  const textToAnalyze = `${title} ${content}`;
  
  // Count how many market mover patterns match
  let matchCount = 0;
  for (const pattern of marketMovers) {
    if (pattern.test(textToAnalyze)) {
      matchCount++;
    }
  }
  
  // Convert to a 0-1 scale with diminishing returns for multiple matches
  return Math.min(1, matchCount * 0.25);
}

/**
 * Calculate the impact score for a headline
 * Higher scores indicate higher potential market impact
 */
export function calculateImpactScore(headline: SentimentHeadline, config: ScoringConfig = DEFAULT_CONFIG): number {
  // 1. Check confidence threshold
  if (headline.confidence < config.minConfidence) {
    return 0.1; // Low-confidence news gets minimal impact
  }
  
  // 2. Calculate component factors
  const assetFactor = calculateAssetSpecificity(headline, config);
  const sourceFactor = calculateSourceReliability(headline, config);
  const categoryFactor = calculateCategorySignificance(headline, config);
  const marketMoverFactor = detectMarketMoverKeywords(headline);
  
  // 3. Apply sentiment magnitude (absolute value of sentiment matters more than direction)
  const sentimentMagnitude = Math.abs(headline.sentiment);
  
  // 4. Weighted combination of factors
  const rawScore = (
    (assetFactor * 0.25) +
    (sourceFactor * 0.2) +
    (categoryFactor * 0.2) +
    (marketMoverFactor * 0.25) +
    (sentimentMagnitude * 0.1)
  );
  
  // 5. Apply a sigmoid-like scaling for better distribution
  const scaledScore = 1 / (1 + Math.exp(-5 * (rawScore - 0.5)));
  
  return Math.min(1, Math.max(0, scaledScore));
}

/**
 * Enriches a headline with an impact score
 */
export function scoreHeadlineImpact(headline: SentimentHeadline, config: ScoringConfig = DEFAULT_CONFIG): EnrichedHeadline {
  const impactScore = calculateImpactScore(headline, config);
  
  return {
    ...headline,
    impactScore,
  };
} 