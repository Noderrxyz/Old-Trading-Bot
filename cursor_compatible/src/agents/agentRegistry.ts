/**
 * Agent Registry
 * 
 * Registry for all trading agents in the system. Provides centralized
 * tracking and management of agent instances.
 */

import { RedisClient } from '../common/redis.js';
import { createLogger } from '../common/logger.js';
import { TradingAgent } from './base/TradingAgent.js';
import { AgentLifecycleState } from './base/AgentContext.js';

const logger = createLogger('AgentRegistry');

/**
 * Agent registration metadata
 */
export interface AgentRegistration {
  // Agent ID
  agentId: string;
  
  // Agent type/implementation
  agentType: string;
  
  // When the agent was registered
  registeredAt: number;
  
  // Last activity timestamp
  lastActiveAt: number;
  
  // Whether this agent is enabled
  enabled: boolean;
  
  // Current lifecycle state
  lifecycleState: AgentLifecycleState;
  
  // Signal source used by this agent
  signalSource: string;
  
  // Trading pairs this agent handles
  tradingPairs: string[];
  
  // Custom agent configuration
  config: Record<string, any>;
}

/**
 * Agent Registry 
 * Tracks and manages all trading agents in the system
 */
export class AgentRegistry {
  private redis: RedisClient;
  private agents: Map<string, TradingAgent> = new Map();
  private registrations: Map<string, AgentRegistration> = new Map();
  
  /**
   * Create a new agent registry
   * @param redis Redis client for persistence
   */
  constructor(redis: RedisClient) {
    this.redis = redis;
  }
  
  /**
   * Initialize the registry
   */
  public async initialize(): Promise<void> {
    await this.loadRegistrationsFromRedis();
    logger.info(`Initialized agent registry with ${this.registrations.size} registered agents`);
  }
  
  /**
   * Register a new agent
   * @param agent The agent instance
   * @param registration Agent registration data
   */
  public registerAgent(agent: TradingAgent, registration: Omit<AgentRegistration, 'registeredAt' | 'lastActiveAt' | 'lifecycleState'>): void {
    const now = Date.now();
    
    // Create complete registration
    const fullRegistration: AgentRegistration = {
      ...registration,
      registeredAt: now,
      lastActiveAt: now,
      lifecycleState: agent.state
    };
    
    // Check if already registered
    if (this.agents.has(registration.agentId)) {
      throw new Error(`Agent with ID ${registration.agentId} is already registered`);
    }
    
    // Store in memory
    this.agents.set(registration.agentId, agent);
    this.registrations.set(registration.agentId, fullRegistration);
    
    // Persist to Redis
    this.saveRegistrationToRedis(fullRegistration);
    
    logger.info(`Registered agent: ${registration.agentId} (${registration.agentType})`);
  }
  
  /**
   * Unregister an agent
   * @param agentId ID of the agent to unregister
   */
  public async unregisterAgent(agentId: string): Promise<boolean> {
    // Check if registered
    if (!this.agents.has(agentId)) {
      logger.warn(`Cannot unregister agent ${agentId}: not found in registry`);
      return false;
    }
    
    // Remove from memory
    this.agents.delete(agentId);
    this.registrations.delete(agentId);
    
    // Remove from Redis
    await this.deleteRegistrationFromRedis(agentId);
    
    logger.info(`Unregistered agent: ${agentId}`);
    return true;
  }
  
  /**
   * Get an agent by ID
   * @param agentId Agent ID
   * @returns The agent instance or undefined if not found
   */
  public getAgent(agentId: string): TradingAgent | undefined {
    return this.agents.get(agentId);
  }
  
  /**
   * Get an agent's registration data
   * @param agentId Agent ID
   * @returns The agent's registration data or undefined if not found
   */
  public getAgentRegistration(agentId: string): AgentRegistration | undefined {
    return this.registrations.get(agentId);
  }
  
  /**
   * Get all registered agents
   * @returns Map of agent ID to agent instance
   */
  public getAllAgents(): Map<string, TradingAgent> {
    return new Map(this.agents);
  }
  
  /**
   * Get all agent registrations
   * @returns Map of agent ID to registration data
   */
  public getAllRegistrations(): Map<string, AgentRegistration> {
    return new Map(this.registrations);
  }
  
  /**
   * Get all agents of a specific type
   * @param agentType Agent type
   * @returns Array of agent instances
   */
  public getAgentsByType(agentType: string): TradingAgent[] {
    const agents: TradingAgent[] = [];
    
    for (const [agentId, registration] of this.registrations.entries()) {
      if (registration.agentType === agentType) {
        const agent = this.agents.get(agentId);
        if (agent) {
          agents.push(agent);
        }
      }
    }
    
    return agents;
  }
  
  /**
   * Get all agents trading a specific pair
   * @param tradingPair Trading pair (e.g., "BTC/USD")
   * @returns Array of agent instances
   */
  public getAgentsForTradingPair(tradingPair: string): TradingAgent[] {
    const agents: TradingAgent[] = [];
    
    for (const [agentId, registration] of this.registrations.entries()) {
      if (registration.tradingPairs.includes(tradingPair)) {
        const agent = this.agents.get(agentId);
        if (agent) {
          agents.push(agent);
        }
      }
    }
    
    return agents;
  }
  
  /**
   * Get all agents using a specific signal source
   * @param signalSource Signal source name
   * @returns Array of agent instances
   */
  public getAgentsBySignalSource(signalSource: string): TradingAgent[] {
    const agents: TradingAgent[] = [];
    
    for (const [agentId, registration] of this.registrations.entries()) {
      if (registration.signalSource === signalSource) {
        const agent = this.agents.get(agentId);
        if (agent) {
          agents.push(agent);
        }
      }
    }
    
    return agents;
  }
  
  /**
   * Update an agent's registration data
   * @param agentId Agent ID
   * @param updates Updates to apply
   * @returns True if successful, false if agent not found
   */
  public async updateRegistration(
    agentId: string, 
    updates: Partial<Omit<AgentRegistration, 'agentId' | 'registeredAt'>>
  ): Promise<boolean> {
    // Check if registered
    const registration = this.registrations.get(agentId);
    if (!registration) {
      logger.warn(`Cannot update agent ${agentId}: not found in registry`);
      return false;
    }
    
    // Update fields
    const updatedRegistration: AgentRegistration = {
      ...registration,
      ...updates,
      lastActiveAt: Date.now()
    };
    
    // Update in memory
    this.registrations.set(agentId, updatedRegistration);
    
    // Persist to Redis
    await this.saveRegistrationToRedis(updatedRegistration);
    
    logger.debug(`Updated registration for agent: ${agentId}`);
    return true;
  }
  
  /**
   * Update an agent's lifecycle state
   * @param agentId Agent ID
   * @param state New lifecycle state
   * @returns True if successful, false if agent not found
   */
  public async updateAgentState(agentId: string, state: AgentLifecycleState): Promise<boolean> {
    // Check if registered
    const agent = this.agents.get(agentId);
    if (!agent) {
      logger.warn(`Cannot update state for agent ${agentId}: not found in registry`);
      return false;
    }
    
    // Update registration
    await this.updateRegistration(agentId, { lifecycleState: state });
    
    logger.info(`Updated state for agent ${agentId}: ${state}`);
    return true;
  }
  
  /**
   * Enable or disable an agent
   * @param agentId Agent ID
   * @param enabled Whether to enable or disable
   * @returns True if successful, false if agent not found
   */
  public async setAgentEnabled(agentId: string, enabled: boolean): Promise<boolean> {
    // Check if registered
    const agent = this.agents.get(agentId);
    if (!agent) {
      logger.warn(`Cannot ${enabled ? 'enable' : 'disable'} agent ${agentId}: not found in registry`);
      return false;
    }
    
    // Update agent state
    if (enabled) {
      agent.resume();
    } else {
      agent.disable();
    }
    
    // Update registration
    await this.updateRegistration(agentId, { 
      enabled, 
      lifecycleState: agent.state 
    });
    
    logger.info(`${enabled ? 'Enabled' : 'Disabled'} agent: ${agentId}`);
    return true;
  }
  
  /**
   * Get metrics for all agents
   * @returns Object with agent IDs as keys and metrics as values
   */
  public getAllAgentMetrics(): Record<string, any> {
    const metrics: Record<string, any> = {};
    
    for (const [agentId, agent] of this.agents.entries()) {
      metrics[agentId] = agent.agentMetrics;
    }
    
    return metrics;
  }
  
  /**
   * Load agent registrations from Redis
   */
  private async loadRegistrationsFromRedis(): Promise<void> {
    try {
      const registrationsKey = 'agent_registry:registrations';
      const data = await this.redis.get(registrationsKey);
      
      if (data) {
        const registrations = JSON.parse(data) as AgentRegistration[];
        
        for (const registration of registrations) {
          this.registrations.set(registration.agentId, registration);
        }
        
        logger.info(`Loaded ${registrations.length} agent registrations from Redis`);
      }
    } catch (error) {
      logger.error(`Failed to load agent registrations from Redis: ${error}`);
    }
  }
  
  /**
   * Save an agent registration to Redis
   * @param registration The registration to save
   */
  private async saveRegistrationToRedis(registration: AgentRegistration): Promise<void> {
    try {
      // Update in-memory first
      this.registrations.set(registration.agentId, registration);
      
      // Then save all registrations to Redis
      const registrationsKey = 'agent_registry:registrations';
      const registrations = Array.from(this.registrations.values());
      
      await this.redis.set(registrationsKey, JSON.stringify(registrations));
    } catch (error) {
      logger.error(`Failed to save agent registration to Redis: ${error}`);
    }
  }
  
  /**
   * Delete an agent registration from Redis
   * @param agentId The agent ID to delete
   */
  private async deleteRegistrationFromRedis(agentId: string): Promise<void> {
    try {
      // Remove from in-memory first
      this.registrations.delete(agentId);
      
      // Then save updated registrations to Redis
      const registrationsKey = 'agent_registry:registrations';
      const registrations = Array.from(this.registrations.values());
      
      await this.redis.set(registrationsKey, JSON.stringify(registrations));
    } catch (error) {
      logger.error(`Failed to delete agent registration from Redis: ${error}`);
    }
  }
} 