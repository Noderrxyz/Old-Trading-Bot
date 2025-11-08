/**
 * Market Simulation Engine
 * 
 * Advanced mathematical models for generating realistic market behavior
 * including price movements, volatility, and market microstructure.
 */

import { IMarketSimulationEngine } from '../interfaces/IDataFeed';
import { logger } from '../../utils/logger';

export interface SimulationParameters {
  volatility: number; // Annual volatility (0.1 = 10%)
  drift: number; // Annual drift/trend (-0.1 to 0.1)
  meanReversionSpeed: number; // Mean reversion strength (0-1)
  trendMomentum: number; // Trend following strength (0-1)
  microstructureNoise: number; // Bid-ask bounce noise (0-0.01)
  timeScale: number; // Time scaling factor (1 = real time)
}

export interface MarketRegime {
  name: string;
  volatility: number;
  trend: number;
  momentum: number;
  duration: number; // milliseconds
  probability: number; // 0-1
}

export class MarketSimulationEngine implements IMarketSimulationEngine {
  private parameters: SimulationParameters;
  private currentRegime: MarketRegime;
  private lastUpdate: number;
  private priceHistory: Map<string, number[]> = new Map();
  private volumeHistory: Map<string, number[]> = new Map();
  
  // Market regimes
  private readonly marketRegimes: MarketRegime[] = [
    { name: 'bull_market', volatility: 0.15, trend: 0.05, momentum: 0.7, duration: 3600000, probability: 0.25 },
    { name: 'bear_market', volatility: 0.25, trend: -0.03, momentum: 0.8, duration: 3600000, probability: 0.20 },
    { name: 'sideways', volatility: 0.12, trend: 0.0, momentum: 0.3, duration: 7200000, probability: 0.40 },
    { name: 'high_volatility', volatility: 0.40, trend: 0.0, momentum: 0.2, duration: 1800000, probability: 0.10 },
    { name: 'low_volatility', volatility: 0.06, trend: 0.01, momentum: 0.5, duration: 3600000, probability: 0.05 }
  ];
  
  // Random number generator (Mersenne Twister for reproducibility)
  private rng: () => number;
  private seed: number;

  constructor(parameters?: Partial<SimulationParameters>, seed?: number) {
    this.parameters = {
      volatility: 0.20, // 20% annual volatility
      drift: 0.0, // No trend by default
      meanReversionSpeed: 0.1,
      trendMomentum: 0.3,
      microstructureNoise: 0.001,
      timeScale: 1.0,
      ...parameters
    };
    
    this.seed = seed || Date.now();
    this.rng = this.createSeededRandom(this.seed);
    this.currentRegime = this.selectRandomRegime();
    this.lastUpdate = Date.now();
    
    logger.info('[SIMULATION] Market simulation engine initialized', {
      parameters: this.parameters,
      initialRegime: this.currentRegime.name,
      seed: this.seed
    });
  }

  /**
   * Generate next price using composite model
   */
  generatePrice(currentPrice: number, volatility: number, trend: number): number {
    const dt = this.calculateTimeDelta();
    
    // Apply regime-based modifications
    const regimeVolatility = volatility * this.currentRegime.volatility;
    const regimeTrend = trend + this.currentRegime.trend;
    
    // Brownian motion component
    const brownianComponent = this.simulateBrownianMotion(currentPrice, regimeVolatility, dt);
    
    // Trend following component
    const trendComponent = this.simulateTrendFollowing(currentPrice, this.currentRegime.momentum, regimeTrend);
    
    // Mean reversion component
    const meanPrice = this.calculateMeanPrice(currentPrice);
    const reversionComponent = this.simulateMeanReversion(currentPrice, meanPrice, this.parameters.meanReversionSpeed);
    
    // Microstructure noise
    const noiseComponent = this.generateMicrostructureNoise(currentPrice);
    
    // Combine components with weights
    const newPrice = brownianComponent * 0.6 + 
                    trendComponent * 0.2 + 
                    reversionComponent * 0.15 + 
                    noiseComponent * 0.05;
    
    // Ensure price is positive
    return Math.max(newPrice, currentPrice * 0.001);
  }

  /**
   * Generate volume with time-of-day and volatility effects
   */
  generateVolume(baseVolume: number, timeOfDay: number, volatility: number): number {
    // Time-of-day effect (U-shaped curve for most markets)
    const timeEffect = this.calculateTimeOfDayEffect(timeOfDay);
    
    // Volatility effect (higher volatility = higher volume)
    const volatilityEffect = 1 + (volatility - 0.15) * 2; // Normalize around 15% vol
    
    // Random variation
    const randomFactor = 0.8 + this.rng() * 0.4; // ±20% random variation
    
    // Regime effect
    const regimeEffect = this.currentRegime.name === 'high_volatility' ? 1.5 : 
                        this.currentRegime.name === 'low_volatility' ? 0.7 : 1.0;
    
    return baseVolume * timeEffect * volatilityEffect * randomFactor * regimeEffect;
  }

  /**
   * Generate spread based on volatility and liquidity
   */
  generateSpread(baseSpread: number, volatility: number, liquidity: number): number {
    // Volatility effect (higher vol = wider spreads)
    const volatilityMultiplier = 1 + (volatility - 0.15) * 3;
    
    // Liquidity effect (higher liquidity = tighter spreads)
    const liquidityMultiplier = Math.max(0.5, 2 - liquidity);
    
    // Time-of-day effect (wider spreads during off-hours)
    const hour = new Date().getHours();
    const timeMultiplier = (hour >= 9 && hour <= 16) ? 1.0 : 1.3; // Assume US market hours
    
    // Random variation
    const randomMultiplier = 0.9 + this.rng() * 0.2;
    
    return baseSpread * volatilityMultiplier * liquidityMultiplier * timeMultiplier * randomMultiplier;
  }

  /**
   * Simulate Brownian motion (Geometric Brownian Motion)
   */
  simulateBrownianMotion(price: number, volatility: number, dt: number): number {
    const randomNormal = this.boxMullerTransform();
    const drift = this.parameters.drift * dt;
    const diffusion = volatility * Math.sqrt(dt) * randomNormal;
    
    return price * Math.exp(drift + diffusion);
  }

  /**
   * Simulate volatility burst events
   */
  simulateVolatilityBurst(price: number, burstIntensity: number): number {
    // Burst probability increases with intensity
    const burstProbability = burstIntensity * 0.01; // 1% max probability per tick
    
    if (this.rng() < burstProbability) {
      // Generate burst magnitude
      const burstMagnitude = (this.rng() - 0.5) * burstIntensity * 0.1; // ±10% max
      const burstPrice = price * (1 + burstMagnitude);
      
      logger.debug('[SIMULATION] Volatility burst generated', {
        originalPrice: price,
        burstPrice: burstPrice,
        magnitude: burstMagnitude,
        intensity: burstIntensity
      });
      
      return burstPrice;
    }
    
    return price;
  }

  /**
   * Simulate trend following behavior
   */
  simulateTrendFollowing(price: number, momentum: number, strength: number): number {
    const recentPrices = this.priceHistory.get('trend') || [price];
    
    if (recentPrices.length < 2) {
      recentPrices.push(price);
      this.priceHistory.set('trend', recentPrices);
      return price;
    }
    
    // Calculate recent trend
    const shortTermTrend = this.calculateMovingAverage(recentPrices, 5);
    const longTermTrend = this.calculateMovingAverage(recentPrices, 20);
    const trendDirection = shortTermTrend > longTermTrend ? 1 : -1;
    
    // Apply momentum
    const trendAdjustment = trendDirection * momentum * strength * 0.001; // Small adjustment
    const trendPrice = price * (1 + trendAdjustment);
    
    // Update price history
    recentPrices.push(price);
    if (recentPrices.length > 50) {
      recentPrices.shift();
    }
    this.priceHistory.set('trend', recentPrices);
    
    return trendPrice;
  }

  /**
   * Simulate mean reversion
   */
  simulateMeanReversion(price: number, meanPrice: number, reversionSpeed: number): number {
    const deviation = (price - meanPrice) / meanPrice;
    const reversionForce = -deviation * reversionSpeed;
    
    return price * (1 + reversionForce * 0.001); // Apply gentle reversion
  }

  /**
   * Update current market regime
   */
  updateMarketRegime(): void {
    const now = Date.now();
    const regimeDuration = now - this.lastUpdate;
    
    // Check if current regime should end
    if (regimeDuration > this.currentRegime.duration) {
      this.currentRegime = this.selectRandomRegime();
      this.lastUpdate = now;
      
      logger.info('[SIMULATION] Market regime changed', {
        newRegime: this.currentRegime.name,
        duration: this.currentRegime.duration / 1000 / 60, // minutes
        volatility: this.currentRegime.volatility,
        trend: this.currentRegime.trend
      });
    }
  }

  /**
   * Get current market regime
   */
  getCurrentRegime(): MarketRegime {
    this.updateMarketRegime();
    return { ...this.currentRegime };
  }

  // Private helper methods

  private createSeededRandom(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }

  private selectRandomRegime(): MarketRegime {
    const random = this.rng();
    let cumulativeProbability = 0;
    
    for (const regime of this.marketRegimes) {
      cumulativeProbability += regime.probability;
      if (random <= cumulativeProbability) {
        return { ...regime };
      }
    }
    
    return { ...this.marketRegimes[0] }; // Fallback
  }

  private calculateTimeDelta(): number {
    const now = Date.now();
    const delta = (now - this.lastUpdate) / 1000 / 60 / 60 / 24 / 365; // Convert to years
    this.lastUpdate = now;
    return delta * this.parameters.timeScale;
  }

  private boxMullerTransform(): number {
    // Generate standard normal random variable
    const u1 = this.rng();
    const u2 = this.rng();
    
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  private calculateMeanPrice(currentPrice: number): number {
    // Use recent price history to calculate mean
    const recentPrices = this.priceHistory.get('mean') || [currentPrice];
    
    if (recentPrices.length < 100) {
      recentPrices.push(currentPrice);
      this.priceHistory.set('mean', recentPrices);
    } else {
      recentPrices.shift();
      recentPrices.push(currentPrice);
    }
    
    return this.calculateMovingAverage(recentPrices, 50);
  }

  private calculateMovingAverage(prices: number[], period: number): number {
    const relevantPrices = prices.slice(-period);
    return relevantPrices.reduce((sum, price) => sum + price, 0) / relevantPrices.length;
  }

  private generateMicrostructureNoise(price: number): number {
    // Simulate bid-ask bounce and microstructure effects
    const noise = (this.rng() - 0.5) * this.parameters.microstructureNoise;
    return price * (1 + noise);
  }

  private calculateTimeOfDayEffect(timeOfDay: number): number {
    // U-shaped curve for intraday volume (higher at open/close)
    const hour = timeOfDay % 24;
    const marketOpen = 9.5; // 9:30 AM
    const marketClose = 16; // 4:00 PM
    
    if (hour < marketOpen || hour > marketClose) {
      return 0.3; // Low after-hours volume
    }
    
    // U-shaped curve during market hours
    const normalizedHour = (hour - marketOpen) / (marketClose - marketOpen);
    const uShape = 4 * normalizedHour * (1 - normalizedHour); // Parabola
    return 0.5 + uShape; // Range: 0.5 to 1.5
  }

  /**
   * Reset simulation state
   */
  reset(newSeed?: number): void {
    if (newSeed) {
      this.seed = newSeed;
      this.rng = this.createSeededRandom(this.seed);
    }
    
    this.priceHistory.clear();
    this.volumeHistory.clear();
    this.currentRegime = this.selectRandomRegime();
    this.lastUpdate = Date.now();
    
    logger.info('[SIMULATION] Market simulation engine reset', { seed: this.seed });
  }

  /**
   * Update simulation parameters
   */
  updateParameters(newParameters: Partial<SimulationParameters>): void {
    this.parameters = { ...this.parameters, ...newParameters };
    logger.info('[SIMULATION] Simulation parameters updated', this.parameters);
  }

  /**
   * Get simulation statistics
   */
  getStatistics(): {
    currentRegime: string;
    regimeUptime: number;
    parameters: SimulationParameters;
    priceHistorySize: number;
  } {
    return {
      currentRegime: this.currentRegime.name,
      regimeUptime: Date.now() - this.lastUpdate,
      parameters: { ...this.parameters },
      priceHistorySize: Array.from(this.priceHistory.values()).reduce((sum, arr) => sum + arr.length, 0)
    };
  }
} 