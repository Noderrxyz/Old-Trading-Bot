/**
 * VotingContract.ts
 * 
 * A TypeScript representation of the on-chain voting contract.
 * This class provides methods for interacting with the voting contract
 * on various chains, including proposal creation, voting, and execution.
 */

import { IChainAdapter, TransactionResponse, ChainId, TransactionReceipt } from '../../adapters/IChainAdapter';
import { EventEmitter } from '../../utils/EventEmitter';

export enum VoteType {
  AGAINST = 0,
  FOR = 1,
  ABSTAIN = 2
}

export interface Voter {
  address: string;
  votingPower: bigint;
  delegatedTo: string;
  delegatedFrom: string[];
  lastVoteTimestamp: number;
  totalVotes: number;
}

export interface ProposalVote {
  voter: string;
  support: VoteType;
  weight: bigint;
  reason: string;
  timestamp: number;
}

export enum ProposalState {
  PENDING = 0,      // Waiting for voting delay to pass
  ACTIVE = 1,       // Active for voting
  CANCELED = 2,     // Canceled by creator or admin
  DEFEATED = 3,     // Failed to meet quorum or majority
  SUCCEEDED = 4,    // Passed quorum and majority
  QUEUED = 5,       // Waiting for timelock
  EXPIRED = 6,      // Expired during timelock
  EXECUTED = 7      // Successfully executed
}

export interface Proposal {
  id: bigint;
  proposer: string;
  description: string;
  targets: string[];       // Target contract addresses
  values: bigint[];        // ETH values to send with each call
  signatures: string[];    // Function signatures to call
  calldatas: string[];     // Calldata for each function
  startBlock: bigint;      // Block when voting begins
  endBlock: bigint;        // Block when voting ends
  state: ProposalState;
  forVotes: bigint;        // Total votes in favor
  againstVotes: bigint;    // Total votes against
  abstainVotes: bigint;    // Total abstain votes
  createdAt: number;       // Timestamp of proposal creation
  executedAt: number;      // Timestamp of execution (0 if not executed)
  eta: number;             // Estimated time of execution after timelock
  proposalThreshold: bigint; // Votes needed to create a proposal
  quorumVotes: bigint;     // Votes needed for quorum
}

export interface VotingContractConfig {
  chainId: ChainId;
  contractAddress: string;
  governanceTokenAddress?: string;
  votingDelay: number;      // Blocks before voting begins
  votingPeriod: number;     // Blocks for which voting is active
  proposalThreshold: bigint; // Votes needed to create a proposal
  quorumNumerator: number;   // Percentage (1-100) for quorum
  timelockDelay: number;     // Seconds for timelock
}

/**
 * A class representing the on-chain voting contract
 */
export class VotingContract {
  private adapter: IChainAdapter;
  private config: VotingContractConfig;
  private eventEmitter: EventEmitter;
  
  /**
   * Create a new voting contract instance
   * 
   * @param adapter The chain adapter to use for transactions
   * @param config The contract configuration
   * @param eventEmitter Event emitter for voting events
   */
  constructor(
    adapter: IChainAdapter,
    config: VotingContractConfig,
    eventEmitter: EventEmitter
  ) {
    this.adapter = adapter;
    this.config = config;
    this.eventEmitter = eventEmitter;
  }
  
  /**
   * Get the current chain ID
   */
  public getChainId(): ChainId {
    return this.config.chainId;
  }
  
  /**
   * Get the contract address
   */
  public getAddress(): string {
    return this.config.contractAddress;
  }
  
  /**
   * Get proposal by ID
   * 
   * @param proposalId The proposal ID
   * @returns The proposal details
   */
  public async getProposal(proposalId: bigint): Promise<Proposal> {
    // Build calldata for getProposal function
    const data = this.encodeFunction(
      'getProposal(uint256)',
      ['uint256'],
      [proposalId.toString()]
    );
    
    // Call the contract view function
    const response = await this.adapter.estimateGas(
      await this.adapter.getWalletAddress(),
      this.config.contractAddress,
      data
    );
    
    // Parse response
    // In a real implementation, this would decode the response from the contract
    // For now, return a mock proposal
    return {
      id: proposalId,
      proposer: '0x0000000000000000000000000000000000000000',
      description: 'Mock proposal',
      targets: [],
      values: [],
      signatures: [],
      calldatas: [],
      startBlock: BigInt(0),
      endBlock: BigInt(0),
      state: ProposalState.PENDING,
      forVotes: BigInt(0),
      againstVotes: BigInt(0),
      abstainVotes: BigInt(0),
      createdAt: Date.now(),
      executedAt: 0,
      eta: 0,
      proposalThreshold: BigInt(0),
      quorumVotes: BigInt(0)
    };
  }
  
  /**
   * Get all proposals in a specified range
   * 
   * @param start Starting proposal ID
   * @param end Ending proposal ID
   * @returns Array of proposals
   */
  public async getProposals(start: bigint, end: bigint): Promise<Proposal[]> {
    const proposals: Proposal[] = [];
    
    for (let i = start; i <= end; i++) {
      const proposal = await this.getProposal(i);
      proposals.push(proposal);
    }
    
    return proposals;
  }
  
  /**
   * Create a new proposal
   * 
   * @param targets Target contract addresses
   * @param values ETH values to send with each call
   * @param signatures Function signatures to call
   * @param calldatas Calldata for each function
   * @param description Description of the proposal
   * @returns Transaction response
   */
  public async propose(
    targets: string[],
    values: bigint[],
    signatures: string[],
    calldatas: string[],
    description: string
  ): Promise<TransactionResponse> {
    // Build calldata for propose function
    const data = this.encodeFunction(
      'propose(address[],uint256[],string[],bytes[],string)',
      ['address[]', 'uint256[]', 'string[]', 'bytes[]', 'string'],
      [targets, values.map(v => v.toString()), signatures, calldatas, description]
    );
    
    // Send transaction
    return this.sendTransaction(data, 'propose');
  }
  
  /**
   * Cast a vote on a proposal
   * 
   * @param proposalId Proposal ID
   * @param support Vote type (against, for, abstain)
   * @returns Transaction response
   */
  public async castVote(
    proposalId: bigint,
    support: VoteType
  ): Promise<TransactionResponse> {
    // Build calldata for castVote function
    const data = this.encodeFunction(
      'castVote(uint256,uint8)',
      ['uint256', 'uint8'],
      [proposalId.toString(), support.toString()]
    );
    
    // Send transaction
    return this.sendTransaction(data, 'castVote');
  }
  
  /**
   * Cast a vote with reason
   * 
   * @param proposalId Proposal ID
   * @param support Vote type (against, for, abstain)
   * @param reason Reason for the vote
   * @returns Transaction response
   */
  public async castVoteWithReason(
    proposalId: bigint,
    support: VoteType,
    reason: string
  ): Promise<TransactionResponse> {
    // Build calldata for castVoteWithReason function
    const data = this.encodeFunction(
      'castVoteWithReason(uint256,uint8,string)',
      ['uint256', 'uint8', 'string'],
      [proposalId.toString(), support.toString(), reason]
    );
    
    // Send transaction
    return this.sendTransaction(data, 'castVoteWithReason');
  }
  
  /**
   * Execute a successful proposal
   * 
   * @param proposalId Proposal ID to execute
   * @returns Transaction response
   */
  public async execute(proposalId: bigint): Promise<TransactionResponse> {
    // Build calldata for execute function
    const data = this.encodeFunction(
      'execute(uint256)',
      ['uint256'],
      [proposalId.toString()]
    );
    
    // Send transaction
    return this.sendTransaction(data, 'execute');
  }
  
  /**
   * Queue a successful proposal for execution after timelock
   * 
   * @param proposalId Proposal ID to queue
   * @returns Transaction response
   */
  public async queue(proposalId: bigint): Promise<TransactionResponse> {
    // Build calldata for queue function
    const data = this.encodeFunction(
      'queue(uint256)',
      ['uint256'],
      [proposalId.toString()]
    );
    
    // Send transaction
    return this.sendTransaction(data, 'queue');
  }
  
  /**
   * Cancel a proposal
   * 
   * @param proposalId Proposal ID to cancel
   * @returns Transaction response
   */
  public async cancel(proposalId: bigint): Promise<TransactionResponse> {
    // Build calldata for cancel function
    const data = this.encodeFunction(
      'cancel(uint256)',
      ['uint256'],
      [proposalId.toString()]
    );
    
    // Send transaction
    return this.sendTransaction(data, 'cancel');
  }
  
  /**
   * Delegate voting power to another address
   * 
   * @param delegatee Address to delegate to
   * @returns Transaction response
   */
  public async delegate(delegatee: string): Promise<TransactionResponse> {
    // Build calldata for delegate function
    const data = this.encodeFunction(
      'delegate(address)',
      ['address'],
      [delegatee]
    );
    
    // Send transaction
    return this.sendTransaction(data, 'delegate');
  }
  
  /**
   * Get voter information
   * 
   * @param address Voter address
   * @returns Voter information
   */
  public async getVoter(address: string): Promise<Voter> {
    // In a real implementation, this would call the contract
    // For now, return a mock voter
    return {
      address,
      votingPower: BigInt(1000),
      delegatedTo: address,
      delegatedFrom: [],
      lastVoteTimestamp: Date.now(),
      totalVotes: 10
    };
  }
  
  /**
   * Get votes for a specific proposal
   * 
   * @param proposalId Proposal ID
   * @returns Array of votes
   */
  public async getVotes(proposalId: bigint): Promise<ProposalVote[]> {
    // In a real implementation, this would fetch votes from the contract
    // For now, return mock votes
    return [
      {
        voter: '0x0000000000000000000000000000000000000001',
        support: VoteType.FOR,
        weight: BigInt(100),
        reason: 'Support reason',
        timestamp: Date.now()
      },
      {
        voter: '0x0000000000000000000000000000000000000002',
        support: VoteType.AGAINST,
        weight: BigInt(50),
        reason: 'Against reason',
        timestamp: Date.now()
      }
    ];
  }
  
  /**
   * Get the current quorum
   * 
   * @returns The current quorum threshold
   */
  public async getQuorum(): Promise<bigint> {
    // Build calldata for quorum function
    const data = this.encodeFunction(
      'quorum()',
      [],
      []
    );
    
    // Call the contract view function
    // In a real implementation, this would decode the response
    return BigInt(1000000);
  }
  
  /**
   * Update the contract configuration
   * 
   * @param newConfig New contract configuration
   */
  public updateConfig(newConfig: Partial<VotingContractConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
  
  /**
   * Get the voting delay in blocks
   * 
   * @returns Voting delay
   */
  public getVotingDelay(): number {
    return this.config.votingDelay;
  }
  
  /**
   * Get the voting period in blocks
   * 
   * @returns Voting period
   */
  public getVotingPeriod(): number {
    return this.config.votingPeriod;
  }
  
  /**
   * Get the proposal threshold
   * 
   * @returns Proposal threshold
   */
  public getProposalThreshold(): bigint {
    return this.config.proposalThreshold;
  }
  
  /**
   * Helper function to encode function call data
   * 
   * @param signature Function signature
   * @param types Parameter types
   * @param values Parameter values
   * @returns Encoded function data
   */
  private encodeFunction(
    signature: string,
    types: string[],
    values: any[]
  ): string {
    // This is a placeholder for actual ABI encoding
    // In a real implementation, this would use ethers.js or a similar library
    
    // Example implementation with ethers would be:
    // const iface = new ethers.utils.Interface([`function ${signature}`]);
    // return iface.encodeFunctionData(signature.split('(')[0], values);
    
    // For now, return a dummy value
    return '0x';
  }
  
  /**
   * Helper function to send a transaction to the contract
   * 
   * @param data Transaction data
   * @param methodName Name of the method being called (for logging)
   * @returns Transaction response
   */
  private async sendTransaction(data: string, methodName: string): Promise<TransactionResponse> {
    try {
      // Create the transaction request
      const tx = {
        to: this.config.contractAddress,
        data
      };
      
      // Send the transaction
      const response = await this.adapter.sendTransaction(tx);
      
      // Log the event
      this.eventEmitter.emit('governance:transaction', {
        chainId: this.config.chainId,
        contractAddress: this.config.contractAddress,
        method: methodName,
        txHash: response.hash,
        timestamp: Date.now()
      });
      
      return response;
    } catch (error) {
      console.error(`Error sending ${methodName} transaction:`, error);
      throw error;
    }
  }
  
  /**
   * Wait for a transaction to be confirmed
   * 
   * @param txHash Transaction hash
   * @param confirmations Number of confirmations to wait for
   * @returns Transaction receipt
   */
  public async waitForTransaction(txHash: string, confirmations: number = 1): Promise<TransactionReceipt> {
    // Check transaction status until confirmed
    while (true) {
      const status = await this.adapter.getTransactionStatus(txHash);
      
      if (status.status === 'confirmed' && status.confirmations && status.confirmations >= confirmations) {
        return status.receipt as TransactionReceipt;
      }
      
      if (status.status === 'failed') {
        throw new Error(`Transaction ${txHash} failed`);
      }
      
      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
} 