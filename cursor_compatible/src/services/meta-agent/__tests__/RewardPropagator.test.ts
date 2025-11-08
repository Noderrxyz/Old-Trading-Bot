/// <reference types="jest" />

import { RewardPropagator, PropagationConfig } from '../RewardPropagator.js';
import { ReinforcementLog, ReinforcementEvent } from '../ReinforcementLog.js';

// Create manual mocks instead of using jest.mock
const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

// Mock the Logger module
vi.mock('../../utils/Logger', () => ({
  default: {
    getInstance: () => mockLogger
  }
}));

// Mock ReinforcementLog
vi.mock('../ReinforcementLog.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ReinforcementLog: vi.fn().mockImplementation(() => ({
      record: vi.fn().mockResolvedValue(undefined)
    }))
  };
});

describe('RewardPropagator', () => {
  let reinforcementLog: ReinforcementLog;
  let rewardPropagator: RewardPropagator;
  let mockTrustScoreService: any;
  let defaultConfig: PropagationConfig;
  
  beforeEach(() => {
    // Setup mock ReinforcementLog
    reinforcementLog = new ReinforcementLog();
    
    // Mock trust score service
    mockTrustScoreService = {
      getAgentTrustScore: jest.fn().mockResolvedValue(0.75),
      updateAgentTrustScore: jest.fn().mockResolvedValue(true)
    };
    
    defaultConfig = {
      decayFactor: 0.5,
      maxDepth: 3,
      minWeightThreshold: 0.1,
      reasonPrefix: 'Propagated: ',
      maxBreadth: 5
    };
    
    rewardPropagator = new RewardPropagator(reinforcementLog, mockTrustScoreService, defaultConfig);
  });
  
  test('should initialize with default configuration when none provided', () => {
    const propagator = new RewardPropagator();
    
    expect(propagator).toBeDefined();
    // Verify default config values are set correctly
    expect(propagator.config.maxPropagationDepth).toBe(3);
    expect(propagator.config.maxInfluencersPerLevel).toBe(5);
    expect(propagator.config.minWeightThreshold).toBe(0.1);
    expect(propagator.config.decayFactor).toBe(0.5);
  });
  
  test('should initialize with provided config', async () => {
    const customConfig: PropagationConfig = {
      decayFactor: 0.3,
      maxDepth: 2,
      minWeightThreshold: 0.2,
      reasonPrefix: 'Custom: ',
      maxBreadth: 3
    };
    
    const customPropagator = new RewardPropagator(reinforcementLog, mockTrustScoreService, customConfig);
    expect(customPropagator).toBeDefined();
    
    // Test updating config
    const newConfig = { decayFactor: 0.4, maxDepth: 4 };
    customPropagator.updateConfig(newConfig);
    
    // We need to access private property for testing - using any type to bypass TypeScript protection
    const propagator = customPropagator as any;
    expect(propagator.config.decayFactor).toBe(0.4);
    expect(propagator.config.maxDepth).toBe(4);
    expect(propagator.config.reasonPrefix).toBe('Custom: '); // Should retain original value
  });
  
  test('should propagate rewards to a single level of influencers', async () => {
    // Setup test data
    const sourceEvent: ReinforcementEvent = {
      id: 'event1',
      timestamp: Date.now(),
      sourceAgent: 'agent1',
      targetAgent: 'agent2',
      reason: 'Original reward',
      weight: 1.0,
      decayTTL: Date.now() + 86400000, // 1 day
      tags: ['test']
    };
    
    // Add some influence data
    const spy = jest.spyOn(reinforcementLog, 'recordEvent');
    
    // Mock the influencers method to return a predefined set of influencers
    jest.spyOn(reinforcementLog, 'getInfluencers').mockReturnValue([
      { agentId: 'agent3', weight: 0.8 },
      { agentId: 'agent4', weight: 0.6 },
      { agentId: 'agent5', weight: 0.2 }
    ]);
    
    // Call propagate
    await rewardPropagator.propagateReward(sourceEvent, 1);
    
    // Verify recordEvent was called for each influencer
    expect(spy).toHaveBeenCalledTimes(3);
    
    // Check the calls with expected values (with weight decay applied)
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAgent: 'agent2', // The target of the original event becomes the source
        targetAgent: 'agent3',
        weight: 0.4, // 0.8 (influence weight) * 0.5 (decay factor)
        reason: 'Propagated: Original reward'
      })
    );
    
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAgent: 'agent2',
        targetAgent: 'agent4',
        weight: 0.3, // 0.6 (influence weight) * 0.5 (decay factor)
        reason: 'Propagated: Original reward'
      })
    );
    
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAgent: 'agent2',
        targetAgent: 'agent5',
        weight: 0.1, // 0.2 (influence weight) * 0.5 (decay factor)
        reason: 'Propagated: Original reward'
      })
    );
    
    // Verify trust scores were updated
    expect(mockTrustScoreService.updateAgentTrustScore).toHaveBeenCalledTimes(3);
  });
  
  test('should respect minWeightThreshold and not propagate rewards below threshold', async () => {
    // Update config to have higher threshold
    rewardPropagator.updateConfig({ minWeightThreshold: 0.25 });
    
    const sourceEvent: ReinforcementEvent = {
      id: 'event1',
      timestamp: Date.now(),
      sourceAgent: 'agent1',
      targetAgent: 'agent2',
      reason: 'Original reward',
      weight: 1.0,
      decayTTL: Date.now() + 86400000,
      tags: ['test']
    };
    
    // Mock the influencers method with some below threshold
    jest.spyOn(reinforcementLog, 'getInfluencers').mockReturnValue([
      { agentId: 'agent3', weight: 0.8 }, // After decay: 0.4 - above threshold
      { agentId: 'agent4', weight: 0.6 }, // After decay: 0.3 - above threshold
      { agentId: 'agent5', weight: 0.2 }  // After decay: 0.1 - below threshold
    ]);
    
    const spy = jest.spyOn(reinforcementLog, 'recordEvent');
    
    // Call propagate
    await rewardPropagator.propagateReward(sourceEvent, 1);
    
    // Verify recordEvent was called only for influencers above threshold
    expect(spy).toHaveBeenCalledTimes(2);
    
    // Only agent3 and agent4 should receive propagated rewards
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ targetAgent: 'agent3' })
    );
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ targetAgent: 'agent4' })
    );
    
    // agent5 should not receive propagated reward due to threshold
    expect(spy).not.toHaveBeenCalledWith(
      expect.objectContaining({ targetAgent: 'agent5' })
    );
  });
  
  test('should respect maxDepth and not propagate beyond that level', async () => {
    // Setup test with maximum depth of 2
    rewardPropagator.updateConfig({ maxDepth: 2 });
    
    const sourceEvent: ReinforcementEvent = {
      id: 'event1',
      timestamp: Date.now(),
      sourceAgent: 'agent1',
      targetAgent: 'agent2',
      reason: 'Original reward',
      weight: 1.0,
      decayTTL: Date.now() + 86400000,
      tags: ['test']
    };
    
    // For first level (depth 1), agent2 -> agent3
    const level1Mock = jest.fn().mockReturnValue([
      { agentId: 'agent3', weight: 0.8 }
    ]);
    
    // For second level (depth 2), agent3 -> agent4
    const level2Mock = jest.fn().mockReturnValue([
      { agentId: 'agent4', weight: 0.8 }
    ]);
    
    // For third level (depth 3), agent4 -> agent5 (should not propagate here)
    const level3Mock = jest.fn().mockReturnValue([
      { agentId: 'agent5', weight: 0.8 }
    ]);
    
    // Set up the mock to return different values based on which agent we're getting influencers for
    jest.spyOn(reinforcementLog, 'getInfluencers').mockImplementation((agentId) => {
      if (agentId === 'agent2') return level1Mock();
      if (agentId === 'agent3') return level2Mock();
      if (agentId === 'agent4') return level3Mock();
      return [];
    });
    
    const spy = jest.spyOn(reinforcementLog, 'recordEvent');
    
    // Call propagate with the source event
    await rewardPropagator.propagateReward(sourceEvent, 1);
    
    // Verify correct number of calls to recording events
    // 1 for level 1 (agent3) + 1 for level 2 (agent4) = 2 calls
    expect(spy).toHaveBeenCalledTimes(2);
    
    // Verify the influencers function was called correctly
    expect(level1Mock).toHaveBeenCalled(); // level 1 influencers should be checked
    expect(level2Mock).toHaveBeenCalled(); // level 2 influencers should be checked
    expect(level3Mock).not.toHaveBeenCalled(); // level 3 should not be checked due to maxDepth
  });
  
  test('should respect maxBreadth and limit the number of propagations per level', async () => {
    // Setup test with maximum breadth of 2
    rewardPropagator.updateConfig({ maxBreadth: 2 });
    
    const sourceEvent: ReinforcementEvent = {
      id: 'event1',
      timestamp: Date.now(),
      sourceAgent: 'agent1',
      targetAgent: 'agent2',
      reason: 'Original reward',
      weight: 1.0,
      decayTTL: Date.now() + 86400000,
      tags: ['test']
    };
    
    // Mock with more influencers than maxBreadth allows
    jest.spyOn(reinforcementLog, 'getInfluencers').mockReturnValue([
      { agentId: 'agent3', weight: 0.9 }, // Highest weight - should be propagated
      { agentId: 'agent4', weight: 0.8 }, // Second highest - should be propagated
      { agentId: 'agent5', weight: 0.7 }, // Third highest - should NOT be propagated due to maxBreadth
      { agentId: 'agent6', weight: 0.6 }  // Lowest - should NOT be propagated due to maxBreadth
    ]);
    
    const spy = jest.spyOn(reinforcementLog, 'recordEvent');
    
    // Call propagate
    await rewardPropagator.propagateReward(sourceEvent, 1);
    
    // Verify recordEvent was called only for the top maxBreadth influencers
    expect(spy).toHaveBeenCalledTimes(2);
    
    // Only the top 2 agents (agent3 and agent4) should receive propagated rewards
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ targetAgent: 'agent3' })
    );
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ targetAgent: 'agent4' })
    );
    
    // The rest should not receive propagated rewards
    expect(spy).not.toHaveBeenCalledWith(
      expect.objectContaining({ targetAgent: 'agent5' })
    );
    expect(spy).not.toHaveBeenCalledWith(
      expect.objectContaining({ targetAgent: 'agent6' })
    );
  });
  
  test('should handle errors gracefully during propagation', async () => {
    const sourceEvent: ReinforcementEvent = {
      id: 'event1',
      timestamp: Date.now(),
      sourceAgent: 'agent1',
      targetAgent: 'agent2',
      reason: 'Original reward',
      weight: 1.0,
      decayTTL: Date.now() + 86400000,
      tags: ['test']
    };
    
    // Mock getInfluencers to throw an error
    jest.spyOn(reinforcementLog, 'getInfluencers').mockImplementation(() => {
      throw new Error('Test error');
    });
    
    // Spy on error logging
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    
    // Call propagate - should not throw
    await expect(rewardPropagator.propagateReward(sourceEvent, 1)).resolves.not.toThrow();
    
    // Error should be logged
    expect(errorSpy).toHaveBeenCalled();
  });
}); 