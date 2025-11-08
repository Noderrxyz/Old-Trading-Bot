#!/usr/bin/env node
/**
 * Chaos Simulation CLI
 * 
 * Command-line tool for running agent stress tests and trust system validations.
 * Executes chaos regression simulations with configurable parameters.
 */

// Add type declarations for yargs modules
// @ts-ignore
import yargs from 'yargs';
// @ts-ignore
import { hideBin } from 'yargs/helpers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { RedisService } from '../services/infrastructure/RedisService.js';
import { TrustScoreService } from '../services/agent/TrustScoreService.js';
import { ChaosSimulationBus } from '../chaos/ChaosSimulationBus.js';
import { ChaosOrchestrator } from '../chaos/ChaosOrchestrator.js';
import { ChaosParams, ChaosReport } from '../types/chaos.types.js';
import logger from '../utils/logger.js';

// Mock AgentManager for CLI tool to avoid dependencies
// In production, you would import the real AgentManager
class MockAgentManager {
  private agents: any[] = [];
  
  constructor(agentCount: number = 5) {
    // Create mock agents for testing
    for (let i = 0; i < agentCount; i++) {
      const agentType = ['alpha', 'beta', 'gamma', 'delta', 'theta'][i % 5];
      this.agents.push({
        id: `agent:${agentType}-${i}`,
        type: agentType,
        react: async (stimuli: any) => {
          // Simulate processing time
          await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 200));
          
          // Randomly succeed or fail based on agent type and stimuli
          const successRate = 
            agentType === 'alpha' ? 0.9 :
            agentType === 'beta' ? 0.75 :
            agentType === 'gamma' ? 0.6 :
            agentType === 'delta' ? 0.5 :
            0.4; // theta
          
          // Reduce success rate for corrupted inputs
          const adjustedRate = stimuli.corruptedInputs ? successRate * 0.7 : successRate;
          
          if (Math.random() < adjustedRate) {
            return {
              success: true,
              confidence: 0.5 + Math.random() * 0.5,
              prediction: stimuli.marketShock.direction,
              processingTime: Math.random() * 100
            };
          } else {
            // Some chance of throwing an error instead of returning failure
            if (Math.random() < 0.3) {
              throw new Error('Simulated processing error');
            }
            
            return {
              success: false,
              error: 'Failed to process stimuli',
              confidence: Math.random() * 0.4
            };
          }
        }
      });
    }
  }
  
  getAllAgents() {
    return this.agents;
  }
  
  getAgent(id: string) {
    return this.agents.find(a => a.id === id) || null;
  }
}

/**
 * Save simulation reports to a file
 */
function saveReports(reports: ChaosReport[], outputPath?: string): void {
  if (!outputPath) {
    // Create reports directory if it doesn't exist
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const reportsDir = path.join(__dirname, '..', '..', 'reports');
    
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    outputPath = path.join(reportsDir, `chaos-report-${timestamp}.json`);
  }
  
  const reportData = {
    timestamp: Date.now(),
    reports,
    summary: {
      totalRounds: reports.length,
      avgSystemStability: reports.reduce((sum, r) => sum + (r.systemStability || 0), 0) / reports.length,
      degradedAgents: [...new Set(reports.flatMap(r => r.degraded.map(a => a.id)))],
      quarantinedAgents: [...new Set(reports.flatMap(r => r.quarantined.map(a => a.id)))],
      adaptedAgents: [...new Set(reports.flatMap(r => r.adapted?.map(a => a.id) || []))]
    }
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(reportData, null, 2));
  logger.info(`📊 Saved chaos simulation report to ${outputPath}`);
}

/**
 * Print a summary of the simulation results
 */
function printSummary(reports: ChaosReport[]): void {
  if (reports.length === 0) return;
  
  const firstReport = reports[0];
  const lastReport = reports[reports.length - 1];
  
  console.log('\n📊 CHAOS SIMULATION SUMMARY');
  console.log('==========================');
  console.log(`Total rounds: ${reports.length}`);
  console.log(`Initial system stability: ${firstReport.systemStability?.toFixed(2)}%`);
  console.log(`Final system stability: ${lastReport.systemStability?.toFixed(2)}%`);
  console.log(`Quarantined agents: ${lastReport.quarantined.length}`);
  console.log(`Degraded agents: ${lastReport.degraded.length}`);
  console.log(`Survivors: ${lastReport.survivors.length}`);
  console.log(`Adapted agents: ${lastReport.adapted?.length || 0}`);
  
  if (lastReport.quarantined.length > 0) {
    console.log('\n🔒 QUARANTINED AGENTS');
    lastReport.quarantined.forEach(agent => {
      console.log(`- ${agent.id} (Score: ${agent.score.toFixed(2)})`);
    });
  }
  
  if (lastReport.adapted && lastReport.adapted.length > 0) {
    console.log('\n🦾 ADAPTED AGENTS');
    lastReport.adapted.forEach(agent => {
      console.log(`- ${agent.id} (Score: ${agent.score.toFixed(2)})`);
    });
  }
  
  console.log('\n==========================');
}

/**
 * Run the chaos simulation with the provided args
 */
async function runSimulation(args: any): Promise<void> {
  try {
    // Initialize services
    const redis = new RedisService(args.redisUrl);
    const trustService = new TrustScoreService(redis);
    const simBus = new ChaosSimulationBus(redis);
    
    // Create agent manager (mock or real)
    const agentManager = new MockAgentManager(args.agentCount);
    
    // Create chaos orchestrator
    const orchestrator = new ChaosOrchestrator(
      agentManager,
      trustService,
      simBus
    );
    
    // Build parameters from CLI args
    const chaosParams: ChaosParams = {
      marketVolatility: args.marketVolatility,
      corruptionRate: args.corruptionRate,
      maxLatencyMs: args.maxLatencyMs,
      forceTrustLoss: args.forceTrustLoss,
      conflictRate: args.conflictRate,
      apiFailureRate: args.apiFailureRate,
      blackSwanProbability: args.blackSwanProbability,
      roundDurationMs: args.roundTimeout
    };
    
    // Run simulation rounds
    logger.info(`🧪 Starting chaos simulation with ${args.rounds} rounds`);
    const reports = await orchestrator.runMultipleRounds(
      args.rounds,
      chaosParams, 
      args.intensify
    );
    
    // Save reports if requested
    if (args.output || args.saveReport) {
      saveReports(reports, args.output);
    }
    
    // Print summary
    printSummary(reports);
    
    // Clean up
    await redis.close();
    
  } catch (error) {
    logger.error('Error running chaos simulation:', error);
    process.exit(1);
  }
}

// Parse CLI arguments
yargs(hideBin(process.argv))
  .command(
    '$0',
    'Run a chaos regression simulation',
    (yargsInstance: typeof yargs) => {
      return yargsInstance
        .option('rounds', {
          alias: 'r',
          type: 'number',
          description: 'Number of simulation rounds to run',
          default: 10
        })
        .option('marketVolatility', {
          alias: 'v',
          type: 'number',
          description: 'Market volatility level (0-100)',
          default: 50
        })
        .option('corruptionRate', {
          alias: 'c',
          type: 'number',
          description: 'Rate of data corruption (0-1)',
          default: 0.2
        })
        .option('maxLatencyMs', {
          alias: 'l',
          type: 'number',
          description: 'Maximum simulated latency in milliseconds',
          default: 1000
        })
        .option('forceTrustLoss', {
          alias: 'f',
          type: 'boolean',
          description: 'Force trust score degradation',
          default: false
        })
        .option('conflictRate', {
          type: 'number',
          description: 'Rate of conflicting signals (0-1)',
          default: 0.3
        })
        .option('apiFailureRate', {
          type: 'number',
          description: 'Rate of API failures (0-1)',
          default: 0.1
        })
        .option('blackSwanProbability', {
          type: 'number',
          description: 'Probability of black swan events (0-1)',
          default: 0.05
        })
        .option('roundTimeout', {
          type: 'number',
          description: 'Maximum duration for each round in milliseconds',
          default: 5000
        })
        .option('agentCount', {
          alias: 'a',
          type: 'number',
          description: 'Number of mock agents to test (when using mock mode)',
          default: 10
        })
        .option('intensify', {
          alias: 'i',
          type: 'boolean',
          description: 'Gradually increase chaos intensity with each round',
          default: true
        })
        .option('redisUrl', {
          type: 'string',
          description: 'Redis connection URL',
          default: 'redis://localhost:6379'
        })
        .option('saveReport', {
          alias: 's',
          type: 'boolean',
          description: 'Save simulation reports to file',
          default: true
        })
        .option('output', {
          alias: 'o',
          type: 'string',
          description: 'Path to save the simulation report'
        });
    },
    runSimulation
  )
  .help()
  .argv; 