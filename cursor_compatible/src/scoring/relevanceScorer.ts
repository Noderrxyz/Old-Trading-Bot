import { RelevanceResult } from './types.js';

/**
 * Relevance Scorer
 * Analyzes social media messages to determine their relevance for trading
 * Based on ticker mentions, exchange references, urgency signals, etc.
 */
export class RelevanceScorer {
  private cryptoTickers: Set<string>;
  private exchanges: Set<string>;

  constructor() {
    // Initialize with a list of common crypto tickers
    this.cryptoTickers = new Set([
      'BTC', 'ETH', 'SOL', 'ADA', 'XRP', 'DOT', 'AVAX', 'MATIC', 
      'BNB', 'DOGE', 'SHIB', 'LINK', 'LTC', 'UNI', 'AAVE', 'ATOM',
      'FTM', 'ALGO', 'NEAR', 'FLOW', 'APE', 'FIL', 'EOS', 'XTZ',
      'TRX', 'BCH', 'LUNA', 'CAKE', 'MANA', 'SAND', 'AXS', 'GALA'
    ]);

    // Initialize with a list of common exchanges and platforms
    this.exchanges = new Set([
      'binance', 'coinbase', 'kraken', 'ftx', 'kucoin', 'bybit',
      'huobi', 'okx', 'gemini', 'bitfinex', 'bitstamp', 'uniswap',
      'sushiswap', 'pancakeswap', 'curve', 'balancer', 'dydx', 'bitmex'
    ]);
  }

  /**
   * Score the relevance of a social message for trading
   */
  public scoreRelevance(text: string): RelevanceResult {
    const lowerText = text.toLowerCase();
    const reasons: string[] = [];
    let score = 0;

    // 1. Extract tickers (both with $ prefix and without)
    const tickers = this.extractTickers(text);
    if (tickers.length > 0) {
      score += Math.min(tickers.length * 15, 45); // Up to 45 points for tickers
      reasons.push(`Mentioned ${tickers.length} crypto tickers`);
    }

    // 2. Check for exchange mentions
    const exchangeMentions = this.findExchangeMentions(lowerText);
    if (exchangeMentions.length > 0) {
      score += 10;
      reasons.push(`Mentioned exchanges: ${exchangeMentions.join(', ')}`);
    }

    // 3. Check for urgency signals
    const urgencyScore = this.detectUrgency(lowerText);
    if (urgencyScore > 0) {
      score += urgencyScore;
      reasons.push('Contains urgent language');
    }

    // 4. Check for price action language
    const priceActionScore = this.detectPriceAction(lowerText);
    if (priceActionScore > 0) {
      score += priceActionScore;
      reasons.push('Contains price action references');
    }

    // 5. Check for trading signal language
    const signalScore = this.detectTradingSignals(lowerText);
    if (signalScore > 0) {
      score += signalScore;
      reasons.push('Contains explicit trading signals');
    }

    // 6. Extract tags based on content
    const tags = this.extractTags(lowerText, tickers);

    // Normalize score to 0-100 range
    score = Math.min(Math.max(score, 0), 100);

    return {
      score,
      tickers,
      tags,
      reasons
    };
  }

  /**
   * Extract cryptocurrency tickers from text
   * Handles both $BTC style and plain BTC mentions
   */
  private extractTickers(text: string): string[] {
    // Look for tickers with $ prefix
    const withDollarSign = text.match(/\$([A-Z]{2,5})\b/g) || [];
    const dollarTickers = withDollarSign.map(t => t.substring(1));
    
    // Look for standalone tickers (without $ prefix)
    const words = text.match(/\b[A-Z]{2,5}\b/g) || [];
    const standaloneTickers = words.filter(word => 
      this.cryptoTickers.has(word) && !dollarTickers.includes(word)
    );
    
    // Combine and deduplicate
    return [...new Set([...dollarTickers, ...standaloneTickers])];
  }

  /**
   * Find mentions of crypto exchanges in text
   */
  private findExchangeMentions(text: string): string[] {
    return Array.from(this.exchanges).filter(exchange => 
      text.includes(exchange)
    );
  }

  /**
   * Detect urgency language in message
   * Returns a score boost based on urgency level
   */
  private detectUrgency(text: string): number {
    const highUrgencyPhrases = [
      'breaking', 'alert', 'urgent', 'right now', 'asap', 'immediately',
      'emergency', 'just announced', 'just in', 'happening now'
    ];
    
    const mediumUrgencyPhrases = [
      'soon', 'today', 'tomorrow', 'this week', 'don\'t miss',
      'just happened', 'about to', 'forming', 'developing'
    ];
    
    let urgencyScore = 0;
    
    // Check for high urgency phrases
    for (const phrase of highUrgencyPhrases) {
      if (text.includes(phrase)) {
        urgencyScore += 15;
        break; // Only count once
      }
    }
    
    // Check for medium urgency phrases
    for (const phrase of mediumUrgencyPhrases) {
      if (text.includes(phrase)) {
        urgencyScore += 10;
        break; // Only count once
      }
    }
    
    return urgencyScore;
  }

  /**
   * Detect price action language
   * References to price movements, percentages, etc.
   */
  private detectPriceAction(text: string): number {
    const pricePatterns = [
      /\d+%/,                  // Percentage
      /\$\d+/,                 // Dollar amount
      /\b(up|down)\b/,         // Up/down
      /\b(buy|sell)\b/,        // Buy/sell
      /\b(support|resistance)/, // Technical levels
      /\b(pump|dump)\b/,       // Pump/dump
      /\bbreakout\b/,          // Breakouts
      /\b(bullish|bearish)\b/  // Market sentiment
    ];
    
    let priceScore = 0;
    
    // Check for each price pattern
    for (const pattern of pricePatterns) {
      if (pattern.test(text)) {
        priceScore += 5;
      }
    }
    
    return Math.min(priceScore, 25); // Cap at 25 points
  }

  /**
   * Detect explicit trading signals
   */
  private detectTradingSignals(text: string): number {
    const signalPhrases = [
      'buy signal', 'sell signal', 'long', 'short', 'entry', 'exit',
      'take profit', 'stop loss', 'target', 'position', 'trade idea',
      'setup', 'chart pattern', 'support level', 'resistance level',
      'breakout', 'breakdown', 'reversal', 'trend change'
    ];
    
    let signalScore = 0;
    
    for (const phrase of signalPhrases) {
      if (text.includes(phrase)) {
        signalScore += 10;
        break; // Only count once
      }
    }
    
    // Extra points for detailed signals
    if (/\bentry\s*:|\btarget\s*:|\bstop\s*:/.test(text)) {
      signalScore += 15;
    }
    
    return signalScore;
  }

  /**
   * Extract relevant tags from text content
   */
  private extractTags(text: string, tickers: string[]): string[] {
    const tags: string[] = [];
    
    // Common crypto tags to look for
    const tagMappings: Record<string, string[]> = {
      'whale': ['whale', 'large transaction', 'big buy', 'big sell', 'moved'],
      'airdrop': ['airdrop', 'free tokens', 'claim', 'snapshot'],
      'defi': ['defi', 'yield', 'farm', 'staking', 'liquidity', 'pool'],
      'nft': ['nft', 'mint', 'collection', 'floor price'],
      'regulation': ['sec', 'regulation', 'compliance', 'law', 'ban', 'legal'],
      'fork': ['fork', 'upgrade', 'update', 'hard fork', 'soft fork'],
      'ico': ['ico', 'token sale', 'presale', 'launch', 'listing'],
      'metaverse': ['metaverse', 'virtual land', 'virtual world', 'vr'],
      'gaming': ['game', 'p2e', 'play to earn', 'gaming'],
      'layer2': ['layer 2', 'l2', 'scaling', 'rollup', 'polygon', 'optimism', 'arbitrum'],
      'hack': ['hack', 'exploit', 'security', 'breach', 'stolen', 'attack'],
      'adoption': ['adoption', 'partnership', 'enterprise', 'mainstream', 'institution'],
      'technical': ['support', 'resistance', 'chart', 'pattern', 'rsi', 'macd', 'fibonacci'],
      'fundamental': ['news', 'announcement', 'release', 'update', 'roadmap']
    };
    
    // Add ticker names as tags
    tickers.forEach(ticker => tags.push(ticker.toLowerCase()));
    
    // Check for each tag category
    Object.entries(tagMappings).forEach(([tag, keywords]) => {
      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          tags.push(tag);
          break; // Only add this tag once
        }
      }
    });
    
    // Add sentiment-related tags
    if (/\b(bullish|moon|pump|up|gain|profit)\b/.test(text)) {
      tags.push('bullish');
    }
    if (/\b(bearish|crash|dump|down|loss|sell)\b/.test(text)) {
      tags.push('bearish');
    }
    
    return [...new Set(tags)]; // Deduplicate
  }
} 