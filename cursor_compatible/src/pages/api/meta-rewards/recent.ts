import { NextApiRequest, NextApiResponse } from 'next';
import { createRedisService } from '../../../services/redis/RedisService.js';

/**
 * API endpoint to fetch recent meta-reward events
 * 
 * @param req NextApiRequest
 * @param res NextApiResponse
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Initialize required services
    const redisService = createRedisService();
    
    // Get query parameters
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    
    // Fetch recent reward events from Redis
    const rewardKeys = await redisService.keys('noderr:meta-rewards:events:*');
    const recentEvents = [];
    
    // Sort keys by timestamp (descending)
    // In a real implementation, you would use Redis sorted sets for better performance
    for (const key of rewardKeys.slice(offset, offset + limit)) {
      const eventData = await redisService.hgetall(key);
      if (eventData && eventData.id) {
        recentEvents.push({
          id: eventData.id,
          rewardVectorId: eventData.rewardVectorId,
          sourceAgentId: eventData.sourceAgentId,
          targetAgentId: eventData.targetAgentId,
          timestamp: parseInt(eventData.timestamp, 10),
          value: parseFloat(eventData.value),
          isVerified: eventData.isVerified === 'true'
        });
      }
    }
    
    // Sort by timestamp in descending order (most recent first)
    recentEvents.sort((a, b) => b.timestamp - a.timestamp);
    
    return res.status(200).json(recentEvents);
  } catch (error) {
    console.error('Error fetching recent reward events', error);
    
    // Return sample data in case of error (for demo purposes)
    return res.status(200).json([
      {
        id: 'reward-1',
        rewardVectorId: 'signal_accuracy',
        sourceAgentId: 'agent-1',
        targetAgentId: 'agent-3',
        timestamp: Date.now() - 1000 * 60 * 5, // 5 minutes ago
        value: 12.5,
        isVerified: true
      },
      {
        id: 'reward-2',
        rewardVectorId: 'insight_reinforcement',
        sourceAgentId: 'agent-2',
        targetAgentId: 'agent-1',
        timestamp: Date.now() - 1000 * 60 * 15, // 15 minutes ago
        value: 8.0,
        isVerified: true
      },
      {
        id: 'reward-3',
        rewardVectorId: 'novel_insight',
        sourceAgentId: 'agent-4',
        targetAgentId: 'agent-6',
        timestamp: Date.now() - 1000 * 60 * 30, // 30 minutes ago
        value: 15.0,
        isVerified: false
      },
      {
        id: 'reward-4',
        rewardVectorId: 'trust_recovery',
        sourceAgentId: 'system',
        targetAgentId: 'agent-5',
        timestamp: Date.now() - 1000 * 60 * 60, // 1 hour ago
        value: 3.0,
        isVerified: true
      },
      {
        id: 'reward-5',
        rewardVectorId: 'agent_consistency',
        sourceAgentId: 'system',
        targetAgentId: 'agent-2',
        timestamp: Date.now() - 1000 * 60 * 90, // 1.5 hours ago
        value: 8.0,
        isVerified: true
      }
    ]);
  }
} 