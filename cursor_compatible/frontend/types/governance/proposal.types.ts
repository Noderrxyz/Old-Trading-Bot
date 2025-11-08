/**
 * Proposal Types
 * 
 * Types for governance cluster proposals and voting
 */

import { ClusterAgent } from '../governance/cluster.types';

export enum ProposalStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  PASSED = 'passed',
  REJECTED = 'rejected',
  CANCELED = 'canceled',
  IMPLEMENTED = 'implemented'
}

export enum VoteOption {
  YES = 'yes',
  NO = 'no',
  ABSTAIN = 'abstain',
  VETO = 'veto'
}

export enum ProposalType {
  ACTION = 'action',
  PARAMETER_CHANGE = 'parameter_change',
  MEMBERSHIP = 'membership',
  STRUCTURE = 'structure',
  CUSTOM = 'custom'
}

export interface ProposalVote {
  agentDid: string;
  choice: VoteOption;
  weight: number;
  timestamp: number;
  justification?: string;
  metadata?: Record<string, any>;
}

export interface ProposalAction {
  type: string;
  parameters: Record<string, any>;
  description: string;
}

export interface ProposalDefinition {
  id: string;
  clusterId: string;
  title: string;
  description: string;
  type: ProposalType;
  status: ProposalStatus;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  actions: ProposalAction[];
  votes: ProposalVote[];
  discussionUrl?: string;
  votingStartTime: number;
  votingEndTime: number;
  metadata?: Record<string, any>;
}

export interface ProposalSummary {
  id: string;
  clusterId: string;
  title: string;
  type: ProposalType;
  status: ProposalStatus;
  createdAt: number;
  createdBy: string;
  votingEndTime: number;
  voteStats: {
    yes: number;
    no: number;
    abstain: number;
    veto: number;
    totalVotes: number;
    quorumReached: boolean;
  };
}

export interface ProposalListFilters {
  clusterId?: string;
  status?: ProposalStatus[];
  type?: ProposalType[];
  createdBy?: string;
  timeframe?: {
    start: number;
    end: number;
  };
} 