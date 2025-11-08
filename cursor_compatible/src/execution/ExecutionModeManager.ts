/**
 * Adaptive Execution Mode Manager
 * 
 * Dynamically shifts execution strategies based on real-time market conditions.
 * The module adapts how trades are executed depending on volatility, liquidity,
 * and market stability - prioritizing speed, stealth, or safety as needed.
 */

import { OrderIntent, ExecutionStyle } from '../types/execution.types.js';
import { SmartOrderRouter } from '../infra/router/SmartOrderRouter.js';
import { TransactionGuard, TransactionRiskReport } from './risk/TransactionGuard.js';
import { createLogger } from '../common/logger.js';
import { ExecutionMemory, getExecutionMemory } from './ExecutionMemory.js';

const logger = createLogger('ExecutionModeManager');

/**
 * Available execution modes
 */
export enum ExecutionMode {
  /**
   * Standard smart routing with balanced cost and success optimization
   */
  NORMAL = 'NORMAL',
  
  /**
   * Uses smaller fragmented trades and prioritizes routes with low
   * mempool visibility to avoid front-running
   */
  STEALTH = 'STEALTH',
  
  /**
   * Optimizes for speed with aggressive gas pricing and quick execution
   * at expense of optimal price
   */
  SPEED = 'SPEED',
  
  /**
   * Prioritizes safety with strict slippage limits, liquidity thresholds,
   * and mandatory simulation checks
   */
  SAFETY = 'SAFETY'
}

/**
 * Execution mode context information gathered from various sources
 */
export interface ExecutionModeContext {
  // Market volatility index (0-1)
  volatilityIndex: number;
  
  // Order size relative to pool depth (0-1)
  orderSizeRelativeToPool: number;
  
  // Gas price volatility in recent blocks (% change)
  gasPriceVolatility: number;
  
  // Number of recent blocks with high gas price changes
  gasVolatilityBlockCount: number;
  
  // Current mempool congestion level (0-1)
  mempoolCongestion: number;
  
  // Recent transaction failures (count)
  recentFailureCount: number;
  
  // Recent failed transaction hashes (for pattern analysis)
  recentFailures: Array<{
    txHash: string;
    error: string;
    timestamp: number;
  }>;
  
  // Current smart order router recommendation
  routerRecommendation?: ExecutionStyle;

  // Transaction guard risk assessment
  transactionRisk?: TransactionRiskReport;

  // Historical trades success rate in current conditions (0-1)
  historicalSuccessRate?: number;

  // Token-specific liquidity measure
  specificTokenLiquidity?: number;

  // Custom risk factors by asset
  customRiskFactors?: Record<string, number>;
}

/**
 * Result of mode determination including selected mode and reasoning
 */
export interface ModeSelectionResult {
  // Selected execution mode
  mode: ExecutionMode;
  
  // Primary reason for selecting this mode
  primaryReason: string;
  
  // Additional contributing factors
  contributingFactors: string[];
  
  // Configuration overrides for selected mode
  configOverrides?: Record<string, any>;
  
  // Timestamp when the selection was made
  timestamp: number;
}

/**
 * Thresholds for triggering mode switches
 */
export interface ModeSwitchingThresholds {
  // Volatility threshold for triggering SAFETY mode
  highVolatilityThreshold: number;
  
  // Order size relative to pool depth for STEALTH mode
  largeSizeThreshold: number;
  
  // Gas price volatility threshold for SPEED mode
  gasVolatilityThreshold: number;
  
  // Failure count threshold for SAFETY mode
  failureCountThreshold: number;
  
  // Mempool congestion threshold for STEALTH mode
  highCongestionThreshold: number;

  // Liquidity threshold for SAFETY mode (in $)
  minimumLiquidityThreshold: number;
}

/**
 * Default thresholds
 */
const DEFAULT_THRESHOLDS: ModeSwitchingThresholds = {
  highVolatilityThreshold: 0.7,
  largeSizeThreshold: 0.15, // 15% of pool depth
  gasVolatilityThreshold: 0.2, // 20% change
  failureCountThreshold: 2,
  highCongestionThreshold: 0.6,
  minimumLiquidityThreshold: 50000 // $50K
};

/**
 * Mode-specific execution parameters
 */
export interface ModeExecutionParams {
  // Maximum slippage tolerance in basis points
  maxSlippageBps: number;
  
  // Gas price multiplier
  gasPriceMultiplier: number;
  
  // Whether to fragment trades into smaller chunks
  fragmentTrades: boolean;
  
  // Number of fragments when fragmenting trades
  fragmentCount: number;
  
  // Whether to use private transaction (if available)
  usePrivateTx: boolean;
  
  // Cooldown between transactions in milliseconds
  txCooldownMs: number;
  
  // Whether to require simulation before execution
  requireSimulation: boolean;
  
  // Custom parameters specific to a mode
  custom?: Record<string, any>;
}

/**
 * Default execution parameters for each mode
 */
const MODE_PARAMS: Record<ExecutionMode, ModeExecutionParams> = {
  [ExecutionMode.NORMAL]: {
    maxSlippageBps: 100, // 1%
    gasPriceMultiplier: 1.1,
    fragmentTrades: false,
    fragmentCount: 1,
    usePrivateTx: false,
    txCooldownMs: 0,
    requireSimulation: true
  },
  [ExecutionMode.STEALTH]: {
    maxSlippageBps: 150, // 1.5%
    gasPriceMultiplier: 1.05,
    fragmentTrades: true,
    fragmentCount: 3,
    usePrivateTx: true,
    txCooldownMs: 45000, // 45 seconds between fragments
    requireSimulation: true,
    custom: {
      randomizeFragmentSizes: true,
      randomizeTiming: true,
      avoidPatternedExecution: true
    }
  },
  [ExecutionMode.SPEED]: {
    maxSlippageBps: 200, // 2%
    gasPriceMultiplier: 1.5,
    fragmentTrades: false,
    fragmentCount: 1,
    usePrivateTx: false,
    txCooldownMs: 0,
    requireSimulation: false,
    custom: {
      prioritizeTopDepthPools: true,
      skipOptionalValidations: true
    }
  },
  [ExecutionMode.SAFETY]: {
    maxSlippageBps: 50, // 0.5%
    gasPriceMultiplier: 1.2,
    fragmentTrades: false,
    fragmentCount: 1,
    usePrivateTx: false,
    txCooldownMs: 30000, // 30 seconds
    requireSimulation: true,
    custom: {
      doubleCheckPriceImpact: true,
      enforceMinimumLiquidity: true,
      rejectHighGasPrices: true
    }
  }
};

/**
 * Mode switching telemetry data
 */
export interface ModeSwitchTelemetry {
  // Previous execution mode
  previousMode: ExecutionMode;
  
  // New execution mode
  newMode: ExecutionMode;
  
  // Switch timestamp
  timestamp: number;
  
  // Asset being traded
  asset: string;
  
  // Reason for the switch
  reason: string;
  
  // Context data that triggered the switch
  contextData: Partial<ExecutionModeContext>;
  
  // Trade outcome after mode switch (if available)
  outcome?: 'success' | 'failure';
  
  // Additional metrics
  metrics?: Record<string, any>;
}

/**
 * Manager for adaptive execution mode switching
 */
export class ExecutionModeManager {
  private currentMode: ExecutionMode = ExecutionMode.NORMAL;
  private thresholds: ModeSwitchingThresholds;
  private modeSwitchHistory: ModeSwitchTelemetry[] = [];
  private executionMemory: ExecutionMemory;
  
  // Performance tracking by mode
  private modePerformance: Record<ExecutionMode, {
    successCount: number;
    failureCount: number;
    totalExecuted: number;
    avgSlippageBps: number;
    lastUsed: number;
  }> = {
    [ExecutionMode.NORMAL]: { successCount: 0, failureCount: 0, totalExecuted: 0, avgSlippageBps: 0, lastUsed: 0 },
    [ExecutionMode.STEALTH]: { successCount: 0, failureCount: 0, totalExecuted: 0, avgSlippageBps: 0, lastUsed: 0 },
    [ExecutionMode.SPEED]: { successCount: 0, failureCount: 0, totalExecuted: 0, avgSlippageBps: 0, lastUsed: 0 },
    [ExecutionMode.SAFETY]: { successCount: 0, failureCount: 0, totalExecuted: 0, avgSlippageBps: 0, lastUsed: 0 }
  };
  
  /**
   * Create a new execution mode manager
   */
  constructor(
    private readonly router: SmartOrderRouter,
    private readonly transactionGuard: TransactionGuard,
    thresholds?: Partial<ModeSwitchingThresholds>
  ) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    this.executionMemory = getExecutionMemory();
    logger.info('Execution Mode Manager initialized with default mode: NORMAL');
  }
  
  /**
   * Get the current execution mode
   */
  public getCurrentMode(): ExecutionMode {
    return this.currentMode;
  }
  
  /**
   * Get parameters for the current execution mode
   */
  public getCurrentModeParams(): ModeExecutionParams {
    return MODE_PARAMS[this.currentMode];
  }
  
  /**
   * Determine the best execution mode based on context
   * @param order Order intent to be executed
   * @param context Execution context data
   * @returns Mode selection result
   */
  public determineExecutionMode(
    order: OrderIntent,
    context: Partial<ExecutionModeContext>
  ): ModeSelectionResult {
    // Default values for missing context data
    const fullContext: ExecutionModeContext = {
      volatilityIndex: context.volatilityIndex ?? 0.3,
      orderSizeRelativeToPool: context.orderSizeRelativeToPool ?? 0.05,
      gasPriceVolatility: context.gasPriceVolatility ?? 0.1,
      gasVolatilityBlockCount: context.gasVolatilityBlockCount ?? 0,
      mempoolCongestion: context.mempoolCongestion ?? 0.3,
      recentFailureCount: context.recentFailureCount ?? 0,
      recentFailures: context.recentFailures ?? [],
      routerRecommendation: context.routerRecommendation,
      transactionRisk: context.transactionRisk,
      historicalSuccessRate: context.historicalSuccessRate,
      specificTokenLiquidity: context.specificTokenLiquidity,
      customRiskFactors: context.customRiskFactors
    };
    
    // Determine primary reasons and contributing factors
    const result: ModeSelectionResult = {
      mode: ExecutionMode.NORMAL,
      primaryReason: 'Default execution mode',
      contributingFactors: [],
      timestamp: Date.now()
    };
    
    // Check for SAFETY mode triggers
    if (fullContext.volatilityIndex >= this.thresholds.highVolatilityThreshold) {
      result.mode = ExecutionMode.SAFETY;
      result.primaryReason = `High volatility (${fullContext.volatilityIndex.toFixed(2)})`;
      result.contributingFactors.push('Market conditions unstable');
    }
    else if (fullContext.recentFailureCount >= this.thresholds.failureCountThreshold) {
      result.mode = ExecutionMode.SAFETY;
      result.primaryReason = `High failure rate (${fullContext.recentFailureCount} recent failures)`;
      result.contributingFactors.push('Recent transactions failing');
    }
    // Check for specific token liquidity issues
    else if (fullContext.specificTokenLiquidity !== undefined && 
             fullContext.specificTokenLiquidity < this.thresholds.minimumLiquidityThreshold) {
      result.mode = ExecutionMode.SAFETY;
      result.primaryReason = `Low token liquidity ($${fullContext.specificTokenLiquidity.toFixed(2)})`;
      result.contributingFactors.push('Token has insufficient market depth');
    }
    // Check for STEALTH mode triggers
    else if (fullContext.orderSizeRelativeToPool >= this.thresholds.largeSizeThreshold) {
      result.mode = ExecutionMode.STEALTH;
      result.primaryReason = `Large order size (${(fullContext.orderSizeRelativeToPool * 100).toFixed(2)}% of pool)`;
      result.contributingFactors.push('May cause significant price impact');
    }
    else if (fullContext.mempoolCongestion >= this.thresholds.highCongestionThreshold) {
      result.mode = ExecutionMode.STEALTH;
      result.primaryReason = `High mempool congestion (${fullContext.mempoolCongestion.toFixed(2)})`;
      result.contributingFactors.push('High front-running risk');
    }
    // Check for SPEED mode triggers
    else if (fullContext.gasPriceVolatility >= this.thresholds.gasVolatilityThreshold &&
             fullContext.gasVolatilityBlockCount > 3) {
      result.mode = ExecutionMode.SPEED;
      result.primaryReason = `Gas price volatility (${(fullContext.gasPriceVolatility * 100).toFixed(2)}% change)`;
      result.contributingFactors.push('Gas prices unstable, need quick execution');
    }
    
    // Consider transaction risk from TransactionGuard if available
    if (fullContext.transactionRisk) {
      const risk = fullContext.transactionRisk;
      
      if (risk.riskScore > 0.7 && result.mode !== ExecutionMode.SAFETY) {
        result.contributingFactors.push(`High transaction risk score (${risk.riskScore.toFixed(2)})`);
        if (result.mode === ExecutionMode.NORMAL) {
          result.mode = ExecutionMode.SAFETY;
          result.primaryReason = `High transaction risk score (${risk.riskScore.toFixed(2)})`;
        }
      }
      
      if (risk.poolVolatility > 0.6 && result.mode !== ExecutionMode.SAFETY) {
        result.contributingFactors.push(`High pool volatility (${risk.poolVolatility.toFixed(2)})`);
      }
    }
    
    // Consider router recommendation if available
    if (fullContext.routerRecommendation === ExecutionStyle.Aggressive && 
        result.mode === ExecutionMode.NORMAL) {
      result.mode = ExecutionMode.SPEED;
      result.primaryReason = 'Router recommended aggressive execution';
    } else if (fullContext.routerRecommendation === ExecutionStyle.Passive && 
               result.mode === ExecutionMode.NORMAL) {
      result.contributingFactors.push('Router recommended passive execution');
    }
    
    // Apply token-specific custom risk factors
    if (fullContext.customRiskFactors && 
        fullContext.customRiskFactors[order.asset] !== undefined) {
      const riskFactor = fullContext.customRiskFactors[order.asset];
      
      if (riskFactor > 0.8 && result.mode !== ExecutionMode.SAFETY) {
        result.mode = ExecutionMode.SAFETY;
        result.primaryReason = `High custom risk factor for ${order.asset} (${riskFactor.toFixed(2)})`;
      } else if (riskFactor > 0.5) {
        result.contributingFactors.push(`Elevated custom risk for ${order.asset} (${riskFactor.toFixed(2)})`);
      }
    }
    
    // Generate any config overrides specific to this execution
    result.configOverrides = this.generateConfigOverrides(order, fullContext, result.mode);
    
    // If this is a mode switch from current mode, log it
    if (this.currentMode !== result.mode) {
      this.logModeSwitch({
        previousMode: this.currentMode,
        newMode: result.mode,
        timestamp: Date.now(),
        asset: order.asset,
        reason: result.primaryReason,
        contextData: context
      });
      
      this.currentMode = result.mode;
    }
    
    logger.info(`Selected execution mode ${result.mode} for ${order.asset}: ${result.primaryReason}`);
    return result;
  }
  
  /**
   * Gather execution context data from all sources
   * @param order Order to be executed
   * @returns Execution context
   */
  public async gatherExecutionContext(order: OrderIntent): Promise<ExecutionModeContext> {
    logger.debug(`Gathering execution context for ${order.asset}`);
    
    // TODO: Implement actual data gathering from market data services
    // This requires integration with:
    // - Market data service for volatility calculations
    // - Blockchain monitoring for gas price trends
    // - Risk analysis systems for liquidity assessment
    // - Historical performance data for success rates
    throw new Error('NotImplementedError: Execution context gathering not yet implemented. Requires integration with market data and monitoring services.');
    
    // Future implementation will:
    // 1. Query real-time market data for volatility index calculation
    // 2. Analyze order book depth to determine order size impact
    // 3. Monitor gas price trends across recent blocks
    // 4. Check mempool congestion from node APIs
    // 5. Aggregate recent transaction failures from monitoring
    // 6. Calculate historical success rates from trade database
    // 7. Assess token-specific liquidity from DEX aggregators
    
    // Example of future implementation:
    // const volatilityIndex = await this.marketDataService.getVolatilityIndex(order.asset);
    // const orderImpact = await this.liquidityService.calculateOrderImpact(order);
    // const gasMetrics = await this.gasMonitor.getRecentGasMetrics();
    // const mempoolData = await this.mempoolMonitor.getCongestionLevel();
    // const failureData = await this.executionMonitor.getRecentFailures(order.asset);
    // const successRate = await this.performanceDb.getHistoricalSuccessRate(order.asset);
    // const liquidity = await this.dexAggregator.getTokenLiquidity(order.asset);
  }
  
  /**
   * Apply execution mode parameters to an order
   * @param order Original order
   * @param mode Execution mode to apply
   * @param configOverrides Optional custom overrides
   * @returns Modified order with mode-specific parameters
   */
  public applyModeToOrder(
    order: OrderIntent,
    mode: ExecutionMode,
    configOverrides?: Record<string, any>
  ): OrderIntent {
    const modeParams = MODE_PARAMS[mode];
    const updatedOrder = { ...order };
    
    // Apply mode-specific parameters
    if (!updatedOrder.maxSlippageBps || updatedOrder.maxSlippageBps > modeParams.maxSlippageBps) {
      updatedOrder.maxSlippageBps = modeParams.maxSlippageBps;
    }
    
    // Map execution mode to order urgency
    switch (mode) {
      case ExecutionMode.SPEED:
        updatedOrder.urgency = 'high';
        break;
      case ExecutionMode.NORMAL:
        updatedOrder.urgency = 'medium';
        break;
      case ExecutionMode.SAFETY:
      case ExecutionMode.STEALTH:
        updatedOrder.urgency = 'low';
        break;
    }
    
    // Apply any custom overrides
    if (configOverrides) {
      if (configOverrides.maxSlippageBps) {
        updatedOrder.maxSlippageBps = configOverrides.maxSlippageBps;
      }
      
      if (configOverrides.urgency) {
        updatedOrder.urgency = configOverrides.urgency;
      }
      
      // Add any custom tags
      if (configOverrides.tags) {
        updatedOrder.tags = [...(updatedOrder.tags || []), ...configOverrides.tags];
      }
    }
    
    // Add mode tag for analytics
    updatedOrder.tags = [
      ...(updatedOrder.tags || []),
      `mode:${mode}`
    ];
    
    return updatedOrder;
  }
  
  /**
   * Record execution outcome for learning and telemetry
   * @param mode Execution mode used
   * @param order Order that was executed
   * @param success Whether execution was successful
   * @param slippageBps Actual slippage in basis points
   */
  public recordExecutionOutcome(
    mode: ExecutionMode,
    order: OrderIntent,
    success: boolean,
    slippageBps?: number
  ): void {
    const perf = this.modePerformance[mode];
    perf.totalExecuted++;
    
    if (success) {
      perf.successCount++;
      if (slippageBps !== undefined) {
        // Update average slippage
        perf.avgSlippageBps = (perf.avgSlippageBps * (perf.successCount - 1) + slippageBps) / perf.successCount;
      }
    } else {
      perf.failureCount++;
    }
    
    perf.lastUsed = Date.now();
    
    // Update the most recent switch telemetry with outcome if applicable
    if (this.modeSwitchHistory.length > 0) {
      const lastSwitch = this.modeSwitchHistory[this.modeSwitchHistory.length - 1];
      if (lastSwitch.newMode === mode && lastSwitch.asset === order.asset && 
          Date.now() - lastSwitch.timestamp < 60000) { // within last minute
        lastSwitch.outcome = success ? 'success' : 'failure';
        if (slippageBps !== undefined) {
          lastSwitch.metrics = { ...(lastSwitch.metrics || {}), slippageBps };
        }
      }
    }
    
    logger.info(
      `Execution outcome for ${order.asset} in ${mode} mode: ${success ? 'success' : 'failure'}` +
      (slippageBps !== undefined ? ` (slippage: ${slippageBps}bps)` : '')
    );
  }
  
  /**
   * Get performance metrics by execution mode
   */
  public getModePerformanceMetrics(): Record<ExecutionMode, any> {
    const metrics: Record<ExecutionMode, any> = {} as any;
    
    for (const [mode, perf] of Object.entries(this.modePerformance)) {
      metrics[mode as ExecutionMode] = {
        successRate: perf.totalExecuted > 0 ? perf.successCount / perf.totalExecuted : 0,
        totalExecuted: perf.totalExecuted,
        successCount: perf.successCount,
        failureCount: perf.failureCount,
        avgSlippageBps: perf.avgSlippageBps,
        lastUsed: perf.lastUsed
      };
    }
    
    return metrics;
  }
  
  /**
   * Generate mode-specific configuration overrides based on context
   */
  private generateConfigOverrides(
    order: OrderIntent,
    context: ExecutionModeContext,
    mode: ExecutionMode
  ): Record<string, any> {
    const overrides: Record<string, any> = {};
    
    // Try to get route trust data from execution memory
    try {
      const routes = this.executionMemory.getRoutesForTokenPair(order.asset);
      if (routes.size > 0) {
        // Find lowest and highest trust routes
        let lowestTrust = 1;
        let lowestTrustVenue = '';
        let highestTrust = 0;
        let highestTrustVenue = '';
        
        routes.forEach((trust, venue) => {
          if (trust < lowestTrust) {
            lowestTrust = trust;
            lowestTrustVenue = venue;
          }
          if (trust > highestTrust) {
            highestTrust = trust;
            highestTrustVenue = venue;
          }
        });
        
        // Apply route preferences based on mode
        if (mode === ExecutionMode.SAFETY) {
          // In safety mode, explicitly avoid low trust venues
          if (lowestTrust < 0.5) {
            overrides.avoidVenues = [lowestTrustVenue];
          }
          
          // Prefer high trust venues
          if (highestTrust > 0.8) {
            overrides.preferredVenues = [highestTrustVenue];
          }
        } else if (mode === ExecutionMode.SPEED) {
          // In speed mode, we still want to avoid the worst venues
          if (lowestTrust < 0.3) {
            overrides.avoidVenues = [lowestTrustVenue];
          }
        }
      }
    } catch (err) {
      logger.warn(`Failed to get route trust data: ${err}`);
    }
    
    // SAFETY mode customizations
    if (mode === ExecutionMode.SAFETY) {
      // If extremely volatile, reduce slippage tolerance further
      if (context.volatilityIndex > 0.85) {
        overrides.maxSlippageBps = 30; // 0.3%
      }
      
      // If we have specific token liquidity data
      if (context.specificTokenLiquidity !== undefined) {
        // Add minimum liquidity threshold
        overrides.minimumLiquidity = Math.max(
          this.thresholds.minimumLiquidityThreshold,
          context.specificTokenLiquidity * 0.5
        );
      }
    }
    
    // STEALTH mode customizations
    if (mode === ExecutionMode.STEALTH) {
      // Adjust fragment count based on order size
      if (context.orderSizeRelativeToPool > 0.25) {
        overrides.fragmentCount = 5; // More fragments for larger orders
      } else if (context.orderSizeRelativeToPool > 0.15) {
        overrides.fragmentCount = 3;
      }
      
      // Randomize tx timing more if high mempool congestion
      if (context.mempoolCongestion > 0.8) {
        overrides.randomizationFactor = 0.5; // 50% randomization
      }
    }
    
    // SPEED mode customizations
    if (mode === ExecutionMode.SPEED) {
      // If gas is extremely volatile, increase priority even more
      if (context.gasPriceVolatility > 0.4) {
        overrides.gasPriceMultiplier = 2.0; // Very aggressive gas price
      }
      
      // If transaction risk is high despite speed need
      if (context.transactionRisk && context.transactionRisk.riskScore > 0.6) {
        overrides.requireFastSimulation = true; // Still do a quick simulation
      }
    }
    
    return overrides;
  }
  
  /**
   * Log a mode switch for telemetry
   */
  private logModeSwitch(telemetry: ModeSwitchTelemetry): void {
    // Add to history (capped at 100 entries)
    this.modeSwitchHistory.push(telemetry);
    if (this.modeSwitchHistory.length > 100) {
      this.modeSwitchHistory.shift();
    }
    
    // Log the switch
    logger.info(
      `Execution mode switch: ${telemetry.previousMode} → ${telemetry.newMode} for ${telemetry.asset}: ${telemetry.reason}`
    );
  }
}

/**
 * Get singleton instance of ExecutionModeManager
 */
let executionModeManagerInstance: ExecutionModeManager | null = null;

export function getExecutionModeManager(
  router?: SmartOrderRouter,
  transactionGuard?: TransactionGuard,
  thresholds?: Partial<ModeSwitchingThresholds>
): ExecutionModeManager {
  if (!executionModeManagerInstance) {
    if (!router || !transactionGuard) {
      throw new Error('SmartOrderRouter and TransactionGuard are required to create ExecutionModeManager');
    }
    
    executionModeManagerInstance = new ExecutionModeManager(
      router,
      transactionGuard,
      thresholds
    );
  }
  
  return executionModeManagerInstance;
} 