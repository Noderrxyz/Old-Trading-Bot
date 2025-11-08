import { Bridge } from '../types/Bridge';
import { ChainId } from '../types/ChainId';

/**
 * Criteria for bridge selection
 */
export interface BridgeSelectionCriteria {
  sourceChain: ChainId;
  destinationChain: ChainId;
  amountUsd: number;
  userPreferences?: Record<string, unknown>;
  // Add more fields as needed (e.g., maxFee, minLiquidity, riskTolerance)
}

/**
 * Result of a bridge selection
 */
export interface BridgeSelectionResult {
  bridge: Bridge;
  score: number;
  rationale: string;
}

/**
 * Interface for pluggable bridge scoring algorithms
 */
export interface BridgeScoringStrategy {
  score(bridge: Bridge, criteria: BridgeSelectionCriteria, metrics: BridgeMetrics): number;
}

/**
 * Real-time bridge metrics (to be extended as needed)
 */
export interface BridgeMetrics {
  liquidityUsd: number;
  feeUsd: number;
  estimatedTimeSeconds: number;
  reliabilityScore: number; // 0-1
  securityScore: number; // 0-1
  // Add more as needed
}

/**
 * BridgeSelector - Selects the optimal bridge for a cross-chain transaction
 */
export class BridgeSelector {
  private scoringStrategy: BridgeScoringStrategy;

  constructor(scoringStrategy: BridgeScoringStrategy) {
    this.scoringStrategy = scoringStrategy;
  }

  /**
   * Select the best bridge from a list of candidates
   */
  public selectBestBridge(
    bridges: Bridge[],
    criteria: BridgeSelectionCriteria,
    metricsMap: Map<string, BridgeMetrics>
  ): BridgeSelectionResult | null {
    let best: BridgeSelectionResult | null = null;
    for (const bridge of bridges) {
      const metrics = metricsMap.get(bridge.id);
      if (!metrics) continue;
      const score = this.scoringStrategy.score(bridge, criteria, metrics);
      const rationale = `Score: ${score}, Liquidity: ${metrics.liquidityUsd}, Fee: ${metrics.feeUsd}, Reliability: ${metrics.reliabilityScore}, Security: ${metrics.securityScore}`;
      if (!best || score > best.score) {
        best = { bridge, score, rationale };
      }
    }
    return best;
  }
} 