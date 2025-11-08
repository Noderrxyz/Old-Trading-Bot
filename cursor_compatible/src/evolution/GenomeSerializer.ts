import { StrategyGenome } from './StrategyGenome';
import { logger } from '../utils/logger';

/**
 * Serialization format version
 */
export const GENOME_SERIALIZATION_VERSION = '1.0';

/**
 * Serialized genome structure
 */
export interface SerializedGenome {
  /**
   * Serialization format version
   */
  version: string;
  
  /**
   * Strategy type
   */
  strategyType: string;
  
  /**
   * Symbol
   */
  symbol: string;
  
  /**
   * Genome parameters
   */
  parameters: Record<string, any>;
  
  /**
   * Performance metrics
   */
  metrics: Record<string, number>;
  
  /**
   * Lineage information
   */
  lineage?: {
    parentIds: string[];
    generation: number;
    mutationCount: number;
    birthTime: number;
  };
  
  /**
   * Timestamp of serialization
   */
  timestamp: number;
  
  /**
   * Source node ID
   */
  sourceNodeId?: string;
  
  /**
   * Hash of genome content for verification
   */
  contentHash?: string;
}

/**
 * GenomeSerializer
 * 
 * Handles serialization and deserialization of strategy genomes
 * for efficient transmission across the network.
 */
export class GenomeSerializer {
  private static instance: GenomeSerializer | null = null;
  
  /**
   * Private constructor
   */
  private constructor() {
    logger.info('GenomeSerializer initialized');
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(): GenomeSerializer {
    if (!GenomeSerializer.instance) {
      GenomeSerializer.instance = new GenomeSerializer();
    }
    return GenomeSerializer.instance;
  }
  
  /**
   * Serialize a genome to a transferable format
   */
  public serialize(genome: StrategyGenome, sourceNodeId?: string): SerializedGenome {
    try {
      const serialized: SerializedGenome = {
        version: GENOME_SERIALIZATION_VERSION,
        strategyType: genome.strategyType,
        symbol: genome.symbol,
        parameters: genome.parameters,
        metrics: genome.metrics,
        timestamp: Date.now(),
        sourceNodeId
      };
      
      // Add lineage information if available
      const lineage = genome.lineage;
      if (lineage) {
        serialized.lineage = {
          parentIds: lineage.parentIds || [],
          generation: lineage.generation || 0,
          mutationCount: lineage.mutationCount || 0,
          birthTime: lineage.birthTime || Date.now()
        };
      }
      
      // Generate content hash for verification
      serialized.contentHash = this.generateContentHash(serialized);
      
      return serialized;
    } catch (error) {
      logger.error('Error serializing genome:', error);
      throw new Error('Failed to serialize genome: ' + (error instanceof Error ? error.message : String(error)));
    }
  }
  
  /**
   * Deserialize from transferable format to a genome
   */
  public deserialize(serialized: SerializedGenome): StrategyGenome {
    try {
      // Verify content hash if available
      if (serialized.contentHash) {
        const calculatedHash = this.generateContentHash({
          ...serialized,
          contentHash: undefined // Remove hash for calculation
        });
        
        if (calculatedHash !== serialized.contentHash) {
          throw new Error('Genome content hash verification failed');
        }
      }
      
      // Create genome from serialized data
      const genome = new StrategyGenome(
        serialized.strategyType,
        serialized.symbol,
        serialized.parameters,
        serialized.metrics
      );
      
      // Set lineage if available
      if (serialized.lineage) {
        genome.lineage = {
          parentIds: serialized.lineage.parentIds,
          generation: serialized.lineage.generation,
          mutationCount: serialized.lineage.mutationCount,
          birthTime: serialized.lineage.birthTime
        };
      }
      
      return genome;
    } catch (error) {
      logger.error('Error deserializing genome:', error);
      throw new Error('Failed to deserialize genome: ' + (error instanceof Error ? error.message : String(error)));
    }
  }
  
  /**
   * Generate content hash for verification
   */
  private generateContentHash(data: any): string {
    // In a production implementation, this would use a proper hashing algorithm
    // For this implementation, we'll use a simple JSON stringify + base64 encode
    const jsonString = JSON.stringify({
      strategyType: data.strategyType,
      symbol: data.symbol,
      parameters: data.parameters,
      metrics: data.metrics,
      lineage: data.lineage,
      timestamp: data.timestamp
    });
    
    // Convert to Base64 for simplicity
    // In a real implementation, use a crypto library for proper hashing
    return Buffer.from(jsonString).toString('base64');
  }
  
  /**
   * Calculate difference between two genomes
   * Returns only the changed parameters and metrics
   */
  public calculateDiff(baseGenome: StrategyGenome, newGenome: StrategyGenome): {
    parameterDiffs: Record<string, any>;
    metricDiffs: Record<string, number>;
    hasChanges: boolean;
  } {
    const baseParams = baseGenome.parameters;
    const newParams = newGenome.parameters;
    const baseMetrics = baseGenome.metrics;
    const newMetrics = newGenome.metrics;
    
    const parameterDiffs: Record<string, any> = {};
    const metricDiffs: Record<string, number> = {};
    
    // Find parameter differences
    for (const key in newParams) {
      if (JSON.stringify(baseParams[key]) !== JSON.stringify(newParams[key])) {
        parameterDiffs[key] = newParams[key];
      }
    }
    
    // Find metric differences
    for (const key in newMetrics) {
      if (baseMetrics[key] !== newMetrics[key]) {
        metricDiffs[key] = newMetrics[key];
      }
    }
    
    return {
      parameterDiffs,
      metricDiffs,
      hasChanges: Object.keys(parameterDiffs).length > 0 || Object.keys(metricDiffs).length > 0
    };
  }
  
  /**
   * Apply a diff to a genome
   */
  public applyDiff(baseGenome: StrategyGenome, diff: {
    parameterDiffs: Record<string, any>;
    metricDiffs: Record<string, number>;
  }): StrategyGenome {
    // Create a copy of the base genome
    const newGenome = new StrategyGenome(
      baseGenome.strategyType,
      baseGenome.symbol,
      { ...baseGenome.parameters },
      { ...baseGenome.metrics }
    );
    
    // Set lineage
    const lineage = baseGenome.lineage;
    if (lineage) {
      newGenome.lineage = { ...lineage };
    }
    
    // Apply parameter diffs
    for (const key in diff.parameterDiffs) {
      newGenome.parameters[key] = diff.parameterDiffs[key];
    }
    
    // Apply metric diffs
    for (const key in diff.metricDiffs) {
      newGenome.metrics[key] = diff.metricDiffs[key];
    }
    
    return newGenome;
  }
} 