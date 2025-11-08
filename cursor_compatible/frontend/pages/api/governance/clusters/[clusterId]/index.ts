import type { NextApiRequest, NextApiResponse } from 'next';
import Redis from 'ioredis';
import { GovernanceCluster } from '@/types/governance/cluster.types';

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
        // Retrieve cluster information
        const clusterData = await redis.get(`governance:clusters:${clusterId}`);
        
        if (!clusterData) {
          return res.status(404).json({ error: 'Cluster not found' });
        }
        
        const cluster: GovernanceCluster = JSON.parse(clusterData);
        return res.status(200).json(cluster);
        
      case 'PUT':
        // Update cluster information (requires authentication - simplified for demo)
        if (!req.body) {
          return res.status(400).json({ error: 'Request body is required' });
        }
        
        const existingClusterData = await redis.get(`governance:clusters:${clusterId}`);
        
        if (!existingClusterData) {
          return res.status(404).json({ error: 'Cluster not found' });
        }
        
        const existingCluster: GovernanceCluster = JSON.parse(existingClusterData);
        
        // Merge existing cluster with updates, preserving id and genesisAt
        const updatedCluster = {
          ...existingCluster,
          ...req.body,
          id: existingCluster.id,
          genesisAt: existingCluster.genesisAt
        };
        
        // Validate updated cluster
        if (!updatedCluster.name || updatedCluster.name.length < 3) {
          return res.status(400).json({ error: 'Cluster name must be at least 3 characters' });
        }
        
        // Store updated cluster
        await redis.set(
          `governance:clusters:${clusterId}`,
          JSON.stringify(updatedCluster)
        );
        
        // Update scope index if scope changed
        if (req.body.scope && req.body.scope !== existingCluster.scope) {
          await redis.srem(`governance:clusters:scope:${existingCluster.scope}`, clusterId);
          await redis.sadd(`governance:clusters:scope:${req.body.scope}`, clusterId);
        }
        
        return res.status(200).json(updatedCluster);
        
      case 'DELETE':
        // Delete cluster (requires authentication - simplified for demo)
        const clusterToDeleteData = await redis.get(`governance:clusters:${clusterId}`);
        
        if (!clusterToDeleteData) {
          return res.status(404).json({ error: 'Cluster not found' });
        }
        
        const clusterToDelete: GovernanceCluster = JSON.parse(clusterToDeleteData);
        
        // Remove from indexes
        await redis.srem('governance:clusters:index', clusterId);
        await redis.srem(`governance:clusters:scope:${clusterToDelete.scope}`, clusterId);
        
        // Remove from agent indexes
        for (const agent of clusterToDelete.agents) {
          await redis.srem(`governance:agent:${agent.did}:clusters`, clusterId);
        }
        
        // Delete cluster data
        await redis.del(`governance:clusters:${clusterId}`);
        
        return res.status(200).json({ success: true, message: 'Cluster deleted' });
        
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error handling cluster request:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
} 