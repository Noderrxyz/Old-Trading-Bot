/**
 * Yield Farming Adapters
 * 
 * This module exports adapters for major DeFi yield farming protocols.
 * These adapters enable the Floor Engine to allocate capital to yield farming
 * strategies for enhanced returns.
 * 
 * Supported Protocols:
 * - Convex Finance: Boosted Curve yields (CRV + CVX rewards)
 * - Curve Finance: Direct stablecoin pool access (CRV rewards)
 * - Balancer V2: Weighted pool liquidity provision (BAL rewards)
 * 
 * @module adapters/yield
 */

export { ConvexAdapter } from './ConvexAdapter';
export type { ConvexAdapterConfig } from './ConvexAdapter';

export { CurveAdapter } from './CurveAdapter';
export type { CurveAdapterConfig } from './CurveAdapter';

export { BalancerAdapter } from './BalancerAdapter';
export type { BalancerAdapterConfig } from './BalancerAdapter';
