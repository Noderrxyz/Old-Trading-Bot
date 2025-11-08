/**
 * PolicyGraphConsolidationService.ts
 * 
 * Main service for the Policy Graph Consolidation Engine:
 * - Integrates analyzer, consolidator and journal
 * - Provides high-level operations for graph optimization
 * - Handles scheduled and on-demand consolidation tasks
 */

import { 
  PolicyGraphAnalyzer, 
  PolicyGraph,
  OptimizationSuggestion
} from './PolicyGraphAnalyzer.js';
import { 
  GraphConsolidator, 
  GraphChange 
} from './GraphConsolidator.js';
import { 
  ConsolidationJournal,
  JournalQueryOptions 
} from './ConsolidationJournal.js';
import { RegretBuffer } from '../RegretBuffer.js';
import { TrustScoreService } from '../TrustScoreService.js';
import { RedisService } from '../../infrastructure/RedisService.js';
import logger from '../../../utils/logger.js';

/**
 * Configuration for the consolidation service
 */
export interface PolicyGraphConsolidationConfig {
  // Whether to enable automatic consolidation
  enableAutoConsolidation: boolean;
  
  // Minimum time between consolidations for an agent (ms)
  minConsolidationIntervalMs: number;
  
  // Redis key for storing last consolidation timestamps
  lastConsolidationKey: string;
  
  // Redis key prefix for policy graphs
  graphKeyPrefix: string;
  
  // Whether to run in dry run mode (no actual changes)
  dryRun: boolean;
  
  // Maximum agents to process in a batch
  maxAgentsPerBatch: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: PolicyGraphConsolidationConfig = {
  enableAutoConsolidation: true,
  minConsolidationIntervalMs: 24 * 60 * 60 * 1000, // 24 hours
  lastConsolidationKey: 'agent:last_graph_consolidation',
  graphKeyPrefix: 'agent:policy_graph',
  dryRun: false,
  maxAgentsPerBatch: 50
};

/**
 * PolicyGraphConsolidationService
 * 
 * Integrates the analyzer, consolidator and journal components
 */
export class PolicyGraphConsolidationService {
  private analyzer: PolicyGraphAnalyzer;
  private consolidator: GraphConsolidator;
  private journal: ConsolidationJournal;
  private redisService: RedisService;
  private config: PolicyGraphConsolidationConfig;
  
  /**
   * Creates a new PolicyGraphConsolidationService
   * 
   * @param analyzer - Policy graph analyzer
   * @param consolidator - Graph consolidator
   * @param journal - Consolidation journal
   * @param redisService - Redis service
   * @param config - Service configuration
   */
  constructor(
    analyzer: PolicyGraphAnalyzer,
    consolidator: GraphConsolidator,
    journal: ConsolidationJournal,
    redisService: RedisService,
    config: Partial<PolicyGraphConsolidationConfig> = {}
  ) {
    this.analyzer = analyzer;
    this.consolidator = consolidator;
    this.journal = journal;
    this.redisService = redisService;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    logger.info('PolicyGraphConsolidationService initialized', {
      enableAutoConsolidation: this.config.enableAutoConsolidation,
      dryRun: this.config.dryRun
    });
  }
  
  /**
   * Static factory method to create a service instance with dependencies
   * 
   * @param regretBuffer - Regret buffer service
   * @param trustScoreService - Trust score service
   * @param redisService - Redis service
   * @param config - Service configuration
   * @returns New service instance
   */
  public static createService(
    regretBuffer: RegretBuffer,
    trustScoreService: TrustScoreService,
    redisService: RedisService,
    config: Partial<PolicyGraphConsolidationConfig> = {}
  ): PolicyGraphConsolidationService {
    // Create components
    const analyzer = new PolicyGraphAnalyzer(
      regretBuffer,
      trustScoreService,
      redisService
    );
    
    const consolidator = new GraphConsolidator(
      trustScoreService,
      redisService,
      {
        dryRun: config.dryRun || DEFAULT_CONFIG.dryRun,
        redisKeyPrefix: config.graphKeyPrefix || DEFAULT_CONFIG.graphKeyPrefix
      }
    );
    
    const journal = new ConsolidationJournal(
      redisService,
      {
        redisKeyPrefix: config.graphKeyPrefix || DEFAULT_CONFIG.graphKeyPrefix
      }
    );
    
    return new PolicyGraphConsolidationService(
      analyzer,
      consolidator,
      journal,
      redisService,
      config
    );
  }
  
  /**
   * Analyze and consolidate a policy graph
   * 
   * @param graph - Policy graph to consolidate
   * @param force - Whether to force consolidation even if recent
   * @returns Result with suggestions, changes, and updated graph
   */
  public async consolidateGraph(
    graph: PolicyGraph,
    force: boolean = false
  ): Promise<{
    suggestions: OptimizationSuggestion[];
    changes: GraphChange[];
    updatedGraph: PolicyGraph;
  }> {
    try {
      // Check if consolidation is allowed for this agent
      if (!force && !await this.canConsolidate(graph.agentId)) {
        logger.info('Skipping consolidation (too recent)', {
          graphId: graph.id,
          agentId: graph.agentId
        });
        
        return {
          suggestions: [],
          changes: [],
          updatedGraph: graph
        };
      }
      
      logger.info('Starting graph consolidation', {
        graphId: graph.id,
        agentId: graph.agentId,
        forced: force
      });
      
      // Step 1: Analyze the graph
      const suggestions = await this.analyzer.analyze(graph);
      
      logger.info('Analysis complete', {
        graphId: graph.id,
        suggestionCount: suggestions.length
      });
      
      // Step 2: Apply the suggestions if there are any
      let changes: GraphChange[] = [];
      let updatedGraph = graph;
      
      if (suggestions.length > 0) {
        const result = await this.consolidator.consolidate(graph, suggestions);
        changes = result.changes;
        updatedGraph = result.updatedGraph;
        
        logger.info('Consolidation complete', {
          graphId: graph.id,
          changesApplied: changes.length
        });
        
        // Step 3: Log changes to journal if not in dry run mode
        if (!this.config.dryRun) {
          for (const change of changes) {
            await this.journal.logChange(change);
          }
          
          // Update last consolidation timestamp
          await this.updateLastConsolidation(graph.agentId);
        }
      } else {
        logger.info('No consolidation needed', {
          graphId: graph.id
        });
      }
      
      return {
        suggestions,
        changes,
        updatedGraph
      };
    } catch (error) {
      logger.error('Error consolidating graph', {
        error: error instanceof Error ? error.message : String(error),
        graphId: graph.id,
        agentId: graph.agentId
      });
      
      return {
        suggestions: [],
        changes: [],
        updatedGraph: graph
      };
    }
  }
  
  /**
   * Run consolidation for a specific agent
   * 
   * @param agentId - Agent ID
   * @param force - Whether to force consolidation even if recent
   * @returns Result with suggestions, changes, and updated graph
   */
  public async consolidateAgent(
    agentId: string,
    force: boolean = false
  ): Promise<{
    suggestions: OptimizationSuggestion[];
    changes: GraphChange[];
    updatedGraph: PolicyGraph | null;
  }> {
    try {
      // Find the agent's graph
      const graphId = await this.findAgentGraphId(agentId);
      
      if (!graphId) {
        logger.warn('No graph found for agent', { agentId });
        return {
          suggestions: [],
          changes: [],
          updatedGraph: null
        };
      }
      
      // Load the graph
      const graph = await this.consolidator.loadGraph(graphId);
      
      if (!graph) {
        logger.warn('Failed to load graph', { graphId, agentId });
        return {
          suggestions: [],
          changes: [],
          updatedGraph: null
        };
      }
      
      // Run consolidation
      return await this.consolidateGraph(graph, force);
    } catch (error) {
      logger.error('Error consolidating agent', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      
      return {
        suggestions: [],
        changes: [],
        updatedGraph: null
      };
    }
  }
  
  /**
   * Run batch consolidation for all eligible agents
   * 
   * @returns Results for each agent
   */
  public async consolidateBatch(): Promise<{
    agentId: string;
    success: boolean;
    changesApplied: number;
  }[]> {
    try {
      // Find agents with graphs
      const agents = await this.findAgentsWithGraphs();
      
      logger.info('Starting batch consolidation', {
        totalAgents: agents.length,
        maxBatchSize: this.config.maxAgentsPerBatch
      });
      
      // Process in batches
      const results: {
        agentId: string;
        success: boolean;
        changesApplied: number;
      }[] = [];
      
      // Limit batch size
      const agentsToProcess = agents.slice(0, this.config.maxAgentsPerBatch);
      
      for (const agentId of agentsToProcess) {
        try {
          // Check if consolidation is allowed
          if (!await this.canConsolidate(agentId)) {
            results.push({
              agentId,
              success: true,
              changesApplied: 0
            });
            continue;
          }
          
          // Run consolidation
          const result = await this.consolidateAgent(agentId);
          
          results.push({
            agentId,
            success: true,
            changesApplied: result.changes.length
          });
        } catch (error) {
          logger.error('Error consolidating agent in batch', {
            error: error instanceof Error ? error.message : String(error),
            agentId
          });
          
          results.push({
            agentId,
            success: false,
            changesApplied: 0
          });
        }
      }
      
      logger.info('Batch consolidation complete', {
        processedAgents: results.length,
        successCount: results.filter(r => r.success).length,
        totalChangesApplied: results.reduce((sum, r) => sum + r.changesApplied, 0)
      });
      
      return results;
    } catch (error) {
      logger.error('Error in batch consolidation', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      return [];
    }
  }
  
  /**
   * Query the journal for agent changes
   * 
   * @param agentId - Agent ID
   * @param options - Query options
   * @returns Consolidation changes
   */
  public async getAgentChanges(
    agentId: string,
    options: JournalQueryOptions = {}
  ): Promise<GraphChange[]> {
    return await this.journal.getAgentChanges(agentId, options);
  }
  
  /**
   * Query the journal for graph changes
   * 
   * @param graphId - Graph ID
   * @param options - Query options
   * @returns Consolidation changes
   */
  public async getGraphChanges(
    graphId: string,
    options: JournalQueryOptions = {}
  ): Promise<GraphChange[]> {
    return await this.journal.getGraphChanges(graphId, options);
  }
  
  /**
   * Rollback to a previous graph version
   * 
   * @param graphId - Graph ID
   * @param version - Version to rollback to
   * @returns Whether rollback was successful
   */
  public async rollbackGraph(
    graphId: string,
    version: number
  ): Promise<boolean> {
    return await this.consolidator.rollbackToVersion(graphId, version);
  }
  
  /**
   * Get graph metrics for an agent
   * 
   * @param agentId - Agent ID
   * @param days - Number of days to analyze
   * @returns Graph metrics
   */
  public async getAgentGraphMetrics(
    agentId: string,
    days: number = 30
  ): Promise<any> {
    try {
      // Find the agent's graph
      const graphId = await this.findAgentGraphId(agentId);
      
      if (!graphId) {
        logger.warn('No graph found for agent', { agentId });
        return null;
      }
      
      // Calculate time range
      const endTime = Date.now();
      const startTime = endTime - (days * 24 * 60 * 60 * 1000);
      
      // Get metrics
      return await this.journal.getGraphMetrics(graphId, startTime, endTime);
    } catch (error) {
      logger.error('Error getting agent graph metrics', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      
      return null;
    }
  }
  
  /**
   * Check if an agent can be consolidated based on last consolidation time
   * 
   * @param agentId - Agent ID
   * @returns Whether consolidation is allowed
   */
  private async canConsolidate(agentId: string): Promise<boolean> {
    // If auto consolidation is disabled, only forced consolidation is allowed
    if (!this.config.enableAutoConsolidation) {
      return false;
    }
    
    try {
      // Get last consolidation timestamp
      const key = `${this.config.lastConsolidationKey}:${agentId}`;
      const lastConsolidation = await this.redisService.get(key);
      
      if (!lastConsolidation) {
        return true; // No previous consolidation
      }
      
      const lastTimestamp = parseInt(lastConsolidation, 10);
      const now = Date.now();
      
      // Check if enough time has passed
      return (now - lastTimestamp) >= this.config.minConsolidationIntervalMs;
    } catch (error) {
      logger.error('Error checking consolidation eligibility', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      
      return false;
    }
  }
  
  /**
   * Update last consolidation timestamp for an agent
   * 
   * @param agentId - Agent ID
   */
  private async updateLastConsolidation(agentId: string): Promise<void> {
    try {
      const key = `${this.config.lastConsolidationKey}:${agentId}`;
      const now = Date.now().toString();
      
      await this.redisService.set(key, now);
    } catch (error) {
      logger.error('Error updating last consolidation timestamp', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
    }
  }
  
  /**
   * Find the graph ID for an agent
   * 
   * @param agentId - Agent ID
   * @returns Graph ID or null if not found
   */
  private async findAgentGraphId(agentId: string): Promise<string | null> {
    try {
      // In a real system, there would be a mapping from agent to graph
      // For now, we'll assume the format agentId = graphId for simplicity
      const key = `${this.config.graphKeyPrefix}:${agentId}`;
      const exists = await this.redisService.exists(key);
      
      return exists ? agentId : null;
    } catch (error) {
      logger.error('Error finding agent graph ID', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      
      return null;
    }
  }
  
  /**
   * Find all agents with policy graphs
   * 
   * @returns Array of agent IDs
   */
  private async findAgentsWithGraphs(): Promise<string[]> {
    try {
      // Get all graph keys
      const pattern = `${this.config.graphKeyPrefix}:*`;
      const keys = await this.redisService.keys(pattern);
      
      // Extract agent IDs from keys
      const agentIds = keys
        .map(key => key.split(':').pop() || '')
        .filter(id => id && !id.includes(':') && !id.includes('journal'));
      
      return [...new Set(agentIds)]; // Ensure uniqueness
    } catch (error) {
      logger.error('Error finding agents with graphs', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      return [];
    }
  }
} 