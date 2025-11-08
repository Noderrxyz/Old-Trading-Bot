import { createLogger } from '../common/logger.js';
import {
  RiskTelemetryConfig,
  RiskSnapshot,
  DEFAULT_RISK_TELEMETRY_CONFIG
} from './types/risk_telemetry.types.js';

/**
 * Tracks and manages risk telemetry data
 */
export class RiskProfileTelemetry {
  private readonly logger = createLogger('RiskProfileTelemetry');
  
  // Current risk data
  private symbolRisk: Record<string, number> = {};
  private symbolExposure: Record<string, number> = {};
  
  // Snapshot timer
  private snapshotTimer?: NodeJS.Timeout;
  
  constructor(
    private readonly config: RiskTelemetryConfig = DEFAULT_RISK_TELEMETRY_CONFIG
  ) {
    if (!config.enabled) {
      this.logger.warn('Risk telemetry is disabled');
    } else {
      this.startSnapshotting();
    }
  }
  
  /**
   * Start periodic snapshotting
   */
  private startSnapshotting(): void {
    if (!this.config.enabled) return;
    
    // Clear any existing timer
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
    }
    
    // Start new snapshot interval
    this.snapshotTimer = setInterval(() => {
      this.takeSnapshot();
    }, this.config.snapshotIntervalSec * 1000);
    
    this.logger.info(
      `Started risk telemetry with ${this.config.snapshotIntervalSec}s snapshot interval`
    );
  }
  
  /**
   * Update risk data for a symbol
   * @param symbol Asset symbol
   * @param riskScore Risk score (0-1)
   * @param exposure Exposure amount
   */
  public updateRisk(symbol: string, riskScore: number, exposure: number): void {
    if (!this.config.enabled) return;
    
    try {
      // Update risk and exposure
      this.symbolRisk[symbol] = riskScore;
      this.symbolExposure[symbol] = exposure;
      
      this.logger.debug(
        `Updated risk for ${symbol}: score=${riskScore}, exposure=${exposure}`
      );
      
      // Check for critical risk
      if (riskScore >= this.config.riskScoreThresholds.critical) {
        this.logger.warn(
          `Critical risk detected for ${symbol}: score=${riskScore}, exposure=${exposure}`
        );
      }
    } catch (error) {
      this.logger.error(`Error updating risk: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get total system risk
   * @returns Total risk score
   */
  public getTotalRisk(): number {
    if (!this.config.enabled) return 0;
    
    try {
      // Calculate weighted average of risk scores
      let totalExposure = 0;
      let weightedRisk = 0;
      
      for (const [symbol, exposure] of Object.entries(this.symbolExposure)) {
        const riskScore = this.symbolRisk[symbol] || 0;
        weightedRisk += riskScore * exposure;
        totalExposure += exposure;
      }
      
      return totalExposure > 0 ? weightedRisk / totalExposure : 0;
    } catch (error) {
      this.logger.error(`Error calculating total risk: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }
  
  /**
   * Get current risk snapshot
   * @returns Risk snapshot
   */
  public getRiskSnapshot(): RiskSnapshot {
    return {
      timestamp: Date.now(),
      symbolRisk: { ...this.symbolRisk },
      symbolExposure: { ...this.symbolExposure },
      totalRisk: this.getTotalRisk()
    };
  }
  
  /**
   * Take and store a risk snapshot
   */
  private async takeSnapshot(): Promise<void> {
    if (!this.config.enabled) return;
    
    try {
      const snapshot = this.getRiskSnapshot();
      
      // Store snapshot in Redis if configured
      if (this.config.redisUrl) {
        await this.storeSnapshotInRedis(snapshot);
      }
      
      this.logger.debug(
        `Took risk snapshot: totalRisk=${snapshot.totalRisk}, ` +
        `symbols=${Object.keys(snapshot.symbolRisk).length}`
      );
    } catch (error) {
      this.logger.error(`Error taking snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Store snapshot in Redis
   * @param snapshot Risk snapshot
   */
  private async storeSnapshotInRedis(snapshot: RiskSnapshot): Promise<void> {
    if (!this.config.redisUrl) return;
    
    try {
      // TODO: Implement Redis storage
      // This would involve:
      // 1. Connecting to Redis
      // 2. Storing the snapshot with a timestamp key
      // 3. Setting TTL based on retention period
      // 4. Handling connection errors
      
      this.logger.debug('Would store snapshot in Redis');
    } catch (error) {
      this.logger.error(`Error storing snapshot in Redis: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Clean up resources
   */
  public destroy(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
    }
    this.symbolRisk = {};
    this.symbolExposure = {};
  }
} 