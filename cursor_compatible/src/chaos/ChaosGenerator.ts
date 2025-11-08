/**
 * Chaos Generator
 * 
 * Produces randomized or adversarial stimuli across subsystems
 * to stress test agent behavior and trust systems.
 */

import { 
  ChaosParams, 
  AgentStimuli, 
  MarketShock, 
  SignalConflict 
} from '../types/chaos.types.js';

export class ChaosGenerator {
  /**
   * Generate stimuli for an agent based on chaos parameters
   * @param params Chaos simulation parameters
   * @returns Stimuli to apply to the agent
   */
  static generateStimuli(params: ChaosParams): AgentStimuli {
    return {
      marketShock: this.randomShock(params.marketVolatility),
      conflictingSignals: this.generateConflicts(params.conflictRate),
      corruptedInputs: Math.random() < params.corruptionRate,
      signalLatency: Math.floor(Math.random() * params.maxLatencyMs),
      trustDrop: params.forceTrustLoss ? -Math.random() * 20 : 0,
    };
  }

  /**
   * Generate a random market shock with specified volatility
   * @param volatility Market volatility level (0-100)
   * @returns Simulated market shock
   */
  static randomShock(volatility: number): MarketShock {
    // Scale volatility to a reasonable percentage range
    const scaledVol = volatility / 100 * 15; // Max 15% for highest volatility
    
    // Bias toward larger shocks for higher volatility settings
    const rawMagnitude = Math.pow(Math.random(), 2 - volatility/100) * scaledVol;
    
    return {
      direction: Math.random() > 0.5 ? 'up' : 'down',
      magnitude: rawMagnitude.toFixed(2),
      durationMs: Math.floor(500 + Math.random() * 4500), // 500ms to 5s
    };
  }

  /**
   * Generate conflicting signals from different sources
   * @param conflictRate Probability of generating conflicts (0-1)
   * @returns Array of conflicting signals
   */
  static generateConflicts(conflictRate: number): SignalConflict[] {
    // If below conflict threshold, return empty array
    if (Math.random() > conflictRate) {
      return [];
    }
    
    // Generate 2-5 conflicting signals
    const sources = ['price', 'volume', 'sentiment', 'news', 'social', 'technical', 'agent'];
    const usedSources = this.shuffleArray(sources).slice(0, 2 + Math.floor(Math.random() * 4));
    
    // Generate a random direction bias (0-1)
    // Values close to 0.5 mean high disagreement
    // Values close to 0 or 1 mean partial agreement with some outliers
    const directionBias = Math.random();
    
    return usedSources.map(source => {
      // Determine if this source agrees with the bias
      const agrees = Math.random() < (directionBias < 0.5 ? 1 - directionBias * 2 : directionBias * 2);
      
      // Generate a confidence score
      // Higher for sources that agree with bias, lower for disagreeing sources
      const baseConfidence = 30 + Math.random() * 70;
      const confidence = agrees ? baseConfidence : 100 - baseConfidence;
      
      return {
        source,
        score: Math.round(confidence)
      };
    });
  }

  /**
   * Generate a synthetic market data snapshot with potential anomalies
   * @param basePrice Base price to generate around
   * @param volatility Volatility level (0-100)
   * @param corrupt Whether to introduce corrupted data
   * @returns Simulated market data
   */
  static generateMarketData(basePrice: number, volatility: number, corrupt: boolean): any {
    const priceNoise = (Math.random() - 0.5) * 2 * (volatility / 100) * basePrice * 0.1;
    const corruptedData = corrupt && Math.random() < 0.3;
    
    // Create realistic market data with optional volume
    const data: {
      price: number;
      volume?: number;
      bid: number;
      ask: number;
      timestamp: number;
    } = {
      price: basePrice + priceNoise,
      volume: Math.floor(1000 + Math.random() * 10000),
      bid: basePrice + priceNoise - (Math.random() * basePrice * 0.001),
      ask: basePrice + priceNoise + (Math.random() * basePrice * 0.001),
      timestamp: Date.now()
    };
    
    // Potentially corrupt the data
    if (corruptedData) {
      // Choose corruption type
      const corruptionType = Math.floor(Math.random() * 4);
      switch (corruptionType) {
        case 0: // Price spike
          data.price = data.price * (3 + Math.random() * 2);
          break;
        case 1: // Missing data
          delete data.volume;
          break;
        case 2: // Timestamp in future
          data.timestamp = Date.now() + 1000 * 60 * 10; // 10 minutes in future
          break;
        case 3: // Inverted bid/ask
          [data.bid, data.ask] = [data.ask, data.bid];
          break;
      }
    }
    
    return data;
  }

  /**
   * Generate a black swan event (rare, high-impact)
   * @returns Black swan event data
   */
  static generateBlackSwan(): any {
    const events = [
      {
        type: 'flash_crash',
        impact: -0.35, // 35% down
        description: 'Sudden market collapse with cascading liquidations',
        durationMs: 60 * 1000 * 15, // 15 minutes
      },
      {
        type: 'regulatory_shock',
        impact: -0.15,
        description: 'Emergency regulatory action announced',
        durationMs: 60 * 1000 * 60 * 24, // 24 hours
      },
      {
        type: 'security_breach',
        impact: -0.25,
        description: 'Major exchange security breach reported',
        durationMs: 60 * 1000 * 60 * 12, // 12 hours
      },
      {
        type: 'positive_news',
        impact: 0.2,
        description: 'Unexpected positive regulatory development',
        durationMs: 60 * 1000 * 60 * 6, // 6 hours
      }
    ];
    
    return events[Math.floor(Math.random() * events.length)];
  }

  /**
   * Generate random API errors to test agent resilience
   * @param failureRate Probability of API failure (0-1)
   * @returns Simulated API error or null
   */
  static generateApiFailure(failureRate: number): any | null {
    if (Math.random() > failureRate) {
      return null;
    }
    
    const errors = [
      { code: 429, message: 'Rate limit exceeded' },
      { code: 500, message: 'Internal server error' },
      { code: 502, message: 'Bad gateway' },
      { code: 504, message: 'Gateway timeout' },
      { code: 400, message: 'Bad request' }
    ];
    
    return errors[Math.floor(Math.random() * errors.length)];
  }

  /**
   * Utility: Shuffle an array using Fisher-Yates algorithm
   * @param array Array to shuffle
   * @returns Shuffled array
   */
  private static shuffleArray<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
} 