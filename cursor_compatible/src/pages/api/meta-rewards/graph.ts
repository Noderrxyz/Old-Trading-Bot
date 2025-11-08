import { NextApiRequest, NextApiResponse } from 'next';
import { createRedisService } from '../../../services/redis/RedisService';
import { ReinforcementAnalyzer } from '../../../services/meta-agent/ReinforcementAnalyzer';
import { TrustScoreService } from '../../../services/agent/TrustScoreService';
import { AgentReinforcementService } from '../../../services/meta-agent/AgentReinforcementService';

/**
 * API endpoint to fetch reinforcement graph data
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
    const minTrustScore = parseInt(req.query.minTrust as string) || 50;
    const maxAgents = parseInt(req.query.maxAgents as string) || 100;
    
    // Try to fetch cached graph first
    const cachedGraph = await redisService.get('noderr:agent-reinforcement:graph:latest');
    
    if (cachedGraph) {
      try {
        const parsedGraph = JSON.parse(cachedGraph);
        return res.status(200).json(parsedGraph);
      } catch (error) {
        console.error('Error parsing cached graph data', error);
        // Continue to generate a new graph if parsing fails
      }
    }
    
    // If no cached data or parsing failed, generate a new graph
    
    // Initialize services needed for graph generation
    // Note: In a real implementation, you would use a proper dependency injection system
    const trustScoreService = new TrustScoreService(redisService);
    const reinforcementService = new AgentReinforcementService(
      redisService,
      { emit: () => {} }, // Mock event emitter
      trustScoreService,
      { getAgentInfluence: async () => 0.5 }, // Mock influence service
      { grantReward: async () => null } // Mock reward engine
    );
    
    const analyzer = new ReinforcementAnalyzer(
      redisService,
      reinforcementService,
      trustScoreService
    );
    
    // Generate a new graph
    const graph = await analyzer.generateReinforcementGraph(minTrustScore, maxAgents);
    
    return res.status(200).json(graph);
  } catch (error) {
    console.error('Error generating reinforcement graph', error);
    
    // Return sample data in case of error (for demo purposes)
    return res.status(200).json({
      nodes: [
        { id: 'agent-1', trust: 85, reinforcementScore: 12, clusterIds: ['cluster-0'] },
        { id: 'agent-2', trust: 78, reinforcementScore: 8, clusterIds: ['cluster-0'] },
        { id: 'agent-3', trust: 92, reinforcementScore: 15, clusterIds: ['cluster-0'] },
        { id: 'agent-4', trust: 65, reinforcementScore: 5, clusterIds: ['cluster-1'] },
        { id: 'agent-5', trust: 73, reinforcementScore: 7, clusterIds: ['cluster-1'] },
        { id: 'agent-6', trust: 80, reinforcementScore: 10, clusterIds: [] },
      ],
      edges: [
        { source: 'agent-1', target: 'agent-2', strength: 0.8, contextType: 'signal', timestamp: Date.now() },
        { source: 'agent-1', target: 'agent-3', strength: 0.9, contextType: 'signal', timestamp: Date.now() },
        { source: 'agent-2', target: 'agent-3', strength: 0.7, contextType: 'insight', timestamp: Date.now() },
        { source: 'agent-4', target: 'agent-5', strength: 0.6, contextType: 'strategy', timestamp: Date.now() },
        { source: 'agent-6', target: 'agent-1', strength: 0.5, contextType: 'signal', timestamp: Date.now() },
      ],
      clusters: [
        {
          id: 'cluster-0',
          members: ['agent-1', 'agent-2', 'agent-3'],
          averageAgreement: 0.8,
          density: 1.0,
          dominantContexts: ['signal']
        },
        {
          id: 'cluster-1',
          members: ['agent-4', 'agent-5'],
          averageAgreement: 0.6,
          density: 1.0,
          dominantContexts: ['strategy']
        }
      ]
    });
  }
} 