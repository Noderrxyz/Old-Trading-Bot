/**
 * Governance Contracts
 * 
 * This module exports contract interfaces and classes for interacting with
 * on-chain governance contracts.
 */

// Export VotingContract and related types
export {
  VotingContract,
  VoteType,
  Voter,
  ProposalVote,
  ProposalState,
  Proposal,
  VotingContractConfig
} from './VotingContract';

// Export TreasuryContract and related types
export {
  TreasuryContract,
  TreasuryAsset,
  TreasuryAction,
  TreasuryTransaction,
  TreasuryAllocationStrategy,
  FeeDistributionConfig,
  TreasuryContractConfig
} from './TreasuryContract';

/**
 * Factory function to create contracts based on chain ID
 */
import { VotingContract, VotingContractConfig } from './VotingContract';
import { TreasuryContract, TreasuryContractConfig } from './TreasuryContract';
import { IChainAdapter, ChainId } from '../../adapters/IChainAdapter';
import { EventEmitter } from '../../utils/EventEmitter';

/**
 * Create a voting contract for a specific chain
 * 
 * @param adapter Chain adapter
 * @param config Contract configuration
 * @param eventEmitter Event emitter
 * @returns VotingContract instance
 */
export function createVotingContract(
  adapter: IChainAdapter,
  config: VotingContractConfig,
  eventEmitter: EventEmitter
): VotingContract {
  return new VotingContract(adapter, config, eventEmitter);
}

/**
 * Create a treasury contract for a specific chain
 * 
 * @param adapter Chain adapter
 * @param config Contract configuration
 * @param eventEmitter Event emitter
 * @returns TreasuryContract instance
 */
export function createTreasuryContract(
  adapter: IChainAdapter,
  config: TreasuryContractConfig,
  eventEmitter: EventEmitter
): TreasuryContract {
  return new TreasuryContract(adapter, config, eventEmitter);
}

/**
 * Contract addresses by chain and environment
 */
export const CONTRACT_ADDRESSES = {
  // Mainnet addresses
  mainnet: {
    [ChainId.ETHEREUM]: {
      voting: '0x0000000000000000000000000000000000000000',
      treasury: '0x0000000000000000000000000000000000000000'
    },
    [ChainId.POLYGON]: {
      voting: '0x0000000000000000000000000000000000000000',
      treasury: '0x0000000000000000000000000000000000000000'
    },
    [ChainId.ARBITRUM]: {
      voting: '0x0000000000000000000000000000000000000000',
      treasury: '0x0000000000000000000000000000000000000000'
    }
  },
  // Testnet addresses
  testnet: {
    [ChainId.ETHEREUM_GOERLI]: {
      voting: '0x0000000000000000000000000000000000000000',
      treasury: '0x0000000000000000000000000000000000000000'
    },
    [ChainId.POLYGON_MUMBAI]: {
      voting: '0x0000000000000000000000000000000000000000',
      treasury: '0x0000000000000000000000000000000000000000'
    },
    [ChainId.ARBITRUM_GOERLI]: {
      voting: '0x0000000000000000000000000000000000000000',
      treasury: '0x0000000000000000000000000000000000000000'
    }
  }
}; 