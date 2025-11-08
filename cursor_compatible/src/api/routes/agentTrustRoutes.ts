import express from 'express';
import { RedisService } from '../../services/redis/RedisService.js';
import { TrustScoreService } from '../../services/agent/TrustScoreService.js';
import { createLogger } from '../../common/logger.js';

const router = express.Router();
const logger = createLogger('TrustRoutes');

// Initialize services
const redisService = new RedisService();
const trustScoreService = new TrustScoreService(redisService);

/**
 * @route GET /api/agents/trust
 * @description Get trust scores for all agents or specified agents
 * @param {string} timeRange - Optional time range for history (1h, 1d, 7d, 30d)
 * @param {string} agentIds - Optional comma-separated list of agent IDs
 */
router.get('/trust', async (req, res) => {
  try {
    const timeRange = (req.query.timeRange as string) || '1d';
    const agentIdsParam = req.query.agentIds as string;
    
    // Parse agent IDs if provided
    const specificAgentIds = agentIdsParam ? agentIdsParam.split(',') : null;
    
    // Get all active agents from Redis
    const agentIds = specificAgentIds || await getAllActiveAgentIds(redisService);
    
    // Collect trust data for each agent
    const agents = await Promise.all(
      agentIds.map(async (agentId) => {
        try {
          // Get current trust score
          const trustScore = await trustScoreService.getScore(agentId);
          
          // Get agent name from Redis
          const agentName = await redisService.get(`agent:${agentId}:name`) || agentId;
          
          // Get health mode
          const trustState = await trustScoreService.getTrustState(agentId);
          
          // Get violation report
          const violations = await trustScoreService.getViolationReport(agentId);
          
          // Get trust history
          const historyLimit = getHistoryLimitForTimeRange(timeRange);
          const history = await trustScoreService.getHistory(agentId, historyLimit);
          
          // Get last enforcement action
          const lastEnforcement = await getLastEnforcementAction(redisService, agentId);
          
          return {
            agentId,
            name: agentName,
            trustScore,
            healthMode: trustState.mode,
            violations,
            history,
            lastEnforcement
          };
        } catch (error) {
          logger.error(`Error getting trust data for agent ${agentId}: ${error}`);
          return null;
        }
      })
    );
    
    // Filter out null values (failed lookups)
    const validAgents = agents.filter(Boolean);
    
    // Return the data
    res.json({
      timestamp: Date.now(),
      timeRange,
      agents: validAgents
    });
  } catch (error) {
    logger.error(`Error in trust routes: ${error}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @route GET /api/agents/trust/:agentId
 * @description Get detailed trust information for a specific agent
 */
router.get('/trust/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const timeRange = (req.query.timeRange as string) || '1d';
    
    // Get current trust score
    const trustScore = await trustScoreService.getScore(agentId);
    
    // Get agent name from Redis
    const agentName = await redisService.get(`agent:${agentId}:name`) || agentId;
    
    // Get trust state
    const trustState = await trustScoreService.getTrustState(agentId);
    
    // Get violation report
    const violations = await trustScoreService.getViolationReport(agentId);
    
    // Get trust history with appropriate limit
    const historyLimit = getHistoryLimitForTimeRange(timeRange);
    const history = await trustScoreService.getHistory(agentId, historyLimit);
    
    // Get enforcement actions
    const enforcementActions = await getEnforcementActions(redisService, agentId, 10);
    
    res.json({
      agentId,
      name: agentName,
      trustScore,
      trustState,
      violations,
      history,
      enforcementActions,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error(`Error getting trust data for agent ${req.params.agentId}: ${error}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @route GET /api/agents/trust/enforcement/history
 * @description Get global enforcement history
 */
router.get('/trust/enforcement/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    
    // Get global enforcement history
    const historyData = await redisService.lrange('global:trust:enforcement_events', 0, limit - 1);
    
    // Parse JSON data
    const history = historyData.map((item: string) => JSON.parse(item));
    
    res.json({
      timestamp: Date.now(),
      history
    });
  } catch (error) {
    logger.error(`Error getting enforcement history: ${error}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @route GET /api/agents/trust/metrics
 * @description Get system-wide trust metrics
 */
router.get('/trust/metrics', async (req, res) => {
  try {
    // Get all active agents
    const agentIds = await getAllActiveAgentIds(redisService);
    
    // Get trust scores for all agents
    const trustScores = await Promise.all(
      agentIds.map(agentId => trustScoreService.getScore(agentId))
    );
    
    // Get health modes for all agents
    const healthModes = await Promise.all(
      agentIds.map(agentId => trustScoreService.getTrustState(agentId).then(state => state.mode))
    );
    
    // Calculate metrics
    const metrics = {
      totalAgents: agentIds.length,
      averageTrustScore: calculateAverage(trustScores),
      trustDistribution: calculateDistribution(trustScores),
      healthModeDistribution: calculateHealthDistribution(healthModes),
      timestamp: Date.now()
    };
    
    res.json(metrics);
  } catch (error) {
    logger.error(`Error getting trust metrics: ${error}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper functions

/**
 * Get all active agent IDs from Redis
 */
async function getAllActiveAgentIds(redis: RedisService): Promise<string[]> {
  try {
    // Get keys for all registered agents
    const agentKeys = await redis.keys('agent:*:registration');
    
    // Extract agent IDs from keys
    return agentKeys.map((key: string) => {
      const match = key.match(/agent:(.+):registration/);
      return match ? match[1] : null;
    }).filter(Boolean) as string[];
  } catch (error) {
    logger.error(`Error getting active agent IDs: ${error}`);
    return [];
  }
}

/**
 * Get the last enforcement action for an agent
 */
async function getLastEnforcementAction(
  redis: RedisService, 
  agentId: string
): Promise<any | null> {
  try {
    const data = await redis.lindex(`agent:${agentId}:trust_events`, 0);
    if (!data) return null;
    
    const event = JSON.parse(data);
    return event.type === 'enforcement' ? event : null;
  } catch (error) {
    logger.error(`Error getting last enforcement action for ${agentId}: ${error}`);
    return null;
  }
}

/**
 * Get enforcement actions for an agent
 */
async function getEnforcementActions(
  redis: RedisService, 
  agentId: string, 
  limit: number
): Promise<any[]> {
  try {
    const data = await redis.lrange(`agent:${agentId}:trust_events`, 0, limit - 1);
    
    // Parse and filter for enforcement events
    return data
      .map((item: string) => JSON.parse(item))
      .filter((event: any) => event.type === 'enforcement');
  } catch (error) {
    logger.error(`Error getting enforcement actions for ${agentId}: ${error}`);
    return [];
  }
}

/**
 * Get history limit based on time range
 */
function getHistoryLimitForTimeRange(timeRange: string): number {
  switch (timeRange) {
    case '1h': return 60; // One data point per minute
    case '1d': return 288; // One data point per 5 minutes
    case '7d': return 336; // One data point per 30 minutes
    case '30d': return 720; // One data point per hour
    default: return 100;
  }
}

/**
 * Calculate average of an array of numbers
 */
function calculateAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Calculate distribution of trust scores
 */
function calculateDistribution(scores: number[]): Record<string, number> {
  const distribution: Record<string, number> = {
    'excellent': 0, // 0.8 - 1.0
    'good': 0,      // 0.6 - 0.8
    'fair': 0,      // 0.4 - 0.6
    'poor': 0,      // 0.2 - 0.4
    'critical': 0   // 0.0 - 0.2
  };
  
  scores.forEach(score => {
    if (score >= 0.8) distribution.excellent++;
    else if (score >= 0.6) distribution.good++;
    else if (score >= 0.4) distribution.fair++;
    else if (score >= 0.2) distribution.poor++;
    else distribution.critical++;
  });
  
  return distribution;
}

/**
 * Calculate distribution of health modes
 */
function calculateHealthDistribution(modes: string[]): Record<string, number> {
  const distribution: Record<string, number> = {};
  
  modes.forEach(mode => {
    if (!distribution[mode]) distribution[mode] = 0;
    distribution[mode]++;
  });
  
  return distribution;
}

export default router; 