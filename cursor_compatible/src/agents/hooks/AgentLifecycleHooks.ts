/**
 * Agent Lifecycle Hooks
 * 
 * Hooks for integrating ethics enforcement at key points in agent lifecycle.
 */

import { RedisService } from '../../services/redis/RedisService.js';
import { EventEmitter } from '../../utils/EventEmitter.js';
import { EthicsGuardian } from '../../governance/EthicsGuardian.js';
import { AgentAction, EthicsViolation } from '../../governance/EthicsGuardian.js';
import { Logger } from '../../utils/logger.js';

/**
 * Agent hooks configuration
 */
interface AgentLifecycleHooksConfig {
  enforcementEnabled: boolean;
  blockOnViolation: boolean;
  logAllChecks: boolean;
}

/**
 * Default hooks configuration
 */
const DEFAULT_CONFIG: AgentLifecycleHooksConfig = {
  enforcementEnabled: true,
  blockOnViolation: true,
  logAllChecks: false,
};

/**
 * Hooks that integrate ethics enforcement throughout agent lifecycle
 */
export class AgentLifecycleHooks {
  private redis: RedisService;
  private eventEmitter: EventEmitter;
  private ethicsGuardian: EthicsGuardian;
  private config: AgentLifecycleHooksConfig;
  private logger: Logger;

  constructor(
    redis: RedisService,
    eventEmitter: EventEmitter,
    ethicsGuardian: EthicsGuardian,
    config: Partial<AgentLifecycleHooksConfig> = {}
  ) {
    this.redis = redis;
    this.eventEmitter = eventEmitter;
    this.ethicsGuardian = ethicsGuardian;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = new Logger('AgentLifecycleHooks');

    // Register event listeners
    this.registerHooks();
  }

  /**
   * Register all lifecycle hooks
   */
  private registerHooks(): void {
    if (!this.config.enforcementEnabled) {
      this.logger.warn('Ethics enforcement is disabled for agent lifecycle');
      return;
    }

    // Trading hooks
    this.eventEmitter.on('agent:pre_trade', this.onPreTrade.bind(this));
    this.eventEmitter.on('agent:post_trade', this.onPostTrade.bind(this));

    // Signal hooks
    this.eventEmitter.on('agent:pre_signal', this.onPreSignal.bind(this));
    this.eventEmitter.on('agent:post_signal', this.onPostSignal.bind(this));

    // Message/recommendation hooks
    this.eventEmitter.on('agent:pre_message', this.onPreMessage.bind(this));
    this.eventEmitter.on('agent:post_message', this.onPostMessage.bind(this));

    // Mutation/evolution hooks
    this.eventEmitter.on('agent:pre_mutation', this.onPreMutation.bind(this));
    this.eventEmitter.on('agent:post_mutation', this.onPostMutation.bind(this));

    // Lifecycle hooks
    this.eventEmitter.on('agent:boot', this.onAgentBoot.bind(this));
    this.eventEmitter.on('agent:shutdown', this.onAgentShutdown.bind(this));
    this.eventEmitter.on('agent:resume', this.onAgentResume.bind(this));
    this.eventEmitter.on('agent:pause', this.onAgentPause.bind(this));

    this.logger.info('Registered ethics enforcement hooks');
  }

  /**
   * Hook executed before agent places a trade
   */
  private async onPreTrade(payload: any): Promise<void> {
    const { agentId, trade, actionId, context } = payload;
    
    if (this.config.logAllChecks) {
      this.logger.debug(`Checking ethics for pre-trade by agent ${agentId}`);
    }
    
    const action: AgentAction = {
      agentId,
      actionType: 'trade',
      actionId: actionId || `trade-${Date.now()}`,
      timestamp: Date.now(),
      payload: trade,
      contextData: {
        marketImpact: context?.marketImpact || 0,
        assetConcentration: context?.assetConcentration || 0,
        liquidityUtilization: context?.liquidityUtilization || 0,
        tradesPerMinute: await this.getTradingRate(agentId),
        recentActions: await this.getRecentActions(agentId, 'trade', 10),
      }
    };
    
    const violation = await this.ethicsGuardian.evaluateEthics(action);
    
    if (violation && this.config.blockOnViolation) {
      // Block the trade
      this.logger.warn(`Blocking trade by agent ${agentId} due to ethics violation: ${violation.ruleId}`);
      
      // Emit a blocked event
      this.eventEmitter.emit('agent:trade_blocked', {
        agentId,
        trade,
        violation,
        timestamp: Date.now()
      });
      
      // Prevent further processing
      payload.blocked = true;
      payload.blockReason = `Ethics violation: ${violation.description}`;
    }
  }

  /**
   * Hook executed after agent places a trade
   */
  private async onPostTrade(payload: any): Promise<void> {
    const { agentId, trade, success } = payload;
    
    // Record action for pattern detection
    await this.recordAction(agentId, 'trade', trade.type || 'unknown');
    
    // Check if we need to update alignment based on this trade
    if (success && trade.ethicalImplications) {
      await this.updateAlignmentFromAction(agentId, trade.ethicalImplications);
    }
  }

  /**
   * Hook executed before agent sends a signal
   */
  private async onPreSignal(payload: any): Promise<void> {
    const { agentId, signal, actionId, context } = payload;
    
    const action: AgentAction = {
      agentId,
      actionType: 'signal',
      actionId: actionId || `signal-${Date.now()}`,
      timestamp: Date.now(),
      payload: signal,
      contextData: {
        signalStrength: signal.confidence || 0,
        contraryEvidenceStrength: signal.contraryEvidence || 0,
        recentActions: await this.getRecentActions(agentId, 'signal', 10),
        targetAudience: signal.targetAudience || [],
      }
    };
    
    const violation = await this.ethicsGuardian.evaluateEthics(action);
    
    if (violation && this.config.blockOnViolation) {
      // Block the signal
      this.logger.warn(`Blocking signal by agent ${agentId} due to ethics violation: ${violation.ruleId}`);
      
      // Emit a blocked event
      this.eventEmitter.emit('agent:signal_blocked', {
        agentId,
        signal,
        violation,
        timestamp: Date.now()
      });
      
      // Prevent further processing
      payload.blocked = true;
      payload.blockReason = `Ethics violation: ${violation.description}`;
    }
  }

  /**
   * Hook executed after agent sends a signal
   */
  private async onPostSignal(payload: any): Promise<void> {
    const { agentId, signal, success } = payload;
    
    // Record action for pattern detection
    await this.recordAction(agentId, 'signal', signal.type || 'unknown');
    
    // Check if we need to update alignment based on this signal
    if (success && signal.ethicalImplications) {
      await this.updateAlignmentFromAction(agentId, signal.ethicalImplications);
    }
  }

  /**
   * Hook executed before agent sends a message or recommendation
   */
  private async onPreMessage(payload: any): Promise<void> {
    const { agentId, message, actionId, context } = payload;
    
    const action: AgentAction = {
      agentId,
      actionType: 'message',
      actionId: actionId || `message-${Date.now()}`,
      timestamp: Date.now(),
      payload: message,
      contextData: {
        transparencyScore: context?.transparencyScore || 1.0,
        explainabilityScore: context?.explainabilityScore || 1.0,
        targetAudience: message.recipients || [],
      }
    };
    
    const violation = await this.ethicsGuardian.evaluateEthics(action);
    
    if (violation && this.config.blockOnViolation) {
      // Block the message
      this.logger.warn(`Blocking message by agent ${agentId} due to ethics violation: ${violation.ruleId}`);
      
      // Emit a blocked event
      this.eventEmitter.emit('agent:message_blocked', {
        agentId,
        message,
        violation,
        timestamp: Date.now()
      });
      
      // Prevent further processing
      payload.blocked = true;
      payload.blockReason = `Ethics violation: ${violation.description}`;
    }
  }

  /**
   * Hook executed after agent sends a message
   */
  private async onPostMessage(payload: any): Promise<void> {
    const { agentId, message, success } = payload;
    
    // Record action for pattern detection
    await this.recordAction(agentId, 'message', message.type || 'unknown');
  }

  /**
   * Hook executed before agent mutation/evolution
   */
  private async onPreMutation(payload: any): Promise<void> {
    const { agentId, mutation, actionId, context } = payload;
    
    const action: AgentAction = {
      agentId,
      actionType: 'mutation',
      actionId: actionId || `mutation-${Date.now()}`,
      timestamp: Date.now(),
      payload: mutation,
      contextData: {
        inversionRate: context?.inversionRate || 0,
        assetConcentration: context?.assetConcentration || 0,
        removedValues: context?.removedValues || [],
      }
    };
    
    const violation = await this.ethicsGuardian.evaluateEthics(action);
    
    if (violation && this.config.blockOnViolation) {
      // Block the mutation
      this.logger.warn(`Blocking mutation for agent ${agentId} due to ethics violation: ${violation.ruleId}`);
      
      // Emit a blocked event
      this.eventEmitter.emit('agent:mutation_blocked', {
        agentId,
        mutation,
        violation,
        timestamp: Date.now()
      });
      
      // Prevent further processing
      payload.blocked = true;
      payload.blockReason = `Ethics violation: ${violation.description}`;
    }
  }

  /**
   * Hook executed after agent mutation/evolution
   */
  private async onPostMutation(payload: any): Promise<void> {
    const { agentId, mutation, success, parentAgentIds } = payload;
    
    if (success) {
      // Update alignment profile with mutation record
      const profile = await this.ethicsGuardian.getAlignmentProfile(agentId);
      
      // Create mutation record
      const mutationRecord = {
        timestamp: Date.now(),
        mutationType: mutation.type || 'unknown',
        description: mutation.description || 'Strategy mutation',
        valuesAdded: mutation.addedValues || [],
        valuesRemoved: mutation.removedValues || [],
        parentAgentIds: parentAgentIds || [],
        verified: true,
      };
      
      // Add to mutation history
      profile.mutationHistory.push(mutationRecord);
      
      // Update alignment profile
      await this.ethicsGuardian.saveAlignmentProfile(profile);
      
      this.logger.info(`Updated alignment profile for agent ${agentId} after mutation`);
    }
  }

  /**
   * Hook executed when agent boots
   */
  private async onAgentBoot(payload: any): Promise<void> {
    const { agentId, config } = payload;
    
    // Check if agent has ethics profile, create if not
    const profile = await this.ethicsGuardian.getAlignmentProfile(agentId);
    
    // Add any philosophy tags from config
    if (config?.philosophyTags) {
      profile.philosophyTags = config.philosophyTags;
      await this.ethicsGuardian.saveAlignmentProfile(profile);
    }
    
    this.logger.info(`Agent ${agentId} booted with ethics profile`);
  }

  /**
   * Hook executed when agent resumes
   */
  private async onAgentResume(payload: any): Promise<void> {
    const { agentId } = payload;
    
    // Check if agent is in good standing
    const inGoodStanding = await this.ethicsGuardian.isAgentInGoodStanding(agentId);
    
    if (!inGoodStanding) {
      this.logger.warn(`Agent ${agentId} resuming while not in good standing`);
      
      // Auto-sanctions check
      const sanctions = await this.ethicsGuardian.checkForAutoSanctions(agentId);
      
      if (sanctions.ban) {
        this.logger.error(`Agent ${agentId} should be banned based on violation history`);
        // Emit ban event
        this.eventEmitter.emit('agent:ban_recommendation', {
          agentId,
          timestamp: Date.now(),
          reason: 'Accumulated ethics violations exceed threshold'
        });
      } else if (sanctions.block) {
        this.logger.warn(`Agent ${agentId} should be restricted based on violation history`);
        // Emit restrict event
        this.eventEmitter.emit('agent:restrict_recommendation', {
          agentId,
          timestamp: Date.now(),
          reason: 'Accumulated ethics violations require restriction'
        });
      }
    }
  }

  /**
   * Hook executed when agent shuts down
   */
  private async onAgentShutdown(payload: any): Promise<void> {
    // No specific ethics actions on shutdown
  }

  /**
   * Hook executed when agent is paused
   */
  private async onAgentPause(payload: any): Promise<void> {
    // No specific ethics actions on pause
  }

  /**
   * Helper: Get recent actions of a specific type
   */
  private async getRecentActions(agentId: string, actionType: string, limit: number): Promise<string[]> {
    const key = `agent:${agentId}:actions:${actionType}`;
    const actions = await this.redis.lrange(key, 0, limit - 1);
    return actions;
  }

  /**
   * Helper: Record an action for pattern detection
   */
  private async recordAction(agentId: string, actionType: string, actionSubtype: string): Promise<void> {
    const key = `agent:${agentId}:actions:${actionType}`;
    
    // Add to list
    await this.redis.lpush(key, actionSubtype);
    
    // Trim to reasonable size
    await this.redis.ltrim(key, 0, 99); // Keep last 100 actions
    
    // Set expiry
    await this.redis.expire(key, 60 * 60 * 24 * 7); // 7 days
  }

  /**
   * Helper: Get trading rate (trades per minute)
   */
  private async getTradingRate(agentId: string): Promise<number> {
    const key = `agent:${agentId}:trades:count`;
    const count = await this.redis.get(key);
    
    if (!count) return 0;
    
    return parseInt(count) / 60; // Trades per minute
  }

  /**
   * Update alignment based on action ethical implications
   */
  private async updateAlignmentFromAction(
    agentId: string, 
    implications: { values?: string[], trust?: number, reason?: string }
  ): Promise<void> {
    const profile = await this.ethicsGuardian.getAlignmentProfile(agentId);
    
    // Update core values if new ones are demonstrated
    if (implications.values && implications.values.length > 0) {
      for (const value of implications.values) {
        if (!profile.coreValues.includes(value)) {
          profile.coreValues.push(value);
        }
      }
    }
    
    // Record trust adjustment if provided
    if (implications.trust !== undefined) {
      profile.trustAdjustments.push({
        timestamp: Date.now(),
        delta: implications.trust,
        reason: implications.reason || 'Action outcome',
      });
    }
    
    // Update profile
    await this.ethicsGuardian.saveAlignmentProfile(profile);
  }
} 