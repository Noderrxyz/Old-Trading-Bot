/**
 * Execution Router
 * 
 * Routes and optimizes transaction execution across multiple venues.
 */

import { createLogger } from '../common/logger.js';
import { RouteCandidate, RouteScore } from './types/route_scorer.types.js';
import { TransactionBenchmark, GasParameters } from './types/benchmark.types.js';
import { RouteScorer } from './route_scorer.js';
import { RouteOptimizer } from './route_optimizer.js';
import { LatencyBenchmarkEngine } from './latency_benchmark_engine.js';
import { GasOptimizer } from './gas_optimizer.js';

const logger = createLogger('ExecutionRouter');

/**
 * Router for executing transactions across multiple venues
 */
export class ExecutionRouter {
  private readonly routeScorer: RouteScorer;
  private readonly routeOptimizer: RouteOptimizer;
  private readonly benchmarkEngine: LatencyBenchmarkEngine;
  private readonly gasOptimizer: GasOptimizer;

  /**
   * Create a new execution router
   * @param routeScorer Route scorer instance
   * @param benchmarkEngine Latency benchmark engine
   * @param gasOptimizer Gas optimizer instance
   */
  constructor(
    routeScorer: RouteScorer,
    benchmarkEngine: LatencyBenchmarkEngine,
    gasOptimizer: GasOptimizer
  ) {
    this.routeScorer = routeScorer;
    this.routeOptimizer = new RouteOptimizer(routeScorer);
    this.benchmarkEngine = benchmarkEngine;
    this.gasOptimizer = gasOptimizer;
    logger.info('Execution Router initialized');
  }

  /**
   * Execute a transaction through the best available route
   * @param routes Available route candidates
   * @param baseGasLimit Base gas limit
   * @param baseGasPrice Base gas price
   * @returns Transaction hash if successful
   */
  public async executeTransaction(
    routes: RouteCandidate[],
    baseGasLimit: number,
    baseGasPrice: number
  ): Promise<string | null> {
    // Find best route
    const bestRoute = this.routeOptimizer.findBestRoute(routes);
    if (!bestRoute) {
      logger.error('No valid routes found for execution');
      return null;
    }

    // Get optimized gas parameters
    const gasParams = this.gasOptimizer.getOptimizedGasParameters(
      bestRoute.route.exchange,
      bestRoute.route.chain,
      baseGasLimit,
      baseGasPrice
    );

    try {
      // Record transaction start
      const txHash = await this.sendTransaction(bestRoute.route, gasParams);
      
      // Record benchmark start
      this.recordTransactionStart(txHash, bestRoute.route);
      
      return txHash;
    } catch (error) {
      logger.error('Transaction execution failed:', error);
      return null;
    }
  }

  /**
   * Record transaction confirmation
   * @param txHash Transaction hash
   * @param success Whether the transaction was successful
   * @param gasUsed Gas used by the transaction
   */
  public recordTransactionConfirmation(
    txHash: string,
    success: boolean,
    gasUsed: number
  ): void {
    const benchmark = this.benchmarkEngine.getRecentBenchmarks('', '')
      .find(b => b.txHash === txHash);
    
    if (benchmark) {
      // Update benchmark with confirmation data
      const updatedBenchmark: TransactionBenchmark = {
        ...benchmark,
        success,
        gas: {
          ...benchmark.gas,
          used: gasUsed
        },
        timestamps: {
          ...benchmark.timestamps,
          confirmed: Date.now()
        }
      };
      
      this.benchmarkEngine.recordBenchmark(updatedBenchmark);
    }
  }

  /**
   * Send transaction with optimized gas parameters
   * @param route Execution route
   * @param gasParams Optimized gas parameters
   * @returns Transaction hash
   */
  private async sendTransaction(
    route: RouteCandidate,
    gasParams: GasParameters
  ): Promise<string> {
    // TODO: Implement actual transaction sending
    // This is a placeholder that would be replaced with actual transaction sending logic
    logger.info('Sending transaction:', {
      route: route.exchange,
      chain: route.chain,
      gasParams
    });
    
    return '0x' + Math.random().toString(16).substring(2, 66);
  }

  /**
   * Record transaction start
   * @param txHash Transaction hash
   * @param route Execution route
   */
  private recordTransactionStart(txHash: string, route: RouteCandidate): void {
    const benchmark: TransactionBenchmark = {
      txHash,
      venue: route.exchange,
      chain: route.chain,
      timestamps: {
        sent: Date.now(),
        confirmed: 0
      },
      gas: {
        supplied: route.estimatedGasFeeUsd,
        used: 0,
        price: route.estimatedGasFeeUsd
      },
      success: false
    };
    
    this.benchmarkEngine.recordBenchmark(benchmark);
  }
} 