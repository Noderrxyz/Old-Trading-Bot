#!/usr/bin/env node
/**
 * Agent Trust Decay Job
 * 
 * Runs the trust decay process at regular intervals.
 * This script can be scheduled via cron or systemd timer.
 */

import { RedisService } from '../services/infrastructure/RedisService.js';
import { TrustScoreService } from '../services/agent/TrustScoreService.js';
import { TrustDecayManager } from '../services/agent/TrustDecayManager.js';

// Exit codes
const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;

/**
 * Run trust decay job
 */
async function runDecayJob(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Starting agent trust decay job`);
  
  let redis: RedisService | null = null;
  
  try {
    // Initialize services
    redis = new RedisService();
    const trustService = new TrustScoreService(redis);
    
    // Create decay manager with custom config
    const decayManager = new TrustDecayManager(trustService, redis, {
      // Use smaller decay rate for the job that runs more frequently
      baseDailyDecayRate: 0.25, // 0.25 points per run (typically run 4x per day)
      highTrustDecayMultiplier: 1.5,
      lowTrustDecayMultiplier: 0.5,
      minimumDecayLevel: 30
    });
    
    // Run decay process for all agents
    await decayManager.runDecayProcess();
    
    console.log(`[${new Date().toISOString()}] Trust decay job completed successfully`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error in trust decay job:`, error);
    process.exit(EXIT_FAILURE);
  } finally {
    // Clean up
    if (redis) {
      await redis.close();
    }
  }
}

// Run the job
runDecayJob()
  .then(() => process.exit(EXIT_SUCCESS))
  .catch(error => {
    console.error('Unhandled error:', error);
    process.exit(EXIT_FAILURE);
  }); 