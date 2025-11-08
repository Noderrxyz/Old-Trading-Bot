/**
 * Verification Service
 * 
 * Handles verification of high-value rewards.
 */

import { type RedisClientType } from 'redis';
import Logger from '../../../utils/logger.js';
import type { 
  RewardEvent, 
  VerificationRequest, 
  VerificationStatus, 
  VerificationVoteParams,
  IVerificationService
} from './types.js';

export class VerificationService implements IVerificationService {
  private VERIFICATION_KEY = 'agent:meta:rewards:verification:';
  private logger: Logger;

  constructor(
    private redisClient: RedisClientType
  ) {
    this.logger = Logger.getInstance('VerificationService');
  }

  /**
   * Create a verification request for a high-value reward
   */
  public async createVerificationRequest(event: RewardEvent): Promise<string> {
    try {
      const verificationId = `verification_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      
      const verificationRequest: VerificationRequest = {
        id: verificationId,
        rewardEventId: event.id,
        status: 'pending' as VerificationStatus,
        requiredVotes: 3, // This should come from config
        votes: [],
        expiresAt: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
        createdAt: Date.now()
      };
      
      await this.saveVerificationRequest(verificationRequest);
      
      return verificationId;
    } catch (err) {
      this.logger.error(`Error creating verification request for reward ${event.id}:`, err);
      throw new Error(`Failed to create verification request: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Get a verification request by ID
   */
  public async getVerificationRequest(verificationId: string): Promise<VerificationRequest | null> {
    try {
      const data = await this.redisClient.hGet(this.VERIFICATION_KEY, verificationId);
      if (!data) {
        return null;
      }
      
      return JSON.parse(data) as VerificationRequest;
    } catch (err) {
      this.logger.error(`Error retrieving verification request ${verificationId}:`, err);
      return null;
    }
  }

  /**
   * Save a verification request
   */
  public async saveVerificationRequest(verification: VerificationRequest): Promise<void> {
    try {
      await this.redisClient.hSet(
        this.VERIFICATION_KEY, 
        verification.id, 
        JSON.stringify(verification)
      );
    } catch (err) {
      this.logger.error(`Error saving verification request ${verification.id}:`, err);
      throw new Error(`Failed to save verification request: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Get all pending verification requests
   */
  public async getPendingVerifications(): Promise<VerificationRequest[]> {
    try {
      const allVerifications = await this.redisClient.hGetAll(this.VERIFICATION_KEY);
      
      const pendingVerifications: VerificationRequest[] = [];
      
      for (const dataJson of Object.values(allVerifications)) {
        const verification = JSON.parse(dataJson) as VerificationRequest;
        
        if (verification.status === 'pending' && verification.expiresAt > Date.now()) {
          pendingVerifications.push(verification);
        }
      }
      
      return pendingVerifications;
    } catch (err) {
      this.logger.error('Error getting pending verifications:', err);
      return [];
    }
  }

  /**
   * Submit a verification vote
   * This is a placeholder - the actual implementation requires a RewardProcessor
   */
  public async submitVerificationVote(params: VerificationVoteParams): Promise<boolean> {
    // The full implementation requires coordination with RewardProcessor
    // This will be implemented in the RewardProcessor to avoid circular dependencies
    this.logger.warn('submitVerificationVote not fully implemented in isolation');
    return false;
  }

  /**
   * Clean up expired verification requests
   */
  public async cleanupExpiredVerifications(): Promise<void> {
    try {
      this.logger.info('Cleaning up expired verification requests');
      
      const now = Date.now();
      const allVerifications = await this.redisClient.hGetAll(this.VERIFICATION_KEY);
      
      let expiredCount = 0;
      
      for (const [id, dataJson] of Object.entries(allVerifications)) {
        const verification = JSON.parse(dataJson) as VerificationRequest;
        
        // Skip if not pending
        if (verification.status !== 'pending') continue;
        
        // Check if expired
        if (verification.expiresAt < now) {
          // Auto-reject expired verification
          verification.status = 'rejected' as VerificationStatus;
          
          // Update in Redis
          await this.redisClient.hSet(
            this.VERIFICATION_KEY,
            id,
            JSON.stringify(verification)
          );
          
          expiredCount++;
        }
      }
      
      this.logger.info(`Processed ${expiredCount} expired verification requests`);
    } catch (err) {
      this.logger.error('Error cleaning up expired verifications:', err);
      throw new Error(`Failed to clean up expired verifications: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
} 