/**
 * Risk level
 */
export enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

/**
 * Risk level color mapping
 */
export const RISK_LEVEL_COLORS: Record<RiskLevel, string> = {
  [RiskLevel.LOW]: '#4CAF50',     // Green
  [RiskLevel.MEDIUM]: '#FFC107',  // Yellow
  [RiskLevel.HIGH]: '#FF9800',    // Orange
  [RiskLevel.CRITICAL]: '#F44336' // Red
};

/**
 * Heatmap visualization configuration
 */
export interface RiskHeatmapConfig {
  /** Whether visualization is enabled */
  enabled: boolean;
  
  /** Update interval in seconds */
  updateIntervalSec: number;
  
  /** Output directory for heatmap images */
  outputDir: string;
  
  /** Image width in pixels */
  imageWidth: number;
  
  /** Image height in pixels */
  imageHeight: number;
  
  /** Whether to enable web server */
  enableWebServer: boolean;
  
  /** Web server port */
  webServerPort?: number;
}

/**
 * Default heatmap configuration
 */
export const DEFAULT_RISK_HEATMAP_CONFIG: RiskHeatmapConfig = {
  enabled: true,
  updateIntervalSec: 30,
  outputDir: 'data/visualizations/risk_heatmaps',
  imageWidth: 800,
  imageHeight: 600,
  enableWebServer: false
}; 