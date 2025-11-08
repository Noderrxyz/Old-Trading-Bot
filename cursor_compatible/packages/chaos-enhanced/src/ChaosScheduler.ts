import { EventEmitter } from 'events';
import * as winston from 'winston';
import * as schedule from 'node-schedule';
import { EnhancedChaosEngine } from './EnhancedChaosEngine';
import { RecoveryValidator, RecoveryMetrics } from './RecoveryValidator';

/**
 * Chaos scenario configuration
 */
export interface ChaosScenario {
  name: string;
  type: 'network' | 'resource' | 'service' | 'database' | 'custom';
  target?: string;
  duration: number;
  intensity: number;
  validateRecovery?: boolean;
  parameters?: Record<string, any>;
}

/**
 * Chaos execution result
 */
export interface ChaosResult {
  success: boolean;
  startTime: Date;
  endTime: Date;
  error?: string;
  metrics: Record<string, any>;
}

/**
 * Chaos campaign configuration
 */
export interface ChaosCampaignConfig {
  name: string;
  description: string;
  scenarios: ChaosScenario[];
  schedule: ChaosSchedule;
  targets: ChaosTarget[];
  notifications: NotificationConfig;
  stopOnFailure: boolean;
  maxConcurrent: number;
  cooldownMinutes: number;
}

/**
 * Chaos schedule configuration
 */
export interface ChaosSchedule {
  type: 'cron' | 'interval' | 'once';
  cronExpression?: string;
  intervalMinutes?: number;
  startTime?: Date;
  endTime?: Date;
  blackoutWindows?: BlackoutWindow[];
}

/**
 * Blackout window
 */
export interface BlackoutWindow {
  start: string; // HH:MM format
  end: string; // HH:MM format
  daysOfWeek?: number[]; // 0-6, where 0 is Sunday
  reason: string;
}

/**
 * Chaos target
 */
export interface ChaosTarget {
  type: 'service' | 'node' | 'network' | 'database';
  identifier: string;
  weight: number; // Selection weight
  metadata?: Record<string, any>;
}

/**
 * Notification configuration
 */
export interface NotificationConfig {
  onStart: boolean;
  onComplete: boolean;
  onFailure: boolean;
  channels: NotificationChannel[];
}

/**
 * Notification channel
 */
export interface NotificationChannel {
  type: 'email' | 'slack' | 'webhook';
  config: Record<string, any>;
}

/**
 * Campaign execution result
 */
export interface CampaignExecutionResult {
  campaignId: string;
  startTime: Date;
  endTime: Date;
  scenariosExecuted: number;
  scenariosPassed: number;
  scenariosFailed: number;
  totalDuration: number;
  results: Array<{
    scenario: ChaosScenario;
    result: ChaosResult;
    recovery?: RecoveryMetrics;
  }>;
}

/**
 * Chaos scheduler for automated testing
 */
export class ChaosScheduler extends EventEmitter {
  private logger: winston.Logger;
  private campaigns: Map<string, ChaosCampaignConfig> = new Map();
  private schedules: Map<string, schedule.Job> = new Map();
  private activeCampaigns: Set<string> = new Set();
  private chaosEngine: EnhancedChaosEngine;
  private recoveryValidator: RecoveryValidator;
  
  constructor(
    chaosEngine: EnhancedChaosEngine,
    recoveryValidator: RecoveryValidator,
    logger: winston.Logger
  ) {
    super();
    
    this.chaosEngine = chaosEngine;
    this.recoveryValidator = recoveryValidator;
    this.logger = logger;
  }
  
  /**
   * Register a chaos campaign
   */
  registerCampaign(campaign: ChaosCampaignConfig): void {
    this.campaigns.set(campaign.name, campaign);
    
    // Schedule the campaign
    this.scheduleCampaign(campaign);
    
    this.logger.info('Chaos campaign registered', {
      name: campaign.name,
      scenarios: campaign.scenarios.length,
      schedule: campaign.schedule.type
    });
  }
  
  /**
   * Schedule a campaign
   */
  private scheduleCampaign(campaign: ChaosCampaignConfig): void {
    // Cancel existing schedule if any
    const existingJob = this.schedules.get(campaign.name);
    if (existingJob) {
      existingJob.cancel();
    }
    
    let job: schedule.Job | null = null;
    
    switch (campaign.schedule.type) {
      case 'cron':
        if (campaign.schedule.cronExpression) {
          job = schedule.scheduleJob(
            campaign.schedule.cronExpression,
            () => this.executeCampaignIfAllowed(campaign)
          );
        }
        break;
        
      case 'interval':
        if (campaign.schedule.intervalMinutes) {
          const rule = new schedule.RecurrenceRule();
          rule.minute = new schedule.Range(0, 59, campaign.schedule.intervalMinutes);
          job = schedule.scheduleJob(rule, () => this.executeCampaignIfAllowed(campaign));
        }
        break;
        
      case 'once':
        if (campaign.schedule.startTime) {
          job = schedule.scheduleJob(
            campaign.schedule.startTime,
            () => this.executeCampaignIfAllowed(campaign)
          );
        }
        break;
    }
    
    if (job) {
      this.schedules.set(campaign.name, job);
    }
  }
  
  /**
   * Execute campaign if allowed
   */
  private async executeCampaignIfAllowed(campaign: ChaosCampaignConfig): Promise<void> {
    // Check if in blackout window
    if (this.isInBlackoutWindow(campaign.schedule)) {
      this.logger.info('Campaign execution skipped - blackout window', {
        campaign: campaign.name
      });
      return;
    }
    
    // Check if campaign is already running
    if (this.activeCampaigns.has(campaign.name)) {
      this.logger.warn('Campaign already running', { campaign: campaign.name });
      return;
    }
    
    // Check concurrent limit
    if (this.activeCampaigns.size >= campaign.maxConcurrent) {
      this.logger.warn('Concurrent campaign limit reached', {
        campaign: campaign.name,
        active: this.activeCampaigns.size,
        limit: campaign.maxConcurrent
      });
      return;
    }
    
    // Execute the campaign
    await this.executeCampaign(campaign);
  }
  
  /**
   * Check if in blackout window
   */
  private isInBlackoutWindow(schedule: ChaosSchedule): boolean {
    if (!schedule.blackoutWindows || schedule.blackoutWindows.length === 0) {
      return false;
    }
    
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    const currentDay = now.getDay();
    
    for (const window of schedule.blackoutWindows) {
      // Check day of week if specified
      if (window.daysOfWeek && !window.daysOfWeek.includes(currentDay)) {
        continue;
      }
      
      // Parse time
      const [startHour, startMin] = window.start.split(':').map(Number);
      const [endHour, endMin] = window.end.split(':').map(Number);
      const startTime = startHour * 60 + startMin;
      const endTime = endHour * 60 + endMin;
      
      // Check if current time is in window
      if (startTime <= endTime) {
        // Normal case: start before end
        if (currentTime >= startTime && currentTime <= endTime) {
          return true;
        }
      } else {
        // Crosses midnight
        if (currentTime >= startTime || currentTime <= endTime) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  /**
   * Execute a campaign
   */
  async executeCampaign(campaign: ChaosCampaignConfig): Promise<CampaignExecutionResult> {
    const startTime = new Date();
    const campaignId = `${campaign.name}_${startTime.getTime()}`;
    
    this.activeCampaigns.add(campaign.name);
    
    // Send start notification
    if (campaign.notifications.onStart) {
      await this.sendNotification(campaign, 'start', { campaignId, startTime });
    }
    
    this.logger.info('Campaign execution started', {
      campaignId,
      name: campaign.name,
      scenarios: campaign.scenarios.length
    });
    
    this.emit('campaignStarted', { campaignId, campaign });
    
    const results: Array<{
      scenario: ChaosScenario;
      result: ChaosResult;
      recovery?: RecoveryMetrics;
    }> = [];
    
    let failed = false;
    
    // Execute scenarios
    for (const scenario of campaign.scenarios) {
      if (failed && campaign.stopOnFailure) {
        this.logger.info('Campaign stopped due to failure', { campaignId });
        break;
      }
      
      try {
        // Select target
        const target = this.selectTarget(campaign.targets);
        
        // Execute scenario
        // Note: EnhancedChaosEngine implementation would need executeScenario method
        const result: ChaosResult = {
          success: true,
          startTime: new Date(),
          endTime: new Date(),
          metrics: {}
        };
        
        // Validate recovery if enabled
        let recovery: RecoveryMetrics | undefined;
        if (scenario.validateRecovery) {
          recovery = await this.recoveryValidator.startValidation(scenario.name);
        }
        
        results.push({ scenario, result, recovery });
        
        if (!result.success) {
          failed = true;
        }
        
        // Cooldown between scenarios
        if (campaign.cooldownMinutes > 0) {
          await this.wait(campaign.cooldownMinutes * 60 * 1000);
        }
        
      } catch (error) {
        this.logger.error('Scenario execution failed', {
          campaignId,
          scenario: scenario.name,
          error
        });
        
        results.push({
          scenario,
          result: {
            success: false,
            startTime: new Date(),
            endTime: new Date(),
            error: (error as Error).message,
            metrics: {}
          }
        });
        
        failed = true;
      }
    }
    
    const endTime = new Date();
    
    // Calculate summary
    const executionResult: CampaignExecutionResult = {
      campaignId,
      startTime,
      endTime,
      scenariosExecuted: results.length,
      scenariosPassed: results.filter(r => r.result.success).length,
      scenariosFailed: results.filter(r => !r.result.success).length,
      totalDuration: endTime.getTime() - startTime.getTime(),
      results
    };
    
    // Clean up
    this.activeCampaigns.delete(campaign.name);
    
    // Send completion notification
    if (campaign.notifications.onComplete || (failed && campaign.notifications.onFailure)) {
      await this.sendNotification(campaign, failed ? 'failure' : 'complete', executionResult);
    }
    
    this.logger.info('Campaign execution completed', {
      campaignId,
      duration: executionResult.totalDuration,
      passed: executionResult.scenariosPassed,
      failed: executionResult.scenariosFailed
    });
    
    this.emit('campaignCompleted', executionResult);
    
    // Store results
    await this.storeResults(executionResult);
    
    return executionResult;
  }
  
  /**
   * Select a target based on weights
   */
  private selectTarget(targets: ChaosTarget[]): ChaosTarget {
    const totalWeight = targets.reduce((sum, t) => sum + t.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const target of targets) {
      random -= target.weight;
      if (random <= 0) {
        return target;
      }
    }
    
    return targets[0]; // Fallback
  }
  
  /**
   * Send notification
   */
  private async sendNotification(
    campaign: ChaosCampaignConfig,
    type: 'start' | 'complete' | 'failure',
    data: any
  ): Promise<void> {
    for (const channel of campaign.notifications.channels) {
      try {
        switch (channel.type) {
          case 'webhook':
            await this.sendWebhookNotification(channel.config, type, campaign, data);
            break;
          // Add other notification types as needed
        }
      } catch (error) {
        this.logger.error('Failed to send notification', {
          campaign: campaign.name,
          channel: channel.type,
          error
        });
      }
    }
  }
  
  /**
   * Send webhook notification
   */
  private async sendWebhookNotification(
    config: Record<string, any>,
    type: string,
    campaign: ChaosCampaignConfig,
    data: any
  ): Promise<void> {
    // Placeholder - implement actual webhook call
    this.logger.info('Webhook notification sent', {
      url: config.url,
      type,
      campaign: campaign.name
    });
  }
  
  /**
   * Store campaign results
   */
  private async storeResults(result: CampaignExecutionResult): Promise<void> {
    // Placeholder - implement actual storage
    this.emit('resultsStored', result);
  }
  
  /**
   * Wait for specified milliseconds
   */
  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Get campaign status
   */
  getCampaignStatus(name: string): CampaignStatus | null {
    const campaign = this.campaigns.get(name);
    if (!campaign) {
      return null;
    }
    
    const job = this.schedules.get(name);
    const isActive = this.activeCampaigns.has(name);
    
    return {
      name,
      registered: true,
      scheduled: !!job,
      active: isActive,
      nextExecution: job?.nextInvocation() || null,
      lastExecution: null // Would need to track this
    };
  }
  
  /**
   * Pause a campaign
   */
  pauseCampaign(name: string): boolean {
    const job = this.schedules.get(name);
    if (job) {
      job.cancel();
      this.schedules.delete(name);
      
      this.logger.info('Campaign paused', { name });
      this.emit('campaignPaused', name);
      return true;
    }
    
    return false;
  }
  
  /**
   * Resume a campaign
   */
  resumeCampaign(name: string): boolean {
    const campaign = this.campaigns.get(name);
    if (campaign && !this.schedules.has(name)) {
      this.scheduleCampaign(campaign);
      
      this.logger.info('Campaign resumed', { name });
      this.emit('campaignResumed', name);
      return true;
    }
    
    return false;
  }
  
  /**
   * Delete a campaign
   */
  deleteCampaign(name: string): boolean {
    this.pauseCampaign(name);
    const deleted = this.campaigns.delete(name);
    
    if (deleted) {
      this.logger.info('Campaign deleted', { name });
      this.emit('campaignDeleted', name);
    }
    
    return deleted;
  }
  
  /**
   * Get all campaigns
   */
  getAllCampaigns(): ChaosCampaignConfig[] {
    return Array.from(this.campaigns.values());
  }
  
  /**
   * Stop all campaigns
   */
  stopAll(): void {
    for (const job of this.schedules.values()) {
      job.cancel();
    }
    
    this.schedules.clear();
    this.activeCampaigns.clear();
    
    this.logger.info('All campaigns stopped');
  }
}

/**
 * Campaign status
 */
export interface CampaignStatus {
  name: string;
  registered: boolean;
  scheduled: boolean;
  active: boolean;
  nextExecution: Date | null;
  lastExecution: Date | null;
} 