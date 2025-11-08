import { setLogLevel, LogLevel } from '../utils/logger.js';
import { LiveAgent, AgentStatus, AgentHealthMetrics } from '../deploy/types/launch_control.types.js';
import { RedisClient } from '../utils/redis.js';

// Create a simple logger for this module
const logger = {
  info: (message: string, ...args: any[]) => {
    if (process.env.LOG_LEVEL ? parseInt(process.env.LOG_LEVEL) <= LogLevel.INFO : true) {
      console.log(`[AgentRegistry] ${message}`, ...args);
    }
  },
  error: (message: string, ...args: any[]) => {
    if (process.env.LOG_LEVEL ? parseInt(process.env.LOG_LEVEL) <= LogLevel.ERROR : true) {
      console.error(`[AgentRegistry] ${message}`, ...args);
    }
  }
};

export class AgentRegistry {
  private static instance: AgentRegistry | null = null;
  private agents: Map<string, LiveAgent> = new Map();
  private redis: RedisClient;
  private readonly REDIS_KEY_PREFIX = 'agent:';
  private readonly HEALTH_CHECK_INTERVAL = 30000;  // 30 seconds

  private constructor() {
    this.redis = new RedisClient();
    this.startHealthChecks();
  }

  public static getInstance(): AgentRegistry {
    if (!AgentRegistry.instance) {
      AgentRegistry.instance = new AgentRegistry();
    }
    return AgentRegistry.instance;
  }

  /**
   * Register a new agent
   */
  public async registerAgent(agent: LiveAgent): Promise<void> {
    this.agents.set(agent.id, agent);
    await this.redis.set(
      `${this.REDIS_KEY_PREFIX}${agent.id}`,
      JSON.stringify(agent)
    );
    logger.info(`Registered agent: ${agent.id}`);
  }

  /**
   * Update agent status
   */
  public async updateAgentStatus(
    agentId: string,
    status: AgentStatus
  ): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    agent.status = status;
    agent.lastUpdate = Date.now();
    await this.redis.set(
      `${this.REDIS_KEY_PREFIX}${agentId}`,
      JSON.stringify(agent)
    );
    logger.info(`Updated agent status: ${agentId} -> ${status}`);
  }

  /**
   * Update agent health metrics
   */
  public async updateAgentHealth(
    agentId: string,
    health: AgentHealthMetrics
  ): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    agent.health = health;
    agent.lastUpdate = Date.now();
    await this.redis.set(
      `${this.REDIS_KEY_PREFIX}${agentId}`,
      JSON.stringify(agent)
    );
  }

  /**
   * Get agent by ID
   */
  public getAgent(agentId: string): LiveAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all active agents
   */
  public getActiveAgents(): LiveAgent[] {
    return Array.from(this.agents.values()).filter(
      agent => agent.status === AgentStatus.Active
    );
  }

  /**
   * Get agents by status
   */
  public getAgentsByStatus(status: AgentStatus): LiveAgent[] {
    return Array.from(this.agents.values()).filter(
      agent => agent.status === status
    );
  }

  /**
   * Get agents by region
   */
  public getAgentsByRegion(region: string): LiveAgent[] {
    return Array.from(this.agents.values()).filter(agent =>
      agent.config.targetRegions.includes(region)
    );
  }

  /**
   * Remove agent
   */
  public async removeAgent(agentId: string): Promise<void> {
    this.agents.delete(agentId);
    await this.redis.del(`${this.REDIS_KEY_PREFIX}${agentId}`);
    logger.info(`Removed agent: ${agentId}`);
  }

  /**
   * Start health check interval
   */
  private startHealthChecks(): void {
    setInterval(() => this.checkAgentHealth(), this.HEALTH_CHECK_INTERVAL);
  }

  /**
   * Check agent health
   */
  private async checkAgentHealth(): Promise<void> {
    const now = Date.now();
    for (const [agentId, agent] of this.agents.entries()) {
      // Check for stale heartbeats
      if (now - agent.health.lastHeartbeat > this.HEALTH_CHECK_INTERVAL * 2) {
        logger.error(`Agent heartbeat stale: ${agentId}`);
        await this.updateAgentStatus(agentId, AgentStatus.Failed);
      }

      // Check for high error rates
      if (agent.health.errorRate > 0.2) {
        logger.error(`Agent error rate high: ${agentId}`);
        await this.updateAgentStatus(agentId, AgentStatus.Paused);
      }

      // Check for high latency
      if (agent.health.latencyMs > 5000) {
        logger.error(`Agent latency high: ${agentId}`);
        await this.updateAgentStatus(agentId, AgentStatus.Paused);
      }
    }
  }

  /**
   * Load agents from Redis on startup
   */
  public async loadAgents(): Promise<void> {
    const keys = await this.redis.keys(`${this.REDIS_KEY_PREFIX}*`);
    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        const agent = JSON.parse(data) as LiveAgent;
        this.agents.set(agent.id, agent);
      }
    }
    logger.info(`Loaded ${this.agents.size} agents from Redis`);
  }
} 