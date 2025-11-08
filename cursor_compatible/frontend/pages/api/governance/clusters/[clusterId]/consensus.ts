import type { NextApiRequest, NextApiResponse } from 'next';
import Redis from 'ioredis';
import { ClusterConsensusState } from '@/types/governance/cluster.types';

// Initialize Redis client
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { clusterId } = req.query;

  if (!clusterId || typeof clusterId !== 'string') {
    return res.status(400).json({ error: 'Cluster ID is required' });
  }

  try {
    switch (req.method) {
      case 'GET':
        // Retrieve consensus state
        const consensusData = await redis.get(`governance:clusters:consensus:${clusterId}`);
        
        if (!consensusData) {
          // Check if cluster exists
          const clusterExists = await redis.exists(`governance:clusters:${clusterId}`);
          
          if (!clusterExists) {
            return res.status(404).json({ error: 'Cluster not found' });
          }
          
          // Return empty consensus state if cluster exists but no consensus data yet
          const emptyConsensusState: ClusterConsensusState = {
            clusterId,
            activeProposals: 0,
            latestSyncTimestamp: Date.now(),
            quorumStatus: {},
            agentParticipation: {},
            healthScore: 100
          };
          
          return res.status(200).json(emptyConsensusState);
        }
        
        const consensusState: ClusterConsensusState = JSON.parse(consensusData);
        return res.status(200).json(consensusState);
        
      case 'POST':
        // Trigger consensus sync (simplified implementation)
        // In a real implementation, this would call the syncClusterVotes function
        // to refresh consensus data
        
        // For demonstration, we'll just touch the timestamp
        const existingConsensusData = await redis.get(`governance:clusters:consensus:${clusterId}`);
        
        if (!existingConsensusData) {
          return res.status(404).json({ error: 'Consensus state not found' });
        }
        
        const existingConsensus: ClusterConsensusState = JSON.parse(existingConsensusData);
        
        // Update timestamp
        existingConsensus.latestSyncTimestamp = Date.now();
        
        // Store updated consensus state
        await redis.set(
          `governance:clusters:consensus:${clusterId}`,
          JSON.stringify(existingConsensus)
        );
        
        return res.status(200).json({
          success: true,
          message: 'Consensus sync triggered',
          consensusState: existingConsensus
        });
        
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error handling consensus request:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
} 