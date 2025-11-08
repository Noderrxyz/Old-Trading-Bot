import { logger } from '../../utils/logger';
import { TelemetryBus } from '../../telemetry/TelemetryBus';
import { Asset } from '../types/Asset';
import { ChainId } from '../types/ChainId';
import { Bridge } from '../types/Bridge';
import { Path } from '../types/Path';
import { PathScore } from '../types/PathScore';
import { BridgeRegistry } from '../bridge/BridgeRegistry';
import { PathSimulationResult } from '../types/PathSimulationResult';
import { BridgeSelector, BridgeSelectionCriteria, BridgeMetrics } from '../bridge/BridgeSelector';
import { DefaultBridgeScoringStrategy } from '../bridge/DefaultBridgeScoringStrategy';
import { BridgeMetricsCollector } from '../bridge/BridgeMetricsCollector';

/**
 * Configuration for the path finder
 */
export interface PathFinderConfig {
  /**
   * Maximum number of hops allowed in a path
   */
  maxHops: number;
  
  /**
   * Maximum time to spend finding a path (in ms)
   */
  maxSearchTimeMs: number;
  
  /**
   * Minimum liquidity required for a path (in USD)
   */
  minLiquidityUsd: number;
  
  /**
   * Maximum price impact allowed (in percentage)
   */
  maxPriceImpact: number;
  
  /**
   * Whether to enable parallel path finding
   */
  enableParallelSearch: boolean;
  
  /**
   * Number of parallel workers for path finding
   */
  parallelWorkers: number;
  
  /**
   * Scoring weights for different factors
   */
  scoringWeights: {
    /**
     * Weight for gas cost
     */
    gasCost: number;
    
    /**
     * Weight for bridge fees
     */
    bridgeFees: number;
    
    /**
     * Weight for price impact
     */
    priceImpact: number;
    
    /**
     * Weight for path length
     */
    pathLength: number;
    
    /**
     * Weight for liquidity
     */
    liquidity: number;
  };
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: PathFinderConfig = {
  maxHops: 3,
  maxSearchTimeMs: 5000,
  minLiquidityUsd: 10000,
  maxPriceImpact: 5,
  enableParallelSearch: true,
  parallelWorkers: 4,
  scoringWeights: {
    gasCost: 0.3,
    bridgeFees: 0.3,
    priceImpact: 0.2,
    pathLength: 0.1,
    liquidity: 0.1
  }
};

/**
 * PathFinder - Finds optimal paths for cross-chain transactions
 * 
 * This class implements advanced path finding algorithms to discover
 * the most efficient routes for cross-chain transactions, considering
 * factors like gas costs, bridge fees, liquidity, and price impact.
 */
export class PathFinder {
  private static instance: PathFinder | null = null;
  private config: PathFinderConfig;
  private telemetryBus: TelemetryBus;
  private bridgeRegistry: BridgeRegistry;
  private pathCache: Map<string, {
    path: Path;
    score: PathScore;
    timestamp: number;
  }> = new Map();
  private bridgeSelector: BridgeSelector;
  private bridgeMetricsCollector: BridgeMetricsCollector;
  
  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor(config: Partial<PathFinderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.validateConfig();
    
    this.telemetryBus = TelemetryBus.getInstance();
    this.bridgeRegistry = BridgeRegistry.getInstance();
    this.bridgeSelector = new BridgeSelector(new DefaultBridgeScoringStrategy());
    this.bridgeMetricsCollector = BridgeMetricsCollector.getInstance();
    
    logger.info('PathFinder initialized');
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<PathFinderConfig>): PathFinder {
    if (!PathFinder.instance) {
      PathFinder.instance = new PathFinder(config);
    } else if (config) {
      PathFinder.instance.updateConfig(config);
    }
    return PathFinder.instance;
  }
  
  /**
   * Find the optimal path for a cross-chain transaction
   * 
   * @param fromAsset Source asset
   * @param toAsset Target asset
   * @param amount Amount to transfer
   * @returns Best path and its score
   */
  public async findOptimalPath(
    fromAsset: Asset,
    toAsset: Asset,
    amount: string
  ): Promise<{ path: Path; score: PathScore } | null> {
    const startTime = Date.now();
    
    try {
      // Check cache first
      const cacheKey = this.generateCacheKey(fromAsset, toAsset, amount);
      const cached = this.pathCache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < 60000) { // 1 minute cache
        logger.debug('Using cached path');
        return { path: cached.path, score: cached.score };
      }
      
      // Initialize path finding
      const paths: Array<{ path: Path; score: PathScore }> = [];
      
      // Start parallel path finding if enabled
      if (this.config.enableParallelSearch) {
        const workers = Array.from({ length: this.config.parallelWorkers }, () =>
          this.findPathsParallel(fromAsset, toAsset, amount)
        );
        
        const results = await Promise.all(workers);
        paths.push(...results.flat());
      } else {
        // Single-threaded path finding
        const foundPaths = await this.findPaths(fromAsset, toAsset, amount);
        paths.push(...foundPaths);
      }
      
      // Score and sort paths
      const scoredPaths = paths.map(({ path, score }) => ({
        path,
        score: this.calculatePathScore(path, score)
      }));
      
      scoredPaths.sort((a, b) => b.score.total - a.score.total);
      
      // Get best path
      const bestPath = scoredPaths[0];
      
      if (!bestPath) {
        logger.warn('No valid paths found');
        return null;
      }
      
      // Cache the result
      this.pathCache.set(cacheKey, {
        path: bestPath.path,
        score: bestPath.score,
        timestamp: Date.now()
      });
      
      // Emit telemetry
      this.telemetryBus.emit('path_found', {
        fromAsset: fromAsset.symbol,
        toAsset: toAsset.symbol,
        amount,
        pathLength: bestPath.path.hops.length,
        score: bestPath.score.total,
        executionTimeMs: Date.now() - startTime
      });
      
      return bestPath;
    } catch (error) {
      logger.error('Error finding optimal path:', error);
      
      // Emit telemetry for error
      this.telemetryBus.emit('path_finding_error', {
        fromAsset: fromAsset.symbol,
        toAsset: toAsset.symbol,
        amount,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs: Date.now() - startTime
      });
      
      return null;
    }
  }
  
  /**
   * Find paths in parallel
   */
  private async findPathsParallel(
    fromAsset: Asset,
    toAsset: Asset,
    amount: string
  ): Promise<Array<{ path: Path; score: PathScore }>> {
    // This would be implemented with actual parallel path finding logic
    // For now, return an empty array
    return [];
  }
  
  /**
   * Find all possible paths
   */
  private async findPaths(
    fromAsset: Asset,
    toAsset: Asset,
    amount: string
  ): Promise<Array<{ path: Path; score: PathScore }>> {
    const paths: Array<{ path: Path; score: PathScore }> = [];
    const visited = new Set<string>();
    
    // Start DFS from source asset
    await this.dfs(
      fromAsset,
      toAsset,
      amount,
      [],
      visited,
      paths
    );
    
    return paths;
  }
  
  /**
   * Depth-first search for finding paths
   */
  private async dfs(
    current: Asset,
    target: Asset,
    amount: string,
    currentPath: Path['hops'],
    visited: Set<string>,
    paths: Array<{ path: Path; score: PathScore }>
  ): Promise<void> {
    // Check if we've reached the target
    if (current.chainId === target.chainId && current.address === target.address) {
      const path: Path = {
        hops: [...currentPath],
        fromAsset: current,
        toAsset: target,
        amount
      };
      const score = await this.estimatePathScore(path);
      paths.push({ path, score });
      return;
    }
    // Check if we've exceeded max hops
    if (currentPath.length >= this.config.maxHops) {
      return;
    }
    // Get available bridges from current chain
    const bridges = this.bridgeRegistry.getBridgesForChain(current.chainId);
    if (!bridges.length) return;
    // Fetch real-time metrics for all candidate bridges
    const metricsMap = new Map<string, BridgeMetrics>();
    await Promise.all(
      bridges.map(async (bridge) => {
        const metrics = await this.bridgeMetricsCollector.getMetrics(bridge);
        metricsMap.set(bridge.id, metrics);
      })
    );
    // Prepare selection criteria
    const criteria: BridgeSelectionCriteria = {
      sourceChain: current.chainId,
      destinationChain: target.chainId,
      amountUsd: Number(amount),
    };
    // Select the best bridge for this hop
    const selection = this.bridgeSelector.selectBestBridge(bridges, criteria, metricsMap);
    if (!selection) return;
    const bridge = selection.bridge;
    const bridgeKey = `${current.chainId}-${bridge.id}`;
    if (visited.has(bridgeKey)) {
      return;
    }
    visited.add(bridgeKey);
    currentPath.push({
      fromChain: current.chainId,
      toChain: bridge.destinationChain,
      bridge: bridge.id,
      asset: current
    });
    // Telemetry and logging for bridge selection
    logger.info('Bridge selected for hop', {
      fromChain: current.chainId,
      toChain: bridge.destinationChain,
      bridgeId: bridge.id,
      score: selection.score,
      rationale: selection.rationale
    });
    this.telemetryBus.emit('bridge_selected', {
      fromChain: current.chainId,
      toChain: bridge.destinationChain,
      bridgeId: bridge.id,
      score: selection.score,
      rationale: selection.rationale
    });
    // Recursively explore
    await this.dfs(
      { ...current, chainId: bridge.destinationChain },
      target,
      amount,
      currentPath,
      visited,
      paths
    );
    // Backtrack
    visited.delete(bridgeKey);
    currentPath.pop();
  }
  
  /**
   * Calculate final path score
   */
  private calculatePathScore(path: Path, baseScore: PathScore): PathScore {
    const weights = this.config.scoringWeights;
    
    // Calculate weighted score
    const total = (
      baseScore.gasCost * weights.gasCost +
      baseScore.bridgeFees * weights.bridgeFees +
      baseScore.priceImpact * weights.priceImpact +
      baseScore.pathLength * weights.pathLength +
      baseScore.liquidity * weights.liquidity
    );
    
    return {
      ...baseScore,
      total
    };
  }
  
  /**
   * Estimate score for a path
   * Incorporates real-time gas and bridge fee data (mocked for now, extensible for live data)
   */
  private async estimatePathScore(path: Path): Promise<PathScore> {
    try {
      // --- Dynamic Fee Estimation (mocked, replace with live data integration) ---
      let totalGasCost = 0;
      let totalBridgeFees = 0;
      let minLiquidity = 1;
      let maxPriceImpact = 0;
      let valid = true;

      for (const hop of path.hops) {
        // Mock: fetch gas price and bridge fee (replace with real data sources)
        const gasCost = await this.getGasCost(hop.fromChain, hop.toChain);
        const bridgeFee = await this.getBridgeFee(hop.bridge, path.amount);
        const liquidity = await this.getBridgeLiquidity(hop.bridge);
        const priceImpact = await this.getPriceImpact(hop.bridge, path.amount);

        if (liquidity < this.config.minLiquidityUsd) {
          valid = false;
        }
        if (priceImpact > this.config.maxPriceImpact) {
          valid = false;
        }

        totalGasCost += gasCost;
        totalBridgeFees += bridgeFee;
        minLiquidity = Math.min(minLiquidity, liquidity);
        maxPriceImpact = Math.max(maxPriceImpact, priceImpact);
      }

      // Normalize scores (0 = worst, 1 = best)
      // For demo: assume maxGasCost = 100, maxBridgeFees = 100, maxPriceImpact = 10, maxLiquidity = 1_000_000
      const maxGasCost = 100;
      const maxBridgeFees = 100;
      const maxLiquidity = 1_000_000;
      const maxPriceImpactAllowed = this.config.maxPriceImpact;

      const gasCostScore = 1 - Math.min(totalGasCost / maxGasCost, 1);
      const bridgeFeesScore = 1 - Math.min(totalBridgeFees / maxBridgeFees, 1);
      const priceImpactScore = 1 - Math.min(maxPriceImpact / maxPriceImpactAllowed, 1);
      const pathLengthScore = 1 - (path.hops.length / this.config.maxHops);
      const liquidityScore = Math.min(minLiquidity / maxLiquidity, 1);

      // Observability
      logger.info('Path fee estimation', {
        path: path.hops.map(h => h.bridge),
        totalGasCost,
        totalBridgeFees,
        minLiquidity,
        maxPriceImpact,
        gasCostScore,
        bridgeFeesScore,
        priceImpactScore,
        pathLengthScore,
        liquidityScore,
        valid
      });
      this.telemetryBus.emit('path_fee_estimation', {
        path: path.hops.map(h => h.bridge),
        totalGasCost,
        totalBridgeFees,
        minLiquidity,
        maxPriceImpact,
        gasCostScore,
        bridgeFeesScore,
        priceImpactScore,
        pathLengthScore,
        liquidityScore,
        valid
      });

      if (!valid) {
        // Penalize invalid paths
        return {
          gasCost: 0,
          bridgeFees: 0,
          priceImpact: 0,
          pathLength: 0,
          liquidity: 0,
          total: 0
        };
      }

      return {
        gasCost: gasCostScore,
        bridgeFees: bridgeFeesScore,
        priceImpact: priceImpactScore,
        pathLength: pathLengthScore,
        liquidity: liquidityScore,
        total: 0 // will be set by calculatePathScore
      };
    } catch (error) {
      logger.error('Error in estimatePathScore', error);
      this.telemetryBus.emit('path_fee_estimation_error', {
        error: error instanceof Error ? error.message : String(error),
        path: path.hops.map(h => h.bridge)
      });
      // Return worst possible score
      return {
        gasCost: 0,
        bridgeFees: 0,
        priceImpact: 0,
        pathLength: 0,
        liquidity: 0,
        total: 0
      };
    }
  }

  // --- Extension points for live data integration ---
  private async getGasCost(fromChain: ChainId, toChain: ChainId): Promise<number> {
    // TODO: Integrate with real gas price APIs per chain
    return 10; // mock value
  }
  private async getBridgeFee(bridgeId: string, amount: string): Promise<number> {
    // TODO: Integrate with real bridge fee APIs
    return 5; // mock value
  }
  private async getBridgeLiquidity(bridgeId: string): Promise<number> {
    // TODO: Integrate with real bridge liquidity APIs
    return 100_000; // mock value
  }
  private async getPriceImpact(bridgeId: string, amount: string): Promise<number> {
    // TODO: Integrate with real price impact estimation
    return 1; // mock value (1%)
  }
  
  /**
   * Generate cache key for a path request
   */
  private generateCacheKey(
    fromAsset: Asset,
    toAsset: Asset,
    amount: string
  ): string {
    return `${fromAsset.chainId}-${fromAsset.address}-${toAsset.chainId}-${toAsset.address}-${amount}`;
  }
  
  /**
   * Update configuration
   */
  private updateConfig(config: Partial<PathFinderConfig>): void {
    this.config = { ...this.config, ...config };
    this.validateConfig();
    
    logger.info('PathFinder configuration updated');
  }
  
  /**
   * Validate configuration
   */
  private validateConfig(): void {
    const weights = this.config.scoringWeights;
    const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);
    
    if (Math.abs(weightSum - 1.0) > 0.001) {
      logger.warn(`Scoring weights do not sum to 1.0: ${weightSum}`);
      
      // Normalize weights
      const normalizationFactor = 1.0 / weightSum;
      Object.keys(weights).forEach(key => {
        weights[key as keyof typeof weights] *= normalizationFactor;
      });
      
      logger.info('Scoring weights normalized to sum to 1.0');
    }
  }

  /**
   * Simulate the outcome of a cross-chain path
   * Returns expected output, slippage, fees, and risk factors
   */
  public async simulatePath(path: Path, inputAmount: string): Promise<PathSimulationResult> {
    try {
      let currentAmount = parseFloat(inputAmount);
      let totalFees = 0;
      let totalSlippage = 0;
      let failureProbability = 0;
      const warnings: string[] = [];
      const hopDetails: PathSimulationResult['hopDetails'] = [];

      for (const hop of path.hops) {
        // Fetch dynamic data (mocked for now)
        const gasCost = await this.getGasCost(hop.fromChain, hop.toChain);
        const bridgeFee = await this.getBridgeFee(hop.bridge, currentAmount.toString());
        const liquidity = await this.getBridgeLiquidity(hop.bridge);
        const priceImpact = await this.getPriceImpact(hop.bridge, currentAmount.toString());

        // Calculate slippage and output
        const hopSlippage = priceImpact / 100;
        const hopFee = gasCost + bridgeFee;
        const output = currentAmount * (1 - hopSlippage) - hopFee;
        if (output < 0) {
          warnings.push(`Output negative after fees/slippage on bridge ${hop.bridge}`);
        }
        if (liquidity < this.config.minLiquidityUsd) {
          warnings.push(`Low liquidity on bridge ${hop.bridge}`);
          failureProbability += 0.2;
        }
        if (priceImpact > this.config.maxPriceImpact) {
          warnings.push(`High price impact on bridge ${hop.bridge}`);
          failureProbability += 0.2;
        }
        if (hopFee > currentAmount * 0.5) {
          warnings.push(`Excessive fees on bridge ${hop.bridge}`);
          failureProbability += 0.2;
        }
        hopDetails.push({
          bridge: hop.bridge,
          fromChain: hop.fromChain.toString(),
          toChain: hop.toChain.toString(),
          input: currentAmount.toString(),
          output: output.toString(),
          fee: hopFee.toString(),
          slippage: hopSlippage * 100,
          risk: warnings.slice(-3) // last 3 warnings for this hop
        });
        totalFees += hopFee;
        totalSlippage += hopSlippage * 100;
        currentAmount = output;
      }
      // Clamp failure probability
      failureProbability = Math.min(failureProbability, 1);
      // Observability
      logger.info('Path simulation', {
        path: path.hops.map(h => h.bridge),
        inputAmount,
        expectedOutputAmount: currentAmount.toString(),
        totalFees: totalFees.toString(),
        slippage: totalSlippage,
        failureProbability,
        warnings,
        hopDetails
      });
      this.telemetryBus.emit('path_simulation', {
        path: path.hops.map(h => h.bridge),
        inputAmount,
        expectedOutputAmount: currentAmount.toString(),
        totalFees: totalFees.toString(),
        slippage: totalSlippage,
        failureProbability,
        warnings,
        hopDetails
      });
      return {
        path,
        inputAmount,
        expectedOutputAmount: currentAmount.toString(),
        totalFees: totalFees.toString(),
        slippage: totalSlippage,
        failureProbability,
        warnings,
        hopDetails
      };
    } catch (error) {
      logger.error('Error in simulatePath', error);
      this.telemetryBus.emit('path_simulation_error', {
        error: error instanceof Error ? error.message : String(error),
        path: path.hops.map(h => h.bridge)
      });
      return {
        path,
        inputAmount,
        expectedOutputAmount: '0',
        totalFees: '0',
        slippage: 0,
        failureProbability: 1,
        warnings: ['Simulation failed: ' + (error instanceof Error ? error.message : String(error))],
        hopDetails: []
      };
    }
  }
} 