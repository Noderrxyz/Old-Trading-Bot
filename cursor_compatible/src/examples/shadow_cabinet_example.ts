/**
 * Shadow Cabinet Example
 * 
 * Demonstrates the functionality of the Shadow Cabinet system
 * for parallel proposal tracks and counterfactual testing
 */

import { RedisClient } from '../common/redis.js';
import { initializeGovernance, getProposalService, ProposalType } from '../governance/index.js';
import { getShadowCabinetEngine, getGovernanceOracle } from '../governance/shadow/index.js';
import { SimulationMode } from '../types/governance-shadow.types.js';

async function main() {
  // Initialize Redis client
  const redisClient = new RedisClient({
    host: 'localhost',
    port: 6379
  });
  await redisClient.connect();
  
  console.log('Connected to Redis');
  
  try {
    // Initialize governance system with shadow cabinet enabled
    await initializeGovernance(redisClient, { enableShadowCabinet: true });
    console.log('Governance system initialized with Shadow Cabinet support');
    
    // Get the proposal service
    const proposalService = getProposalService();
    
    // Step 1: Create a new proposal in the main system
    const proposal = await proposalService.createProposal(
      'agent-123',
      'Increase resource allocation for AI agents',
      'Proposal to increase the computational resources allocated to AI agents by 25%',
      ProposalType.PARAMETER_CHANGE,
      {
        resourceAllocation: {
          currentValue: 100,
          proposedValue: 125,
          unit: 'CPU cores'
        }
      },
      {
        expiryHours: 24,
        requiredQuorum: 3.0,
        requiredApprovalThreshold: 2.5
      }
    );
    
    console.log(`Created proposal ${proposal.id} in main system`);
    
    // Step 2: Create a shadow cabinet
    const shadowEngine = getShadowCabinetEngine();
    const cabinet = await shadowEngine.createShadowCabinet(
      'main-council',
      ['agent-456', 'agent-789'],
      'Resource optimization shadow cabinet'
    );
    
    console.log(`Created shadow cabinet ${cabinet.id} with ${cabinet.members.length} members`);
    
    // Step 3: Fork the proposal with alternative parameters
    const fork = await shadowEngine.forkProposalTrack(
      proposal.id,
      cabinet.id,
      {
        title: 'Optimize resource allocation for AI agents',
        description: 'Alternative proposal for a more balanced approach to resource allocation',
        data: {
          resourceAllocation: {
            currentValue: 100,
            proposedValue: 115,
            unit: 'CPU cores'
          },
          additionalParameters: {
            optimizationEnabled: true,
            dynamicScaling: true
          }
        }
      },
      SimulationMode.READ_ONLY,
      true // Make this fork public
    );
    
    console.log(`Created forked proposal ${fork.id} from original ${proposal.id}`);
    
    // Step 4: Run simulation on the forked proposal
    const outcome = await shadowEngine.simulateOutcome(fork.id);
    
    if (outcome) {
      console.log('Simulation completed with the following outcome:');
      console.log(`- Impact score: ${outcome.impactScore}`);
      console.log(`- Proposal would ${outcome.proposalSuccess ? 'succeed' : 'fail'}`);
      console.log(`- Confidence: ${outcome.confidence || 0}`);
      
      // Key metrics
      console.log('Key metrics:');
      Object.entries(outcome.metrics).forEach(([key, value]) => {
        console.log(`- ${key}: ${value}`);
      });
      
      // Agent trust changes
      console.log('Agent trust changes:');
      Object.entries(outcome.trustDelta).forEach(([agentId, delta]) => {
        console.log(`- ${agentId}: ${delta > 0 ? '+' : ''}${delta}`);
      });
    } else {
      console.log('Simulation failed');
    }
    
    // Step 5: Get the oracle's evaluation (in a real system, this would happen after the original proposal is implemented)
    const oracle = getGovernanceOracle();
    
    // Artificially set the original proposal to be completed
    // In a real system, this would happen naturally through the governance process
    await proposalService.checkProposalStatus(proposal.id);
    
    // Compare the proposals
    const result = await oracle.evaluateFork(proposal.id, fork.id);
    console.log(`Oracle evaluation: The ${result} proposal would have been better`);
    
    // Step 6: Get all forks for the original proposal
    const allForks = shadowEngine.getForksForProposal(proposal.id);
    console.log(`Total alternative proposals for ${proposal.id}: ${allForks.length}`);
    
    console.log('Shadow Cabinet demonstration completed successfully');
  } catch (error) {
    console.error('Error in Shadow Cabinet demonstration:', error);
  } finally {
    // Disconnect from Redis
    await redisClient.disconnect();
  }
}

// Run the example
main().catch(console.error); 