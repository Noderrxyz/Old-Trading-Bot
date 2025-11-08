// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation

//! Identity and provenance module for decentralized governance

pub mod types;
pub mod verify;
pub mod domain_map;
pub mod anchor;
pub mod provenance;
pub mod examples;

// Re-export commonly used types
pub use types::{
    DIDIdentity,
    ProposalAuthRecord,
    ProposalAction,
    ProvenanceEnvelope,
    DIDMethod,
};

pub use verify::{
    DIDVerificationService,
    DIDVerifier,
    VerificationError,
    calculate_hash,
};

pub use domain_map::{
    DIDMappingService,
    DIDMapping,
    DIDMapError,
};

pub use anchor::{
    AnchorService,
    StorageProvider,
    IPFSProvider,
    ArweaveProvider,
    AnchorError,
};

pub use provenance::{
    ProvenanceService,
    ProvenanceError,
}; 