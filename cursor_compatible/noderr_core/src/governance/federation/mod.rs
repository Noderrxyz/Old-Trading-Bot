// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation

//! Federation module for enabling cross-domain governance proposals and voting

pub mod types;
pub mod relay;
pub mod vote_tracker;
pub mod execution;
pub mod finality;

pub use types::{
    FederatedProposal,
    FederatedProposalStatus,
    FederatedVote,
    VoteWeight,
    DomainInfo,
    ProposalSyncState,
};

pub use relay::ProposalRelay;
pub use vote_tracker::FederatedVoteTracker;
pub use execution::FederatedExecutionEngine;
pub use finality::FinalityLock; 