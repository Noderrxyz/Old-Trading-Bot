/**
 * Floor Engine Type Definitions
 * 
 * Comprehensive type system for the low-risk yield generation engine
 */

import { BigNumberish } from 'ethers';

// ============================================================================
// ADAPTER TYPES
// ============================================================================

/**
 * Adapter category classification
 */
export type AdapterCategory = 'lending' | 'staking' | 'yield';

/**
 * Risk level classification
 */
export type RiskLevel = 'low' | 'medium' | 'high';

/**
 * Adapter metadata for registration
 */
export interface AdapterMetadata {
  name: string;
  version: string;
  protocol: string;
  chain: string;
  category: AdapterCategory;
  riskLevel: RiskLevel;
  enabled: boolean;
  maxAllocation: bigint; // Maximum capital per adapter
  description?: string;
}

/**
 * Transaction result from adapter operations
 */
export interface TransactionResult {
  success: boolean;
  transactionHash?: string;
  blockNumber?: number;
  gasUsed?: bigint;
  error?: string;
}

// ============================================================================
// LENDING ADAPTER TYPES
// ============================================================================

/**
 * Generic adapter position (used by all adapter types)
 */
export interface AdapterPosition {
  totalValue: bigint;      // Total value (supplied - borrowed for lending, staked for staking, etc.)
  supplied: bigint;        // Total supplied/staked amount
  borrowed: bigint;        // Total borrowed amount (0 for staking/yield)
  apy: number;             // Current APY (percentage)
  healthFactor: number;    // Health factor (> 1 = healthy, Infinity if no debt)
  metadata?: Record<string, any>; // Protocol-specific data
}

/**
 * Lending adapter interface
 * 
 * Simplified, production-ready interface based on real protocol implementations.
 * Returns transaction hashes directly for immediate verification.
 */
export interface ILendingAdapter {
  supply(token: string, amount: bigint): Promise<string>;
  withdraw(token: string, amount: bigint): Promise<string>;
  borrow(token: string, amount: bigint): Promise<string>;
  repay(token: string, amount: bigint): Promise<string>;
  getPosition(token?: string): Promise<AdapterPosition>;
  getAPY(token?: string): Promise<number>;
  healthCheck(): Promise<{ healthy: boolean; reason?: string }>;
}

// ============================================================================
// STAKING ADAPTER TYPES
// ============================================================================

/**
 * Staking adapter interface
 * 
 * Simplified, production-ready interface for staking protocols.
 * Returns transaction hashes directly for immediate verification.
 */
export interface IStakingAdapter {
  stake(amount: bigint): Promise<string>;
  unstake(amount: bigint): Promise<string>;
  claimRewards(): Promise<string>;
  getPosition(): Promise<AdapterPosition>;
  getAPY(): Promise<number>;
  healthCheck(): Promise<{ healthy: boolean; reason?: string }>;
}

// ============================================================================
// YIELD ADAPTER TYPES
// ============================================================================

/**
 * Yield farming adapter interface
 * 
 * Simplified, production-ready interface for yield farming protocols.
 * Returns transaction hashes directly for immediate verification.
 */
export interface IYieldAdapter {
  deposit(lpToken: string, amount: bigint): Promise<string>;
  withdraw(lpToken: string, amount: bigint): Promise<string>;
  harvest(): Promise<string>;
  compound(): Promise<string>;
  getPosition(lpToken?: string): Promise<AdapterPosition>;
  getAPY(lpToken?: string): Promise<number>;
  healthCheck(): Promise<{ healthy: boolean; reason?: string }>;
}

// ============================================================================
// POSITION TYPES
// ============================================================================

/**
 * Generic position across all adapter types
 */
export interface Position {
  adapterId: string;
  protocol: string;
  category: AdapterCategory;
  value: bigint;
  apy: number;
  lastUpdate: number; // timestamp
  metadata: Record<string, any>;
}

// ============================================================================
// ALLOCATION TYPES
// ============================================================================

/**
 * Capital allocation strategy
 */
export interface AllocationStrategy {
  lending: number; // percentage (0-100)
  staking: number; // percentage (0-100)
  yield: number; // percentage (0-100)
}

/**
 * Target allocation per adapter
 */
export interface TargetAllocation {
  adapterId: string;
  targetPercentage: number;
  minPercentage: number;
  maxPercentage: number;
}

// ============================================================================
// RISK MANAGEMENT TYPES
// ============================================================================

/**
 * Risk parameters for the Floor Engine
 */
export interface RiskParameters {
  maxAllocationPerAdapter: bigint; // e.g., 20% of total capital
  maxAllocationPerProtocol: bigint; // e.g., 40% of total capital
  maxAllocationPerChain: bigint; // e.g., 60% of total capital
  maxSlippageBps: number; // e.g., 50 bps (0.5%)
  maxDrawdownBps: number; // e.g., 500 bps (5%)
  allowedTokens: string[]; // Whitelist of tokens
  allowedProtocols: string[]; // Whitelist of protocols
  emergencyPauseEnabled: boolean;
}

/**
 * Risk metrics for monitoring
 */
export interface RiskMetrics {
  totalExposure: bigint;
  exposureByProtocol: Record<string, bigint>;
  exposureByChain: Record<string, bigint>;
  currentDrawdown: number;
  maxDrawdown: number;
  sharpeRatio: number;
  volatility: number;
}

// ============================================================================
// PERFORMANCE TYPES
// ============================================================================

/**
 * Performance metrics for the Floor Engine
 */
export interface PerformanceMetrics {
  totalValue: bigint;
  totalDeposited: bigint;
  totalYield: bigint;
  currentAPY: number;
  averageAPY: number; // 30-day rolling average
  sharpeRatio: number;
  maxDrawdown: number;
  positions: Position[];
  lastRebalance: number; // timestamp
  lastHarvest: number; // timestamp
}

/**
 * Historical performance data point
 */
export interface PerformanceSnapshot {
  timestamp: number;
  totalValue: bigint;
  apy: number;
  positions: Position[];
}

// ============================================================================
// REBALANCING TYPES
// ============================================================================

/**
 * Rebalancing action
 */
export interface RebalanceAction {
  adapterId: string;
  action: 'deposit' | 'withdraw';
  amount: bigint;
  reason: string;
}

/**
 * Rebalancing result
 */
export interface RebalanceResult {
  success: boolean;
  actions: RebalanceAction[];
  gasUsed: bigint;
  timestamp: number;
  error?: string;
}

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

/**
 * Floor Engine configuration
 */
export interface FloorEngineConfig {
  // Blockchain configuration
  rpcUrl: string;
  chainId: number;
  networkName: string;

  // Wallet configuration
  privateKey: string;

  // Contract addresses
  treasuryManagerAddress: string;

  // Allocation strategy
  allocationStrategy: AllocationStrategy;
  targetAllocations: TargetAllocation[];

  // Risk parameters
  riskParameters: RiskParameters;

  // Rebalancing configuration
  rebalanceThresholdBps: number; // e.g., 500 bps (5% deviation triggers rebalance)
  minRebalanceInterval: number; // seconds between rebalances
  autoRebalanceEnabled: boolean;

  // Harvesting configuration
  autoHarvestEnabled: boolean;
  minHarvestInterval: number; // seconds between harvests
  minHarvestAmount: bigint; // minimum yield to trigger harvest

  // Logging configuration
  logLevel: string;
  logFile: string;
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Floor Engine events
 */
export type FloorEngineEvent =
  | { type: 'capital_allocated'; adapterId: string; amount: bigint }
  | { type: 'capital_withdrawn'; adapterId: string; amount: bigint }
  | { type: 'rebalance_triggered'; reason: string }
  | { type: 'rebalance_completed'; actions: RebalanceAction[] }
  | { type: 'harvest_completed'; totalYield: bigint }
  | { type: 'emergency_pause'; reason: string }
  | { type: 'adapter_enabled'; adapterId: string }
  | { type: 'adapter_disabled'; adapterId: string };

/**
 * Event listener callback
 */
export type EventListener = (event: FloorEngineEvent) => void;

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Chain information
 */
export interface ChainInfo {
  chainId: number;
  name: string;
  rpcUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

/**
 * Token information
 */
export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  name: string;
}

/**
 * Protocol information
 */
export interface ProtocolInfo {
  name: string;
  category: AdapterCategory;
  chains: number[];
  riskLevel: RiskLevel;
  tvl: bigint;
  apy: number;
}
