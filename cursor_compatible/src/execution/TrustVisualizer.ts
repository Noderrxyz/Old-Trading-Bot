/**
 * Trust Visualizer
 * 
 * Provides functions to analyze and visualize trust scores from the execution memory system.
 * This helps monitor route performance and identify patterns in execution outcomes.
 */

import { ExecutionMemory, getExecutionMemory } from './ExecutionMemory.js';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../common/logger.js';

const logger = createLogger('TrustVisualizer');

/**
 * Options for trust visualization
 */
export interface TrustVisualizationOptions {
  // Output directory for visualizations
  outputDir: string;
  
  // Number of top/bottom venues to include
  topCount: number;
  
  // Include only venues with at least this many executions
  minExecutionCount: number;
  
  // Token pairs to focus on (empty means all)
  tokenPairs?: string[];
  
  // Time range in milliseconds (0 means all time)
  timeRangeMs: number;
}

/**
 * Trust visualization functions
 */
export class TrustVisualizer {
  private executionMemory: ExecutionMemory;
  
  /**
   * Create a new trust visualizer
   */
  constructor() {
    this.executionMemory = getExecutionMemory();
  }
  
  /**
   * Generate a visualization of trust scores
   * @param options Visualization options
   */
  public async generateVisualization(options: TrustVisualizationOptions): Promise<void> {
    // Create output directory if it doesn't exist
    if (!fs.existsSync(options.outputDir)) {
      fs.mkdirSync(options.outputDir, { recursive: true });
    }
    
    // Generate top venues report
    await this.generateTopVenuesReport(options);
    
    // Generate token pair performance report
    await this.generateTokenPairReport(options);
    
    // Generate slippage vs trust correlation
    await this.generateSlippageCorrelation(options);
    
    logger.info(`Visualizations generated in ${options.outputDir}`);
  }
  
  /**
   * Generate top/bottom venues report
   * @param options Visualization options
   */
  private async generateTopVenuesReport(options: TrustVisualizationOptions): Promise<void> {
    const metrics = this.executionMemory.getPerformanceMetrics();
    
    // Define the type for venue metrics
    interface VenueMetric {
      successCount: number;
      failureCount: number;
      avgSlippageBps: number;
      avgLatencyMs: number;
      trustScore: number;
    }
    
    const venueMetrics = metrics.venueMetrics as Record<string, VenueMetric>;
    
    // Filter venues by execution count
    const filteredVenues = Object.entries(venueMetrics)
      .filter(([_, data]) => 
        (data.successCount + data.failureCount) >= options.minExecutionCount);
    
    // Sort by trust score
    const sortedVenues = filteredVenues.sort((a, b) => b[1].trustScore - a[1].trustScore);
    
    // Get top and bottom venues
    const topVenues = sortedVenues.slice(0, options.topCount);
    const bottomVenues = sortedVenues.slice(-options.topCount).reverse();
    
    // Format report
    let report = '# Top and Bottom Venue Performance Report\n\n';
    report += `Generated at: ${new Date().toISOString()}\n\n`;
    
    // Top venues table
    report += '## Top Performing Venues\n\n';
    report += '| Venue | Trust Score | Success Rate | Executions | Avg Slippage (bps) |\n';
    report += '|-------|-------------|--------------|------------|--------------------|\n';
    
    topVenues.forEach(([venue, data]) => {
      const successRate = data.successCount / (data.successCount + data.failureCount);
      report += `| ${venue} | ${data.trustScore.toFixed(2)} | ${(successRate * 100).toFixed(1)}% | ${data.successCount + data.failureCount} | ${data.avgSlippageBps.toFixed(1)} |\n`;
    });
    
    // Bottom venues table
    report += '\n## Bottom Performing Venues\n\n';
    report += '| Venue | Trust Score | Success Rate | Executions | Avg Slippage (bps) |\n';
    report += '|-------|-------------|--------------|------------|--------------------|\n';
    
    bottomVenues.forEach(([venue, data]) => {
      const successRate = data.successCount / (data.successCount + data.failureCount);
      report += `| ${venue} | ${data.trustScore.toFixed(2)} | ${(successRate * 100).toFixed(1)}% | ${data.successCount + data.failureCount} | ${data.avgSlippageBps.toFixed(1)} |\n`;
    });
    
    // Write report to file
    fs.writeFileSync(
      path.join(options.outputDir, 'venue_performance.md'),
      report,
      'utf8'
    );
    
    logger.info(`Generated venue performance report with ${topVenues.length} top and ${bottomVenues.length} bottom venues`);
  }
  
  /**
   * Generate token pair performance report
   * @param options Visualization options
   */
  private async generateTokenPairReport(options: TrustVisualizationOptions): Promise<void> {
    const metrics = this.executionMemory.getPerformanceMetrics();
    
    // Define the type for token pair metrics
    interface TokenPairMetric {
      successCount: number;
      failureCount: number;
      avgSlippageBps: number;
      bestVenue: string;
      bestVenueScore: number;
    }
    
    const tokenPairMetrics = metrics.tokenPairMetrics as Record<string, TokenPairMetric>;
    
    // Filter token pairs if specified
    let filteredPairs = Object.entries(tokenPairMetrics);
    if (options.tokenPairs && options.tokenPairs.length > 0) {
      filteredPairs = filteredPairs.filter(([pair, _]) => 
        options.tokenPairs!.includes(pair));
    }
    
    // Sort by success rate
    const sortedPairs = filteredPairs.sort((a, b) => {
      const aSuccessRate = a[1].successCount / (a[1].successCount + a[1].failureCount);
      const bSuccessRate = b[1].successCount / (b[1].successCount + b[1].failureCount);
      return bSuccessRate - aSuccessRate;
    });
    
    // Format report
    let report = '# Token Pair Performance Report\n\n';
    report += `Generated at: ${new Date().toISOString()}\n\n`;
    
    // Token pairs table
    report += '| Token Pair | Success Rate | Executions | Avg Slippage (bps) | Best Venue | Best Venue Score |\n';
    report += '|------------|--------------|------------|--------------------|-----------|-----------------|\n';
    
    sortedPairs.forEach(([pair, data]) => {
      const successRate = data.successCount / (data.successCount + data.failureCount);
      report += `| ${pair} | ${(successRate * 100).toFixed(1)}% | ${data.successCount + data.failureCount} | ${data.avgSlippageBps.toFixed(1)} | ${data.bestVenue} | ${data.bestVenueScore.toFixed(2)} |\n`;
    });
    
    // Write report to file
    fs.writeFileSync(
      path.join(options.outputDir, 'token_pair_performance.md'),
      report,
      'utf8'
    );
    
    logger.info(`Generated token pair report with ${sortedPairs.length} pairs`);
  }
  
  /**
   * Generate slippage vs trust correlation report
   * @param options Visualization options
   */
  private async generateSlippageCorrelation(options: TrustVisualizationOptions): Promise<void> {
    const metrics = this.executionMemory.getPerformanceMetrics();
    
    // Define the type for venue metrics
    interface VenueMetric {
      successCount: number;
      failureCount: number;
      avgSlippageBps: number;
      avgLatencyMs: number;
      trustScore: number;
    }
    
    const venueMetrics = metrics.venueMetrics as Record<string, VenueMetric>;
    
    // Create data points for plot
    const dataPoints = Object.entries(venueMetrics)
      .filter(([_, data]) => 
        (data.successCount + data.failureCount) >= options.minExecutionCount)
      .map(([venue, data]) => ({
        venue,
        trustScore: data.trustScore,
        avgSlippageBps: data.avgSlippageBps,
        successRate: data.successCount / (data.successCount + data.failureCount),
        executionCount: data.successCount + data.failureCount
      }));
    
    // Format report
    let report = '# Slippage vs. Trust Score Correlation\n\n';
    report += `Generated at: ${new Date().toISOString()}\n\n`;
    
    report += '## Data Points\n\n';
    report += 'The following data shows the relationship between trust scores and slippage:\n\n';
    report += '| Venue | Trust Score | Avg Slippage (bps) | Success Rate | Executions |\n';
    report += '|-------|-------------|--------------------|--------------|-----------|\n';
    
    dataPoints.sort((a, b) => b.trustScore - a.trustScore);
    
    dataPoints.forEach(point => {
      report += `| ${point.venue} | ${point.trustScore.toFixed(2)} | ${point.avgSlippageBps.toFixed(1)} | ${(point.successRate * 100).toFixed(1)}% | ${point.executionCount} |\n`;
    });
    
    // Add correlation analysis
    const correlation = this.calculateCorrelation(
      dataPoints.map(p => p.trustScore),
      dataPoints.map(p => p.avgSlippageBps)
    );
    
    report += '\n## Correlation Analysis\n\n';
    report += `Correlation coefficient between trust score and slippage: ${correlation.toFixed(3)}\n`;
    report += '\nInterpretation:\n';
    report += '- Values close to -1 indicate strong negative correlation (higher trust = lower slippage)\n';
    report += '- Values close to 0 indicate no correlation\n';
    report += '- Values close to 1 indicate strong positive correlation (higher trust = higher slippage)\n';
    
    // Write report to file
    fs.writeFileSync(
      path.join(options.outputDir, 'slippage_correlation.md'),
      report,
      'utf8'
    );
    
    logger.info(`Generated slippage correlation report with ${dataPoints.length} data points`);
  }
  
  /**
   * Calculate Pearson correlation coefficient between two arrays
   * @param x First array
   * @param y Second array
   * @returns Correlation coefficient (-1 to 1)
   */
  private calculateCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length) {
      throw new Error('Arrays must have the same length');
    }
    
    const n = x.length;
    
    // Calculate means
    const xMean = x.reduce((sum, val) => sum + val, 0) / n;
    const yMean = y.reduce((sum, val) => sum + val, 0) / n;
    
    // Calculate variance and covariance
    let ssxx = 0;
    let ssyy = 0;
    let ssxy = 0;
    
    for (let i = 0; i < n; i++) {
      const xDiff = x[i] - xMean;
      const yDiff = y[i] - yMean;
      ssxx += xDiff * xDiff;
      ssyy += yDiff * yDiff;
      ssxy += xDiff * yDiff;
    }
    
    // Calculate correlation
    const correlation = ssxy / (Math.sqrt(ssxx) * Math.sqrt(ssyy));
    
    return correlation;
  }
}

/**
 * Create a trust visualizer instance
 * @returns Trust visualizer
 */
export function createTrustVisualizer(): TrustVisualizer {
  return new TrustVisualizer();
} 