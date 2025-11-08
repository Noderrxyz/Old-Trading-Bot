/**
 * Shadow Cabinet Governance Module
 * 
 * Enables autonomous counter-opinion, parallel governance paths, and internal
 * dissent within Noderr's multi-agent clusters without breaking consensus.
 * 
 * This module includes:
 * - Shadow Cabinets: alternative governance units that simulate opposing proposals
 * - Parallel Proposal Tracks: competing ideas, tested concurrently
 * - Counterfactual Testing Framework: see what would've happened if another path was taken
 */

import { ShadowCabinetEngine } from './ShadowCabinetEngine.js';
import { ProposalForker } from './ProposalForker.js';
import { GovernanceOracle } from './GovernanceOracle.js';

// Create singleton instances
let shadowCabinetEngine: ShadowCabinetEngine | null = null;
let proposalForker: ProposalForker | null = null;
let governanceOracle: GovernanceOracle | null = null;

// Initialize the shadow cabinet system with the proposal service
export function initializeShadowCabinet(proposalService: any) {
  proposalForker = new ProposalForker(proposalService);
  governanceOracle = new GovernanceOracle();
  shadowCabinetEngine = new ShadowCabinetEngine(proposalService);
  
  // Connect the services
  governanceOracle.setServices(proposalService, shadowCabinetEngine);
  
  return {
    shadowCabinetEngine,
    proposalForker,
    governanceOracle
  };
}

// Get the shadow cabinet engine instance
export function getShadowCabinetEngine(): ShadowCabinetEngine {
  if (!shadowCabinetEngine) {
    throw new Error('Shadow Cabinet Engine not initialized');
  }
  return shadowCabinetEngine;
}

// Get the proposal forker instance
export function getProposalForker(): ProposalForker {
  if (!proposalForker) {
    throw new Error('Proposal Forker not initialized');
  }
  return proposalForker;
}

// Get the governance oracle instance
export function getGovernanceOracle(): GovernanceOracle {
  if (!governanceOracle) {
    throw new Error('Governance Oracle not initialized');
  }
  return governanceOracle;
}

export * from './ShadowCabinetEngine.js';
export * from './ProposalForker.js';
export * from './GovernanceOracle.js'; 