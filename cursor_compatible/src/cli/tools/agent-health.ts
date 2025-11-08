#!/usr/bin/env node
/**
 * Agent Health CLI
 * 
 * Command-line tool for monitoring and managing agent health states.
 * Allows viewing agent health modes, manually triggering self-healing,
 * and checking recovery eligibility.
 */

import { RedisService } from '../../services/infrastructure/RedisService.js';
import { TrustScoreService } from '../../services/agent/TrustScoreService.js';
import { AgentHealthManager } from '../../services/agent/AgentHealthManager.js';
import { AgentHealthMode } from '../../types/agent.types.js';

// Process command line arguments
const args = process.argv.slice(2);
const command = args[0]?.toLowerCase();

/**
 * Print usage instructions
 */
function printUsage(): void {
  console.log('Usage:');
  console.log('  agent-health list                        - List all agents with health status');
  console.log('  agent-health get <agentId>               - Get health status for an agent');
  console.log('  agent-health simulate-success <agentId>  - Simulate successful operation for an agent');
  console.log('  agent-health simulate-failure <agentId>  - Simulate failed operation for an agent');
  console.log('  agent-health monitor                     - Monitor agent health events in real-time');
  console.log('  agent-health help                        - Show this help message');
}

/**
 * Format health mode with color
 */
function formatHealthMode(mode: AgentHealthMode): string {
  if (mode === AgentHealthMode.SELF_HEALING) {
    return `\x1b[33m${mode}\x1b[0m`; // Yellow
  } else if (mode === AgentHealthMode.CRITICAL) {
    return `\x1b[31m${mode}\x1b[0m`; // Red
  } else {
    return `\x1b[32m${mode}\x1b[0m`; // Green
  }
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const redis = new RedisService();
  const trustService = new TrustScoreService(redis);
  const healthManager = new AgentHealthManager(trustService, redis);
  
  try {
    switch (command) {
      case 'list':
        await listAgentHealth(redis, trustService);
        break;
        
      case 'get':
        if (args.length < 2) {
          console.error('Error: Missing agent ID');
          printUsage();
          process.exit(1);
        }
        await getAgentHealth(trustService, healthManager, args[1]);
        break;
        
      case 'simulate-success':
        if (args.length < 2) {
          console.error('Error: Missing agent ID');
          printUsage();
          process.exit(1);
        }
        await simulateSuccess(healthManager, args[1]);
        break;
        
      case 'simulate-failure':
        if (args.length < 2) {
          console.error('Error: Missing agent ID');
          printUsage();
          process.exit(1);
        }
        await simulateFailure(healthManager, args[1]);
        break;
        
      case 'monitor':
        await monitorHealthEvents(redis);
        break;
        
      case 'help':
      default:
        printUsage();
        break;
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Only close Redis if we're not monitoring (which is ongoing)
    if (command !== 'monitor') {
      await redis.close();
    }
  }
}

/**
 * List all agents with their health status
 */
async function listAgentHealth(redis: RedisService, trustService: TrustScoreService): Promise<void> {
  const keys = await redis.keys('agent:*:trust_score');
  
  if (keys.length === 0) {
    console.log('No agents with trust scores found');
    return;
  }
  
  console.log('Agent health status:');
  console.log('-'.repeat(70));
  console.log('AGENT ID'.padEnd(20) + 'TRUST SCORE'.padEnd(15) + 'HEALTH MODE'.padEnd(15) + 'HEALING TIME');
  console.log('-'.repeat(70));
  
  for (const key of keys) {
    const parts = key.split(':');
    const agentId = parts[1];
    const trustState = await trustService.getTrustState(agentId);
    
    // Format healing time if applicable
    let healingTime = 'N/A';
    if (trustState.enteredSelfHealingAt) {
      const timeInHealingMs = Date.now() - trustState.enteredSelfHealingAt;
      const minutes = Math.floor(timeInHealingMs / 60000);
      healingTime = `${minutes} min`;
    }
    
    // Get colored health mode display
    const healthModeDisplay = formatHealthMode(trustState.mode);
    
    console.log(
      `${agentId}`.padEnd(20) + 
      `${trustState.score.toFixed(1)}`.padEnd(15) + 
      `${healthModeDisplay}`.padEnd(25) + 
      `${healingTime}`
    );
  }
}

/**
 * Get detailed health status for an agent
 */
async function getAgentHealth(
  trustService: TrustScoreService, 
  healthManager: AgentHealthManager,
  agentId: string
): Promise<void> {
  const trustState = await trustService.getTrustState(agentId);
  const adjustments = await healthManager.getHealthAdjustments(agentId);
  
  console.log(`Health status for agent ${agentId}:`);
  console.log('-'.repeat(50));
  console.log(`Trust Score: ${trustState.score.toFixed(1)}`);
  
  // Get colored health mode display
  const healthModeDisplay = formatHealthMode(trustState.mode);
  console.log(`Health Mode: ${healthModeDisplay}`);
  
  // Show healing info if applicable
  if (trustState.enteredSelfHealingAt) {
    const healingStartDate = new Date(trustState.enteredSelfHealingAt).toLocaleString();
    const timeInHealingMs = Date.now() - trustState.enteredSelfHealingAt;
    const minutes = Math.floor(timeInHealingMs / 60000);
    
    console.log(`Entered Self-Healing: ${healingStartDate} (${minutes} minutes ago)`);
    
    // Get healing success count
    const metaKey = `agent:${agentId}:trust_meta`;
    const successCountRaw = await trustService['redis'].hget(metaKey, 'healing_success_count');
    const successCount = successCountRaw ? parseInt(successCountRaw) : 0;
    
    console.log(`Healing Progress: ${successCount}/5 successful operations`);
  }
  
  // Show behavior adjustments
  console.log('\nBehavior Adjustments:');
  console.log(`Signal Throttle: ${adjustments.signalThrottleMultiplier * 100}%`);
  console.log(`Min Confidence: ${adjustments.minConfidenceThreshold * 100}%`);
  console.log(`Output Suppressed: ${adjustments.isSuppressed ? 'Yes' : 'No'}`);
  console.log(`Recovery Boost: ${adjustments.recoveryBoost}x`);
}

/**
 * Simulate a successful operation for an agent
 */
async function simulateSuccess(healthManager: AgentHealthManager, agentId: string): Promise<void> {
  const newScore = await healthManager.recordHealingSuccess(agentId);
  console.log(`Simulated successful operation for agent ${agentId}`);
  console.log(`New trust score: ${newScore.toFixed(1)}`);
}

/**
 * Simulate a failed operation for an agent
 */
async function simulateFailure(healthManager: AgentHealthManager, agentId: string): Promise<void> {
  const severity = Math.random(); // Random severity between 0-1
  const newScore = await healthManager.recordFailure(agentId, severity);
  console.log(`Simulated failed operation for agent ${agentId} (severity: ${severity.toFixed(2)})`);
  console.log(`New trust score: ${newScore.toFixed(1)}`);
}

/**
 * Monitor agent health events in real-time
 */
async function monitorHealthEvents(redis: RedisService): Promise<void> {
  console.log('Monitoring agent health events in real-time. Press Ctrl+C to exit.');
  console.log('-'.repeat(100));
  
  // Create a duplicate Redis client for subscribing
  const subRedis = new RedisService();
  
  // Handle exiting
  process.on('SIGINT', async () => {
    console.log('\nStopping monitor...');
    await subRedis.close();
    await redis.close();
    process.exit(0);
  });
  
  // Subscribe to agent trust state events
  const client = (subRedis as any).client;
  
  client.subscribe('agent:trust_state', (err: any) => {
    if (err) {
      console.error('Error subscribing to health events:', err);
      process.exit(1);
    }
    console.log('Subscribed to agent health events');
  });
  
  client.on('message', (_channel: string, message: string) => {
    try {
      const event = JSON.parse(message);
      const timestamp = new Date(event.timestamp).toLocaleString();
      
      // Color based on mode
      let coloredMode: string;
      if (event.mode === AgentHealthMode.SELF_HEALING) {
        coloredMode = `\x1b[33m${event.mode}\x1b[0m`; // Yellow
      } else if (event.mode === AgentHealthMode.CRITICAL) {
        coloredMode = `\x1b[31m${event.mode}\x1b[0m`; // Red
      } else {
        coloredMode = `\x1b[32m${event.mode}\x1b[0m`; // Green
      }
      
      console.log(`[${timestamp}] Agent ${event.agentId}: Trust=${event.trustScore.toFixed(1)}, Mode=${coloredMode}`);
    } catch (error) {
      console.error('Error parsing event:', error);
    }
  });
}

// Run the CLI
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 