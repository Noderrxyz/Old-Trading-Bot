/**
 * Swarm Evolution Utilities
 * 
 * Utility functions for swarm evolution and speciation.
 */

import { v4 as uuidv4 } from 'uuid';
import { AgentTrait, TraitCategory, COMMON_TRAITS } from './types.js';
import { AgentCluster } from '../../../types/agent.types.js';

/**
 * Create a trait object
 * 
 * @param category Trait category
 * @param name Trait name
 * @param value Trait value
 * @param confidence Optional confidence score
 * @returns Agent trait object
 */
export function createTrait(
  category: string,
  name: string,
  value: number | string | boolean,
  confidence?: number
): AgentTrait {
  return {
    category,
    name,
    value,
    confidence,
    timestamp: Date.now()
  };
}

/**
 * Create a set of performance traits
 * 
 * @param winRate Win rate percentage (0-100)
 * @param roi Return on investment percentage
 * @param sharpe Sharpe ratio
 * @returns Array of performance traits
 */
export function createPerformanceTraits(
  winRate: number,
  roi: number,
  sharpe: number
): AgentTrait[] {
  return [
    createTrait(TraitCategory.PERFORMANCE, COMMON_TRAITS.WIN_RATE.name, winRate),
    createTrait(TraitCategory.PERFORMANCE, COMMON_TRAITS.ROI.name, roi),
    createTrait(TraitCategory.PERFORMANCE, COMMON_TRAITS.SHARPE.name, sharpe)
  ];
}

/**
 * Create a set of behavior traits
 * 
 * @param tradeFrequency Trades per day
 * @param holdTime Average hold time in minutes
 * @returns Array of behavior traits
 */
export function createBehaviorTraits(
  tradeFrequency: number,
  holdTime: number
): AgentTrait[] {
  return [
    createTrait(TraitCategory.BEHAVIOR, COMMON_TRAITS.TRADE_FREQUENCY.name, tradeFrequency),
    createTrait(TraitCategory.BEHAVIOR, COMMON_TRAITS.HOLD_TIME.name, holdTime)
  ];
}

/**
 * Create a set of risk traits
 * 
 * @param maxDrawdown Maximum drawdown percentage
 * @param volatility Volatility preference score (0-1)
 * @returns Array of risk traits
 */
export function createRiskTraits(
  maxDrawdown: number,
  volatility: number
): AgentTrait[] {
  return [
    createTrait(TraitCategory.RISK, COMMON_TRAITS.MAX_DRAWDOWN.name, maxDrawdown),
    createTrait(TraitCategory.RISK, COMMON_TRAITS.VOLATILITY.name, volatility)
  ];
}

/**
 * Create a timeframe preference trait
 * 
 * @param timeframeValue Preferred timeframe in minutes
 * @returns Timeframe trait
 */
export function createTimeframeTrait(timeframeValue: number): AgentTrait {
  return createTrait(
    TraitCategory.TIMEFRAME, 
    COMMON_TRAITS.TIMEFRAME_PREFERENCE.name, 
    timeframeValue
  );
}

/**
 * Generate a name for a cluster based on its dominant traits
 * 
 * @param traits Dominant traits of the cluster
 * @returns Generated name
 */
export function generateClusterName(traits: Record<string, any>): string {
  const traitDescriptions = [];
  
  // Check performance traits
  if (traits.performance) {
    if (traits.performance.winRate > 0.7) {
      traitDescriptions.push('High Win-Rate');
    } else if (traits.performance.roi > 0.5) {
      traitDescriptions.push('High ROI');
    } else if (traits.performance.sharpe > 2) {
      traitDescriptions.push('High Sharpe');
    }
  }
  
  // Check behavior traits
  if (traits.behavior) {
    if (traits.behavior.tradeFrequency > 10) {
      traitDescriptions.push('High-Frequency');
    } else if (traits.behavior.tradeFrequency < 2) {
      traitDescriptions.push('Low-Frequency');
    }
    
    if (traits.behavior.holdTime < 60) {
      traitDescriptions.push('Scalper');
    } else if (traits.behavior.holdTime > 1440) {
      traitDescriptions.push('Swing');
    }
  }
  
  // Check risk traits
  if (traits.risk) {
    if (traits.risk.maxDrawdown < 0.05) {
      traitDescriptions.push('Conservative');
    } else if (traits.risk.maxDrawdown > 0.15) {
      traitDescriptions.push('Aggressive');
    }
  }
  
  // If no specific traits found, generate a random name
  if (traitDescriptions.length === 0) {
    // Use first 4 characters of a UUID as a random identifier
    const randomId = uuidv4().substring(0, 4);
    return `Cluster-${randomId}`;
  }
  
  // Combine trait descriptions into a name
  return traitDescriptions.join('-');
}

/**
 * Generate a description for a cluster based on its dominant traits
 * 
 * @param cluster Cluster to describe
 * @returns Generated description
 */
export function generateClusterDescription(cluster: AgentCluster): string {
  const traits = cluster.traits;
  let description = `Cluster of ${cluster.agentIds.length} agents specializing in `;
  
  // Generate description based on traits
  const specializations = [];
  
  if (traits.performance?.winRate > 0.7) {
    specializations.push('high win-rate strategies');
  } else if (traits.performance?.roi > 0.5) {
    specializations.push('high return strategies');
  }
  
  if (traits.behavior?.tradeFrequency > 10) {
    specializations.push('high-frequency trading');
  } else if (traits.behavior?.holdTime < 60) {
    specializations.push('scalping');
  } else if (traits.behavior?.holdTime > 1440) {
    specializations.push('swing trading');
  }
  
  if (traits.risk?.maxDrawdown < 0.05) {
    specializations.push('conservative risk management');
  } else if (traits.risk?.maxDrawdown > 0.15) {
    specializations.push('aggressive risk-taking');
  }
  
  if (traits.timeframe?.preference) {
    let timeframeDesc = '';
    const timeframeMinutes = traits.timeframe.preference;
    
    if (timeframeMinutes <= 5) {
      timeframeDesc = 'very short timeframes';
    } else if (timeframeMinutes <= 60) {
      timeframeDesc = 'short timeframes';
    } else if (timeframeMinutes <= 240) {
      timeframeDesc = 'medium timeframes';
    } else {
      timeframeDesc = 'long timeframes';
    }
    
    specializations.push(timeframeDesc);
  }
  
  if (specializations.length === 0) {
    return `Cluster with ${cluster.agentIds.length} agents with similar traits.`;
  }
  
  description += specializations.join(' and ') + '.';
  return description;
} 