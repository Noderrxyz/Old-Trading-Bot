/**
 * Blockchain Adapter System for Noderr Protocol
 * 
 * This module exports all adapters, interfaces, and utilities for blockchain
 * interaction, asset data retrieval, and cross-chain execution.
 */

// Core interfaces
export * from './IAdapter';
export * from './IChainAdapter';
export * from './IAssetAdapter';

// Base implementation classes
export * from './BaseChainAdapter';
export * from './BaseAssetAdapter';

// Chain adapters
export * from './EthereumAdapter';
export * from './AvalancheAdapter';
export * from './PolygonAdapter';
export * from './ArbitrumAdapter';
export * from './BinanceAdapter';

// Asset adapters
export * from './CoinGeckoAdapter';
export * from './CoinMarketCapAdapter';
export * from './MoralisAdapter';

// Cross-chain functionality
export * from './CrossChainExecutionRouter';
export * from './CrossChainTransactionFormatter';
export * from './ExecutionSecurityLayer';

// Telemetry and monitoring
export * from './telemetry/BlockchainTelemetry';
export * from './telemetry/CircuitBreaker';

/**
 * Chain ID constants
 */
export enum ChainId {
  ETHEREUM = 1,
  BINANCE_SMART_CHAIN = 56,
  POLYGON = 137,
  AVALANCHE = 43114,
  ARBITRUM = 42161,
  OPTIMISM = 10,
  BASE = 8453,
  FANTOM = 250,
  GNOSIS = 100,
  KLAYTN = 8217,
  AURORA = 1313161554,
  CELO = 42220,
  HARMONY = 1666600000,
  MOONBEAM = 1284,
  CRONOS = 25,
  METIS = 1088,
  EVMOS = 9001
}

/**
 * Network type constants
 */
export enum Network {
  ETHEREUM = 'ethereum',
  BINANCE_SMART_CHAIN = 'bsc',
  POLYGON = 'polygon',
  AVALANCHE = 'avalanche',
  ARBITRUM = 'arbitrum',
  OPTIMISM = 'optimism',
  BASE = 'base',
  FANTOM = 'fantom',
  GNOSIS = 'gnosis',
  KLAYTN = 'klaytn',
  AURORA = 'aurora',
  CELO = 'celo',
  HARMONY = 'harmony',
  MOONBEAM = 'moonbeam',
  CRONOS = 'cronos',
  METIS = 'metis',
  EVMOS = 'evmos'
}

// Import types needed for the factory function
import type { IChainAdapter } from './IChainAdapter';
import type { ChainAdapterConfig } from './BaseChainAdapter';
import type { EthereumAdapterConfig } from './EthereumAdapter';
import type { AvalancheAdapterConfig } from './AvalancheAdapter';

// Reference the implementations without re-importing
import { EthereumAdapter } from './EthereumAdapter';
import { AvalancheAdapter } from './AvalancheAdapter';
import { PolygonAdapter } from './PolygonAdapter';
import { ArbitrumAdapter } from './ArbitrumAdapter';
import { BinanceAdapter } from './BinanceAdapter';

/**
 * Factory function to create the appropriate blockchain adapter
 * based on the chain ID
 * 
 * @param chainId The blockchain network ID
 * @param config Configuration options for the adapter
 * @returns An instance of the appropriate adapter
 * @throws Error if the chain ID is not supported
 */
export function createAdapter(
  chainId: number,
  config?: Partial<ChainAdapterConfig>
): IChainAdapter {
  // Merge chain ID with provided config to ensure it's set correctly
  const mergedConfig = {
    ...config,
    chainId
  };
  
  switch (chainId) {
    case ChainId.ETHEREUM:
    case ChainId.ETHEREUM_GOERLI:
    case ChainId.ETHEREUM_SEPOLIA:
      return new EthereumAdapter(mergedConfig as Partial<EthereumAdapterConfig>);
      
    case ChainId.AVALANCHE:
    case ChainId.AVALANCHE_FUJI:
      return new AvalancheAdapter(mergedConfig as Partial<AvalancheAdapterConfig>);
      
    case ChainId.POLYGON:
    case ChainId.POLYGON_MUMBAI:
      return new PolygonAdapter(mergedConfig);
      
    case ChainId.ARBITRUM:
    case ChainId.ARBITRUM_GOERLI:
      return new ArbitrumAdapter(mergedConfig);
      
    case ChainId.BINANCE_SMART_CHAIN:
    case ChainId.BINANCE_TESTNET:
      return new BinanceAdapter(mergedConfig);
      
    default:
      throw new Error(`Chain ID ${chainId} is not supported`);
  }
}

/**
 * Helper function to determine if a chain ID is a testnet
 * 
 * @param chainId The blockchain network ID
 * @returns True if the chain is a testnet
 */
export function isTestnet(chainId: number): boolean {
  return [
    ChainId.ETHEREUM_GOERLI,
    ChainId.ETHEREUM_SEPOLIA,
    ChainId.BINANCE_TESTNET,
    ChainId.POLYGON_MUMBAI,
    ChainId.AVALANCHE_FUJI,
    ChainId.ARBITRUM_GOERLI,
    ChainId.OPTIMISM_GOERLI,
    ChainId.BASE_GOERLI
  ].includes(chainId);
}

/**
 * Helper function to get the name of a chain
 * 
 * @param chainId The blockchain network ID
 * @returns The name of the chain
 */
export function getChainName(chainId: number): string {
  switch (chainId) {
    case ChainId.ETHEREUM:
      return 'Ethereum Mainnet';
    case ChainId.ETHEREUM_GOERLI:
      return 'Ethereum Goerli Testnet';
    case ChainId.ETHEREUM_SEPOLIA:
      return 'Ethereum Sepolia Testnet';
    case ChainId.BINANCE_SMART_CHAIN:
      return 'BNB Chain Mainnet';
    case ChainId.BINANCE_TESTNET:
      return 'BNB Chain Testnet';
    case ChainId.POLYGON:
      return 'Polygon Mainnet';
    case ChainId.POLYGON_MUMBAI:
      return 'Polygon Mumbai Testnet';
    case ChainId.AVALANCHE:
      return 'Avalanche C-Chain';
    case ChainId.AVALANCHE_FUJI:
      return 'Avalanche Fuji Testnet';
    case ChainId.ARBITRUM:
      return 'Arbitrum One';
    case ChainId.ARBITRUM_GOERLI:
      return 'Arbitrum Goerli Testnet';
    case ChainId.OPTIMISM:
      return 'Optimism Mainnet';
    case ChainId.OPTIMISM_GOERLI:
      return 'Optimism Goerli Testnet';
    case ChainId.BASE:
      return 'Base Mainnet';
    case ChainId.BASE_GOERLI:
      return 'Base Goerli Testnet';
    default:
      return `Unknown Chain (${chainId})`;
  }
}

/**
 * Helper function to get the default RPC URL for a chain
 * Note: These are public RPC URLs and should not be used in production
 * 
 * @param chainId The blockchain network ID
 * @returns The default RPC URL for the chain
 */
export function getDefaultRpcUrl(chainId: number): string {
  switch (chainId) {
    case ChainId.ETHEREUM:
      return 'https://eth-mainnet.g.alchemy.com/v2/demo';
    case ChainId.ETHEREUM_GOERLI:
      return 'https://eth-goerli.g.alchemy.com/v2/demo';
    case ChainId.ETHEREUM_SEPOLIA:
      return 'https://eth-sepolia.g.alchemy.com/v2/demo';
    case ChainId.BINANCE_SMART_CHAIN:
      return 'https://bsc-dataseed.binance.org';
    case ChainId.BINANCE_TESTNET:
      return 'https://data-seed-prebsc-1-s1.binance.org:8545';
    case ChainId.POLYGON:
      return 'https://polygon-mainnet.g.alchemy.com/v2/demo';
    case ChainId.POLYGON_MUMBAI:
      return 'https://polygon-mumbai.g.alchemy.com/v2/demo';
    case ChainId.AVALANCHE:
      return 'https://api.avax.network/ext/bc/C/rpc';
    case ChainId.AVALANCHE_FUJI:
      return 'https://api.avax-test.network/ext/bc/C/rpc';
    case ChainId.ARBITRUM:
      return 'https://arb1.arbitrum.io/rpc';
    case ChainId.ARBITRUM_GOERLI:
      return 'https://goerli-rollup.arbitrum.io/rpc';
    case ChainId.OPTIMISM:
      return 'https://mainnet.optimism.io';
    case ChainId.OPTIMISM_GOERLI:
      return 'https://goerli.optimism.io';
    case ChainId.BASE:
      return 'https://mainnet.base.org';
    case ChainId.BASE_GOERLI:
      return 'https://goerli.base.org';
    default:
      throw new Error(`No default RPC URL available for chain ID ${chainId}`);
  }
}

/**
 * Helper function to get the block explorer URL for a chain
 * 
 * @param chainId The blockchain network ID
 * @returns The block explorer URL for the chain
 */
export function getBlockExplorerUrl(chainId: number): string {
  switch (chainId) {
    case ChainId.ETHEREUM:
      return 'https://etherscan.io';
    case ChainId.ETHEREUM_GOERLI:
      return 'https://goerli.etherscan.io';
    case ChainId.ETHEREUM_SEPOLIA:
      return 'https://sepolia.etherscan.io';
    case ChainId.BINANCE_SMART_CHAIN:
      return 'https://bscscan.com';
    case ChainId.BINANCE_TESTNET:
      return 'https://testnet.bscscan.com';
    case ChainId.POLYGON:
      return 'https://polygonscan.com';
    case ChainId.POLYGON_MUMBAI:
      return 'https://mumbai.polygonscan.com';
    case ChainId.AVALANCHE:
      return 'https://snowtrace.io';
    case ChainId.AVALANCHE_FUJI:
      return 'https://testnet.snowtrace.io';
    case ChainId.ARBITRUM:
      return 'https://arbiscan.io';
    case ChainId.ARBITRUM_GOERLI:
      return 'https://goerli.arbiscan.io';
    case ChainId.OPTIMISM:
      return 'https://optimistic.etherscan.io';
    case ChainId.OPTIMISM_GOERLI:
      return 'https://goerli-optimism.etherscan.io';
    case ChainId.BASE:
      return 'https://basescan.org';
    case ChainId.BASE_GOERLI:
      return 'https://goerli.basescan.org';
    default:
      return '';
  }
}

/**
 * Adapter Module Exports
 * 
 * Central export file for all adapter-related functionality.
 */

// Interfaces
export * from './interfaces/IExchangeConnector';
export * from './interfaces/IRPCProvider';

// Mock Implementations
export { MockExchangeConnector } from './mock/MockExchangeConnector';
export { MockRPCProvider } from './mock/MockRPCProvider';

// Factories
export {
  ExchangeConnectorFactory,
  RPCProviderFactory,
  getExchangeConnector,
  getRPCProvider,
  createCommonExchangeConnectors,
  createCommonRPCProviders,
  cleanupAllAdapters,
  getAdapterStatistics
} from './factories/AdapterFactory';

/**
 * Adapters Module Index
 * 
 * Centralized exports for all adapter components including Phase 2 and Phase 3 systems.
 */

// Phase 3: Data Injection System (New)
export * from './interfaces/IDataFeed';
export * from './feeds/HistoricalDataFeed';
export * from './feeds/SimulatedDataFeed';
export * from './simulation/MarketSimulationEngine';
export * from './simulation/MEVSimulationEngine';
export * from './factories/DataFeedFactory';

// Re-export convenience functions
export {
  createDataFeed,
  createSimulatedDataFeed,
  createHistoricalDataFeed,
  createHighFrequencySimulationFeed,
  cleanupAllDataFeeds
} from './factories/DataFeedFactory'; 