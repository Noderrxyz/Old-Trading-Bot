import EventEmitter from 'events';
import { Logger } from 'winston';
import {
  OrderflowData,
  WhaleMovement,
  ExchangeFlow,
  OrderbookImbalance,
  IntelAlert,
  IntelError,
  IntelErrorCode,
  DataSource
} from './types';

export class OrderflowAnalyzer extends EventEmitter {
  private orderflowBuffer: Map<string, OrderflowData[]>;
  private whaleMovements: Map<string, WhaleMovement[]>;
  private exchangeFlows: Map<string, ExchangeFlow>;
  private orderbookImbalances: Map<string, OrderbookImbalance>;
  private volumeProfiles: Map<string, VolumeProfile>;
  private microstructureMetrics: Map<string, MicrostructureMetrics>;
  private dataSources: Map<string, DataSource>;
  private isRunning: boolean = false;
  private updateInterval: NodeJS.Timeout | null = null;

  constructor(
    private logger: Logger,
    private config: {
      exchanges: string[];
      whaleThreshold: number;
      updateInterval: number;
      volumeProfileBins: number;
      imbalanceThreshold: number;
      flowAnalysisWindow: number;
    }
  ) {
    super();
    this.orderflowBuffer = new Map();
    this.whaleMovements = new Map();
    this.exchangeFlows = new Map();
    this.orderbookImbalances = new Map();
    this.volumeProfiles = new Map();
    this.microstructureMetrics = new Map();
    this.dataSources = new Map();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new IntelError(
        IntelErrorCode.INVALID_CONFIG,
        'OrderflowAnalyzer is already running'
      );
    }

    this.logger.info('Starting Orderflow Analyzer', {
      exchanges: this.config.exchanges,
      whaleThreshold: this.config.whaleThreshold
    });

    try {
      await this.initializeDataSources();
      await this.startDataStreams();
      this.startAnalysisLoop();
      this.isRunning = true;
    } catch (error) {
      this.logger.error('Failed to start Orderflow Analyzer', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.logger.info('Stopping Orderflow Analyzer');
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    await this.stopDataStreams();
    this.isRunning = false;
  }

  private async initializeDataSources(): Promise<void> {
    for (const exchange of this.config.exchanges) {
      // Initialize exchange-specific data sources
      const dataSource: DataSource = {
        name: exchange,
        type: 'websocket',
        endpoint: this.getExchangeEndpoint(exchange),
        status: 'inactive',
        lastUpdate: 0,
        reliability: 1.0
      };
      
      this.dataSources.set(exchange, dataSource);
    }
  }

  private getExchangeEndpoint(exchange: string): string {
    // Map exchanges to their WebSocket endpoints
    const endpoints: Record<string, string> = {
      binance: 'wss://stream.binance.com:9443/ws',
      coinbase: 'wss://ws-feed.exchange.coinbase.com',
      ftx: 'wss://ftx.com/ws/',
      okex: 'wss://ws.okex.com:8443/ws/v5/public',
      huobi: 'wss://api.huobi.pro/ws',
      kraken: 'wss://ws.kraken.com'
    };
    
    return endpoints[exchange] || '';
  }

  private async startDataStreams(): Promise<void> {
    // Start WebSocket connections for real-time orderflow
    for (const [exchange, dataSource] of this.dataSources) {
      try {
        await this.connectToExchange(exchange, dataSource);
        dataSource.status = 'active';
      } catch (error) {
        this.logger.error(`Failed to connect to ${exchange}`, error);
        dataSource.status = 'error';
      }
    }
  }

  private async connectToExchange(exchange: string, dataSource: DataSource): Promise<void> {
    // Simulate connection - in production, use actual WebSocket libraries
    this.logger.info(`Connecting to ${exchange} orderflow stream`);
    
    // Subscribe to trades, order book updates, and large transactions
    const subscriptions = ['trades', 'orderbook', 'largeTransactions'];
    
    // Set up data handlers
    this.setupDataHandlers(exchange);
  }

  private setupDataHandlers(exchange: string): void {
    // Handle incoming orderflow data
    setInterval(() => {
      // Simulate orderflow data
      const mockOrderflow = this.generateMockOrderflow(exchange);
      this.processOrderflow(mockOrderflow);
    }, 100);
  }

  private generateMockOrderflow(exchange: string): OrderflowData {
    const pairs = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
    const pair = pairs[Math.floor(Math.random() * pairs.length)];
    const size = Math.random() * 100;
    const price = this.getMockPrice(pair);
    
    return {
      timestamp: Date.now(),
      exchange,
      pair,
      side: Math.random() > 0.5 ? 'buy' : 'sell',
      size,
      price,
      aggressor: Math.random() > 0.5 ? 'maker' : 'taker',
      isWhale: size * price > this.config.whaleThreshold,
      orderType: 'market',
      metadata: {
        orderId: `${exchange}-${Date.now()}-${Math.random()}`
      }
    };
  }

  private getMockPrice(pair: string): number {
    const prices: Record<string, number> = {
      'BTC/USDT': 65000 + Math.random() * 1000,
      'ETH/USDT': 3500 + Math.random() * 100,
      'SOL/USDT': 150 + Math.random() * 10
    };
    
    return prices[pair] || 100;
  }

  private processOrderflow(data: OrderflowData): void {
    const key = `${data.exchange}:${data.pair}`;
    
    // Add to buffer
    if (!this.orderflowBuffer.has(key)) {
      this.orderflowBuffer.set(key, []);
    }
    
    const buffer = this.orderflowBuffer.get(key)!;
    buffer.push(data);
    
    // Keep buffer size manageable
    if (buffer.length > 10000) {
      buffer.shift();
    }
    
    // Check for whale activity
    if (data.isWhale) {
      this.processWhaleActivity(data);
    }
    
    // Update volume profile
    this.updateVolumeProfile(data);
    
    // Update microstructure metrics
    this.updateMicrostructure(data);
  }

  private processWhaleActivity(data: OrderflowData): void {
    const whale: WhaleMovement = {
      timestamp: data.timestamp,
      walletAddress: 'unknown', // Would need blockchain data
      asset: data.pair.split('/')[0],
      amount: data.size,
      direction: data.side === 'buy' ? 'in' : 'out',
      source: data.exchange,
      destination: data.exchange,
      txHash: data.metadata?.orderId || '',
      usdValue: data.size * data.price,
      impactScore: this.calculateImpactScore(data),
      confidence: 0.8
    };
    
    const key = whale.asset;
    if (!this.whaleMovements.has(key)) {
      this.whaleMovements.set(key, []);
    }
    
    this.whaleMovements.get(key)!.push(whale);
    
    // Emit whale alert if significant
    if (whale.impactScore > 80) {
      this.emitWhaleAlert(whale, data);
    }
  }

  private calculateImpactScore(data: OrderflowData): number {
    // Calculate market impact score based on size, price movement, and market conditions
    const sizeScore = Math.min((data.size * data.price) / this.config.whaleThreshold * 20, 40);
    const aggressorScore = data.aggressor === 'taker' ? 20 : 10;
    const marketScore = data.orderType === 'market' ? 20 : 10;
    
    // Add time-based clustering bonus
    const recentWhales = this.getRecentWhaleCount(data.pair, 300000); // 5 minutes
    const clusterScore = Math.min(recentWhales * 5, 20);
    
    return Math.min(sizeScore + aggressorScore + marketScore + clusterScore, 100);
  }

  private getRecentWhaleCount(pair: string, timeWindow: number): number {
    const asset = pair.split('/')[0];
    const whales = this.whaleMovements.get(asset) || [];
    const cutoff = Date.now() - timeWindow;
    
    return whales.filter(w => w.timestamp > cutoff).length;
  }

  private emitWhaleAlert(whale: WhaleMovement, orderflow: OrderflowData): void {
    const alert: IntelAlert = {
      id: `whale-${whale.timestamp}-${whale.asset}`,
      timestamp: whale.timestamp,
      type: 'whale',
      severity: whale.impactScore > 90 ? 'critical' : 'high',
      title: `Whale ${whale.direction === 'in' ? 'Accumulation' : 'Distribution'} Detected`,
      description: `Large ${orderflow.side} order of ${whale.amount.toFixed(2)} ${whale.asset} ($${whale.usdValue.toFixed(0)}) on ${orderflow.exchange}`,
      affectedAssets: [whale.asset],
      metrics: {
        amount: whale.amount,
        usdValue: whale.usdValue,
        impactScore: whale.impactScore,
        exchange: orderflow.exchange,
        price: orderflow.price
      },
      actionRequired: whale.impactScore > 90,
      suggestedActions: [
        whale.direction === 'in' ? 'Consider following whale accumulation' : 'Monitor for potential selling pressure',
        'Check correlated assets for similar patterns',
        'Review position sizing and risk parameters'
      ]
    };
    
    this.emit('alert', alert);
  }

  private updateVolumeProfile(data: OrderflowData): void {
    const key = `${data.exchange}:${data.pair}`;
    
    if (!this.volumeProfiles.has(key)) {
      this.volumeProfiles.set(key, new VolumeProfile(this.config.volumeProfileBins));
    }
    
    const profile = this.volumeProfiles.get(key)!;
    profile.addTrade(data.price, data.size, data.side);
  }

  private updateMicrostructure(data: OrderflowData): void {
    const key = `${data.exchange}:${data.pair}`;
    
    if (!this.microstructureMetrics.has(key)) {
      this.microstructureMetrics.set(key, new MicrostructureMetrics());
    }
    
    const metrics = this.microstructureMetrics.get(key)!;
    metrics.update(data);
  }

  private startAnalysisLoop(): void {
    this.updateInterval = setInterval(() => {
      this.analyzeOrderflow();
      this.analyzeExchangeFlows();
      this.analyzeOrderbookImbalances();
      this.detectAnomalies();
    }, this.config.updateInterval);
  }

  private analyzeOrderflow(): void {
    for (const [key, buffer] of this.orderflowBuffer) {
      if (buffer.length === 0) continue;
      
      const [exchange, pair] = key.split(':');
      const recentTrades = buffer.filter(t => t.timestamp > Date.now() - this.config.flowAnalysisWindow);
      
      // Calculate flow metrics
      const buyVolume = recentTrades
        .filter(t => t.side === 'buy')
        .reduce((sum, t) => sum + t.size * t.price, 0);
        
      const sellVolume = recentTrades
        .filter(t => t.side === 'sell')
        .reduce((sum, t) => sum + t.size * t.price, 0);
        
      const netFlow = buyVolume - sellVolume;
      const totalVolume = buyVolume + sellVolume;
      const flowRatio = totalVolume > 0 ? buyVolume / totalVolume : 0.5;
      
      // Calculate VWAP
      const vwap = totalVolume > 0
        ? recentTrades.reduce((sum, t) => sum + t.price * t.size * t.price, 0) / totalVolume
        : 0;
        
      // Count large and whale transactions
      const largeTransactions = recentTrades.filter(t => t.size * t.price > this.config.whaleThreshold * 0.1).length;
      const whaleTransactions = recentTrades.filter(t => t.isWhale).length;
      
      const flow: ExchangeFlow = {
        exchange,
        asset: pair.split('/')[0],
        period: `${this.config.flowAnalysisWindow / 1000}s`,
        netFlow,
        inflow: buyVolume,
        outflow: sellVolume,
        flowRatio,
        volumeWeightedAvgPrice: vwap,
        largeTransactions,
        whaleTransactions
      };
      
      this.exchangeFlows.set(key, flow);
      
      // Emit flow alert if significant imbalance
      if (Math.abs(flowRatio - 0.5) > 0.3 && totalVolume > this.config.whaleThreshold) {
        this.emitFlowAlert(flow);
      }
    }
  }

  private emitFlowAlert(flow: ExchangeFlow): void {
    const direction = flow.flowRatio > 0.5 ? 'Buying' : 'Selling';
    const strength = Math.abs(flow.flowRatio - 0.5) * 200; // Convert to percentage
    
    const alert: IntelAlert = {
      id: `flow-${Date.now()}-${flow.asset}`,
      timestamp: Date.now(),
      type: 'anomaly',
      severity: strength > 80 ? 'high' : 'medium',
      title: `Strong ${direction} Pressure on ${flow.exchange}`,
      description: `${flow.asset} showing ${strength.toFixed(0)}% ${direction.toLowerCase()} pressure with $${(flow.netFlow / 1000000).toFixed(2)}M net ${direction.toLowerCase()} volume`,
      affectedAssets: [flow.asset],
      metrics: {
        flowRatio: flow.flowRatio,
        netFlow: flow.netFlow,
        inflow: flow.inflow,
        outflow: flow.outflow,
        vwap: flow.volumeWeightedAvgPrice,
        whaleTransactions: flow.whaleTransactions
      },
      actionRequired: strength > 80,
      suggestedActions: [
        `Monitor ${flow.asset} for potential ${direction.toLowerCase()} continuation`,
        'Check other exchanges for similar patterns',
        'Review position exposure to ${flow.asset}'
      ]
    };
    
    this.emit('alert', alert);
  }

  private analyzeExchangeFlows(): void {
    // Aggregate flows across exchanges for each asset
    const assetFlows = new Map<string, AggregatedFlow>();
    
    for (const [key, flow] of this.exchangeFlows) {
      const asset = flow.asset;
      
      if (!assetFlows.has(asset)) {
        assetFlows.set(asset, {
          asset,
          totalNetFlow: 0,
          totalInflow: 0,
          totalOutflow: 0,
          exchanges: [],
          dominantExchange: '',
          convergence: 0
        });
      }
      
      const aggregated = assetFlows.get(asset)!;
      aggregated.totalNetFlow += flow.netFlow;
      aggregated.totalInflow += flow.inflow;
      aggregated.totalOutflow += flow.outflow;
      aggregated.exchanges.push({
        exchange: flow.exchange,
        netFlow: flow.netFlow,
        flowRatio: flow.flowRatio
      });
    }
    
    // Calculate convergence and dominant exchange
    for (const [asset, aggregated] of assetFlows) {
      if (aggregated.exchanges.length > 1) {
        // Find dominant exchange
        aggregated.exchanges.sort((a, b) => Math.abs(b.netFlow) - Math.abs(a.netFlow));
        aggregated.dominantExchange = aggregated.exchanges[0].exchange;
        
        // Calculate convergence (how aligned are the flows across exchanges)
        const flowDirections = aggregated.exchanges.map(e => Math.sign(e.netFlow));
        const sameDirection = flowDirections.every(d => d === flowDirections[0]);
        aggregated.convergence = sameDirection ? 1.0 : 0.5;
        
        // Emit alert for strong cross-exchange convergence
        if (sameDirection && Math.abs(aggregated.totalNetFlow) > this.config.whaleThreshold * 5) {
          this.emitConvergenceAlert(aggregated);
        }
      }
    }
  }

  private emitConvergenceAlert(flow: AggregatedFlow): void {
    const direction = flow.totalNetFlow > 0 ? 'Buying' : 'Selling';
    
    const alert: IntelAlert = {
      id: `convergence-${Date.now()}-${flow.asset}`,
      timestamp: Date.now(),
      type: 'anomaly',
      severity: 'critical',
      title: `Cross-Exchange ${direction} Convergence`,
      description: `${flow.asset} showing coordinated ${direction.toLowerCase()} across ${flow.exchanges.length} exchanges with $${(Math.abs(flow.totalNetFlow) / 1000000).toFixed(2)}M total volume`,
      affectedAssets: [flow.asset],
      metrics: {
        totalNetFlow: flow.totalNetFlow,
        exchanges: flow.exchanges,
        dominantExchange: flow.dominantExchange,
        convergence: flow.convergence
      },
      actionRequired: true,
      suggestedActions: [
        `Strong ${direction.toLowerCase()} signal - consider position adjustment`,
        'Monitor for potential price breakout',
        'Check news for fundamental catalyst'
      ]
    };
    
    this.emit('alert', alert);
  }

  private analyzeOrderbookImbalances(): void {
    // Analyze order book depth and imbalances
    for (const [key, profile] of this.volumeProfiles) {
      const [exchange, pair] = key.split(':');
      const metrics = this.microstructureMetrics.get(key);
      
      if (!metrics) continue;
      
      const imbalance: OrderbookImbalance = {
        exchange,
        pair,
        timestamp: Date.now(),
        bidDepth: metrics.getBidDepth(),
        askDepth: metrics.getAskDepth(),
        imbalanceRatio: metrics.getImbalanceRatio(),
        bidWallSize: metrics.getLargestBidWall(),
        askWallSize: metrics.getLargestAskWall(),
        microstructureScore: metrics.getMicrostructureScore(),
        liquidityScore: metrics.getLiquidityScore()
      };
      
      this.orderbookImbalances.set(key, imbalance);
      
      // Emit alert for significant imbalances
      if (Math.abs(imbalance.imbalanceRatio) > this.config.imbalanceThreshold) {
        this.emitImbalanceAlert(imbalance);
      }
    }
  }

  private emitImbalanceAlert(imbalance: OrderbookImbalance): void {
    const side = imbalance.imbalanceRatio > 0 ? 'Bid' : 'Ask';
    const strength = Math.abs(imbalance.imbalanceRatio) * 100;
    
    const alert: IntelAlert = {
      id: `imbalance-${Date.now()}-${imbalance.pair}`,
      timestamp: Date.now(),
      type: 'anomaly',
      severity: strength > 80 ? 'high' : 'medium',
      title: `Order Book ${side} Imbalance`,
      description: `${imbalance.pair} on ${imbalance.exchange} showing ${strength.toFixed(0)}% ${side.toLowerCase()} side dominance`,
      affectedAssets: [imbalance.pair.split('/')[0]],
      metrics: {
        imbalanceRatio: imbalance.imbalanceRatio,
        bidDepth: imbalance.bidDepth,
        askDepth: imbalance.askDepth,
        microstructureScore: imbalance.microstructureScore
      },
      actionRequired: false,
      suggestedActions: [
        `${side} pressure building - potential ${side === 'Bid' ? 'support' : 'resistance'}`,
        'Monitor for absorption or breakout',
        'Consider limit orders on weak side'
      ]
    };
    
    this.emit('alert', alert);
  }

  private detectAnomalies(): void {
    // Detect unusual patterns in orderflow
    for (const [key, buffer] of this.orderflowBuffer) {
      if (buffer.length < 100) continue;
      
      // Detect wash trading patterns
      const washTrades = this.detectWashTrading(buffer);
      if (washTrades.detected) {
        this.emitWashTradingAlert(key, washTrades);
      }
      
      // Detect spoofing patterns
      const spoofing = this.detectSpoofing(buffer);
      if (spoofing.detected) {
        this.emitSpoofingAlert(key, spoofing);
      }
      
      // Detect momentum ignition
      const momentum = this.detectMomentumIgnition(buffer);
      if (momentum.detected) {
        this.emitMomentumAlert(key, momentum);
      }
    }
  }

  private detectWashTrading(trades: OrderflowData[]): AnomalyResult {
    // Look for rapid buy/sell patterns with similar sizes
    const recentTrades = trades.slice(-50);
    let suspiciousPatterns = 0;
    
    for (let i = 1; i < recentTrades.length; i++) {
      const current = recentTrades[i];
      const previous = recentTrades[i - 1];
      
      // Check for rapid alternating trades with similar sizes
      if (
        current.side !== previous.side &&
        Math.abs(current.size - previous.size) / current.size < 0.05 &&
        current.timestamp - previous.timestamp < 1000
      ) {
        suspiciousPatterns++;
      }
    }
    
    const confidence = Math.min(suspiciousPatterns / 10, 1.0);
    
    return {
      detected: confidence > 0.7,
      confidence,
      evidence: `${suspiciousPatterns} suspicious trade pairs detected`,
      severity: confidence > 0.9 ? 'high' : 'medium'
    };
  }

  private detectSpoofing(trades: OrderflowData[]): AnomalyResult {
    // Look for large orders that don't execute
    const profile = this.volumeProfiles.get(
      `${trades[0]?.exchange}:${trades[0]?.pair}`
    );
    
    if (!profile) {
      return { detected: false, confidence: 0, evidence: '', severity: 'low' };
    }
    
    // Check for walls that appear and disappear
    const wallMovements = profile.getWallMovements();
    const spoofingScore = wallMovements.disappearances / 
      (wallMovements.appearances + 1);
    
    return {
      detected: spoofingScore > 0.6,
      confidence: spoofingScore,
      evidence: `${wallMovements.disappearances} wall disappearances detected`,
      severity: spoofingScore > 0.8 ? 'high' : 'medium'
    };
  }

  private detectMomentumIgnition(trades: OrderflowData[]): AnomalyResult {
    // Look for aggressive trades designed to trigger stops
    const recentTrades = trades.slice(-20);
    const aggressiveTrades = recentTrades.filter(t => 
      t.aggressor === 'taker' && 
      t.orderType === 'market' &&
      t.size * t.price > this.config.whaleThreshold * 0.5
    );
    
    const momentum = aggressiveTrades.length / recentTrades.length;
    const sameSide = aggressiveTrades.every(t => t.side === aggressiveTrades[0]?.side);
    
    return {
      detected: momentum > 0.5 && sameSide,
      confidence: momentum,
      evidence: `${aggressiveTrades.length} aggressive ${aggressiveTrades[0]?.side} orders`,
      severity: momentum > 0.7 ? 'critical' : 'high'
    };
  }

  private emitWashTradingAlert(key: string, anomaly: AnomalyResult): void {
    const [exchange, pair] = key.split(':');
    
    const alert: IntelAlert = {
      id: `wash-${Date.now()}-${pair}`,
      timestamp: Date.now(),
      type: 'anomaly',
      severity: anomaly.severity as any,
      title: 'Potential Wash Trading Detected',
      description: `Suspicious trading patterns on ${pair} at ${exchange}. ${anomaly.evidence}`,
      affectedAssets: [pair.split('/')[0]],
      metrics: {
        confidence: anomaly.confidence,
        evidence: anomaly.evidence
      },
      actionRequired: anomaly.severity === 'high',
      suggestedActions: [
        'Exercise caution with market orders',
        'Use limit orders to avoid manipulation',
        'Consider trading on alternative exchanges'
      ]
    };
    
    this.emit('alert', alert);
  }

  private emitSpoofingAlert(key: string, anomaly: AnomalyResult): void {
    const [exchange, pair] = key.split(':');
    
    const alert: IntelAlert = {
      id: `spoof-${Date.now()}-${pair}`,
      timestamp: Date.now(),
      type: 'anomaly',
      severity: anomaly.severity as any,
      title: 'Order Book Spoofing Detected',
      description: `Fake walls appearing/disappearing on ${pair} at ${exchange}. ${anomaly.evidence}`,
      affectedAssets: [pair.split('/')[0]],
      metrics: {
        confidence: anomaly.confidence,
        evidence: anomaly.evidence
      },
      actionRequired: false,
      suggestedActions: [
        'Ignore large walls in decision making',
        'Focus on actual executed volume',
        'Monitor for real support/resistance levels'
      ]
    };
    
    this.emit('alert', alert);
  }

  private emitMomentumAlert(key: string, anomaly: AnomalyResult): void {
    const [exchange, pair] = key.split(':');
    
    const alert: IntelAlert = {
      id: `momentum-${Date.now()}-${pair}`,
      timestamp: Date.now(),
      type: 'anomaly',
      severity: anomaly.severity as any,
      title: 'Momentum Ignition Detected',
      description: `Aggressive ${anomaly.evidence} on ${pair} at ${exchange} potentially triggering stops`,
      affectedAssets: [pair.split('/')[0]],
      metrics: {
        confidence: anomaly.confidence,
        evidence: anomaly.evidence
      },
      actionRequired: anomaly.severity === 'critical',
      suggestedActions: [
        'Check stop loss placement',
        'Consider momentum following if confirmed',
        'Watch for reversal after stop hunting'
      ]
    };
    
    this.emit('alert', alert);
  }

  private async stopDataStreams(): Promise<void> {
    for (const [exchange, dataSource] of this.dataSources) {
      try {
        // Close WebSocket connections
        dataSource.status = 'inactive';
        this.logger.info(`Disconnected from ${exchange}`);
      } catch (error) {
        this.logger.error(`Error disconnecting from ${exchange}`, error);
      }
    }
  }

  // Public methods for querying analyzed data
  
  getOrderflowSummary(exchange: string, pair: string): OrderflowSummary | null {
    const key = `${exchange}:${pair}`;
    const flow = this.exchangeFlows.get(key);
    const imbalance = this.orderbookImbalances.get(key);
    const profile = this.volumeProfiles.get(key);
    
    if (!flow) return null;
    
    return {
      exchange,
      pair,
      netFlow: flow.netFlow,
      flowRatio: flow.flowRatio,
      vwap: flow.volumeWeightedAvgPrice,
      imbalanceRatio: imbalance?.imbalanceRatio || 0,
      microstructureScore: imbalance?.microstructureScore || 0,
      volumeProfile: profile?.getProfile() || [],
      whaleActivity: this.getRecentWhaleCount(pair.split('/')[0], 3600000),
      lastUpdate: Date.now()
    };
  }

  getWhaleMovements(asset: string, hours: number = 24): WhaleMovement[] {
    const movements = this.whaleMovements.get(asset) || [];
    const cutoff = Date.now() - hours * 3600000;
    
    return movements
      .filter(m => m.timestamp > cutoff)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  getExchangeFlows(asset: string): ExchangeFlow[] {
    const flows: ExchangeFlow[] = [];
    
    for (const [key, flow] of this.exchangeFlows) {
      if (flow.asset === asset) {
        flows.push(flow);
      }
    }
    
    return flows;
  }

  getMarketMicrostructure(exchange: string, pair: string): MicrostructureReport | null {
    const key = `${exchange}:${pair}`;
    const metrics = this.microstructureMetrics.get(key);
    const profile = this.volumeProfiles.get(key);
    
    if (!metrics || !profile) return null;
    
    return {
      exchange,
      pair,
      spreadMetrics: metrics.getSpreadMetrics(),
      liquidityMetrics: metrics.getLiquidityMetrics(),
      toxicityMetrics: metrics.getToxicityMetrics(),
      volumeDistribution: profile.getDistribution(),
      priceImpact: metrics.getPriceImpactCurve(),
      timestamp: Date.now()
    };
  }
}

// Supporting classes

class VolumeProfile {
  private bins: number;
  private profile: Map<number, { buyVolume: number; sellVolume: number }>;
  private priceRange: { min: number; max: number };
  private wallMovements: { appearances: number; disappearances: number };

  constructor(bins: number) {
    this.bins = bins;
    this.profile = new Map();
    this.priceRange = { min: Infinity, max: -Infinity };
    this.wallMovements = { appearances: 0, disappearances: 0 };
  }

  addTrade(price: number, size: number, side: 'buy' | 'sell'): void {
    // Update price range
    this.priceRange.min = Math.min(this.priceRange.min, price);
    this.priceRange.max = Math.max(this.priceRange.max, price);
    
    // Calculate bin
    const bin = this.calculateBin(price);
    
    if (!this.profile.has(bin)) {
      this.profile.set(bin, { buyVolume: 0, sellVolume: 0 });
    }
    
    const binData = this.profile.get(bin)!;
    if (side === 'buy') {
      binData.buyVolume += size;
    } else {
      binData.sellVolume += size;
    }
  }

  private calculateBin(price: number): number {
    const range = this.priceRange.max - this.priceRange.min;
    if (range === 0) return price;
    
    const binSize = range / this.bins;
    return Math.floor((price - this.priceRange.min) / binSize) * binSize + this.priceRange.min;
  }

  getProfile(): Array<{ price: number; buyVolume: number; sellVolume: number; netVolume: number }> {
    const result = [];
    
    for (const [price, volumes] of this.profile) {
      result.push({
        price,
        buyVolume: volumes.buyVolume,
        sellVolume: volumes.sellVolume,
        netVolume: volumes.buyVolume - volumes.sellVolume
      });
    }
    
    return result.sort((a, b) => a.price - b.price);
  }

  getDistribution(): { price: number; volume: number; percentile: number }[] {
    const profile = this.getProfile();
    const totalVolume = profile.reduce((sum, p) => sum + p.buyVolume + p.sellVolume, 0);
    
    let cumulativeVolume = 0;
    return profile.map(p => {
      cumulativeVolume += p.buyVolume + p.sellVolume;
      return {
        price: p.price,
        volume: p.buyVolume + p.sellVolume,
        percentile: (cumulativeVolume / totalVolume) * 100
      };
    });
  }

  getWallMovements(): { appearances: number; disappearances: number } {
    return this.wallMovements;
  }
}

class MicrostructureMetrics {
  private trades: OrderflowData[] = [];
  private spreadHistory: number[] = [];
  private liquidityEvents: LiquidityEvent[] = [];
  private priceImpactCurve: Map<number, number> = new Map();

  update(trade: OrderflowData): void {
    this.trades.push(trade);
    
    // Keep only recent trades
    const cutoff = Date.now() - 300000; // 5 minutes
    this.trades = this.trades.filter(t => t.timestamp > cutoff);
    
    // Update metrics
    this.updateSpread();
    this.updateLiquidity();
    this.updatePriceImpact();
  }

  private updateSpread(): void {
    // Calculate effective spread from trades
    if (this.trades.length < 2) return;
    
    const lastTrade = this.trades[this.trades.length - 1];
    const prevTrade = this.trades[this.trades.length - 2];
    
    if (lastTrade.side !== prevTrade.side) {
      const spread = Math.abs(lastTrade.price - prevTrade.price);
      this.spreadHistory.push(spread);
      
      // Keep history size manageable
      if (this.spreadHistory.length > 1000) {
        this.spreadHistory.shift();
      }
    }
  }

  private updateLiquidity(): void {
    // Track liquidity provision/taking events
    const lastTrade = this.trades[this.trades.length - 1];
    
    const event: LiquidityEvent = {
      timestamp: lastTrade.timestamp,
      type: lastTrade.aggressor === 'maker' ? 'provide' : 'take',
      size: lastTrade.size,
      price: lastTrade.price,
      impact: this.calculateInstantImpact(lastTrade)
    };
    
    this.liquidityEvents.push(event);
    
    // Keep history size manageable
    if (this.liquidityEvents.length > 1000) {
      this.liquidityEvents.shift();
    }
  }

  private calculateInstantImpact(trade: OrderflowData): number {
    // Calculate price impact of the trade
    const recentTrades = this.trades.slice(-10);
    if (recentTrades.length < 2) return 0;
    
    const prePriceMean = recentTrades
      .slice(0, -1)
      .reduce((sum, t) => sum + t.price, 0) / (recentTrades.length - 1);
      
    return Math.abs(trade.price - prePriceMean) / prePriceMean;
  }

  private updatePriceImpact(): void {
    // Build price impact curve from trade data
    const sizeGroups = new Map<number, number[]>();
    
    for (let i = 1; i < this.trades.length; i++) {
      const trade = this.trades[i];
      const prevPrice = this.trades[i - 1].price;
      const impact = Math.abs(trade.price - prevPrice) / prevPrice;
      
      // Group by size buckets
      const sizeBucket = Math.floor(trade.size / 10) * 10;
      
      if (!sizeGroups.has(sizeBucket)) {
        sizeGroups.set(sizeBucket, []);
      }
      
      sizeGroups.get(sizeBucket)!.push(impact);
    }
    
    // Calculate average impact per size bucket
    this.priceImpactCurve.clear();
    for (const [size, impacts] of sizeGroups) {
      if (impacts.length > 0) {
        const avgImpact = impacts.reduce((sum, i) => sum + i, 0) / impacts.length;
        this.priceImpactCurve.set(size, avgImpact);
      }
    }
  }

  getBidDepth(): number {
    const buyTrades = this.trades.filter(t => t.side === 'buy');
    return buyTrades.reduce((sum, t) => sum + t.size * t.price, 0);
  }

  getAskDepth(): number {
    const sellTrades = this.trades.filter(t => t.side === 'sell');
    return sellTrades.reduce((sum, t) => sum + t.size * t.price, 0);
  }

  getImbalanceRatio(): number {
    const bidDepth = this.getBidDepth();
    const askDepth = this.getAskDepth();
    const total = bidDepth + askDepth;
    
    return total > 0 ? (bidDepth - askDepth) / total : 0;
  }

  getLargestBidWall(): number {
    const buyTrades = this.trades.filter(t => t.side === 'buy');
    return Math.max(...buyTrades.map(t => t.size * t.price), 0);
  }

  getLargestAskWall(): number {
    const sellTrades = this.trades.filter(t => t.side === 'sell');
    return Math.max(...sellTrades.map(t => t.size * t.price), 0);
  }

  getMicrostructureScore(): number {
    // Composite score of market quality
    const spreadScore = this.getSpreadScore();
    const liquidityScore = this.getLiquidityScore();
    const toxicityScore = 1 - this.getToxicityScore();
    
    return (spreadScore + liquidityScore + toxicityScore) / 3;
  }

  private getSpreadScore(): number {
    if (this.spreadHistory.length === 0) return 0.5;
    
    const avgSpread = this.spreadHistory.reduce((sum, s) => sum + s, 0) / this.spreadHistory.length;
    const lastPrice = this.trades[this.trades.length - 1]?.price || 1;
    const spreadBps = (avgSpread / lastPrice) * 10000;
    
    // Score based on spread in basis points
    return Math.max(0, Math.min(1, 1 - spreadBps / 100));
  }

  getLiquidityScore(): number {
    // Score based on liquidity provision vs taking
    const providers = this.liquidityEvents.filter(e => e.type === 'provide').length;
    const takers = this.liquidityEvents.filter(e => e.type === 'take').length;
    const total = providers + takers;
    
    return total > 0 ? providers / total : 0.5;
  }

  private getToxicityScore(): number {
    // Score based on adverse selection (toxic flow)
    const recentEvents = this.liquidityEvents.slice(-50);
    if (recentEvents.length === 0) return 0;
    
    const toxicEvents = recentEvents.filter(e => e.impact > 0.001).length;
    return toxicEvents / recentEvents.length;
  }

  getSpreadMetrics(): SpreadMetrics {
    const spreads = this.spreadHistory;
    if (spreads.length === 0) {
      return {
        average: 0,
        median: 0,
        std: 0,
        min: 0,
        max: 0,
        current: 0
      };
    }
    
    const sorted = [...spreads].sort((a, b) => a - b);
    const avg = spreads.reduce((sum, s) => sum + s, 0) / spreads.length;
    const variance = spreads.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / spreads.length;
    
    return {
      average: avg,
      median: sorted[Math.floor(sorted.length / 2)],
      std: Math.sqrt(variance),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      current: spreads[spreads.length - 1]
    };
  }

  getLiquidityMetrics(): LiquidityMetrics {
    const providers = this.liquidityEvents.filter(e => e.type === 'provide');
    const takers = this.liquidityEvents.filter(e => e.type === 'take');
    
    return {
      liquidityScore: this.getLiquidityScore(),
      providerRatio: providers.length / (this.liquidityEvents.length || 1),
      avgProviderSize: providers.reduce((sum, e) => sum + e.size, 0) / (providers.length || 1),
      avgTakerSize: takers.reduce((sum, e) => sum + e.size, 0) / (takers.length || 1),
      liquidityEvents: this.liquidityEvents.length
    };
  }

  getToxicityMetrics(): ToxicityMetrics {
    const toxicityScore = this.getToxicityScore();
    const adverseEvents = this.liquidityEvents.filter(e => e.impact > 0.001);
    
    return {
      toxicityScore,
      adverseSelectionRatio: adverseEvents.length / (this.liquidityEvents.length || 1),
      avgAdverseImpact: adverseEvents.reduce((sum, e) => sum + e.impact, 0) / (adverseEvents.length || 1),
      recentToxicity: this.calculateRecentToxicity()
    };
  }

  private calculateRecentToxicity(): number {
    const recent = this.liquidityEvents.slice(-20);
    if (recent.length === 0) return 0;
    
    const toxic = recent.filter(e => e.impact > 0.001).length;
    return toxic / recent.length;
  }

  getPriceImpactCurve(): Array<{ size: number; impact: number }> {
    const curve = [];
    
    for (const [size, impact] of this.priceImpactCurve) {
      curve.push({ size, impact });
    }
    
    return curve.sort((a, b) => a.size - b.size);
  }
}

// Type definitions for internal use

interface VolumeProfile {
  addTrade(price: number, size: number, side: 'buy' | 'sell'): void;
  getProfile(): Array<{ price: number; buyVolume: number; sellVolume: number; netVolume: number }>;
  getDistribution(): { price: number; volume: number; percentile: number }[];
  getWallMovements(): { appearances: number; disappearances: number };
}

interface MicrostructureMetrics {
  update(trade: OrderflowData): void;
  getBidDepth(): number;
  getAskDepth(): number;
  getImbalanceRatio(): number;
  getLargestBidWall(): number;
  getLargestAskWall(): number;
  getMicrostructureScore(): number;
  getLiquidityScore(): number;
  getSpreadMetrics(): SpreadMetrics;
  getLiquidityMetrics(): LiquidityMetrics;
  getToxicityMetrics(): ToxicityMetrics;
  getPriceImpactCurve(): Array<{ size: number; impact: number }>;
}

interface AggregatedFlow {
  asset: string;
  totalNetFlow: number;
  totalInflow: number;
  totalOutflow: number;
  exchanges: Array<{ exchange: string; netFlow: number; flowRatio: number }>;
  dominantExchange: string;
  convergence: number;
}

interface AnomalyResult {
  detected: boolean;
  confidence: number;
  evidence: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface OrderflowSummary {
  exchange: string;
  pair: string;
  netFlow: number;
  flowRatio: number;
  vwap: number;
  imbalanceRatio: number;
  microstructureScore: number;
  volumeProfile: Array<{ price: number; buyVolume: number; sellVolume: number; netVolume: number }>;
  whaleActivity: number;
  lastUpdate: number;
}

interface MicrostructureReport {
  exchange: string;
  pair: string;
  spreadMetrics: SpreadMetrics;
  liquidityMetrics: LiquidityMetrics;
  toxicityMetrics: ToxicityMetrics;
  volumeDistribution: { price: number; volume: number; percentile: number }[];
  priceImpact: Array<{ size: number; impact: number }>;
  timestamp: number;
}

interface SpreadMetrics {
  average: number;
  median: number;
  std: number;
  min: number;
  max: number;
  current: number;
}

interface LiquidityMetrics {
  liquidityScore: number;
  providerRatio: number;
  avgProviderSize: number;
  avgTakerSize: number;
  liquidityEvents: number;
}

interface ToxicityMetrics {
  toxicityScore: number;
  adverseSelectionRatio: number;
  avgAdverseImpact: number;
  recentToxicity: number;
}

interface LiquidityEvent {
  timestamp: number;
  type: 'provide' | 'take';
  size: number;
  price: number;
  impact: number;
} 