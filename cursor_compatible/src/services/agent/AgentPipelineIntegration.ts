/**
 * Agent Pipeline Integration
 * 
 * Integrates agent health monitoring with the signal processing pipeline.
 * This service provides middleware functions to handle agent behavior
 * adjustments based on trust scores and health modes.
 */

import { TrustScoreService } from './TrustScoreService.js';
import { AgentHealthManager } from './AgentHealthManager.js';
import { AgentHealthMode } from '../../types/agent.types.js';

/**
 * Agent signal data
 */
export interface AgentSignal {
  agentId: string;
  asset: string;
  direction: string;
  confidence: number;
  timestamp: number;
  [key: string]: any; // Additional properties
}

/**
 * Agent operation result
 */
export interface OperationResult {
  success: boolean;
  errorType?: string;
  message?: string;
}

/**
 * Agent pipeline integration service
 */
export class AgentPipelineIntegration {
  constructor(
    private readonly trustService: TrustScoreService,
    private readonly healthManager: AgentHealthManager
  ) {}
  
  /**
   * Signal filter middleware
   * Applies health-based adjustments to agent signals
   * @param agentId Agent identifier
   * @param signal Signal data
   * @returns Whether the signal should be processed or dropped
   */
  async signalFilter(agentId: string, signal: AgentSignal): Promise<boolean> {
    const trustState = await this.trustService.getTrustState(agentId);
    const adjustments = await this.healthManager.getHealthAdjustments(agentId);
    
    // Completely suppress signals from critical agents
    if (adjustments.isSuppressed) {
      console.log(`Signal from agent ${agentId} suppressed due to CRITICAL health mode`);
      return false;
    }
    
    // Apply confidence threshold adjustment
    if (signal.confidence < adjustments.minConfidenceThreshold) {
      console.log(`Signal from agent ${agentId} dropped due to low confidence (${signal.confidence} < ${adjustments.minConfidenceThreshold})`);
      return false;
    }
    
    // Apply throttling (random drop based on throttle multiplier)
    if (adjustments.signalThrottleMultiplier < 1.0) {
      const shouldProcess = Math.random() <= adjustments.signalThrottleMultiplier;
      if (!shouldProcess) {
        console.log(`Signal from agent ${agentId} dropped due to throttling (${adjustments.signalThrottleMultiplier * 100}% rate)`);
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Operation result handler
   * Updates agent trust based on operation results
   * @param agentId Agent identifier
   * @param result Operation result
   * @returns Updated trust score
   */
  async handleOperationResult(agentId: string, result: OperationResult): Promise<number> {
    if (result.success) {
      return await this.healthManager.recordHealingSuccess(agentId);
    } else {
      // Calculate severity based on error type
      const severity = this.calculateErrorSeverity(result.errorType);
      return await this.healthManager.recordFailure(agentId, severity);
    }
  }
  
  /**
   * Calculate error severity based on error type
   * @param errorType Type of error
   * @returns Severity score between 0 and 1
   */
  private calculateErrorSeverity(errorType?: string): number {
    if (!errorType) return 0.5; // Default moderate severity
    
    // Map error types to severity levels
    switch (errorType) {
      case 'network':
        return 0.3; // Lower severity for network issues
      case 'validation':
        return 0.5; // Moderate severity for validation errors
      case 'timing':
        return 0.2; // Lower severity for timing issues
      case 'security':
        return 0.9; // High severity for security violations
      case 'critical':
        return 1.0; // Maximum severity for critical errors
      default:
        return 0.5; // Default moderate severity
    }
  }
  
  /**
   * Check if an agent is allowed to perform sensitive operations
   * @param agentId Agent identifier
   * @returns Whether the agent is allowed to perform sensitive operations
   */
  async canPerformSensitiveOperations(agentId: string): Promise<boolean> {
    const trustState = await this.trustService.getTrustState(agentId);
    
    // Only allow agents in NORMAL health mode to perform sensitive operations
    return trustState.mode === AgentHealthMode.NORMAL;
  }
  
  /**
   * Get telemetry data about agent performance including health metrics
   * @param agentId Agent identifier
   * @returns Telemetry data object
   */
  async getAgentTelemetry(agentId: string): Promise<Record<string, any>> {
    const trustState = await this.trustService.getTrustState(agentId);
    const adjustments = await this.healthManager.getHealthAdjustments(agentId);
    
    // Get healing success count if applicable
    let healingSuccessCount = 0;
    if (trustState.mode === AgentHealthMode.SELF_HEALING && trustState.enteredSelfHealingAt) {
      const metaKey = `agent:${agentId}:trust_meta`;
      const successCountRaw = await this.trustService['redis'].hget(metaKey, 'healing_success_count');
      healingSuccessCount = successCountRaw ? parseInt(successCountRaw) : 0;
    }
    
    return {
      agentId,
      trustScore: trustState.score,
      healthMode: trustState.mode,
      enteredSelfHealingAt: trustState.enteredSelfHealingAt,
      healingTimeMs: trustState.enteredSelfHealingAt 
        ? Date.now() - trustState.enteredSelfHealingAt 
        : null,
      healingSuccessCount,
      signalThrottleMultiplier: adjustments.signalThrottleMultiplier,
      minConfidenceThreshold: adjustments.minConfidenceThreshold,
      isSuppressed: adjustments.isSuppressed,
      recoveryBoost: adjustments.recoveryBoost,
      timestamp: Date.now()
    };
  }
} 