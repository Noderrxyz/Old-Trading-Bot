import { RawHeadline, SentimentResult } from '../types';

// Lexicon for positive and negative terms (simplified VADER-style approach)
const POSITIVE_WORDS = [
  'bullish', 'surge', 'rally', 'gain', 'positive', 'launch', 'approval', 'adoption',
  'partnership', 'integrate', 'success', 'breakthrough', 'win', 'upgrade', 'growth',
  'soar', 'innovation', 'collaboration', 'progress', 'boost', 'opportunity',
  'advance', 'profit', 'expand', 'support', 'enable', 'achievement', 'legitimate',
  'strength', 'legitimate', 'recover', 'improvement', 'potential', 'advantage'
];

const NEGATIVE_WORDS = [
  'bearish', 'crash', 'plunge', 'ban', 'negative', 'hack', 'exploit', 'vulnerability',
  'scam', 'fraud', 'investigation', 'lawsuit', 'fine', 'penalty', 'attack', 'risk',
  'concern', 'threat', 'warning', 'dump', 'sell-off', 'loss', 'violation', 'suspend',
  'delay', 'postpone', 'fail', 'reject', 'problem', 'collapse', 'underperform',
  'criticism', 'weakness', 'decline', 'drop', 'decrease', 'downtrend', 'scrutiny',
  'illegal', 'shutdown', 'restriction', 'problem', 'controversy'
];

// Intensity modifiers
const BOOSTERS = [
  'very', 'extremely', 'incredibly', 'absolutely', 'completely', 'definitely',
  'significantly', 'substantially', 'particularly', 'notably', 'highly',
  'intensely', 'exceedingly', 'remarkably', 'exceptionally', 'especially'
];

const DAMPENERS = [
  'slightly', 'somewhat', 'relatively', 'moderately', 'partially', 'hardly',
  'barely', 'scarcely', 'marginally', 'nominally', 'arguably', 'potentially',
  'possibly', 'perhaps', 'maybe'
];

// Negation words
const NEGATION_WORDS = [
  'no', 'not', 'none', 'nobody', 'nothing', 'neither', 'never', 'hardly',
  'rarely', 'scarcely', 'seldom', 'barely', 'doesn\'t', 'isn\'t', 'wasn\'t',
  'shouldn\'t', 'wouldn\'t', 'couldn\'t', 'won\'t', 'can\'t', 'don\'t'
];

/**
 * SentimentAnalyzer
 * 
 * Analyzes headline sentiment using a lexicon-based approach 
 * similar to VADER (Valence Aware Dictionary and sEntiment Reasoner)
 */
export class SentimentAnalyzer {
  private positiveLexicon: Map<string, number>;
  private negativeLexicon: Map<string, number>;
  private negators: Set<string>;
  private intensifiers: Map<string, number>;
  private financialPositiveLexicon: Map<string, number>;
  private financialNegativeLexicon: Map<string, number>;

  constructor() {
    // Initialize lexicons with sentiment intensity scores
    this.positiveLexicon = new Map([
      ['good', 1.9], ['great', 2.3], ['excellent', 2.7], ['amazing', 2.6], 
      ['positive', 1.9], ['exciting', 2.0], ['happy', 1.9], ['glad', 1.7],
      ['wonderful', 2.5], ['fantastic', 2.7], ['success', 2.0], ['successful', 2.2],
      ['gain', 1.5], ['gains', 1.5], ['improve', 1.8], ['improvement', 1.8],
      ['boost', 1.6], ['better', 1.2], ['best', 2.3], ['surpass', 1.5],
      ['grow', 1.3], ['growth', 1.5], ['outperform', 1.7], ['profit', 1.9],
      ['profitability', 1.9], ['profitable', 1.9], ['win', 1.6], ['winner', 1.7],
      ['strong', 1.6], ['strength', 1.5], ['strengthen', 1.5], ['opportunity', 1.5],
      ['opportunities', 1.5], ['optimistic', 2.1], ['rally', 1.8], ['rallies', 1.8],
      ['surge', 1.8], ['jump', 1.6], ['climb', 1.5], ['rise', 1.5], ['rising', 1.5],
      ['rose', 1.5], ['high', 1.1], ['higher', 1.2], ['highest', 1.5], ['record', 1.3],
      ['historic', 1.2], ['milestone', 1.5], ['support', 1.3], ['backed', 1.3],
      ['approved', 1.7], ['approval', 1.7], ['positive', 1.9], ['bullish', 2.5]
    ]);

    this.negativeLexicon = new Map([
      ['bad', -1.9], ['terrible', -2.3], ['awful', -2.2], ['horrible', -2.5],
      ['negative', -1.9], ['disappointing', -1.8], ['sad', -1.6], ['sorry', -1.5],
      ['unfortunate', -1.8], ['disappointment', -1.8], ['fail', -2.0], ['failure', -2.1],
      ['loss', -1.7], ['losses', -1.7], ['lose', -1.5], ['lost', -1.5], ['losing', -1.5],
      ['decline', -1.5], ['declining', -1.5], ['decrease', -1.3], ['decreased', -1.3],
      ['drop', -1.5], ['dropped', -1.5], ['dropping', -1.5], ['fall', -1.5],
      ['falling', -1.5], ['fell', -1.5], ['low', -1.1], ['lower', -1.2],
      ['lowest', -1.5], ['weak', -1.6], ['weakness', -1.5], ['weaken', -1.5],
      ['poor', -1.5], ['risk', -1.3], ['risky', -1.5], ['danger', -1.8],
      ['dangerous', -1.8], ['problem', -1.5], ['problems', -1.5], ['issue', -1.3],
      ['issues', -1.3], ['concern', -1.2], ['concerns', -1.2], ['worried', -1.4],
      ['worry', -1.4], ['anxious', -1.6], ['anxiety', -1.6], ['fear', -1.8],
      ['fearful', -1.8], ['rejected', -1.7], ['rejection', -1.7], ['negative', -1.9],
      ['crash', -2.5], ['collapse', -2.3], ['plunge', -2.1], ['plummet', -2.2],
      ['bearish', -2.5], ['against', -1.0], ['halt', -1.2], ['stop', -1.0]
    ]);

    // Initialize financial/crypto specific lexicon
    this.financialPositiveLexicon = new Map([
      ['bull', 2.2], ['bullish', 2.5], ['buy', 1.5], ['buying', 1.5], ['long', 1.2],
      ['hodl', 1.8], ['mooning', 2.5], ['moon', 2.3], ['pump', 1.8], ['green', 1.4],
      ['ath', 2.0], ['high', 1.4], ['profit', 1.8], ['support', 1.5], ['breakout', 2.0],
      ['overcome', 1.5], ['adoption', 1.8], ['partner', 1.6], ['partnership', 1.6],
      ['agreement', 1.5], ['launch', 1.6], ['launching', 1.6], ['invest', 1.3],
      ['investment', 1.3], ['investor', 1.2], ['approve', 1.7], ['approval', 1.7],
      ['legal', 1.3], ['legalize', 1.8], ['regulated', 1.2], ['regulation', 0.8],
      ['solution', 1.5], ['solve', 1.5], ['resolved', 1.5], ['integrate', 1.4],
      ['integration', 1.4], ['announce', 1.2], ['announcement', 1.2], ['progress', 1.5],
      ['update', 1.2], ['upgrade', 1.4], ['improved', 1.4], ['improvement', 1.4],
      ['recover', 1.6], ['recovery', 1.6], ['gain', 1.5], ['etf', 1.3]
    ]);

    this.financialNegativeLexicon = new Map([
      ['bear', -2.2], ['bearish', -2.5], ['sell', -1.3], ['selling', -1.3], ['short', -1.2],
      ['dump', -2.0], ['dumping', -2.0], ['red', -1.4], ['atl', -2.0], ['low', -1.4],
      ['loss', -1.8], ['resistance', -1.0], ['breakdown', -1.8], ['hack', -2.5],
      ['hacked', -2.5], ['scam', -2.5], ['scammed', -2.5], ['fraud', -2.3],
      ['fraudulent', -2.3], ['attack', -2.2], ['breach', -2.2], ['steal', -2.1],
      ['stolen', -2.1], ['exploit', -2.2], ['vulnerable', -1.7], ['vulnerability', -1.7],
      ['ban', -2.0], ['banned', -2.0], ['banning', -2.0], ['illegal', -1.8],
      ['illicit', -1.8], ['forbid', -1.8], ['prohibit', -1.8], ['reject', -1.7],
      ['rejected', -1.7], ['reject', -1.7], ['delay', -1.3], ['delayed', -1.3],
      ['postpone', -1.3], ['postponed', -1.3], ['suspend', -1.6], ['suspended', -1.6],
      ['freeze', -1.5], ['frozen', -1.5], ['shut', -1.8], ['shutdown', -1.8],
      ['problem', -1.5], ['issue', -1.4], ['bug', -1.6], ['glitch', -1.5],
      ['crash', -2.5], ['down', -1.3], ['offline', -1.4], ['unavailable', -1.4],
      ['maintenance', -0.8], ['investigation', -1.2], ['investigate', -1.2],
      ['lawsuit', -1.8], ['sue', -1.8], ['court', -1.0], ['regulatory', -0.8],
      ['risk', -1.5], ['concern', -1.3], ['warning', -1.5], ['warn', -1.5],
      ['caution', -1.3], ['cautious', -1.3]
    ]);

    // Initialize negators that flip sentiment
    this.negators = new Set([
      'not', 'no', 'none', 'neither', 'never', 'nobody', 'nowhere', 'nothing', 
      'cannot', 'cant', 'can\'t', 'won\'t', 'wont', 'isn\'t', 'isnt', 'aren\'t', 
      'arent', 'wasn\'t', 'wasnt', 'weren\'t', 'werent', 'don\'t', 'dont', 'doesn\'t',
      'doesnt', 'didn\'t', 'didnt', 'haven\'t', 'havent', 'hasn\'t', 'hasnt', 'hadn\'t',
      'hadnt', 'shouldn\'t', 'shouldnt', 'wouldn\'t', 'wouldnt', 'couldn\'t', 'couldnt'
    ]);

    // Initialize intensifiers that amplify sentiment
    this.intensifiers = new Map([
      ['very', 0.3], ['really', 0.3], ['extremely', 0.4], ['highly', 0.3],
      ['incredibly', 0.4], ['so', 0.2], ['absolutely', 0.4], ['completely', 0.3],
      ['definitely', 0.2], ['particularly', 0.2], ['quite', 0.2], ['too', 0.2],
      ['totally', 0.3], ['utterly', 0.4], ['especially', 0.3], ['exceptionally', 0.4],
      ['extraordinarily', 0.4], ['greatly', 0.3], ['substantially', 0.3],
      ['significantly', 0.3], ['most', 0.3], ['much', 0.2]
    ]);
  }

  /**
   * Analyze the sentiment of a headline
   * @param headline The raw headline to analyze
   * @returns Sentiment analysis result
   */
  public analyzeSentiment(headline: RawHeadline): SentimentResult {
    // Combine title and content for analysis
    const text = `${headline.title} ${headline.content || ''}`.toLowerCase();
    
    // Tokenize into words and phrases
    const tokens = this.tokenize(text);
    
    // Calculate sentiment score
    const { score, confidence } = this.calculateSentimentScore(tokens);
    
    // Determine sentiment label
    let label: 'positive' | 'negative' | 'neutral';
    if (score > 0.05) {
      label = 'positive';
    } else if (score < -0.05) {
      label = 'negative';
    } else {
      label = 'neutral';
    }

    // Calculate subjectivity
    const subjectivity = this.calculateSubjectivity(tokens);
    
    return {
      score,
      label,
      confidence,
      subjectivity
    };
  }

  /**
   * Tokenize text into words and phrases
   * @param text The text to tokenize
   * @returns Array of tokens
   */
  private tokenize(text: string): string[] {
    // Basic tokenization - split by whitespace and punctuation
    return text.replace(/[.,!?;:-]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .toLowerCase()
              .split(' ');
  }

  /**
   * Calculate sentiment score based on lexicon matches
   * @param tokens Tokenized text
   * @returns Sentiment score and confidence
   */
  private calculateSentimentScore(tokens: string[]): { score: number, confidence: number } {
    let score = 0;
    let matchCount = 0;
    let totalTokens = tokens.length;
    
    // Skip index tracking for negation
    let skipIndices = new Set<number>();
    
    for (let i = 0; i < tokens.length; i++) {
      if (skipIndices.has(i)) continue;
      
      const token = tokens[i];
      let localScore = 0;
      let amplifier = 1.0;
      let negated = false;
      
      // Check for negation context (looking back up to 3 tokens)
      for (let j = Math.max(0, i - 3); j < i; j++) {
        if (this.negators.has(tokens[j])) {
          negated = true;
          break;
        }
      }
      
      // Check for intensifiers
      const prevToken = i > 0 ? tokens[i - 1] : '';
      if (this.intensifiers.has(prevToken)) {
        amplifier += this.intensifiers.get(prevToken) || 0;
      }
      
      // Check for bi-grams (two-word phrases)
      if (i < tokens.length - 1) {
        const bigram = `${token} ${tokens[i + 1]}`;
        localScore = this.getScoreFromLexicons(bigram);
        
        // If bigram found, skip the next token
        if (localScore !== 0) {
          skipIndices.add(i + 1);
          matchCount++;
        }
      }
      
      // If no bigram match, check single token
      if (localScore === 0) {
        localScore = this.getScoreFromLexicons(token);
        if (localScore !== 0) matchCount++;
      }
      
      // Apply negation
      if (negated) {
        localScore = -localScore;
      }
      
      // Apply intensity amplifier
      score += localScore * amplifier;
    }
    
    // Normalize score between -1 and 1
    let normalizedScore = 0;
    if (score > 0) {
      normalizedScore = Math.min(score / 5, 1);
    } else if (score < 0) {
      normalizedScore = Math.max(score / 5, -1);
    }
    
    // Calculate confidence based on match density and magnitude
    const matchDensity = totalTokens > 0 ? matchCount / totalTokens : 0;
    const scoreMagnitude = Math.abs(normalizedScore);
    
    // Confidence is higher when both match density and score magnitude are higher
    const confidence = 0.5 + (matchDensity * 0.25) + (scoreMagnitude * 0.25);
    
    return {
      score: normalizedScore,
      confidence: Math.min(confidence, 1.0)
    };
  }

  /**
   * Get sentiment score from lexicons
   * @param token Token to evaluate
   * @returns Sentiment score
   */
  private getScoreFromLexicons(token: string): number {
    // First check financial lexicons (higher priority)
    if (this.financialPositiveLexicon.has(token)) {
      return this.financialPositiveLexicon.get(token) || 0;
    }
    
    if (this.financialNegativeLexicon.has(token)) {
      return this.financialNegativeLexicon.get(token) || 0;
    }
    
    // Then check general lexicons
    if (this.positiveLexicon.has(token)) {
      return this.positiveLexicon.get(token) || 0;
    }
    
    if (this.negativeLexicon.has(token)) {
      return this.negativeLexicon.get(token) || 0;
    }
    
    return 0; // Neutral
  }

  /**
   * Calculate subjectivity score (opinion vs. fact)
   * @param tokens Tokenized text
   * @returns Subjectivity score (0-1)
   */
  private calculateSubjectivity(tokens: string[]): number {
    let subjectiveWordCount = 0;
    
    for (const token of tokens) {
      // Words that often indicate subjective content
      if (
        this.positiveLexicon.has(token) || 
        this.negativeLexicon.has(token) ||
        this.financialPositiveLexicon.has(token) ||
        this.financialNegativeLexicon.has(token) ||
        token.match(/could|would|should|may|might|expect|believe|think|feel|suggest|predict|forecast|estimate|speculate|assume|suspect|doubt|anticipate|hope|wish/)
      ) {
        subjectiveWordCount++;
      }
    }
    
    // Calculate subjectivity as ratio of subjective words to total
    const subjectivity = tokens.length > 0 ? subjectiveWordCount / tokens.length : 0;
    
    // Scale and cap
    return Math.min(subjectivity * 2, 1.0);
  }
}

/**
 * Simple rule-based sentiment analyzer
 * Returns a sentiment score between -1.0 (most negative) and 1.0 (most positive)
 */
export function analyzeSentiment(text: string): { score: number; confidence: number } {
  const words = text.toLowerCase().match(/\b\w+\b/g) || [];
  let score = 0;
  let wordCount = 0;
  let affectedWords = 0;
  
  // Check for matches and calculate sentiment
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let modifier = 1.0;
    let negated = false;
    
    // Check for negations in a 3-word window before the current word
    const prevThree = words.slice(Math.max(0, i - 3), i);
    if (prevThree.some(w => NEGATION_WORDS.includes(w))) {
      negated = true;
    }
    
    // Check for boosters/dampeners in a 2-word window before the current word
    const prevTwo = words.slice(Math.max(0, i - 2), i);
    if (prevTwo.some(w => BOOSTERS.includes(w))) {
      modifier *= 1.5;
    } else if (prevTwo.some(w => DAMPENERS.includes(w))) {
      modifier *= 0.5;
    }
    
    if (POSITIVE_WORDS.includes(word)) {
      score += (negated ? -1 : 1) * modifier;
      affectedWords++;
    } else if (NEGATIVE_WORDS.includes(word)) {
      score += (negated ? 1 : -1) * modifier;
      affectedWords++;
    }
    
    wordCount++;
  }
  
  // Calculate final sentiment score normalized between -1 and 1
  // If no sentiment words are found, return neutral (0)
  const normalizedScore = wordCount > 0 && affectedWords > 0
    ? Math.max(-1, Math.min(1, score / Math.sqrt(wordCount)))
    : 0;
  
  // Calculate confidence based on the ratio of affected words and total words
  // More affected words = higher confidence
  const confidence = wordCount > 0
    ? Math.min(0.95, 0.5 + (affectedWords / wordCount) * 0.5)
    : 0.5;
  
  return { score: normalizedScore, confidence };
}

/**
 * Calculates the subjectivity score based on the number of opinion words
 * compared to total words (0 = completely objective, 1 = completely subjective)
 */
function calculateSubjectivity(text: string): number {
  const words = text.toLowerCase().match(/\b\w+\b/g) || [];
  if (words.length === 0) return 0;
  
  const opinionWords = [...POSITIVE_WORDS, ...NEGATIVE_WORDS];
  const subjectiveWords = words.filter(word => opinionWords.includes(word));
  
  return Math.min(1, subjectiveWords.length / words.length);
}

/**
 * Analyze sentiment for a classified headline
 */
export function analyzeSentimentForHeadline(headline: ClassifiedHeadline): SentimentHeadline {
  const title = headline.title;
  const content = headline.content || '';
  const textToAnalyze = `${title} ${content}`;
  
  const { score, confidence } = analyzeSentiment(textToAnalyze);
  const subjectivity = calculateSubjectivity(textToAnalyze);
  
  return {
    ...headline,
    sentiment: score,
    confidence,
    subjectivity,
  };
} 