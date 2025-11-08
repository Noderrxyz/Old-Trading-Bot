/**
 * Agent Controller Utility
 * 
 * Handles Redis PubSub communication for agent control commands
 * Provides methods for pausing, resuming, and configuring agents
 */

import { RedisClient } from '../../common/redis.js';
import { createLogger, Logger } from '../../common/logger.js';

export class AgentController {
  private redis: RedisClient;
  private logger: Logger;
  private agentId: string;
  private subscribers: Map<string, Function> = new Map();
  private paused: boolean = false;
  private unsubscribeCallbacks: (() => void)[] = [];

  /**
   * Create a new agent controller
   * @param redis Redis client
   * @param agentId Agent ID to control
   */
  constructor(redis: RedisClient, agentId: string) {
    this.redis = redis;
    this.agentId = agentId;
    this.logger = createLogger(`AgentController:${agentId}`);
  }

  /**
   * Initialize the controller and subscribe to control channels
   */
  public async initialize(): Promise<void> {
    this.logger.info('Initializing agent controller');
    
    // Subscribe to agent-specific control channels
    const pauseChannel = `agent:${this.agentId}:pause`;
    const resumeChannel = `agent:${this.agentId}:resume`;
    const configChannel = `agent:${this.agentId}:inject_config`;
    const restartChannel = `agent:${this.agentId}:restart`;
    
    // Subscribe to each channel
    const unsubPause = await this.subscribeToCommand(pauseChannel, this.handlePause.bind(this));
    const unsubResume = await this.subscribeToCommand(resumeChannel, this.handleResume.bind(this));
    const unsubConfig = await this.subscribeToCommand(configChannel, this.handleConfigInjection.bind(this));
    const unsubRestart = await this.subscribeToCommand(restartChannel, this.handleRestart.bind(this));
    
    // Store unsubscribe callbacks
    this.unsubscribeCallbacks.push(unsubPause, unsubResume, unsubConfig, unsubRestart);
    
    this.logger.info('Agent controller initialized');
  }

  /**
   * Subscribe to a Redis command channel
   * @param channel Channel to subscribe to
   * @param callback Callback to execute when messages arrive
   * @returns Function to unsubscribe
   */
  private async subscribeToCommand(channel: string, callback: Function): Promise<() => void> {
    // Use Redis PubSub to subscribe to the channel
    this.redis.subscribe(channel, (err: Error | null, count: number) => {
      if (err) {
        this.logger.error(`Error subscribing to ${channel}: ${err.message}`);
        return;
      }
      
      this.logger.debug(`Subscribed to ${channel} (${count} total subscriptions)`);
    });
    
    // Store the callback
    this.subscribers.set(channel, callback);
    
    // Add message handler
    const messageHandler = (subscribedChannel: string, message: string) => {
      if (subscribedChannel === channel) {
        try {
          callback(message);
        } catch (error) {
          this.logger.error(`Error handling command on ${channel}: ${error}`);
        }
      }
    };
    
    this.redis.on('message', messageHandler);
    
    // Return unsubscribe function
    return () => {
      this.redis.unsubscribe(channel);
      this.redis.removeListener('message', messageHandler);
      this.subscribers.delete(channel);
      this.logger.debug(`Unsubscribed from ${channel}`);
    };
  }

  /**
   * Handle pause command
   */
  private handlePause(_message: string): void {
    this.logger.info('Received pause command');
    this.paused = true;
    
    // Emit state change event
    this.redis.publish('agent_events', JSON.stringify({
      type: 'agent_paused',
      agentId: this.agentId,
      timestamp: Date.now()
    }));
    
    // Update state in Redis
    this.redis.set(`agent:${this.agentId}:state`, 'paused')
      .catch(err => this.logger.error(`Error updating agent state: ${err}`));
  }

  /**
   * Handle resume command
   */
  private handleResume(_message: string): void {
    this.logger.info('Received resume command');
    this.paused = false;
    
    // Emit state change event
    this.redis.publish('agent_events', JSON.stringify({
      type: 'agent_resumed',
      agentId: this.agentId,
      timestamp: Date.now()
    }));
    
    // Update state in Redis
    this.redis.set(`agent:${this.agentId}:state`, 'running')
      .catch(err => this.logger.error(`Error updating agent state: ${err}`));
  }

  /**
   * Handle config injection command
   * @param message JSON string containing configuration to inject
   */
  private handleConfigInjection(message: string): void {
    try {
      this.logger.info('Received config injection command');
      
      // Parse the config JSON
      const config = JSON.parse(message);
      
      // Emit config received event
      this.redis.publish('agent_events', JSON.stringify({
        type: 'agent_config_received',
        agentId: this.agentId,
        timestamp: Date.now()
      }));
      
      // Notify subscribers
      if (this.configHandler) {
        this.configHandler(config);
      }
    } catch (error) {
      this.logger.error(`Error parsing config injection: ${error}`);
    }
  }

  /**
   * Handle restart command
   */
  private handleRestart(_message: string): void {
    this.logger.info('Received restart command');
    
    // Emit restart event
    this.redis.publish('agent_events', JSON.stringify({
      type: 'agent_restarting',
      agentId: this.agentId,
      timestamp: Date.now()
    }));
    
    // Update state in Redis
    this.redis.set(`agent:${this.agentId}:state`, 'initializing')
      .catch(err => this.logger.error(`Error updating agent state: ${err}`));
    
    // Notify subscribers
    if (this.restartHandler) {
      this.restartHandler();
    }
  }

  /**
   * Cleanup resources used by the controller
   */
  public cleanup(): void {
    this.logger.info('Cleaning up agent controller');
    
    // Unsubscribe from all channels
    for (const unsubscribe of this.unsubscribeCallbacks) {
      unsubscribe();
    }
    
    this.unsubscribeCallbacks = [];
    this.subscribers.clear();
  }

  /**
   * Check if the agent is paused
   * @returns True if the agent is paused
   */
  public isPaused(): boolean {
    return this.paused;
  }

  /**
   * Handler for config injection
   */
  private configHandler: ((config: any) => void) | null = null;

  /**
   * Set handler for config injection
   * @param handler Handler function
   */
  public onConfigInjection(handler: (config: any) => void): void {
    this.configHandler = handler;
  }

  /**
   * Handler for restart command
   */
  private restartHandler: (() => void) | null = null;

  /**
   * Set handler for restart command
   * @param handler Handler function
   */
  public onRestart(handler: () => void): void {
    this.restartHandler = handler;
  }

  /**
   * Publish a state change event
   * @param state New agent state
   */
  public async publishStateChange(state: string): Promise<void> {
    this.logger.info(`Publishing state change: ${state}`);
    
    // Update state in Redis
    await this.redis.set(`agent:${this.agentId}:state`, state);
    
    // Publish event
    await this.redis.publish('agent_events', JSON.stringify({
      type: 'agent_state_changed',
      agentId: this.agentId,
      state,
      timestamp: Date.now()
    }));
  }
} 