import { logger } from '../utils/logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { SwarmCoordinator } from './SwarmCoordinator';
import { RegimeClassifier } from '../regime/RegimeClassifier';
import { RegimeCapitalAllocator } from '../capital/RegimeCapitalAllocator';
import { StrategyMutationEngine } from '../evolution/StrategyMutationEngine';
import { StrategyPortfolioOptimizer } from '../strategy/StrategyPortfolioOptimizer';
import { AlphaMemory } from '../memory/AlphaMemory';
import { DistributedAlphaMemory } from './DistributedAlphaMemory';
import { SwarmAgent, AgentState, AgentConfig } from './SwarmAgent';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';

/**
 * Configuration for the swarm runtime
 */
export interface SwarmRuntimeConfig {
  /**
   * Maximum number of agents to run on this node
   */
  maxAgents: number;
  
  /**
   * Agent execution interval in milliseconds
   */
  agentExecutionIntervalMs: number;
  
  /**
   * Coordination interval for syncing with other nodes in milliseconds
   */
  coordinationIntervalMs: number;
  
  /**
   * If true, will automatically join the global swarm network
   */
  autoJoinSwarm: boolean;
  
  /**
   * Geographic region identifier for this node
   */
  region: string;
  
  /**
   * Optional bootstrap nodes to connect to
   */
  bootstrapPeers?: string[];
  
  /**
   * Whether to enable detailed telemetry reporting
   */
  enableDetailedTelemetry: boolean;
  
  /**
   * Whether to sync memory with other nodes
   */
  syncMemory: boolean;
  
  /**
   * Maximum memory sync interval in milliseconds
   */
  memorySyncIntervalMs: number;
  
  /**
   * Whether to automatically restart failed agents
   */
  autoRestartFailedAgents: boolean;
}

/**
 * Runtime metrics for swarm monitoring
 */
export interface SwarmRuntimeMetrics {
  nodeId: string;
  region: string;
  hostname: string;
  uptime: number;
  startTime: number;
  activeAgents: number;
  totalAgentCount: number;
  agentsCreated: number;
  agentsRetired: number;
  lastCoordinationTime: number;
  lastMemorySyncTime: number;
  connectedPeers: number;
  cpuUsage: number;
  memoryUsage: number;
}

/**
 * Default configuration for swarm runtime
 */
const DEFAULT_CONFIG: SwarmRuntimeConfig = {
  maxAgents: 5,
  agentExecutionIntervalMs: 1000,
  coordinationIntervalMs: 10000,
  autoJoinSwarm: true,
  region: 'default',
  enableDetailedTelemetry: true,
  syncMemory: true,
  memorySyncIntervalMs: 60000,
  autoRestartFailedAgents: true
};

/**
 * SwarmRuntime
 * 
 * Orchestrates multiple strategy agents running in parallel, manages their
 * lifecycle, and coordinates with other nodes in the swarm.
 */
export class SwarmRuntime {
  private static instance: SwarmRuntime | null = null;
  private config: SwarmRuntimeConfig;
  private swarmCoordinator: SwarmCoordinator;
  private distributedMemory: DistributedAlphaMemory;
  private telemetryBus: TelemetryBus;
  private regimeClassifier: RegimeClassifier;
  private nodeId: string;
  private hostname: string;
  private agents: Map<string, SwarmAgent>;
  private runningAgents: Set<string>;
  private retiredAgents: Set<string>;
  private agentConfigs: Map<string, AgentConfig>;
  private startTime: number;
  private mainLoopInterval: NodeJS.Timeout | null = null;
  private coordinationInterval: NodeJS.Timeout | null = null;
  private memorySyncInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private agentsCreated: number = 0;
  private agentsRetired: number = 0;
  
  /**
   * Private constructor
   */
  private constructor(config: Partial<SwarmRuntimeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.nodeId = uuidv4();
    this.hostname = os.hostname();
    this.agents = new Map();
    this.runningAgents = new Set();
    this.retiredAgents = new Set();
    this.agentConfigs = new Map();
    this.startTime = Date.now();
    
    // Initialize core services
    this.telemetryBus = TelemetryBus.getInstance();
    this.regimeClassifier = RegimeClassifier.getInstance();
    
    // Initialize distributed services
    this.distributedMemory = DistributedAlphaMemory.getInstance({
      nodeId: this.nodeId,
      region: this.config.region,
      syncIntervalMs: this.config.memorySyncIntervalMs
    });
    
    this.swarmCoordinator = SwarmCoordinator.getInstance({
      nodeId: this.nodeId,
      region: this.config.region,
      bootstrapPeers: this.config.bootstrapPeers
    });
    
    logger.info(`SwarmRuntime initialized with nodeId: ${this.nodeId}, region: ${this.config.region}`);
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<SwarmRuntimeConfig>): SwarmRuntime {
    if (!SwarmRuntime.instance) {
      SwarmRuntime.instance = new SwarmRuntime(config);
    }
    return SwarmRuntime.instance;
  }
  
  /**
   * Start the swarm runtime
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('SwarmRuntime already running');
      return;
    }
    
    this.isRunning = true;
    
    // Start distributed services
    if (this.config.syncMemory) {
      await this.distributedMemory.start();
    }
    
    if (this.config.autoJoinSwarm) {
      await this.swarmCoordinator.joinSwarm();
    }
    
    // Start main execution loop
    this.startMainLoop();
    
    // Start coordination loop
    this.startCoordinationLoop();
    
    // Start memory sync loop
    if (this.config.syncMemory) {
      this.startMemorySyncLoop();
    }
    
    // Initialize agents based on config
    await this.initializeDefaultAgents();
    
    // Emit runtime started event
    this.telemetryBus.emit('swarm_runtime_started', {
      timestamp: Date.now(),
      nodeId: this.nodeId,
      region: this.config.region,
      maxAgents: this.config.maxAgents,
      hostname: this.hostname
    });
    
    logger.info(`SwarmRuntime started with ${this.agents.size} agents`);
  }
  
  /**
   * Stop the swarm runtime
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    
    // Stop all intervals
    if (this.mainLoopInterval) {
      clearInterval(this.mainLoopInterval);
      this.mainLoopInterval = null;
    }
    
    if (this.coordinationInterval) {
      clearInterval(this.coordinationInterval);
      this.coordinationInterval = null;
    }
    
    if (this.memorySyncInterval) {
      clearInterval(this.memorySyncInterval);
      this.memorySyncInterval = null;
    }
    
    // Stop all agents
    const stopPromises = Array.from(this.runningAgents).map(agentId => {
      const agent = this.agents.get(agentId);
      if (agent) {
        return agent.stop();
      }
      return Promise.resolve();
    });
    
    await Promise.all(stopPromises);
    this.runningAgents.clear();
    
    // Leave swarm
    await this.swarmCoordinator.leaveSwarm();
    
    // Stop distributed memory
    if (this.config.syncMemory) {
      await this.distributedMemory.stop();
    }
    
    this.isRunning = false;
    
    // Emit runtime stopped event
    this.telemetryBus.emit('swarm_runtime_stopped', {
      timestamp: Date.now(),
      nodeId: this.nodeId,
      region: this.config.region,
      runTime: Date.now() - this.startTime,
      agentsCreated: this.agentsCreated,
      agentsRetired: this.agentsRetired
    });
    
    logger.info('SwarmRuntime stopped');
  }
  
  /**
   * Initialize default agents
   */
  private async initializeDefaultAgents(): Promise<void> {
    const agentCount = Math.min(2, this.config.maxAgents); // Start with a few agents by default
    
    for (let i = 0; i < agentCount; i++) {
      await this.createAgent({
        symbol: 'BTC/USD', // Default symbol
        name: `Default-Agent-${i+1}`,
        allowMutation: true,
        allowSynchronization: true
      });
    }
  }
  
  /**
   * Start the main execution loop
   */
  private startMainLoop(): void {
    this.mainLoopInterval = setInterval(() => {
      this.executeAgentCycle()
        .catch(error => {
          logger.error('Error in agent execution cycle:', error);
        });
    }, this.config.agentExecutionIntervalMs);
  }
  
  /**
   * Start the coordination loop
   */
  private startCoordinationLoop(): void {
    this.coordinationInterval = setInterval(() => {
      this.coordinateWithSwarm()
        .catch(error => {
          logger.error('Error in swarm coordination cycle:', error);
        });
    }, this.config.coordinationIntervalMs);
  }
  
  /**
   * Start the memory sync loop
   */
  private startMemorySyncLoop(): void {
    this.memorySyncInterval = setInterval(() => {
      this.syncDistributedMemory()
        .catch(error => {
          logger.error('Error in memory sync cycle:', error);
        });
    }, this.config.memorySyncIntervalMs);
  }
  
  /**
   * Execute a cycle for all running agents
   */
  private async executeAgentCycle(): Promise<void> {
    // Execute all running agents in parallel
    const executionPromises = Array.from(this.runningAgents).map(agentId => {
      const agent = this.agents.get(agentId);
      if (agent && agent.getState() === AgentState.RUNNING) {
        return agent.executeCycle()
          .catch(error => {
            logger.error(`Error in agent ${agentId} execution:`, error);
            this.handleAgentFailure(agentId, error);
          });
      }
      return Promise.resolve();
    });
    
    await Promise.all(executionPromises);
    
    // Check agent health and restart failed agents if configured
    if (this.config.autoRestartFailedAgents) {
      this.checkAndRestartFailedAgents();
    }
  }
  
  /**
   * Coordinate with other nodes in the swarm
   */
  private async coordinateWithSwarm(): Promise<void> {
    // Get agent status information
    const agentStatuses = Array.from(this.agents.entries()).map(([agentId, agent]) => ({
      agentId,
      state: agent.getState(),
      symbol: agent.getSymbol(),
      metrics: agent.getMetrics(),
      uptime: agent.getUptime()
    }));
    
    // Get runtime metrics
    const runtimeMetrics = this.getRuntimeMetrics();
    
    // Sync with swarm
    const coordinationResult = await this.swarmCoordinator.coordinateWithSwarm({
      nodeId: this.nodeId,
      region: this.config.region,
      timestamp: Date.now(),
      agentStatuses,
      runtimeMetrics
    });
    
    // Process coordination commands (e.g., start/stop agents, sync genomes)
    if (coordinationResult.commands && coordinationResult.commands.length > 0) {
      await this.processCoordinationCommands(coordinationResult.commands);
    }
    
    // Process peer information
    if (coordinationResult.peers && coordinationResult.peers.length > 0) {
      // Update our list of known peers
      this.swarmCoordinator.updatePeers(coordinationResult.peers);
    }
    
    // Emit telemetry
    this.telemetryBus.emit('swarm_coordination_completed', {
      timestamp: Date.now(),
      nodeId: this.nodeId,
      peerCount: coordinationResult.peers?.length || 0,
      commandCount: coordinationResult.commands?.length || 0
    });
  }
  
  /**
   * Sync distributed memory with other nodes
   */
  private async syncDistributedMemory(): Promise<void> {
    await this.distributedMemory.syncWithPeers();
    
    // Update agents with new memory if needed
    for (const agentId of this.runningAgents) {
      const agent = this.agents.get(agentId);
      if (agent) {
        await agent.refreshMemory();
      }
    }
    
    this.telemetryBus.emit('memory_sync_completed', {
      timestamp: Date.now(),
      nodeId: this.nodeId,
      recordCount: await this.distributedMemory.getRecordCount()
    });
  }
  
  /**
   * Process coordination commands from the swarm
   */
  private async processCoordinationCommands(commands: any[]): Promise<void> {
    for (const command of commands) {
      switch (command.type) {
        case 'START_AGENT':
          if (command.config) {
            await this.createAgent(command.config);
          }
          break;
          
        case 'STOP_AGENT':
          if (command.agentId) {
            await this.stopAgent(command.agentId);
          }
          break;
          
        case 'SYNC_GENOME':
          if (command.agentId && command.genome) {
            await this.syncAgentGenome(command.agentId, command.genome);
          }
          break;
          
        case 'RETIRE_AGENT':
          if (command.agentId) {
            await this.retireAgent(command.agentId);
          }
          break;
          
        case 'UPDATE_AGENT_CONFIG':
          if (command.agentId && command.config) {
            await this.updateAgentConfig(command.agentId, command.config);
          }
          break;
          
        default:
          logger.warn(`Unknown coordination command: ${command.type}`);
      }
    }
  }
  
  /**
   * Handle agent failure
   */
  private handleAgentFailure(agentId: string, error: any): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    
    // Update agent state
    agent.setState(AgentState.FAILED);
    
    // Emit telemetry
    this.telemetryBus.emit('agent_failure', {
      timestamp: Date.now(),
      nodeId: this.nodeId,
      agentId,
      error: error instanceof Error ? error.message : String(error),
      symbol: agent.getSymbol()
    });
    
    // Remove from running agents
    this.runningAgents.delete(agentId);
    
    logger.error(`Agent ${agentId} failed:`, error);
  }
  
  /**
   * Check and restart failed agents
   */
  private checkAndRestartFailedAgents(): void {
    for (const [agentId, agent] of this.agents.entries()) {
      if (agent.getState() === AgentState.FAILED && !this.retiredAgents.has(agentId)) {
        // Get the agent config
        const config = this.agentConfigs.get(agentId);
        if (config) {
          // Restart the agent
          agent.restart()
            .then(() => {
              this.runningAgents.add(agentId);
              logger.info(`Agent ${agentId} restarted successfully`);
              
              // Emit telemetry
              this.telemetryBus.emit('agent_restarted', {
                timestamp: Date.now(),
                nodeId: this.nodeId,
                agentId,
                symbol: agent.getSymbol()
              });
            })
            .catch(error => {
              logger.error(`Failed to restart agent ${agentId}:`, error);
            });
        }
      }
    }
  }
  
  /**
   * Create a new agent
   */
  public async createAgent(config: AgentConfig): Promise<string> {
    // Check if we can create more agents
    if (this.runningAgents.size >= this.config.maxAgents) {
      throw new Error(`Maximum number of agents (${this.config.maxAgents}) reached`);
    }
    
    // Create agent ID
    const agentId = `agent-${this.nodeId}-${uuidv4()}`;
    
    // Create agent instance
    const agent = new SwarmAgent({
      agentId,
      nodeId: this.nodeId,
      region: this.config.region,
      ...config
    });
    
    // Store agent and config
    this.agents.set(agentId, agent);
    this.agentConfigs.set(agentId, config);
    
    // Start agent
    await agent.start();
    this.runningAgents.add(agentId);
    this.agentsCreated++;
    
    // Emit telemetry
    this.telemetryBus.emit('agent_created', {
      timestamp: Date.now(),
      nodeId: this.nodeId,
      agentId,
      symbol: config.symbol,
      region: this.config.region
    });
    
    logger.info(`Agent ${agentId} created for symbol ${config.symbol}`);
    
    return agentId;
  }
  
  /**
   * Stop an agent
   */
  public async stopAgent(agentId: string): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }
    
    // Stop the agent
    await agent.stop();
    
    // Remove from running agents
    this.runningAgents.delete(agentId);
    
    // Emit telemetry
    this.telemetryBus.emit('agent_stopped', {
      timestamp: Date.now(),
      nodeId: this.nodeId,
      agentId,
      symbol: agent.getSymbol()
    });
    
    logger.info(`Agent ${agentId} stopped`);
    
    return true;
  }
  
  /**
   * Retire an agent (stop and mark as retired)
   */
  public async retireAgent(agentId: string): Promise<boolean> {
    // Stop the agent first
    const stopped = await this.stopAgent(agentId);
    if (!stopped) {
      return false;
    }
    
    // Mark as retired
    this.retiredAgents.add(agentId);
    this.agentsRetired++;
    
    // Emit telemetry
    this.telemetryBus.emit('agent_retired', {
      timestamp: Date.now(),
      nodeId: this.nodeId,
      agentId
    });
    
    logger.info(`Agent ${agentId} retired`);
    
    return true;
  }
  
  /**
   * Restart an agent
   */
  public async restartAgent(agentId: string): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent || this.retiredAgents.has(agentId)) {
      return false;
    }
    
    // Restart the agent
    await agent.restart();
    
    // Add to running agents
    this.runningAgents.add(agentId);
    
    // Emit telemetry
    this.telemetryBus.emit('agent_restarted', {
      timestamp: Date.now(),
      nodeId: this.nodeId,
      agentId,
      symbol: agent.getSymbol()
    });
    
    logger.info(`Agent ${agentId} restarted`);
    
    return true;
  }
  
  /**
   * Update agent configuration
   */
  public async updateAgentConfig(agentId: string, config: Partial<AgentConfig>): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }
    
    // Check if we need to restart the agent for config changes
    const needsRestart = config.symbol !== agent.getSymbol();
    
    // If running and needs restart, stop first
    if (this.runningAgents.has(agentId) && needsRestart) {
      await this.stopAgent(agentId);
    }
    
    // Update agent config
    agent.updateConfig(config);
    
    // Update stored config
    const currentConfig = this.agentConfigs.get(agentId) || {};
    this.agentConfigs.set(agentId, { ...currentConfig, ...config });
    
    // If was running and needs restart, restart
    if (needsRestart) {
      await this.restartAgent(agentId);
    }
    
    // Emit telemetry
    this.telemetryBus.emit('agent_config_updated', {
      timestamp: Date.now(),
      nodeId: this.nodeId,
      agentId,
      config
    });
    
    logger.info(`Agent ${agentId} config updated`);
    
    return true;
  }
  
  /**
   * Sync agent genome from another node
   */
  private async syncAgentGenome(agentId: string, genome: any): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }
    
    // Apply genome to agent
    const success = await agent.updateGenome(genome);
    
    if (success) {
      // Emit telemetry
      this.telemetryBus.emit('agent_genome_synced', {
        timestamp: Date.now(),
        nodeId: this.nodeId,
        agentId,
        genomeVersion: genome.version || 'unknown'
      });
      
      logger.info(`Agent ${agentId} genome synced`);
    }
    
    return success;
  }
  
  /**
   * Get runtime metrics
   */
  public getRuntimeMetrics(): SwarmRuntimeMetrics {
    // Get CPU and memory usage
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      nodeId: this.nodeId,
      region: this.config.region,
      hostname: this.hostname,
      uptime: Date.now() - this.startTime,
      startTime: this.startTime,
      activeAgents: this.runningAgents.size,
      totalAgentCount: this.agents.size,
      agentsCreated: this.agentsCreated,
      agentsRetired: this.agentsRetired,
      lastCoordinationTime: this.swarmCoordinator.getLastCoordinationTime(),
      lastMemorySyncTime: this.distributedMemory.getLastSyncTime(),
      connectedPeers: this.swarmCoordinator.getConnectedPeerCount(),
      cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000,
      memoryUsage: memUsage.heapUsed / 1024 / 1024 // in MB
    };
  }
  
  /**
   * Get agent by ID
   */
  public getAgent(agentId: string): SwarmAgent | undefined {
    return this.agents.get(agentId);
  }
  
  /**
   * Get all agents
   */
  public getAllAgents(): SwarmAgent[] {
    return Array.from(this.agents.values());
  }
  
  /**
   * Get running agents
   */
  public getRunningAgents(): SwarmAgent[] {
    return Array.from(this.runningAgents).map(id => this.agents.get(id)!).filter(Boolean);
  }
  
  /**
   * Get failed agents
   */
  public getFailedAgents(): SwarmAgent[] {
    return Array.from(this.agents.values()).filter(agent => 
      agent.getState() === AgentState.FAILED && !this.retiredAgents.has(agent.getAgentId())
    );
  }
  
  /**
   * Get retired agents
   */
  public getRetiredAgents(): SwarmAgent[] {
    return Array.from(this.retiredAgents).map(id => this.agents.get(id)!).filter(Boolean);
  }
  
  /**
   * Get node ID
   */
  public getNodeId(): string {
    return this.nodeId;
  }
  
  /**
   * Get region
   */
  public getRegion(): string {
    return this.config.region;
  }
  
  /**
   * Check if runtime is running
   */
  public isRuntimeRunning(): boolean {
    return this.isRunning;
  }
} 