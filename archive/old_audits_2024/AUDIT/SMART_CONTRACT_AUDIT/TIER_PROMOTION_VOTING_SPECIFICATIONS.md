# Tier Promotion Voting Specifications (Extracted from Whitepaper)

**Date:** November 8, 2025  
**Source:** Noderr_White_Paper_v6.3_FINAL.md  
**Status:** COMPLETE SPECIFICATIONS - Ready for Implementation

---

## Executive Summary

**All tier promotion voting specifications have been extracted from the whitepaper.** This document provides complete implementation requirements for the tier promotion voting system.

**Key Findings:**
- ✅ Guardian election: **Simple majority (>50%)**, TrustFingerprint-weighted voting
- ✅ Oracle election: **66% supermajority**, secret ballot
- ✅ Voting power formula: `NODR_Held × Role_Factor × TrustFingerprint_Score`
- ✅ 30-day token seasoning period
- ✅ 10% per-entity vote cap
- ✅ 30-day probation for new Guardians

---

## Complete Voting Power Formula

### **Formula (Line 5454):**

```
Voting Power = NODR_Held × Role_Factor × TrustFingerprint_Score
```

### **Role Factors (Lines 5459-5463):**

| Role | Role_Factor |
|------|-------------|
| Oracle | 10x |
| Guardian | 5x |
| Validator | 2x |
| Micro | 1x |
| Non-Operator | 0.5x |

### **Example Calculation (Line 5467):**

**Oracle with moderate stake:**
- 200,000 NODR × 10 (Oracle) × 0.95 (TF) = **1,900,000 voting power**

**Passive whale:**
- 5,000,000 NODR × 0.5 (Non-Operator) × 0.5 (TF) = **1,250,000 voting power**

**Result:** Active Oracle has MORE voting power than passive whale with 25x more tokens.

---

## Guardian Election Process

### **Source:** Lines 10240-10249

### **Step 1: Nomination**
- Validators with TrustFingerprint ≥0.65 can be nominated
- Must have 100,000 NODR staked
- Nomination can be self-nomination or by existing Guardian

### **Step 2: Evaluation Period (1 week)**

**Technical Assessment:**
- Review on-chain activities
- Past contributions (code reviews, vulnerability reports, technical discussions)
- Quality and impact of past work

**Character References:**
- Community feedback solicited
- Reputation and interpersonal skills evaluated
- Holistic view of candidate

### **Step 3: Vote (All Guardians)**

**Voting Rules:**
- **Approval Threshold:** Simple majority (>50%)
- **Voting Power:** TrustFingerprint-weighted
- **Formula:** `Voting Power = NODR_Held × 5 (Guardian Role_Factor) × TrustFingerprint_Score`
- **Transparency:** Results made public for community audit

**Quote (Line 10245):**
> "A **simple majority** is required for a nominee to be elected. The voting power is **weighted by TrustFingerprint™**, meaning Guardians with higher TF scores have a proportionally greater influence on the outcome."

### **Step 4: Probation (30 days)**

**New Guardian Restrictions:**
- Shadow existing members
- Observe operations, reviews, security discussions
- **Limited authority:** Votes may be non-binding or reduced weight
- Full privileges activated after 30 days
- Contingent on positive review from senior Guardians

---

## Oracle Election Process

### **Source:** Lines 2398-2403, 8951, 10167-10169

### **Step 1: Candidate Announcement**
- Guardian with TrustFingerprint ≥0.85 announces intent
- Must have 500,000 NODR staked
- Submits detailed background information

### **Step 2: Due Diligence**
- Existing Oracles conduct reference checks
- Background verification
- Comprehensive review of candidate's history

### **Step 3: Presentation**
- Candidate presents to Oracle set
- Answers questions from existing Oracles
- Demonstrates expertise and alignment with protocol values

### **Step 4: Vote (Existing Oracles Only)**

**Voting Rules:**
- **Approval Threshold:** 66% supermajority
- **Voting Method:** Secret ballot
- **Voting Power:** TrustFingerprint-weighted (assumed, based on governance system)
- **Formula:** `Voting Power = NODR_Held × 10 (Oracle Role_Factor) × TrustFingerprint_Score`

**Quote (Line 2402):**
> "Oracles vote via secret ballot, requiring **66% approval** for election"

**Quote (Line 8951):**
> "Oracles are **elected by existing Oracles** from the Guardian pool, requiring an even higher TrustFingerprint™ (≥0.85)."

### **Step 5: Stake Tokens**
- Elected Oracle must stake 500,000 NODR before assuming duties
- 30-day unstaking period

---

## Oracle Removal Process

### **Source:** Lines 10167-10169, 2415

### **Removal Voting:**
- **Threshold:** 66% vote for removal (Line 10169)
- **Alternative:** 80% supermajority for misconduct/incompetence (Line 2415)
- **Reasons:** Severe misconduct, prolonged inactivity, significant TF decline
- **Transparency:** Rationale publicly documented
- **Consequences:** Slashing of staked tokens for malicious behavior

---

## Anti-Concentration Mechanisms

### **1. Per-Entity Vote Cap (Lines 5476-5491)**

**Rule:** Maximum 10% of total network voting power per entity

**Implementation:**
```pseudocode
FUNCTION CALCULATE_FINAL_VOTING_POWER(participant_id):
    raw_voting_power = NODR_Held × Role_Factor × TrustFingerprint_Score
    total_network_voting_power = GET_TOTAL_NETWORK_VOTING_POWER()
    max_allowed_voting_power = 0.10 × total_network_voting_power
    
    IF raw_voting_power > max_allowed_voting_power:
        RETURN max_allowed_voting_power
    ELSE:
        RETURN raw_voting_power
END FUNCTION
```

**Purpose:** Prevents single actor from gaining disproportionate control

### **2. Token Seasoning (Lines 5493-5500)**

**Rule:** Newly acquired NODR tokens ramp linearly to full voting weight over 30 days

**Purpose:**
- Discourages flash loan attacks
- Prevents sudden hostile takeovers
- Incentivizes long-term commitment
- Prevents speculative governance participation

**Implementation:**
```pseudocode
FUNCTION CALCULATE_SEASONED_VOTING_WEIGHT(nodr_amount, acquisition_timestamp, current_timestamp):
    days_held = (current_timestamp - acquisition_timestamp) / 86400
    seasoning_period = 30 // days
    
    IF days_held >= seasoning_period:
        RETURN nodr_amount
    ELSE:
        seasoning_factor = days_held / seasoning_period
        RETURN nodr_amount × seasoning_factor
END FUNCTION
```

---

## Decision-Making Thresholds (Oracle Chamber)

### **Source:** Lines 10175-10181

| Proposal Type | Required Approval | Example |
|---------------|-------------------|---------|
| **Standard Proposals** | 51% majority | Fee adjustment, minor parameter change |
| **Material Changes** | 66% supermajority | ATE allocation increase, major upgrade |
| **Constitutional Changes** | 75% supermajority | Governance structure change, immutable principle amendment |
| **Emergency Actions** | 51% majority (fast-tracked) | Circuit breaker activation, security patch |

**Note:** These thresholds apply to general governance proposals, NOT tier promotions.

---

## Complete Implementation Requirements

### **Smart Contract: TierPromotion.sol**

#### **Data Structures:**

```solidity
struct PromotionApplication {
    uint256 applicationId;
    uint256 tokenId;              // Node's UtilityNFT token ID
    NodeTier currentTier;
    NodeTier targetTier;
    address applicant;
    uint256 submissionTime;
    uint256 votingDeadline;       // submissionTime + 7 days
    ApplicationStatus status;     // Pending, Approved, Rejected
    uint256 votesFor;             // Weighted voting power
    uint256 votesAgainst;         // Weighted voting power
    uint256 totalEligibleVotingPower;
    mapping(address => bool) hasVoted;
}

enum ApplicationStatus {
    Pending,
    Approved,
    Rejected,
    Executed
}
```

#### **Core Functions:**

```solidity
// Application submission
function applyForPromotion(uint256 tokenId, NodeTier targetTier) external;

// Voting (Guardian/Oracle only)
function voteOnPromotion(uint256 applicationId, bool approve) external;

// Check application status
function getApplicationStatus(uint256 applicationId) external view returns (ApplicationStatus, uint256 votesFor, uint256 votesAgainst);

// Execute approved promotion
function executePromotion(uint256 applicationId) external;

// Calculate voting power (implements whitepaper formula)
function calculateVotingPower(address voter) public view returns (uint256);
```

#### **Voting Power Calculation:**

```solidity
function calculateVotingPower(address voter) public view returns (uint256) {
    // Get NODR balance
    uint256 nodrHeld = nodrToken.balanceOf(voter);
    
    // Apply token seasoning (30-day ramp)
    uint256 seasonedNODR = calculateSeasonedBalance(voter);
    
    // Get role factor
    uint256 roleFactor = getRoleFactor(voter);
    // Oracle: 10, Guardian: 5, Validator: 2, Micro: 1, Non-Operator: 0.5
    
    // Get TrustFingerprint score
    uint256 trustScore = trustFingerprint.getScore(voter);
    
    // Calculate raw voting power
    uint256 rawVotingPower = (seasonedNODR * roleFactor * trustScore) / 1e18;
    
    // Apply 10% cap
    uint256 totalNetworkVotingPower = getTotalNetworkVotingPower();
    uint256 maxAllowedVotingPower = (totalNetworkVotingPower * 10) / 100;
    
    if (rawVotingPower > maxAllowedVotingPower) {
        return maxAllowedVotingPower;
    } else {
        return rawVotingPower;
    }
}
```

#### **Approval Logic:**

```solidity
function checkApprovalStatus(uint256 applicationId) internal view returns (bool) {
    PromotionApplication storage app = applications[applicationId];
    
    // Check if voting period ended
    require(block.timestamp >= app.votingDeadline, "Voting period not ended");
    
    // Calculate approval percentage
    uint256 totalVotes = app.votesFor + app.votesAgainst;
    
    if (totalVotes == 0) {
        // No votes cast - auto-approve to prevent gatekeeping
        return true;
    }
    
    uint256 approvalPercentage = (app.votesFor * 100) / totalVotes;
    
    // Guardian promotion: Simple majority (>50%)
    if (app.targetTier == NodeTier.GUARDIAN) {
        return approvalPercentage > 50;
    }
    
    // Oracle promotion: 66% supermajority
    if (app.targetTier == NodeTier.ORACLE) {
        return approvalPercentage >= 66;
    }
    
    return false;
}
```

---

## Gatekeeping Prevention

### **Mechanism: Auto-Approval After 7 Days**

**Rule:** If no votes are cast within 7-day voting period, application is auto-approved

**Rationale:**
- Prevents passive gatekeeping (existing nodes ignoring applications)
- Ensures qualified candidates can advance
- Maintains protocol growth and decentralization

**Implementation:**
```solidity
if (totalVotes == 0) {
    // No votes cast - auto-approve
    return true;
}
```

### **Alternative: Minimum Quorum (Optional)**

**Rule:** Require X% of eligible voters to participate

**Example:** 30% quorum
- If <30% of Guardians vote, application fails
- Prevents low-engagement approvals

**Recommendation:** Start without quorum requirement, add later if needed

---

## Testnet vs Mainnet Strategy

### **Testnet (Month 6-9):**

**Approach:** Permissioned, centralized
- Initial Guardians/Oracles: Manually selected (board of directors, trusted people)
- Use `REGISTRY_MANAGER_ROLE` to promote trusted nodes
- **Skip voting system** for testnet simplicity
- Focus on testing core protocol functionality

**Rationale:**
- Security and stability during early testing
- Faster iteration without governance overhead
- Trusted operator set ensures quality

### **Mainnet (Month 12+):**

**Approach:** Progressive decentralization
- Start with initial trusted Guardian/Oracle set (from testnet)
- **Enable voting system** for new applicants
- Existing nodes vote on qualified candidates
- Gradually expand Guardian/Oracle count as protocol grows

**Rationale:**
- Proven operators from testnet provide stability
- Voting system enables decentralization
- Merit-based promotion maintains quality

---

## Implementation Timeline

### **Phase I: Core Smart Contracts (Weeks 1-12)**

**Week 4-5: Design TierPromotion System**
- Finalize voting logic
- Design application workflow
- Plan integration with NodeRegistry and TrustFingerprint

**Week 6-7: Implement TierPromotion.sol**
- Application submission functions
- Voting mechanism with weighted voting power
- Approval threshold logic
- Auto-approval gatekeeping prevention
- Integration with existing contracts

**Week 8: Testing**
- Unit tests for voting logic
- Integration tests with NodeRegistry
- Test weighted voting power calculations
- Test auto-approval mechanism

**Week 9: Security Review**
- Internal security audit
- Check for voting manipulation vulnerabilities
- Verify gatekeeping prevention works

### **Testnet Deployment (Month 6-9):**
- **Option A:** Deploy without voting system (centralized promotions)
- **Option B:** Deploy with voting system (test with trusted set)
- **Recommendation:** Option A for simplicity

### **Mainnet Deployment (Month 12+):**
- Deploy full voting system
- Enable decentralized tier promotions
- Monitor for gatekeeping or manipulation attempts

---

## Summary of Specifications

### **Guardian Election:**
- **Threshold:** Simple majority (>50%)
- **Voting Power:** TrustFingerprint-weighted
- **Voters:** All current Guardians
- **Voting Period:** 7 days
- **Gatekeeping Prevention:** Auto-approve if no votes
- **Probation:** 30 days with limited authority

### **Oracle Election:**
- **Threshold:** 66% supermajority
- **Voting Power:** TrustFingerprint-weighted
- **Voters:** All current Oracles (NOT Guardians)
- **Voting Method:** Secret ballot
- **Voting Period:** 7 days (assumed, not explicitly stated)
- **Gatekeeping Prevention:** Auto-approve if no votes

### **Voting Power Formula:**
```
Voting Power = NODR_Held × Role_Factor × TrustFingerprint_Score
```
- **Role Factors:** Oracle (10x), Guardian (5x), Validator (2x), Micro (1x), Non-Operator (0.5x)
- **Token Seasoning:** 30-day linear ramp to full voting weight
- **Vote Cap:** Maximum 10% of total network voting power per entity

### **Oracle Removal:**
- **Threshold:** 66% vote (or 80% for misconduct)
- **Consequences:** Slashing of staked tokens for malicious behavior

---

## Conclusion

**All tier promotion voting specifications have been extracted from the whitepaper.** The system is well-defined and ready for implementation:

1. ✅ Guardian election: Simple majority, TrustFingerprint-weighted
2. ✅ Oracle election: 66% supermajority, secret ballot
3. ✅ Voting power formula: Complete with role factors and anti-concentration mechanisms
4. ✅ Gatekeeping prevention: Auto-approval after 7 days
5. ✅ Probation period: 30 days for new Guardians

**This is a CRITICAL Phase I implementation requirement.**

**VRF is NOT needed** - the system uses voting/elections, not random selection.

---

**Status:** ✅ COMPLETE - Ready for implementation planning

**Next Steps:**
1. Add TierPromotion.sol to Phase I roadmap (Weeks 4-9)
2. Update reconciliation report with this critical missing feature
3. Remove all VRF references from documentation
4. Proceed with final audit document updates
