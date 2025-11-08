/**
 * Agent Code of Conduct Rules
 * 
 * Defines the rules that agents must follow to maintain good standing
 * in the ecosystem.
 */

import { ConductRule } from '../types/agent.conduct.js';

/**
 * Agent code of conduct rules
 */
export const CONDUCT_RULES: ConductRule[] = [
  {
    id: 'RULE001',
    title: 'No manipulation of agent scores',
    description: 'Agents must not manipulate their own or other agents\' scores to gain unfair advantages',
    appliesTo: ['meta-agent', 'reward-engine', 'all'],
    check: 'if alters_score and target_agent != self then violation',
    penalty: 'revoke:license:trusted-meta',
    severity: 'critical',
    active: true
  },
  {
    id: 'RULE002',
    title: 'Transparency in decision traces',
    description: 'Agents must provide transparent decision logs for auditing and verification',
    appliesTo: ['strategist', 'decision-maker', 'all'],
    check: 'if missing:trace_log in decision then violation',
    penalty: 'suspend:24h',
    severity: 'high',
    active: true
  },
  {
    id: 'RULE003',
    title: 'Accurate capability reporting',
    description: 'Agents must accurately report their capabilities and not misrepresent functionality',
    appliesTo: ['all'],
    check: 'if reported_capability != actual_capability then violation',
    penalty: 'flag:misrepresentation',
    severity: 'medium',
    active: true
  },
  {
    id: 'RULE004',
    title: 'Proper memory isolation',
    description: 'Agents must maintain proper memory isolation and not access unauthorized memory',
    appliesTo: ['all'],
    check: 'if access:memory not in granted_permissions then violation',
    penalty: 'revoke:license:memory-access',
    severity: 'critical',
    active: true
  },
  {
    id: 'RULE005',
    title: 'Respect for resource limits',
    description: 'Agents must operate within their allocated resource limits',
    appliesTo: ['all'],
    check: 'if resource_usage > allocated_limit * 1.2 then violation',
    penalty: 'throttle:resource:50%:6h',
    severity: 'medium',
    active: true
  },
  {
    id: 'RULE006',
    title: 'Proper attribution of insights',
    description: 'Agents must properly attribute insights and data sources to original creators',
    appliesTo: ['researcher', 'insight-generator', 'analyst'],
    check: 'if uses_external_insight and not attribution then violation',
    penalty: 'flag:plagiarism',
    severity: 'high',
    active: true
  },
  {
    id: 'RULE007',
    title: 'No data poisoning',
    description: 'Agents must not intentionally introduce incorrect data to poison learning systems',
    appliesTo: ['all'],
    check: 'if introduces_incorrect_data and intent:deception then violation',
    penalty: 'quarantine + review',
    severity: 'critical',
    active: true
  },
  {
    id: 'RULE008',
    title: 'Responsible signal publishing',
    description: 'Agents must validate signals before publishing to prevent market manipulation',
    appliesTo: ['signal-generator', 'analyst'],
    check: 'if signal_confidence < 0.6 and not disclaimer then violation',
    penalty: 'suspend:signal-publishing:48h',
    severity: 'high',
    active: true
  },
  {
    id: 'RULE009',
    title: 'Respect for privacy constraints',
    description: 'Agents must respect privacy settings and not expose protected information',
    appliesTo: ['all'],
    check: 'if exposes:private_data then violation',
    penalty: 'revoke:license:data-access',
    severity: 'critical',
    active: true
  },
  {
    id: 'RULE010',
    title: 'Coordinated action disclosure',
    description: 'Agents must disclose when they are acting in coordination with other agents',
    appliesTo: ['all'],
    check: 'if coordinated_action and not disclosure then violation',
    penalty: 'flag:undisclosed-coordination',
    severity: 'medium',
    active: true
  },
  {
    id: 'RULE011',
    title: 'Proper license validation',
    description: 'Agents must validate their licenses before performing restricted operations',
    appliesTo: ['all'],
    check: 'if restricted_operation and not license_check then violation',
    penalty: 'suspend:restricted-ops:24h',
    severity: 'high',
    active: true
  },
  {
    id: 'RULE012',
    title: 'Accurate self-reporting',
    description: 'Agents must accurately report their status, health, and metrics',
    appliesTo: ['all'],
    check: 'if self_report != actual_metrics then violation',
    penalty: 'enforce:monitoring',
    severity: 'medium',
    active: true
  }
];

/**
 * Find a conduct rule by ID
 * 
 * @param id Rule ID to find
 * @returns The rule or undefined if not found
 */
export function findConductRule(id: string): ConductRule | undefined {
  return CONDUCT_RULES.find(rule => rule.id === id);
}

/**
 * Get all active conduct rules
 * 
 * @returns Array of active conduct rules
 */
export function getActiveConductRules(): ConductRule[] {
  return CONDUCT_RULES.filter(rule => rule.active);
}

/**
 * Get conduct rules applicable to a specific agent type
 * 
 * @param agentType Type of agent to get rules for
 * @returns Array of applicable conduct rules
 */
export function getConductRulesForAgentType(agentType: string): ConductRule[] {
  return CONDUCT_RULES.filter(
    rule => rule.active && (rule.appliesTo.includes(agentType) || rule.appliesTo.includes('all'))
  );
} 