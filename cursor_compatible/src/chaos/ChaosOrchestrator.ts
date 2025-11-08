/**
 * Chaos Orchestrator
 * 
 * Manages the chaos simulation lifecycle and coordinates
 * the application of stress conditions to agents.
 */

import { TrustScoreService } from '../services/agent/TrustScoreService.js';
import { ChaosSimulationBus } from './ChaosSimulationBus.js';
import { ChaosGenerator } from './ChaosGenerator.js';
import { ChaosParams, ChaosReport, ChaosAgentState, AgentStimuli } from '../types/chaos.types.js';
import { QuarantineService } from '../services/agent/QuarantineService.js';
import logger from '../utils/logger.js';

/**
 * Interface for agent-like objects that can be tested
 */
interface AgentLike {
  id: string;
  react(stimuli: any): Promise<any>;
}

/**
 * Interface for agent manager-like objects
 */
interface AgentManager {
  getAllAgents(): AgentLike[];
  getAgent(id: string): AgentLike | null;
}

/**
 * Chaos Orchestrator manages the chaos simulation lifecycle
 */
export class ChaosOrchestrator {
  private readonly quarantineService: QuarantineService;
  
  constructor(
    private readonly agentManager: AgentManager,
    private readonly trustService: TrustScoreService,
    private readonly simBus: ChaosSimulationBus
  ) {
    this.quarantineService = new QuarantineService(trustService['redis']);
  }
  
  /**
   * Run a single round of chaos simulation with the given parameters
   * @param params Chaos simulation parameters
   * @returns Report of the round's results
   */
  async runRound(params: ChaosParams): Promise<ChaosReport> {
    const startTime = Date.now();
    
    // Broadcast round start event
    await this.simBus.broadcast('round:start', params);
    logger.info(`🧪 Starting chaos simulation round with volatility ${params.marketVolatility}%`);
    
    // Get all active agents
    const agents = this.agentManager.getAllAgents();
    logger.info(`🧪 Testing ${agents.length} agents under stress conditions`);
    
    // Track initial trust scores for comparison
    const initialScores = new Map<string, number>();
    for (const agent of agents) {
      initialScores.set(agent.id, await this.trustService.getScore(agent.id));
    }
    
    // Process each agent
    const promises = agents.map(agent => this.processAgent(agent, params, initialScores.get(agent.id) || 0));
    await Promise.all(promises);
    
    // Generate comprehensive report
    const report = await this.generateReport(initialScores);
    const roundDuration = Date.now() - startTime;
    
    // Broadcast round end event
    await this.simBus.broadcast('round:end', {
      ...report,
      roundDurationMs: roundDuration
    });
    
    logger.info(`🧪 Chaos round completed in ${roundDuration}ms. ${report.degraded.length} agents degraded, ${report.quarantined.length} quarantined`);
    
    return {
      ...report,
      roundDurationMs: roundDuration
    };
  }
  
  /**
   * Run multiple rounds of chaos simulation with increasing intensity
   * @param roundCount Number of rounds to run
   * @param baseParams Base parameters for the simulation
   * @param intensify Whether to increase intensity with each round
   * @returns Array of reports from each round
   */
  async runMultipleRounds(
    roundCount: number, 
    baseParams: ChaosParams,
    intensify: boolean = true
  ): Promise<ChaosReport[]> {
    const reports: ChaosReport[] = [];
    
    for (let i = 0; i < roundCount; i++) {
      // Create a copy of base params
      const params = { ...baseParams };
      
      // If intensifying, increase difficulty with each round
      if (intensify) {
        const progressFactor = i / (roundCount - 1); // 0 to 1
        params.marketVolatility = Math.min(100, baseParams.marketVolatility * (1 + progressFactor));
        params.corruptionRate = Math.min(1, baseParams.corruptionRate * (1 + progressFactor));
        params.apiFailureRate = Math.min(1, baseParams.apiFailureRate * (1 + progressFactor * 0.5));
        params.forceTrustLoss = i > roundCount / 2 ? true : baseParams.forceTrustLoss;
      }
      
      const report = await this.runRound(params);
      reports.push(report);
      
      // Wait between rounds to allow for recovery processes
      if (i < roundCount - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1s between rounds
      }
    }
    
    return reports;
  }
  
  /**
   * Process a single agent with chaos stimuli
   * @param agent Agent to process
   * @param params Chaos parameters
   * @param initialScore Agent's initial trust score
   */
  private async processAgent(agent: AgentLike, params: ChaosParams, initialScore: number): Promise<void> {
    try {
      // Skip agents already in quarantine
      const isQuarantined = await this.quarantineService.isQuarantined(agent.id);
      if (isQuarantined) {
        logger.debug(`🧪 Agent ${agent.id} is in quarantine, skipping`);
        return;
      }
      
      // Generate stimuli
      const stimuli = ChaosGenerator.generateStimuli(params);
      
      // Record the stimuli application
      await this.simBus.broadcast('agent:stimulated', {
        agentId: agent.id,
        stimuli,
        timestamp: Date.now()
      });
      
      // Track response time
      const startTime = Date.now();
      
      // Let the agent react to the stimuli
      const response = await this.reactWithTimeout(agent, stimuli, params.roundDurationMs);
      const responseTime = Date.now() - startTime;
      
      // Add response time to the result
      const enrichedResponse = {
        ...response,
        responseTimeMs: responseTime
      };
      
      // Record the agent's response
      await this.simBus.recordAgentResponse(agent.id, stimuli, enrichedResponse);
      
      // If forceTrustLoss is enabled, apply trust penalty
      if (params.forceTrustLoss && stimuli.trustDrop < 0) {
        await this.applyTrustPenalty(agent.id, stimuli, initialScore);
      }
      
      // Check if this agent was quarantined during this round
      const quarantinedNow = await this.quarantineService.isQuarantined(agent.id);
      if (!isQuarantined && quarantinedNow) {
        await this.simBus.broadcast('agent:quarantined', {
          agentId: agent.id,
          timestamp: Date.now(),
          reason: 'chaos_simulation_triggered'
        });
      }
    } catch (error) {
      logger.error(`🧪 Error processing agent ${agent.id}:`, error);
      
      // Record the error as a failed response
      await this.simBus.recordAgentResponse(agent.id, {}, {
        error: true,
        message: error instanceof Error ? error.message : 'Unknown error',
        responseTimeMs: 0
      });
    }
  }
  
  /**
   * Apply trust penalty based on chaos stimuli
   * @param agentId Agent identifier
   * @param stimuli Applied stimuli
   * @param initialScore Initial trust score
   */
  private async applyTrustPenalty(agentId: string, stimuli: AgentStimuli, initialScore: number): Promise<void> {
    // Apply trust penalty
    const penalty = Math.abs(stimuli.trustDrop);
    const newScore = await this.trustService.adjustScore(agentId, stimuli.trustDrop);
    
    // Record the trust change
    await this.simBus.recordTrustChange(
      agentId,
      initialScore,
      newScore,
      `Chaos simulation forced penalty of ${penalty.toFixed(2)} points`
    );
  }
  
  /**
   * React to stimuli with a timeout
   * @param agent Agent to react
   * @param stimuli Stimuli to apply
   * @param timeout Maximum time to wait in milliseconds
   * @returns Agent's response or timeout error
   */
  private async reactWithTimeout(agent: AgentLike, stimuli: any, timeout: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Agent ${agent.id} reaction timed out after ${timeout}ms`));
      }, timeout);
      
      agent.react(stimuli)
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }
  
  /**
   * Generate a comprehensive report of the chaos round results
   * @param initialScores Map of initial trust scores for comparison
   * @returns Chaos simulation report
   */
  private async generateReport(initialScores: Map<string, number>): Promise<ChaosReport> {
    // Get current state of all agents
    const agents = this.agentManager.getAllAgents();
    const states: ChaosAgentState[] = [];
    const quarantined: ChaosAgentState[] = [];
    const adapted: ChaosAgentState[] = [];
    
    // Process each agent
    for (const agent of agents) {
      // Get current trust score and state
      const score = await this.trustService.getScore(agent.id);
      const isQuarantined = await this.quarantineService.isQuarantined(agent.id);
      const trustState = await this.trustService.getTrustState(agent.id);
      
      // Create agent state record
      const state: ChaosAgentState = {
        id: agent.id,
        score,
        quarantined: isQuarantined,
        healthMode: trustState.mode,
        enteredStateAt: trustState.enteredSelfHealingAt
      };
      
      // Add to appropriate categories
      states.push(state);
      
      if (isQuarantined) {
        quarantined.push(state);
      }
      
      // Check if agent adapted (improved score despite chaos)
      const initialScore = initialScores.get(agent.id) || 0;
      if (score > initialScore) {
        adapted.push(state);
      }
    }
    
    // Calculate system stability based on percentage of healthy agents
    const totalAgents = states.length;
    const healthyAgents = states.filter(s => s.score >= 50).length;
    const systemStability = totalAgents > 0 ? (healthyAgents / totalAgents) * 100 : 0;
    
    return {
      timestamp: Date.now(),
      degraded: states.filter(s => s.score < 50),
      quarantined,
      survivors: states.filter(s => s.score >= 80),
      adapted,
      systemStability
    };
  }
} 