/**
 * Agent Engine
 * 
 * Central engine for managing the execution of trading agents.
 * Handles agent lifecycle, data distribution, and execution coordination.
 */

import { RedisClient } from '../common/redis.js';
import { createLogger } from '../common/logger.js';
import { AgentRegistry, AgentRegistration } from './agentRegistry.js';
import { TradingAgent, MarketData, Order, Signal } from './base/TradingAgent.js';
import { AgentLifecycleState, RiskProfile, MarketScope, ExecutionConfig } from './base/AgentContext.js';
import { logTradeToTelemetry, TradeExecutionResult } from './utils/tradeTelemetry.js';

// EventEmitter definition since we don't have the @types/node package
// This is a simplified version that meets our needs
class EventEmitter {
  private events: Record<string, Array<(...args: any[]) => void>> = {};

  public on(event: string, listener: (...args: any[]) => void): this {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
    return this;
  }

  public emit(event: string, ...args: any[]): boolean {
    if (!this.events[event]) {
      return false;
    }
    this.events[event].forEach(listener => listener(...args));
    return true;
  }
}

// Define our own Timeout type since we don't have NodeJS typings
type Timeout = number;

const logger = createLogger('AgentEngine');

/**
 * Agent Factory interface for creating agent instances
 */
export interface AgentFactory {
  // Create a new agent instance
  createAgent(agentId: string, config: any): Promise<TradingAgent>;
  
  // Get the agent type this factory creates
  getAgentType(): string;
}

/**
 * Agent spawn options
 */
export interface AgentSpawnOptions {
  // Agent ID (unique)
  agentId: string;
  
  // Agent type (implementation)
  agentType: string;
  
  // Risk profile configuration
  riskProfile?: Partial<RiskProfile>;
  
  // Market scope configuration
  marketScope?: Partial<MarketScope>;
  
  // Execution configuration
  executionConfig?: Partial<ExecutionConfig>;
  
  // Signal source to use
  signalSource?: string;
  
  // Whether agent should start in enabled state
  enabled?: boolean;
  
  // Custom agent configuration
  config?: Record<string, any>;
}

/**
 * Execution request interface
 */
export interface ExecutionRequest {
  // Order to execute
  order: Order;
  
  // Agent that created the order
  agentId: string;
  
  // Execution priority (higher = more important)
  priority: number;
  
  // Maximum execution delay (ms)
  maxDelayMs: number;
  
  // Request timestamp
  timestamp: number;
}

/**
 * Agent Engine configuration
 */
export interface AgentEngineConfig {
  // Maximum number of agents to run concurrently
  maxConcurrentAgents: number;
  
  // Whether to use worker pool for agent execution
  useWorkerPool: boolean;
  
  // How often to poll for market data updates (ms)
  marketDataPollIntervalMs: number;
  
  // How often to update agent metrics (ms)
  metricsUpdateIntervalMs: number;
  
  // Maximum time for agent processing round (ms)
  maxProcessingTimeMs: number;
  
  // Auto-recover agents on error
  autoRecoverAgents: boolean;
  
  // Default execution priority
  defaultExecutionPriority: number;
}

/**
 * Default engine configuration
 */
const DEFAULT_ENGINE_CONFIG: AgentEngineConfig = {
  maxConcurrentAgents: 50,
  useWorkerPool: true,
  marketDataPollIntervalMs: 1000,
  metricsUpdateIntervalMs: 10000,
  maxProcessingTimeMs: 500,
  autoRecoverAgents: true,
  defaultExecutionPriority: 5
};

/**
 * Extended MarketData interface with metadata
 */
interface ExtendedMarketData extends MarketData {
  metadata?: {
    signals?: Signal[];
    [key: string]: any;
  };
}

/**
 * Central engine for managing trading agents
 */
export class AgentEngine {
  private redis: RedisClient;
  private emitter: EventEmitter;
  private registry: AgentRegistry;
  private factories: Map<string, AgentFactory> = new Map();
  private config: AgentEngineConfig;
  
  // Execution queue for orders
  private executionQueue: ExecutionRequest[] = [];
  
  // Intervals
  private marketDataInterval: Timeout | null = null;
  private metricsInterval: Timeout | null = null;
  
  // Engine state
  private isRunning: boolean = false;
  
  /**
   * Create a new agent engine
   */
  constructor(
    redis: RedisClient,
    emitter: EventEmitter = new EventEmitter(),
    config: Partial<AgentEngineConfig> = {}
  ) {
    this.redis = redis;
    this.emitter = emitter;
    this.registry = new AgentRegistry(redis);
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
  }
  
  /**
   * Initialize the agent engine
   */
  public async initialize(): Promise<void> {
    // Initialize registry
    await this.registry.initialize();
    
    logger.info('Agent engine initialized');
  }
  
  /**
   * Register an agent factory
   * @param factory Agent factory instance
   */
  public registerAgentFactory(factory: AgentFactory): void {
    const agentType = factory.getAgentType();
    this.factories.set(agentType, factory);
    logger.info(`Registered agent factory for type: ${agentType}`);
  }
  
  /**
   * Start the agent engine
   */
  public start(): void {
    if (this.isRunning) {
      logger.warn('Agent engine is already running');
      return;
    }
    
    // Start market data polling
    this.marketDataInterval = setInterval(
      () => this.pollMarketData(),
      this.config.marketDataPollIntervalMs
    ) as unknown as Timeout;
    
    // Start metrics collection
    this.metricsInterval = setInterval(
      () => this.updateAgentMetrics(),
      this.config.metricsUpdateIntervalMs
    ) as unknown as Timeout;
    
    this.isRunning = true;
    logger.info('Agent engine started');
  }
  
  /**
   * Stop the agent engine
   */
  public stop(): void {
    if (!this.isRunning) {
      logger.warn('Agent engine is not running');
      return;
    }
    
    // Clear intervals
    if (this.marketDataInterval) {
      clearInterval(this.marketDataInterval as unknown as number);
      this.marketDataInterval = null;
    }
    
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval as unknown as number);
      this.metricsInterval = null;
    }
    
    this.isRunning = false;
    logger.info('Agent engine stopped');
  }
  
  /**
   * Poll for market data and distribute to agents
   */
  private async pollMarketData(): Promise<void> {
    try {
      // Get all active trading pairs from agents
      const tradingPairs = this.getActiveTradingPairs();
      
      // For each pair, fetch market data and distribute
      for (const pair of tradingPairs) {
        const marketData = await this.fetchMarketData(pair);
        if (marketData) {
          this.distributeMarketData(marketData);
        }
      }
    } catch (error) {
      logger.error(`Error polling market data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Fetch market data for a trading pair
   * @param pair Trading pair
   * @returns Market data or null if error
   */
  private async fetchMarketData(pair: string): Promise<ExtendedMarketData | null> {
    try {
      // In a real implementation, this would fetch from an exchange API
      // For now, we'll use mock data
      
      // Get last price from Redis (if available)
      const priceKey = `market:${pair}:price`;
      const lastPriceStr = await this.redis.get(priceKey);
      const lastPrice = lastPriceStr ? parseFloat(lastPriceStr) : 50000; // Default for BTC
      
      // Generate mock market data
      const now = Date.now();
      const data: ExtendedMarketData = {
        asset: pair,
        price: {
          bid: lastPrice * 0.999,
          ask: lastPrice * 1.001,
          last: lastPrice,
          mid: lastPrice
        },
        stats: {
          volume: Math.random() * 1000 + 100,
          volumeUsd: (Math.random() * 1000 + 100) * lastPrice,
          high: lastPrice * 1.01,
          low: lastPrice * 0.99,
          priceChange: lastPrice * 0.002 * (Math.random() > 0.5 ? 1 : -1),
          priceChangePct: 0.2 * (Math.random() > 0.5 ? 1 : -1)
        },
        liquidity: {
          bps10: Math.random() * 100 + 10,
          bps50: Math.random() * 300 + 50,
          bps100: Math.random() * 500 + 100
        },
        volatility: {
          hourly: Math.random() * 0.01,
          daily: Math.random() * 0.03
        },
        timestamp: now,
        metadata: {} // Initialize empty metadata
      };
      
      return data;
    } catch (error) {
      logger.error(`Error fetching market data for ${pair}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Distribute market data to all relevant agents
   * @param marketData Market data to distribute
   */
  private async distributeMarketData(marketData: ExtendedMarketData): Promise<void> {
    // Get all agents trading this pair
    const agents = this.registry.getAgentsForTradingPair(marketData.asset);
    
    // Process in parallel using Promise.all
    const processPromises = agents.map(agent => {
      return this.processAgentUpdate(agent, marketData);
    });
    
    await Promise.all(processPromises);
  }
  
  /**
   * Process market data update for a single agent
   * @param agent Agent to update
   * @param marketData Market data
   */
  private async processAgentUpdate(agent: TradingAgent, marketData: ExtendedMarketData): Promise<void> {
    try {
      // Check if agent is enabled
      const registration = this.registry.getAgentRegistration(agent.agentId);
      if (!registration || !registration.enabled || 
          registration.lifecycleState === AgentLifecycleState.DISABLED ||
          registration.lifecycleState === AgentLifecycleState.ERROR) {
        return;
      }
      
      // Update with timeout to ensure agent doesn't hang
      const updatePromise = agent.processUpdate(marketData);
      
      // Use Promise.race with a timeout
      await Promise.race([
        updatePromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Agent update timeout')), this.config.maxProcessingTimeMs)
        )
      ]);
      
      // Update last active timestamp
      await this.registry.updateRegistration(agent.agentId, { lastActiveAt: Date.now() });
    } catch (error) {
      logger.error(`Error processing agent ${agent.agentId} update: ${error instanceof Error ? error.message : String(error)}`);
      
      // Handle recovery if enabled
      if (this.config.autoRecoverAgents) {
        this.handleAgentError(agent.agentId, error);
      }
    }
  }
  
  /**
   * Handle agent error
   * @param agentId Agent ID
   * @param error Error object
   */
  private async handleAgentError(agentId: string, error: unknown): Promise<void> {
    try {
      // Update agent state
      await this.registry.updateAgentState(agentId, AgentLifecycleState.ERROR);
      
      // Log error to agent events stream
      const streamKey = `agent_events:${agentId}`;
      await this.redis.xadd(
        streamKey,
        '*',
        {
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack || '' : '',
          timestamp: Date.now().toString()
        }
      );
      
      logger.warn(`Agent ${agentId} set to ERROR state due to: ${error instanceof Error ? error.message : String(error)}`);
    } catch (innerError) {
      logger.error(`Failed to handle agent error: ${innerError instanceof Error ? innerError.message : String(innerError)}`);
    }
  }
  
  /**
   * Update metrics for all agents
   */
  private async updateAgentMetrics(): Promise<void> {
    try {
      // Get all metrics
      const allMetrics = this.registry.getAllAgentMetrics();
      
      // Store in Redis
      const metricsKey = 'agent_engine:metrics';
      await this.redis.set(metricsKey, JSON.stringify({
        timestamp: Date.now(),
        agentCount: Object.keys(allMetrics).length,
        agents: allMetrics
      }));
      
      // Emit metrics event
      this.emitter.emit('agent_metrics_updated', allMetrics);
      
      logger.debug(`Updated metrics for ${Object.keys(allMetrics).length} agents`);
    } catch (error) {
      logger.error(`Error updating agent metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get all active trading pairs from registered agents
   * @returns Set of unique trading pairs
   */
  private getActiveTradingPairs(): Set<string> {
    const pairs = new Set<string>();
    
    for (const registration of this.registry.getAllRegistrations().values()) {
      if (registration.enabled) {
        for (const pair of registration.tradingPairs) {
          pairs.add(pair);
        }
      }
    }
    
    return pairs;
  }
  
  /**
   * Spawn a new agent
   * @param options Agent spawn options
   * @returns The newly created agent
   */
  public async spawnAgent(options: AgentSpawnOptions): Promise<TradingAgent> {
    // Ensure we have a factory for this agent type
    const factory = this.factories.get(options.agentType);
    if (!factory) {
      throw new Error(`No factory registered for agent type: ${options.agentType}`);
    }
    
    // Check if agent already exists
    if (this.registry.getAgent(options.agentId)) {
      throw new Error(`Agent with ID ${options.agentId} already exists`);
    }
    
    // Create agent instance
    const agent = await factory.createAgent(options.agentId, options.config || {});
    
    // Initialize agent
    await agent.initialize();
    
    // Register agent
    this.registry.registerAgent(agent, {
      agentId: options.agentId,
      agentType: options.agentType,
      enabled: options.enabled !== false, // Default to enabled if not specified
      signalSource: options.signalSource || 'internal',
      tradingPairs: options.marketScope?.tradableAssets || [],
      config: options.config || {}
    });
    
    logger.info(`Spawned new agent: ${options.agentId} (${options.agentType})`);
    
    return agent;
  }
  
  /**
   * Submit an order from an agent
   * @param order Order to submit
   * @param priority Execution priority (higher = more important)
   * @returns Promise that resolves when order is queued
   */
  public async submitOrder(order: Order, priority: number = this.config.defaultExecutionPriority): Promise<void> {
    // Create execution request
    const request: ExecutionRequest = {
      order,
      agentId: order.agentId,
      priority,
      maxDelayMs: order.ttlMs || 30000, // Default 30s if not specified
      timestamp: Date.now()
    };
    
    // Add to queue
    this.executionQueue.push(request);
    
    // Sort queue by priority (higher first)
    this.executionQueue.sort((a, b) => b.priority - a.priority);
    
    // Log submission
    logger.info(
      `Queued order from ${order.agentId}: ${order.side} ${order.amount} ${order.asset} ` +
      `@ ${order.price || 'MARKET'} (priority: ${priority})`
    );
    
    // Process execution queue (async)
    this.processExecutionQueue();
  }
  
  /**
   * Process the execution queue
   */
  private async processExecutionQueue(): Promise<void> {
    try {
      // Process in priority order
      while (this.executionQueue.length > 0) {
        const request = this.executionQueue[0];
        
        // Check if request has expired
        const now = Date.now();
        if (now - request.timestamp > request.maxDelayMs) {
          // Remove expired request
          this.executionQueue.shift();
          logger.warn(`Order from ${request.agentId} expired before execution`);
          continue;
        }
        
        // Execute the order
        await this.executeOrder(request);
        
        // Remove from queue
        this.executionQueue.shift();
      }
    } catch (error) {
      logger.error(`Error processing execution queue: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Execute an order
   * @param request Execution request
   */
  private async executeOrder(request: ExecutionRequest): Promise<void> {
    try {
      const order = request.order;
      
      // Get the agent
      const agent = this.registry.getAgent(request.agentId);
      if (!agent) {
        logger.error(`Agent ${request.agentId} not found for order execution callback`);
        return;
      }
      
      // Get agent registration to check config
      const registration = this.registry.getAgentRegistration(request.agentId);
      if (!registration) {
        logger.error(`Agent registration ${request.agentId} not found for order execution`);
        return;
      }
      
      // Check execution mode from the registration config
      const isSimulationMode = 
        (registration.config?.executionConfig?.mode === 'canary' || 
         registration.config?.executionConfig?.mode === 'dry-run' ||
         registration.config?.executionConfig?.canaryMode === true);
      
      // Simulate fill price with slight slippage
      const fillPrice = order.price 
        ? order.price * (1 + (order.side === 'buy' ? 0.001 : -0.001)) 
        : await this.getMarketPrice(order.asset);
      
      // Create execution result object
      const tradeResult: TradeExecutionResult = {
        agentId: order.agentId,
        orderId: order.id,
        asset: order.asset,
        side: order.side,
        amount: order.amount,
        requestedPrice: order.price,
        fillPrice,
        timestamp: Date.now(),
        simulated: isSimulationMode,
        // Add additional metadata
        orderType: order.type,
        timeInForce: order.timeInForce,
        slippageBps: order.maxSlippageBps,
        tags: order.tags,
        sourceSignalStrength: order.sourceSignal?.strength,
        sourceSignalConfidence: order.sourceSignal?.confidence
      };
      
      // Use the telemetry service to log the trade
      await logTradeToTelemetry(this.redis, tradeResult);
      
      // Emit appropriate event based on simulation mode
      if (isSimulationMode) {
        this.emitter.emit('order_simulated', tradeResult);
        
        // Don't continue with actual execution for simulated trades
        return;
      }
      
      // For live mode, this is where we would execute the order on the exchange
      // For now, we're just simulating execution
      
      // Emit fill event for live trades
      this.emitter.emit('order_filled', tradeResult);
    } catch (error) {
      logger.error(`Error executing order: ${error instanceof Error ? error.message : String(error)}`);
      
      // Emit failure event
      this.emitter.emit('order_failed', {
        agentId: request.order.agentId,
        orderId: request.order.id,
        reason: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Get current market price for asset
   * @param asset Asset pair
   * @returns Current price
   */
  private async getMarketPrice(asset: string): Promise<number> {
    // In a real implementation, this would get from an exchange API
    // For now, use mock data
    
    // Try to get from Redis
    const priceKey = `market:${asset}:price`;
    const priceStr = await this.redis.get(priceKey);
    
    if (priceStr) {
      return parseFloat(priceStr);
    }
    
    // Default prices if not found
    if (asset === 'BTC/USD') return 50000;
    if (asset === 'ETH/USD') return 2000;
    
    return 100; // Default for unknown assets
  }
  
  /**
   * Get registry instance
   */
  public getRegistry(): AgentRegistry {
    return this.registry;
  }
  
  /**
   * Distribute a signal to all relevant agents
   * @param signal Signal to distribute
   */
  public async distributeSignal(signal: Signal): Promise<void> {
    // Get all agents that use this signal source
    const agents = this.registry.getAgentsBySignalSource(signal.source);
    
    // Filter to those trading this asset
    const relevantAgents = agents.filter(agent => {
      const registration = this.registry.getAgentRegistration(agent.agentId);
      return registration && registration.tradingPairs.includes(signal.asset);
    });
    
    // Log signal distribution
    logger.info(
      `Distributing ${signal.source} signal for ${signal.asset} ` +
      `(strength: ${signal.strength.toFixed(2)}, confidence: ${signal.confidence.toFixed(2)}) ` +
      `to ${relevantAgents.length} agents`
    );
    
    // Emit event for signal
    this.emitter.emit('signal_distributed', {
      signal,
      targetAgents: relevantAgents.map(a => a.agentId),
      timestamp: Date.now()
    });
    
    // Store signal in Redis
    const signalKey = `signal:${signal.source}:${signal.asset}`;
    await this.redis.lpush(signalKey, JSON.stringify(signal));
    await this.redis.ltrim(signalKey, 0, 99); // Keep last 100 signals
    
    // Let agents process the signal with market data
    for (const agent of relevantAgents) {
      // Get current market data
      const marketData = await this.fetchMarketData(signal.asset);
      if (marketData) {
        // Add signal to metadata
        if (!marketData.metadata) {
          marketData.metadata = {};
        }
        marketData.metadata.signals = [signal];
        
        // Process agent update with signal in market data
        await this.processAgentUpdate(agent, marketData);
      }
    }
  }
} 