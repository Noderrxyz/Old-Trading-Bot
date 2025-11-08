/**
 * AgentManager.ts
 * 
 * Extension to add Policy Graph Consolidation integration
 */

// Import the PolicyGraphConsolidationService
import { PolicyGraphConsolidationService } from './policy-graph/PolicyGraphConsolidationService.js';
import { RegretBuffer } from './RegretBuffer.js';
import { TrustScoreService } from './TrustScoreService.js';
import { RedisService } from '../infrastructure/RedisService.js';
import logger from '../../utils/logger.js';

/**
 * Add policy graph consolidation methods to AgentManager
 */
export class AgentManager {
  private policyGraphConsolidationService: PolicyGraphConsolidationService | null = null;
  
  // ... existing AgentManager code ...
  
  /**
   * Initialize policy graph consolidation
   * 
   * @param redisService - Redis service
   * @param regretBuffer - Regret buffer service
   * @param trustScoreService - Trust score service
   */
  public initializePolicyGraphConsolidation(
    redisService: RedisService,
    regretBuffer: RegretBuffer,
    trustScoreService: TrustScoreService
  ): void {
    try {
      this.policyGraphConsolidationService = PolicyGraphConsolidationService.createService(
        regretBuffer,
        trustScoreService,
        redisService
      );
      
      logger.info('Policy Graph Consolidation initialized in AgentManager');
    } catch (error) {
      logger.error('Failed to initialize Policy Graph Consolidation', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  /**
   * Run policy graph consolidation for an agent
   * 
   * @param agentId - Agent ID
   * @param force - Whether to force consolidation even if recent
   * @returns Consolidation result or null if service not initialized
   */
  public async consolidateAgentPolicyGraph(
    agentId: string,
    force: boolean = false
  ): Promise<any> {
    if (!this.policyGraphConsolidationService) {
      logger.warn('Policy Graph Consolidation service not initialized');
      return null;
    }
    
    try {
      logger.info('Running policy graph consolidation for agent', { agentId });
      
      const result = await this.policyGraphConsolidationService.consolidateAgent(
        agentId,
        force
      );
      
      logger.info('Policy graph consolidation complete', {
        agentId,
        changesApplied: result.changes.length
      });
      
      return result;
    } catch (error) {
      logger.error('Error in policy graph consolidation', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      
      return null;
    }
  }
  
  /**
   * Run batch consolidation for all eligible agents
   * 
   * @returns Batch consolidation results or null if service not initialized
   */
  public async batchConsolidatePolicyGraphs(): Promise<any> {
    if (!this.policyGraphConsolidationService) {
      logger.warn('Policy Graph Consolidation service not initialized');
      return null;
    }
    
    try {
      logger.info('Running batch policy graph consolidation');
      
      const results = await this.policyGraphConsolidationService.consolidateBatch();
      
      logger.info('Batch policy graph consolidation complete', {
        totalAgents: results.length,
        agentsWithChanges: results.filter(r => r.changesApplied > 0).length
      });
      
      return results;
    } catch (error) {
      logger.error('Error in batch policy graph consolidation', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      return null;
    }
  }
  
  /**
   * Get policy graph metrics for an agent
   * 
   * @param agentId - Agent ID
   * @param days - Number of days to analyze
   * @returns Graph metrics or null if service not initialized
   */
  public async getAgentPolicyGraphMetrics(
    agentId: string,
    days: number = 30
  ): Promise<any> {
    if (!this.policyGraphConsolidationService) {
      logger.warn('Policy Graph Consolidation service not initialized');
      return null;
    }
    
    try {
      return await this.policyGraphConsolidationService.getAgentGraphMetrics(agentId, days);
    } catch (error) {
      logger.error('Error getting agent policy graph metrics', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      
      return null;
    }
  }
} 