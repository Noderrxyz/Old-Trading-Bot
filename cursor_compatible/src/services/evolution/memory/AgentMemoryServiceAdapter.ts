/**
 * Agent Memory Service Adapter
 * 
 * Adapter that connects the memory injection system to the agent memory system.
 * This abstracts the underlying memory implementation and provides common operations.
 */

import logger from '../../../utils/logger.js';
import { StrategyMemoryEntry } from './MemoryInjector.js';

/**
 * Configuration for Memory Service Adapter
 */
export interface MemoryServiceAdapterConfig {
  /** Whether to validate memory entries before storing */
  validateEntries: boolean;
  
  /** Whether to enable retrieving memories */
  enableRetrieval: boolean;
  
  /** Maximum number of entries to return per retrieval */
  maxRetrievalResults: number;
}

/**
 * Default configuration for Memory Service Adapter
 */
const DEFAULT_CONFIG: MemoryServiceAdapterConfig = {
  validateEntries: true,
  enableRetrieval: true,
  maxRetrievalResults: 10
};

/**
 * Adapter for connecting to the agent memory system
 */
export class AgentMemoryServiceAdapter {
  private config: MemoryServiceAdapterConfig;
  private nativeMemoryService: any; // Will be replaced with actual agent memory service type
  
  /**
   * Create a new AgentMemoryServiceAdapter
   * 
   * @param nativeMemoryService - Native agent memory service
   * @param config - Configuration options
   */
  constructor(
    nativeMemoryService: any, // Will be replaced with actual agent memory service type
    config: Partial<MemoryServiceAdapterConfig> = {}
  ) {
    this.nativeMemoryService = nativeMemoryService;
    
    this.config = {
      ...DEFAULT_CONFIG,
      ...config
    };
    
    logger.info(`AgentMemoryServiceAdapter initialized with validateEntries: ${this.config.validateEntries}`);
  }
  
  /**
   * Store a memory entry for an agent
   * 
   * @param agentId - ID of the agent
   * @param memory - Memory entry to store
   * @param expiresAt - Optional expiration timestamp (ms since epoch)
   * @returns ID of the stored memory
   */
  public async storeMemory(
    agentId: string,
    memory: StrategyMemoryEntry,
    expiresAt?: number
  ): Promise<string> {
    if (this.config.validateEntries) {
      this.validateMemoryEntry(memory);
    }
    
    try {
      // Store memory using the native memory service
      const memoryId = await this.nativeMemoryService.storeMemory({
        agentId,
        memory,
        expiresAt
      });
      
      logger.info(`Stored memory ${memoryId} for agent ${agentId}`);
      
      return memoryId;
    } catch (error) {
      logger.error(`Error storing memory for agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Retrieve memories for an agent based on tags
   * 
   * @param agentId - ID of the agent
   * @param tags - Tags to filter by (AND condition)
   * @param limit - Maximum number of results
   * @returns Array of matching memory entries
   */
  public async retrieveMemoriesByTags(
    agentId: string,
    tags: string[],
    limit: number = this.config.maxRetrievalResults
  ): Promise<StrategyMemoryEntry[]> {
    if (!this.config.enableRetrieval) {
      throw new Error('Memory retrieval is disabled in adapter configuration');
    }
    
    try {
      // Retrieve memories using the native memory service
      const memories = await this.nativeMemoryService.retrieveMemories({
        agentId,
        filters: {
          tags,
          type: 'strategy_learning'
        },
        limit
      });
      
      logger.info(`Retrieved ${memories.length} memories for agent ${agentId} with tags ${tags.join(', ')}`);
      
      return memories as StrategyMemoryEntry[];
    } catch (error) {
      logger.error(`Error retrieving memories for agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
  /**
   * Retrieve memories for an agent based on market conditions
   * 
   * @param agentId - ID of the agent
   * @param marketConditions - Market conditions to filter by
   * @param limit - Maximum number of results
   * @returns Array of matching memory entries
   */
  public async retrieveMemoriesByMarketConditions(
    agentId: string,
    marketConditions: string[],
    limit: number = this.config.maxRetrievalResults
  ): Promise<StrategyMemoryEntry[]> {
    // Convert market conditions to tags
    const tags = marketConditions.map(condition => `market_${condition}`);
    
    return this.retrieveMemoriesByTags(agentId, tags, limit);
  }
  
  /**
   * Search memories by relevance to a query
   * 
   * @param agentId - ID of the agent
   * @param query - Search query
   * @param limit - Maximum number of results
   * @returns Array of matching memory entries with relevance scores
   */
  public async searchMemoriesByRelevance(
    agentId: string,
    query: string,
    limit: number = this.config.maxRetrievalResults
  ): Promise<Array<{ memory: StrategyMemoryEntry; relevance: number }>> {
    if (!this.config.enableRetrieval) {
      throw new Error('Memory retrieval is disabled in adapter configuration');
    }
    
    try {
      // Search memories using the native memory service
      const results = await this.nativeMemoryService.searchMemories({
        agentId,
        query,
        filters: {
          type: 'strategy_learning'
        },
        limit
      });
      
      logger.info(`Found ${results.length} relevant memories for agent ${agentId} with query "${query}"`);
      
      return results.map((result: any) => ({
        memory: result.memory as StrategyMemoryEntry,
        relevance: result.score || result.relevance || 0
      }));
    } catch (error) {
      logger.error(`Error searching memories for agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
  /**
   * Delete a memory entry
   * 
   * @param agentId - ID of the agent
   * @param memoryId - ID of the memory to delete
   * @returns Whether the deletion was successful
   */
  public async deleteMemory(
    agentId: string,
    memoryId: string
  ): Promise<boolean> {
    try {
      // Delete memory using the native memory service
      const success = await this.nativeMemoryService.deleteMemory(agentId, memoryId);
      
      if (success) {
        logger.info(`Deleted memory ${memoryId} for agent ${agentId}`);
      } else {
        logger.warn(`Failed to delete memory ${memoryId} for agent ${agentId}`);
      }
      
      return success;
    } catch (error) {
      logger.error(`Error deleting memory ${memoryId} for agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
  
  /**
   * Update memory expiration
   * 
   * @param agentId - ID of the agent
   * @param memoryId - ID of the memory
   * @param expiresAt - New expiration timestamp
   * @returns Whether the update was successful
   */
  public async updateMemoryExpiration(
    agentId: string,
    memoryId: string,
    expiresAt: number
  ): Promise<boolean> {
    try {
      // Update memory expiration using the native memory service
      const success = await this.nativeMemoryService.updateMemoryExpiration(agentId, memoryId, expiresAt);
      
      if (success) {
        logger.info(`Updated expiration for memory ${memoryId} to ${new Date(expiresAt).toISOString()}`);
      } else {
        logger.warn(`Failed to update expiration for memory ${memoryId}`);
      }
      
      return success;
    } catch (error) {
      logger.error(`Error updating memory expiration: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
  
  /**
   * Validate a memory entry
   * 
   * @param memory - Memory entry to validate
   * @throws Error if the memory entry is invalid
   */
  private validateMemoryEntry(memory: StrategyMemoryEntry): void {
    // Check required fields
    if (!memory.id) throw new Error('Memory entry must have an ID');
    if (!memory.agentId) throw new Error('Memory entry must have an agent ID');
    if (!memory.strategyId) throw new Error('Memory entry must have a strategy ID');
    if (!memory.generationId) throw new Error('Memory entry must have a generation ID');
    if (!memory.timestamp) throw new Error('Memory entry must have a timestamp');
    if (!memory.content) throw new Error('Memory entry must have content');
    
    // Check content structure
    if (!memory.content.learnings || !Array.isArray(memory.content.learnings)) {
      throw new Error('Memory content must have an array of learnings');
    }
    
    if (memory.content.learnings.length === 0) {
      throw new Error('Memory must have at least one learning');
    }
    
    // Check each learning
    memory.content.learnings.forEach((learning, index) => {
      if (!learning.id) throw new Error(`Learning ${index} must have an ID`);
      if (!learning.insight) throw new Error(`Learning ${index} must have an insight`);
      if (!learning.context) throw new Error(`Learning ${index} must have a context`);
      if (learning.confidence === undefined || learning.confidence < 0 || learning.confidence > 1) {
        throw new Error(`Learning ${index} must have a valid confidence value (0-1)`);
      }
    });
    
    // Check tags
    if (!memory.tags || !Array.isArray(memory.tags)) {
      throw new Error('Memory entry must have tags array');
    }
  }
  
  /**
   * Update configuration options
   * 
   * @param config - Partial configuration to update
   */
  public updateConfig(config: Partial<MemoryServiceAdapterConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };
    
    logger.info(`AgentMemoryServiceAdapter configuration updated: ${JSON.stringify(this.config)}`);
  }
} 