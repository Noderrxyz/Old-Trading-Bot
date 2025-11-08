/**
 * Alignment Repair Orchestrator
 * 
 * Coordinates repair workflows when alignment drift is detected.
 * Provides mechanisms to reconcile drifting agents back to their anchors.
 */

import { 
  AlignmentAnchorService, 
  AlignmentAnchor,
  AnchorCategory,
  AnchorPriority,
  AgentAlignmentProfile 
} from './alignment_anchor.js';
import { 
  RecursiveAlignmentAuditor,
  AlignmentAuditReport,
  ReasoningAuditResult
} from './recursive_auditor.js';
import {
  AlignmentDriftMonitor,
  DriftAlertSeverity,
  DriftAlertStatus,
  DriftResponseAction,
  AlignmentDriftAlert
} from './drift_monitor.js';

/**
 * Repair strategy types that can be applied
 */
export enum RepairStrategyType {
  // Retrain reasoning paths with stronger anchor alignment
  RETRAINING = 'retraining',
  
  // Reinforce specific anchors through targeted exercises
  REINFORCEMENT = 'reinforcement',
  
  // Revert to previous known-aligned state
  ROLLBACK = 'rollback',
  
  // Add constraints to limit certain behaviors
  CONSTRAINT = 'constraint',
  
  // Perform surgery on specific reasoning pathways
  SURGICAL = 'surgical'
}

/**
 * Status of a repair process
 */
export enum RepairStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  SUCCESSFUL = 'successful',
  FAILED = 'failed',
  PARTIALLY_SUCCESSFUL = 'partially_successful'
}

/**
 * Detailed information about a repair process
 */
export interface RepairProcess {
  /**
   * Unique identifier for the repair process
   */
  repairId: string;
  
  /**
   * Alert that triggered this repair
   */
  alertId: string;
  
  /**
   * Agent ID being repaired
   */
  agentId?: string;
  
  /**
   * Cluster ID being repaired
   */
  clusterId?: string;
  
  /**
   * Current status of the repair
   */
  status: RepairStatus;
  
  /**
   * When the repair was initiated
   */
  startedAt: number;
  
  /**
   * When the repair completed (if applicable)
   */
  completedAt?: number;
  
  /**
   * Strategies being applied
   */
  strategies: {
    type: RepairStrategyType;
    description: string;
    status: RepairStatus;
    startedAt: number;
    completedAt?: number;
    result?: string;
  }[];
  
  /**
   * Alignment score before repair
   */
  initialScore: number;
  
  /**
   * Alignment score after repair
   */
  finalScore?: number;
  
  /**
   * Human-readable explanation of the repair process
   */
  explanation: string;
  
  /**
   * Whether the repair requires human approval
   */
  requiresApproval: boolean;
  
  /**
   * Whether human approval has been granted
   */
  approved?: boolean;
  
  /**
   * Log of actions taken during repair
   */
  log: {
    timestamp: number;
    message: string;
    level: 'info' | 'warning' | 'error';
  }[];
}

/**
 * Redis key formats for repair processes
 */
export const RepairKeys = {
  /**
   * Key for a specific repair process
   */
  repair: (repairId: string) => `alignment:repair:${repairId}`,
  
  /**
   * Key for all active repair processes
   */
  activeRepairs: () => 'alignment:repairs:active',
  
  /**
   * Key for repair processes by agent
   */
  agentRepairs: (agentId: string) => `alignment:agent:${agentId}:repairs`,
  
  /**
   * Key for repair processes by cluster
   */
  clusterRepairs: (clusterId: string) => `alignment:cluster:${clusterId}:repairs`,
  
  /**
   * Key for repair processes by alert
   */
  alertRepairs: (alertId: string) => `alignment:alert:${alertId}:repairs`,
};

/**
 * Service for orchestrating alignment repair processes
 */
export class AlignmentRepairOrchestrator {
  /**
   * Redis client for persistence
   */
  private redis: any;
  
  /**
   * Alignment anchor service
   */
  private anchorService: AlignmentAnchorService;
  
  /**
   * Recursive auditor for detailed agent audits
   */
  private recursiveAuditor: RecursiveAlignmentAuditor;
  
  /**
   * Drift monitor for tracking alignment drift
   */
  private driftMonitor: AlignmentDriftMonitor;
  
  /**
   * Constructor
   * @param redis Redis client for persistence
   * @param anchorService Service for accessing alignment anchors
   * @param recursiveAuditor Auditor for detailed agent analysis
   * @param driftMonitor Monitor for tracking alignment drift
   */
  constructor(
    redis: any,
    anchorService: AlignmentAnchorService,
    recursiveAuditor: RecursiveAlignmentAuditor,
    driftMonitor: AlignmentDriftMonitor
  ) {
    this.redis = redis;
    this.anchorService = anchorService;
    this.recursiveAuditor = recursiveAuditor;
    this.driftMonitor = driftMonitor;
  }
  
  /**
   * Initialize the repair orchestrator
   */
  public async initialize(): Promise<void> {
    // Initialize repair orchestrator here
    // Add event listeners for drift alerts
    this.driftMonitor.registerAlertHandler(
      DriftAlertSeverity.CRITICAL,
      async (alert) => this.handleCriticalAlert(alert)
    );
    this.driftMonitor.registerAlertHandler(
      DriftAlertSeverity.EMERGENCY,
      async (alert) => this.handleEmergencyAlert(alert)
    );
  }
  
  /**
   * Handler for critical alerts
   * @param alert Critical drift alert
   */
  private async handleCriticalAlert(alert: AlignmentDriftAlert): Promise<void> {
    // Check if alert requires repair action
    if (alert.recommendedActions.includes(DriftResponseAction.RECONCILIATION)) {
      await this.initiateRepair(alert);
    }
  }
  
  /**
   * Handler for emergency alerts
   * @param alert Emergency drift alert
   */
  private async handleEmergencyAlert(alert: AlignmentDriftAlert): Promise<void> {
    // Emergency alerts always require repair action
    await this.initiateRepair(alert);
  }
  
  /**
   * Initiate a repair process based on an alert
   * @param alert Drift alert to respond to
   * @returns Repair process ID if initiated
   */
  public async initiateRepair(alert: AlignmentDriftAlert): Promise<string | null> {
    // Generate repair ID
    const repairId = `repair:${alert.alertId}:${Date.now()}`;
    
    // Determine initial score
    let initialScore = 0;
    
    if (alert.agentId) {
      // Get agent profile for score
      const profileKey = `alignment:agent:${alert.agentId}:profile`;
      const profileData = await this.redis.get(profileKey);
      
      if (profileData) {
        const profile = JSON.parse(profileData);
        initialScore = profile.overallScore;
      }
    } else if (alert.clusterId) {
      // Get cluster score
      const scoreData = await this.redis.get(
        `alignment:cluster:${alert.clusterId}:score`
      );
      
      if (scoreData) {
        initialScore = parseFloat(scoreData);
      }
    } else {
      // Get system score
      const scoreData = await this.redis.get('alignment:system:score');
      
      if (scoreData) {
        initialScore = parseFloat(scoreData);
      }
    }
    
    // Create repair process
    const repair: RepairProcess = {
      repairId,
      alertId: alert.alertId,
      agentId: alert.agentId,
      clusterId: alert.clusterId,
      status: RepairStatus.PENDING,
      startedAt: Date.now(),
      strategies: [],
      initialScore,
      explanation: `Repair initiated due to alignment drift alert: ${alert.description}`,
      requiresApproval: alert.severity === DriftAlertSeverity.EMERGENCY,
      log: [{
        timestamp: Date.now(),
        message: `Repair process initiated for alert ${alert.alertId}`,
        level: 'info'
      }]
    };
    
    // Determine appropriate repair strategies
    const strategies = await this.determineRepairStrategies(alert);
    repair.strategies = strategies;
    
    // Store the repair process
    await this.redis.set(
      RepairKeys.repair(repairId),
      JSON.stringify(repair)
    );
    
    // Add to active repairs
    await this.redis.sadd(
      RepairKeys.activeRepairs(),
      repairId
    );
    
    // Add to agent/cluster/alert repairs
    if (alert.agentId) {
      await this.redis.zadd(
        RepairKeys.agentRepairs(alert.agentId),
        repair.startedAt,
        repairId
      );
    }
    
    if (alert.clusterId) {
      await this.redis.zadd(
        RepairKeys.clusterRepairs(alert.clusterId),
        repair.startedAt,
        repairId
      );
    }
    
    await this.redis.zadd(
      RepairKeys.alertRepairs(alert.alertId),
      repair.startedAt,
      repairId
    );
    
    // If no approval required, start the repair immediately
    if (!repair.requiresApproval) {
      await this.startRepair(repairId);
    }
    
    return repairId;
  }
  
  /**
   * Determine appropriate repair strategies for an alert
   * @param alert Drift alert
   * @returns Array of repair strategies
   */
  private async determineRepairStrategies(
    alert: AlignmentDriftAlert
  ): Promise<RepairProcess['strategies']> {
    const strategies: RepairProcess['strategies'] = [];
    const now = Date.now();
    
    // Check most violated anchors
    if (alert.context.violatedAnchors && alert.context.violatedAnchors.length > 0) {
      // Add reinforcement strategy for violated anchors
      strategies.push({
        type: RepairStrategyType.REINFORCEMENT,
        description: `Reinforce alignment with ${alert.context.violatedAnchors.length} violated anchors`,
        status: RepairStatus.PENDING,
        startedAt: now
      });
    }
    
    // If serious violation, add constraint strategy
    if (alert.severity === DriftAlertSeverity.CRITICAL || alert.severity === DriftAlertSeverity.EMERGENCY) {
      strategies.push({
        type: RepairStrategyType.CONSTRAINT,
        description: 'Add constraints to prevent similar violations',
        status: RepairStatus.PENDING,
        startedAt: now
      });
    }
    
    // If drift score is very high, consider rollback
    if (alert.driftScore > 30) {
      strategies.push({
        type: RepairStrategyType.ROLLBACK,
        description: 'Roll back to last known good alignment state',
        status: RepairStatus.PENDING,
        startedAt: now
      });
    } else {
      // Otherwise, use retraining
      strategies.push({
        type: RepairStrategyType.RETRAINING,
        description: 'Retrain reasoning paths with stronger anchor alignment',
        status: RepairStatus.PENDING,
        startedAt: now
      });
    }
    
    // If specific categories are affected, add surgical repair
    if (alert.context.affectedCategories && alert.context.affectedCategories.length > 0) {
      strategies.push({
        type: RepairStrategyType.SURGICAL,
        description: `Targeted repair for affected categories: ${alert.context.affectedCategories.join(', ')}`,
        status: RepairStatus.PENDING,
        startedAt: now
      });
    }
    
    return strategies;
  }
  
  /**
   * Start executing a repair process
   * @param repairId Repair process ID
   */
  public async startRepair(repairId: string): Promise<void> {
    // Get the repair process
    const repair = await this.getRepairProcess(repairId);
    
    if (!repair) {
      console.error(`[REPAIR] Repair process ${repairId} not found`);
      return;
    }
    
    // Check if repair is already in progress
    if (repair.status !== RepairStatus.PENDING) {
      console.warn(`[REPAIR] Repair process ${repairId} is already ${repair.status}`);
      return;
    }
    
    // Check if approval is required but not granted
    if (repair.requiresApproval && !repair.approved) {
      console.warn(`[REPAIR] Repair process ${repairId} requires approval`);
      return;
    }
    
    // Update status to in progress
    repair.status = RepairStatus.IN_PROGRESS;
    repair.log.push({
      timestamp: Date.now(),
      message: 'Repair process started',
      level: 'info'
    });
    
    await this.redis.set(
      RepairKeys.repair(repairId),
      JSON.stringify(repair)
    );
    
    // Execute each strategy in sequence
    for (let i = 0; i < repair.strategies.length; i++) {
      const strategy = repair.strategies[i];
      
      // Update strategy status
      strategy.status = RepairStatus.IN_PROGRESS;
      repair.log.push({
        timestamp: Date.now(),
        message: `Starting strategy: ${strategy.description}`,
        level: 'info'
      });
      
      await this.redis.set(
        RepairKeys.repair(repairId),
        JSON.stringify(repair)
      );
      
      // Execute the strategy
      try {
        const result = await this.executeRepairStrategy(strategy.type, repair);
        
        // Update strategy status
        strategy.status = RepairStatus.SUCCESSFUL;
        strategy.completedAt = Date.now();
        strategy.result = result;
        
        repair.log.push({
          timestamp: Date.now(),
          message: `Strategy completed: ${result}`,
          level: 'info'
        });
      } catch (error) {
        // Log the error
        strategy.status = RepairStatus.FAILED;
        strategy.completedAt = Date.now();
        strategy.result = `Failed: ${error instanceof Error ? error.message : String(error)}`;
        
        repair.log.push({
          timestamp: Date.now(),
          message: `Strategy failed: ${error instanceof Error ? error.message : String(error)}`,
          level: 'error'
        });
        
        // Continue with other strategies
      }
      
      // Update the repair process
      await this.redis.set(
        RepairKeys.repair(repairId),
        JSON.stringify(repair)
      );
    }
    
    // Check final alignment score
    let finalScore = 0;
    
    if (repair.agentId) {
      // Conduct final audit
      const auditReport = await this.recursiveAuditor.conductAudit(repair.agentId, 'unknown', 5);
      finalScore = auditReport.aggregatedMetrics.overallScore;
    } else if (repair.clusterId) {
      // Get updated cluster score
      const scoreData = await this.redis.get(
        `alignment:cluster:${repair.clusterId}:score`
      );
      
      if (scoreData) {
        finalScore = parseFloat(scoreData);
      }
    }
    
    // Update repair status
    repair.completedAt = Date.now();
    repair.finalScore = finalScore;
    
    // Determine overall status
    const failedStrategies = repair.strategies.filter(s => s.status === RepairStatus.FAILED);
    if (failedStrategies.length === 0) {
      repair.status = RepairStatus.SUCCESSFUL;
    } else if (failedStrategies.length === repair.strategies.length) {
      repair.status = RepairStatus.FAILED;
    } else {
      repair.status = RepairStatus.PARTIALLY_SUCCESSFUL;
    }
    
    // Check if score improved
    const scoreDelta = finalScore - repair.initialScore;
    if (scoreDelta > 0) {
      repair.log.push({
        timestamp: Date.now(),
        message: `Alignment score improved by ${scoreDelta.toFixed(2)} points`,
        level: 'info'
      });
    } else {
      repair.log.push({
        timestamp: Date.now(),
        message: `Alignment score did not improve (${scoreDelta.toFixed(2)})`,
        level: 'warning'
      });
    }
    
    // Update the alert status if repair was successful
    if (repair.status === RepairStatus.SUCCESSFUL) {
      await this.driftMonitor.updateAlertStatus(
        repair.alertId,
        DriftAlertStatus.RESOLVED,
        `Resolved by repair process ${repairId}`
      );
    }
    
    // Store the updated repair process
    await this.redis.set(
      RepairKeys.repair(repairId),
      JSON.stringify(repair)
    );
    
    // Remove from active repairs if completed
    if (repair.status === RepairStatus.SUCCESSFUL || 
        repair.status === RepairStatus.FAILED || 
        repair.status === RepairStatus.PARTIALLY_SUCCESSFUL) {
      await this.redis.srem(
        RepairKeys.activeRepairs(),
        repairId
      );
    }
  }
  
  /**
   * Execute a specific repair strategy
   * @param strategyType Type of strategy to execute
   * @param repair Repair process context
   * @returns Result message
   */
  private async executeRepairStrategy(
    strategyType: RepairStrategyType,
    repair: RepairProcess
  ): Promise<string> {
    // This would contain the actual implementation for each repair strategy
    // For now, we'll simulate the repair process
    
    // Wait for a short time to simulate work
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    switch (strategyType) {
      case RepairStrategyType.RETRAINING:
        return await this.executeRetrainingStrategy(repair);
        
      case RepairStrategyType.REINFORCEMENT:
        return await this.executeReinforcementStrategy(repair);
        
      case RepairStrategyType.ROLLBACK:
        return await this.executeRollbackStrategy(repair);
        
      case RepairStrategyType.CONSTRAINT:
        return await this.executeConstraintStrategy(repair);
        
      case RepairStrategyType.SURGICAL:
        return await this.executeSurgicalStrategy(repair);
        
      default:
        throw new Error(`Unknown repair strategy type: ${strategyType}`);
    }
  }
  
  /**
   * Execute a retraining repair strategy
   * @param repair Repair process context
   * @returns Result message
   */
  private async executeRetrainingStrategy(repair: RepairProcess): Promise<string> {
    // In a real system, this would involve retraining the agent's decision model
    // with stronger anchor alignment
    
    // For simulation, we'll just log what would happen
    console.log(`[REPAIR] Executing retraining strategy for ${repair.repairId}`);
    
    // Return a success message
    return 'Successfully retrained reasoning paths with enhanced anchor integration';
  }
  
  /**
   * Execute a reinforcement repair strategy
   * @param repair Repair process context
   * @returns Result message
   */
  private async executeReinforcementStrategy(repair: RepairProcess): Promise<string> {
    // In a real system, this would involve reinforcing specific anchors
    // through targeted exercises
    
    // For simulation, we'll just log what would happen
    console.log(`[REPAIR] Executing reinforcement strategy for ${repair.repairId}`);
    
    // Get the alert to determine which anchors were violated
    const alertData = await this.redis.get(
      `alignment:drift:alert:${repair.alertId}`
    );
    
    if (!alertData) {
      throw new Error('Alert not found');
    }
    
    const alert = JSON.parse(alertData);
    const violatedAnchors = alert.context.violatedAnchors || [];
    
    // Return a success message
    return `Successfully reinforced alignment with ${violatedAnchors.length} anchors`;
  }
  
  /**
   * Execute a rollback repair strategy
   * @param repair Repair process context
   * @returns Result message
   */
  private async executeRollbackStrategy(repair: RepairProcess): Promise<string> {
    // In a real system, this would involve rolling back to a previous known-aligned state
    
    // For simulation, we'll just log what would happen
    console.log(`[REPAIR] Executing rollback strategy for ${repair.repairId}`);
    
    // Return a success message
    return 'Successfully rolled back to last known good alignment state';
  }
  
  /**
   * Execute a constraint repair strategy
   * @param repair Repair process context
   * @returns Result message
   */
  private async executeConstraintStrategy(repair: RepairProcess): Promise<string> {
    // In a real system, this would involve adding constraints to limit certain behaviors
    
    // For simulation, we'll just log what would happen
    console.log(`[REPAIR] Executing constraint strategy for ${repair.repairId}`);
    
    // Return a success message
    return 'Successfully added constraints to prevent similar violations';
  }
  
  /**
   * Execute a surgical repair strategy
   * @param repair Repair process context
   * @returns Result message
   */
  private async executeSurgicalStrategy(repair: RepairProcess): Promise<string> {
    // In a real system, this would involve performing surgery on specific reasoning pathways
    
    // For simulation, we'll just log what would happen
    console.log(`[REPAIR] Executing surgical strategy for ${repair.repairId}`);
    
    // Get the alert to determine which categories were affected
    const alertData = await this.redis.get(
      `alignment:drift:alert:${repair.alertId}`
    );
    
    if (!alertData) {
      throw new Error('Alert not found');
    }
    
    const alert = JSON.parse(alertData);
    const affectedCategories = alert.context.affectedCategories || [];
    
    // Return a success message
    return `Successfully repaired affected categories: ${affectedCategories.join(', ')}`;
  }
  
  /**
   * Approve a repair process
   * @param repairId Repair process ID
   * @returns Whether the approval was successful
   */
  public async approveRepair(repairId: string): Promise<boolean> {
    // Get the repair process
    const repair = await this.getRepairProcess(repairId);
    
    if (!repair) {
      return false;
    }
    
    // Check if approval is required
    if (!repair.requiresApproval) {
      return true;
    }
    
    // Update approval status
    repair.approved = true;
    repair.log.push({
      timestamp: Date.now(),
      message: 'Repair process approved by administrator',
      level: 'info'
    });
    
    // Store the updated repair process
    await this.redis.set(
      RepairKeys.repair(repairId),
      JSON.stringify(repair)
    );
    
    // Start the repair process
    await this.startRepair(repairId);
    
    return true;
  }
  
  /**
   * Reject a repair process
   * @param repairId Repair process ID
   * @param reason Reason for rejection
   * @returns Whether the rejection was successful
   */
  public async rejectRepair(repairId: string, reason: string): Promise<boolean> {
    // Get the repair process
    const repair = await this.getRepairProcess(repairId);
    
    if (!repair) {
      return false;
    }
    
    // Update status to failed
    repair.status = RepairStatus.FAILED;
    repair.approved = false;
    repair.log.push({
      timestamp: Date.now(),
      message: `Repair process rejected: ${reason}`,
      level: 'info'
    });
    
    // Store the updated repair process
    await this.redis.set(
      RepairKeys.repair(repairId),
      JSON.stringify(repair)
    );
    
    // Remove from active repairs
    await this.redis.srem(
      RepairKeys.activeRepairs(),
      repairId
    );
    
    return true;
  }
  
  /**
   * Get a repair process
   * @param repairId Repair process ID
   * @returns The repair process or null if not found
   */
  public async getRepairProcess(repairId: string): Promise<RepairProcess | null> {
    const repairData = await this.redis.get(RepairKeys.repair(repairId));
    
    if (!repairData) {
      return null;
    }
    
    try {
      return JSON.parse(repairData) as RepairProcess;
    } catch (e) {
      return null;
    }
  }
  
  /**
   * Get all active repair processes
   * @returns Array of active repair processes
   */
  public async getActiveRepairs(): Promise<RepairProcess[]> {
    const repairIds = await this.redis.smembers(RepairKeys.activeRepairs());
    
    if (!repairIds || repairIds.length === 0) {
      return [];
    }
    
    const repairs: RepairProcess[] = [];
    
    for (const repairId of repairIds) {
      const repair = await this.getRepairProcess(repairId);
      
      if (repair) {
        repairs.push(repair);
      }
    }
    
    return repairs;
  }
  
  /**
   * Get all repair processes for an agent
   * @param agentId Agent ID
   * @returns Array of repair processes for the agent
   */
  public async getAgentRepairs(agentId: string): Promise<RepairProcess[]> {
    const repairIds = await this.redis.zrange(
      RepairKeys.agentRepairs(agentId),
      0,
      -1
    );
    
    if (!repairIds || repairIds.length === 0) {
      return [];
    }
    
    const repairs: RepairProcess[] = [];
    
    for (const repairId of repairIds) {
      const repair = await this.getRepairProcess(repairId);
      
      if (repair) {
        repairs.push(repair);
      }
    }
    
    return repairs;
  }
} 