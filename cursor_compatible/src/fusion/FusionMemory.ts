/**
 * Fusion Memory
 * 
 * A real-time memory layer where strategy and execution agents can
 * synchronize key metadata and establish bidirectional communication.
 */

import { FusionState } from '../types/fusion.types.js';

/**
 * In-memory store for fusion state across assets
 */
export class FusionMemory {
  // Store fusion states by asset
  private state: Record<string, FusionState> = {};
  
  // Store event listeners
  private listeners: Record<string, Array<(state: FusionState) => void>> = {};
  
  /**
   * Set the full fusion state for an asset
   * @param asset Asset identifier (e.g., 'ETH/USDT')
   * @param state Fusion state to set
   */
  set(asset: string, state: FusionState): void {
    this.state[asset] = state;
    this.notifyListeners(asset, state);
  }
  
  /**
   * Get the current fusion state for an asset
   * @param asset Asset identifier
   * @returns Fusion state or undefined if not found
   */
  get(asset: string): FusionState | undefined {
    return this.state[asset];
  }
  
  /**
   * Update the strategy intent for an asset
   * @param asset Asset identifier
   * @param intent New strategy intent
   */
  updateIntent(asset: string, intent: FusionState['strategyIntent']): void {
    if (!this.state[asset]) {
      this.state[asset] = { strategyIntent: intent };
    } else {
      this.state[asset].strategyIntent = intent;
    }
    this.notifyListeners(asset, this.state[asset]);
  }
  
  /**
   * Update the execution feedback for an asset
   * @param asset Asset identifier
   * @param feedback Execution feedback
   */
  updateFeedback(asset: string, feedback: FusionState['executionFeedback']): void {
    if (!this.state[asset] || !feedback) return;
    
    this.state[asset].executionFeedback = feedback;
    
    // Update historical metrics
    this.updateHistoricalMetrics(asset, feedback);
    this.notifyListeners(asset, this.state[asset]);
  }
  
  /**
   * Update historical metrics based on new execution feedback
   * @param asset Asset identifier
   * @param feedback New execution feedback
   */
  private updateHistoricalMetrics(
    asset: string, 
    feedback: NonNullable<FusionState['executionFeedback']>
  ): void {
    const state = this.state[asset];
    if (!state) return;
    
    // Initialize history if it doesn't exist
    if (!state.history) {
      state.history = {
        averageSlippage: feedback.slippage,
        averageFillRate: feedback.fillRate,
        pnl: {
          realized: 0,
          unrealized: 0,
          currency: 'USD'
        },
        executionCount: 1
      };
      return;
    }
    
    const history = state.history;
    const count = history.executionCount;
    
    // Calculate new rolling averages
    history.averageSlippage = 
      (history.averageSlippage * count + feedback.slippage) / (count + 1);
    
    history.averageFillRate = 
      (history.averageFillRate * count + feedback.fillRate) / (count + 1);
    
    // Increment execution count
    history.executionCount += 1;
  }
  
  /**
   * Subscribe to changes for a specific asset
   * @param asset Asset identifier 
   * @param callback Function to call when state changes
   * @returns Unsubscribe function
   */
  subscribe(asset: string, callback: (state: FusionState) => void): () => void {
    if (!this.listeners[asset]) {
      this.listeners[asset] = [];
    }
    
    this.listeners[asset].push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.listeners[asset].indexOf(callback);
      if (index !== -1) {
        this.listeners[asset].splice(index, 1);
      }
    };
  }
  
  /**
   * Notify all listeners for an asset about state changes
   * @param asset Asset identifier
   * @param state Updated fusion state
   */
  private notifyListeners(asset: string, state: FusionState): void {
    if (this.listeners[asset]) {
      for (const listener of this.listeners[asset]) {
        listener(state);
      }
    }
  }
  
  /**
   * Get all tracked assets
   * @returns Array of asset identifiers
   */
  getAssets(): string[] {
    return Object.keys(this.state);
  }
  
  /**
   * Clear fusion state for an asset
   * @param asset Asset identifier
   */
  clear(asset: string): void {
    delete this.state[asset];
  }
  
  /**
   * Update learning parameters for an asset
   * @param asset Asset identifier
   * @param learning Learning parameters
   */
  updateLearning(asset: string, learning: FusionState['learning']): void {
    if (this.state[asset]) {
      this.state[asset].learning = learning;
      this.notifyListeners(asset, this.state[asset]);
    }
  }
} 