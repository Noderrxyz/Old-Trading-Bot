/**
 * Risk violation types
 */
export enum RiskViolationType {
  MaxPositionSize = 'max_position_size',
  MaxLeverage = 'max_leverage',
  MaxDrawdown = 'max_drawdown',
  LowTrustScore = 'low_trust_score',
  MaxSymbolExposure = 'max_symbol_exposure',
  MaxVenueExposure = 'max_venue_exposure',
  InsufficientLiquidity = 'insufficient_liquidity',
  BlockedSymbol = 'blocked_symbol',
  BlockedVenue = 'blocked_venue',
  MaxConcentration = 'max_concentration',
}

/**
 * Risk violation details
 */
export interface RiskViolation {
  type: RiskViolationType | string;
  message: string;
  current: number;
  limit: number;
  symbol?: string;
  venue?: string;
  metadata?: Record<string, any>;
}

/**
 * Risk check result
 */
export interface RiskCheckResult {
  passed: boolean;
  violations: RiskViolation[];
  timestamp: Date;
  checkDurationMs: number;
} 