import { SentimentResult } from './types.js';

/**
 * Sentiment analyzer for financial/crypto social media content
 * Uses either FinBERT or a fine-tuned LLM to assess sentiment
 */
export class SentimentAnalyzer {
  private model: 'finbert' | 'llm';
  private modelEndpoint: string;
  private apiKey?: string;

  constructor(config: {
    model?: 'finbert' | 'llm';
    modelEndpoint?: string;
    apiKey?: string;
  } = {}) {
    this.model = config.model || 'finbert';
    this.modelEndpoint = config.modelEndpoint || 'https://api.huggingface.co/models/ProsusAI/finbert';
    this.apiKey = config.apiKey;
  }

  /**
   * Preprocess text for sentiment analysis
   * - Convert to lowercase
   * - Remove emojis, excess whitespace
   * - Normalize crypto slang
   */
  private preprocessText(text: string): string {
    // Convert to lowercase
    let processed = text.toLowerCase();
    
    // Remove emojis
    processed = processed.replace(/[\u{1F600}-\u{1F64F}|\u{1F300}-\u{1F5FF}|\u{1F680}-\u{1F6FF}|\u{1F700}-\u{1F77F}|\u{1F780}-\u{1F7FF}|\u{1F800}-\u{1F8FF}|\u{1F900}-\u{1F9FF}|\u{1FA00}-\u{1FA6F}|\u{1FA70}-\u{1FAFF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}]/gu, '');
    
    // Normalize whitespace
    processed = processed.replace(/\s+/g, ' ').trim();
    
    // Normalize crypto slang
    const slangMap: Record<string, string> = {
      'hodl': 'hold',
      'rekt': 'wrecked',
      'fud': 'fear uncertainty doubt',
      'fomo': 'fear of missing out',
      'dyor': 'do your own research',
      'btfd': 'buy the dip',
      'ngmi': 'not going to make it',
      'wagmi': 'we are going to make it',
      'gm': 'good morning',
      'ath': 'all time high',
      'atl': 'all time low',
      'lfg': 'lets go',
      'moon': 'price increase significantly',
      'ser': 'sir',
      'degen': 'degenerate',
      'rugged': 'scammed',
      'safu': 'safe',
      'bags': 'holdings',
      'aped': 'invested heavily',
      'gwei': 'gas price'
    };
    
    Object.entries(slangMap).forEach(([slang, replacement]) => {
      const regex = new RegExp(`\\b${slang}\\b`, 'gi');
      processed = processed.replace(regex, replacement);
    });
    
    return processed;
  }

  /**
   * Analyze sentiment of a text using the configured model
   */
  public async analyzeSentiment(text: string): Promise<SentimentResult> {
    const processedText = this.preprocessText(text);
    
    if (this.model === 'finbert') {
      return await this.getFinBERTSentiment(processedText);
    } else {
      return await this.getLLMSentiment(processedText);
    }
  }

  /**
   * Get sentiment using FinBERT model from HuggingFace
   */
  private async getFinBERTSentiment(text: string): Promise<SentimentResult> {
    try {
      // In a production environment, this would make an actual API call to HuggingFace
      // For demonstration, we'll simulate the response
      
      // TODO: Replace with actual API call
      const mockResponse = this.mockFinBERTResponse(text);
      
      // Map to standardized output
      const label = mockResponse[0].label as 'positive' | 'negative' | 'neutral';
      const score = this.mapSentimentToScore(label, mockResponse[0].score);
      
      return {
        score,
        label,
        confidence: mockResponse[0].score
      };
    } catch (error) {
      console.error('Error analyzing sentiment with FinBERT:', error);
      return {
        score: 0,
        label: 'neutral',
        confidence: 0.5
      };
    }
  }

  /**
   * Mock FinBERT response for demonstration
   * In production, this would be replaced with an actual API call
   */
  private mockFinBERTResponse(text: string): Array<{label: string, score: number}> {
    // Simple rules to simulate FinBERT response based on keywords
    const positiveKeywords = [
      'bullish', 'moon', 'pump', 'up', 'gain', 'profit', 'buy', 'long', 'good', 'great',
      'undervalued', 'strong', 'support', 'breakout', 'accumulate', 'hodl', 'hold',
      'wagmi', 'ath', 'all time high', 'btfd', 'buy the dip', 'green'
    ];
    
    const negativeKeywords = [
      'bearish', 'crash', 'dump', 'down', 'loss', 'sell', 'short', 'bad', 'terrible',
      'overvalued', 'weak', 'breakdown', 'rekt', 'wrecked', 'fud', 'ngmi', 'atl',
      'all time low', 'rugpull', 'scam', 'red'
    ];
    
    let positiveScore = 0;
    let negativeScore = 0;
    
    positiveKeywords.forEach(keyword => {
      if (text.includes(keyword)) positiveScore += 0.15;
    });
    
    negativeKeywords.forEach(keyword => {
      if (text.includes(keyword)) negativeScore += 0.15;
    });
    
    positiveScore = Math.min(positiveScore, 0.95);
    negativeScore = Math.min(negativeScore, 0.95);
    
    if (positiveScore > negativeScore && positiveScore > 0.3) {
      return [{ label: 'positive', score: positiveScore }];
    } else if (negativeScore > positiveScore && negativeScore > 0.3) {
      return [{ label: 'negative', score: negativeScore }];
    } else {
      return [{ label: 'neutral', score: 0.7 }];
    }
  }

  /**
   * Get sentiment using LLM (for more context-aware analysis)
   */
  private async getLLMSentiment(text: string): Promise<SentimentResult> {
    try {
      // In production, this would call an LLM API
      // For demonstration, we'll simulate the response
      
      // TODO: Replace with actual LLM API call
      const mockResponse = this.mockLLMResponse(text);
      
      return {
        score: mockResponse.score,
        label: mockResponse.label as 'positive' | 'negative' | 'neutral',
        confidence: mockResponse.confidence
      };
    } catch (error) {
      console.error('Error analyzing sentiment with LLM:', error);
      return {
        score: 0,
        label: 'neutral',
        confidence: 0.5
      };
    }
  }

  /**
   * Mock LLM response for demonstration
   * In production, this would be replaced with an actual API call
   */
  private mockLLMResponse(text: string): {score: number, label: string, confidence: number} {
    // Similar to FinBERT mock but with more context analysis
    const bullishContext = [
      'just bought', 'accumulating', 'going higher', 'undervalued',
      'strong support', 'breakout', 'bullish pattern', 'uptrend',
      'reversal', 'double bottom', 'higher lows', 'higher highs',
      'golden cross', 'higher prices', 'going to moon'
    ];
    
    const bearishContext = [
      'just sold', 'dumping', 'going lower', 'overvalued',
      'weak support', 'breakdown', 'bearish pattern', 'downtrend',
      'head and shoulders', 'lower highs', 'lower lows', 'death cross',
      'sell signal', 'losing support', 'critical level'
    ];
    
    let bullishScore = 0;
    let bearishScore = 0;
    
    bullishContext.forEach(phrase => {
      if (text.includes(phrase)) bullishScore += 0.15;
    });
    
    bearishContext.forEach(phrase => {
      if (text.includes(phrase)) bearishScore += 0.15;
    });
    
    bullishScore = Math.min(bullishScore, 0.9);
    bearishScore = Math.min(bearishScore, 0.9);
    
    if (bullishScore > bearishScore && bullishScore > 0.2) {
      return {
        score: this.mapSentimentToScore('positive', bullishScore),
        label: 'positive',
        confidence: bullishScore
      };
    } else if (bearishScore > bullishScore && bearishScore > 0.2) {
      return {
        score: this.mapSentimentToScore('negative', bearishScore),
        label: 'negative',
        confidence: bearishScore
      };
    } else {
      return {
        score: 0,
        label: 'neutral',
        confidence: 0.7
      };
    }
  }

  /**
   * Map sentiment label and confidence to a score in the range -1 to 1
   */
  private mapSentimentToScore(sentiment: 'positive' | 'negative' | 'neutral', confidence: number): number {
    switch (sentiment) {
      case 'positive':
        return confidence;  // 0 to 1
      case 'negative':
        return -confidence; // -1 to 0
      default:
        return 0;
    }
  }
} 