/**
 * Application Constants
 * 
 * Central repository for configuration constants used throughout the application.
 */

// System configuration
export const SYSTEM_NAME = 'Noderr Trading System';
export const VERSION = '1.0.0';

// Feature flags
export const FALLBACK_ENABLED = true;
export const TELEMETRY_ENABLED = true;
export const DEBUG_MODE = process.env.NODE_ENV === 'development';

// Timeouts and intervals (in milliseconds)
export const DEFAULT_REQUEST_TIMEOUT = 30000;
export const HEALTH_CHECK_INTERVAL = 60000;
export const RECONNECT_INTERVAL = 5000;

// Fallback system
export const MAX_FALLBACK_ATTEMPTS = 3;
export const FALLBACK_COOLDOWN_PERIOD = 300000; // 5 minutes

// Trading limits
export const MAX_ORDER_SIZE_BTC = 10;
export const MAX_ORDER_SIZE_ETH = 100;
export const DEFAULT_SLIPPAGE_TOLERANCE = 0.005; // 0.5%

// Risk parameters
export const DEFAULT_RISK_SCORE_THRESHOLD = 0.7;
export const MAX_DRAWDOWN_PERCENTAGE = 0.15; // 15%

// Market data configuration
export const MARKET_DATA_BATCH_SIZE = 100;
export const FEATURE_CALCULATION_INTERVAL = 1000; // 1 second
export const ANOMALY_DETECTION_INTERVAL = 5000; // 5 seconds 