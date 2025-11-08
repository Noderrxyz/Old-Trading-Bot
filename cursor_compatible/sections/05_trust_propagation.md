# Part II: Node Structure and Communication

## Trust Propagation Model

The Trust Propagation Model is a fundamental component of the Noderr Protocol, enabling secure and efficient communication across the multi-tier node network. This model establishes a hierarchical security structure that ensures network integrity while allowing for scalable operations.

### Core Principles of Trust Propagation

The Trust Propagation Model is built on several key principles:

1. **Hierarchical Trust Flow**: Trust flows from higher-tier nodes (Oracle and Guardian) to lower-tier nodes (Validator and Micro), establishing a chain of trust that extends throughout the network.

2. **Attestation-Based Verification**: Nodes verify the trustworthiness of other nodes through cryptographic attestations, creating a web of trust that strengthens the overall security of the network.

3. **Reputation Scoring**: Nodes accumulate reputation scores based on their behavior and performance, influencing their trust level and access to sensitive operations.

4. **Progressive Trust Levels**: New nodes enter the network with minimal trust and progressively gain higher trust levels through consistent positive behavior and attestations.

5. **Trust Revocation Mechanisms**: The system includes mechanisms for rapidly revoking trust in case of detected malicious behavior or security breaches.

These principles work together to create a robust security framework that adapts to changing network conditions while maintaining strong protection against various attack vectors.

### Node Interaction Patterns

The Trust Propagation Model defines specific interaction patterns between nodes of different tiers:

#### Oracle-Guardian Interactions

Oracle Nodes interact with Guardian Nodes through a consensus-based protocol that ensures agreement on critical system parameters and operations:

```rust
/// Oracle-Guardian interaction pattern
impl OracleNode {
    /// Establish consensus with Guardian Nodes
    pub fn establish_consensus(&mut self, proposal: SystemProposal) -> ConsensusResult {
        let mut votes = Vec::new();
        
        // Collect votes from all connected Guardian Nodes
        for guardian in &self.guardians {
            let vote = guardian.vote_on_proposal(&proposal)?;
            votes.push(vote);
        }
        
        // Determine consensus based on voting rules
        let consensus = self.consensus_engine.determine_consensus(&votes);
        
        // If consensus is reached, implement the proposal
        if consensus.is_reached() {
            self.implement_proposal(&proposal)?;
        }
        
        Ok(consensus)
    }
}
```

#### Guardian-Validator Interactions

Guardian Nodes oversee Validator Nodes through a monitoring and approval system:

```rust
/// Guardian-Validator interaction pattern
impl GuardianNode {
    /// Approve Validator Node operations
    pub fn approve_validator_operation(&mut self, validator: &ValidatorNode, operation: Operation) -> ApprovalResult {
        // Verify validator's trust score
        let trust_score = self.trust_scorer.score_validator(validator);
        
        // Determine if operation is within validator's trust level
        if !self.permission_manager.is_permitted(trust_score, &operation) {
            return ApprovalResult::Denied(DenialReason::InsufficientTrustLevel);
        }
        
        // Verify operation parameters
        if let Err(reason) = self.operation_verifier.verify(&operation) {
            return ApprovalResult::Denied(reason);
        }
        
        // Approve operation
        ApprovalResult::Approved
    }
}
```

#### Validator-Micro Interactions

Validator Nodes coordinate Micro Nodes through task delegation and result verification:

```rust
/// Validator-Micro interaction pattern
impl ValidatorNode {
    /// Delegate task to Micro Node
    pub fn delegate_task(&mut self, micro: &MicroNode, task: Task) -> DelegationResult {
        // Verify micro node's capabilities
        if !micro.capabilities().contains(task.required_capability()) {
            return DelegationResult::Failed(FailureReason::InsufficientCapabilities);
        }
        
        // Assign task to micro node
        let task_id = self.task_manager.assign_task(micro, task)?;
        
        // Monitor task execution
        self.task_monitor.monitor_task(task_id);
        
        DelegationResult::Success(task_id)
    }
    
    /// Verify task result from Micro Node
    pub fn verify_task_result(&self, task_id: TaskId, result: TaskResult) -> VerificationResult {
        // Retrieve original task
        let task = self.task_manager.get_task(task_id)?;
        
        // Verify result integrity
        if !self.result_verifier.verify_integrity(&result) {
            return VerificationResult::Failed(FailureReason::IntegrityCheckFailed);
        }
        
        // Verify result correctness
        if !self.result_verifier.verify_correctness(&task, &result) {
            return VerificationResult::Failed(FailureReason::IncorrectResult);
        }
        
        // Update micro node's reputation
        self.reputation_manager.update_reputation(result.node_id(), ReputationChange::TaskCompleted);
        
        VerificationResult::Success
    }
}
```

### Trust Propagation APIs

The Trust Propagation Model is implemented through a set of APIs that enable secure communication and trust verification across the network:

#### Trust Score API

This API allows nodes to retrieve and verify trust scores:

```json
GET /api/v1/trust/score/{nodeId}

Response:
{
  "success": true,
  "data": {
    "nodeId": "validator_1a2b3c4d5e6f7g8h9i",
    "trustScore": 0.87,
    "trustLevel": "medium",
    "attestations": 42,
    "reputationFactors": {
      "uptime": 0.998,
      "taskCompletion": 0.95,
      "dataAccuracy": 0.92,
      "responseTime": 0.89
    },
    "lastUpdated": "2025-04-17T06:30:00Z"
  },
  "meta": {
    "timestamp": "2025-04-17T06:47:18Z",
    "request_id": "req_7f6e5d4c3b2a1f0e9d"
  }
}
```

#### Trust Attestation API

This API enables nodes to create and verify attestations:

```json
POST /api/v1/trust/attest
{
  "targetNodeId": "validator_1a2b3c4d5e6f7g8h9i",
  "attestationType": "performance",
  "attestationData": {
    "performanceMetrics": {
      "taskCompletionRate": 0.98,
      "averageResponseTime": 120,
      "dataAccuracy": 0.95
    },
    "observationPeriod": {
      "start": "2025-04-16T06:47:18Z",
      "end": "2025-04-17T06:47:18Z"
    }
  },
  "signature": "3045022100a1b2c3d4e5f6..."
}

Response:
{
  "success": true,
  "data": {
    "attestationId": "attest_9i8h7g6f5e4d3c2b1a",
    "status": "recorded",
    "impactOnTrustScore": 0.02,
    "newTrustScore": 0.89
  },
  "meta": {
    "timestamp": "2025-04-17T06:47:18Z",
    "request_id": "req_7f6e5d4c3b2a1f0e9d"
  }
}
```

#### Trust Chain Verification API

This API allows verification of the complete trust chain for a node:

```json
GET /api/v1/trust/chain/{nodeId}

Response:
{
  "success": true,
  "data": {
    "nodeId": "validator_1a2b3c4d5e6f7g8h9i",
    "trustChain": [
      {
        "attesterId": "oracle_9d8c7b6a5f4e3d2c1b",
        "attestationId": "attest_1a2b3c4d5e6f7g8h9i",
        "timestamp": "2025-04-15T12:30:45Z",
        "attestationType": "identity"
      },
      {
        "attesterId": "guardian_8c7b6a5f4e3d2c1b9a",
        "attestationId": "attest_2b3c4d5e6f7g8h9i1a",
        "timestamp": "2025-04-16T08:15:22Z",
        "attestationType": "capability"
      },
      {
        "attesterId": "guardian_7b6a5f4e3d2c1b9a8c",
        "attestationId": "attest_3c4d5e6f7g8h9i1a2b",
        "timestamp": "2025-04-17T03:42:18Z",
        "attestationType": "performance"
      }
    ],
    "verificationStatus": "valid",
    "trustScore": 0.89,
    "trustLevel": "medium"
  },
  "meta": {
    "timestamp": "2025-04-17T06:47:18Z",
    "request_id": "req_7f6e5d4c3b2a1f0e9d"
  }
}
```

### Trust Implementation Code Examples

The Trust Propagation Model is implemented through a combination of cryptographic primitives and distributed systems techniques:

#### Trust Scoring Implementation

```rust
/// Trust scoring implementation
pub struct TrustScorer {
    /// Database connection for persistent storage
    db: Arc<Database>,
    /// Cryptographic verification engine
    crypto_verifier: Arc<CryptoVerifier>,
    /// Attestation weights for different attestation types
    attestation_weights: HashMap<AttestationType, f64>,
    /// Reputation factors and their weights
    reputation_weights: HashMap<ReputationFactor, f64>,
}

impl TrustScorer {
    /// Calculate trust score for a node
    pub fn calculate_trust_score(&self, node_id: &NodeId) -> Result<TrustScore, TrustScoringError> {
        // Retrieve all attestations for the node
        let attestations = self.db.get_attestations_for_node(node_id)?;
        
        // Verify attestation signatures
        let valid_attestations = attestations
            .into_iter()
            .filter(|attestation| self.crypto_verifier.verify_attestation(attestation).is_ok())
            .collect::<Vec<_>>();
        
        // Calculate attestation component of trust score
        let attestation_score = self.calculate_attestation_score(&valid_attestations);
        
        // Retrieve reputation data for the node
        let reputation_data = self.db.get_reputation_data_for_node(node_id)?;
        
        // Calculate reputation component of trust score
        let reputation_score = self.calculate_reputation_score(&reputation_data);
        
        // Combine scores with appropriate weights
        let combined_score = (attestation_score * 0.7) + (reputation_score * 0.3);
        
        // Apply any penalties or bonuses
        let final_score = self.apply_adjustments(node_id, combined_score)?;
        
        Ok(TrustScore::new(final_score))
    }
    
    // Additional methods for calculating component scores...
}
```

#### Attestation Verification Implementation

```python
# Python implementation of attestation verification
class AttestationVerifier:
    def __init__(self, crypto_service, node_registry):
        self.crypto_service = crypto_service
        self.node_registry = node_registry
    
    def verify_attestation(self, attestation):
        """Verify the validity of an attestation."""
        # Check if attester is registered
        attester = self.node_registry.get_node(attestation.attester_id)
        if not attester:
            return VerificationResult(False, "Attester not found")
        
        # Check if attester has sufficient trust level to create this type of attestation
        if not self._has_attestation_permission(attester, attestation.attestation_type):
            return VerificationResult(False, "Insufficient trust level for attestation")
        
        # Verify signature
        if not self.crypto_service.verify_signature(
            attestation.data_hash,
            attestation.signature,
            attester.public_key
        ):
            return VerificationResult(False, "Invalid signature")
        
        # Verify attestation data
        if not self._verify_attestation_data(attestation):
            return VerificationResult(False, "Invalid attestation data")
        
        return VerificationResult(True, "Attestation verified")
    
    def _has_attestation_permission(self, attester, attestation_type):
        """Check if attester has permission to create this type of attestation."""
        # Implementation details...
        pass
    
    def _verify_attestation_data(self, attestation):
        """Verify the data contained in the attestation."""
        # Implementation details...
        pass
```

The Trust Propagation Model is a critical component of the Noderr Protocol, enabling secure and efficient operation across the multi-tier node network. By establishing a hierarchical trust structure with clear interaction patterns and verification mechanisms, the protocol ensures both security and scalability in a decentralized environment.
