/**
 * Agent Governance Module
 * 
 * This module exposes the agent governance system functionality,
 * including role management, delegation, and permissions.
 */

import { RedisClient } from '../../common/redis.js';
import { GovernanceService } from './service.js';

export * from './models.js';
export * from './service.js';

/**
 * Create a governance service with the provided Redis client
 * @param redis Redis client
 * @returns GovernanceService instance
 */
export function createGovernanceService(redis: RedisClient): GovernanceService {
  return new GovernanceService(redis);
} 