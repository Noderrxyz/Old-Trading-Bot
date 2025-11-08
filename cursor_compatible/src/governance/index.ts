/**
 * Governance Module
 * 
 * Exports governance-related functionality including role weighting,
 * voting, and proposal management.
 */

// Export types and functions from voteWeighting
export {
  ROLE_WEIGHTS,
  VoteOption,
  AgentVoteRecord,
  VoteSummary,
  computeWeightedScore,
  castVote,
  getVoteStatus,
  updateVoteTally,
  hasRequiredWeight,
  hasRequiredRole
} from './voteWeighting.js';

// Export types and classes from proposalService
export {
  ProposalType,
  Proposal,
  ProposalService
} from './proposalService.js';

// Export quorum enforcement functionality
export {
  QuorumConfig,
  QuorumCheckResult,
  enforceQuorum,
  checkQuorum,
  getQuorumConfig,
  setQuorumConfig,
  ensureDefaultQuorumConfig,
  getQuorumCheckResult
} from './quorumEnforcement.js';

// Export the conduct enforcement and licensing system
export {
  ConductEngine
} from './ConductEngine.js';

export {
  AgentCourt
} from './AgentCourt.js';

export {
  LicenseGate,
  UnauthorizedAgentError
} from './LicenseGate.js';

export {
  LicenseIssuer
} from './LicenseIssuer.js';

// Export types from agent.conduct.ts
export {
  DisputeVote,
  AgentConductProfile,
  ConductViolation,
  ConductEnforcementResult,
  ConductDispute
} from '../types/agent.conduct.js';

// Export singleton instance factory
import { RedisClient } from '../common/redis.js';
import { ProposalService } from './proposalService.js';
import { ConductEngine } from './ConductEngine.js';
import { AgentCourt } from './AgentCourt.js';
import { LicenseIssuer } from './LicenseIssuer.js';
import { RedisService, FileSystemService } from '../services/infrastructure/index.js';
import { EventEmitter } from '../utils/EventEmitter.js';
import { initializeShadowCabinet } from './shadow/index.js';

// Create singleton instances
let proposalService: ProposalService | null = null;
let isShadowEnabled: boolean = false;

/**
 * Initialize the governance system
 */
export async function initializeGovernance(
  redisClient: RedisClient,
  options = { enableShadowCabinet: false }
): Promise<void> {
  // Initialize proposal service
  proposalService = new ProposalService(redisClient);
  
  // Initialize shadow cabinet if enabled
  if (options.enableShadowCabinet) {
    proposalService.enableShadowCabinet(true);
    const shadowModules = initializeShadowCabinet(proposalService);
    isShadowEnabled = true;
    
    console.log('Shadow Cabinet system initialized');
  }
  
  console.log('Governance system initialized');
}

/**
 * Get the proposal service instance
 */
export function getProposalService(): ProposalService {
  if (!proposalService) {
    throw new Error('Governance system not initialized');
  }
  return proposalService;
}

/**
 * Check if the shadow cabinet system is enabled
 */
export function isShadowCabinetEnabled(): boolean {
  return isShadowEnabled;
}

/**
 * Get or create a ProposalService instance
 * 
 * @param redisClient Redis client
 * @returns ProposalService instance
 */
export function getProposalServiceInstance(redisClient: RedisClient): ProposalService {
  return new ProposalService(redisClient);
}

/**
 * Get or create a ConductEngine instance
 * 
 * @param redis Redis service
 * @param eventEmitter Event emitter
 * @param licenseIssuer License issuer service
 * @param fileSystem Optional file system service
 * @param config Optional configuration
 * @param trustScoreProvider Optional trust score provider
 * @returns ConductEngine instance
 */
export function getConductEngine(
  redis: RedisService,
  eventEmitter: EventEmitter,
  licenseIssuer: LicenseIssuer,
  fileSystem?: FileSystemService,
  config?: any,
  trustScoreProvider?: any
): ConductEngine {
  return new ConductEngine(
    redis,
    eventEmitter,
    licenseIssuer,
    fileSystem,
    config,
    trustScoreProvider
  );
}

/**
 * Get or create an AgentCourt instance
 * 
 * @param redis Redis service
 * @param eventEmitter Event emitter
 * @param conductEngine Conduct engine
 * @param fileSystem Optional file system service
 * @param config Optional configuration
 * @param trustScoreProvider Optional trust score provider
 * @returns AgentCourt instance
 */
export function getAgentCourt(
  redis: RedisService,
  eventEmitter: EventEmitter,
  conductEngine: ConductEngine,
  fileSystem?: FileSystemService,
  config?: any,
  trustScoreProvider?: any
): AgentCourt {
  return new AgentCourt(
    redis,
    eventEmitter,
    conductEngine,
    fileSystem,
    config,
    trustScoreProvider
  );
}

/**
 * Apply weighted role-based permissions to a function
 * 
 * @param redisClient Redis client
 * @param agentId Agent ID
 * @param requiredRole Minimum role required
 * @param action Function to execute if permission check passes
 * @param errorMessage Custom error message (optional)
 * @returns Promise resolving to the action result
 */
export async function withRolePermission<T>(
  redisClient: RedisClient,
  agentId: string,
  requiredRole: string,
  action: () => Promise<T>,
  errorMessage?: string
): Promise<T> {
  const { hasRequiredRole } = await import('./voteWeighting.js');
  
  const hasPermission = await hasRequiredRole(
    redisClient,
    agentId,
    requiredRole
  );
  
  if (!hasPermission) {
    throw new Error(
      errorMessage || 
      `Agent ${agentId} does not have required role ${requiredRole}`
    );
  }
  
  return action();
}

/**
 * Apply weighted score-based permissions to a function
 * 
 * @param redisClient Redis client
 * @param agentId Agent ID
 * @param requiredScore Minimum weighted score required
 * @param action Function to execute if permission check passes
 * @param errorMessage Custom error message (optional)
 * @returns Promise resolving to the action result
 */
export async function withWeightPermission<T>(
  redisClient: RedisClient,
  agentId: string,
  requiredScore: number,
  action: () => Promise<T>,
  errorMessage?: string
): Promise<T> {
  const { hasRequiredWeight } = await import('./voteWeighting.js');
  
  const hasPermission = await hasRequiredWeight(
    redisClient,
    agentId,
    requiredScore
  );
  
  if (!hasPermission) {
    throw new Error(
      errorMessage || 
      `Agent ${agentId} does not have required weighted score ${requiredScore}`
    );
  }
  
  return action();
}

/**
 * Apply license-based permissions to a function
 * 
 * @param licenseGate License gate
 * @param agentId Agent ID
 * @param requiredLicense License required
 * @param action Function to execute if permission check passes
 * @returns Promise resolving to the action result
 */
export async function withLicensePermission<T>(
  licenseGate: any,
  agentId: string,
  requiredLicense: string,
  action: () => Promise<T>
): Promise<T> {
  await licenseGate.ensure(agentId, requiredLicense);
  return action();
}

// Re-export modules
export * from './proposalService.js';
export * from './voteWeighting.js';
export * from './arbitrationEngine.js';

// Re-export shadow cabinet if enabled
if (isShadowEnabled) {
  export * from './shadow/index.js';
} 