#!/usr/bin/env node
/**
 * Trust Manager CLI
 * 
 * Command-line tool for managing agent trust scores, 
 * and testing trust decay and slashing functionality.
 */

import { RedisService } from '../../services/infrastructure/RedisService.js';
import { TrustScoreService } from '../../services/agent/TrustScoreService.js';
import { TrustDecayManager, ViolationSeverity } from '../../services/agent/TrustDecayManager.js';

// Process command line arguments
const args = process.argv.slice(2);
const command = args[0]?.toLowerCase();

/**
 * Print usage instructions
 */
function printUsage(): void {
  console.log('Usage:');
  console.log('  trust-manager list                      - List all agents with trust scores');
  console.log('  trust-manager get <agentId>             - Get trust score for an agent');
  console.log('  trust-manager set <agentId> <score>     - Set trust score for an agent');
  console.log('  trust-manager adjust <agentId> <delta>  - Adjust trust score by delta');
  console.log('  trust-manager slash <agentId> <minor|moderate|severe> <reason>');
  console.log('                                          - Slash trust for a violation');
  console.log('  trust-manager history [agentId]         - Show trust slashing history');
  console.log('  trust-manager decay [--all]             - Run trust decay process');
  console.log('  trust-manager help                      - Show this help message');
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const redis = new RedisService();
  const trustService = new TrustScoreService(redis);
  const decayManager = new TrustDecayManager(trustService, redis);
  
  try {
    switch (command) {
      case 'list': 
        await listAgents(redis, trustService);
        break;
        
      case 'get':
        if (args.length < 2) {
          console.error('Error: Missing agent ID');
          printUsage();
          process.exit(1);
        }
        await getAgentTrust(trustService, args[1]);
        break;
        
      case 'set':
        if (args.length < 3) {
          console.error('Error: Missing agent ID or score');
          printUsage();
          process.exit(1);
        }
        await setAgentTrust(trustService, args[1], Number(args[2]));
        break;
        
      case 'adjust':
        if (args.length < 3) {
          console.error('Error: Missing agent ID or delta');
          printUsage();
          process.exit(1);
        }
        await adjustAgentTrust(trustService, args[1], Number(args[2]));
        break;
        
      case 'slash':
        if (args.length < 4) {
          console.error('Error: Missing required arguments');
          printUsage();
          process.exit(1);
        }
        await slashAgentTrust(decayManager, args[1], args[2], args[3]);
        break;
        
      case 'history':
        await showSlashingHistory(decayManager, args[1]);
        break;
        
      case 'decay':
        await runDecay(decayManager, args.includes('--all'));
        break;
        
      case 'help':
      default:
        printUsage();
        break;
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await redis.close();
  }
}

/**
 * List all agents with trust scores
 */
async function listAgents(redis: RedisService, trustService: TrustScoreService): Promise<void> {
  const keys = await redis.keys('agent:*:trust_score');
  
  if (keys.length === 0) {
    console.log('No agents with trust scores found');
    return;
  }
  
  console.log('Agents with trust scores:');
  console.log('-'.repeat(50));
  console.log('AGENT ID'.padEnd(20) + 'TRUST SCORE'.padEnd(15) + 'WEIGHT');
  console.log('-'.repeat(50));
  
  for (const key of keys) {
    const parts = key.split(':');
    const agentId = parts[1];
    const score = await trustService.getScore(agentId);
    const weight = await trustService.getWeight(agentId);
    
    console.log(`${agentId}`.padEnd(20) + 
                `${score.toFixed(1)}`.padEnd(15) + 
                `${weight.toFixed(2)}`);
  }
}

/**
 * Get trust score for an agent
 */
async function getAgentTrust(trustService: TrustScoreService, agentId: string): Promise<void> {
  const score = await trustService.getScore(agentId);
  const weight = await trustService.getWeight(agentId);
  
  console.log(`Trust score for agent ${agentId}:`);
  console.log(`Score: ${score.toFixed(1)}`);
  console.log(`Weight: ${weight.toFixed(2)}`);
}

/**
 * Set trust score for an agent
 */
async function setAgentTrust(
  trustService: TrustScoreService, 
  agentId: string, 
  score: number
): Promise<void> {
  await trustService.updateScore(agentId, score);
  console.log(`Set trust score for agent ${agentId} to ${score}`);
}

/**
 * Adjust trust score for an agent
 */
async function adjustAgentTrust(
  trustService: TrustScoreService, 
  agentId: string, 
  delta: number
): Promise<void> {
  const oldScore = await trustService.getScore(agentId);
  const newScore = await trustService.adjustScore(agentId, delta);
  
  console.log(`Adjusted trust for agent ${agentId}: ${oldScore} -> ${newScore} (${delta >= 0 ? '+' : ''}${delta})`);
}

/**
 * Slash trust for a violation
 */
async function slashAgentTrust(
  decayManager: TrustDecayManager,
  agentId: string,
  severityStr: string,
  reason: string
): Promise<void> {
  let severity: ViolationSeverity;
  
  switch (severityStr.toLowerCase()) {
    case 'minor':
      severity = ViolationSeverity.MINOR;
      break;
    case 'moderate':
      severity = ViolationSeverity.MODERATE;
      break;
    case 'severe':
      severity = ViolationSeverity.SEVERE;
      break;
    default:
      console.error(`Invalid severity: ${severityStr}. Must be minor, moderate, or severe.`);
      process.exit(1);
  }
  
  await decayManager.slashTrust(agentId, severity, reason);
}

/**
 * Show slashing history
 */
async function showSlashingHistory(
  decayManager: TrustDecayManager,
  agentId?: string
): Promise<void> {
  const events = await decayManager.getRecentSlashingEvents(agentId);
  
  if (events.length === 0) {
    console.log(agentId 
      ? `No slashing events found for agent ${agentId}`
      : 'No slashing events found');
    return;
  }
  
  console.log(agentId 
    ? `Slashing history for agent ${agentId}:`
    : 'Global slashing history:');
  console.log('-'.repeat(80));
  
  for (const event of events) {
    const date = new Date(event.timestamp).toLocaleString();
    console.log(`[${date}] Agent ${event.agentId} - ${event.severity} violation`);
    console.log(`  Reason: ${event.reason}`);
    console.log(`  Penalty: ${event.penalty} points (${event.oldScore} -> ${event.newScore})`);
    console.log('-'.repeat(80));
  }
}

/**
 * Run trust decay process
 */
async function runDecay(
  decayManager: TrustDecayManager,
  allAgents: boolean
): Promise<void> {
  if (allAgents) {
    console.log('Running trust decay for all agents...');
    await decayManager.runDecayProcess();
  } else {
    console.log('To run decay for all agents, use --all flag');
  }
}

// Run the CLI
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 