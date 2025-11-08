/**
 * Blockchain Constants for Noderr Protocol
 * 
 * This file contains constants used throughout the blockchain adapter system,
 * including chain identifiers, asset definitions, and configuration constants.
 */

/**
 * Chain identifier objects
 */
export const CHAINS = {
  ETHEREUM: { id: 1, name: 'Ethereum Mainnet' },
  ETHEREUM_SEPOLIA: { id: 11155111, name: 'Ethereum Sepolia Testnet' },
  ETHEREUM_GOERLI: { id: 5, name: 'Ethereum Goerli Testnet' },
  POLYGON: { id: 137, name: 'Polygon Mainnet' },
  POLYGON_MUMBAI: { id: 80001, name: 'Polygon Mumbai Testnet' },
  AVALANCHE: { id: 43114, name: 'Avalanche C-Chain' },
  AVALANCHE_FUJI: { id: 43113, name: 'Avalanche Fuji Testnet' },
  ARBITRUM: { id: 42161, name: 'Arbitrum One' },
  ARBITRUM_GOERLI: { id: 421613, name: 'Arbitrum Goerli Testnet' },
  BINANCE: { id: 56, name: 'Binance Smart Chain' },
  BINANCE_TESTNET: { id: 97, name: 'Binance Smart Chain Testnet' },
  OPTIMISM: { id: 10, name: 'Optimism' },
  OPTIMISM_GOERLI: { id: 420, name: 'Optimism Goerli Testnet' },
  BASE: { id: 8453, name: 'Base' },
  BASE_GOERLI: { id: 84531, name: 'Base Goerli Testnet' }
};

/**
 * Common assets by chain
 */
export const ASSETS = {
  // Ethereum assets
  [CHAINS.ETHEREUM.id]: {
    NATIVE: { symbol: 'ETH', name: 'Ethereum', decimals: 18, chainId: CHAINS.ETHEREUM.id, isNative: true },
    USDC: { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chainId: CHAINS.ETHEREUM.id, isNative: false },
    USDT: { symbol: 'USDT', name: 'Tether', decimals: 6, address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', chainId: CHAINS.ETHEREUM.id, isNative: false },
    DAI: { symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', chainId: CHAINS.ETHEREUM.id, isNative: false },
    WETH: { symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', chainId: CHAINS.ETHEREUM.id, isNative: false }
  },
  
  // Polygon assets
  [CHAINS.POLYGON.id]: {
    NATIVE: { symbol: 'MATIC', name: 'Polygon', decimals: 18, chainId: CHAINS.POLYGON.id, isNative: true },
    USDC: { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', chainId: CHAINS.POLYGON.id, isNative: false },
    USDT: { symbol: 'USDT', name: 'Tether', decimals: 6, address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', chainId: CHAINS.POLYGON.id, isNative: false },
    DAI: { symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', chainId: CHAINS.POLYGON.id, isNative: false },
    WETH: { symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', chainId: CHAINS.POLYGON.id, isNative: false }
  },
  
  // Avalanche assets
  [CHAINS.AVALANCHE.id]: {
    NATIVE: { symbol: 'AVAX', name: 'Avalanche', decimals: 18, chainId: CHAINS.AVALANCHE.id, isNative: true },
    USDC: { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', chainId: CHAINS.AVALANCHE.id, isNative: false },
    USDT: { symbol: 'USDT', name: 'Tether', decimals: 6, address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', chainId: CHAINS.AVALANCHE.id, isNative: false },
    DAI: { symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, address: '0xd586E7F844cEa2F87f50152665BCbc2C279D8d70', chainId: CHAINS.AVALANCHE.id, isNative: false },
    WETH: { symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, address: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', chainId: CHAINS.AVALANCHE.id, isNative: false }
  },
  
  // Arbitrum assets
  [CHAINS.ARBITRUM.id]: {
    NATIVE: { symbol: 'ETH', name: 'Ethereum', decimals: 18, chainId: CHAINS.ARBITRUM.id, isNative: true },
    USDC: { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', chainId: CHAINS.ARBITRUM.id, isNative: false },
    USDT: { symbol: 'USDT', name: 'Tether', decimals: 6, address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', chainId: CHAINS.ARBITRUM.id, isNative: false },
    DAI: { symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', chainId: CHAINS.ARBITRUM.id, isNative: false },
    WETH: { symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', chainId: CHAINS.ARBITRUM.id, isNative: false }
  },
  
  // Binance Smart Chain assets
  [CHAINS.BINANCE.id]: {
    NATIVE: { symbol: 'BNB', name: 'Binance Coin', decimals: 18, chainId: CHAINS.BINANCE.id, isNative: true },
    USDC: { symbol: 'USDC', name: 'USD Coin', decimals: 18, address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', chainId: CHAINS.BINANCE.id, isNative: false },
    USDT: { symbol: 'USDT', name: 'Tether', decimals: 18, address: '0x55d398326f99059fF775485246999027B3197955', chainId: CHAINS.BINANCE.id, isNative: false },
    DAI: { symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', chainId: CHAINS.BINANCE.id, isNative: false },
    BUSD: { symbol: 'BUSD', name: 'BUSD', decimals: 18, address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', chainId: CHAINS.BINANCE.id, isNative: false }
  }
};

/**
 * Chain RPC URLs by environment
 */
export const RPC_URLS = {
  // Environment-specific RPCs (populated from environment variables)
  PRODUCTION: {
    [CHAINS.ETHEREUM.id]: process.env.ETH_MAINNET_RPC_URL || 'https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161',
    [CHAINS.POLYGON.id]: process.env.POLYGON_MAINNET_RPC_URL || 'https://polygon-rpc.com',
    [CHAINS.AVALANCHE.id]: process.env.AVALANCHE_MAINNET_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
    [CHAINS.ARBITRUM.id]: process.env.ARBITRUM_MAINNET_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    [CHAINS.BINANCE.id]: process.env.BSC_MAINNET_RPC_URL || 'https://bsc-dataseed.binance.org/'
  },
  
  // Testnet RPCs
  TESTNET: {
    [CHAINS.ETHEREUM_SEPOLIA.id]: process.env.ETH_SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161',
    [CHAINS.POLYGON_MUMBAI.id]: process.env.POLYGON_MUMBAI_RPC_URL || 'https://rpc-mumbai.maticvigil.com',
    [CHAINS.AVALANCHE_FUJI.id]: process.env.AVALANCHE_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc',
    [CHAINS.ARBITRUM_GOERLI.id]: process.env.ARBITRUM_GOERLI_RPC_URL || 'https://goerli-rollup.arbitrum.io/rpc',
    [CHAINS.BINANCE_TESTNET.id]: process.env.BSC_TESTNET_RPC_URL || 'https://data-seed-prebsc-1-s1.binance.org:8545/'
  },
  
  // Backup URLs
  BACKUP: {
    [CHAINS.ETHEREUM.id]: 'https://eth-mainnet.public.blastapi.io',
    [CHAINS.POLYGON.id]: 'https://polygon-mainnet.public.blastapi.io',
    [CHAINS.AVALANCHE.id]: 'https://avalanche-c-chain.publicnode.com',
    [CHAINS.ARBITRUM.id]: 'https://arbitrum-one.public.blastapi.io',
    [CHAINS.BINANCE.id]: 'https://bsc.publicnode.com'
  }
};

/**
 * Default adapter configuration
 */
export const DEFAULT_ADAPTER_CONFIG = {
  // Reliability settings
  maxRetries: 3,
  retryBaseDelayMs: 500,
  retryMaxDelayMs: 10000,
  rpcTimeout: 30000,
  
  // Gas settings
  gasPriceMultiplier: 1.2,
  priorityFeeMultiplier: 1.5,
  maxGasLimit: 2000000,
  
  // Performance
  maxConcurrentRequests: 50,
  cacheTimeMs: 15000
};

/**
 * Mock addresses for testing
 */
export const TEST_ADDRESSES = {
  WALLET: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
  CONTRACT: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  EXCHANGE: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'
};

/**
 * Default registry configuration
 */
export const DEFAULT_REGISTRY_CONFIG = {
  // Reliability features
  retryBaseDelayMs: 500,
  retryMaxDelayMs: 10000,
  maxRetries: 3,
  circuitBreakerThreshold: 5,
  circuitBreakerResetTimeoutMs: 30000,
  
  // Performance
  rpcTimeout: 30000,
  
  // Features
  metricsEnabled: true,
  autoInitialize: true
}; 