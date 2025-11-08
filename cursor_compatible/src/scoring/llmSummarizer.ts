/**
 * LLM Summarizer
 * Creates concise summaries of social media content using an LLM
 */
export class LLMSummarizer {
  private apiEndpoint: string;
  private apiKey: string;
  private model: string;
  private maxTokens: number;
  private temperature: number;
  
  constructor(config: {
    apiEndpoint?: string;
    apiKey: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
  }) {
    this.apiEndpoint = config.apiEndpoint || 'https://api.openai.com/v1/chat/completions';
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-3.5-turbo';
    this.maxTokens = config.maxTokens || 50;
    this.temperature = config.temperature || 0.3;
  }
  
  /**
   * Generate a concise summary of the social media content
   * @param text The content to summarize
   * @returns A concise summary
   */
  public async summarize(text: string): Promise<string> {
    // Don't summarize short content
    if (text.length < 100) {
      return text;
    }
    
    try {
      const payload = {
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are a financial analyst specialized in summarizing crypto social media content. Create very concise summaries (max 15 words) that capture key trading signals, market sentiment, and actionable insights. Focus on tickers, price movements, and trade setup info.'
          },
          {
            role: 'user',
            content: `Summarize this crypto social media post in 15 words or less:\n\n${text}`
          }
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature
      };
      
      // In a real implementation, this would make an actual API call
      // For demonstration purposes, we'll use a mock implementation
      return await this.mockLLMSummary(text);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to generate summary: ${errorMessage}`);
    }
  }
  
  /**
   * Mock LLM summary generation for demonstration
   * In a real implementation, this would call an actual LLM API
   */
  private async mockLLMSummary(text: string): Promise<string> {
    // Simple extractive summarization
    // Get first sentence and truncate to max 15 words
    let firstSentence = text.split(/[.!?]/)[0].trim();
    const words = firstSentence.split(/\s+/);
    
    if (words.length > 15) {
      firstSentence = words.slice(0, 15).join(' ') + '...';
    }
    
    // Extract any tickers
    const tickerPattern = /\$([A-Z]+)/g;
    const tickers: string[] = [];
    let match;
    
    while ((match = tickerPattern.exec(text)) !== null) {
      tickers.push(match[1]);
    }
    
    // Check for keywords to add context
    const keywords = {
      bullish: ['bullish', 'buy', 'long', 'moon', 'pump', 'breakout', 'support'],
      bearish: ['bearish', 'sell', 'short', 'dump', 'crash', 'breakdown', 'resistance']
    };
    
    let sentiment = '';
    for (const keyword of keywords.bullish) {
      if (text.toLowerCase().includes(keyword)) {
        sentiment = 'Bullish';
        break;
      }
    }
    
    if (!sentiment) {
      for (const keyword of keywords.bearish) {
        if (text.toLowerCase().includes(keyword)) {
          sentiment = 'Bearish';
          break;
        }
      }
    }
    
    // If we found tickers and sentiment, create a more structured summary
    if (tickers.length > 0 && sentiment) {
      return `${sentiment} on ${tickers.join(', ')}: ${firstSentence}`;
    }
    
    return firstSentence;
  }
} 