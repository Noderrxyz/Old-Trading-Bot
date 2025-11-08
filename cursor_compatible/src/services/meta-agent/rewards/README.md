# Meta-Reward System

This directory contains the refactored meta-reward system for the Noderr platform.

## Overview

The meta-reward system is responsible for managing agent rewards, verifications, and propagation of rewards through the agent influence network. It enables agents to receive rewards for valuable contributions and actions, and helps establish trust and influence within the agent ecosystem.

## Components

### Main Entry Point

- **MetaRewardEngine**: The main entry point for the reward system. It orchestrates the various services and provides a unified interface for consumers.

### Core Services

- **RewardStorage**: Handles persistence of reward events in Redis.
- **VerificationService**: Manages verification requests for high-value rewards.
- **RewardEligibility**: Checks if agents are eligible to receive or grant rewards.
- **RewardProcessor**: Applies rewards and handles their propagation through the agent network.
- **RewardPropagator**: Propagates rewards through the agent influence network.

### Key Types

- `RewardEvent`: Represents a reward event in the meta-reward system.
- `VerificationRequest`: Represents a request for verification of a high-value reward.
- `PropagationConfig`: Configuration for reward propagation.

## Usage

```typescript
import { createClient } from 'redis';
import { EventEmitter } from 'events';
import { TrustScoreService } from '../../agent/TrustScoreService.js';
import { AgentInfluenceService } from '../../agent/AgentInfluenceService.js';
import { MetaRewardEngine } from '../meta-agent/rewards/MetaRewardEngine.js';

// Initialize Redis client
const redisClient = createClient();
await redisClient.connect();

// Create EventEmitter
const events = new EventEmitter();

// Initialize services
const trustScoreService = new TrustScoreService(redisClient);
const influenceService = new AgentInfluenceService(redisClient);

// Create the MetaRewardEngine
const metaRewardEngine = new MetaRewardEngine(
  redisClient,
  events,
  trustScoreService,
  influenceService
);

// Grant a reward to an agent
await metaRewardEngine.grantReward({
  agentId: 'agent-123',
  ruleId: 'correct_prediction',
  grantedBy: null, // System granted
  metadata: { accuracy: 0.95 }
});

// Submit a verification vote
await metaRewardEngine.submitVerificationVote({
  verificationId: 'verification-456',
  voterId: 'agent-789',
  approve: true
});
```

## Architecture

The reward system follows a modular design pattern where each component has a specific responsibility:

1. **MetaRewardEngine** - Orchestrates the reward system
2. **RewardStorage** - Manages persistence of rewards
3. **VerificationService** - Handles verification of high-value rewards
4. **RewardEligibility** - Checks eligibility for receiving/granting rewards
5. **RewardProcessor** - Processes and applies rewards
6. **RewardPropagator** - Propagates rewards through the agent network

This design allows for better separation of concerns, easier testing, and more maintainable code.

## Reward Propagation

Rewards propagate through the agent influence network, allowing agents who have influenced others to receive a portion of the rewards. The propagation follows these rules:

1. When an agent receives a reward, a portion of that reward propagates to agents who have influenced them.
2. The reward decays with each hop through the network.
3. Propagation stops when the reward value falls below a minimum threshold or reaches the maximum propagation depth.
4. Circular propagation is prevented by tracking visited agents.

This propagation mechanism reinforces valuable agent behaviors and helps establish a healthy agent ecosystem.

## Reward Verification

High-value rewards require verification before they are applied. The verification process works as follows:

1. When a high-value reward is granted, a verification request is created.
2. Eligible agents can vote to approve or reject the verification.
3. Each vote's weight is determined by the voter's trust score.
4. Once sufficient votes are collected, the verification is resolved.
5. If approved, the reward is applied; if rejected, the reward is marked as unverified.

This verification process helps ensure the integrity of the reward system and prevents abuse. 