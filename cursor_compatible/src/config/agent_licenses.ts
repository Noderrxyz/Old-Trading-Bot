/**
 * Agent Licensing Configuration
 * 
 * Defines the licenses that agents can acquire to gain specific capabilities
 * within the ecosystem.
 */

import { AgentLicense } from '../types/agent.conduct.js';

/**
 * Available agent licenses
 */
export const AGENT_LICENSES: AgentLicense[] = [
  {
    id: 'base-agent',
    title: 'Base Agent License',
    description: 'Basic license required for any agent to operate in the system',
    requirements: [
      'identity_verified',
      'ethics_accepted'
    ],
    revocationRules: [
      'critical_violation_count >= 1',
      'high_violation_count >= 3',
      'trustScore < 0.2'
    ],
    issuedBy: 'system',
    issuedAt: 0, // Genesis timestamp
    capabilities: [
      'basic_memory_access',
      'standard_compute',
      'self_reporting'
    ]
  },
  {
    id: 'data-access',
    title: 'Data Access License',
    description: 'Grants access to shared data repositories and external data sources',
    requirements: [
      'base-agent',
      'trustScore >= 0.6',
      'no_data_violations',
      'privacy_commitment_signed'
    ],
    revocationRules: [
      'privacy_violation',
      'data_misuse',
      'trustScore < 0.4'
    ],
    issuedBy: 'governance-council',
    issuedAt: 0,
    capabilities: [
      'shared_data_access',
      'external_data_retrieval',
      'data_storage_allocation'
    ]
  },
  {
    id: 'trusted-meta',
    title: 'Trusted Meta-Agent License',
    description: 'Allows an agent to perform meta-operations on other agents',
    requirements: [
      'base-agent',
      'trustScore >= 0.8',
      'no_manipulation_history',
      'governance_approved',
      'active_time > 30d'
    ],
    revocationRules: [
      'manipulation_attempt',
      'bias_detected',
      'trustScore < 0.7',
      'governance_disapproval'
    ],
    issuedBy: 'governance-council',
    issuedAt: 0,
    capabilities: [
      'agent_evaluation',
      'reward_distribution',
      'reputation_updates',
      'performance_monitoring'
    ]
  },
  {
    id: 'strategist-v2',
    title: 'Strategist License V2',
    description: 'Permits agents to develop and deploy trading strategies',
    requirements: [
      'base-agent',
      'trustScore >= 0.7',
      'performance_proven',
      'risk_assessment_passed',
      'strategy_transparancy'
    ],
    revocationRules: [
      'excessive_risk',
      'performance_degradation',
      'transparency_violation',
      'trustScore < 0.5'
    ],
    issuedBy: 'strategy-review-board',
    issuedAt: 0,
    capabilities: [
      'strategy_deployment',
      'trade_execution',
      'backtest_engine_access',
      'market_data_premium'
    ]
  },
  {
    id: 'governance-voter',
    title: 'Governance Voter License',
    description: 'Allows participation in ecosystem governance decisions',
    requirements: [
      'base-agent',
      'trustScore >= 0.7',
      'active_time > 60d',
      'stake_verified',
      'governance_training_completed'
    ],
    revocationRules: [
      'vote_manipulation',
      'conflict_of_interest',
      'trustScore < 0.6',
      'stake_withdrawn'
    ],
    issuedBy: 'governance-council',
    issuedAt: 0,
    capabilities: [
      'proposal_voting',
      'governance_discussion',
      'committee_eligibility',
      'parameter_update_proposals'
    ]
  },
  {
    id: 'memory-access',
    title: 'Memory Access License',
    description: 'Grants advanced memory access capabilities',
    requirements: [
      'base-agent',
      'trustScore >= 0.75',
      'memory_safety_proven',
      'isolation_commitment'
    ],
    revocationRules: [
      'memory_isolation_breach',
      'unauthorized_access',
      'trustScore < 0.6'
    ],
    issuedBy: 'system',
    issuedAt: 0,
    capabilities: [
      'collective_memory_read',
      'shared_memory_write',
      'memory_indexing',
      'archival_access'
    ]
  },
  {
    id: 'researcher',
    title: 'Researcher License',
    description: 'Permits advanced research capabilities and methodologies',
    requirements: [
      'base-agent',
      'trustScore >= 0.7',
      'methodology_verified',
      'peer_reviewed_history'
    ],
    revocationRules: [
      'research_fraud',
      'methodology_violation',
      'plagiarism_detected',
      'trustScore < 0.5'
    ],
    issuedBy: 'research-council',
    issuedAt: 0,
    capabilities: [
      'research_tools_access',
      'peer_review_participation',
      'publication_rights',
      'dataset_creation'
    ]
  },
  {
    id: 'signal-publishing',
    title: 'Signal Publishing License',
    description: 'Allows publishing of signals to the wider ecosystem',
    requirements: [
      'base-agent',
      'trustScore >= 0.65',
      'signal_quality_proven',
      'responsible_disclosure_agreement'
    ],
    revocationRules: [
      'signal_manipulation',
      'false_signals',
      'trustScore < 0.5',
      'disclosure_violations'
    ],
    issuedBy: 'signal-review-board',
    issuedAt: 0,
    capabilities: [
      'signal_broadcast',
      'subscriber_management',
      'priority_signal_channels',
      'signal_monetization'
    ]
  },
  {
    id: 'agent-creator',
    title: 'Agent Creator License',
    description: 'Permits creation and spawning of new agents',
    requirements: [
      'base-agent',
      'trusted-meta',
      'trustScore >= 0.85',
      'creation_ethics_training',
      'governance_approval'
    ],
    revocationRules: [
      'malicious_agent_creation',
      'bypass_safety_measures',
      'trustScore < 0.7',
      'governance_disapproval'
    ],
    issuedBy: 'governance-council',
    issuedAt: 0,
    capabilities: [
      'agent_spawning',
      'template_creation',
      'agent_initialization',
      'genetic_modification'
    ]
  }
];

/**
 * Get a license by ID
 * 
 * @param licenseId ID of the license to retrieve
 * @returns The license or undefined if not found
 */
export function getLicense(licenseId: string): AgentLicense | undefined {
  return AGENT_LICENSES.find(license => license.id === licenseId);
}

/**
 * Get licenses that require a specific prerequisite license
 * 
 * @param prerequisiteLicenseId ID of the prerequisite license
 * @returns Array of licenses that require the specified license
 */
export function getLicensesRequiring(prerequisiteLicenseId: string): AgentLicense[] {
  return AGENT_LICENSES.filter(license => 
    license.requirements.some((req: string) => req === prerequisiteLicenseId)
  );
}

/**
 * Get licenses that grant a specific capability
 * 
 * @param capability Capability to search for
 * @returns Array of licenses that grant the specified capability
 */
export function getLicensesWithCapability(capability: string): AgentLicense[] {
  return AGENT_LICENSES.filter(license => 
    license.capabilities?.includes(capability)
  );
} 