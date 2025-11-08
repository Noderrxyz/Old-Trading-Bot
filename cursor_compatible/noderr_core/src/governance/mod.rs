// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation

//! Governance module for enforcing Meta-Protocol rules across the system

pub mod types;
pub mod enforcer;
pub mod violation_log;
pub mod federation;
pub mod identity;

pub use types::{
    GovernanceRule, 
    RuleViolation, 
    GovernanceActionType,
    RuleSeverity,
    EnforcementResult
};
pub use enforcer::{
    GovernanceEnforcer,
    RedisGovernanceEnforcer,
    MockGovernanceEnforcer,
};
pub use violation_log::ViolationLogger;
pub use federation::{
    FederatedProposal,
    FederatedVote,
    ProposalRelay,
    FederatedVoteTracker,
    FederatedExecutionEngine,
    FinalityLock
};
pub use identity::{
    DIDIdentity,
    ProposalAuthRecord,
    ProposalAction,
    ProvenanceEnvelope,
    DIDMethod,
    DIDVerificationService,
    DIDMappingService,
    AnchorService,
    ProvenanceService,
}; 