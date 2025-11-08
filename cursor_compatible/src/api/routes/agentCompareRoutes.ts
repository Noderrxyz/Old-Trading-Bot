/**
 * Agent Comparison Routes
 * 
 * API routes for comparing agent performance
 */

import express, { Request, Response, Router } from 'express';
import { AgentMetricsService } from '../services/agentMetricsService.js';
import { AgentCompareQueryParams, AgentHistoryQueryParams } from '../types.js';

/**
 * Create agent comparison router
 * @param metricsService Agent metrics service
 * @returns Express router
 */
export function createAgentCompareRouter(metricsService: AgentMetricsService): Router {
  const router = express.Router();

  /**
   * GET /agents/compare
   * Get performance snapshots for multiple agents
   */
  router.get('/agents/compare', async (req: Request, res: Response) => {
    try {
      // Parse query parameters
      const query: AgentCompareQueryParams = {
        agentIds: req.query.agentIds ? String(req.query.agentIds).split(',') : undefined,
        timeRange: req.query.timeRange ? String(req.query.timeRange) : undefined,
        metrics: req.query.metrics ? String(req.query.metrics).split(',') : undefined
      };
      
      // Get agent performance snapshots
      const snapshots = await metricsService.getAgentPerformanceSnapshots(query.agentIds);
      
      // Apply time range filter if specified
      // Note: Time range filter is applied at the service level
      
      // Filter metrics if specified
      if (query.metrics && query.metrics.length > 0) {
        // Create a copy of the snapshots with only the requested metrics
        const filteredSnapshots = snapshots.map(snapshot => {
          const result: Record<string, any> = {
            agentId: snapshot.agentId,
            name: snapshot.name,
            timestamp: snapshot.timestamp
          };
          
          // Add each requested metric
          for (const metric of query.metrics) {
            if (metric in snapshot) {
              result[metric] = (snapshot as any)[metric];
            }
          }
          
          return result;
        });
        
        return res.json(filteredSnapshots);
      }
      
      // Return all metrics
      return res.json(snapshots);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get agent comparison',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * GET /agents/compare/history
   * Get historical performance data for multiple agents
   */
  router.get('/agents/compare/history', async (req: Request, res: Response) => {
    try {
      // Parse query parameters
      const query: AgentHistoryQueryParams = {
        agentIds: req.query.agentIds ? String(req.query.agentIds).split(',') : undefined,
        timeRange: req.query.timeRange ? String(req.query.timeRange) : undefined,
        resolution: req.query.resolution ? String(req.query.resolution) : undefined,
        metrics: req.query.metrics ? String(req.query.metrics).split(',') : undefined
      };
      
      // Ensure agentIds is provided
      if (!query.agentIds || query.agentIds.length === 0) {
        return res.status(400).json({
          error: 'Bad request',
          message: 'At least one agentId must be provided'
        });
      }
      
      // Get agent performance history
      const history = await metricsService.getAgentPerformanceHistory(
        query.agentIds,
        query.timeRange || '1d',
        query.resolution || '5m'
      );
      
      // Filter metrics if specified
      if (query.metrics && query.metrics.length > 0) {
        // Create a copy of the history with only the requested metrics
        const filteredHistory: Record<string, any[]> = {};
        
        for (const [agentId, points] of Object.entries(history)) {
          filteredHistory[agentId] = points.map(point => {
            const result: Record<string, any> = {
              agentId: point.agentId,
              timestamp: point.timestamp
            };
            
            // Add each requested metric
            for (const metric of query.metrics) {
              if (metric in point) {
                result[metric] = (point as any)[metric];
              }
            }
            
            return result;
          });
        }
        
        return res.json(filteredHistory);
      }
      
      // Return all metrics
      return res.json(history);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get agent history',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  return router;
} 