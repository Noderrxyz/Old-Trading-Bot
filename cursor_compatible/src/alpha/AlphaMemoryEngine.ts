import { createLogger } from '../common/logger.js';
import { promises as fs } from 'fs';
import path from 'path';
import {
  RegimeStrategyMap,
  RegimeStrategyPerformance,
  AlphaMemoryConfig,
  DEFAULT_ALPHA_MEMORY_CONFIG
} from './types/alpha_memory.types.js';

/**
 * Engine for tracking and optimizing strategy performance across market regimes
 */
export class AlphaMemoryEngine {
  private readonly logger = createLogger('AlphaMemoryEngine');
  
  // Memory storage
  private memory: RegimeStrategyMap = {};
  
  // Save timer
  private saveTimer?: NodeJS.Timeout;
  
  // Visualization timer
  private visualizationTimer?: NodeJS.Timeout;
  
  constructor(
    private readonly config: AlphaMemoryConfig = DEFAULT_ALPHA_MEMORY_CONFIG,
    private readonly memoryPath: string = path.join(process.cwd(), 'data', 'alpha_memory.json')
  ) {
    if (!config.enabled) {
      this.logger.warn('Alpha memory tracking is disabled');
    } else {
      this.initialize();
    }
  }
  
  /**
   * Initialize the engine
   */
  private async initialize(): Promise<void> {
    try {
      // Load existing memory
      await this.loadMemory();
      
      // Start periodic save
      this.startSaveTimer();
      
      // Start visualization if enabled
      if (this.config.visualization.enabled) {
        this.startVisualizationTimer();
      }
      
      this.logger.info('Alpha memory engine initialized');
    } catch (error) {
      this.logger.error(`Error initializing alpha memory engine: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Update memory with new trade result
   * @param regime Market regime
   * @param strategy Strategy name
   * @param tradeResult Trade PnL
   */
  public updateMemory(regime: string, strategy: string, tradeResult: number): void {
    if (!this.config.enabled) return;
    
    try {
      // Initialize regime if not exists
      if (!this.memory[regime]) {
        this.memory[regime] = {};
      }
      
      // Initialize strategy if not exists
      if (!this.memory[regime][strategy]) {
        this.memory[regime][strategy] = {
          count: 0,
          avgPnl: 0,
          lastUpdate: Date.now(),
          weightedScore: 0
        };
      }
      
      const performance = this.memory[regime][strategy];
      
      // Update performance metrics
      const newCount = performance.count + 1;
      const newAvgPnl = (performance.avgPnl * performance.count + tradeResult) / newCount;
      
      // Apply time decay to weighted score
      const daysSinceLastUpdate = (Date.now() - performance.lastUpdate) / (1000 * 60 * 60 * 24);
      const decayFactor = Math.pow(1 - this.config.decayRate, daysSinceLastUpdate);
      const newWeightedScore = (performance.weightedScore * decayFactor + tradeResult) / (decayFactor + 1);
      
      // Update memory
      this.memory[regime][strategy] = {
        count: newCount,
        avgPnl: newAvgPnl,
        lastUpdate: Date.now(),
        weightedScore: newWeightedScore
      };
      
      this.logger.debug(
        `Updated memory for ${regime}/${strategy}: ` +
        `count=${newCount}, avgPnl=${newAvgPnl.toFixed(4)}, ` +
        `weightedScore=${newWeightedScore.toFixed(4)}`
      );
    } catch (error) {
      this.logger.error(`Error updating memory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get best strategy for a regime
   * @param regime Market regime
   * @returns Best strategy name or undefined if insufficient data
   */
  public getBestStrategy(regime: string): string | undefined {
    if (!this.config.enabled || !this.memory[regime]) {
      return undefined;
    }
    
    try {
      // Filter strategies with sufficient trades
      const validStrategies = Object.entries(this.memory[regime])
        .filter(([_, perf]) => perf.count >= this.config.minTradesForDecision);
      
      if (validStrategies.length === 0) {
        return undefined;
      }
      
      // Find strategy with highest weighted score
      const [bestStrategy] = validStrategies.reduce((best, current) => {
        return current[1].weightedScore > best[1].weightedScore ? current : best;
      });
      
      return bestStrategy;
    } catch (error) {
      this.logger.error(`Error getting best strategy: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }
  
  /**
   * Save memory to file
   */
  public async saveMemory(): Promise<void> {
    if (!this.config.enabled) return;
    
    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(this.memoryPath), { recursive: true });
      
      // Write memory to file
      await fs.writeFile(
        this.memoryPath,
        JSON.stringify(this.memory, null, 2),
        'utf8'
      );
      
      this.logger.info('Alpha memory saved to file');
    } catch (error) {
      this.logger.error(`Error saving memory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Load memory from file
   */
  public async loadMemory(): Promise<void> {
    if (!this.config.enabled) return;
    
    try {
      // Check if file exists
      try {
        await fs.access(this.memoryPath);
      } catch {
        this.logger.info('No existing memory file found');
        return;
      }
      
      // Read and parse memory file
      const data = await fs.readFile(this.memoryPath, 'utf8');
      this.memory = JSON.parse(data);
      
      this.logger.info('Alpha memory loaded from file');
    } catch (error) {
      this.logger.error(`Error loading memory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Start periodic save timer
   */
  private startSaveTimer(): void {
    if (!this.config.enabled) return;
    
    // Clear any existing timer
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
    }
    
    // Start new save interval
    this.saveTimer = setInterval(() => {
      this.saveMemory().catch(error => {
        this.logger.error(`Error in save timer: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, this.config.saveIntervalSec * 1000);
  }
  
  /**
   * Start visualization timer
   */
  private startVisualizationTimer(): void {
    if (!this.config.enabled || !this.config.visualization.enabled) return;
    
    // Clear any existing timer
    if (this.visualizationTimer) {
      clearInterval(this.visualizationTimer);
    }
    
    // Start new visualization interval
    this.visualizationTimer = setInterval(() => {
      this.visualizeMemory().catch(error => {
        this.logger.error(`Error in visualization timer: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, this.config.visualization.updateIntervalSec * 1000);
  }
  
  /**
   * Generate memory visualization
   */
  private async visualizeMemory(): Promise<void> {
    if (!this.config.enabled || !this.config.visualization.enabled) return;
    
    try {
      // TODO: Implement visualization using a charting library
      // This could generate:
      // 1. Bar chart of best strategies per regime
      // 2. Line chart of strategy performance trends
      // 3. Heatmap of regime-strategy performance
      
      this.logger.info('Memory visualization updated');
    } catch (error) {
      this.logger.error(`Error visualizing memory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get current memory state
   * @returns Current memory map
   */
  public getMemory(): RegimeStrategyMap {
    return { ...this.memory };
  }
  
  /**
   * Clean up resources
   */
  public async destroy(): Promise<void> {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
    }
    if (this.visualizationTimer) {
      clearInterval(this.visualizationTimer);
    }
    await this.saveMemory();
  }
} 