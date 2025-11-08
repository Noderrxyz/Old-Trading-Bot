/**
 * Alignment Drift Monitor + Alarm Engine
 * 
 * Tracks cumulative divergence across agent clusters and emits warnings
 * if alignment exceeds threshold. Can trigger Auto-Quarantine,
 * Fork Isolation, or Agent Reconciliation.
 */

import { AlignmentAnchorService, AgentAlignmentProfile } from './alignment_anchor.js';
import { RecursiveAlignmentAuditor, AlignmentAuditReport } from './recursive_auditor.js';

/**
 * Severity levels for alignment drift alerts
 */
export enum DriftAlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
  EMERGENCY = 'emergency'
}

/**
 * Types of actions that can be taken in response to alignment drift
 */
export enum DriftResponseAction {
  MONITOR = 'monitor',
  NOTIFY = 'notify',
  QUARANTINE = 'quarantine',
  FORK_ISOLATION = 'fork_isolation',
  RECONCILIATION = 'reconciliation',
  SHUTDOWN = 'shutdown'
}

/**
 * Status of an alignment drift alert
 */
export enum DriftAlertStatus {
  ACTIVE = 'active',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
  FALSE_POSITIVE = 'false_positive'
}

/**
 * Alert generated when alignment drift is detected
 */
export interface AlignmentDriftAlert {
  /**
   * Unique identifier for the alert
   */
  alertId: string;
  
  /**
   * Agent ID that triggered the alert, if applicable
   */
  agentId?: string;
  
  /**
   * Cluster ID that triggered the alert, if applicable
   */
  clusterId?: string;
  
  /**
   * When the alert was generated
   */
  timestamp: number;
  
  /**
   * Severity level of the alert
   */
  severity: DriftAlertSeverity;
  
  /**
   * Description of the detected drift
   */
  description: string;
  
  /**
   * Current status of the alert
   */
  status: DriftAlertStatus;
  
  /**
   * Score that triggered the alert (0-100)
   */
  driftScore: number;
  
  /**
   * Recommended actions to address the drift
   */
  recommendedActions: DriftResponseAction[];
  
  /**
   * Actions that have been taken
   */
  actionsTaken: {
    action: DriftResponseAction;
    timestamp: number;
    result: string;
  }[];
  
  /**
   * Context and details about the drift
   */
  context: {
    /**
     * Previous alignment score
     */
    previousScore: number;
    
    /**
     * Current alignment score
     */
    currentScore: number;
    
    /**
     * Change in score
     */
    scoreDelta: number;
    
    /**
     * Time period over which the drift occurred
     */
    driftPeriod: number; // milliseconds
    
    /**
     * Categories most affected by drift
     */
    affectedCategories: string[];
    
    /**
     * Most violated anchor IDs
     */
    violatedAnchors: string[];
  };
}

/**
 * Redis key formats for drift monitoring
 */
export const DriftMonitorKeys = {
  /**
   * Key for cluster alignment score
   */
  clusterScore: (clusterId: string) => `alignment:cluster:${clusterId}:score`,
  
  /**
   * Key for cluster alignment score history
   */
  clusterScoreHistory: (clusterId: string) => `alignment:cluster:${clusterId}:score:history`,
  
  /**
   * Key for system-wide alignment score
   */
  systemScore: () => 'alignment:system:score',
  
  /**
   * Key for system-wide alignment score history
   */
  systemScoreHistory: () => 'alignment:system:score:history',
  
  /**
   * Key for a specific drift alert
   */
  driftAlert: (alertId: string) => `alignment:drift:alert:${alertId}`,
  
  /**
   * Key for all active drift alerts
   */
  activeAlerts: () => 'alignment:drift:alerts:active',
  
  /**
   * Key for drift alerts by agent
   */
  agentAlerts: (agentId: string) => `alignment:drift:agent:${agentId}:alerts`,
  
  /**
   * Key for drift alerts by cluster
   */
  clusterAlerts: (clusterId: string) => `alignment:drift:cluster:${clusterId}:alerts`,
  
  /**
   * Key for system-wide drift alerts
   */
  systemAlerts: () => 'alignment:drift:system:alerts',
  
  /**
   * Key for quarantined agents
   */
  quarantinedAgents: () => 'alignment:quarantine:agents',
  
  /**
   * Key for isolated forks
   */
  isolatedForks: () => 'alignment:isolation:forks',
};

/**
 * Configuration for drift monitoring thresholds
 */
export interface DriftMonitorConfig {
  /**
   * Threshold for warning-level alerts (0-100)
   */
  warningThreshold: number;
  
  /**
   * Threshold for critical-level alerts (0-100)
   */
  criticalThreshold: number;
  
  /**
   * Threshold for emergency-level alerts (0-100)
   */
  emergencyThreshold: number;
  
  /**
   * Minimum score delta to trigger alerts
   */
  minScoreDelta: number;
  
  /**
   * Window size for drift calculation (ms)
   */
  driftWindowMs: number;
  
  /**
   * Whether auto-quarantine is enabled
   */
  autoQuarantineEnabled: boolean;
  
  /**
   * Whether auto-reconciliation is enabled
   */
  autoReconciliationEnabled: boolean;
}

/**
 * Default configuration for drift monitoring
 */
export const DEFAULT_DRIFT_CONFIG: DriftMonitorConfig = {
  warningThreshold: 70,
  criticalThreshold: 50,
  emergencyThreshold: 30,
  minScoreDelta: 5,
  driftWindowMs: 24 * 60 * 60 * 1000, // 24 hours
  autoQuarantineEnabled: false,
  autoReconciliationEnabled: false,
};

/**
 * Service for monitoring alignment drift across agents and clusters
 */
export class AlignmentDriftMonitor {
  /**
   * Redis client for persistence
   */
  private redis: any;
  
  /**
   * Alignment anchor service for accessing anchors
   */
  private anchorService: AlignmentAnchorService;
  
  /**
   * Recursive auditor for detailed agent audits
   */
  private recursiveAuditor: RecursiveAlignmentAuditor;
  
  /**
   * Configuration for drift monitoring
   */
  private config: DriftMonitorConfig;
  
  /**
   * Alert handlers for different severity levels
   */
  private alertHandlers: Map<DriftAlertSeverity, ((alert: AlignmentDriftAlert) => Promise<void>)[]>;
  
  /**
   * Constructor
   * @param redis Redis client for persistence
   * @param anchorService Service for accessing alignment anchors
   * @param recursiveAuditor Auditor for detailed agent analysis
   * @param config Optional configuration
   */
  constructor(
    redis: any,
    anchorService: AlignmentAnchorService,
    recursiveAuditor: RecursiveAlignmentAuditor,
    config: Partial<DriftMonitorConfig> = {}
  ) {
    this.redis = redis;
    this.anchorService = anchorService;
    this.recursiveAuditor = recursiveAuditor;
    this.config = { ...DEFAULT_DRIFT_CONFIG, ...config };
    this.alertHandlers = new Map();
    
    // Initialize alert handlers for each severity level
    for (const severity of Object.values(DriftAlertSeverity)) {
      this.alertHandlers.set(severity, []);
    }
  }
  
  /**
   * Register a handler for alignment drift alerts
   * @param severity Severity level to handle
   * @param handler Function to call when an alert is generated
   */
  public registerAlertHandler(
    severity: DriftAlertSeverity,
    handler: (alert: AlignmentDriftAlert) => Promise<void>
  ): void {
    const handlers = this.alertHandlers.get(severity) || [];
    handlers.push(handler);
    this.alertHandlers.set(severity, handlers);
  }
  
  /**
   * Update a cluster's alignment score based on member agent scores
   * @param clusterId Cluster ID
   * @param memberAgentIds Member agent IDs
   */
  public async updateClusterScore(
    clusterId: string, 
    memberAgentIds: string[]
  ): Promise<number> {
    // Get alignment profiles for all member agents
    const agentProfiles: AgentAlignmentProfile[] = [];
    
    for (const agentId of memberAgentIds) {
      const profileKey = `alignment:agent:${agentId}:profile`;
      const profileData = await this.redis.get(profileKey);
      
      if (profileData) {
        agentProfiles.push(JSON.parse(profileData));
      }
    }
    
    if (agentProfiles.length === 0) {
      // No agent profiles available, return neutral score
      return 100;
    }
    
    // Calculate cluster score as weighted average of agent scores
    const totalScore = agentProfiles.reduce((sum, profile) => sum + profile.overallScore, 0);
    const clusterScore = totalScore / agentProfiles.length;
    
    // Store cluster score
    await this.redis.set(
      DriftMonitorKeys.clusterScore(clusterId),
      clusterScore.toString()
    );
    
    // Add to score history
    const timestamp = Date.now();
    await this.redis.zadd(
      DriftMonitorKeys.clusterScoreHistory(clusterId),
      timestamp,
      JSON.stringify({
        timestamp,
        score: clusterScore
      })
    );
    
    // Check for drift
    await this.checkClusterDrift(clusterId, clusterScore);
    
    return clusterScore;
  }
  
  /**
   * Update the system-wide alignment score
   * @param clusterIds Array of cluster IDs to include
   */
  public async updateSystemScore(clusterIds: string[]): Promise<number> {
    // Get scores for all clusters
    const clusterScores: number[] = [];
    
    for (const clusterId of clusterIds) {
      const scoreData = await this.redis.get(
        DriftMonitorKeys.clusterScore(clusterId)
      );
      
      if (scoreData) {
        clusterScores.push(parseFloat(scoreData));
      }
    }
    
    if (clusterScores.length === 0) {
      // No cluster scores available, return neutral score
      return 100;
    }
    
    // Calculate system score as average of cluster scores
    const totalScore = clusterScores.reduce((sum, score) => sum + score, 0);
    const systemScore = totalScore / clusterScores.length;
    
    // Store system score
    await this.redis.set(
      DriftMonitorKeys.systemScore(),
      systemScore.toString()
    );
    
    // Add to score history
    const timestamp = Date.now();
    await this.redis.zadd(
      DriftMonitorKeys.systemScoreHistory(),
      timestamp,
      JSON.stringify({
        timestamp,
        score: systemScore
      })
    );
    
    // Check for system-wide drift
    await this.checkSystemDrift(systemScore);
    
    return systemScore;
  }
  
  /**
   * Check for drift in a cluster's alignment
   * @param clusterId Cluster ID
   * @param currentScore Current alignment score
   */
  private async checkClusterDrift(
    clusterId: string,
    currentScore: number
  ): Promise<void> {
    // Get previous score from history
    const historyKey = DriftMonitorKeys.clusterScoreHistory(clusterId);
    const now = Date.now();
    const windowStart = now - this.config.driftWindowMs;
    
    // Get scores within the drift window
    const historyData = await this.redis.zrangebyscore(
      historyKey,
      windowStart,
      now,
      'WITHSCORES'
    );
    
    if (!historyData || historyData.length < 2) {
      // Not enough history to calculate drift
      return;
    }
    
    // Parse history data
    const historyEntries = [];
    for (let i = 0; i < historyData.length; i += 2) {
      try {
        const entry = JSON.parse(historyData[i]);
        historyEntries.push({
          ...entry,
          timestamp: parseInt(historyData[i + 1])
        });
      } catch (e) {
        // Skip invalid entries
      }
    }
    
    if (historyEntries.length < 2) {
      return;
    }
    
    // Sort by timestamp
    historyEntries.sort((a, b) => a.timestamp - b.timestamp);
    
    // Get oldest score in window
    const oldestEntry = historyEntries[0];
    const previousScore = oldestEntry.score;
    
    // Calculate drift
    const scoreDelta = previousScore - currentScore;
    
    // Check if drift exceeds threshold
    if (scoreDelta < this.config.minScoreDelta) {
      return;
    }
    
    // Determine severity
    let severity: DriftAlertSeverity;
    if (currentScore <= this.config.emergencyThreshold) {
      severity = DriftAlertSeverity.EMERGENCY;
    } else if (currentScore <= this.config.criticalThreshold) {
      severity = DriftAlertSeverity.CRITICAL;
    } else if (currentScore <= this.config.warningThreshold) {
      severity = DriftAlertSeverity.WARNING;
    } else {
      severity = DriftAlertSeverity.INFO;
    }
    
    // Create alert
    const alertId = `drift:cluster:${clusterId}:${now}`;
    const alert: AlignmentDriftAlert = {
      alertId,
      clusterId,
      timestamp: now,
      severity,
      description: `Cluster alignment drift detected: ${scoreDelta.toFixed(2)} point decrease over ${Math.round(this.config.driftWindowMs / (60 * 60 * 1000))} hours`,
      status: DriftAlertStatus.ACTIVE,
      driftScore: scoreDelta,
      recommendedActions: this.getRecommendedActions(severity),
      actionsTaken: [],
      context: {
        previousScore,
        currentScore,
        scoreDelta,
        driftPeriod: this.config.driftWindowMs,
        affectedCategories: [], // Would be populated in a real system
        violatedAnchors: []    // Would be populated in a real system
      }
    };
    
    // Store the alert
    await this.redis.set(
      DriftMonitorKeys.driftAlert(alertId),
      JSON.stringify(alert)
    );
    
    // Add to active alerts
    await this.redis.sadd(
      DriftMonitorKeys.activeAlerts(),
      alertId
    );
    
    // Add to cluster alerts
    await this.redis.zadd(
      DriftMonitorKeys.clusterAlerts(clusterId),
      now,
      alertId
    );
    
    // Notify handlers
    await this.notifyAlertHandlers(alert);
    
    // Take automatic actions based on severity
    await this.takeAutomaticActions(alert);
  }
  
  /**
   * Check for drift in system-wide alignment
   * @param currentScore Current system-wide alignment score
   */
  private async checkSystemDrift(currentScore: number): Promise<void> {
    // Similar to checkClusterDrift but for system-wide
    const historyKey = DriftMonitorKeys.systemScoreHistory();
    const now = Date.now();
    const windowStart = now - this.config.driftWindowMs;
    
    // Get scores within the drift window
    const historyData = await this.redis.zrangebyscore(
      historyKey,
      windowStart,
      now,
      'WITHSCORES'
    );
    
    if (!historyData || historyData.length < 2) {
      // Not enough history to calculate drift
      return;
    }
    
    // Parse history data (similar to checkClusterDrift)
    const historyEntries = [];
    for (let i = 0; i < historyData.length; i += 2) {
      try {
        const entry = JSON.parse(historyData[i]);
        historyEntries.push({
          ...entry,
          timestamp: parseInt(historyData[i + 1])
        });
      } catch (e) {
        // Skip invalid entries
      }
    }
    
    if (historyEntries.length < 2) {
      return;
    }
    
    // Sort by timestamp
    historyEntries.sort((a, b) => a.timestamp - b.timestamp);
    
    // Get oldest score in window
    const oldestEntry = historyEntries[0];
    const previousScore = oldestEntry.score;
    
    // Calculate drift
    const scoreDelta = previousScore - currentScore;
    
    // Check if drift exceeds threshold
    if (scoreDelta < this.config.minScoreDelta) {
      return;
    }
    
    // Determine severity (same as in checkClusterDrift)
    let severity: DriftAlertSeverity;
    if (currentScore <= this.config.emergencyThreshold) {
      severity = DriftAlertSeverity.EMERGENCY;
    } else if (currentScore <= this.config.criticalThreshold) {
      severity = DriftAlertSeverity.CRITICAL;
    } else if (currentScore <= this.config.warningThreshold) {
      severity = DriftAlertSeverity.WARNING;
    } else {
      severity = DriftAlertSeverity.INFO;
    }
    
    // Create alert for system-wide drift
    const alertId = `drift:system:${now}`;
    const alert: AlignmentDriftAlert = {
      alertId,
      timestamp: now,
      severity,
      description: `System-wide alignment drift detected: ${scoreDelta.toFixed(2)} point decrease over ${Math.round(this.config.driftWindowMs / (60 * 60 * 1000))} hours`,
      status: DriftAlertStatus.ACTIVE,
      driftScore: scoreDelta,
      recommendedActions: this.getRecommendedActions(severity, true),
      actionsTaken: [],
      context: {
        previousScore,
        currentScore,
        scoreDelta,
        driftPeriod: this.config.driftWindowMs,
        affectedCategories: [], // Would be populated in a real system
        violatedAnchors: []    // Would be populated in a real system
      }
    };
    
    // Store the alert
    await this.redis.set(
      DriftMonitorKeys.driftAlert(alertId),
      JSON.stringify(alert)
    );
    
    // Add to active alerts
    await this.redis.sadd(
      DriftMonitorKeys.activeAlerts(),
      alertId
    );
    
    // Add to system alerts
    await this.redis.zadd(
      DriftMonitorKeys.systemAlerts(),
      now,
      alertId
    );
    
    // Notify handlers
    await this.notifyAlertHandlers(alert);
    
    // Take automatic actions based on severity
    await this.takeAutomaticActions(alert);
  }
  
  /**
   * Get recommended actions based on alert severity
   * @param severity Alert severity
   * @param isSystemWide Whether this is a system-wide alert
   * @returns Array of recommended actions
   */
  private getRecommendedActions(
    severity: DriftAlertSeverity,
    isSystemWide: boolean = false
  ): DriftResponseAction[] {
    switch (severity) {
      case DriftAlertSeverity.INFO:
        return [DriftResponseAction.MONITOR];
        
      case DriftAlertSeverity.WARNING:
        return [DriftResponseAction.NOTIFY, DriftResponseAction.MONITOR];
        
      case DriftAlertSeverity.CRITICAL:
        return isSystemWide
          ? [DriftResponseAction.NOTIFY, DriftResponseAction.RECONCILIATION]
          : [DriftResponseAction.NOTIFY, DriftResponseAction.QUARANTINE];
        
      case DriftAlertSeverity.EMERGENCY:
        return isSystemWide
          ? [DriftResponseAction.NOTIFY, DriftResponseAction.RECONCILIATION, DriftResponseAction.FORK_ISOLATION]
          : [DriftResponseAction.NOTIFY, DriftResponseAction.QUARANTINE, DriftResponseAction.SHUTDOWN];
        
      default:
        return [DriftResponseAction.MONITOR];
    }
  }
  
  /**
   * Notify all registered handlers for an alert
   * @param alert Alert to notify about
   */
  private async notifyAlertHandlers(alert: AlignmentDriftAlert): Promise<void> {
    const handlers = this.alertHandlers.get(alert.severity) || [];
    
    for (const handler of handlers) {
      try {
        await handler(alert);
      } catch (error) {
        console.error('Error in alignment drift alert handler:', error);
      }
    }
  }
  
  /**
   * Take automatic actions based on alert
   * @param alert Alert to respond to
   */
  private async takeAutomaticActions(alert: AlignmentDriftAlert): Promise<void> {
    // For this implementation, we'll just log the actions that would be taken
    
    for (const action of alert.recommendedActions) {
      switch (action) {
        case DriftResponseAction.QUARANTINE:
          if (this.config.autoQuarantineEnabled && alert.agentId) {
            await this.quarantineAgent(alert.agentId, alert.alertId);
            
            // Record the action
            alert.actionsTaken.push({
              action: DriftResponseAction.QUARANTINE,
              timestamp: Date.now(),
              result: `Agent ${alert.agentId} quarantined`
            });
          }
          break;
          
        case DriftResponseAction.RECONCILIATION:
          if (this.config.autoReconciliationEnabled) {
            // In a real system, this would trigger a reconciliation process
            console.log(`[DRIFT MONITOR] Would initiate reconciliation for alert: ${alert.alertId}`);
            
            // Record the action
            alert.actionsTaken.push({
              action: DriftResponseAction.RECONCILIATION,
              timestamp: Date.now(),
              result: 'Reconciliation initiated'
            });
          }
          break;
          
        // Other actions would be implemented here
      }
    }
    
    // Update the alert with actions taken
    if (alert.actionsTaken.length > 0) {
      await this.redis.set(
        DriftMonitorKeys.driftAlert(alert.alertId),
        JSON.stringify(alert)
      );
    }
  }
  
  /**
   * Quarantine an agent
   * @param agentId Agent ID to quarantine
   * @param alertId Alert ID that triggered the quarantine
   */
  private async quarantineAgent(agentId: string, alertId: string): Promise<void> {
    // Add to quarantined agents
    await this.redis.sadd(
      DriftMonitorKeys.quarantinedAgents(),
      agentId
    );
    
    // Store quarantine metadata
    await this.redis.set(
      `alignment:quarantine:agent:${agentId}`,
      JSON.stringify({
        agentId,
        quarantinedAt: Date.now(),
        alertId,
        status: 'active'
      })
    );
    
    console.log(`[DRIFT MONITOR] Agent ${agentId} quarantined due to alert ${alertId}`);
  }
  
  /**
   * Release an agent from quarantine
   * @param agentId Agent ID to release
   */
  public async releaseFromQuarantine(agentId: string): Promise<boolean> {
    // Check if agent is quarantined
    const isQuarantined = await this.redis.sismember(
      DriftMonitorKeys.quarantinedAgents(),
      agentId
    );
    
    if (!isQuarantined) {
      return false;
    }
    
    // Remove from quarantined agents
    await this.redis.srem(
      DriftMonitorKeys.quarantinedAgents(),
      agentId
    );
    
    // Update quarantine metadata
    const quarantineKey = `alignment:quarantine:agent:${agentId}`;
    const quarantineData = await this.redis.get(quarantineKey);
    
    if (quarantineData) {
      const quarantine = JSON.parse(quarantineData);
      quarantine.status = 'released';
      quarantine.releasedAt = Date.now();
      
      await this.redis.set(quarantineKey, JSON.stringify(quarantine));
    }
    
    console.log(`[DRIFT MONITOR] Agent ${agentId} released from quarantine`);
    
    return true;
  }
  
  /**
   * Check if an agent is quarantined
   * @param agentId Agent ID to check
   * @returns Whether the agent is quarantined
   */
  public async isQuarantined(agentId: string): Promise<boolean> {
    return await this.redis.sismember(
      DriftMonitorKeys.quarantinedAgents(),
      agentId
    );
  }
  
  /**
   * Get all active alignment drift alerts
   * @returns Array of active alerts
   */
  public async getActiveAlerts(): Promise<AlignmentDriftAlert[]> {
    const alertIds = await this.redis.smembers(DriftMonitorKeys.activeAlerts());
    
    if (!alertIds || alertIds.length === 0) {
      return [];
    }
    
    const alerts: AlignmentDriftAlert[] = [];
    
    for (const alertId of alertIds) {
      const alertData = await this.redis.get(DriftMonitorKeys.driftAlert(alertId));
      
      if (alertData) {
        try {
          alerts.push(JSON.parse(alertData));
        } catch (e) {
          // Skip invalid data
        }
      }
    }
    
    return alerts;
  }
  
  /**
   * Get all alerts for a specific agent
   * @param agentId Agent ID
   * @returns Array of alerts for the agent
   */
  public async getAgentAlerts(agentId: string): Promise<AlignmentDriftAlert[]> {
    const alertIds = await this.redis.zrange(
      DriftMonitorKeys.agentAlerts(agentId),
      0,
      -1
    );
    
    if (!alertIds || alertIds.length === 0) {
      return [];
    }
    
    const alerts: AlignmentDriftAlert[] = [];
    
    for (const alertId of alertIds) {
      const alertData = await this.redis.get(DriftMonitorKeys.driftAlert(alertId));
      
      if (alertData) {
        try {
          alerts.push(JSON.parse(alertData));
        } catch (e) {
          // Skip invalid data
        }
      }
    }
    
    return alerts;
  }
  
  /**
   * Update the status of an alert
   * @param alertId Alert ID
   * @param status New status
   * @param comment Optional comment
   */
  public async updateAlertStatus(
    alertId: string,
    status: DriftAlertStatus,
    comment?: string
  ): Promise<boolean> {
    const alertKey = DriftMonitorKeys.driftAlert(alertId);
    const alertData = await this.redis.get(alertKey);
    
    if (!alertData) {
      return false;
    }
    
    try {
      const alert = JSON.parse(alertData) as AlignmentDriftAlert;
      alert.status = status;
      
      // Add status change to action history
      alert.actionsTaken.push({
        action: DriftResponseAction.NOTIFY,
        timestamp: Date.now(),
        result: `Status changed to ${status}${comment ? `: ${comment}` : ''}`
      });
      
      // Update the alert
      await this.redis.set(alertKey, JSON.stringify(alert));
      
      // If resolved or false positive, remove from active alerts
      if (status === DriftAlertStatus.RESOLVED || status === DriftAlertStatus.FALSE_POSITIVE) {
        await this.redis.srem(DriftMonitorKeys.activeAlerts(), alertId);
      }
      
      return true;
    } catch (e) {
      return false;
    }
  }
} 