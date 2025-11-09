/**
 * Staking Adapters Index
 * 
 * Exports all staking protocol adapters for the Floor Engine.
 * 
 * Supported Protocols:
 * - Lido: Liquid staking with stETH (Ethereum)
 * - Rocket Pool: Decentralized liquid staking with rETH (Ethereum)
 * - Native ETH: Direct validator staking (Ethereum)
 */

export { LidoAdapter } from './LidoAdapter';
export type { LidoAdapterConfig } from './LidoAdapter';

export { RocketPoolAdapter } from './RocketPoolAdapter';
export type { RocketPoolAdapterConfig } from './RocketPoolAdapter';

export { NativeETHAdapter } from './NativeETHAdapter';
export type { NativeETHAdapterConfig, ValidatorData } from './NativeETHAdapter';
