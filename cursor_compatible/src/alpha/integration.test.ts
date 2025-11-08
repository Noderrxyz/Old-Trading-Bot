import { AlphaFusionEngine, SignalDirection } from './fusion-engine.js';
import { TemporalSignalEvolutionEngine } from './TemporalSignalEvolutionEngine.js';
import { AlphaFrame } from '../alphasources/types.js';
import { SignalPhase } from './types/temporal.types.js';
import { RedisClient } from '../infra/core/RedisClient.js';

// Mock Redis client
class MockRedisClient implements Partial<RedisClient> {
  private storage = new Map<string, string>();
  private lists = new Map<string, string[]>();

  async set(key: string, value: string): Promise<string> {
    this.storage.set(key, value);
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.storage.get(key) || null;
  }

  async lpush(key: string, value: string): Promise<number> {
    const list = this.lists.get(key) || [];
    list.unshift(value);
    this.lists.set(key, list);
    return list.length;
  }

  async ltrim(key: string, start: number, stop: number): Promise<string> {
    const list = this.lists.get(key) || [];
    this.lists.set(key, list.slice(start, stop + 1));
    return 'OK';
  }
}

describe('Alpha Fusion with Temporal Evolution', () => {
  let fusionEngine: AlphaFusionEngine;
  let evolutionEngine: TemporalSignalEvolutionEngine;
  let redis: MockRedisClient;

  beforeEach(() => {
    redis = new MockRedisClient();
    fusionEngine = new AlphaFusionEngine();
    evolutionEngine = new TemporalSignalEvolutionEngine(undefined, redis as unknown as RedisClient);
  });

  it('should adapt fusion weights based on temporal evolution', async () => {
    // Create two alpha sources with different behaviors
    const trendingSource = 'trend_alpha';
    const mrSource = 'mr_alpha';
    const symbol = 'BTC/USDC';

    // Generate signals from trending source (consistently increasing)
    const trendingSignals: AlphaFrame[] = Array.from({ length: 10 }, (_, i) => ({
      source: trendingSource,
      symbol,
      score: 0.5 + i * 0.05,
      confidence: 0.8,
      timestamp: Date.now() + i * 1000
    }));

    // Generate signals from mean reverting source (oscillating)
    const mrSignals: AlphaFrame[] = Array.from({ length: 10 }, (_, i) => ({
      source: mrSource,
      symbol,
      score: 0.5 + Math.sin(i * Math.PI / 2) * 0.3,
      confidence: 0.8,
      timestamp: Date.now() + i * 1000
    }));

    // First batch: both sources look good
    const firstBatch = [...trendingSignals.slice(0, 5), ...mrSignals.slice(0, 5)];
    await evolutionEngine.update(firstBatch);
    let fusedSignals = fusionEngine.fuse(firstBatch);

    expect(fusedSignals.length).toBe(1); // One symbol
    expect(fusedSignals[0].confidence).toBeGreaterThan(0.5);
    expect(fusedSignals[0].sources).toContain(trendingSource);
    expect(fusedSignals[0].sources).toContain(mrSource);

    // Second batch: trending source maintains quality, mr source decays
    const decayingMRSignals: AlphaFrame[] = Array.from({ length: 5 }, (_, i) => ({
      source: mrSource,
      symbol,
      score: 0.5 + (Math.random() - 0.5) * 0.8, // High volatility
      confidence: 0.8 - i * 0.1, // Decreasing confidence
      timestamp: Date.now() + (i + 5) * 1000
    }));

    const secondBatch = [...trendingSignals.slice(5), ...decayingMRSignals];
    await evolutionEngine.update(secondBatch);

    // Check that mr source is marked as decaying
    const mrLabel = evolutionEngine.getCurrentLabel(`${mrSource}_${symbol}`);
    expect(mrLabel?.currentPhase).toBe(SignalPhase.DECAY);

    // Check that trending source is still good
    const trendLabel = evolutionEngine.getCurrentLabel(`${trendingSource}_${symbol}`);
    expect(trendLabel?.currentPhase).toBe(SignalPhase.TRENDING);

    // Fuse signals with temporal evolution awareness
    fusedSignals = fusionEngine.fuse(
      secondBatch.map(signal => {
        const label = evolutionEngine.getCurrentLabel(`${signal.source}_${signal.symbol}`);
        if (label?.currentPhase === SignalPhase.DECAY) {
          // De-prioritize decaying signals
          return {
            ...signal,
            confidence: signal.confidence * 0.5
          };
        }
        return signal;
      })
    );

    expect(fusedSignals.length).toBe(1);
    expect(fusedSignals[0].confidence).toBeGreaterThan(0.5);
    
    // Check that trending source has more influence
    const trendingDetails = fusedSignals[0].details.find(d => d.source === trendingSource);
    const mrDetails = fusedSignals[0].details.find(d => d.source === mrSource);
    expect(trendingDetails?.weight).toBeGreaterThan(mrDetails?.weight || 0);
  });

  it('should handle phase transitions in fusion', async () => {
    const source = 'adaptive_alpha';
    const symbol = 'ETH/USDC';

    // Start with trending signals
    const trendingSignals: AlphaFrame[] = Array.from({ length: 10 }, (_, i) => ({
      source,
      symbol,
      score: 0.5 + i * 0.05,
      confidence: 0.8,
      timestamp: Date.now() + i * 1000
    }));

    await evolutionEngine.update(trendingSignals);
    let fusedSignals = fusionEngine.fuse(trendingSignals);

    expect(fusedSignals[0].direction).toBe(SignalDirection.LONG);
    expect(fusedSignals[0].confidence).toBeGreaterThan(0.7);

    // Transition to mean reverting
    const mrSignals: AlphaFrame[] = Array.from({ length: 10 }, (_, i) => ({
      source,
      symbol,
      score: 0.5 + Math.sin(i * Math.PI / 2) * 0.3,
      confidence: 0.8,
      timestamp: Date.now() + (i + 10) * 1000
    }));

    await evolutionEngine.update(mrSignals);
    
    // Check phase shift was detected
    const shifts = evolutionEngine.getDetectedPhaseShifts();
    expect(shifts.length).toBe(1);
    expect(shifts[0].previousPhase).toBe(SignalPhase.TRENDING);
    expect(shifts[0].newPhase).toBe(SignalPhase.MEAN_REVERTING);

    // Fuse signals with phase awareness
    fusedSignals = fusionEngine.fuse(
      mrSignals.map(signal => {
        const label = evolutionEngine.getCurrentLabel(`${signal.source}_${signal.symbol}`);
        if (label?.currentPhase === SignalPhase.MEAN_REVERTING) {
          // Adjust confidence based on mean reversion strength
          return {
            ...signal,
            confidence: signal.confidence * (label.metadata?.meanReversionStrength || 1)
          };
        }
        return signal;
      })
    );

    // Check that fusion adapts to mean reversion
    expect(fusedSignals[0].size).toBeLessThan(0.8); // More conservative sizing
    expect(fusedSignals[0].direction).not.toBe(SignalDirection.NEUTRAL);
  });
}); 