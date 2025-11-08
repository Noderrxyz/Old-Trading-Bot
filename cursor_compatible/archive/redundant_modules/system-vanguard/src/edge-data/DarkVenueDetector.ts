/**
 * DarkVenueDetector - Elite dark pool and hidden liquidity detection
 * 
 * Identifies iceberg orders, dark pools, and hidden liquidity through
 * order book analysis, trade flow patterns, and statistical inference.
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import { DarkVenue, IcebergOrder } from '../types';

interface OrderBookSnapshot {
  timestamp: number;
  symbol: string;
  venue: string;
  bids: OrderLevel[];
  asks: OrderLevel[];
  lastTrade?: TradeData;
}

interface OrderLevel {
  price: number;
  size: number;
  orders: number;
  updateTime: number;
}

interface TradeData {
  price: number;
  size: number;
  side: 'buy' | 'sell';
  timestamp: number;
  aggressive: boolean;
}

interface VenueStats {
  venue: string;
  visibleVolume: number;
  executedVolume: number;
  hiddenRatio: number;
  icebergDetections: number;
  darkFills: number;
}

interface OrderBookImbalance {
  symbol: string;
  venue: string;
  timestamp: number;
  bidPressure: number;
  askPressure: number;
  hiddenBidSize: number;
  hiddenAskSize: number;
}

export class DarkVenueDetector extends EventEmitter {
  private logger: Logger;
  private config: any;
  private orderBooks: Map<string, OrderBookSnapshot[]> = new Map();
  private venueStats: Map<string, VenueStats> = new Map();
  private darkVenues: Map<string, DarkVenue> = new Map();
  private icebergOrders: Map<string, IcebergOrder[]> = new Map();
  private sensitivity: number = 0.7;
  private aggressionEnabled: boolean = false;
  
  // Detection thresholds
  private readonly ICEBERG_REFRESH_THRESHOLD = 5; // refreshes
  private readonly HIDDEN_RATIO_THRESHOLD = 0.3; // 30% hidden
  private readonly DARK_VENUE_CONFIDENCE = 0.8;
  private readonly MIN_SAMPLE_SIZE = 100;
  
  constructor(logger: Logger, config: any) {
    super();
    this.logger = logger;
    this.config = config;
  }
  
  /**
   * Detect dark liquidity for a symbol
   */
  detect(symbol: string): DarkVenue[] {
    const detectedVenues: DarkVenue[] = [];
    
    // Analyze order book patterns
    const icebergs = this.detectIcebergOrders(symbol);
    
    // Identify dark pools
    const darkPools = this.identifyDarkPools(symbol);
    detectedVenues.push(...darkPools);
    
    // Find hidden liquidity
    const hiddenVenues = this.findHiddenLiquidity(symbol);
    detectedVenues.push(...hiddenVenues);
    
    // Detect synthetic venues
    const syntheticVenues = this.detectSyntheticVenues(symbol);
    detectedVenues.push(...syntheticVenues);
    
    // Update cache
    detectedVenues.forEach(venue => {
      this.darkVenues.set(venue.id, venue);
    });
    
    return detectedVenues;
  }
  
  /**
   * Process order book update
   */
  processOrderBook(snapshot: OrderBookSnapshot): void {
    const key = `${snapshot.symbol}:${snapshot.venue}`;
    
    if (!this.orderBooks.has(key)) {
      this.orderBooks.set(key, []);
    }
    
    const history = this.orderBooks.get(key)!;
    history.push(snapshot);
    
    // Keep only recent history
    if (history.length > 1000) {
      history.shift();
    }
    
    // Detect immediate patterns
    this.analyzeOrderBookPatterns(snapshot);
    
    // Update venue statistics
    this.updateVenueStats(snapshot);
  }
  
  /**
   * Process trade execution
   */
  processTrade(trade: TradeData & { symbol: string; venue: string }): void {
    // Check if trade size exceeds visible liquidity
    const key = `${trade.symbol}:${trade.venue}`;
    const orderBooks = this.orderBooks.get(key) || [];
    
    if (orderBooks.length > 0) {
      const latestBook = orderBooks[orderBooks.length - 1];
      const visibleLiquidity = this.getVisibleLiquidity(latestBook, trade.side, trade.price);
      
      if (trade.size > visibleLiquidity * 1.2) { // 20% larger than visible
        this.logger.info(`Possible dark execution detected: ${trade.symbol} ${trade.size} vs ${visibleLiquidity} visible`);
        
        // Record dark execution
        this.recordDarkExecution(trade);
      }
    }
  }
  
  /**
   * Increase sensitivity
   */
  increaseSensitivity(): void {
    this.sensitivity = Math.min(1.0, this.sensitivity * 1.2);
    this.logger.info(`Dark venue detection sensitivity increased to ${this.sensitivity}`);
  }
  
  /**
   * Enable aggression mode
   */
  enableAggression(): void {
    this.aggressionEnabled = true;
    this.sensitivity = 0.9;
    this.logger.info('Aggressive dark venue detection enabled');
  }
  
  /**
   * Private: Detect iceberg orders
   */
  private detectIcebergOrders(symbol: string): IcebergOrder[] {
    const icebergs: IcebergOrder[] = [];
    
    // Check each venue
    for (const [key, history] of this.orderBooks) {
      if (!key.startsWith(symbol)) continue;
      
      const venue = key.split(':')[1];
      const detectedIcebergs = this.analyzeForIcebergs(history);
      
      detectedIcebergs.forEach(iceberg => {
        iceberg.venue = venue;
        iceberg.symbol = symbol;
        icebergs.push(iceberg);
      });
    }
    
    // Update cache
    this.icebergOrders.set(symbol, icebergs);
    
    return icebergs;
  }
  
  /**
   * Private: Analyze for icebergs
   */
  private analyzeForIcebergs(history: OrderBookSnapshot[]): IcebergOrder[] {
    const icebergs: IcebergOrder[] = [];
    if (history.length < 10) return icebergs;
    
    // Track order levels that refresh at same price
    const levelRefreshes = new Map<string, number>();
    const levelSizes = new Map<string, number[]>();
    
    for (let i = 1; i < history.length; i++) {
      const prev = history[i-1];
      const curr = history[i];
      
      // Check bid levels
      for (const bid of curr.bids) {
        const key = `bid:${bid.price}`;
        const prevLevel = prev.bids.find(b => b.price === bid.price);
        
        if (prevLevel && prevLevel.size < bid.size * 0.5) {
          // Level refreshed (size increased significantly)
          levelRefreshes.set(key, (levelRefreshes.get(key) || 0) + 1);
          
          if (!levelSizes.has(key)) {
            levelSizes.set(key, []);
          }
          levelSizes.get(key)!.push(bid.size);
        }
      }
      
      // Check ask levels
      for (const ask of curr.asks) {
        const key = `ask:${ask.price}`;
        const prevLevel = prev.asks.find(a => a.price === ask.price);
        
        if (prevLevel && prevLevel.size < ask.size * 0.5) {
          levelRefreshes.set(key, (levelRefreshes.get(key) || 0) + 1);
          
          if (!levelSizes.has(key)) {
            levelSizes.set(key, []);
          }
          levelSizes.get(key)!.push(ask.size);
        }
      }
    }
    
    // Identify iceberg patterns
    for (const [key, refreshCount] of levelRefreshes) {
      if (refreshCount >= this.ICEBERG_REFRESH_THRESHOLD) {
        const [side, priceStr] = key.split(':');
        const price = parseFloat(priceStr);
        const sizes = levelSizes.get(key) || [];
        
        if (sizes.length > 0) {
          const avgVisibleSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
          const estimatedTotalSize = avgVisibleSize * refreshCount * 1.5; // Estimate
          
          icebergs.push({
            venue: '',
            symbol: '',
            side: side as 'buy' | 'sell',
            visibleSize: avgVisibleSize,
            estimatedTotalSize,
            priceLevel: price,
            detectionMethod: 'refresh_pattern',
            confidence: Math.min(refreshCount / 10, 0.95)
          });
        }
      }
    }
    
    return icebergs;
  }
  
  /**
   * Private: Identify dark pools
   */
  private identifyDarkPools(symbol: string): DarkVenue[] {
    const darkPools: DarkVenue[] = [];
    
    // Analyze venue statistics
    for (const [venue, stats] of this.venueStats) {
      if (stats.hiddenRatio > this.HIDDEN_RATIO_THRESHOLD &&
          stats.darkFills > this.MIN_SAMPLE_SIZE) {
        
        const confidence = Math.min(
          stats.hiddenRatio * 1.2,
          stats.darkFills / 1000,
          0.95
        );
        
        if (confidence >= this.DARK_VENUE_CONFIDENCE * this.sensitivity) {
          darkPools.push({
            id: `dark_${venue}_${symbol}`,
            type: 'darkpool',
            estimatedLiquidity: stats.executedVolume * stats.hiddenRatio,
            detectionConfidence: confidence,
            accessMethod: this.inferAccessMethod(venue),
            historicalFills: stats.darkFills
          });
        }
      }
    }
    
    return darkPools;
  }
  
  /**
   * Private: Find hidden liquidity
   */
  private findHiddenLiquidity(symbol: string): DarkVenue[] {
    const hiddenVenues: DarkVenue[] = [];
    
    // Analyze order book imbalances
    const imbalances = this.calculateOrderBookImbalances(symbol);
    
    for (const imbalance of imbalances) {
      const hiddenLiquidity = imbalance.hiddenBidSize + imbalance.hiddenAskSize;
      
      if (hiddenLiquidity > 0) {
        hiddenVenues.push({
          id: `hidden_${imbalance.venue}_${symbol}`,
          type: 'hidden',
          estimatedLiquidity: hiddenLiquidity,
          detectionConfidence: this.calculateImbalanceConfidence(imbalance),
          historicalFills: 0
        });
      }
    }
    
    return hiddenVenues;
  }
  
  /**
   * Private: Detect synthetic venues
   */
  private detectSyntheticVenues(symbol: string): DarkVenue[] {
    const syntheticVenues: DarkVenue[] = [];
    
    // Look for correlated order movements across venues
    const correlations = this.findVenueCorrelations(symbol);
    
    for (const correlation of correlations) {
      if (correlation.strength > 0.8) {
        syntheticVenues.push({
          id: `synthetic_${correlation.venueGroup}_${symbol}`,
          type: 'synthetic',
          estimatedLiquidity: correlation.combinedLiquidity,
          detectionConfidence: correlation.strength,
          accessMethod: 'aggregation',
          historicalFills: correlation.tradeCount
        });
      }
    }
    
    return syntheticVenues;
  }
  
  /**
   * Private: Analyze order book patterns
   */
  private analyzeOrderBookPatterns(snapshot: OrderBookSnapshot): void {
    // Check for quote stuffing (indicator of hidden activity)
    const quoteRate = this.calculateQuoteRate(snapshot);
    if (quoteRate > 100) { // 100 updates per second
      this.logger.warn(`High quote rate detected: ${snapshot.symbol} at ${snapshot.venue}`);
    }
    
    // Check for layering patterns
    const layering = this.detectLayering(snapshot);
    if (layering) {
      this.emit('layeringDetected', {
        symbol: snapshot.symbol,
        venue: snapshot.venue,
        side: layering.side,
        levels: layering.levels
      });
    }
  }
  
  /**
   * Private: Update venue statistics
   */
  private updateVenueStats(snapshot: OrderBookSnapshot): void {
    const venue = snapshot.venue;
    
    if (!this.venueStats.has(venue)) {
      this.venueStats.set(venue, {
        venue,
        visibleVolume: 0,
        executedVolume: 0,
        hiddenRatio: 0,
        icebergDetections: 0,
        darkFills: 0
      });
    }
    
    const stats = this.venueStats.get(venue)!;
    
    // Update visible volume
    const visibleBidVolume = snapshot.bids.reduce((sum, bid) => sum + bid.size, 0);
    const visibleAskVolume = snapshot.asks.reduce((sum, ask) => sum + ask.size, 0);
    stats.visibleVolume = visibleBidVolume + visibleAskVolume;
    
    // Update executed volume if trade data available
    if (snapshot.lastTrade) {
      stats.executedVolume += snapshot.lastTrade.size;
      
      // Check if execution was larger than visible
      const visibleAtPrice = this.getVisibleLiquidity(
        snapshot,
        snapshot.lastTrade.side,
        snapshot.lastTrade.price
      );
      
      if (snapshot.lastTrade.size > visibleAtPrice) {
        stats.darkFills++;
      }
    }
    
    // Update hidden ratio
    if (stats.executedVolume > 0) {
      stats.hiddenRatio = Math.max(0, 1 - (stats.visibleVolume / stats.executedVolume));
    }
  }
  
  /**
   * Private: Get visible liquidity at price
   */
  private getVisibleLiquidity(
    orderBook: OrderBookSnapshot,
    side: 'buy' | 'sell',
    price: number
  ): number {
    const levels = side === 'buy' ? orderBook.asks : orderBook.bids;
    const comparison = side === 'buy' 
      ? (level: OrderLevel) => level.price <= price
      : (level: OrderLevel) => level.price >= price;
    
    return levels
      .filter(comparison)
      .reduce((sum, level) => sum + level.size, 0);
  }
  
  /**
   * Private: Record dark execution
   */
  private recordDarkExecution(trade: TradeData & { symbol: string; venue: string }): void {
    const stats = this.venueStats.get(trade.venue);
    if (stats) {
      stats.darkFills++;
    }
    
    this.emit('darkExecutionDetected', {
      symbol: trade.symbol,
      venue: trade.venue,
      size: trade.size,
      price: trade.price,
      timestamp: trade.timestamp
    });
  }
  
  /**
   * Private: Calculate order book imbalances
   */
  private calculateOrderBookImbalances(symbol: string): OrderBookImbalance[] {
    const imbalances: OrderBookImbalance[] = [];
    
    for (const [key, history] of this.orderBooks) {
      if (!key.startsWith(symbol)) continue;
      
      const venue = key.split(':')[1];
      const latestBook = history[history.length - 1];
      
      if (latestBook) {
        const imbalance = this.analyzeImbalance(latestBook);
        imbalances.push({
          symbol,
          venue,
          timestamp: latestBook.timestamp,
          ...imbalance
        });
      }
    }
    
    return imbalances;
  }
  
  /**
   * Private: Analyze imbalance
   */
  private analyzeImbalance(orderBook: OrderBookSnapshot): {
    bidPressure: number;
    askPressure: number;
    hiddenBidSize: number;
    hiddenAskSize: number;
  } {
    // Calculate pressure based on order count and size distribution
    const bidPressure = this.calculatePressure(orderBook.bids);
    const askPressure = this.calculatePressure(orderBook.asks);
    
    // Estimate hidden size based on pressure imbalance
    const imbalanceRatio = Math.abs(bidPressure - askPressure) / 
                          Math.max(bidPressure, askPressure);
    
    const totalVisible = orderBook.bids.reduce((sum, b) => sum + b.size, 0) +
                        orderBook.asks.reduce((sum, a) => sum + a.size, 0);
    
    const estimatedHidden = totalVisible * imbalanceRatio * 0.5;
    
    return {
      bidPressure,
      askPressure,
      hiddenBidSize: bidPressure > askPressure ? estimatedHidden : 0,
      hiddenAskSize: askPressure > bidPressure ? estimatedHidden : 0
    };
  }
  
  /**
   * Private: Calculate pressure
   */
  private calculatePressure(levels: OrderLevel[]): number {
    if (levels.length === 0) return 0;
    
    // Weighted by price distance and size
    const midPrice = levels[0].price;
    let pressure = 0;
    
    for (let i = 0; i < Math.min(levels.length, 10); i++) {
      const level = levels[i];
      const weight = 1 / (1 + Math.abs(level.price - midPrice) / midPrice);
      pressure += level.size * weight * level.orders;
    }
    
    return pressure;
  }
  
  /**
   * Private: Calculate imbalance confidence
   */
  private calculateImbalanceConfidence(imbalance: OrderBookImbalance): number {
    const totalHidden = imbalance.hiddenBidSize + imbalance.hiddenAskSize;
    const totalPressure = imbalance.bidPressure + imbalance.askPressure;
    
    if (totalPressure === 0) return 0;
    
    const hiddenRatio = totalHidden / totalPressure;
    const imbalanceStrength = Math.abs(imbalance.bidPressure - imbalance.askPressure) / 
                             totalPressure;
    
    return Math.min(hiddenRatio * imbalanceStrength * 2, 0.95);
  }
  
  /**
   * Private: Find venue correlations
   */
  private findVenueCorrelations(symbol: string): Array<{
    venueGroup: string;
    venues: string[];
    strength: number;
    combinedLiquidity: number;
    tradeCount: number;
  }> {
    const correlations: any[] = [];
    const venues = Array.from(this.orderBooks.keys())
      .filter(key => key.startsWith(symbol))
      .map(key => key.split(':')[1]);
    
    // Compare venue pairs
    for (let i = 0; i < venues.length; i++) {
      for (let j = i + 1; j < venues.length; j++) {
        const correlation = this.calculateVenueCorrelation(
          symbol,
          venues[i],
          venues[j]
        );
        
        if (correlation.strength > 0.8) {
          correlations.push({
            venueGroup: `${venues[i]}_${venues[j]}`,
            venues: [venues[i], venues[j]],
            ...correlation
          });
        }
      }
    }
    
    return correlations;
  }
  
  /**
   * Private: Calculate venue correlation
   */
  private calculateVenueCorrelation(
    symbol: string,
    venue1: string,
    venue2: string
  ): {
    strength: number;
    combinedLiquidity: number;
    tradeCount: number;
  } {
    const history1 = this.orderBooks.get(`${symbol}:${venue1}`) || [];
    const history2 = this.orderBooks.get(`${symbol}:${venue2}`) || [];
    
    if (history1.length < 50 || history2.length < 50) {
      return { strength: 0, combinedLiquidity: 0, tradeCount: 0 };
    }
    
    // Simple correlation based on price movements
    let correlation = 0;
    let count = 0;
    
    for (let i = 1; i < Math.min(history1.length, history2.length); i++) {
      const price1Prev = (history1[i-1].bids[0]?.price || 0 + history1[i-1].asks[0]?.price || 0) / 2;
      const price1Curr = (history1[i].bids[0]?.price || 0 + history1[i].asks[0]?.price || 0) / 2;
      const price2Prev = (history2[i-1].bids[0]?.price || 0 + history2[i-1].asks[0]?.price || 0) / 2;
      const price2Curr = (history2[i].bids[0]?.price || 0 + history2[i].asks[0]?.price || 0) / 2;
      
      const move1 = price1Curr - price1Prev;
      const move2 = price2Curr - price2Prev;
      
      if (Math.sign(move1) === Math.sign(move2)) {
        correlation++;
      }
      count++;
    }
    
    const stats1 = this.venueStats.get(venue1);
    const stats2 = this.venueStats.get(venue2);
    
    return {
      strength: count > 0 ? correlation / count : 0,
      combinedLiquidity: (stats1?.visibleVolume || 0) + (stats2?.visibleVolume || 0),
      tradeCount: (stats1?.darkFills || 0) + (stats2?.darkFills || 0)
    };
  }
  
  /**
   * Private: Infer access method
   */
  private inferAccessMethod(venue: string): string {
    // In production, this would use venue-specific knowledge
    if (venue.includes('dark')) return 'dark_pool_gateway';
    if (venue.includes('block')) return 'block_trading';
    if (venue.includes('otc')) return 'otc_desk';
    return 'smart_order_routing';
  }
  
  /**
   * Private: Calculate quote rate
   */
  private calculateQuoteRate(snapshot: OrderBookSnapshot): number {
    const key = `${snapshot.symbol}:${snapshot.venue}`;
    const history = this.orderBooks.get(key) || [];
    
    if (history.length < 2) return 0;
    
    const timeSpan = snapshot.timestamp - history[0].timestamp;
    if (timeSpan === 0) return 0;
    
    return (history.length * 1000) / timeSpan; // Updates per second
  }
  
  /**
   * Private: Detect layering
   */
  private detectLayering(snapshot: OrderBookSnapshot): {
    side: 'bid' | 'ask';
    levels: number;
  } | null {
    // Check for multiple orders at incrementally different prices
    const checkSide = (levels: OrderLevel[], side: 'bid' | 'ask') => {
      if (levels.length < 5) return null;
      
      let consistentSizes = 0;
      let consistentSpacing = 0;
      
      for (let i = 1; i < Math.min(levels.length, 10); i++) {
        const sizeDiff = Math.abs(levels[i].size - levels[i-1].size) / levels[i-1].size;
        const priceDiff = Math.abs(levels[i].price - levels[i-1].price);
        
        if (sizeDiff < 0.1) consistentSizes++; // Within 10%
        if (i > 1) {
          const prevPriceDiff = Math.abs(levels[i-1].price - levels[i-2].price);
          if (Math.abs(priceDiff - prevPriceDiff) < 0.01) {
            consistentSpacing++;
          }
        }
      }
      
      if (consistentSizes > 5 && consistentSpacing > 3) {
        return { side, levels: consistentSizes };
      }
      
      return null;
    };
    
    return checkSide(snapshot.bids, 'bid') || checkSide(snapshot.asks, 'ask');
  }
} 