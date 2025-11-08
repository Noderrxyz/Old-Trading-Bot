/**
 * Reward System Types
 * 
 * Centralized type definitions for the meta-reward system.
 */

import type { ReinforcementEvent } from '../ReinforcementLog.js';

/**
 * Represents a reward event in the meta-reward system
 */
export interface RewardEvent {
  id: string;
  agentId: string;
  ruleId: string;
  timestamp: number;
  points: number;
  grantedBy: string | null;  // null if system-granted
  metadata?: Record<string, any>;
  verified: boolean;
  verificationId?: string;
}

/**
 * Verification status enum
 */
export enum VerificationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected'
}

/**
 * Verification vote
 */
export interface VerificationVote {
  voterId: string;
  timestamp: number;
  approve: boolean;
  weight: number;
}

/**
 * Verification request
 */
export interface VerificationRequest {
  id: string;
  rewardEventId: string;
  status: VerificationStatus;
  requiredVotes: number;
  votes: VerificationVote[];
  expiresAt: number;
  createdAt: number;
}

/**
 * Configuration for propagating rewards through agent networks
 */
export interface PropagationConfig {
  /** Decay factor for each hop (e.g., 0.85 means next-hop reward is 85% of previous) */
  decayFactor: number;
  
  /** Maximum propagation depth (e.g., 3 hops max) */
  maxDepth: number;
  
  /** Minimum weight threshold to continue propagation */
  minWeightThreshold?: number;
  
  /** Optional prefix for propagated reward reasons */
  reasonPrefix?: string;
  
  /** Maximum propagation breadth at each level */
  maxBreadth?: number;
}

/**
 * Parameters for reward granting
 */
export interface RewardGrantParams {
  agentId: string;
  ruleId: string;
  grantedBy?: string | null;
  metadata?: Record<string, any>;
}

/**
 * Parameters for verification voting
 */
export interface VerificationVoteParams {
  verificationId: string;
  voterId: string;
  approve: boolean;
}

/**
 * Service interfaces for the reward system
 */

export interface IRewardStorage {
  storeRewardEvent(event: RewardEvent): Promise<void>;
  getRewardById(rewardId: string): Promise<RewardEvent | null>;
  getAgentRewards(agentId: string): Promise<RewardEvent[]>;
  getAgentTotalRewards(agentId: string): Promise<number>;
  updateRewardVerification(rewardId: string, verified: boolean): Promise<void>;
}

export interface IVerificationService {
  createVerificationRequest(event: RewardEvent): Promise<string>;
  getVerificationRequest(verificationId: string): Promise<VerificationRequest | null>;
  saveVerificationRequest(verification: VerificationRequest): Promise<void>;
  getPendingVerifications(): Promise<VerificationRequest[]>;
  submitVerificationVote(params: VerificationVoteParams): Promise<boolean>;
  cleanupExpiredVerifications(): Promise<void>;
}

export interface IRewardProcessor {
  processReward(event: RewardEvent): Promise<void>;
  processRewardDecay(): Promise<void>;
  processAgentDecay(agentId: string): Promise<void>;
}

export interface IRewardEligibility {
  checkAgentEligibility(agentId: string, ruleId: string, grantedBy: string | null): Promise<boolean>;
  checkGrantorEligibility(grantorId: string): Promise<boolean>;
}

export interface IRewardPropagator {
  propagate(event: ReinforcementEvent): void;
  updateConfig(config: Partial<PropagationConfig>): void;
  getConfig(): PropagationConfig;
} 