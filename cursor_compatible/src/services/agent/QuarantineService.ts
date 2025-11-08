/**
 * Quarantine Service
 * 
 * Manages the quarantine system for agents with critically low trust scores.
 * Provides functionality to quarantine agents, check quarantine status,
 * and manage the quarantine lifecycle.
 */

import { RedisService } from '../infrastructure/RedisService.js';
import { 
  QUARANTINE_DURATION_MS, 
  TRUST_QUARANTINE_THRESHOLD 
} from '../../constants/trust.js';
import logger from '../../utils/logger.js';

/**
 * Quarantine reason types
 */
export enum QuarantineReason {
  LOW_TRUST = 'low_trust',
  REPEATED_VIOLATIONS = 'repeated_violations',
  MANUAL = 'manual',
  SECURITY = 'security_violation'
}

/**
 * Quarantine record details
 */
export interface QuarantineRecord {
  agentId: string;
  reason: QuarantineReason;
  trustScore: number;
  startTime: number;
  endTime: number;
  isActive: boolean;
  adminNotes?: string;
}

/**
 * Service for managing agent quarantines
 */
export class QuarantineService {
  constructor(private readonly redis: RedisService) {}
  
  /**
   * Place an agent in quarantine
   * @param agentId Agent identifier
   * @param reason Reason for quarantine
   * @param trustScore Current trust score
   * @param durationMs Optional custom duration (defaults to standard quarantine period)
   * @param adminNotes Optional admin notes about the quarantine
   * @returns End time of the quarantine
   */
  async quarantineAgent(
    agentId: string, 
    reason: QuarantineReason, 
    trustScore: number,
    durationMs: number = QUARANTINE_DURATION_MS,
    adminNotes?: string
  ): Promise<number> {
    const quarantineKey = `agent:${agentId}:quarantine`;
    const startTime = Date.now();
    const endTime = startTime + durationMs;
    
    // Set expiration in Redis
    const expirySeconds = Math.floor(durationMs / 1000);
    await this.redis.set(quarantineKey, '1', 'EX', expirySeconds);
    
    // Store quarantine record
    const record: QuarantineRecord = {
      agentId,
      reason,
      trustScore,
      startTime,
      endTime,
      isActive: true,
      adminNotes
    };
    
    // Save the quarantine record
    await this.redis.set(
      `agent:${agentId}:quarantine:record`, 
      JSON.stringify(record),
      'EX', 
      expirySeconds
    );
    
    // Add to active quarantines set
    await this.redis.sadd('global:quarantined_agents', agentId);
    
    // Record in quarantine history
    await this.redis.lpush(
      `agent:${agentId}:quarantine:history`, 
      JSON.stringify(record)
    );
    await this.redis.ltrim(`agent:${agentId}:quarantine:history`, 0, 99);
    
    // Add to global quarantine history
    await this.redis.lpush(
      'global:quarantine:history',
      JSON.stringify(record)
    );
    await this.redis.ltrim('global:quarantine:history', 0, 999);
    
    // Emit event for quarantine action
    await this.emitQuarantineEvent(agentId, reason, trustScore, startTime, endTime, adminNotes);
    
    logger.warn(`🔒 Agent ${agentId} quarantined until ${new Date(endTime).toISOString()} (${reason})`);
    
    return endTime;
  }
  
  /**
   * Check if an agent is currently in quarantine
   * @param agentId Agent identifier
   * @returns Whether the agent is quarantined
   */
  async isQuarantined(agentId: string): Promise<boolean> {
    return (await this.redis.get(`agent:${agentId}:quarantine`)) === '1';
  }
  
  /**
   * Get details about an agent's quarantine
   * @param agentId Agent identifier
   * @returns Quarantine record or null if not quarantined
   */
  async getQuarantineRecord(agentId: string): Promise<QuarantineRecord | null> {
    const recordJson = await this.redis.get(`agent:${agentId}:quarantine:record`);
    
    if (!recordJson) {
      return null;
    }
    
    try {
      return JSON.parse(recordJson) as QuarantineRecord;
    } catch (error) {
      logger.error(`Error parsing quarantine record for agent ${agentId}:`, error);
      return null;
    }
  }
  
  /**
   * Early release of an agent from quarantine (admin function)
   * @param agentId Agent identifier
   * @param adminNotes Reason for early release
   * @returns Whether the release was successful
   */
  async releaseFromQuarantine(agentId: string, adminNotes: string): Promise<boolean> {
    const quarantineKey = `agent:${agentId}:quarantine`;
    const isQuarantined = await this.isQuarantined(agentId);
    
    if (!isQuarantined) {
      return false;
    }
    
    // Get the current record to update it
    const record = await this.getQuarantineRecord(agentId);
    
    if (record) {
      // Update the record to mark as released early
      record.endTime = Date.now();
      record.isActive = false;
      record.adminNotes = (record.adminNotes || '') + 
        `\nEarly release: ${adminNotes} (${new Date().toISOString()})`;
      
      // Store the updated record in history
      await this.redis.lpush(
        `agent:${agentId}:quarantine:history`, 
        JSON.stringify(record)
      );
      
      // Update global history
      await this.redis.lpush(
        'global:quarantine:history',
        JSON.stringify({
          ...record,
          action: 'early_release'
        })
      );
    }
    
    // Remove from active quarantines set
    await this.redis.srem('global:quarantined_agents', agentId);
    
    // Delete the quarantine keys
    await this.redis.del(quarantineKey);
    await this.redis.del(`agent:${agentId}:quarantine:record`);
    
    // Emit event for quarantine release
    await this.emitQuarantineReleaseEvent(agentId, adminNotes);
    
    logger.info(`🔓 Agent ${agentId} released from quarantine: ${adminNotes}`);
    
    return true;
  }
  
  /**
   * Get list of all currently quarantined agents
   * @returns Array of agent IDs currently in quarantine
   */
  async getQuarantinedAgents(): Promise<string[]> {
    return this.redis.smembers('global:quarantined_agents');
  }
  
  /**
   * Get quarantine history for an agent
   * @param agentId Agent identifier
   * @param limit Maximum number of history entries to retrieve
   * @returns Array of quarantine records
   */
  async getQuarantineHistory(agentId: string, limit: number = 10): Promise<QuarantineRecord[]> {
    const history = await this.redis.lrange(`agent:${agentId}:quarantine:history`, 0, limit - 1);
    
    return history.map(entry => JSON.parse(entry) as QuarantineRecord);
  }
  
  /**
   * Get global quarantine history
   * @param limit Maximum number of history entries to retrieve
   * @returns Array of quarantine records
   */
  async getGlobalQuarantineHistory(limit: number = 50): Promise<QuarantineRecord[]> {
    const history = await this.redis.lrange('global:quarantine:history', 0, limit - 1);
    
    return history.map(entry => JSON.parse(entry) as QuarantineRecord);
  }
  
  /**
   * Emit an event when an agent is quarantined
   * @param agentId Agent identifier
   * @param reason Quarantine reason
   * @param trustScore Current trust score
   * @param startTime Quarantine start time
   * @param endTime Quarantine end time
   * @param adminNotes Optional admin notes
   */
  private async emitQuarantineEvent(
    agentId: string, 
    reason: QuarantineReason, 
    trustScore: number,
    startTime: number,
    endTime: number,
    adminNotes?: string
  ): Promise<void> {
    const event = JSON.stringify({
      type: 'quarantine',
      agentId,
      reason,
      trustScore,
      startTime,
      endTime,
      durationMs: endTime - startTime,
      adminNotes,
      timestamp: startTime
    });
    
    await this.redis.publish('agent:trust_enforcement', event);
  }
  
  /**
   * Emit an event when an agent is released from quarantine
   * @param agentId Agent identifier
   * @param adminNotes Release reason
   */
  private async emitQuarantineReleaseEvent(
    agentId: string,
    adminNotes: string
  ): Promise<void> {
    const event = JSON.stringify({
      type: 'quarantine_release',
      agentId,
      releaseReason: adminNotes,
      timestamp: Date.now()
    });
    
    await this.redis.publish('agent:trust_enforcement', event);
  }
} 