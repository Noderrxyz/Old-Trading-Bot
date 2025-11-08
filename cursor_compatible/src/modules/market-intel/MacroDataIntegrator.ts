import EventEmitter from 'events';
import { Logger } from 'winston';
import {
  MacroData,
  CorrelationMatrix,
  EventRisk,
  IntelAlert,
  IntelError,
  IntelErrorCode,
  DataSource
} from './types';

export class MacroDataIntegrator extends EventEmitter {
  private macroBuffer: Map<string, MacroData[]>;
  private correlationMatrices: Map<string, CorrelationMatrix>;
  private eventCalendar: EventRisk[];
  private indicatorCache: Map<string, IndicatorData>;
  private marketIndices: Map<string, MarketIndex>;
  private dataSources: Map<string, DataSource>;
  private isRunning: boolean = false;
  private updateInterval: NodeJS.Timeout | null = null;
  private dataFetchIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private logger: Logger,
    private config: {
      indicators: string[];
      regions: string[];
      updateInterval: number;
      correlationWindow: number;
      alertThresholds: {
        correlationChange: number;
        economicSurprise: number;
        volatilitySpike: number;
      };
    }
  ) {
    super();
    this.macroBuffer = new Map();
    this.correlationMatrices = new Map();
    this.eventCalendar = [];
    this.indicatorCache = new Map();
    this.marketIndices = new Map();
    this.dataSources = new Map();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new IntelError(
        IntelErrorCode.INVALID_CONFIG,
        'MacroDataIntegrator is already running'
      );
    }

    this.logger.info('Starting Macro Data Integrator', {
      indicators: this.config.indicators,
      regions: this.config.regions
    });

    try {
      await this.initializeDataSources();
      await this.startDataFeeds();
      this.loadEventCalendar();
      this.startAnalysisLoop();
      this.isRunning = true;
    } catch (error) {
      this.logger.error('Failed to start Macro Data Integrator', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.logger.info('Stopping Macro Data Integrator');
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    // Stop all data fetch intervals
    for (const [source, interval] of this.dataFetchIntervals) {
      clearInterval(interval);
    }
    this.dataFetchIntervals.clear();

    await this.stopDataFeeds();
    this.isRunning = false;
  }

  private async initializeDataSources(): Promise<void> {
    // Initialize connections to macro data providers
    const providers = [
      'federal-reserve',
      'ecb',
      'boj',
      'tradingeconomics',
      'fred',
      'bloomberg',
      'reuters'
    ];

    for (const provider of providers) {
      const dataSource: DataSource = {
        name: provider,
        type: 'rest',
        endpoint: this.getProviderEndpoint(provider),
        status: 'inactive',
        lastUpdate: 0,
        reliability: 1.0,
        credentials: this.getProviderCredentials(provider)
      };
      
      this.dataSources.set(provider, dataSource);
    }
  }

  private getProviderEndpoint(provider: string): string {
    const endpoints: Record<string, string> = {
      'federal-reserve': 'https://api.stlouisfed.org/fred/series/observations',
      'ecb': 'https://sdw-wsrest.ecb.europa.eu/service/data',
      'boj': 'https://www.stat-search.boj.or.jp/api/en/api',
      'tradingeconomics': 'https://api.tradingeconomics.com',
      'fred': 'https://api.stlouisfed.org/fred',
      'bloomberg': 'https://api.bloomberg.com/data',
      'reuters': 'https://api.reuters.com/data'
    };
    
    return endpoints[provider] || '';
  }

  private getProviderCredentials(provider: string): any {
    // In production, load from secure config
    return {
      apiKey: process.env[`${provider.toUpperCase()}_API_KEY`] || 'mock-key'
    };
  }

  private async startDataFeeds(): Promise<void> {
    // Start polling for each indicator type
    for (const indicator of this.config.indicators) {
      const interval = this.getPollingInterval(indicator);
      
      const fetchInterval = setInterval(async () => {
        try {
          await this.fetchIndicatorData(indicator);
        } catch (error) {
          this.logger.error(`Error fetching ${indicator} data`, error);
        }
      }, interval);
      
      this.dataFetchIntervals.set(indicator, fetchInterval);
    }

    // Start market indices feed
    this.startMarketIndicesFeed();
  }

  private getPollingInterval(indicator: string): number {
    // Different indicators update at different frequencies
    const intervals: Record<string, number> = {
      'interest-rates': 3600000, // 1 hour
      'inflation': 86400000, // 24 hours
      'gdp': 86400000, // 24 hours
      'unemployment': 86400000, // 24 hours
      'dxy': 60000, // 1 minute
      'vix': 60000, // 1 minute
      'commodities': 300000, // 5 minutes
      'forex': 60000 // 1 minute
    };
    
    return intervals[indicator] || 3600000;
  }

  private async fetchIndicatorData(indicator: string): Promise<void> {
    // Simulate fetching indicator data
    const data = this.generateMockIndicatorData(indicator);
    
    for (const item of data) {
      this.processMacroData(item);
    }
  }

  private generateMockIndicatorData(indicator: string): MacroData[] {
    const data: MacroData[] = [];
    
    switch (indicator) {
      case 'interest-rates':
        data.push(...this.generateInterestRateData());
        break;
      case 'inflation':
        data.push(...this.generateInflationData());
        break;
      case 'gdp':
        data.push(...this.generateGDPData());
        break;
      case 'unemployment':
        data.push(...this.generateUnemploymentData());
        break;
      case 'dxy':
        data.push(this.generateDXYData());
        break;
      case 'vix':
        data.push(this.generateVIXData());
        break;
      case 'commodities':
        data.push(...this.generateCommoditiesData());
        break;
      case 'forex':
        data.push(...this.generateForexData());
        break;
    }
    
    return data;
  }

  private generateInterestRateData(): MacroData[] {
    const rates = [];
    const regions = ['USD', 'EUR', 'GBP', 'JPY', 'CHF'];
    
    for (const currency of regions) {
      const baseRate = { USD: 5.5, EUR: 4.5, GBP: 5.25, JPY: -0.1, CHF: 1.75 }[currency] || 2;
      
      rates.push({
        indicator: `${currency}-interest-rate`,
        value: baseRate + (Math.random() - 0.5) * 0.25,
        timestamp: Date.now(),
                previousValue: baseRate,        forecast: baseRate,        actual: baseRate + (Math.random() - 0.5) * 0.25,        impact: 'high' as 'high' | 'medium' | 'low',        currency,        source: 'central-bank'
      });
    }
    
    return rates;
  }

  private generateInflationData(): MacroData[] {
    const data = [];
    const regions = ['US', 'EU', 'UK', 'JP', 'CH'];
    
    for (const region of regions) {
      const baseInflation = { US: 3.2, EU: 2.4, UK: 4.0, JP: 3.3, CH: 1.7 }[region] || 2.5;
      
      data.push({
        indicator: `${region}-CPI`,
        value: baseInflation + (Math.random() - 0.5) * 0.3,
        timestamp: Date.now(),
        previousValue: baseInflation,
        forecast: baseInflation + 0.1,
        actual: baseInflation + (Math.random() - 0.5) * 0.3,
        impact: 'high',
        currency: region === 'US' ? 'USD' : region === 'EU' ? 'EUR' : `${region}Y`,
        source: 'statistics-bureau'
      });
    }
    
    return data;
  }

  private generateGDPData(): MacroData[] {
    const data = [];
    const regions = ['US', 'EU', 'CN', 'JP', 'UK'];
    
    for (const region of regions) {
      const baseGrowth = { US: 2.5, EU: 0.6, CN: 5.0, JP: 1.2, UK: 0.3 }[region] || 2.0;
      
      data.push({
        indicator: `${region}-GDP-QoQ`,
        value: baseGrowth + (Math.random() - 0.5) * 0.5,
        timestamp: Date.now(),
        previousValue: baseGrowth,
        forecast: baseGrowth + 0.1,
        actual: baseGrowth + (Math.random() - 0.5) * 0.5,
        impact: 'high',
        source: 'national-statistics'
      });
    }
    
    return data;
  }

  private generateUnemploymentData(): MacroData[] {
    const data = [];
    const regions = ['US', 'EU', 'UK', 'JP'];
    
    for (const region of regions) {
      const baseRate = { US: 3.9, EU: 6.4, UK: 4.2, JP: 2.5 }[region] || 4.0;
      
      data.push({
        indicator: `${region}-unemployment`,
        value: baseRate + (Math.random() - 0.5) * 0.2,
        timestamp: Date.now(),
        previousValue: baseRate,
        forecast: baseRate - 0.1,
        actual: baseRate + (Math.random() - 0.5) * 0.2,
        impact: 'medium',
        source: 'labor-statistics'
      });
    }
    
    return data;
  }

  private generateDXYData(): MacroData {
    const base = 105;
    
    return {
      indicator: 'DXY',
      value: base + (Math.random() - 0.5) * 2,
      timestamp: Date.now(),
      previousValue: base,
      forecast: base,
      actual: base + (Math.random() - 0.5) * 2,
      impact: 'high',
      currency: 'USD',
      source: 'forex-market'
    };
  }

  private generateVIXData(): MacroData {
    const base = 15;
    const stress = Math.random() > 0.9 ? 10 : 0; // 10% chance of stress event
    
    return {
      indicator: 'VIX',
      value: base + (Math.random() * 5) + stress,
      timestamp: Date.now(),
      previousValue: base,
      forecast: base,
      actual: base + (Math.random() * 5) + stress,
      impact: stress > 0 ? 'high' : 'medium',
      source: 'cboe'
    };
  }

  private generateCommoditiesData(): MacroData[] {
    const commodities = [
      { name: 'gold', base: 2000, unit: 'USD/oz' },
      { name: 'silver', base: 23, unit: 'USD/oz' },
      { name: 'oil-wti', base: 75, unit: 'USD/barrel' },
      { name: 'oil-brent', base: 80, unit: 'USD/barrel' },
      { name: 'copper', base: 4.0, unit: 'USD/lb' }
    ];
    
    return commodities.map(commodity => ({
      indicator: commodity.name,
      value: commodity.base + (Math.random() - 0.5) * commodity.base * 0.02,
      timestamp: Date.now(),
      previousValue: commodity.base,
      forecast: commodity.base,
      actual: commodity.base + (Math.random() - 0.5) * commodity.base * 0.02,
      impact: commodity.name.includes('oil') ? 'high' : 'medium',
      source: 'commodity-exchange'
    }));
  }

  private generateForexData(): MacroData[] {
    const pairs = [
      { pair: 'EURUSD', base: 1.08 },
      { pair: 'GBPUSD', base: 1.27 },
      { pair: 'USDJPY', base: 150 },
      { pair: 'USDCHF', base: 0.90 },
      { pair: 'AUDUSD', base: 0.65 }
    ];
    
    return pairs.map(fx => ({
      indicator: fx.pair,
      value: fx.base + (Math.random() - 0.5) * fx.base * 0.001,
      timestamp: Date.now(),
      previousValue: fx.base,
      forecast: fx.base,
      actual: fx.base + (Math.random() - 0.5) * fx.base * 0.001,
      impact: 'medium',
      source: 'forex-market'
    }));
  }

  private processMacroData(data: MacroData): void {
    // Add to buffer
    const key = data.indicator;
    
    if (!this.macroBuffer.has(key)) {
      this.macroBuffer.set(key, []);
    }
    
    const buffer = this.macroBuffer.get(key)!;
    buffer.push(data);
    
    // Keep buffer size manageable
    const cutoff = Date.now() - 30 * 24 * 3600000; // 30 days
    const filtered = buffer.filter(d => d.timestamp > cutoff);
    this.macroBuffer.set(key, filtered);
    
    // Update cache
    this.updateIndicatorCache(data);
    
    // Check for economic surprises
    this.checkEconomicSurprise(data);
    
    // Check for threshold breaches
    this.checkThresholdBreaches(data);
  }

  private updateIndicatorCache(data: MacroData): void {
    const cached = this.indicatorCache.get(data.indicator) || {
      indicator: data.indicator,
      latestValue: 0,
      previousValue: 0,
      change: 0,
      changePercent: 0,
      trend: 'stable' as 'rising' | 'falling' | 'stable',
      movingAverage: 0,
      volatility: 0,
      lastUpdate: 0
    };
    
    cached.previousValue = cached.latestValue;
    cached.latestValue = data.value;
    cached.change = data.value - data.previousValue;
    cached.changePercent = data.previousValue !== 0 ? 
      (cached.change / data.previousValue) * 100 : 0;
    cached.trend = cached.change > 0.01 ? 'rising' : 
      cached.change < -0.01 ? 'falling' : 'stable';
    cached.lastUpdate = data.timestamp;
    
    // Calculate moving average
    const history = this.macroBuffer.get(data.indicator) || [];
    if (history.length > 0) {
      const recent = history.slice(-20);
      cached.movingAverage = recent.reduce((sum, d) => sum + d.value, 0) / recent.length;
      
      // Calculate volatility
      const mean = cached.movingAverage;
      const variance = recent.reduce((sum, d) => sum + Math.pow(d.value - mean, 2), 0) / recent.length;
      cached.volatility = Math.sqrt(variance);
    }
    
    this.indicatorCache.set(data.indicator, cached);
  }

  private checkEconomicSurprise(data: MacroData): void {
    if (data.forecast === 0) return;
    
    const surprise = Math.abs(data.actual - data.forecast) / Math.abs(data.forecast);
    
    if (surprise > this.config.alertThresholds.economicSurprise) {
      this.emitEconomicSurpriseAlert(data, surprise);
    }
  }

  private emitEconomicSurpriseAlert(data: MacroData, surprise: number): void {
    const direction = data.actual > data.forecast ? 'above' : 'below';
    
    const alert: IntelAlert = {
      id: `eco-surprise-${Date.now()}-${data.indicator}`,
      timestamp: Date.now(),
      type: 'macro',
      severity: surprise > 0.1 ? 'high' : 'medium',
      title: `Economic Surprise: ${data.indicator}`,
      description: `${data.indicator} came in ${(surprise * 100).toFixed(1)}% ${direction} forecast. Actual: ${data.actual.toFixed(2)}, Forecast: ${data.forecast.toFixed(2)}`,
      affectedAssets: this.getAffectedAssets(data.indicator),
      metrics: {
        indicator: data.indicator,
        actual: data.actual,
        forecast: data.forecast,
        surprise,
        impact: data.impact
      },
      actionRequired: data.impact === 'high' && surprise > 0.1,
      suggestedActions: this.getSurpriseActions(data, direction)
    };
    
    this.emit('alert', alert);
  }

  private getAffectedAssets(indicator: string): string[] {
    // Map indicators to potentially affected crypto assets
    const assetMap: Record<string, string[]> = {
      'USD-interest-rate': ['BTC', 'ETH', 'stablecoins'],
      'US-CPI': ['BTC', 'ETH', 'gold-backed-tokens'],
      'DXY': ['BTC', 'ETH', 'USDT', 'USDC'],
      'VIX': ['BTC', 'ETH', 'risk-assets'],
      'gold': ['PAXG', 'gold-backed-tokens'],
      'oil-wti': ['energy-tokens'],
      'oil-brent': ['energy-tokens']
    };
    
    // Check if indicator contains any mapped keys
    for (const [key, assets] of Object.entries(assetMap)) {
      if (indicator.includes(key)) {
        return assets;
      }
    }
    
    return [];
  }

  private getSurpriseActions(data: MacroData, direction: string): string[] {
    const actions: string[] = [];
    
    if (data.indicator.includes('interest-rate')) {
      if (direction === 'above') {
        actions.push('Higher rates bearish for risk assets - consider reducing exposure');
        actions.push('Monitor DXY strength and stablecoin flows');
      } else {
        actions.push('Lower rates bullish for risk assets - consider increasing exposure');
        actions.push('Watch for currency debasement trades');
      }
    } else if (data.indicator.includes('CPI') || data.indicator.includes('inflation')) {
      if (direction === 'above') {
        actions.push('Higher inflation - consider inflation hedges like BTC');
        actions.push('Monitor central bank response');
      } else {
        actions.push('Lower inflation - reduced need for inflation hedges');
        actions.push('Watch for risk-on sentiment');
      }
    } else if (data.indicator === 'VIX') {
      if (data.value > 20) {
        actions.push('High volatility - consider reducing leverage');
        actions.push('Look for volatility arbitrage opportunities');
      }
    }
    
    return actions.length > 0 ? actions : ['Monitor market reaction to data'];
  }

  private checkThresholdBreaches(data: MacroData): void {
    const thresholds: Record<string, { high: number; low: number }> = {
      'VIX': { high: 25, low: 12 },
      'DXY': { high: 110, low: 100 },
      'USD-interest-rate': { high: 6, low: 4 },
      'gold': { high: 2100, low: 1900 },
      'oil-wti': { high: 90, low: 60 }
    };
    
    const threshold = thresholds[data.indicator];
    if (!threshold) return;
    
    if (data.value > threshold.high || data.value < threshold.low) {
      this.emitThresholdAlert(data, threshold);
    }
  }

  private emitThresholdAlert(data: MacroData, threshold: { high: number; low: number }): void {
    const breachType = data.value > threshold.high ? 'high' : 'low';
    const level = breachType === 'high' ? threshold.high : threshold.low;
    
    const alert: IntelAlert = {
      id: `threshold-${Date.now()}-${data.indicator}`,
      timestamp: Date.now(),
      type: 'macro',
      severity: 'high',
      title: `${data.indicator} Threshold Breach`,
      description: `${data.indicator} has breached ${breachType} threshold of ${level}. Current: ${data.value.toFixed(2)}`,
      affectedAssets: this.getAffectedAssets(data.indicator),
      metrics: {
        indicator: data.indicator,
        value: data.value,
        threshold: level,
        breachType
      },
      actionRequired: true,
      suggestedActions: this.getThresholdActions(data.indicator, breachType)
    };
    
    this.emit('alert', alert);
  }

  private getThresholdActions(indicator: string, breachType: string): string[] {
    const actions: Record<string, Record<string, string[]>> = {
      'VIX': {
        high: [
          'Market fear elevated - consider defensive positioning',
          'Look for oversold opportunities after volatility spike',
          'Reduce leverage and review stop losses'
        ],
        low: [
          'Market complacency - potential for surprise moves',
          'Consider volatility strategies',
          'Review hedging positions'
        ]
      },
      'DXY': {
        high: [
          'Strong dollar bearish for risk assets',
          'Monitor emerging market stress',
          'Consider USD-denominated positions'
        ],
        low: [
          'Weak dollar bullish for crypto and commodities',
          'Monitor inflation expectations',
          'Consider non-USD exposures'
        ]
      }
    };
    
    return actions[indicator]?.[breachType] || ['Monitor market conditions closely'];
  }

  private startMarketIndicesFeed(): void {
    // Simulate real-time market indices updates
    setInterval(() => {
      this.updateMarketIndices();
    }, 60000); // Update every minute
  }

  private updateMarketIndices(): void {
    const indices = [
      { symbol: 'SPX', name: 'S&P 500', base: 4500 },
      { symbol: 'NDX', name: 'NASDAQ 100', base: 15000 },
      { symbol: 'DJI', name: 'Dow Jones', base: 35000 },
      { symbol: 'FTSE', name: 'FTSE 100', base: 7500 },
      { symbol: 'DAX', name: 'DAX', base: 16000 },
      { symbol: 'N225', name: 'Nikkei 225', base: 33000 },
      { symbol: 'HSI', name: 'Hang Seng', base: 17000 }
    ];
    
    for (const index of indices) {
      const prevValue = this.marketIndices.get(index.symbol)?.value || index.base;
      const change = (Math.random() - 0.5) * 0.002; // ±0.2% change
      const newValue = prevValue * (1 + change);
      
      this.marketIndices.set(index.symbol, {
        symbol: index.symbol,
        name: index.name,
        value: newValue,
        change: newValue - prevValue,
        changePercent: change * 100,
        timestamp: Date.now()
      });
    }
  }

  private loadEventCalendar(): void {
    // Load economic calendar events
    const upcomingEvents: EventRisk[] = [
      {
        event: 'FOMC Meeting',
        timestamp: Date.now() + 7 * 24 * 3600000, // 1 week
        impact: 'high',
        probability: 1.0,
        affectedAssets: ['BTC', 'ETH', 'USD-pairs'],
        expectedVolatility: 0.15,
        historicalImpact: {
          avgMove: 0.08,
          maxMove: 0.20,
          duration: 3600000 // 1 hour
        }
      },
      {
        event: 'US CPI Release',
        timestamp: Date.now() + 3 * 24 * 3600000, // 3 days
        impact: 'high',
        probability: 1.0,
        affectedAssets: ['BTC', 'ETH', 'inflation-hedges'],
        expectedVolatility: 0.10,
        historicalImpact: {
          avgMove: 0.05,
          maxMove: 0.12,
          duration: 1800000 // 30 minutes
        }
      },
      {
        event: 'ECB Rate Decision',
        timestamp: Date.now() + 10 * 24 * 3600000, // 10 days
        impact: 'medium',
        probability: 1.0,
        affectedAssets: ['EUR-pairs'],
        expectedVolatility: 0.08
      },
      {
        event: 'US GDP Q4',
        timestamp: Date.now() + 14 * 24 * 3600000, // 2 weeks
        impact: 'medium',
        probability: 1.0,
        affectedAssets: ['risk-assets'],
        expectedVolatility: 0.06
      }
    ];
    
    this.eventCalendar = upcomingEvents;
    
    // Check for imminent events
    this.checkUpcomingEvents();
  }

  private checkUpcomingEvents(): void {
    const now = Date.now();
    const warningThreshold = 24 * 3600000; // 24 hours
    
    for (const event of this.eventCalendar) {
      const timeUntilEvent = event.timestamp - now;
      
      if (timeUntilEvent > 0 && timeUntilEvent < warningThreshold) {
        this.emitEventWarning(event, timeUntilEvent);
      }
    }
  }

  private emitEventWarning(event: EventRisk, timeUntil: number): void {
    const hoursUntil = Math.floor(timeUntil / 3600000);
    
    const alert: IntelAlert = {
      id: `event-warning-${Date.now()}-${event.event.replace(/\s+/g, '-')}`,
      timestamp: Date.now(),
      type: 'macro',
      severity: event.impact === 'high' ? 'high' : 'medium',
      title: `Upcoming Event: ${event.event}`,
      description: `${event.event} in ${hoursUntil} hours. Expected volatility: ${(event.expectedVolatility * 100).toFixed(0)}%`,
      affectedAssets: event.affectedAssets,
      metrics: {
        event: event.event,
        hoursUntil,
        expectedVolatility: event.expectedVolatility,
        historicalImpact: event.historicalImpact
      },
      actionRequired: event.impact === 'high' && hoursUntil < 6,
      suggestedActions: [
        'Review and adjust position sizes',
        'Consider hedging strategies',
        'Set appropriate stop losses',
        event.historicalImpact ? 
          `Historical avg move: ${(event.historicalImpact.avgMove * 100).toFixed(0)}%, max: ${(event.historicalImpact.maxMove * 100).toFixed(0)}%` :
          'Monitor market reaction'
      ]
    };
    
    this.emit('alert', alert);
  }

  private startAnalysisLoop(): void {
    this.updateInterval = setInterval(() => {
      this.calculateCorrelations();
      this.analyzeRegimeShifts();
      this.detectMacroAnomalies();
      this.updateEventCalendar();
      this.generateMacroReport();
    }, this.config.updateInterval);
  }

  private calculateCorrelations(): void {
    // Calculate correlations between macro indicators and crypto assets
    const cryptoAssets = ['BTC', 'ETH'];
    const macroIndicators = ['DXY', 'VIX', 'gold', 'SPX'];
    
    for (const crypto of cryptoAssets) {
      const correlations: number[][] = [];
      const assets = [crypto, ...macroIndicators];
      
      // Generate mock correlation matrix
      for (let i = 0; i < assets.length; i++) {
        correlations[i] = [];
        for (let j = 0; j < assets.length; j++) {
          if (i === j) {
            correlations[i][j] = 1.0;
          } else {
            // Mock correlations based on typical relationships
            correlations[i][j] = this.getMockCorrelation(assets[i], assets[j]);
          }
        }
      }
      
      const matrix: CorrelationMatrix = {
        assets,
        timeframe: '30d',
        correlations,
        timestamp: Date.now(),
        significance: correlations.map(row => row.map(() => Math.random())),
        rollingWindow: 30
      };
      
      this.correlationMatrices.set(crypto, matrix);
      
      // Check for correlation changes
      this.checkCorrelationChanges(crypto, matrix);
    }
  }

  private getMockCorrelation(asset1: string, asset2: string): number {
    const correlationMap: Record<string, number> = {
      'BTC-DXY': -0.4 + Math.random() * 0.2,
      'BTC-VIX': -0.3 + Math.random() * 0.2,
      'BTC-gold': 0.2 + Math.random() * 0.2,
      'BTC-SPX': 0.5 + Math.random() * 0.2,
      'ETH-DXY': -0.35 + Math.random() * 0.2,
      'ETH-VIX': -0.4 + Math.random() * 0.2,
      'ETH-gold': 0.15 + Math.random() * 0.2,
      'ETH-SPX': 0.6 + Math.random() * 0.2,
      'DXY-VIX': 0.2 + Math.random() * 0.1,
      'DXY-gold': -0.5 + Math.random() * 0.1,
      'DXY-SPX': -0.3 + Math.random() * 0.1,
      'VIX-gold': 0.1 + Math.random() * 0.1,
      'VIX-SPX': -0.7 + Math.random() * 0.1,
      'gold-SPX': -0.1 + Math.random() * 0.1
    };
    
    const key1 = `${asset1}-${asset2}`;
    const key2 = `${asset2}-${asset1}`;
    
    return correlationMap[key1] || correlationMap[key2] || (Math.random() - 0.5) * 0.4;
  }

  private checkCorrelationChanges(crypto: string, current: CorrelationMatrix): void {
    // Would compare with historical correlations
    // Mock significant change detection
    const btcDxyCorr = current.correlations[0][current.assets.indexOf('DXY')];
    
    if (Math.abs(btcDxyCorr) < 0.2) {
      // Correlation breakdown
      this.emitCorrelationAlert(crypto, 'DXY', btcDxyCorr, 'breakdown');
    } else if (Math.abs(btcDxyCorr) > 0.7) {
      // Unusually high correlation
      this.emitCorrelationAlert(crypto, 'DXY', btcDxyCorr, 'spike');
    }
  }

  private emitCorrelationAlert(
    asset1: string,
    asset2: string,
    correlation: number,
    type: 'breakdown' | 'spike'
  ): void {
    const alert: IntelAlert = {
      id: `correlation-${type}-${Date.now()}-${asset1}-${asset2}`,
      timestamp: Date.now(),
      type: 'macro',
      severity: 'medium',
      title: `Correlation ${type === 'breakdown' ? 'Breakdown' : 'Spike'}: ${asset1}/${asset2}`,
      description: `${asset1}/${asset2} correlation ${type === 'breakdown' ? 'weakened' : 'strengthened'} to ${correlation.toFixed(2)}`,
      affectedAssets: [asset1],
      metrics: {
        asset1,
        asset2,
        correlation,
        type
      },
      actionRequired: false,
      suggestedActions: type === 'breakdown' ? [
        'Traditional correlations breaking down',
        'Consider independent analysis for each asset',
        'Monitor for regime change'
      ] : [
        'Assets moving in lockstep',
        'Reduce correlated positions',
        'Look for decorrelation opportunities'
      ]
    };
    
    this.emit('alert', alert);
  }

  private analyzeRegimeShifts(): void {
    // Analyze for potential market regime changes
    const vixData = this.indicatorCache.get('VIX');
    const dxyData = this.indicatorCache.get('DXY');
    const spxData = this.marketIndices.get('SPX');
    
    if (!vixData || !dxyData || !spxData) return;
    
    // Define regime characteristics
    const regime = this.identifyRegime(vixData, dxyData, spxData);
    
    // Check for regime change
    this.checkRegimeChange(regime);
  }

  private identifyRegime(
    vix: IndicatorData,
    dxy: IndicatorData,
    spx: MarketIndex
  ): MarketRegime {
    let regime: 'risk-on' | 'risk-off' | 'uncertain' = 'uncertain';
    let confidence = 0;
    
    if (vix.latestValue < 15 && spx.changePercent > 0 && dxy.trend === 'falling') {
      regime = 'risk-on';
      confidence = 0.8;
    } else if (vix.latestValue > 25 && spx.changePercent < 0 && dxy.trend === 'rising') {
      regime = 'risk-off';
      confidence = 0.8;
    } else {
      confidence = 0.5;
    }
    
    return {
      type: regime,
      confidence,
      indicators: {
        vix: vix.latestValue,
        dxy: dxy.latestValue,
        spxChange: spx.changePercent
      },
      timestamp: Date.now()
    };
  }

  private checkRegimeChange(current: MarketRegime): void {
    // Would compare with previous regime
    // Mock regime change detection
    if (current.type === 'risk-off' && current.confidence > 0.7) {
      this.emitRegimeChangeAlert(current);
    }
  }

  private emitRegimeChangeAlert(regime: MarketRegime): void {
    const alert: IntelAlert = {
      id: `regime-change-${Date.now()}`,
      timestamp: Date.now(),
      type: 'macro',
      severity: 'high',
      title: `Market Regime Shift: ${regime.type.toUpperCase()}`,
      description: `Market indicators suggest ${regime.type} regime. VIX: ${regime.indicators.vix.toFixed(1)}, DXY: ${regime.indicators.dxy.toFixed(1)}, SPX: ${regime.indicators.spxChange.toFixed(1)}%`,
      affectedAssets: ['BTC', 'ETH', 'risk-assets'],
      metrics: regime.indicators,
      actionRequired: true,
      suggestedActions: regime.type === 'risk-off' ? [
        'Consider reducing risk exposure',
        'Focus on quality assets',
        'Increase cash/stablecoin allocation'
      ] : [
        'Consider increasing risk exposure',
        'Look for growth opportunities',
        'Deploy sidelined capital'
      ]
    };
    
    this.emit('alert', alert);
  }

  private detectMacroAnomalies(): void {
    // Detect unusual patterns in macro data
    this.detectCrossAssetDivergence();
    this.detectVolatilityRegime();
    this.detectCurrencyStress();
  }

  private detectCrossAssetDivergence(): void {
    // Check for divergence between correlated assets
    const gold = this.indicatorCache.get('gold');
    const dxy = this.indicatorCache.get('DXY');
    
    if (!gold || !dxy) return;
    
    // Gold and DXY typically inversely correlated
    if (gold.trend === 'rising' && dxy.trend === 'rising') {
      this.emitDivergenceAlert('gold', 'DXY', 'both rising');
    }
  }

  private emitDivergenceAlert(asset1: string, asset2: string, condition: string): void {
    const alert: IntelAlert = {
      id: `divergence-${Date.now()}-${asset1}-${asset2}`,
      timestamp: Date.now(),
      type: 'anomaly',
      severity: 'medium',
      title: `Cross-Asset Divergence: ${asset1}/${asset2}`,
      description: `Unusual pattern detected: ${asset1} and ${asset2} ${condition}. This divergence may indicate market stress or regime change.`,
      affectedAssets: [],
      metrics: {
        asset1,
        asset2,
        condition
      },
      actionRequired: false,
      suggestedActions: [
        'Monitor for resolution of divergence',
        'Consider hedged positions',
        'Watch for continuation or reversal'
      ]
    };
    
    this.emit('alert', alert);
  }

  private detectVolatilityRegime(): void {
    const vix = this.indicatorCache.get('VIX');
    if (!vix) return;
    
    // Check for volatility regime
    if (vix.volatility > vix.movingAverage * 0.3) {
      this.emitVolatilityRegimeAlert(vix);
    }
  }

  private emitVolatilityRegimeAlert(vix: IndicatorData): void {
    const alert: IntelAlert = {
      id: `vol-regime-${Date.now()}`,
      timestamp: Date.now(),
      type: 'macro',
      severity: 'high',
      title: 'Volatility Regime Shift',
      description: `VIX volatility itself is elevated at ${vix.volatility.toFixed(1)}, indicating unstable market conditions`,
      affectedAssets: ['BTC', 'ETH', 'all-risk-assets'],
      metrics: {
        vixLevel: vix.latestValue,
        vixVolatility: vix.volatility,
        vixMA: vix.movingAverage
      },
      actionRequired: true,
      suggestedActions: [
        'Expect continued volatility',
        'Reduce position sizes',
        'Widen stop losses to avoid whipsaws',
        'Consider volatility strategies'
      ]
    };
    
    this.emit('alert', alert);
  }

  private detectCurrencyStress(): void {
    // Check for currency market stress indicators
    const emergingCurrencies = ['TRY', 'ARS', 'ZAR'];
    let stressCount = 0;
    
    // In production, would check actual EM currency data
    // Mock stress detection
    for (const currency of emergingCurrencies) {
      if (Math.random() > 0.8) stressCount++;
    }
    
    if (stressCount >= 2) {
      this.emitCurrencyStressAlert(stressCount);
    }
  }

  private emitCurrencyStressAlert(count: number): void {
    const alert: IntelAlert = {
      id: `currency-stress-${Date.now()}`,
      timestamp: Date.now(),
      type: 'macro',
      severity: 'medium',
      title: 'Emerging Market Currency Stress',
      description: `${count} emerging market currencies showing stress. This could lead to flight to quality and impact risk assets.`,
      affectedAssets: ['BTC', 'ETH', 'EM-exposed-tokens'],
      metrics: {
        stressedCurrencies: count
      },
      actionRequired: false,
      suggestedActions: [
        'Monitor for contagion effects',
        'Consider reducing EM exposure',
        'Watch for safe haven flows'
      ]
    };
    
    this.emit('alert', alert);
  }

  private updateEventCalendar(): void {
    // Remove past events
    this.eventCalendar = this.eventCalendar.filter(e => e.timestamp > Date.now());
    
    // Check for new upcoming events
    this.checkUpcomingEvents();
  }

  private generateMacroReport(): void {
    const report: MacroReport = {
      timestamp: Date.now(),
      indicators: this.getKeyIndicators(),
      marketIndices: this.getMarketIndicesSummary(),
      correlations: this.getCorrelationSummary(),
      upcomingEvents: this.eventCalendar.slice(0, 5),
      regime: this.getCurrentRegime(),
      alerts: [] // Would include recent alerts
    };
    
    this.emit('macro-report', report);
  }

  private getKeyIndicators(): any {
    const key = ['DXY', 'VIX', 'USD-interest-rate', 'US-CPI', 'gold', 'oil-wti'];
    const indicators: any = {};
    
    for (const indicator of key) {
      const data = this.indicatorCache.get(indicator);
      if (data) {
        indicators[indicator] = {
          value: data.latestValue,
          change: data.changePercent,
          trend: data.trend
        };
      }
    }
    
    return indicators;
  }

  private getMarketIndicesSummary(): any {
    const summary: any = {};
    
    for (const [symbol, index] of this.marketIndices) {
      summary[symbol] = {
        value: index.value,
        change: index.changePercent,
        timestamp: index.timestamp
      };
    }
    
    return summary;
  }

  private getCorrelationSummary(): any {
    const summary: any = {};
    
    for (const [asset, matrix] of this.correlationMatrices) {
      const dxyIndex = matrix.assets.indexOf('DXY');
      const spxIndex = matrix.assets.indexOf('SPX');
      const vixIndex = matrix.assets.indexOf('VIX');
      
      summary[asset] = {
        DXY: dxyIndex >= 0 ? matrix.correlations[0][dxyIndex] : null,
        SPX: spxIndex >= 0 ? matrix.correlations[0][spxIndex] : null,
        VIX: vixIndex >= 0 ? matrix.correlations[0][vixIndex] : null
      };
    }
    
    return summary;
  }

  private getCurrentRegime(): MarketRegime | null {
    const vix = this.indicatorCache.get('VIX');
    const dxy = this.indicatorCache.get('DXY');
    const spx = this.marketIndices.get('SPX');
    
    if (!vix || !dxy || !spx) return null;
    
    return this.identifyRegime(vix, dxy, spx);
  }

  private async stopDataFeeds(): Promise<void> {
    for (const [provider, dataSource] of this.dataSources) {
      dataSource.status = 'inactive';
      this.logger.info(`Disconnected from ${provider}`);
    }
  }

  // Public methods for querying macro data
  
  getMacroSummary(): MacroSummary {
    return {
      indicators: Object.fromEntries(this.indicatorCache),
      marketIndices: Object.fromEntries(this.marketIndices),
      correlations: Object.fromEntries(this.correlationMatrices),
      upcomingEvents: this.eventCalendar,
      lastUpdate: Date.now()
    };
  }

  getIndicatorHistory(indicator: string, days: number = 30): MacroData[] {
    const buffer = this.macroBuffer.get(indicator) || [];
    const cutoff = Date.now() - days * 24 * 3600000;
    
    return buffer
      .filter(d => d.timestamp > cutoff)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  getCorrelationMatrix(asset: string): CorrelationMatrix | null {
    return this.correlationMatrices.get(asset) || null;
  }

  getUpcomingEvents(days: number = 7): EventRisk[] {
    const cutoff = Date.now() + days * 24 * 3600000;
    
    return this.eventCalendar
      .filter(e => e.timestamp <= cutoff)
      .sort((a, b) => a.timestamp - b.timestamp);
  }
}

// Supporting types and interfaces

interface IndicatorData {
  indicator: string;
  latestValue: number;
  previousValue: number;
  change: number;
  changePercent: number;
  trend: 'rising' | 'falling' | 'stable';
  movingAverage: number;
  volatility: number;
  lastUpdate: number;
}

interface MarketIndex {
  symbol: string;
  name: string;
  value: number;
  change: number;
  changePercent: number;
  timestamp: number;
}

interface MarketRegime {
  type: 'risk-on' | 'risk-off' | 'uncertain';
  confidence: number;
  indicators: {
    vix: number;
    dxy: number;
    spxChange: number;
  };
  timestamp: number;
}

interface MacroReport {
  timestamp: number;
  indicators: any;
  marketIndices: any;
  correlations: any;
  upcomingEvents: EventRisk[];
  regime: MarketRegime | null;
  alerts: IntelAlert[];
}

interface MacroSummary {
  indicators: Record<string, IndicatorData>;
  marketIndices: Record<string, MarketIndex>;
  correlations: Record<string, CorrelationMatrix>;
  upcomingEvents: EventRisk[];
  lastUpdate: number;
} 