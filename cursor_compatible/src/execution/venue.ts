import { ExecutionResult } from './types';

/**
 * Venue execution capabilities
 */
export interface VenueCapabilities {
  supportedSymbols: string[];
  supportedOrderTypes: string[];
  maxLeverage: number;
  minOrderSize: Record<string, number>;
  maxOrderSize: Record<string, number>;
  fees: {
    maker: number;
    taker: number;
  };
  trustScore: number;
  latencyMs: number;
}

/**
 * Result of venue execution
 */
export interface VenueExecutionResult extends ExecutionResult {
  venueId: string;
  venueSpecificData?: Record<string, any>;
  routingDecision?: {
    reason: string;
    score: number;
    alternatives: string[];
  };
} 