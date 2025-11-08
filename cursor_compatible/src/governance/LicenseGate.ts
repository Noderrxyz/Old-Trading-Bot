/**
 * License Gate
 * 
 * Service for validating agent licenses before performing restricted operations.
 * Acts as a gatekeeper for agent capabilities based on licenses.
 */

import { LicenseIssuer } from './LicenseIssuer.js';
import { getLicense } from '../config/agent_licenses.js';
import logger from '../utils/logger.js';

/**
 * Error thrown when an agent tries to perform an operation without required license
 */
export class UnauthorizedAgentError extends Error {
  agentId: string;
  requiredLicense: string;
  
  constructor(agentId: string, requiredLicense: string) {
    super(`Agent ${agentId} does not have required license: ${requiredLicense}`);
    this.name = 'UnauthorizedAgentError';
    this.agentId = agentId;
    this.requiredLicense = requiredLicense;
  }
}

/**
 * Configuration for the license gate
 */
interface LicenseGateConfig {
  /** Whether to throw errors or just log warnings */
  enforceStrict: boolean;
  
  /** Whether to check capabilities in addition to license IDs */
  checkCapabilities: boolean;
  
  /** Fallback behavior for emergency situations */
  fallbackMode: 'allow' | 'deny' | 'log-only';
  
  /** Whether to validate trust score requirements */
  validateTrustRequirements: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: LicenseGateConfig = {
  enforceStrict: true,
  checkCapabilities: true,
  fallbackMode: 'deny',
  validateTrustRequirements: true
};

/**
 * License gate service
 */
export class LicenseGate {
  private licenseIssuer: LicenseIssuer;
  private config: LicenseGateConfig;
  private trustScoreProvider?: any; // Optional trust score provider
  
  /**
   * Create a new LicenseGate
   * 
   * @param licenseIssuer License issuer service
   * @param config Configuration options
   * @param trustScoreProvider Optional trust score provider
   */
  constructor(
    licenseIssuer: LicenseIssuer,
    config: Partial<LicenseGateConfig> = {},
    trustScoreProvider?: any
  ) {
    this.licenseIssuer = licenseIssuer;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.trustScoreProvider = trustScoreProvider;
  }
  
  /**
   * Check if an agent has a specific license
   * 
   * @param agentId Agent to check
   * @param licenseId License to check for
   * @returns Whether the agent has the license
   * @throws UnauthorizedAgentError if strict mode is enabled and agent doesn't have license
   */
  public async has(agentId: string, licenseId: string): Promise<boolean> {
    try {
      const hasLicense = await this.licenseIssuer.hasLicense(agentId, licenseId);
      
      if (!hasLicense && this.config.enforceStrict) {
        throw new UnauthorizedAgentError(agentId, licenseId);
      }
      
      if (!hasLicense) {
        logger.warn(`Agent ${agentId} attempted to use license ${licenseId} without authorization`);
      }
      
      return hasLicense;
    } catch (error) {
      if (error instanceof UnauthorizedAgentError) {
        throw error;
      }
      
      logger.error(`Error checking license for agent ${agentId}:`, error);
      
      // Handle error case based on fallback mode
      switch (this.config.fallbackMode) {
        case 'allow':
          logger.warn(`Fallback allowing agent ${agentId} to use license ${licenseId} due to error`);
          return true;
        case 'log-only':
          logger.warn(`Agent ${agentId} license check failed, but allowed in log-only mode`);
          return true;
        case 'deny':
        default:
          return false;
      }
    }
  }
  
  /**
   * Check if an agent has a specific capability through any license
   * 
   * @param agentId Agent to check
   * @param capability Capability to check for
   * @returns Whether the agent has the capability
   * @throws UnauthorizedAgentError if strict mode is enabled and agent doesn't have capability
   */
  public async hasCapability(agentId: string, capability: string): Promise<boolean> {
    if (!this.config.checkCapabilities) {
      logger.warn(`Capability checking disabled, skipping check for ${capability}`);
      return true;
    }
    
    try {
      const hasCapability = await this.licenseIssuer.hasCapability(agentId, capability);
      
      if (!hasCapability && this.config.enforceStrict) {
        throw new UnauthorizedAgentError(agentId, `capability:${capability}`);
      }
      
      if (!hasCapability) {
        logger.warn(`Agent ${agentId} attempted to use capability ${capability} without authorization`);
      }
      
      return hasCapability;
    } catch (error) {
      if (error instanceof UnauthorizedAgentError) {
        throw error;
      }
      
      logger.error(`Error checking capability for agent ${agentId}:`, error);
      
      // Handle error case based on fallback mode
      switch (this.config.fallbackMode) {
        case 'allow':
          logger.warn(`Fallback allowing agent ${agentId} to use capability ${capability} due to error`);
          return true;
        case 'log-only':
          logger.warn(`Agent ${agentId} capability check failed, but allowed in log-only mode`);
          return true;
        case 'deny':
        default:
          return false;
      }
    }
  }
  
  /**
   * Ensure an agent has a license, throwing error if not
   * 
   * @param agentId Agent to check
   * @param licenseId License to check for
   * @throws UnauthorizedAgentError if agent doesn't have the license
   */
  public async ensure(agentId: string, licenseId: string): Promise<void> {
    const hasLicense = await this.has(agentId, licenseId);
    
    if (!hasLicense) {
      throw new UnauthorizedAgentError(agentId, licenseId);
    }
  }
  
  /**
   * Ensure an agent has a capability, throwing error if not
   * 
   * @param agentId Agent to check
   * @param capability Capability to check for
   * @throws UnauthorizedAgentError if agent doesn't have the capability
   */
  public async ensureCapability(agentId: string, capability: string): Promise<void> {
    const hasCapability = await this.hasCapability(agentId, capability);
    
    if (!hasCapability) {
      throw new UnauthorizedAgentError(agentId, `capability:${capability}`);
    }
  }
  
  /**
   * Check for trust score requirements for a specific license
   * 
   * @param agentId Agent to check
   * @param licenseId License to check for
   * @returns Whether the agent meets the trust score requirement
   */
  public async meetsTrustRequirements(agentId: string, licenseId: string): Promise<boolean> {
    if (!this.config.validateTrustRequirements || !this.trustScoreProvider) {
      // Skip if validation disabled or no provider
      return true;
    }
    
    try {
      const license = getLicense(licenseId);
      
      if (!license) {
        logger.warn(`License ${licenseId} does not exist`);
        return false;
      }
      
      // Find trust score requirement if any
      const trustRequirement = license.requirements.find(req => req.startsWith('trustScore >='));
      
      if (!trustRequirement) {
        // No trust score requirement
        return true;
      }
      
      // Extract required score
      const requiredScore = parseFloat(trustRequirement.replace('trustScore >=', '').trim());
      
      // Get actual trust score
      const actualScore = await this.trustScoreProvider.getAgentTrustScore(agentId);
      
      const meetsRequirement = actualScore >= requiredScore;
      
      if (!meetsRequirement) {
        logger.warn(`Agent ${agentId} trust score (${actualScore}) does not meet requirement (${requiredScore}) for license ${licenseId}`);
      }
      
      return meetsRequirement;
    } catch (error) {
      logger.error(`Error checking trust requirements for agent ${agentId}:`, error);
      return false;
    }
  }
  
  /**
   * Create a guard function that ensures an agent has a license
   * 
   * @param licenseId License to check for
   * @returns A function that ensures the agent has the license
   */
  public createGuard(licenseId: string): (agentId: string) => Promise<void> {
    return async (agentId: string) => {
      await this.ensure(agentId, licenseId);
    };
  }
  
  /**
   * Create a guard function that ensures an agent has a capability
   * 
   * @param capability Capability to check for
   * @returns A function that ensures the agent has the capability
   */
  public createCapabilityGuard(capability: string): (agentId: string) => Promise<void> {
    return async (agentId: string) => {
      await this.ensureCapability(agentId, capability);
    };
  }
} 