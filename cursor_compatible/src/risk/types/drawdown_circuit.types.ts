/**
 * Drawdown breach event
 */
export interface DrawdownBreachEvent {
  /** Current drawdown percentage */
  currentDrawdownPct: number;
  
  /** Threshold percentage */
  thresholdPct: number;
  
  /** Action taken */
  actionTaken: 'shutdown' | 'pause';
  
  /** Timestamp */
  timestamp: number;
}

/**
 * Circuit breaker configuration
 */
export interface DrawdownCircuitConfig {
  /** Whether circuit breaker is enabled */
  enabled: boolean;
  
  /** Maximum drawdown percentage */
  maxDrawdownPct: number;
  
  /** Check interval in seconds */
  checkInterval: number;
  
  /** Action to take on trigger */
  actionOnTrigger: 'shutdown' | 'pause';
  
  /** Alert webhook URL */
  alertWebhook?: string;
}

/**
 * Default circuit breaker configuration
 */
export const DEFAULT_DRAWDOWN_CIRCUIT_CONFIG: DrawdownCircuitConfig = {
  enabled: true,
  maxDrawdownPct: 10,
  checkInterval: 10,
  actionOnTrigger: 'shutdown'
}; 