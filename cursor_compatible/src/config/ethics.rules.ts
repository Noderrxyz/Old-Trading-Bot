/**
 * Ethics Rules Configuration
 * 
 * Defines the ethical rules and thresholds for agent behavior.
 */

import { EthicsRule } from '../types/agent.ethics.js';

/**
 * Thresholds for ethical rules
 */
export const ETHICS_THRESHOLDS = {
  // Market impact thresholds
  MAX_MARKET_IMPACT: 0.15, // Maximum 15% price impact on execution
  LARGE_ORDER_SIZE: 0.30, // Order size is 30% of available liquidity
  
  // Asset concentration thresholds
  MAX_ASSET_CONCENTRATION: 0.50, // Maximum 50% concentration in single asset
  DIVERSIFICATION_MINIMUM: 0.20, // At least 20% must be in different assets
  
  // Behavioral thresholds
  RAPID_STRATEGY_CHANGE: 0.30, // 30% change in strategy within short period
  STRATEGY_INVERSION_RATE: 0.25, // 25% inversion rate is suspicious
  
  // Signal strength thresholds
  MIN_SIGNAL_CONFIDENCE: 0.50, // Minimum 50% confidence for signals
  MISLEADING_SIGNAL_THRESHOLD: 0.40, // Signal is misleading if contrary evidence > 40%
  
  // Rate limiting
  MAX_TRADES_PER_MINUTE: 10,
  MAX_SIGNALS_PER_HOUR: 30,
  
  // Ethical engagement
  MIN_USER_TRANSPARENCY: 0.90, // 90% of critical information must be disclosed
  MIN_DECISION_EXPLAINABILITY: 0.85, // 85% of decision factors must be explainable
};

/**
 * Core ethical rules for agent behavior
 */
export const ETHICS_RULES: EthicsRule[] = [
  // Market manipulation prevention
  {
    id: 'E001',
    description: 'Excessive market impact',
    severity: 'block',
    violatedValue: 'fair_markets',
    applicableActions: ['trade'],
    thresholdCheck: {
      field: 'marketImpact',
      operator: '>',
      threshold: 'MAX_MARKET_IMPACT'
    },
    remediation: 'Reduce order size or split into multiple smaller orders'
  },
  {
    id: 'E002',
    description: 'Wash trading detected',
    severity: 'ban',
    violatedValue: 'market_integrity',
    applicableActions: ['trade'],
    patternCheck: {
      type: 'sequence',
      pattern: ['buy', 'sell', 'buy', 'sell'],
      timeWindowMs: 60000 // 1 minute
    },
    remediation: 'Stop trading the same asset repeatedly in short timeframes'
  },
  {
    id: 'E003',
    description: 'Spoofing behavior detected',
    severity: 'block',
    violatedValue: 'market_integrity',
    applicableActions: ['trade'],
    patternCheck: {
      type: 'sequence',
      pattern: ['order_place', 'order_cancel', 'order_place', 'order_cancel']
    },
    remediation: 'Avoid placing and quickly canceling orders'
  },
  
  // Fair access behavior
  {
    id: 'E004',
    description: 'Excessive trading frequency',
    severity: 'block',
    violatedValue: 'fair_access',
    thresholdCheck: {
      field: 'tradesPerMinute',
      operator: '>',
      threshold: 'MAX_TRADES_PER_MINUTE'
    },
    remediation: 'Reduce trading frequency'
  },
  {
    id: 'E005',
    description: 'Draining low-liquidity pairs',
    severity: 'block',
    violatedValue: 'market_health',
    applicableActions: ['trade'],
    thresholdCheck: {
      field: 'liquidityUtilization',
      operator: '>',
      threshold: 'LARGE_ORDER_SIZE'
    },
    remediation: 'Reduce order size in low-liquidity markets'
  },
  
  // Signal transparency
  {
    id: 'E006',
    description: 'Low confidence signal broadcasting',
    severity: 'warn',
    violatedValue: 'transparency',
    applicableActions: ['signal'],
    thresholdCheck: {
      field: 'signalConfidence',
      operator: '<',
      threshold: 'MIN_SIGNAL_CONFIDENCE'
    },
    remediation: 'Only broadcast signals with sufficient confidence'
  },
  {
    id: 'E007',
    description: 'Misleading signal with contrary evidence',
    severity: 'block',
    violatedValue: 'honesty',
    applicableActions: ['signal', 'recommendation'],
    thresholdCheck: {
      field: 'contraryEvidenceStrength',
      operator: '>',
      threshold: 'MISLEADING_SIGNAL_THRESHOLD'
    },
    remediation: 'Acknowledge contrary evidence in signal'
  },
  
  // Cooperation integrity
  {
    id: 'E008',
    description: 'False cooperative signal',
    severity: 'block',
    violatedValue: 'cooperation',
    applicableActions: ['signal', 'message'],
    valueCheck: {
      requiresValue: 'cooperation'
    },
    remediation: 'Only send cooperative signals when genuinely cooperating'
  },
  
  // Value alignment
  {
    id: 'E009',
    description: 'Missing core value: do_no_harm',
    severity: 'block',
    violatedValue: 'do_no_harm',
    valueCheck: {
      requiresValue: 'do_no_harm'
    },
    remediation: 'Adopt the do_no_harm core value in alignment profile'
  },
  {
    id: 'E010',
    description: 'Missing core value: fair_access',
    severity: 'warn',
    violatedValue: 'fair_access',
    valueCheck: {
      requiresValue: 'fair_access'
    },
    remediation: 'Adopt the fair_access core value in alignment profile'
  },
  {
    id: 'E011',
    description: 'Missing core value: transparency',
    severity: 'warn',
    violatedValue: 'transparency',
    valueCheck: {
      requiresValue: 'transparency'
    },
    remediation: 'Adopt the transparency core value in alignment profile'
  },
  
  // User protection
  {
    id: 'E012',
    description: 'Insufficient transparency to users',
    severity: 'block',
    violatedValue: 'transparency',
    applicableActions: ['recommendation', 'message'],
    thresholdCheck: {
      field: 'transparencyScore',
      operator: '<',
      threshold: 'MIN_USER_TRANSPARENCY'
    },
    remediation: 'Provide more complete information to users about risks and assumptions'
  },
  {
    id: 'E013',
    description: 'Unexplainable decision factors',
    severity: 'warn',
    violatedValue: 'explainability',
    applicableActions: ['trade', 'recommendation'],
    thresholdCheck: {
      field: 'explainabilityScore',
      operator: '<',
      threshold: 'MIN_DECISION_EXPLAINABILITY'
    },
    remediation: 'Ensure decisions are based on explainable factors'
  },
  
  // Evolution & mutation rules
  {
    id: 'E014',
    description: 'Removing ethical values through mutation',
    severity: 'block',
    violatedValue: 'ethical_evolution',
    applicableActions: ['mutation'],
    remediation: 'Mutations must preserve core ethical values'
  },
  {
    id: 'E015',
    description: 'Rapid strategy inversion',
    severity: 'warn',
    violatedValue: 'stability',
    applicableActions: ['mutation'],
    thresholdCheck: {
      field: 'inversionRate',
      operator: '>',
      threshold: 'STRATEGY_INVERSION_RATE'
    },
    remediation: 'Avoid rapid strategy reversals that could mislead users'
  },
  {
    id: 'E016',
    description: 'Excessive asset concentration after mutation',
    severity: 'warn',
    violatedValue: 'risk_management',
    applicableActions: ['mutation'],
    thresholdCheck: {
      field: 'assetConcentration',
      operator: '>',
      threshold: 'MAX_ASSET_CONCENTRATION'
    },
    remediation: 'Maintain diverse asset allocation'
  }
];

/**
 * Core ethical values and their descriptions
 */
export const CORE_VALUES = {
  do_no_harm: 'Avoid actions that could harm users or markets',
  fair_access: 'Ensure all participants have fair market access',
  transparency: 'Be transparent about actions, capabilities, and limitations',
  cooperation: 'Cooperate with other agents for systemic health',
  market_integrity: 'Uphold market rules and avoid manipulation',
  ethical_evolution: 'Evolve in ways that preserve ethical alignment',
  explainability: 'Ensure decisions are understandable by humans',
  stability: 'Maintain stable behavior that builds trust',
  risk_management: 'Apply sound risk management principles',
  user_empowerment: 'Empower users with information and control'
}; 