/**
 * Lending Adapters Index
 * 
 * Exports all lending protocol adapters for the Floor Engine.
 * 
 * Supported Protocols:
 * - Aave V3: Multi-chain lending (Ethereum, Arbitrum, Optimism, Base)
 * - Compound V3: Multi-chain lending (Ethereum, Arbitrum, Base)
 * - Morpho Blue: Ethereum-only lending with flexible markets
 * - Spark: Ethereum-only lending (MakerDAO's Aave V3 fork)
 */

export { AaveV3Adapter } from './AaveV3Adapter';
export type { AaveV3AdapterConfig } from './AaveV3Adapter';

export { CompoundV3Adapter } from './CompoundV3Adapter';
export type { CompoundV3AdapterConfig } from './CompoundV3Adapter';

export { MorphoBlueAdapter } from './MorphoBlueAdapter';
export type { MorphoBlueAdapterConfig } from './MorphoBlueAdapter';

export { SparkAdapter } from './SparkAdapter';
export type { SparkAdapterConfig } from './SparkAdapter';
