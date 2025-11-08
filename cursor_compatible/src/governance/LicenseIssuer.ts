/**
 * License Issuer
 * 
 * Service responsible for issuing, renewing, and revoking agent licenses.
 */

import { v4 as uuidv4 } from 'uuid';
import { AgentLicense, LicenseApplication, LicenseStatus } from '../types/agent.conduct.js';
import { getLicense } from '../config/agent_licenses.js';
import { RedisService } from '../services/infrastructure/RedisService.js';
import { EventEmitter } from '../utils/EventEmitter.js';
import logger from '../utils/logger.js';

/**
 * Configuration for the LicenseIssuer
 */
interface LicenseIssuerConfig {
  /** Redis key prefix for license data */
  keyPrefix: string;
  
  /** Default TTL for issued licenses (ms) */
  defaultTTL: number;
  
  /** Whether to require manual review for licenses */
  requireManualReview: boolean;
  
  /** How often to check for expired licenses (ms) */
  expiryCheckInterval: number;
  
  /** Whether to notify when licenses are issued, revoked, or expired */
  notifyOnChange: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: LicenseIssuerConfig = {
  keyPrefix: 'agent:license:',
  defaultTTL: 30 * 24 * 60 * 60 * 1000, // 30 days
  requireManualReview: true,
  expiryCheckInterval: 6 * 60 * 60 * 1000, // 6 hours
  notifyOnChange: true
};

/**
 * License issuer service
 */
export class LicenseIssuer {
  private redis: RedisService;
  private eventEmitter: EventEmitter;
  private config: LicenseIssuerConfig;
  private expiryCheckIntervalId?: NodeJS.Timeout;
  
  /**
   * Create a new LicenseIssuer
   * 
   * @param redis Redis service for data persistence
   * @param eventEmitter Event emitter for notifications
   * @param config Configuration options
   */
  constructor(
    redis: RedisService,
    eventEmitter: EventEmitter,
    config: Partial<LicenseIssuerConfig> = {}
  ) {
    this.redis = redis;
    this.eventEmitter = eventEmitter;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Start checking for expired licenses
    this.startExpiryCheck();
  }
  
  /**
   * Issue a license to an agent
   * 
   * @param agentId Agent to issue the license to
   * @param licenseId ID of the license to issue
   * @param issuedBy Entity issuing the license (agent ID or system)
   * @param expiry Optional custom expiry time (ms since epoch)
   * @returns The license status object
   */
  public async issueLicense(
    agentId: string,
    licenseId: string,
    issuedBy: string,
    expiry?: number
  ): Promise<LicenseStatus> {
    const licenseConfig = getLicense(licenseId);
    
    if (!licenseConfig) {
      throw new Error(`License ${licenseId} does not exist`);
    }
    
    const now = Date.now();
    const expiresAt = expiry || (licenseConfig.expiry ? now + licenseConfig.expiry : now + this.config.defaultTTL);
    
    const licenseStatus: LicenseStatus = {
      licenseId,
      active: true,
      issuedAt: now,
      updatedAt: now,
      expiresAt
    };
    
    // Store in Redis
    const key = this.getLicenseKey(agentId, licenseId);
    await this.redis.set(key, JSON.stringify(licenseStatus));
    
    // Set expiry
    if (expiresAt) {
      const ttlSeconds = Math.ceil((expiresAt - now) / 1000);
      await this.redis.expire(key, ttlSeconds);
    }
    
    // Add to agent's license list
    await this.addLicenseToAgent(agentId, licenseId);
    
    // Emit event
    if (this.config.notifyOnChange) {
      this.eventEmitter.emit('license:issued', {
        agentId,
        licenseId,
        issuedBy,
        expiresAt,
        timestamp: now
      });
    }
    
    logger.info(`Issued license ${licenseId} to agent ${agentId}`);
    return licenseStatus;
  }
  
  /**
   * Revoke a license from an agent
   * 
   * @param agentId Agent to revoke the license from
   * @param licenseId ID of the license to revoke
   * @param reason Reason for revocation
   * @param revokedBy Entity revoking the license
   * @returns Success status
   */
  public async revokeLicense(
    agentId: string,
    licenseId: string,
    reason: string,
    revokedBy: string
  ): Promise<boolean> {
    const key = this.getLicenseKey(agentId, licenseId);
    const licenseStatusJson = await this.redis.get(key);
    
    if (!licenseStatusJson) {
      logger.warn(`License ${licenseId} not found for agent ${agentId}`);
      return false;
    }
    
    const licenseStatus: LicenseStatus = JSON.parse(licenseStatusJson);
    
    if (!licenseStatus.active) {
      logger.warn(`License ${licenseId} already revoked for agent ${agentId}`);
      return true;
    }
    
    // Update status
    licenseStatus.active = false;
    licenseStatus.updatedAt = Date.now();
    licenseStatus.revocationReason = reason;
    
    // Store updated status
    await this.redis.set(key, JSON.stringify(licenseStatus));
    
    // Remove from agent's license list
    await this.removeLicenseFromAgent(agentId, licenseId);
    
    // Emit event
    if (this.config.notifyOnChange) {
      this.eventEmitter.emit('license:revoked', {
        agentId,
        licenseId,
        reason,
        revokedBy,
        timestamp: Date.now()
      });
    }
    
    logger.info(`Revoked license ${licenseId} from agent ${agentId}: ${reason}`);
    return true;
  }
  
  /**
   * Check if an agent has an active license
   * 
   * @param agentId Agent to check
   * @param licenseId License to check for
   * @returns Whether the agent has the license
   */
  public async hasLicense(agentId: string, licenseId: string): Promise<boolean> {
    const key = this.getLicenseKey(agentId, licenseId);
    const licenseStatusJson = await this.redis.get(key);
    
    if (!licenseStatusJson) {
      return false;
    }
    
    const licenseStatus: LicenseStatus = JSON.parse(licenseStatusJson);
    return licenseStatus.active && (!licenseStatus.expiresAt || licenseStatus.expiresAt > Date.now());
  }
  
  /**
   * Get an agent's license status
   * 
   * @param agentId Agent to check
   * @param licenseId License to get status for
   * @returns The license status or null if not found
   */
  public async getLicenseStatus(agentId: string, licenseId: string): Promise<LicenseStatus | null> {
    const key = this.getLicenseKey(agentId, licenseId);
    const licenseStatusJson = await this.redis.get(key);
    
    if (!licenseStatusJson) {
      return null;
    }
    
    return JSON.parse(licenseStatusJson);
  }
  
  /**
   * Get all licenses for an agent
   * 
   * @param agentId Agent to get licenses for
   * @returns Array of license statuses
   */
  public async getAgentLicenses(agentId: string): Promise<LicenseStatus[]> {
    const licenseListKey = this.getLicenseListKey(agentId);
    const licenseIds = await this.redis.smembers(licenseListKey);
    const licenses: LicenseStatus[] = [];
    
    for (const licenseId of licenseIds) {
      const status = await this.getLicenseStatus(agentId, licenseId);
      if (status) {
        licenses.push(status);
      }
    }
    
    return licenses;
  }
  
  /**
   * Submit a license application
   * 
   * @param application License application to submit
   * @returns The application with assigned ID
   */
  public async submitApplication(
    application: Omit<LicenseApplication, 'id' | 'submittedAt' | 'status'>
  ): Promise<LicenseApplication> {
    const now = Date.now();
    const id = uuidv4();
    
    const fullApplication: LicenseApplication = {
      ...application,
      id,
      submittedAt: now,
      status: this.config.requireManualReview ? 'pending' : 'approved'
    };
    
    // Store in Redis
    const key = this.getApplicationKey(id);
    await this.redis.set(key, JSON.stringify(fullApplication));
    
    // Add to pending applications list if manual review required
    if (this.config.requireManualReview) {
      await this.redis.sadd(this.getPendingApplicationsKey(), id);
    } else {
      // Auto-approve
      await this.issueLicense(
        application.agentId,
        application.licenseId,
        application.sponsorId || 'system'
      );
      
      fullApplication.status = 'approved';
      fullApplication.reviewedAt = now;
      fullApplication.reviewedBy = 'system';
      
      // Update application status
      await this.redis.set(key, JSON.stringify(fullApplication));
    }
    
    // Emit event
    this.eventEmitter.emit('license:application:submitted', {
      application: fullApplication,
      timestamp: now
    });
    
    return fullApplication;
  }
  
  /**
   * Review a license application
   * 
   * @param applicationId ID of the application to review
   * @param approved Whether the application is approved
   * @param reviewerId Entity reviewing the application
   * @param notes Optional review notes
   * @returns The updated application or null if not found
   */
  public async reviewApplication(
    applicationId: string,
    approved: boolean,
    reviewerId: string,
    notes?: string
  ): Promise<LicenseApplication | null> {
    const key = this.getApplicationKey(applicationId);
    const applicationJson = await this.redis.get(key);
    
    if (!applicationJson) {
      return null;
    }
    
    const application: LicenseApplication = JSON.parse(applicationJson);
    
    if (application.status !== 'pending' && application.status !== 'requires_review') {
      throw new Error(`Application ${applicationId} has already been reviewed`);
    }
    
    const now = Date.now();
    
    // Update application
    application.status = approved ? 'approved' : 'rejected';
    application.reviewedAt = now;
    application.reviewedBy = reviewerId;
    application.reviewNotes = notes;
    
    // Update in Redis
    await this.redis.set(key, JSON.stringify(application));
    
    // Remove from pending applications
    await this.redis.srem(this.getPendingApplicationsKey(), applicationId);
    
    // Issue license if approved
    if (approved) {
      await this.issueLicense(
        application.agentId,
        application.licenseId,
        reviewerId
      );
    }
    
    // Emit event
    this.eventEmitter.emit('license:application:reviewed', {
      application,
      approved,
      reviewerId,
      timestamp: now
    });
    
    return application;
  }
  
  /**
   * Get all pending license applications
   * 
   * @returns Array of pending applications
   */
  public async getPendingApplications(): Promise<LicenseApplication[]> {
    const pendingIds = await this.redis.smembers(this.getPendingApplicationsKey());
    const applications: LicenseApplication[] = [];
    
    for (const id of pendingIds) {
      const key = this.getApplicationKey(id);
      const applicationJson = await this.redis.get(key);
      
      if (applicationJson) {
        applications.push(JSON.parse(applicationJson));
      }
    }
    
    return applications;
  }
  
  /**
   * Check if an agent has a specific capability through any of their licenses
   * 
   * @param agentId Agent to check
   * @param capability Capability to check for
   * @returns Whether the agent has the capability
   */
  public async hasCapability(agentId: string, capability: string): Promise<boolean> {
    const licenses = await this.getAgentLicenses(agentId);
    
    for (const status of licenses) {
      if (!status.active) continue;
      if (status.expiresAt && status.expiresAt < Date.now()) continue;
      
      const licenseConfig = getLicense(status.licenseId);
      if (licenseConfig?.capabilities?.includes(capability)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Start checking for expired licenses
   */
  private startExpiryCheck(): void {
    if (this.expiryCheckIntervalId) {
      clearInterval(this.expiryCheckIntervalId);
    }
    
    this.expiryCheckIntervalId = setInterval(
      () => this.checkExpiredLicenses(),
      this.config.expiryCheckInterval
    );
    
    logger.info(`License expiry check scheduled every ${this.config.expiryCheckInterval / (60 * 60 * 1000)} hours`);
  }
  
  /**
   * Check for and handle expired licenses
   */
  private async checkExpiredLicenses(): Promise<void> {
    try {
      logger.debug('Checking for expired licenses');
      
      // Scan for license keys
      const pattern = `${this.config.keyPrefix}status:*`;
      const licenseKeys = await this.redis.keys(pattern);
      const now = Date.now();
      let expiredCount = 0;
      
      for (const key of licenseKeys) {
        const licenseStatusJson = await this.redis.get(key);
        
        if (!licenseStatusJson) continue;
        
        const licenseStatus: LicenseStatus = JSON.parse(licenseStatusJson);
        
        if (licenseStatus.active && licenseStatus.expiresAt && licenseStatus.expiresAt < now) {
          // License has expired
          expiredCount++;
          
          // Extract agent and license IDs from key
          const parts = key.split(':');
          const agentId = parts[parts.length - 2];
          const licenseId = parts[parts.length - 1];
          
          // Update status
          licenseStatus.active = false;
          licenseStatus.updatedAt = now;
          licenseStatus.revocationReason = 'License expired';
          
          // Save updated status
          await this.redis.set(key, JSON.stringify(licenseStatus));
          
          // Remove from agent's license list
          await this.removeLicenseFromAgent(agentId, licenseId);
          
          // Emit event
          if (this.config.notifyOnChange) {
            this.eventEmitter.emit('license:expired', {
              agentId,
              licenseId,
              expiryTime: licenseStatus.expiresAt,
              timestamp: now
            });
          }
        }
      }
      
      if (expiredCount > 0) {
        logger.info(`Processed ${expiredCount} expired licenses`);
      }
    } catch (error) {
      logger.error('Error checking expired licenses', error);
    }
  }
  
  /**
   * Add a license to an agent's license list
   * 
   * @param agentId Agent ID
   * @param licenseId License ID
   */
  private async addLicenseToAgent(agentId: string, licenseId: string): Promise<void> {
    const key = this.getLicenseListKey(agentId);
    await this.redis.sadd(key, licenseId);
  }
  
  /**
   * Remove a license from an agent's license list
   * 
   * @param agentId Agent ID
   * @param licenseId License ID
   */
  private async removeLicenseFromAgent(agentId: string, licenseId: string): Promise<void> {
    const key = this.getLicenseListKey(agentId);
    await this.redis.srem(key, licenseId);
  }
  
  /**
   * Get key for a license status
   * 
   * @param agentId Agent ID
   * @param licenseId License ID
   * @returns Redis key
   */
  private getLicenseKey(agentId: string, licenseId: string): string {
    return `${this.config.keyPrefix}status:${agentId}:${licenseId}`;
  }
  
  /**
   * Get key for an agent's license list
   * 
   * @param agentId Agent ID
   * @returns Redis key
   */
  private getLicenseListKey(agentId: string): string {
    return `${this.config.keyPrefix}list:${agentId}`;
  }
  
  /**
   * Get key for a license application
   * 
   * @param applicationId Application ID
   * @returns Redis key
   */
  private getApplicationKey(applicationId: string): string {
    return `${this.config.keyPrefix}application:${applicationId}`;
  }
  
  /**
   * Get key for pending applications set
   * 
   * @returns Redis key
   */
  private getPendingApplicationsKey(): string {
    return `${this.config.keyPrefix}pending_applications`;
  }
  
  /**
   * Stop the expiry check interval when service is shutting down
   */
  public dispose(): void {
    if (this.expiryCheckIntervalId) {
      clearInterval(this.expiryCheckIntervalId);
      this.expiryCheckIntervalId = undefined;
    }
  }
} 