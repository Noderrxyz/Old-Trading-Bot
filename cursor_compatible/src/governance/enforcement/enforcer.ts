/**
 * Governance Rule Enforcer
 * 
 * Enforces governance rules on agent actions to ensure compliance
 * with the Meta-Protocol ruleset defined at the system level.
 */

import { RedisClient } from '../../common/redis.js';
import { 
  GovernanceRule, 
  GovernanceActionType, 
  RuleViolation,
  EnforcementResult
} from './types.js';
import { createLogger } from '../../common/logger.js';
import { logGovernanceViolation } from './violationLog.js';

// Logger for enforcement events
const logger = createLogger('GovernanceEnforcer');

// In-memory cache for rules (refreshed periodically)
let globalRules: GovernanceRule[] = [];
let rulesLastRefreshed = 0;
const RULES_REFRESH_INTERVAL = 60 * 1000; // 1 minute

/**
 * Load governance rules from persistent storage
 * 
 * @param redisClient Redis client
 * @returns Array of governance rules
 */
export async function loadGlobalRuleset(
  redisClient: RedisClient
): Promise<GovernanceRule[]> {
  // Check if we need to refresh the rules cache
  const now = Date.now();
  if (globalRules.length > 0 && (now - rulesLastRefreshed) < RULES_REFRESH_INTERVAL) {
    return globalRules;
  }
  
  // Get all rule IDs
  const ruleIds = await redisClient.smembers('governance:rules:active');
  
  // Load each rule
  const rules: GovernanceRule[] = [];
  for (const ruleId of ruleIds) {
    const ruleData = await redisClient.get(`governance:rule:${ruleId}`);
    if (ruleData) {
      try {
        // Parse the rule data
        const rule = JSON.parse(ruleData);
        
        // Check if rule has all required properties before adding
        if (rule.id && rule.check && rule.appliesTo) {
          // Convert the check function from string to function
          if (typeof rule.check === 'string') {
            // Using Function constructor to recreate the function from string
            // This is safe in our controlled environment since we control the rule definitions
            rule.check = new Function('return ' + rule.check)();
          }
          
          rules.push(rule as GovernanceRule);
        } else {
          logger.warn(`Invalid rule format for ID ${ruleId}`);
        }
      } catch (error) {
        logger.error(`Failed to parse rule ${ruleId}: ${error}`);
      }
    }
  }
  
  // Update the rules cache
  globalRules = rules;
  rulesLastRefreshed = now;
  
  // If we don't have any rules, load the default ruleset
  if (globalRules.length === 0) {
    await loadDefaultRules(redisClient);
    return loadGlobalRuleset(redisClient);
  }
  
  logger.info(`Loaded ${rules.length} governance rules`);
  return rules;
}

/**
 * Load default governance rules if none exist
 * 
 * @param redisClient Redis client
 */
async function loadDefaultRules(redisClient: RedisClient): Promise<void> {
  // Check if we already have rules
  const hasRules = await redisClient.scard('governance:rules:active');
  if (hasRules > 0) {
    return;
  }
  
  logger.info('Loading default governance rules');
  
  // Define some default rules
  const defaultRules: Partial<GovernanceRule>[] = [
    {
      id: 'role-validator-vote',
      label: 'Only validators may vote',
      appliesTo: ['vote'],
      // We'll store the check function as string and convert it later
      check: async (agentId, actionType, context) => {
        const { getCurrentRole } = await import('../registry.js');
        const role = await getCurrentRole(agentId);
        
        if (role !== 'validator') {
          return {
            allowed: false,
            violation: {
              reason: `Only validators may vote, agent ${agentId} has role ${role}`,
              severity: 'moderate',
              code: 'INVALID_ROLE_FOR_VOTE'
            }
          };
        }
        
        return { allowed: true };
      }
    },
    {
      id: 'min-trust-score-propose',
      label: 'Minimum trust score for proposals',
      appliesTo: ['propose'],
      check: async (agentId, actionType, context) => {
        const { getAgentReputation } = await import('../registry.js');
        const reputation = await getAgentReputation(agentId);
        
        if (reputation < 0.75) {
          return {
            allowed: false,
            violation: {
              reason: `Minimum trust score of 0.75 required for proposals, agent ${agentId} has ${reputation.toFixed(2)}`,
              severity: 'moderate',
              code: 'INSUFFICIENT_TRUST_FOR_PROPOSAL'
            }
          };
        }
        
        return { allowed: true };
      }
    },
    {
      id: 'proposal-cooldown',
      label: 'No repeated proposals within cooldown',
      appliesTo: ['propose'],
      check: async (agentId, actionType, context) => {
        // Implement cooldown check
        // In a real system, this would check if the agent has made similar proposals recently
        return { allowed: true };
      }
    },
    {
      id: 'quorum-required',
      label: 'Majority quorum must be met',
      appliesTo: ['execute'],
      check: async (agentId, actionType, context) => {
        if (actionType === 'execute' && context.proposalId) {
          const { getVoteLedger, getMemberCount } = await import('../registry.js');
          const votes = await getVoteLedger(context.proposalId);
          const memberCount = await getMemberCount();
          
          if (votes.length < memberCount / 2) {
            return {
              allowed: false,
              violation: {
                reason: `Quorum not met: ${votes.length} votes out of ${memberCount} members`,
                severity: 'critical',
                code: 'QUORUM_NOT_MET',
                context: { votes: votes.length, memberCount }
              }
            };
          }
        }
        
        return { allowed: true };
      }
    },
    {
      id: 'oracle-guardian-separation',
      label: 'Oracle cannot vote on guardian-tier topics',
      appliesTo: ['vote'],
      check: async (agentId, actionType, context) => {
        if (actionType === 'vote' && context.proposalId) {
          const { getCurrentRole } = await import('../registry.js');
          const { getProposalTier } = await import('../proposalService.js');
          
          const role = await getCurrentRole(agentId);
          const tier = await getProposalTier(context.proposalId);
          
          if (role === 'oracle' && tier === 'guardian') {
            return {
              allowed: false,
              violation: {
                reason: `Oracles cannot vote on guardian-tier proposals`,
                severity: 'moderate',
                code: 'ROLE_TIER_CONFLICT'
              }
            };
          }
        }
        
        return { allowed: true };
      }
    }
  ];
  
  // Save default rules to Redis
  for (const rule of defaultRules) {
    const ruleId = rule.id!;
    
    // Convert check function to string for storage
    const ruleToStore = {
      ...rule,
      check: rule.check.toString()
    };
    
    await redisClient.set(
      `governance:rule:${ruleId}`,
      JSON.stringify(ruleToStore)
    );
    
    await redisClient.sadd('governance:rules:active', ruleId);
  }
  
  logger.info(`Added ${defaultRules.length} default governance rules`);
}

/**
 * Enforce governance rules on an action
 * 
 * @param redisClient Redis client
 * @param agentId Agent ID taking the action
 * @param actionType Type of action being performed
 * @param context Additional context for the action
 * @returns Enforcement result with allowed flag and any violations
 */
export async function enforceGovernanceRules(
  redisClient: RedisClient,
  agentId: string,
  actionType: GovernanceActionType,
  context: Record<string, any> = {}
): Promise<EnforcementResult> {
  const rules: GovernanceRule[] = await loadGlobalRuleset(redisClient);
  
  const violations: RuleViolation[] = [];
  const warnings: RuleViolation[] = [];
  
  // Filter rules that apply to this action type
  const applicableRules = rules.filter(rule => 
    rule.appliesTo.includes(actionType)
  );
  
  logger.debug(`Enforcing ${applicableRules.length} rules for ${actionType} by agent ${agentId}`);
  
  // Check each applicable rule
  for (const rule of applicableRules) {
    try {
      const result = await rule.check(agentId, actionType, context);
      
      if (!result.allowed && result.violation) {
        // Add to violations list
        violations.push(result.violation);
        
        // Log the violation
        await logGovernanceViolation(
          redisClient,
          agentId,
          result.violation.reason,
          result.violation.severity === 'critical' ? 'critical' : 'warning'
        );
      }
    } catch (error) {
      // Handle rule check errors
      logger.error(`Error checking rule ${rule.id}: ${error}`);
      
      // Add as a warning since we shouldn't block actions due to rule errors
      warnings.push({
        reason: `Rule check error for ${rule.id}: ${error}`,
        severity: 'mild',
        code: 'RULE_CHECK_ERROR'
      });
    }
  }
  
  const allowed = violations.length === 0;
  
  // Log the enforcement result
  if (!allowed) {
    logger.warn(
      `Governance block: ${actionType} by ${agentId} blocked with violations: ` +
      violations.map(v => v.reason).join('; ')
    );
  } else {
    logger.debug(`Governance check passed for ${actionType} by ${agentId}`);
  }
  
  return {
    allowed,
    violations,
    warnings,
    timestamp: Date.now()
  };
}

/**
 * Add a new governance rule to the system
 * 
 * @param redisClient Redis client
 * @param rule Rule to add
 * @returns Rule ID if successful
 */
export async function addGovernanceRule(
  redisClient: RedisClient,
  rule: Omit<GovernanceRule, 'id'>
): Promise<string> {
  // Generate a unique ID if not provided
  const ruleId = rule.id || `rule-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  
  // Create the complete rule
  const completeRule: Partial<GovernanceRule> = {
    ...rule,
    id: ruleId
  };
  
  // Convert check function to string for storage
  const ruleToStore = {
    ...completeRule,
    check: completeRule.check.toString()
  };
  
  // Store the rule
  await redisClient.set(
    `governance:rule:${ruleId}`,
    JSON.stringify(ruleToStore)
  );
  
  // Add to active rules
  await redisClient.sadd('governance:rules:active', ruleId);
  
  // Clear the rules cache to force reload
  globalRules = [];
  
  logger.info(`Added governance rule: ${ruleId} - ${rule.label}`);
  
  return ruleId;
}

/**
 * Remove a governance rule from the system
 * 
 * @param redisClient Redis client
 * @param ruleId ID of the rule to remove
 * @returns Whether the rule was successfully removed
 */
export async function removeGovernanceRule(
  redisClient: RedisClient,
  ruleId: string
): Promise<boolean> {
  // Remove from active rules
  const result = await redisClient.srem('governance:rules:active', ruleId);
  
  // Clear the rules cache to force reload
  globalRules = [];
  
  if (result > 0) {
    logger.info(`Removed governance rule: ${ruleId}`);
    return true;
  }
  
  return false;
} 