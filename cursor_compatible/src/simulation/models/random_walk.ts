import { randomNormal } from 'd3-random';
import logger from '../../utils/logger.js';

interface RandomWalkConfig {
  initialPrice: number;
  drift: number;
  volatility: number;
  timeStep: number;
  fatTailFactor: number;
  meanReversionSpeed: number;
  meanReversionLevel: number;
}

const DEFAULT_CONFIG: RandomWalkConfig = {
  initialPrice: 100,
  drift: 0.0001,
  volatility: 0.02,
  timeStep: 1,
  fatTailFactor: 0.1,
  meanReversionSpeed: 0.1,
  meanReversionLevel: 0.02
};

export class RandomWalk {
  private config: RandomWalkConfig;
  private normalRandom: () => number;
  private currentVolatility: number;

  constructor(config: Partial<RandomWalkConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.normalRandom = randomNormal(0, 1);
    this.currentVolatility = this.config.volatility;
  }

  public generatePath(steps: number): number[] {
    const path: number[] = [this.config.initialPrice];
    let currentPrice = this.config.initialPrice;

    for (let i = 1; i < steps; i++) {
      // Update volatility with mean reversion
      this.currentVolatility = this.updateVolatility();
      
      // Generate random shock with fat tails
      const shock = this.generateShock();
      
      // Calculate price change using geometric brownian motion
      const priceChange = currentPrice * (
        this.config.drift * this.config.timeStep +
        this.currentVolatility * shock * Math.sqrt(this.config.timeStep)
      );
      
      currentPrice += priceChange;
      path.push(currentPrice);
    }

    return path;
  }

  private updateVolatility(): number {
    const randomShock = this.normalRandom() * 0.1;
    return this.currentVolatility + 
      this.config.meanReversionSpeed * 
      (this.config.meanReversionLevel - this.currentVolatility) +
      randomShock;
  }

  private generateShock(): number {
    const normalShock = this.normalRandom();
    const uniformRandom = Math.random();
    
    // Apply fat tails with configurable probability
    if (uniformRandom < this.config.fatTailFactor) {
      return normalShock * 3; // 3x multiplier for fat tails
    }
    
    return normalShock;
  }

  public injectVolatilitySpike(multiplier: number, duration: number): void {
    const originalVolatility = this.currentVolatility;
    this.currentVolatility *= multiplier;
    
    setTimeout(() => {
      this.currentVolatility = originalVolatility;
    }, duration);
  }

  public getCurrentVolatility(): number {
    return this.currentVolatility;
  }
} 