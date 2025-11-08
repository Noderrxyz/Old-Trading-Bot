import EventEmitter from 'events';
import { Logger } from 'winston';
import { OrderflowAnalyzer } from './OrderflowAnalyzer';
import { SentimentEngine } from './SentimentEngine';
import { OnChainMetrics } from './OnChainMetrics';
import { MacroDataIntegrator } from './MacroDataIntegrator';
import {
  MarketIntelConfig,
  IntelReport,
  IntelAlert,
  MarketRegime,
  CorrelationMatrix,
  IntelError,
  IntelErrorCode
} from './types';

export class MarketIntelService extends EventEmitter {
  private orderflowAnalyzer: OrderflowAnalyzer;
  private sentimentEngine: SentimentEngine;
  private onChainMetrics: OnChainMetrics;
  private macroDataIntegrator: MacroDataIntegrator;
  
  private alertBuffer: IntelAlert[] = [];
  private regimeHistory: MarketRegime[] = [];
  private correlationCache: Map<string, CorrelationMatrix> = new Map();
  private reportInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(
    private logger: Logger,
    private config: MarketIntelConfig
  ) {
    super();
    
    // Initialize sub-modules
    this.orderflowAnalyzer = new OrderflowAnalyzer(logger, {
      exchanges: config.orderflowAnalysis.exchanges,
      whaleThreshold: config.orderflowAnalysis.whaleThreshold,
      updateInterval: config.orderflowAnalysis.updateInterval,
      volumeProfileBins: 50,
      imbalanceThreshold: 0.7,
      flowAnalysisWindow: 300000 // 5 minutes
    });

    this.sentimentEngine = new SentimentEngine(logger, {
      sources: config.sentimentAnalysis.sources,
      languages: config.sentimentAnalysis.languages,
      mlModelVersion: config.sentimentAnalysis.mlModelVersion,
      updateInterval: config.sentimentAnalysis.updateInterval,
      sentimentWindow: 3600000, // 1 hour
      minConfidence: 0.6,
      alertThresholds: {
        sentiment: 0.7,
        momentum: 0.5,
        controversy: 0.7
      }
    });

    this.onChainMetrics = new OnChainMetrics(logger, {
      chains: config.onchainMetrics.chains,
      protocols: config.onchainMetrics.protocols,
      metrics: config.onchainMetrics.metrics,
      updateInterval: config.onchainMetrics.updateInterval,
      alertThresholds: {
        tvlChange: 0.1,
        liquidationVolume: 1000000,
        gasSpike: 0.5,
        utilizationRate: 0.85
      }
    });

    this.macroDataIntegrator = new MacroDataIntegrator(logger, {
      indicators: config.macroData.indicators,
      regions: config.macroData.regions,
      updateInterval: config.macroData.updateInterval,
      correlationWindow: 30 * 24 * 3600000, // 30 days
      alertThresholds: {
        correlationChange: 0.3,
        economicSurprise: 0.05,
        volatilitySpike: 0.5
      }
    });

    // Set up inter-module communication
    this.setupAlertHandlers();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new IntelError(
        IntelErrorCode.INVALID_CONFIG,
        'Market Intel Service is already running'
      );
    }

    this.logger.info('Starting Market Intelligence Service');

    try {
      // Start all sub-modules
      await Promise.all([
        this.config.orderflowAnalysis.enabled && this.orderflowAnalyzer.start(),
        this.config.sentimentAnalysis.enabled && this.sentimentEngine.start(),
        this.config.onchainMetrics.enabled && this.onChainMetrics.start(),
        this.config.macroData.enabled && this.macroDataIntegrator.start()
      ].filter(Boolean));

      // Start report generation
      this.startReportGeneration();
      
      this.isRunning = true;
      this.logger.info('Market Intelligence Service started successfully');
    } catch (error) {
      this.logger.error('Failed to start Market Intelligence Service', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.logger.info('Stopping Market Intelligence Service');

    // Stop report generation
    if (this.reportInterval) {
      clearInterval(this.reportInterval);
      this.reportInterval = null;
    }

    // Stop all sub-modules
    await Promise.all([
      this.orderflowAnalyzer.stop(),
      this.sentimentEngine.stop(),
      this.onChainMetrics.stop(),
      this.macroDataIntegrator.stop()
    ]);

    this.isRunning = false;
    this.logger.info('Market Intelligence Service stopped');
  }

  private setupAlertHandlers(): void {
    // Collect alerts from all modules
    const modules = [
      this.orderflowAnalyzer,
      this.sentimentEngine,
      this.onChainMetrics,
      this.macroDataIntegrator
    ];

    for (const module of modules) {
      module.on('alert', (alert: IntelAlert) => {
        this.processAlert(alert);
      });
    }

    // Handle special events
    this.onChainMetrics.on('metrics-report', (report: any) => {
      this.logger.debug('Received on-chain metrics report', report);
    });

    this.macroDataIntegrator.on('macro-report', (report: any) => {
      this.logger.debug('Received macro data report', report);
    });
  }

  private processAlert(alert: IntelAlert): void {
    // Add to buffer
    this.alertBuffer.push(alert);
    
    // Keep buffer size manageable
    if (this.alertBuffer.length > 1000) {
      this.alertBuffer = this.alertBuffer.slice(-1000);
    }

    // Analyze alert patterns
    this.analyzeAlertPatterns(alert);

    // Forward alert based on severity and configuration
    if (this.shouldForwardAlert(alert)) {
      this.emit('alert', alert);
    }

    // Log alert
    this.logger.info('Market Intel Alert', {
      id: alert.id,
      type: alert.type,
      severity: alert.severity,
      title: alert.title
    });
  }

  private analyzeAlertPatterns(alert: IntelAlert): void {
    // Look for correlated alerts across modules
    const recentAlerts = this.alertBuffer.filter(
      a => a.timestamp > Date.now() - 300000 // Last 5 minutes
    );

    // Check for alert clustering
    const similarAlerts = recentAlerts.filter(
      a => a.type === alert.type && 
           this.hasAssetOverlap(a.affectedAssets, alert.affectedAssets)
    );

    if (similarAlerts.length > 3) {
      this.emitClusterAlert(alert.type, alert.affectedAssets, similarAlerts);
    }

    // Check for cross-module correlations
    this.checkCrossModuleCorrelations(alert, recentAlerts);
  }

  private hasAssetOverlap(assets1: string[], assets2: string[]): boolean {
    return assets1.some(asset => assets2.includes(asset));
  }

  private emitClusterAlert(
    type: string,
    affectedAssets: string[],
    alerts: IntelAlert[]
  ): void {
    const clusterAlert: IntelAlert = {
      id: `cluster-${Date.now()}-${type}`,
      timestamp: Date.now(),
      type: 'anomaly',
      severity: 'critical',
      title: `Alert Cluster Detected: ${type}`,
      description: `${alerts.length} ${type} alerts in last 5 minutes affecting ${affectedAssets.join(', ')}`,
      affectedAssets,
      metrics: {
        alertCount: alerts.length,
        alertTypes: Array.from(new Set(alerts.map(a => a.type))),
        timespan: 300000
      },
      actionRequired: true,
      suggestedActions: [
        'Multiple correlated alerts detected - investigate immediately',
        'Check for systemic issues or coordinated activity',
        'Review all affected positions'
      ]
    };

    this.emit('alert', clusterAlert);
  }

  private checkCrossModuleCorrelations(
    alert: IntelAlert,
    recentAlerts: IntelAlert[]
  ): void {
    // Look for patterns across different alert types
    const correlationPatterns = [
      {
        primary: 'whale',
        secondary: 'sentiment',
        window: 600000, // 10 minutes
        action: 'Whale activity may be influencing sentiment'
      },
      {
        primary: 'onchain',
        secondary: 'macro',
        window: 1800000, // 30 minutes
        action: 'On-chain metrics responding to macro events'
      },
      {
        primary: 'sentiment',
        secondary: 'anomaly',
        window: 300000, // 5 minutes
        action: 'Sentiment driving unusual market behavior'
      }
    ];

    for (const pattern of correlationPatterns) {
      if (alert.type === pattern.primary) {
        const secondaryAlerts = recentAlerts.filter(
          a => a.type === pattern.secondary &&
               a.timestamp > alert.timestamp - pattern.window
        );

        if (secondaryAlerts.length > 0) {
          this.logger.info(`Cross-module correlation detected: ${pattern.action}`, {
            primaryAlert: alert.id,
            secondaryCount: secondaryAlerts.length
          });
        }
      }
    }
  }

  private shouldForwardAlert(alert: IntelAlert): boolean {
    // Check if alert meets forwarding criteria
    const thresholds = this.config.alerts.thresholds;
    
    // Always forward critical alerts
    if (alert.severity === 'critical') return true;
    
    // Check custom thresholds
    for (const [metric, threshold] of Object.entries(thresholds)) {
      if (alert.metrics[metric] && alert.metrics[metric] > threshold) {
        return true;
      }
    }
    
    // Forward high severity alerts that require action
    return alert.severity === 'high' && alert.actionRequired;
  }

  private startReportGeneration(): void {
    // Generate comprehensive reports at regular intervals
    const interval = 3600000; // 1 hour
    
    this.reportInterval = setInterval(() => {
      this.generateIntelReport();
    }, interval);
    
    // Generate initial report
    setTimeout(() => this.generateIntelReport(), 5000);
  }

  private async generateIntelReport(): Promise<void> {
    try {
      const report = await this.compileFullReport();
      this.emit('report', report);
      
      this.logger.info('Market Intelligence Report generated', {
        timestamp: report.timestamp,
        regime: report.marketRegime.regime,
        alertCount: report.alerts.length
      });
    } catch (error) {
      this.logger.error('Failed to generate intel report', error);
    }
  }

  private async compileFullReport(): Promise<IntelReport> {
    // Determine current market regime
    const marketRegime = this.determineMarketRegime();
    
    // Compile key findings
    const keyFindings = this.extractKeyFindings();
    
    // Identify risk events
    const riskEvents = this.macroDataIntegrator.getUpcomingEvents(7);
    
    // Find opportunities
    const opportunities = this.identifyOpportunities();
    
    // Get recent alerts
    const recentAlerts = this.alertBuffer
      .filter(a => a.timestamp > Date.now() - 3600000)
      .sort((a, b) => b.severity === 'critical' ? 1 : a.severity === 'critical' ? -1 : 0)
      .slice(0, 10);
    
    // Generate summary
    const summary = this.generateSummary(marketRegime, keyFindings, opportunities);
    
    return {
      timestamp: Date.now(),
      marketRegime,
      keyFindings,
      riskEvents,
      opportunities,
      correlations: this.getLatestCorrelations(),
      alerts: recentAlerts,
      summary
    };
  }

  private determineMarketRegime(): MarketRegime {
    // Analyze multiple indicators to determine regime
    const indicators = {
      orderflow: this.analyzeOrderflowRegime(),
      sentiment: this.analyzeSentimentRegime(),
      onchain: this.analyzeOnChainRegime(),
      macro: this.analyzeMacroRegime()
    };
    
    // Weight indicators to determine overall regime
    let bullScore = 0;
    let bearScore = 0;
    let volatileScore = 0;
    
    for (const [source, analysis] of Object.entries(indicators)) {
      switch (analysis.regime) {
        case 'bull':
          bullScore += analysis.confidence;
          break;
        case 'bear':
          bearScore += analysis.confidence;
          break;
        case 'volatile':
          volatileScore += analysis.confidence;
          break;
      }
    }
    
    const totalScore = bullScore + bearScore + volatileScore;
    
    let regime: 'bull' | 'bear' | 'neutral' | 'volatile' = 'neutral';
    let confidence = 0;
    
    if (totalScore > 0) {
      if (bullScore / totalScore > 0.6) {
        regime = 'bull';
        confidence = bullScore / totalScore;
      } else if (bearScore / totalScore > 0.6) {
        regime = 'bear';
        confidence = bearScore / totalScore;
      } else if (volatileScore / totalScore > 0.5) {
        regime = 'volatile';
        confidence = volatileScore / totalScore;
      } else {
        confidence = 0.5;
      }
    }
    
    const marketRegime: MarketRegime = {
      regime,
      confidence,
      timestamp: Date.now(),
      indicators: {
        trend: bullScore - bearScore,
        volatility: volatileScore,
        momentum: this.calculateMomentum(),
        breadth: this.calculateBreadth(),
        sentiment: this.getOverallSentiment()
      },
      duration: this.calculateRegimeDuration(regime),
      strength: confidence
    };
    
    // Update regime history
    this.regimeHistory.push(marketRegime);
    if (this.regimeHistory.length > 100) {
      this.regimeHistory.shift();
    }
    
    return marketRegime;
  }

  private analyzeOrderflowRegime(): { regime: string; confidence: number } {
    // Get flow summary for major assets
    const btcFlow = this.orderflowAnalyzer.getOrderflowSummary('binance', 'BTC/USDT');
    const ethFlow = this.orderflowAnalyzer.getOrderflowSummary('binance', 'ETH/USDT');
    
    if (!btcFlow || !ethFlow) {
      return { regime: 'neutral', confidence: 0.3 };
    }
    
    const avgFlowRatio = (btcFlow.flowRatio + ethFlow.flowRatio) / 2;
    const avgImbalance = (btcFlow.imbalanceRatio + ethFlow.imbalanceRatio) / 2;
    
    if (avgFlowRatio > 0.6 && avgImbalance > 0.2) {
      return { regime: 'bull', confidence: 0.8 };
    } else if (avgFlowRatio < 0.4 && avgImbalance < -0.2) {
      return { regime: 'bear', confidence: 0.8 };
    } else if (Math.abs(avgImbalance) > 0.5) {
      return { regime: 'volatile', confidence: 0.7 };
    }
    
    return { regime: 'neutral', confidence: 0.5 };
  }

  private analyzeSentimentRegime(): { regime: string; confidence: number } {
    const sentimentMap = this.sentimentEngine.getMultiAssetSentiment();
    
    let totalSentiment = 0;
    let count = 0;
    
    for (const [asset, sentiment] of sentimentMap) {
      if (['BTC', 'ETH'].includes(asset)) {
        totalSentiment += sentiment.overallSentiment;
        count++;
      }
    }
    
    if (count === 0) {
      return { regime: 'neutral', confidence: 0.3 };
    }
    
    const avgSentiment = totalSentiment / count;
    
    if (avgSentiment > 0.5) {
      return { regime: 'bull', confidence: Math.min(avgSentiment, 0.9) };
    } else if (avgSentiment < -0.5) {
      return { regime: 'bear', confidence: Math.min(Math.abs(avgSentiment), 0.9) };
    }
    
    return { regime: 'neutral', confidence: 0.6 };
  }

  private analyzeOnChainRegime(): { regime: string; confidence: number } {
    const metrics = this.onChainMetrics.getMetricsSummary();
    
    if (!metrics.defiMetrics) {
      return { regime: 'neutral', confidence: 0.3 };
    }
    
    const tvlChange = metrics.defiMetrics.totalValueLockedChange24h;
    const userActivity = metrics.defiMetrics.uniqueUsers24h;
    
    // Normalize user activity (mock baseline: 200k users)
    const userActivityRatio = userActivity / 200000;
    
    if (tvlChange > 0.05 && userActivityRatio > 1.1) {
      return { regime: 'bull', confidence: 0.7 };
    } else if (tvlChange < -0.05 && userActivityRatio < 0.9) {
      return { regime: 'bear', confidence: 0.7 };
    }
    
    return { regime: 'neutral', confidence: 0.5 };
  }

  private analyzeMacroRegime(): { regime: string; confidence: number } {
    const macroSummary = this.macroDataIntegrator.getMacroSummary();
    
    // Check key macro indicators
    const vix = macroSummary.indicators['VIX'];
    const dxy = macroSummary.indicators['DXY'];
    
    if (!vix || !dxy) {
      return { regime: 'neutral', confidence: 0.3 };
    }
    
    if (vix.latestValue > 25) {
      return { regime: 'volatile', confidence: 0.8 };
    } else if (vix.latestValue < 15 && dxy.trend === 'falling') {
      return { regime: 'bull', confidence: 0.7 };
    } else if (vix.latestValue > 20 && dxy.trend === 'rising') {
      return { regime: 'bear', confidence: 0.7 };
    }
    
    return { regime: 'neutral', confidence: 0.5 };
  }

  private calculateMomentum(): number {
    // Calculate market momentum based on recent price action and flows
    const recentAlerts = this.alertBuffer.filter(
      a => a.timestamp > Date.now() - 3600000 && a.type === 'anomaly'
    );
    
    const bullishAlerts = recentAlerts.filter(a => 
      a.description.toLowerCase().includes('buying') ||
      a.description.toLowerCase().includes('accumulation')
    ).length;
    
    const bearishAlerts = recentAlerts.filter(a =>
      a.description.toLowerCase().includes('selling') ||
      a.description.toLowerCase().includes('distribution')
    ).length;
    
    return (bullishAlerts - bearishAlerts) / Math.max(recentAlerts.length, 1);
  }

  private calculateBreadth(): number {
    // Calculate market breadth based on multi-asset analysis
    const sentimentMap = this.sentimentEngine.getMultiAssetSentiment();
    
    let positive = 0;
    let negative = 0;
    
    for (const [asset, sentiment] of sentimentMap) {
      if (sentiment.overallSentiment > 0.1) positive++;
      else if (sentiment.overallSentiment < -0.1) negative++;
    }
    
    const total = positive + negative;
    return total > 0 ? (positive - negative) / total : 0;
  }

  private getOverallSentiment(): number {
    const sentimentMap = this.sentimentEngine.getMultiAssetSentiment();
    
    let weightedSentiment = 0;
    let totalWeight = 0;
    
    // Weight by assumed market cap (simplified)
    const weights: Record<string, number> = {
      BTC: 0.5,
      ETH: 0.3,
      SOL: 0.1,
      MATIC: 0.05,
      LINK: 0.05
    };
    
    for (const [asset, sentiment] of sentimentMap) {
      const weight = weights[asset] || 0.01;
      weightedSentiment += sentiment.overallSentiment * weight;
      totalWeight += weight;
    }
    
    return totalWeight > 0 ? weightedSentiment / totalWeight : 0;
  }

  private calculateRegimeDuration(regime: string): number {
    // Find how long we've been in current regime
    let duration = 0;
    
    for (let i = this.regimeHistory.length - 1; i >= 0; i--) {
      if (this.regimeHistory[i].regime === regime) {
        duration++;
      } else {
        break;
      }
    }
    
    return duration * 3600000; // Convert to milliseconds (assuming hourly updates)
  }

  private extractKeyFindings(): string[] {
    const findings: string[] = [];
    
    // Analyze recent alerts for patterns
    const alertTypes = new Map<string, number>();
    const assetMentions = new Map<string, number>();
    
    for (const alert of this.alertBuffer.filter(a => a.timestamp > Date.now() - 3600000)) {
      alertTypes.set(alert.type, (alertTypes.get(alert.type) || 0) + 1);
      
      for (const asset of alert.affectedAssets) {
        assetMentions.set(asset, (assetMentions.get(asset) || 0) + 1);
      }
    }
    
    // Most common alert type
    const topAlertType = Array.from(alertTypes.entries())
      .sort((a, b) => b[1] - a[1])[0];
    
    if (topAlertType) {
      findings.push(`High ${topAlertType[0]} activity detected (${topAlertType[1]} alerts in last hour)`);
    }
    
    // Most mentioned asset
    const topAsset = Array.from(assetMentions.entries())
      .sort((a, b) => b[1] - a[1])[0];
    
    if (topAsset) {
      findings.push(`${topAsset[0]} showing significant activity (${topAsset[1]} alerts)`);
    }
    
    // Check for whale activity
    const whaleMovements = this.orderflowAnalyzer.getWhaleMovements('BTC', 1);
    if (whaleMovements.length > 5) {
      findings.push(`Elevated whale activity detected: ${whaleMovements.length} large transactions in last hour`);
    }
    
    // Check sentiment extremes
    const btcSentiment = this.sentimentEngine.getMultiAssetSentiment().get('BTC');
    if (btcSentiment && Math.abs(btcSentiment.overallSentiment) > 0.7) {
      findings.push(`Extreme ${btcSentiment.overallSentiment > 0 ? 'bullish' : 'bearish'} sentiment for BTC`);
    }
    
    // Check on-chain anomalies
    const liquidations = this.onChainMetrics.getLiquidations(1);
    if (liquidations.length > 10) {
      const totalVolume = liquidations.reduce((sum, l) => sum + l.debtAmount, 0);
      findings.push(`High liquidation activity: $${(totalVolume / 1000000).toFixed(1)}M in last hour`);
    }
    
    return findings;
  }

  private identifyOpportunities(): Array<{
    asset: string;
    type: string;
    confidence: number;
    reasoning: string;
    expectedReturn: number;
    risk: number;
  }> {
    const opportunities = [];
    
    // Check for oversold conditions with improving sentiment
    const sentimentMap = this.sentimentEngine.getMultiAssetSentiment();
    
    for (const [asset, sentiment] of sentimentMap) {
      if (sentiment.sentimentMomentum > 0.3 && sentiment.overallSentiment < -0.3) {
        opportunities.push({
          asset,
          type: 'contrarian-long',
          confidence: 0.7,
          reasoning: 'Oversold with improving sentiment momentum',
          expectedReturn: 0.1,
          risk: 0.15
        });
      }
    }
    
    // Check for flow divergence opportunities
    const btcFlow = this.orderflowAnalyzer.getOrderflowSummary('binance', 'BTC/USDT');
    if (btcFlow && btcFlow.flowRatio > 0.7 && btcFlow.microstructureScore > 0.8) {
      opportunities.push({
        asset: 'BTC',
        type: 'momentum-long',
        confidence: 0.8,
        reasoning: 'Strong buying pressure with healthy microstructure',
        expectedReturn: 0.08,
        risk: 0.1
      });
    }
    
    // Check for arbitrage opportunities
    const exchangeFlows = this.orderflowAnalyzer.getExchangeFlows('ETH');
    if (exchangeFlows.length > 1) {
      const maxFlow = Math.max(...exchangeFlows.map(f => f.flowRatio));
      const minFlow = Math.min(...exchangeFlows.map(f => f.flowRatio));
      
      if (maxFlow - minFlow > 0.2) {
        opportunities.push({
          asset: 'ETH',
          type: 'arbitrage',
          confidence: 0.9,
          reasoning: 'Significant flow imbalance across exchanges',
          expectedReturn: 0.02,
          risk: 0.03
        });
      }
    }
    
    // Sort by expected risk-adjusted return
    return opportunities
      .map(opp => ({
        ...opp,
        sharpe: opp.expectedReturn / opp.risk
      }))
      .sort((a, b) => b.sharpe - a.sharpe)
      .slice(0, 5);
  }

  private getLatestCorrelations(): CorrelationMatrix {
    // Get BTC correlations as primary reference
    const btcCorrelations = this.macroDataIntegrator.getCorrelationMatrix('BTC');
    
    if (btcCorrelations) {
      this.correlationCache.set('BTC', btcCorrelations);
      return btcCorrelations;
    }
    
    // Return cached or empty matrix
    return this.correlationCache.get('BTC') || {
      assets: [],
      timeframe: '30d',
      correlations: [],
      timestamp: Date.now(),
      significance: [],
      rollingWindow: 30
    };
  }

  private generateSummary(
    regime: MarketRegime,
    keyFindings: string[],
    opportunities: any[]
  ): string {
    const regimeDesc = regime.regime === 'bull' ? 'bullish' :
                      regime.regime === 'bear' ? 'bearish' :
                      regime.regime === 'volatile' ? 'volatile' : 'neutral';
    
    let summary = `Market is in a ${regimeDesc} regime with ${(regime.confidence * 100).toFixed(0)}% confidence. `;
    
    if (keyFindings.length > 0) {
      summary += `Key observations: ${keyFindings[0]}. `;
    }
    
    if (opportunities.length > 0) {
      summary += `${opportunities.length} trading opportunities identified, `;
      summary += `best opportunity: ${opportunities[0].type} on ${opportunities[0].asset}. `;
    }
    
    const recentCriticalAlerts = this.alertBuffer.filter(
      a => a.severity === 'critical' && a.timestamp > Date.now() - 3600000
    ).length;
    
    if (recentCriticalAlerts > 0) {
      summary += `WARNING: ${recentCriticalAlerts} critical alerts in the last hour require immediate attention.`;
    }
    
    return summary;
  }

  // Public API methods
  
  getLatestReport(): IntelReport | null {
    // Return the last generated report
    // In production, this would retrieve from storage
    return null;
  }

  getAlertHistory(hours: number = 24): IntelAlert[] {
    const cutoff = Date.now() - hours * 3600000;
    return this.alertBuffer
      .filter(a => a.timestamp > cutoff)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  getAssetIntelligence(asset: string): any {
    return {
      orderflow: this.orderflowAnalyzer.getOrderflowSummary('binance', `${asset}/USDT`),
      sentiment: this.sentimentEngine.getSentimentSummary(asset),
      whaleActivity: this.orderflowAnalyzer.getWhaleMovements(asset, 24),
      correlations: this.macroDataIntegrator.getCorrelationMatrix(asset),
      alerts: this.alertBuffer.filter(a => a.affectedAssets.includes(asset))
    };
  }

  subscribeToAlerts(
    callback: (alert: IntelAlert) => void,
    filter?: { severity?: string; type?: string; assets?: string[] }
  ): () => void {
    const handler = (alert: IntelAlert) => {
      // Apply filters if provided
      if (filter) {
        if (filter.severity && alert.severity !== filter.severity) return;
        if (filter.type && alert.type !== filter.type) return;
        if (filter.assets && !filter.assets.some(a => alert.affectedAssets.includes(a))) return;
      }
      
      callback(alert);
    };
    
    this.on('alert', handler);
    
    // Return unsubscribe function
    return () => this.off('alert', handler);
  }

  subscribeToReports(callback: (report: IntelReport) => void): () => void {
    this.on('report', callback);
    return () => this.off('report', callback);
  }
} 