/**
 * Memory Manager for Meta-Agent System
 * 
 * Manages long-term memory for the meta-agent, tracking execution history,
 * outcomes, and facilitating reinforcement learning from past experiences.
 */

import { AgentMemoryEntry } from '../../types/metaAgent.types.js';

/**
 * Mock database client for the purposes of this implementation
 */
class MockDbClient {
  private memories: AgentMemoryEntry[] = [];
  private nextId = 1;

  async insert(entry: AgentMemoryEntry): Promise<AgentMemoryEntry> {
    const newEntry = {
      ...entry,
      id: entry.id || `mem_${this.nextId++}`,
      timestamp: entry.timestamp || Date.now()
    };
    this.memories.push(newEntry);
    return newEntry;
  }

  async find(query: Record<string, any>, options: { limit?: number, sort?: Record<string, 1 | -1> } = {}): Promise<AgentMemoryEntry[]> {
    let results = [...this.memories];
    
    // Apply filters
    for (const [key, value] of Object.entries(query)) {
      results = results.filter(entry => {
        const parts = key.split('.');
        let obj: any = entry;
        
        // Handle nested properties
        for (let i = 0; i < parts.length - 1; i++) {
          if (!obj[parts[i]]) return false;
          obj = obj[parts[i]];
        }
        
        const lastPart = parts[parts.length - 1];
        return obj[lastPart] === value;
      });
    }
    
    // Apply sorting
    if (options.sort) {
      const [sortField, sortDir] = Object.entries(options.sort)[0];
      results.sort((a: any, b: any) => {
        const aVal = this.getNestedValue(a, sortField);
        const bVal = this.getNestedValue(b, sortField);
        return sortDir === 1 ? aVal - bVal : bVal - aVal;
      });
    }
    
    // Apply limit
    if (options.limit) {
      results = results.slice(0, options.limit);
    }
    
    return results;
  }
  
  async count(query: Record<string, any>): Promise<number> {
    const results = await this.find(query);
    return results.length;
  }
  
  private getNestedValue(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;
    
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    
    return current;
  }
}

/**
 * Memory Manager for Meta-Agent
 * 
 * Responsible for storing and retrieving memory entries
 * about agent actions and their outcomes.
 */
export class MemoryManager {
  private dbClient: MockDbClient;
  private memoryCache: AgentMemoryEntry[] = [];
  private cacheSize: number;
  private cacheEnabled: boolean;

  constructor(options: { cacheSize?: number, cacheEnabled?: boolean } = {}) {
    this.dbClient = new MockDbClient();
    this.cacheSize = options.cacheSize || 100;
    this.cacheEnabled = options.cacheEnabled !== false;
  }

  /**
   * Store a new memory entry
   * @param entry The memory entry to store
   * @returns The stored entry with ID
   */
  async storeMemory(entry: AgentMemoryEntry): Promise<AgentMemoryEntry> {
    // Ensure timestamp exists
    if (!entry.timestamp) {
      entry.timestamp = Date.now();
    }
    
    // Store in database
    const storedEntry = await this.dbClient.insert(entry);
    
    // Update cache if enabled
    if (this.cacheEnabled) {
      this.memoryCache.unshift(storedEntry);
      
      // Trim cache if needed
      if (this.memoryCache.length > this.cacheSize) {
        this.memoryCache.pop();
      }
    }
    
    return storedEntry;
  }

  /**
   * Get recent memory entries
   * @param limit Maximum number of entries to return
   * @returns Array of memory entries
   */
  async getRecentMemories(limit: number = 10): Promise<AgentMemoryEntry[]> {
    // Try to serve from cache if possible
    if (this.cacheEnabled && limit <= this.memoryCache.length) {
      return this.memoryCache.slice(0, limit);
    }
    
    // Otherwise fetch from database
    return this.dbClient.find({}, {
      sort: { timestamp: -1 },
      limit
    });
  }

  /**
   * Get memories for a specific strategy
   * @param strategyId Strategy identifier
   * @param limit Maximum number of entries to return
   * @returns Array of memory entries for the strategy
   */
  async getMemoriesByStrategy(strategyId: string, limit: number = 50): Promise<AgentMemoryEntry[]> {
    return this.dbClient.find(
      { strategyId },
      { sort: { timestamp: -1 }, limit }
    );
  }

  /**
   * Get memories for a specific asset
   * @param asset Asset symbol
   * @param limit Maximum number of entries to return
   * @returns Array of memory entries for the asset
   */
  async getMemoriesByAsset(asset: string, limit: number = 50): Promise<AgentMemoryEntry[]> {
    return this.dbClient.find(
      { asset },
      { sort: { timestamp: -1 }, limit }
    );
  }

  /**
   * Calculate regret statistics for a strategy
   * @param strategyId Strategy identifier
   * @returns Statistics about the strategy's regret scores
   */
  async calculateStrategyRegret(strategyId: string): Promise<{
    averageRegret: number;
    totalRegret: number;
    count: number;
    regretTrend: 'increasing' | 'decreasing' | 'stable';
  }> {
    const memories = await this.getMemoriesByStrategy(strategyId, 100);
    
    if (memories.length === 0) {
      return {
        averageRegret: 0,
        totalRegret: 0,
        count: 0,
        regretTrend: 'stable'
      };
    }
    
    // Calculate stats
    const regretValues = memories
      .filter(m => m.regret !== undefined)
      .map(m => m.regret as number);
    
    if (regretValues.length === 0) {
      return {
        averageRegret: 0,
        totalRegret: 0,
        count: 0,
        regretTrend: 'stable'
      };
    }
    
    const totalRegret = regretValues.reduce((sum, val) => sum + val, 0);
    const averageRegret = totalRegret / regretValues.length;
    
    // Calculate trend (using simple first half vs second half comparison)
    let regretTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    
    if (regretValues.length >= 6) {
      const midpoint = Math.floor(regretValues.length / 2);
      
      const firstHalfRegret = regretValues
        .slice(midpoint)
        .reduce((sum, val) => sum + val, 0) / midpoint;
      
      const secondHalfRegret = regretValues
        .slice(0, midpoint)
        .reduce((sum, val) => sum + val, 0) / midpoint;
      
      const regretDiff = secondHalfRegret - firstHalfRegret;
      
      if (regretDiff > 0.1) {
        regretTrend = 'increasing';
      } else if (regretDiff < -0.1) {
        regretTrend = 'decreasing';
      }
    }
    
    return {
      averageRegret,
      totalRegret,
      count: regretValues.length,
      regretTrend
    };
  }

  /**
   * Find similar situations from past memories
   * @param state Feature vector representing the current state
   * @param topK Number of similar situations to return
   * @returns Array of similar memory entries
   */
  async findSimilarSituations(state: number[], topK: number = 5): Promise<{
    memory: AgentMemoryEntry;
    similarity: number;
  }[]> {
    // Get memories that have state vectors
    const memories = await this.dbClient.find(
      { stateVector: { $exists: true } },
      { limit: 100 }
    );
    
    if (memories.length === 0 || !state.length) {
      return [];
    }
    
    // Calculate cosine similarity with each memory
    const results = memories
      .filter(memory => memory.stateVector && memory.stateVector.length === state.length)
      .map(memory => {
        const similarity = this.cosineSimilarity(state, memory.stateVector as number[]);
        return { memory, similarity };
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
    
    return results;
  }

  /**
   * Get the count of memory entries for a strategy
   * @param strategyId Optional strategy ID to filter by
   * @returns Count of memory entries
   */
  async getMemoryCount(strategyId?: string): Promise<number> {
    if (strategyId) {
      return this.dbClient.count({ strategyId });
    }
    return this.dbClient.count({});
  }

  /**
   * Analyze outcomes for a strategy over time
   * @param strategyId Strategy identifier
   * @returns Analytics about the strategy's outcomes
   */
  async analyzeStrategyOutcomes(strategyId: string): Promise<{
    positiveOutcomes: number;
    negativeOutcomes: number;
    neutralOutcomes: number;
    averageOutcome: number;
    totalMemories: number;
    timeSpan: { start: number, end: number };
  }> {
    const memories = await this.getMemoriesByStrategy(strategyId, 1000);
    
    if (!memories.length) {
      return {
        positiveOutcomes: 0,
        negativeOutcomes: 0,
        neutralOutcomes: 0,
        averageOutcome: 0,
        totalMemories: 0,
        timeSpan: { start: 0, end: 0 }
      };
    }
    
    // Count outcomes
    let positiveOutcomes = 0;
    let negativeOutcomes = 0;
    let neutralOutcomes = 0;
    let totalOutcome = 0;
    let outcomeCount = 0;
    
    // Track timestamps for time span
    let minTimestamp = Number.MAX_SAFE_INTEGER;
    let maxTimestamp = 0;
    
    for (const memory of memories) {
      // Update time span
      if (memory.timestamp) {
        minTimestamp = Math.min(minTimestamp, memory.timestamp);
        maxTimestamp = Math.max(maxTimestamp, memory.timestamp);
      }
      
      // Skip if no outcome
      if (memory.outcome === undefined) continue;
      
      outcomeCount++;
      totalOutcome += memory.outcome;
      
      if (memory.outcome > 0) {
        positiveOutcomes++;
      } else if (memory.outcome < 0) {
        negativeOutcomes++;
      } else {
        neutralOutcomes++;
      }
    }
    
    return {
      positiveOutcomes,
      negativeOutcomes,
      neutralOutcomes,
      averageOutcome: outcomeCount ? totalOutcome / outcomeCount : 0,
      totalMemories: memories.length,
      timeSpan: {
        start: minTimestamp !== Number.MAX_SAFE_INTEGER ? minTimestamp : 0,
        end: maxTimestamp
      }
    };
  }

  /**
   * Clear the memory cache
   */
  clearCache(): void {
    this.memoryCache = [];
  }

  /**
   * Calculate cosine similarity between two vectors
   * @private
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
} 