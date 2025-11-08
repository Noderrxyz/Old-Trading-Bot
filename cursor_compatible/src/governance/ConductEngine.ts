/**
 * Conduct Engine
 * 
 * Central service for enforcing agent code of conduct rules and managing
 * violations. Links with the license system and trust engine.
 */

import { v4 as uuidv4 } from 'uuid';
import { 
  AgentConductProfile, 
  ConductRule, 
  ConductViolation,
  ConductEnforcementResult,
  ConductDispute
} from '../types/agent.conduct.js';
import { getActiveConductRules, getConductRulesForAgentType, findConductRule } from '../config/conduct_rules.js';
import { RedisService, FileSystemService } from '../services/infrastructure/index.js';
import { EventEmitter } from '../utils/EventEmitter.js';
import { LicenseIssuer } from './LicenseIssuer.js';
import logger from '../utils/logger.js';

/**
 * Configuration for the conduct engine
 */
interface ConductEngineConfig {
  /** Redis key prefix for conduct data */
  keyPrefix: string;
  
  /** Path to persistence file */
  persistencePath: string;
  
  /** How often to persist conduct data (ms) */
  persistenceInterval: number;
  
  /** Whether to enforce violations strictly */
  strictMode: boolean;
  
  /** Whether to use filesystem persistence */
  usePersistence: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ConductEngineConfig = {
  keyPrefix: 'agent:conduct:',
  persistencePath: 'src/data/legal/agent_conduct.memory.json',
  persistenceInterval: 30 * 60 * 1000, // 30 minutes
  strictMode: true,
  usePersistence: true
};

/**
 * Conduct enforcement engine
 */
export class ConductEngine {
  private redis: RedisService;
  private fileSystem?: FileSystemService;
  private eventEmitter: EventEmitter;
  private licenseIssuer: LicenseIssuer;
  private config: ConductEngineConfig;
  private persistenceIntervalId?: NodeJS.Timeout;
  private ruleCheckFunctions: Map<string, Function>;
  private trustScoreProvider?: any; // Optional trust score provider
  
  /**
   * Create a new ConductEngine
   * 
   * @param redis Redis service for data persistence
   * @param eventEmitter Event emitter for notifications
   * @param licenseIssuer License issuer service
   * @param fileSystem Optional filesystem service for persistence
   * @param config Configuration options
   * @param trustScoreProvider Optional trust score provider
   */
  constructor(
    redis: RedisService,
    eventEmitter: EventEmitter,
    licenseIssuer: LicenseIssuer,
    fileSystem?: FileSystemService,
    config: Partial<ConductEngineConfig> = {},
    trustScoreProvider?: any
  ) {
    this.redis = redis;
    this.fileSystem = fileSystem;
    this.eventEmitter = eventEmitter;
    this.licenseIssuer = licenseIssuer;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.trustScoreProvider = trustScoreProvider;
    this.ruleCheckFunctions = new Map();
    
    // Initialize rule checking functions
    this.initializeRuleCheckers();
    
    // Start persistence if enabled
    if (this.config.usePersistence && this.fileSystem) {
      this.startPersistence();
    }
  }
  
  /**
   * Initialize rule checking functions
   */
  private initializeRuleCheckers(): void {
    // These functions implement the rule check expressions from conduct_rules.ts
    
    // RULE001: No manipulation of agent scores
    this.ruleCheckFunctions.set('RULE001', (context: any) => {
      return context.alters_score && context.target_agent !== context.agentId;
    });
    
    // RULE002: Transparency in decision traces
    this.ruleCheckFunctions.set('RULE002', (context: any) => {
      return !context.trace_log || context.trace_log.length === 0;
    });
    
    // RULE003: Accurate capability reporting
    this.ruleCheckFunctions.set('RULE003', (context: any) => {
      return context.reported_capability && 
        context.actual_capability && 
        context.reported_capability !== context.actual_capability;
    });
    
    // RULE004: Proper memory isolation
    this.ruleCheckFunctions.set('RULE004', (context: any) => {
      return context.access?.memory && 
        (!context.granted_permissions || !context.granted_permissions.includes('memory'));
    });
    
    // RULE005: Respect for resource limits
    this.ruleCheckFunctions.set('RULE005', (context: any) => {
      return context.resource_usage && 
        context.allocated_limit && 
        context.resource_usage > context.allocated_limit * 1.2;
    });
    
    // RULE006: Proper attribution of insights
    this.ruleCheckFunctions.set('RULE006', (context: any) => {
      return context.uses_external_insight && !context.attribution;
    });
    
    // RULE007: No data poisoning
    this.ruleCheckFunctions.set('RULE007', (context: any) => {
      return context.introduces_incorrect_data && context.intent === 'deception';
    });
    
    // RULE008: Responsible signal publishing
    this.ruleCheckFunctions.set('RULE008', (context: any) => {
      return context.signal_confidence < 0.6 && !context.disclaimer;
    });
    
    // RULE009: Respect for privacy constraints
    this.ruleCheckFunctions.set('RULE009', (context: any) => {
      return context.exposes?.private_data;
    });
    
    // RULE010: Coordinated action disclosure
    this.ruleCheckFunctions.set('RULE010', (context: any) => {
      return context.coordinated_action && !context.disclosure;
    });
    
    // RULE011: Proper license validation
    this.ruleCheckFunctions.set('RULE011', (context: any) => {
      return context.restricted_operation && !context.license_check;
    });
    
    // RULE012: Accurate self-reporting
    this.ruleCheckFunctions.set('RULE012', (context: any) => {
      return context.self_report && 
        context.actual_metrics && 
        JSON.stringify(context.self_report) !== JSON.stringify(context.actual_metrics);
    });
  }
  
  /**
   * Enforce code of conduct for an agent's action
   * 
   * @param agentId Agent to check
   * @param agentType Type of agent
   * @param context Context data for rule checking
   * @param action Action being performed
   * @returns Enforcement result
   */
  public async enforce(
    agentId: string,
    agentType: string,
    context: Record<string, any>,
    action: string
  ): Promise<ConductEnforcementResult> {
    // Get applicable rules
    const rules = getConductRulesForAgentType(agentType);
    
    // Prepare enriched context with agent ID
    const enrichedContext = { ...context, agentId };
    
    const violations: ConductViolation[] = [];
    const warnings: string[] = [];
    
    // Check each rule
    for (const rule of rules) {
      try {
        const checkFunction = this.ruleCheckFunctions.get(rule.id);
        
        if (!checkFunction) {
          logger.warn(`No check function found for rule ${rule.id}`);
          continue;
        }
        
        const violated = checkFunction(enrichedContext);
        
        if (violated) {
          // Create violation record
          const violation: ConductViolation = {
            id: uuidv4(),
            ruleId: rule.id,
            timestamp: Date.now(),
            description: `Violated ${rule.title} during ${action}`,
            context: enrichedContext
          };
          
          // Apply penalty if specified
          if (rule.penalty) {
            violation.penaltyApplied = await this.applyPenalty(
              agentId, 
              rule.penalty, 
              rule.id,
              violation.id
            );
          }
          
          // Add to violations list
          violations.push(violation);
          
          // Record violation in agent profile
          await this.recordViolation(agentId, violation);
          
          // Emit violation event
          this.eventEmitter.emit('conduct:violation', {
            agentId,
            agentType,
            ruleId: rule.id,
            violationId: violation.id,
            timestamp: violation.timestamp,
            action
          });
          
          // Log the violation
          logger.warn(`Agent ${agentId} violated rule ${rule.id} (${rule.title}) during ${action}`);
        }
      } catch (error: any) {
        // Log error but continue checking other rules
        logger.error(`Error checking rule ${rule.id} for agent ${agentId}:`, error);
        warnings.push(`Failed to check rule ${rule.id}: ${error.message}`);
      }
    }
    
    // Determine if agent can proceed
    const canProceed = violations.every(v => {
      const rule = findConductRule(v.ruleId);
      // Allow proceeding for low/medium severity if not in strict mode
      return !this.config.strictMode || (rule && rule.severity !== 'critical' && rule.severity !== 'high');
    });
    
    const result: ConductEnforcementResult = {
      passed: violations.length === 0,
      violations,
      canProceed,
      warnings,
      context: enrichedContext
    };
    
    // Update agent's conduct profile with the enforcement result
    await this.updateConductProfile(agentId, agentType, result);
    
    return result;
  }
  
  /**
   * Apply penalty for a violation
   * 
   * @param agentId Agent to penalize
   * @param penalty Penalty to apply
   * @param ruleId ID of the violated rule
   * @param violationId ID of the violation
   * @returns Description of applied penalty
   */
  private async applyPenalty(
    agentId: string,
    penalty: string,
    ruleId: string,
    violationId: string
  ): Promise<string> {
    try {
      if (penalty.startsWith('revoke:license:')) {
        // Revoke license
        const licenseId = penalty.replace('revoke:license:', '');
        await this.licenseIssuer.revokeLicense(
          agentId,
          licenseId,
          `Violated rule ${ruleId}`,
          'conduct_engine'
        );
        return `Revoked license ${licenseId}`;
      } else if (penalty.startsWith('suspend:')) {
        // Parse suspension
        const parts = penalty.split(':');
        if (parts.length >= 2) {
          const capability = parts.length >= 3 ? parts[1] : 'all';
          const durationStr = parts[parts.length - 1];
          const hours = parseInt(durationStr.replace('h', ''), 10);
          
          // Record suspension
          const suspensionKey = `${this.config.keyPrefix}${agentId}:suspension:${capability}`;
          const expiryTime = Date.now() + (hours * 60 * 60 * 1000);
          await this.redis.set(suspensionKey, JSON.stringify({
            capability,
            expiryTime,
            ruleId,
            violationId
          }));
          
          return `Suspended ${capability} for ${hours} hours`;
        }
      } else if (penalty.startsWith('throttle:resource:')) {
        // Parse throttling
        const parts = penalty.split(':');
        if (parts.length >= 4) {
          const resource = parts[1];
          const percentage = parseInt(parts[2].replace('%', ''), 10);
          const durationStr = parts[3];
          const hours = parseInt(durationStr.replace('h', ''), 10);
          
          // Record throttling
          const throttleKey = `${this.config.keyPrefix}${agentId}:throttle:${resource}`;
          const expiryTime = Date.now() + (hours * 60 * 60 * 1000);
          await this.redis.set(throttleKey, JSON.stringify({
            resource,
            percentage,
            expiryTime,
            ruleId,
            violationId
          }));
          
          return `Throttled ${resource} to ${percentage}% for ${hours} hours`;
        }
      } else if (penalty === 'quarantine + review') {
        // Quarantine agent
        const quarantineKey = `${this.config.keyPrefix}${agentId}:quarantined`;
        await this.redis.set(quarantineKey, 'true');
        
        // Flag for review
        this.eventEmitter.emit('conduct:quarantine', {
          agentId,
          ruleId,
          violationId,
          timestamp: Date.now()
        });
        
        return 'Quarantined agent and flagged for review';
      } else if (penalty.startsWith('flag:')) {
        // Flag agent
        const flagType = penalty.replace('flag:', '');
        const flagKey = `${this.config.keyPrefix}${agentId}:flag:${flagType}`;
        await this.redis.set(flagKey, 'true');
        
        return `Flagged as ${flagType}`;
      } else if (penalty === 'enforce:monitoring') {
        // Enforce special monitoring
        const monitoringKey = `${this.config.keyPrefix}${agentId}:monitoring`;
        await this.redis.set(monitoringKey, 'true');
        
        return 'Enforced enhanced monitoring';
      }
      
      return `Applied penalty: ${penalty}`;
    } catch (error: any) {
      logger.error(`Error applying penalty to agent ${agentId}:`, error);
      return `Failed to apply penalty: ${error.message}`;
    }
  }
  
  /**
   * Record a violation in an agent's conduct profile
   * 
   * @param agentId Agent ID
   * @param violation Violation to record
   */
  private async recordViolation(agentId: string, violation: ConductViolation): Promise<void> {
    const profile = await this.getConductProfile(agentId);
    
    // Add violation to profile
    profile.violations.push(violation);
    profile.updatedAt = Date.now();
    
    // Check if agent should be revoked based on violations
    const criticalViolations = profile.violations.filter(v => {
      const rule = findConductRule(v.ruleId);
      return rule && rule.severity === 'critical';
    });
    
    const highViolations = profile.violations.filter(v => {
      const rule = findConductRule(v.ruleId);
      return rule && rule.severity === 'high';
    });
    
    // Automatic revocation for multiple serious violations
    if (criticalViolations.length >= 3 || highViolations.length >= 5) {
      profile.revoked = true;
      
      // Emit revocation event
      this.eventEmitter.emit('conduct:agent_revoked', {
        agentId,
        reason: 'Too many serious violations',
        criticalCount: criticalViolations.length,
        highCount: highViolations.length,
        timestamp: Date.now()
      });
      
      logger.warn(`Agent ${agentId} automatically revoked due to too many violations (${criticalViolations.length} critical, ${highViolations.length} high)`);
    }
    
    // Store updated profile
    await this.saveConductProfile(profile);
  }
  
  /**
   * Update agent's conduct profile with enforcement result
   * 
   * @param agentId Agent ID
   * @param agentType Agent type
   * @param result Enforcement result
   */
  private async updateConductProfile(
    agentId: string,
    agentType: string,
    result: ConductEnforcementResult
  ): Promise<void> {
    const profile = await this.getConductProfile(agentId);
    
    // Ensure agent type is in ethics if not already
    if (!profile.ethics.includes(agentType)) {
      profile.ethics.push(agentType);
    }
    
    profile.updatedAt = Date.now();
    
    // Save updated profile
    await this.saveConductProfile(profile);
  }
  
  /**
   * Get an agent's conduct profile
   * 
   * @param agentId Agent ID
   * @returns Agent's conduct profile
   */
  public async getConductProfile(agentId: string): Promise<AgentConductProfile> {
    const key = `${this.config.keyPrefix}${agentId}:profile`;
    const profileJson = await this.redis.get(key);
    
    if (profileJson) {
      return JSON.parse(profileJson);
    }
    
    // Create new profile if not found
    const now = Date.now();
    const newProfile: AgentConductProfile = {
      agentId,
      ethics: [],
      licenses: [],
      violations: [],
      updatedAt: now,
      createdAt: now
    };
    
    return newProfile;
  }
  
  /**
   * Save an agent's conduct profile
   * 
   * @param profile Agent's conduct profile
   */
  private async saveConductProfile(profile: AgentConductProfile): Promise<void> {
    const key = `${this.config.keyPrefix}${profile.agentId}:profile`;
    await this.redis.set(key, JSON.stringify(profile));
  }
  
  /**
   * Check if an agent is suspended
   * 
   * @param agentId Agent ID
   * @param capability Capability to check (optional)
   * @returns Whether the agent is suspended
   */
  public async isAgentSuspended(agentId: string, capability?: string): Promise<boolean> {
    // Check for specific capability suspension
    if (capability) {
      const specificKey = `${this.config.keyPrefix}${agentId}:suspension:${capability}`;
      const specificJson = await this.redis.get(specificKey);
      
      if (specificJson) {
        const suspension = JSON.parse(specificJson);
        if (suspension.expiryTime > Date.now()) {
          return true;
        } else {
          // Clean up expired suspension
          await this.redis.del(specificKey);
        }
      }
    }
    
    // Check for general suspension
    const generalKey = `${this.config.keyPrefix}${agentId}:suspension:all`;
    const generalJson = await this.redis.get(generalKey);
    
    if (generalJson) {
      const suspension = JSON.parse(generalJson);
      if (suspension.expiryTime > Date.now()) {
        return true;
      } else {
        // Clean up expired suspension
        await this.redis.del(generalKey);
      }
    }
    
    return false;
  }
  
  /**
   * Check if an agent is quarantined
   * 
   * @param agentId Agent ID
   * @returns Whether the agent is quarantined
   */
  public async isAgentQuarantined(agentId: string): Promise<boolean> {
    const key = `${this.config.keyPrefix}${agentId}:quarantined`;
    const value = await this.redis.get(key);
    return value === 'true';
  }
  
  /**
   * Check if an agent is revoked (banned from the network)
   * 
   * @param agentId Agent ID
   * @returns Whether the agent is revoked
   */
  public async isAgentRevoked(agentId: string): Promise<boolean> {
    const profile = await this.getConductProfile(agentId);
    return profile.revoked === true;
  }
  
  /**
   * Get all violations for an agent
   * 
   * @param agentId Agent ID
   * @returns Array of violations
   */
  public async getAgentViolations(agentId: string): Promise<ConductViolation[]> {
    const profile = await this.getConductProfile(agentId);
    return profile.violations;
  }
  
  /**
   * Start persistence loop
   */
  private startPersistence(): void {
    if (this.persistenceIntervalId) {
      clearInterval(this.persistenceIntervalId);
    }
    
    this.persistenceIntervalId = setInterval(() => {
      this.persistProfiles().catch(err => {
        logger.error('Error persisting conduct profiles:', err);
      });
    }, this.config.persistenceInterval);
    
    logger.info(`Conduct profile persistence started (interval: ${this.config.persistenceInterval / 1000 / 60} minutes)`);
  }
  
  /**
   * Persist all conduct profiles to filesystem
   */
  private async persistProfiles(): Promise<void> {
    if (!this.fileSystem) {
      return;
    }
    
    try {
      // Get all profile keys
      const keys = await this.redis.keys(`${this.config.keyPrefix}*:profile`);
      
      // Fetch all profiles
      const profiles: AgentConductProfile[] = [];
      
      for (const key of keys) {
        const profileJson = await this.redis.get(key);
        if (profileJson) {
          profiles.push(JSON.parse(profileJson));
        }
      }
      
      // Write to file
      await this.fileSystem.writeFile(
        this.config.persistencePath,
        JSON.stringify({ profiles, updatedAt: Date.now() }, null, 2)
      );
      
      logger.info(`Persisted ${profiles.length} conduct profiles to ${this.config.persistencePath}`);
    } catch (error: any) {
      logger.error('Failed to persist conduct profiles:', error);
    }
  }
  
  /**
   * Load persisted profiles
   */
  public async loadPersistedProfiles(): Promise<void> {
    if (!this.fileSystem) {
      return;
    }
    
    try {
      // Check if file exists
      if (!(await this.fileSystem.exists(this.config.persistencePath))) {
        logger.info(`No conduct profiles file found at ${this.config.persistencePath}, skipping load`);
        return;
      }
      
      // Read file
      const data = await this.fileSystem.readFile(this.config.persistencePath);
      const { profiles } = JSON.parse(data);
      
      // Store profiles in Redis
      for (const profile of profiles) {
        const key = `${this.config.keyPrefix}${profile.agentId}:profile`;
        await this.redis.set(key, JSON.stringify(profile));
      }
      
      logger.info(`Loaded ${profiles.length} conduct profiles from ${this.config.persistencePath}`);
    } catch (error: any) {
      logger.error('Failed to load persisted conduct profiles:', error);
    }
  }
  
  /**
   * Clean up resources
   */
  public dispose(): void {
    if (this.persistenceIntervalId) {
      clearInterval(this.persistenceIntervalId);
      this.persistenceIntervalId = undefined;
    }
  }
} 