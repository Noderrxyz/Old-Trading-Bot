import { logger } from '../utils/logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { AdaptiveStrategy } from '../strategy/AdaptiveStrategy';
import { AlphaMemory } from '../memory/AlphaMemory';
import { DistributedAlphaMemory } from './DistributedAlphaMemory';
import { RegimeClassifier } from '../regime/RegimeClassifier';
import { StrategyMutationEngine } from '../evolution/StrategyMutationEngine';
import { StrategyGenome } from '../evolution/StrategyGenome';
import { v4 as uuidv4 } from 'uuid';

/**
 * Possible states of a swarm agent
 */
export enum AgentState {
  CREATED = 'created',
  STARTING = 'starting',
  RUNNING = 'running',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  FAILED = 'failed',
  SYNCING = 'syncing',
}

/**
 * Configuration for a swarm agent
 */
export interface AgentConfig {
  /**
   * Symbol the agent will trade
   */
  symbol: string;
  
  /**
   * Name of the agent
   */
  name: string;
  
  /**
   * Whether this agent can undergo mutation
   */
  allowMutation: boolean;
  
  /**
   * Whether this agent can synchronize with other agents
   */
  allowSynchronization: boolean;
  
  /**
   * Optional strategy parameters to initialize with
   */
  strategyParams?: Record<string, any>;
  
  /**
   * Optional genome to initialize from
   */
  initialGenome?: StrategyGenome;
  
  /**
   * Performance metric weights for scoring
   */
  metricWeights?: Record<string, number>;
  
  /**
   * Whether to use distributed memory
   */
  useDistributedMemory?: boolean;
}

/**
 * Agent metrics for monitoring
 */
export interface AgentMetrics {
  executionCount: number;
  signalCount: number;
  lastSignalTime: number;
  lastExecutionTime: number;
  averageExecutionTimeMs: number;
  uptime: number;
  startTime: number;
  memoryRetrievalCount: number;
  mutationCount: number;
  currentScore: number;
  lastRegime: string;
  genomeVersion: number;
  lastSyncTime: number;
  errorCount: number;
}

/**
 * Agent execution result
 */
export interface AgentExecutionResult {
  success: boolean;
  signal?: any;
  error?: Error;
  metrics: Partial<AgentMetrics>;
  executionTimeMs: number;
}

/**
 * Complete agent configuration with internal parameters
 */
interface CompleteAgentConfig extends AgentConfig {
  agentId: string;
  nodeId: string;
  region: string;
}

/**
 * SwarmAgent
 * 
 * Represents an individual agent running a strategy within the swarm.
 * Each agent operates independently but coordinates through shared memory
 * and evolutionary mechanisms.
 */
export class SwarmAgent {
  private agentId: string;
  private nodeId: string;
  private region: string;
  private config: AgentConfig;
  private strategy: AdaptiveStrategy | null = null;
  private state: AgentState = AgentState.CREATED;
  private telemetryBus: TelemetryBus;
  private distributedMemory: DistributedAlphaMemory;
  private localMemory: AlphaMemory;
  private regimeClassifier: RegimeClassifier;
  private mutationEngine: StrategyMutationEngine | null = null;
  private metrics: AgentMetrics;
  private startTime: number = 0;
  private genome: StrategyGenome | null = null;
  private lastExecutionResult: AgentExecutionResult | null = null;
  private useDistributedMemory: boolean;
  private executionHistory: Array<{ timestamp: number, executionTimeMs: number }> = [];
  
  /**
   * Constructor
   */
  constructor(config: CompleteAgentConfig) {
    this.agentId = config.agentId;
    this.nodeId = config.nodeId;
    this.region = config.region;
    this.config = { ...config };
    this.useDistributedMemory = config.useDistributedMemory ?? true;
    
    // Initialize services
    this.telemetryBus = TelemetryBus.getInstance();
    this.regimeClassifier = RegimeClassifier.getInstance();
    
    // Use either distributed or local memory based on config
    if (this.useDistributedMemory) {
      this.distributedMemory = DistributedAlphaMemory.getInstance();
      this.localMemory = this.distributedMemory.getLocalInstance();
    } else {
      this.localMemory = AlphaMemory.getInstance();
      this.distributedMemory = DistributedAlphaMemory.getInstance();
    }
    
    // Initialize metrics
    this.metrics = {
      executionCount: 0,
      signalCount: 0,
      lastSignalTime: 0,
      lastExecutionTime: 0,
      averageExecutionTimeMs: 0,
      uptime: 0,
      startTime: 0,
      memoryRetrievalCount: 0,
      mutationCount: 0,
      currentScore: 0,
      lastRegime: '',
      genomeVersion: 0,
      lastSyncTime: 0,
      errorCount: 0
    };
    
    logger.info(`SwarmAgent created: ${this.agentId} for symbol ${this.config.symbol}`);
  }
  
  /**
   * Start the agent
   */
  public async start(): Promise<void> {
    if (this.state !== AgentState.CREATED && this.state !== AgentState.STOPPED) {
      throw new Error(`Cannot start agent in state: ${this.state}`);
    }
    
    this.state = AgentState.STARTING;
    this.startTime = Date.now();
    this.metrics.startTime = this.startTime;
    
    try {
      // Initialize strategy
      await this.initializeStrategy();
      
      // Initialize mutation engine if allowed
      if (this.config.allowMutation) {
        this.mutationEngine = StrategyMutationEngine.getInstance();
      }
      
      // Mark as running
      this.state = AgentState.RUNNING;
      
      // Emit telemetry
      this.telemetryBus.emit('agent_started', {
        timestamp: Date.now(),
        nodeId: this.nodeId,
        agentId: this.agentId,
        symbol: this.config.symbol,
        region: this.region
      });
      
      logger.info(`Agent ${this.agentId} started for symbol ${this.config.symbol}`);
    } catch (error) {
      this.state = AgentState.FAILED;
      this.metrics.errorCount++;
      
      // Emit telemetry
      this.telemetryBus.emit('agent_start_failed', {
        timestamp: Date.now(),
        nodeId: this.nodeId,
        agentId: this.agentId,
        symbol: this.config.symbol,
        error: error instanceof Error ? error.message : String(error)
      });
      
      logger.error(`Failed to start agent ${this.agentId}:`, error);
      throw error;
    }
  }
  
  /**
   * Stop the agent
   */
  public async stop(): Promise<void> {
    if (this.state === AgentState.STOPPED) {
      return;
    }
    
    this.state = AgentState.STOPPING;
    
    try {
      // Clean up strategy
      if (this.strategy) {
        await this.strategy.cleanup();
        this.strategy = null;
      }
      
      // Persist genomic information if available
      if (this.genome && this.config.allowMutation) {
        await this.persistGenome();
      }
      
      // Update metrics
      this.metrics.uptime = Date.now() - this.startTime;
      
      // Mark as stopped
      this.state = AgentState.STOPPED;
      
      // Emit telemetry
      this.telemetryBus.emit('agent_stopped', {
        timestamp: Date.now(),
        nodeId: this.nodeId,
        agentId: this.agentId,
        symbol: this.config.symbol,
        uptime: this.metrics.uptime
      });
      
      logger.info(`Agent ${this.agentId} stopped after ${this.metrics.uptime}ms uptime`);
    } catch (error) {
      this.state = AgentState.FAILED;
      this.metrics.errorCount++;
      
      // Emit telemetry
      this.telemetryBus.emit('agent_stop_failed', {
        timestamp: Date.now(),
        nodeId: this.nodeId,
        agentId: this.agentId,
        symbol: this.config.symbol,
        error: error instanceof Error ? error.message : String(error)
      });
      
      logger.error(`Failed to stop agent ${this.agentId}:`, error);
      throw error;
    }
  }
  
  /**
   * Restart the agent
   */
  public async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }
  
  /**
   * Execute a single cycle
   */
  public async executeCycle(): Promise<AgentExecutionResult> {
    if (this.state !== AgentState.RUNNING) {
      throw new Error(`Cannot execute agent in state: ${this.state}`);
    }
    
    const startTime = Date.now();
    const result: AgentExecutionResult = {
      success: false,
      metrics: {},
      executionTimeMs: 0
    };
    
    try {
      // Check current regime
      const currentRegime = await this.regimeClassifier.getCurrentRegime();
      const regimeChanged = currentRegime?.type !== this.metrics.lastRegime;
      
      if (regimeChanged && currentRegime) {
        this.metrics.lastRegime = currentRegime.type;
        await this.handleRegimeChange(currentRegime);
      }
      
      // Execute strategy
      if (this.strategy) {
        const signal = await this.strategy.executeSignalGeneration();
        
        // Update metrics
        this.metrics.executionCount++;
        this.metrics.lastExecutionTime = Date.now();
        
        if (signal) {
          this.metrics.signalCount++;
          this.metrics.lastSignalTime = Date.now();
          result.signal = signal;
        }
        
        // Track execution time
        const executionTime = Date.now() - startTime;
        this.trackExecutionTime(executionTime);
        
        result.success = true;
      } else {
        throw new Error('Strategy not initialized');
      }
    } catch (error) {
      result.error = error instanceof Error ? error : new Error(String(error));
      this.metrics.errorCount++;
      
      // Emit telemetry
      this.telemetryBus.emit('agent_execution_error', {
        timestamp: Date.now(),
        nodeId: this.nodeId,
        agentId: this.agentId,
        symbol: this.config.symbol,
        error: result.error.message
      });
      
      logger.error(`Agent ${this.agentId} execution error:`, error);
    }
    
    // Update result metrics
    result.metrics = { ...this.metrics };
    result.executionTimeMs = Date.now() - startTime;
    
    // Store last result
    this.lastExecutionResult = result;
    
    // Update agent metrics
    this.metrics.uptime = Date.now() - this.startTime;
    
    return result;
  }
  
  /**
   * Handle regime change
   */
  private async handleRegimeChange(regime: any): Promise<void> {
    logger.info(`Agent ${this.agentId} detected regime change to ${regime.type}`);
    
    // Emit telemetry
    this.telemetryBus.emit('agent_regime_change', {
      timestamp: Date.now(),
      nodeId: this.nodeId,
      agentId: this.agentId,
      symbol: this.config.symbol,
      regimeType: regime.type,
      regimeConfidence: regime.confidence
    });
    
    if (this.strategy) {
      // Notify strategy of regime change
      await this.strategy.onRegimeChange(regime);
      
      // Retrieve optimal parameters for this regime if available
      if (this.useDistributedMemory) {
        await this.refreshMemoryForRegime(regime.type);
      }
    }
  }
  
  /**
   * Initialize the strategy
   */
  private async initializeStrategy(): Promise<void> {
    // Create AdaptiveStrategy instance
    this.strategy = new AdaptiveStrategy({
      symbol: this.config.symbol,
      name: this.config.name,
      ...this.config.strategyParams
    });
    
    // Initialize from genome if available
    if (this.config.initialGenome) {
      this.genome = this.config.initialGenome;
      await this.applyGenomeToStrategy();
    } else {
      // Try to retrieve a genome from memory
      await this.retrieveGenomeFromMemory();
    }
    
    // Initialize the strategy
    await this.strategy.initialize();
    
    // Get current regime and notify the strategy
    const currentRegime = await this.regimeClassifier.getCurrentRegime();
    if (currentRegime) {
      this.metrics.lastRegime = currentRegime.type;
      await this.strategy.onRegimeChange(currentRegime);
    }
  }
  
  /**
   * Retrieve genome from memory
   */
  private async retrieveGenomeFromMemory(): Promise<boolean> {
    try {
      // Query memory for best performing strategy for this symbol
      const memorySource = this.useDistributedMemory ? this.distributedMemory : this.localMemory;
      
      const topStrategies = await memorySource.queryTopPerformingStrategies({
        symbol: this.config.symbol,
        limit: 1,
        minPerformanceScore: 0
      });
      
      if (topStrategies.length > 0) {
        const topStrategy = topStrategies[0];
        
        // Create genome from memory record
        this.genome = new StrategyGenome({
          strategyType: topStrategy.strategyType,
          symbol: this.config.symbol,
          parameters: topStrategy.parameters,
          metrics: topStrategy.metrics
        });
        
        // Apply genome to strategy
        await this.applyGenomeToStrategy();
        
        this.metrics.memoryRetrievalCount++;
        
        logger.info(`Agent ${this.agentId} retrieved genome from memory`);
        return true;
      }
    } catch (error) {
      logger.warn(`Failed to retrieve genome from memory:`, error);
    }
    
    return false;
  }
  
  /**
   * Refresh memory based on current regime
   */
  public async refreshMemoryForRegime(regimeType: string): Promise<boolean> {
    if (!this.strategy) return false;
    
    try {
      // Query memory for best performing strategy for this symbol and regime
      const memorySource = this.useDistributedMemory ? this.distributedMemory : this.localMemory;
      
      const topStrategies = await memorySource.queryTopPerformingStrategies({
        symbol: this.config.symbol,
        regimeType,
        limit: 1,
        minPerformanceScore: 0
      });
      
      if (topStrategies.length > 0) {
        const topStrategy = topStrategies[0];
        
        // Update strategy parameters
        await this.strategy.updateParameters(topStrategy.parameters);
        
        // Create or update genome
        if (!this.genome) {
          this.genome = new StrategyGenome({
            strategyType: topStrategy.strategyType,
            symbol: this.config.symbol,
            parameters: topStrategy.parameters,
            metrics: topStrategy.metrics
          });
        } else {
          this.genome.updateParameters(topStrategy.parameters);
          this.genome.updateMetrics(topStrategy.metrics);
        }
        
        this.metrics.memoryRetrievalCount++;
        this.metrics.genomeVersion++;
        
        // Emit telemetry
        this.telemetryBus.emit('agent_parameters_updated', {
          timestamp: Date.now(),
          nodeId: this.nodeId,
          agentId: this.agentId,
          symbol: this.config.symbol,
          regimeType,
          source: 'memory'
        });
        
        logger.info(`Agent ${this.agentId} updated parameters for regime ${regimeType}`);
        return true;
      }
    } catch (error) {
      logger.warn(`Failed to refresh memory for regime ${regimeType}:`, error);
    }
    
    return false;
  }
  
  /**
   * Apply genome to strategy
   */
  private async applyGenomeToStrategy(): Promise<boolean> {
    if (!this.strategy || !this.genome) return false;
    
    try {
      // Apply parameters from genome
      await this.strategy.updateParameters(this.genome.getParameters());
      
      // Emit telemetry
      this.telemetryBus.emit('agent_genome_applied', {
        timestamp: Date.now(),
        nodeId: this.nodeId,
        agentId: this.agentId,
        symbol: this.config.symbol,
        genomeVersion: this.metrics.genomeVersion
      });
      
      logger.info(`Agent ${this.agentId} applied genome v${this.metrics.genomeVersion}`);
      return true;
    } catch (error) {
      logger.error(`Failed to apply genome to strategy:`, error);
      return false;
    }
  }
  
  /**
   * Persist genome to memory
   */
  private async persistGenome(): Promise<boolean> {
    if (!this.genome || !this.strategy) return false;
    
    try {
      // Get latest metrics from strategy
      const metrics = await this.strategy.getPerformanceMetrics();
      
      // Update genome metrics
      this.genome.updateMetrics(metrics);
      
      // Persist to memory
      const memorySource = this.useDistributedMemory ? this.distributedMemory : this.localMemory;
      
      await memorySource.recordStrategyPerformance({
        strategyId: this.agentId,
        strategyType: this.genome.getStrategyType(),
        symbol: this.config.symbol,
        parameters: this.genome.getParameters(),
        metrics: this.genome.getMetrics(),
        regimeType: this.metrics.lastRegime,
        timestamp: Date.now(),
        nodeId: this.nodeId,
        region: this.region
      });
      
      // Emit telemetry
      this.telemetryBus.emit('agent_genome_persisted', {
        timestamp: Date.now(),
        nodeId: this.nodeId,
        agentId: this.agentId,
        symbol: this.config.symbol,
        performanceScore: metrics.overallScore || 0
      });
      
      logger.info(`Agent ${this.agentId} persisted genome with score ${metrics.overallScore || 0}`);
      return true;
    } catch (error) {
      logger.error(`Failed to persist genome:`, error);
      return false;
    }
  }
  
  /**
   * Update genome from external source
   */
  public async updateGenome(genomeData: any): Promise<boolean> {
    if (!this.strategy || !this.config.allowSynchronization) return false;
    
    try {
      this.state = AgentState.SYNCING;
      
      // Create new genome from data
      const newGenome = new StrategyGenome({
        strategyType: genomeData.strategyType || this.genome?.getStrategyType() || 'adaptive',
        symbol: this.config.symbol,
        parameters: genomeData.parameters || {},
        metrics: genomeData.metrics || {}
      });
      
      // Store genome
      this.genome = newGenome;
      this.metrics.genomeVersion++;
      this.metrics.lastSyncTime = Date.now();
      
      // Apply to strategy
      await this.applyGenomeToStrategy();
      
      this.state = AgentState.RUNNING;
      
      // Emit telemetry
      this.telemetryBus.emit('agent_genome_updated', {
        timestamp: Date.now(),
        nodeId: this.nodeId,
        agentId: this.agentId,
        symbol: this.config.symbol,
        genomeVersion: this.metrics.genomeVersion,
        source: 'external'
      });
      
      logger.info(`Agent ${this.agentId} updated genome from external source`);
      return true;
    } catch (error) {
      this.state = AgentState.FAILED;
      this.metrics.errorCount++;
      
      // Emit telemetry
      this.telemetryBus.emit('agent_genome_update_failed', {
        timestamp: Date.now(),
        nodeId: this.nodeId,
        agentId: this.agentId,
        symbol: this.config.symbol,
        error: error instanceof Error ? error.message : String(error)
      });
      
      logger.error(`Failed to update genome:`, error);
      return false;
    }
  }
  
  /**
   * Update agent configuration
   */
  public updateConfig(config: Partial<AgentConfig>): void {
    // Update config
    this.config = { ...this.config, ...config };
    
    // Update strategy if already running
    if (this.strategy && this.state === AgentState.RUNNING) {
      if (config.strategyParams) {
        this.strategy.updateParameters(config.strategyParams)
          .catch(error => {
            logger.error(`Failed to update strategy parameters:`, error);
          });
      }
    }
    
    // Emit telemetry
    this.telemetryBus.emit('agent_config_updated', {
      timestamp: Date.now(),
      nodeId: this.nodeId,
      agentId: this.agentId,
      symbol: this.config.symbol
    });
  }
  
  /**
   * Track execution time for statistics
   */
  private trackExecutionTime(executionTimeMs: number): void {
    // Keep last 100 execution times
    this.executionHistory.push({ timestamp: Date.now(), executionTimeMs });
    if (this.executionHistory.length > 100) {
      this.executionHistory.shift();
    }
    
    // Calculate average
    const sum = this.executionHistory.reduce((acc, item) => acc + item.executionTimeMs, 0);
    this.metrics.averageExecutionTimeMs = sum / this.executionHistory.length;
  }
  
  /**
   * Refresh memory
   */
  public async refreshMemory(): Promise<boolean> {
    const currentRegime = this.metrics.lastRegime;
    if (!currentRegime) return false;
    
    return this.refreshMemoryForRegime(currentRegime);
  }
  
  /**
   * Get agent ID
   */
  public getAgentId(): string {
    return this.agentId;
  }
  
  /**
   * Get symbol
   */
  public getSymbol(): string {
    return this.config.symbol;
  }
  
  /**
   * Get state
   */
  public getState(): AgentState {
    return this.state;
  }
  
  /**
   * Set state
   */
  public setState(state: AgentState): void {
    this.state = state;
  }
  
  /**
   * Get metrics
   */
  public getMetrics(): AgentMetrics {
    // Update uptime
    this.metrics.uptime = Date.now() - this.startTime;
    return { ...this.metrics };
  }
  
  /**
   * Get uptime
   */
  public getUptime(): number {
    return Date.now() - this.startTime;
  }
  
  /**
   * Get last execution result
   */
  public getLastExecutionResult(): AgentExecutionResult | null {
    return this.lastExecutionResult;
  }
  
  /**
   * Get genome
   */
  public getGenome(): StrategyGenome | null {
    return this.genome;
  }
  
  /**
   * Get configuration
   */
  public getConfig(): AgentConfig {
    return { ...this.config };
  }
} 