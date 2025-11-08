import EventEmitter from 'events';
import { Logger } from 'winston';
import * as tf from '@tensorflow/tfjs';
import {
  SentimentData,
  SentimentAggregate,
  IntelAlert,
  IntelError,
  IntelErrorCode,
  DataSource
} from './types';

export class SentimentEngine extends EventEmitter {
  private sentimentBuffer: Map<string, SentimentData[]>;
  private aggregatedSentiment: Map<string, SentimentAggregate>;
  private sentimentModels: Map<string, tf.LayersModel>;
  private dataSources: Map<string, DataSource>;
  private vocabularyIndex: Map<string, number>;
  private entityRecognizer: EntityRecognizer;
  private topicModeler: TopicModeler;
  private influenceScorer: InfluenceScorer;
  private isRunning: boolean = false;
  private updateInterval: NodeJS.Timeout | null = null;
  private streamIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private logger: Logger,
    private config: {
      sources: string[];
      languages: string[];
      mlModelVersion: string;
      updateInterval: number;
      sentimentWindow: number;
      minConfidence: number;
      alertThresholds: {
        sentiment: number;
        momentum: number;
        controversy: number;
      };
    }
  ) {
    super();
    this.sentimentBuffer = new Map();
    this.aggregatedSentiment = new Map();
    this.sentimentModels = new Map();
    this.dataSources = new Map();
    this.vocabularyIndex = new Map();
    this.entityRecognizer = new EntityRecognizer();
    this.topicModeler = new TopicModeler();
    this.influenceScorer = new InfluenceScorer();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new IntelError(
        IntelErrorCode.INVALID_CONFIG,
        'SentimentEngine is already running'
      );
    }

    this.logger.info('Starting Sentiment Engine', {
      sources: this.config.sources,
      languages: this.config.languages
    });

    try {
      await this.loadModels();
      await this.initializeDataSources();
      await this.startDataStreams();
      this.startAnalysisLoop();
      this.isRunning = true;
    } catch (error) {
      this.logger.error('Failed to start Sentiment Engine', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.logger.info('Stopping Sentiment Engine');
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    // Stop all stream intervals
    for (const [source, interval] of this.streamIntervals) {
      clearInterval(interval);
    }
    this.streamIntervals.clear();

    await this.stopDataStreams();
    this.isRunning = false;
  }

  private async loadModels(): Promise<void> {
    // Load pre-trained sentiment models for each language
    for (const language of this.config.languages) {
      try {
        // In production, load actual TensorFlow models
        const model = await this.createSentimentModel(language);
        this.sentimentModels.set(language, model);
        
        // Load vocabulary for the language
        await this.loadVocabulary(language);
      } catch (error) {
        this.logger.error(`Failed to load model for ${language}`, error);
      }
    }
  }

  private async createSentimentModel(language: string): Promise<tf.LayersModel> {
    // Create a simple LSTM model for sentiment analysis
    const model = tf.sequential({
      layers: [
        tf.layers.embedding({
          inputDim: 10000, // Vocabulary size
          outputDim: 128,
          inputLength: 100 // Max sequence length
        }),
        tf.layers.lstm({
          units: 64,
          returnSequences: false,
          dropout: 0.5
        }),
        tf.layers.dense({
          units: 32,
          activation: 'relu'
        }),
        tf.layers.dropout({ rate: 0.5 }),
        tf.layers.dense({
          units: 1,
          activation: 'tanh' // Output between -1 and 1
        })
      ]
    });

    model.compile({
      optimizer: 'adam',
      loss: 'meanSquaredError',
      metrics: ['accuracy']
    });

    return model;
  }

  private async loadVocabulary(language: string): Promise<void> {
    // Load vocabulary index for text tokenization
    // In production, load from pre-trained word embeddings
    const commonWords = [
      'bullish', 'bearish', 'moon', 'dump', 'pump', 'buy', 'sell',
      'long', 'short', 'resistance', 'support', 'breakout', 'breakdown',
      'accumulation', 'distribution', 'whale', 'retail', 'institutional'
    ];

    commonWords.forEach((word, index) => {
      this.vocabularyIndex.set(word.toLowerCase(), index + 1);
    });
  }

  private async initializeDataSources(): Promise<void> {
    for (const source of this.config.sources) {
      const dataSource: DataSource = {
        name: source,
        type: this.getSourceType(source),
        endpoint: this.getSourceEndpoint(source),
        status: 'inactive',
        lastUpdate: 0,
        reliability: 1.0,
        rateLimit: this.getSourceRateLimit(source)
      };
      
      this.dataSources.set(source, dataSource);
    }
  }

  private getSourceType(source: string): 'websocket' | 'rest' | 'graphql' | 'grpc' {
    const types: Record<string, any> = {
      twitter: 'rest',
      reddit: 'rest',
      telegram: 'websocket',
      discord: 'websocket',
      news: 'rest',
      analyst: 'rest'
    };
    
    return types[source] || 'rest';
  }

  private getSourceEndpoint(source: string): string {
    const endpoints: Record<string, string> = {
      twitter: 'https://api.twitter.com/2/tweets/search/stream',
      reddit: 'https://api.reddit.com/r/cryptocurrency/new.json',
      telegram: 'wss://telegram-api.example.com/ws',
      discord: 'wss://discord.com/api/gateway',
      news: 'https://newsapi.org/v2/everything',
      analyst: 'https://seekingalpha.com/api/v3/symbols'
    };
    
    return endpoints[source] || '';
  }

  private getSourceRateLimit(source: string): { requests: number; period: number } {
    const limits: Record<string, any> = {
      twitter: { requests: 300, period: 900000 }, // 300 per 15 min
      reddit: { requests: 60, period: 60000 }, // 60 per minute
      telegram: { requests: 1000, period: 60000 },
      discord: { requests: 1000, period: 60000 },
      news: { requests: 100, period: 3600000 }, // 100 per hour
      analyst: { requests: 100, period: 60000 }
    };
    
    return limits[source] || { requests: 60, period: 60000 };
  }

  private async startDataStreams(): Promise<void> {
    for (const [source, dataSource] of this.dataSources) {
      try {
        await this.connectToSource(source, dataSource);
        dataSource.status = 'active';
      } catch (error) {
        this.logger.error(`Failed to connect to ${source}`, error);
        dataSource.status = 'error';
      }
    }
  }

  private async connectToSource(source: string, dataSource: DataSource): Promise<void> {
    this.logger.info(`Connecting to ${source} sentiment stream`);
    
    // Set up polling or streaming based on source type
    if (dataSource.type === 'websocket') {
      // For WebSocket sources, maintain persistent connection
      this.setupWebSocketHandler(source);
    } else {
      // For REST sources, set up polling
      this.setupPollingHandler(source, dataSource);
    }
  }

  private setupWebSocketHandler(source: string): void {
    // Simulate WebSocket stream
    const interval = setInterval(() => {
      const mockData = this.generateMockSentimentData(source);
      this.processSentimentData(mockData);
    }, 1000);
    
    this.streamIntervals.set(source, interval);
  }

  private setupPollingHandler(source: string, dataSource: DataSource): void {
    // Calculate polling interval based on rate limit
    const interval = dataSource.rateLimit!.period / dataSource.rateLimit!.requests;
    
    const pollInterval = setInterval(async () => {
      try {
        // Simulate API call
        const mockData = this.generateMockSentimentData(source);
        this.processSentimentData(mockData);
      } catch (error) {
        this.logger.error(`Error polling ${source}`, error);
      }
    }, interval);
    
    this.streamIntervals.set(source, pollInterval);
  }

  private generateMockSentimentData(source: string): SentimentData {
    const assets = ['BTC', 'ETH', 'SOL', 'MATIC', 'LINK'];
    const sentiments = [
      { text: 'BTC looking extremely bullish, breaking all resistance levels', score: 0.8 },
      { text: 'ETH gas fees are killing retail, bearish outlook', score: -0.6 },
      { text: 'Massive accumulation happening in SOL, whales are buying', score: 0.7 },
      { text: 'Market crash incoming, sell everything', score: -0.9 },
      { text: 'Neutral on MATIC, waiting for clear direction', score: 0.1 }
    ];
    
    const sentiment = sentiments[Math.floor(Math.random() * sentiments.length)];
    const asset = assets[Math.floor(Math.random() * assets.length)];
    
    return {
      source: source as any,
      timestamp: Date.now(),
      content: sentiment.text,
      asset,
      sentimentScore: sentiment.score,
      confidence: 0.7 + Math.random() * 0.3,
      reach: Math.floor(Math.random() * 10000),
      engagement: Math.floor(Math.random() * 1000),
      influence: Math.random(),
      topics: this.extractTopics(sentiment.text),
      entities: [asset]
    };
  }

  private extractTopics(text: string): string[] {
    const topics = [];
    
    if (text.toLowerCase().includes('bull')) topics.push('bullish');
    if (text.toLowerCase().includes('bear')) topics.push('bearish');
    if (text.toLowerCase().includes('whale')) topics.push('whale-activity');
    if (text.toLowerCase().includes('accumul')) topics.push('accumulation');
    if (text.toLowerCase().includes('crash')) topics.push('market-crash');
    if (text.toLowerCase().includes('resistance')) topics.push('technical-analysis');
    
    return topics;
  }

  private async processSentimentData(data: SentimentData): void {
    // Validate confidence threshold
    if (data.confidence < this.config.minConfidence) return;
    
    // Process through ML model if needed
    if (!data.sentimentScore) {
      data.sentimentScore = await this.analyzeSentiment(data.content);
    }
    
    // Extract entities if not provided
    if (data.entities.length === 0) {
      data.entities = await this.entityRecognizer.extract(data.content);
    }
    
    // Calculate influence score
    data.influence = this.influenceScorer.calculate(data);
    
    // Add to buffer
    const key = data.asset || 'MARKET';
    if (!this.sentimentBuffer.has(key)) {
      this.sentimentBuffer.set(key, []);
    }
    
    const buffer = this.sentimentBuffer.get(key)!;
    buffer.push(data);
    
    // Keep buffer size manageable
    const cutoff = Date.now() - this.config.sentimentWindow;
    const filtered = buffer.filter(s => s.timestamp > cutoff);
    this.sentimentBuffer.set(key, filtered);
    
    // Check for sentiment alerts
    this.checkSentimentAlerts(data);
  }

  private async analyzeSentiment(text: string): Promise<number> {
    // Tokenize text
    const tokens = this.tokenizeText(text);
    const sequence = this.padSequence(tokens, 100);
    
    // Convert to tensor
    const input = tf.tensor2d([sequence]);
    
    // Get sentiment from model (using English model as default)
    const model = this.sentimentModels.get('en');
    if (!model) return 0;
    
    const prediction = model.predict(input) as tf.Tensor;
    const sentiment = await prediction.data();
    
    // Clean up tensors
    input.dispose();
    prediction.dispose();
    
    return sentiment[0];
  }

  private tokenizeText(text: string): number[] {
    const words = text.toLowerCase().split(/\s+/);
    const tokens: number[] = [];
    
    for (const word of words) {
      const index = this.vocabularyIndex.get(word);
      if (index) {
        tokens.push(index);
      }
    }
    
    return tokens;
  }

  private padSequence(tokens: number[], maxLength: number): number[] {
    if (tokens.length >= maxLength) {
      return tokens.slice(0, maxLength);
    }
    
    const padded = new Array(maxLength).fill(0);
    tokens.forEach((token, i) => {
      padded[i] = token;
    });
    
    return padded;
  }

  private checkSentimentAlerts(data: SentimentData): void {
    if (!data.asset) return;
    
    const aggregate = this.aggregatedSentiment.get(data.asset);
    if (!aggregate) return;
    
    // Check for extreme sentiment
    if (Math.abs(aggregate.overallSentiment) > this.config.alertThresholds.sentiment) {
      this.emitSentimentAlert(data.asset, aggregate, 'extreme');
    }
    
    // Check for rapid momentum change
    if (Math.abs(aggregate.sentimentMomentum) > this.config.alertThresholds.momentum) {
      this.emitSentimentAlert(data.asset, aggregate, 'momentum');
    }
    
    // Check for high controversy
    if (aggregate.controversyScore > this.config.alertThresholds.controversy) {
      this.emitSentimentAlert(data.asset, aggregate, 'controversy');
    }
  }

  private emitSentimentAlert(
    asset: string,
    aggregate: SentimentAggregate,
    type: 'extreme' | 'momentum' | 'controversy'
  ): void {
    const titles: Record<string, string> = {
      extreme: `Extreme ${aggregate.overallSentiment > 0 ? 'Bullish' : 'Bearish'} Sentiment`,
      momentum: `Rapid Sentiment ${aggregate.sentimentMomentum > 0 ? 'Improvement' : 'Deterioration'}`,
      controversy: 'High Controversy Detected'
    };
    
    const descriptions: Record<string, string> = {
      extreme: `${asset} sentiment at ${(aggregate.overallSentiment * 100).toFixed(0)}% ${aggregate.overallSentiment > 0 ? 'bullish' : 'bearish'} across ${aggregate.sources} sources`,
      momentum: `${asset} sentiment momentum at ${(aggregate.sentimentMomentum * 100).toFixed(0)}% indicating rapid ${aggregate.sentimentMomentum > 0 ? 'improvement' : 'deterioration'}`,
      controversy: `${asset} showing high controversy score of ${(aggregate.controversyScore * 100).toFixed(0)}% indicating mixed opinions`
    };
    
    const alert: IntelAlert = {
      id: `sentiment-${type}-${Date.now()}-${asset}`,
      timestamp: Date.now(),
      type: 'sentiment',
      severity: Math.abs(aggregate.overallSentiment) > 0.8 || type === 'momentum' ? 'high' : 'medium',
      title: titles[type],
      description: descriptions[type],
      affectedAssets: [asset],
      metrics: {
        overallSentiment: aggregate.overallSentiment,
        socialSentiment: aggregate.socialSentiment,
        newsSentiment: aggregate.newsSentiment,
        sentimentMomentum: aggregate.sentimentMomentum,
        controversyScore: aggregate.controversyScore,
        dataPoints: aggregate.dataPoints
      },
      actionRequired: type === 'momentum' || Math.abs(aggregate.overallSentiment) > 0.9,
      suggestedActions: this.getSuggestedActions(type, aggregate)
    };
    
    this.emit('alert', alert);
  }

  private getSuggestedActions(type: string, aggregate: SentimentAggregate): string[] {
    const actions: string[] = [];
    
    if (type === 'extreme') {
      if (aggregate.overallSentiment > 0) {
        actions.push('Consider taking profits on extreme bullish sentiment');
        actions.push('Monitor for potential sentiment reversal');
      } else {
        actions.push('Look for contrarian buying opportunities');
        actions.push('Check for oversold technical conditions');
      }
    } else if (type === 'momentum') {
      if (aggregate.sentimentMomentum > 0) {
        actions.push('Sentiment improving rapidly - consider following momentum');
        actions.push('Look for breakout opportunities');
      } else {
        actions.push('Sentiment deteriorating - consider risk reduction');
        actions.push('Monitor support levels closely');
      }
    } else if (type === 'controversy') {
      actions.push('High controversy indicates uncertainty - reduce position size');
      actions.push('Wait for clearer sentiment consensus');
      actions.push('Monitor for resolution of controversial issues');
    }
    
    return actions;
  }

  private startAnalysisLoop(): void {
    this.updateInterval = setInterval(() => {
      this.aggregateSentiment();
      this.analyzeTopics();
      this.detectSentimentAnomalies();
      this.correlateWithPrice();
    }, this.config.updateInterval);
  }

  private aggregateSentiment(): void {
    for (const [asset, buffer] of this.sentimentBuffer) {
      if (buffer.length === 0) continue;
      
      // Calculate weighted sentiment scores
      const socialData = buffer.filter(s => ['twitter', 'reddit', 'telegram', 'discord'].includes(s.source));
      const newsData = buffer.filter(s => s.source === 'news');
      const analystData = buffer.filter(s => s.source === 'analyst');
      
      const aggregate: SentimentAggregate = {
        asset,
        timestamp: Date.now(),
        overallSentiment: this.calculateWeightedSentiment(buffer),
        socialSentiment: this.calculateWeightedSentiment(socialData),
        newsSentiment: this.calculateWeightedSentiment(newsData),
        analystSentiment: this.calculateWeightedSentiment(analystData),
        volumeWeightedSentiment: this.calculateVolumeWeightedSentiment(buffer),
        sentimentMomentum: this.calculateSentimentMomentum(asset, buffer),
        controversyScore: this.calculateControversy(buffer),
        sources: new Set(buffer.map(s => s.source)).size,
        dataPoints: buffer.length
      };
      
      this.aggregatedSentiment.set(asset, aggregate);
    }
  }

  private calculateWeightedSentiment(data: SentimentData[]): number {
    if (data.length === 0) return 0;
    
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (const sentiment of data) {
      const weight = sentiment.confidence * sentiment.influence * 
        Math.log(sentiment.reach + 1) * Math.log(sentiment.engagement + 1);
      
      weightedSum += sentiment.sentimentScore * weight;
      totalWeight += weight;
    }
    
    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  private calculateVolumeWeightedSentiment(data: SentimentData[]): number {
    if (data.length === 0) return 0;
    
    // Weight by engagement and reach (proxy for volume)
    let weightedSum = 0;
    let totalVolume = 0;
    
    for (const sentiment of data) {
      const volume = sentiment.reach + sentiment.engagement;
      weightedSum += sentiment.sentimentScore * volume;
      totalVolume += volume;
    }
    
    return totalVolume > 0 ? weightedSum / totalVolume : 0;
  }

  private calculateSentimentMomentum(asset: string, currentData: SentimentData[]): number {
    // Compare current sentiment to previous period
    const previousAggregate = this.aggregatedSentiment.get(asset);
    if (!previousAggregate) return 0;
    
    const currentSentiment = this.calculateWeightedSentiment(currentData);
    const previousSentiment = previousAggregate.overallSentiment;
    
    // Calculate rate of change
    const momentum = currentSentiment - previousSentiment;
    
    // Normalize to [-1, 1]
    return Math.tanh(momentum * 10);
  }

  private calculateControversy(data: SentimentData[]): number {
    if (data.length < 2) return 0;
    
    // Calculate standard deviation of sentiment scores
    const scores = data.map(d => d.sentimentScore);
    const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);
    
    // High std dev with mean near 0 indicates controversy
    const controversyScore = stdDev * (1 - Math.abs(mean));
    
    return Math.min(controversyScore, 1);
  }

  private analyzeTopics(): void {
    // Analyze trending topics across all sentiment data
    const topicCounts = new Map<string, number>();
    const topicSentiments = new Map<string, number[]>();
    
    for (const [asset, buffer] of this.sentimentBuffer) {
      for (const data of buffer) {
        for (const topic of data.topics) {
          topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
          
          if (!topicSentiments.has(topic)) {
            topicSentiments.set(topic, []);
          }
          topicSentiments.get(topic)!.push(data.sentimentScore);
        }
      }
    }
    
    // Find trending topics
    const trendingTopics = Array.from(topicCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    // Analyze sentiment by topic
    for (const [topic, count] of trendingTopics) {
      const sentiments = topicSentiments.get(topic) || [];
      const avgSentiment = sentiments.reduce((sum, s) => sum + s, 0) / sentiments.length;
      
      if (count > 50 && Math.abs(avgSentiment) > 0.7) {
        this.emitTopicAlert(topic, count, avgSentiment);
      }
    }
  }

  private emitTopicAlert(topic: string, count: number, sentiment: number): void {
    const alert: IntelAlert = {
      id: `topic-${Date.now()}-${topic}`,
      timestamp: Date.now(),
      type: 'sentiment',
      severity: 'medium',
      title: `Trending Topic: ${topic}`,
      description: `"${topic}" mentioned ${count} times with ${(sentiment * 100).toFixed(0)}% ${sentiment > 0 ? 'positive' : 'negative'} sentiment`,
      affectedAssets: [], // Would need to correlate with assets
      metrics: {
        topic,
        mentions: count,
        sentiment
      },
      actionRequired: false,
      suggestedActions: [
        `Monitor assets related to "${topic}"`,
        'Check for fundamental developments',
        'Consider sentiment-based positioning'
      ]
    };
    
    this.emit('alert', alert);
  }

  private detectSentimentAnomalies(): void {
    for (const [asset, aggregate] of this.aggregatedSentiment) {
      const buffer = this.sentimentBuffer.get(asset) || [];
      
      // Detect unusual sentiment spikes
      const spike = this.detectSentimentSpike(buffer);
      if (spike.detected) {
        this.emitAnomalyAlert(asset, spike, 'spike');
      }
      
      // Detect sentiment divergence between sources
      const divergence = this.detectSourceDivergence(aggregate);
      if (divergence.detected) {
        this.emitAnomalyAlert(asset, divergence, 'divergence');
      }
      
      // Detect bot activity
      const botActivity = this.detectBotActivity(buffer);
      if (botActivity.detected) {
        this.emitAnomalyAlert(asset, botActivity, 'bot');
      }
    }
  }

  private detectSentimentSpike(data: SentimentData[]): AnomalyResult {
    if (data.length < 10) {
      return { detected: false, confidence: 0, evidence: '', severity: 'low' };
    }
    
    // Look for sudden increase in sentiment volume
    const recentCount = data.filter(d => d.timestamp > Date.now() - 300000).length; // Last 5 min
    const avgCount = data.length / (this.config.sentimentWindow / 300000);
    
    const spikeRatio = recentCount / avgCount;
    
    return {
      detected: spikeRatio > 3,
      confidence: Math.min(spikeRatio / 5, 1),
      evidence: `${recentCount} mentions in last 5 minutes vs ${avgCount.toFixed(0)} average`,
      severity: spikeRatio > 5 ? 'high' : 'medium'
    };
  }

  private detectSourceDivergence(aggregate: SentimentAggregate): AnomalyResult {
    // Check if different sources have conflicting sentiment
    const sentiments = [
      aggregate.socialSentiment,
      aggregate.newsSentiment,
      aggregate.analystSentiment
    ].filter(s => s !== 0);
    
    if (sentiments.length < 2) {
      return { detected: false, confidence: 0, evidence: '', severity: 'low' };
    }
    
    // Check for opposite signs
    const hasPositive = sentiments.some(s => s > 0.3);
    const hasNegative = sentiments.some(s => s < -0.3);
    
    const divergence = hasPositive && hasNegative;
    const maxDiff = Math.max(...sentiments) - Math.min(...sentiments);
    
    return {
      detected: divergence,
      confidence: maxDiff / 2,
      evidence: `Social: ${(aggregate.socialSentiment * 100).toFixed(0)}%, News: ${(aggregate.newsSentiment * 100).toFixed(0)}%, Analyst: ${(aggregate.analystSentiment * 100).toFixed(0)}%`,
      severity: maxDiff > 1.5 ? 'high' : 'medium'
    };
  }

  private detectBotActivity(data: SentimentData[]): AnomalyResult {
    // Look for patterns indicating bot activity
    const recentData = data.filter(d => d.timestamp > Date.now() - 600000); // Last 10 min
    
    if (recentData.length < 20) {
      return { detected: false, confidence: 0, evidence: '', severity: 'low' };
    }
    
    // Check for repetitive content
    const contentMap = new Map<string, number>();
    for (const sentiment of recentData) {
      const normalized = sentiment.content.toLowerCase().replace(/[^a-z0-9]/g, '');
      contentMap.set(normalized, (contentMap.get(normalized) || 0) + 1);
    }
    
    const duplicates = Array.from(contentMap.values()).filter(count => count > 2).length;
    const duplicateRatio = duplicates / recentData.length;
    
    // Check for uniform sentiment scores
    const sentimentScores = recentData.map(d => d.sentimentScore);
    const uniqueScores = new Set(sentimentScores).size;
    const uniformityRatio = 1 - (uniqueScores / recentData.length);
    
    const botScore = (duplicateRatio + uniformityRatio) / 2;
    
    return {
      detected: botScore > 0.3,
      confidence: botScore,
      evidence: `${duplicates} duplicate messages, ${(uniformityRatio * 100).toFixed(0)}% sentiment uniformity`,
      severity: botScore > 0.6 ? 'high' : 'medium'
    };
  }

  private emitAnomalyAlert(
    asset: string,
    anomaly: AnomalyResult,
    type: 'spike' | 'divergence' | 'bot'
  ): void {
    const titles: Record<string, string> = {
      spike: 'Sentiment Volume Spike',
      divergence: 'Source Sentiment Divergence',
      bot: 'Potential Bot Activity Detected'
    };
    
    const alert: IntelAlert = {
      id: `sentiment-anomaly-${type}-${Date.now()}-${asset}`,
      timestamp: Date.now(),
      type: 'anomaly',
      severity: anomaly.severity as any,
      title: titles[type],
      description: `${asset}: ${anomaly.evidence}`,
      affectedAssets: [asset],
      metrics: {
        type,
        confidence: anomaly.confidence,
        evidence: anomaly.evidence
      },
      actionRequired: anomaly.severity === 'high',
      suggestedActions: this.getAnomalyActions(type, anomaly)
    };
    
    this.emit('alert', alert);
  }

  private getAnomalyActions(type: string, anomaly: AnomalyResult): string[] {
    const actions: Record<string, string[]> = {
      spike: [
        'Check for news catalyst driving sentiment',
        'Monitor for potential pump/dump activity',
        'Consider waiting for sentiment to normalize'
      ],
      divergence: [
        'Conflicting signals - reduce position size',
        'Wait for sentiment consensus',
        'Focus on technical indicators'
      ],
      bot: [
        'Ignore artificial sentiment signals',
        'Focus on organic high-influence sources',
        'Check alternative sentiment sources'
      ]
    };
    
    return actions[type] || [];
  }

  private correlateWithPrice(): void {
    // Correlate sentiment changes with price movements
    // This would require price data integration
    for (const [asset, aggregate] of this.aggregatedSentiment) {
      // Calculate sentiment-price correlation
      const correlation = this.calculateSentimentPriceCorrelation(asset);
      
      if (Math.abs(correlation) > 0.7) {
        this.logger.info(`Strong sentiment-price correlation for ${asset}: ${correlation.toFixed(2)}`);
      }
    }
  }

  private calculateSentimentPriceCorrelation(asset: string): number {
    // Placeholder - would need price data
    return Math.random() * 2 - 1;
  }

  private async stopDataStreams(): Promise<void> {
    for (const [source, dataSource] of this.dataSources) {
      try {
        dataSource.status = 'inactive';
        this.logger.info(`Disconnected from ${source} sentiment stream`);
      } catch (error) {
        this.logger.error(`Error disconnecting from ${source}`, error);
      }
    }
  }

  // Public methods for querying sentiment data
  
  getSentimentSummary(asset: string): SentimentSummary | null {
    const aggregate = this.aggregatedSentiment.get(asset);
    const buffer = this.sentimentBuffer.get(asset) || [];
    
    if (!aggregate) return null;
    
    const recentData = buffer.filter(d => d.timestamp > Date.now() - 3600000); // Last hour
    const topSources = this.getTopSources(recentData);
    const topInfluencers = this.getTopInfluencers(recentData);
    
    return {
      asset,
      aggregate,
      recentPosts: recentData.length,
      topSources,
      topInfluencers,
      trendingTopics: this.getTrendingTopics(recentData),
      sentimentDistribution: this.getSentimentDistribution(recentData),
      lastUpdate: Date.now()
    };
  }

  private getTopSources(data: SentimentData[]): Array<{ source: string; count: number; avgSentiment: number }> {
    const sourceMap = new Map<string, { count: number; sentiment: number }>();
    
    for (const sentiment of data) {
      const existing = sourceMap.get(sentiment.source) || { count: 0, sentiment: 0 };
      existing.count++;
      existing.sentiment += sentiment.sentimentScore;
      sourceMap.set(sentiment.source, existing);
    }
    
    return Array.from(sourceMap.entries())
      .map(([source, stats]) => ({
        source,
        count: stats.count,
        avgSentiment: stats.sentiment / stats.count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  private getTopInfluencers(data: SentimentData[]): Array<{ content: string; influence: number; sentiment: number }> {
    return data
      .sort((a, b) => b.influence - a.influence)
      .slice(0, 5)
      .map(d => ({
        content: d.content.substring(0, 100) + '...',
        influence: d.influence,
        sentiment: d.sentimentScore
      }));
  }

  private getTrendingTopics(data: SentimentData[]): string[] {
    const topicCounts = new Map<string, number>();
    
    for (const sentiment of data) {
      for (const topic of sentiment.topics) {
        topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
      }
    }
    
    return Array.from(topicCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic]) => topic);
  }

  private getSentimentDistribution(data: SentimentData[]): SentimentDistribution {
    const distribution = {
      veryBullish: 0,
      bullish: 0,
      neutral: 0,
      bearish: 0,
      veryBearish: 0
    };
    
    for (const sentiment of data) {
      if (sentiment.sentimentScore > 0.6) distribution.veryBullish++;
      else if (sentiment.sentimentScore > 0.2) distribution.bullish++;
      else if (sentiment.sentimentScore > -0.2) distribution.neutral++;
      else if (sentiment.sentimentScore > -0.6) distribution.bearish++;
      else distribution.veryBearish++;
    }
    
    return distribution;
  }

  getMultiAssetSentiment(): Map<string, SentimentAggregate> {
    return new Map(this.aggregatedSentiment);
  }

  getSentimentHistory(asset: string, hours: number = 24): SentimentData[] {
    const buffer = this.sentimentBuffer.get(asset) || [];
    const cutoff = Date.now() - hours * 3600000;
    
    return buffer
      .filter(s => s.timestamp > cutoff)
      .sort((a, b) => b.timestamp - a.timestamp);
  }
}

// Supporting classes

class EntityRecognizer {
  private patterns: Map<string, RegExp>;

  constructor() {
    this.patterns = new Map([
      ['BTC', /\b(bitcoin|btc|₿)\b/gi],
      ['ETH', /\b(ethereum|eth|ether)\b/gi],
      ['SOL', /\b(solana|sol)\b/gi],
      ['MATIC', /\b(polygon|matic)\b/gi],
      ['LINK', /\b(chainlink|link)\b/gi]
    ]);
  }

  async extract(text: string): Promise<string[]> {
    const entities: string[] = [];
    
    for (const [entity, pattern] of this.patterns) {
      if (pattern.test(text)) {
        entities.push(entity);
      }
    }
    
    return entities;
  }
}

class TopicModeler {
  private topics: Map<string, string[]>;

  constructor() {
    this.topics = new Map([
      ['technical-analysis', ['support', 'resistance', 'breakout', 'breakdown', 'pattern']],
      ['whale-activity', ['whale', 'accumulation', 'distribution', 'large order']],
      ['market-sentiment', ['bullish', 'bearish', 'fear', 'greed', 'euphoria']],
      ['regulatory', ['sec', 'regulation', 'government', 'ban', 'approval']],
      ['adoption', ['institutional', 'adoption', 'integration', 'partnership']]
    ]);
  }

  identify(text: string): string[] {
    const identified: string[] = [];
    const lowerText = text.toLowerCase();
    
    for (const [topic, keywords] of this.topics) {
      if (keywords.some(keyword => lowerText.includes(keyword))) {
        identified.push(topic);
      }
    }
    
    return identified;
  }
}

class InfluenceScorer {
  calculate(data: SentimentData): number {
    // Calculate influence based on reach, engagement, and source credibility
    const reachScore = Math.log10(data.reach + 1) / 6; // Normalize to 0-1
    const engagementScore = Math.log10(data.engagement + 1) / 4;
    
    const sourceCredibility: Record<string, number> = {
      analyst: 0.9,
      news: 0.8,
      twitter: 0.6,
      reddit: 0.5,
      telegram: 0.4,
      discord: 0.4
    };
    
    const credibilityScore = sourceCredibility[data.source] || 0.5;
    
    // Weighted combination
    const influence = (reachScore * 0.4 + engagementScore * 0.3 + credibilityScore * 0.3) * data.confidence;
    
    return Math.min(influence, 1);
  }
}

// Type definitions for internal use

interface SentimentSummary {
  asset: string;
  aggregate: SentimentAggregate;
  recentPosts: number;
  topSources: Array<{ source: string; count: number; avgSentiment: number }>;
  topInfluencers: Array<{ content: string; influence: number; sentiment: number }>;
  trendingTopics: string[];
  sentimentDistribution: SentimentDistribution;
  lastUpdate: number;
}

interface SentimentDistribution {
  veryBullish: number;
  bullish: number;
  neutral: number;
  bearish: number;
  veryBearish: number;
}

interface AnomalyResult {
  detected: boolean;
  confidence: number;
  evidence: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
} 