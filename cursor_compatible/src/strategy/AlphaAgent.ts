/**
 * Alpha Signal Generation Agent
 * 
 * Generates trading signals and communicates strategy intent
 * to the execution layer through the Fusion Memory system.
 */

import { FusionMemory } from '../fusion/FusionMemory.js';
import { FusionState } from '../types/fusion.types.js';
import { OrderIntent } from '../types/execution.types.js';
import { TemporalRiskModel } from '../models/TemporalRiskModel.js';

/**
 * Alpha Agent configuration
 */
export interface AlphaAgentConfig {
  // Agent identifier
  id: string;
  
  // Agent name
  name: string;
  
  // Assets to trade
  assets: string[];
  
  // Strategy type
  strategyType: 'momentum' | 'mean-reversion' | 'trend-following' | 'ml-prediction';
  
  // Default trading horizon
  defaultHorizon: FusionState['strategyIntent']['horizon'];
  
  // Default confidence threshold to generate signals
  confidenceThreshold: number;
  
  // Whether to adapt based on execution feedback
  adaptToFeedback: boolean;
  
  // Whether to adapt based on time-of-day profile
  adaptToTimeOfDay: boolean;
}

/**
 * Agent for generating alpha signals and communicating intent
 */
export class AlphaAgent {
  private isActive: boolean = false;
  private signalListeners: Array<(intent: OrderIntent) => void> = [];
  
  /**
   * Create a new Alpha Agent
   * @param config Agent configuration
   * @param fusionMemory Shared fusion memory system
   * @param temporalRiskModel Optional model for time-of-day adjustments
   */
  constructor(
    private readonly config: AlphaAgentConfig,
    private readonly fusionMemory: FusionMemory,
    private readonly temporalRiskModel?: TemporalRiskModel
  ) {
    // Subscribe to execution feedback for all configured assets
    for (const asset of config.assets) {
      this.subscribeToFeedback(asset);
    }
  }
  
  /**
   * Start the agent
   */
  start(): void {
    this.isActive = true;
    console.log(`Alpha Agent ${this.config.name} started`);
  }
  
  /**
   * Stop the agent
   */
  stop(): void {
    this.isActive = false;
    console.log(`Alpha Agent ${this.config.name} stopped`);
  }
  
  /**
   * Generate a trading signal based on current market conditions
   * @param asset Asset to generate signal for
   * @param confidence Signal confidence level (0-1)
   * @param direction Trade direction
   * @param quantity Trade quantity
   * @param urgency Execution urgency
   */
  async generateSignal(
    asset: string,
    confidence: number,
    direction: 'buy' | 'sell',
    quantity: number,
    urgency: FusionState['strategyIntent']['urgency'] = 'medium'
  ): Promise<void> {
    if (!this.isActive) {
      console.log(`Cannot generate signal: Agent ${this.config.name} is not active`);
      return;
    }
    
    // Apply time-of-day adjustments if enabled
    let adjustedConfidence = confidence;
    let adjustedUrgency = urgency;
    
    if (this.config.adaptToTimeOfDay && this.temporalRiskModel) {
      const adjustments = await this.applyTimeOfDayAdjustments(asset, confidence, urgency);
      adjustedConfidence = adjustments.confidence;
      adjustedUrgency = adjustments.urgency;
      
      console.log(`Applied time-of-day adjustments for ${asset}: confidence ${confidence} -> ${adjustedConfidence}, urgency ${urgency} -> ${adjustedUrgency}`);
    }
    
    if (adjustedConfidence < this.config.confidenceThreshold) {
      console.log(`Signal rejected: Confidence ${adjustedConfidence} below threshold ${this.config.confidenceThreshold}`);
      return;
    }
    
    // Create strategic intent
    const strategyIntent: FusionState['strategyIntent'] = {
      direction: direction === 'buy' ? 'long' : 'short',
      confidence: adjustedConfidence,
      horizon: this.config.defaultHorizon,
      urgency: adjustedUrgency,
      timestamp: Date.now(),
      metadata: {
        strategyType: this.config.strategyType,
        agentId: this.config.id,
        originalConfidence: confidence,
        timeAdjusted: this.config.adaptToTimeOfDay
      }
    };
    
    // Update fusion memory with intent
    this.fusionMemory.updateIntent(asset, strategyIntent);
    
    // Create order intent
    const orderIntent: OrderIntent = {
      asset,
      side: direction,
      quantity,
      urgency: adjustedUrgency,
      tags: [this.config.strategyType, `agent:${this.config.id}`],
      ttlMs: this.getTimeToLiveByHorizon(strategyIntent.horizon)
    };
    
    // Notify signal listeners
    this.notifySignalListeners(orderIntent);
    
    console.log(`Signal generated for ${asset}: ${direction} ${quantity} with confidence ${adjustedConfidence}`);
  }
  
  /**
   * Apply time-of-day adjustments to signal parameters
   * @param asset Asset to get adjustments for
   * @param confidence Base confidence level
   * @param urgency Base urgency level
   * @returns Adjusted confidence and urgency
   */
  private async applyTimeOfDayAdjustments(
    asset: string,
    confidence: number,
    urgency: FusionState['strategyIntent']['urgency']
  ): Promise<{ confidence: number; urgency: FusionState['strategyIntent']['urgency'] }> {
    if (!this.temporalRiskModel) {
      return { confidence, urgency };
    }
    
    try {
      // Get the current hour's risk profile
      const profile = await this.temporalRiskModel.getCurrentHourProfile(asset);
      
      // Adjust confidence based on profile
      const adjustedConfidence = Math.min(1, Math.max(0.01, confidence + profile.confidenceAdjustment));
      
      // Adjust urgency based on alpha decay rate
      let adjustedUrgency = urgency;
      
      // If high alpha decay, increase urgency to execute before signal fades
      if (profile.alphaDecayRate > 0.15) {
        adjustedUrgency = 'high';
      } 
      // If negative alpha decay (improving alpha), can be less urgent
      else if (profile.alphaDecayRate < -0.15 && urgency === 'medium') {
        adjustedUrgency = 'low';
      }
      
      // If high volatility during this hour, prefer high urgency
      if (profile.avgVolatility > 0.3 && urgency !== 'low') {
        adjustedUrgency = 'high';
      }
      
      return {
        confidence: adjustedConfidence,
        urgency: adjustedUrgency
      };
    } catch (error) {
      console.error(`Error applying time-of-day adjustments for ${asset}:`, error);
      return { confidence, urgency };
    }
  }
  
  /**
   * Subscribe to execution feedback for an asset
   * @param asset Asset to subscribe to
   */
  private subscribeToFeedback(asset: string): void {
    this.fusionMemory.subscribe(asset, (state: FusionState) => {
      if (state.executionFeedback && this.config.adaptToFeedback) {
        this.processExecutionFeedback(asset, state);
      }
    });
  }
  
  /**
   * Process execution feedback to adapt strategy
   * @param asset Asset
   * @param state Current fusion state
   */
  private processExecutionFeedback(asset: string, state: FusionState): void {
    if (!state.executionFeedback) return;
    
    const feedback = state.executionFeedback;
    
    // Adapt future signals based on execution reality
    if (feedback.slippage > 50) { // High slippage (> 0.5%)
      console.log(`High slippage detected for ${asset}, adapting strategy`);
      
      // Increase patience, decrease urgency for future signals
      const nextSignalUrgency: FusionState['strategyIntent']['urgency'] = 'low';
      
      // Store learning insights
      this.fusionMemory.updateLearning(asset, {
        learningRate: 0.1,
        explorationRate: 0.2,
        featureWeights: {
          slippage: 0.8,
          latency: 0.5,
          adverseSelection: 0.7
        }
      });
    }
    
    if (feedback.fillRate < 0.8) { // Poor fill rate
      console.log(`Poor fill rate detected for ${asset}, adapting size`);
      // Reduce trade sizes or switch to more passive execution
    }
    
    if (feedback.adverseSelectionRisk > 0.7) {
      console.log(`High adverse selection risk for ${asset}, adapting timing`);
      // Improve entry timing based on feedback
    }
  }
  
  /**
   * Convert trading horizon to TTL in milliseconds
   * @param horizon Trading horizon
   * @returns TTL in milliseconds
   */
  private getTimeToLiveByHorizon(
    horizon: FusionState['strategyIntent']['horizon']
  ): number {
    switch (horizon) {
      case 'scalp':
        return 5 * 60 * 1000; // 5 minutes
      case 'swing':
        return 60 * 60 * 1000; // 1 hour
      case 'macro':
        return 24 * 60 * 60 * 1000; // 1 day
      default:
        return 30 * 60 * 1000; // 30 minutes (default)
    }
  }
  
  /**
   * Add a listener for new signals
   * @param listener Function to call when a new signal is generated
   * @returns Function to remove the listener
   */
  addSignalListener(listener: (intent: OrderIntent) => void): () => void {
    this.signalListeners.push(listener);
    
    return () => {
      const index = this.signalListeners.indexOf(listener);
      if (index !== -1) {
        this.signalListeners.splice(index, 1);
      }
    };
  }
  
  /**
   * Notify all signal listeners about a new signal
   * @param intent Order intent
   */
  private notifySignalListeners(intent: OrderIntent): void {
    for (const listener of this.signalListeners) {
      listener(intent);
    }
  }
  
  /**
   * Get the agent's ID
   */
  getId(): string {
    return this.config.id;
  }
  
  /**
   * Get the agent's name
   */
  getName(): string {
    return this.config.name;
  }
  
  /**
   * Get the assets traded by this agent
   */
  getAssets(): string[] {
    return [...this.config.assets];
  }
} 