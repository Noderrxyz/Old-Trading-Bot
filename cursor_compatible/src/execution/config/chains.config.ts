import dotenv from 'dotenv';
import { Environment } from './ChainConfig';
import { logger } from '../../utils/logger';

// Load environment variables from .env file
dotenv.config();

/**
 * Helper function to load environment variable
 * @param key Environment variable key
 * @param defaultValue Default value if not found
 */
function env<T>(key: string, defaultValue: T): T {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  
  // Try to parse as JSON if it's not a string type
  if (typeof defaultValue !== 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      // If parsing fails, return as is
      return value as unknown as T;
    }
  }
  
  return value as unknown as T;
}

/**
 * Get current environment
 */
export const ENVIRONMENT: Environment = 
  (process.env.NODE_ENV === 'production') ? Environment.MAINNET :
  (process.env.NODE_ENV === 'staging') ? Environment.TESTNET :
  Environment.LOCAL;

/**
 * Global chain configuration settings
 */
export const CHAIN_CONFIG = {
  // Global settings
  maxFeeBudget: env('NODERR_MAX_FEE_BUDGET', 50), // Maximum fee budget in USD
  maxSlippageTolerance: env('NODERR_MAX_SLIPPAGE', 5.0), // Maximum slippage in percentage
  maxTransactionValue: env('NODERR_MAX_TX_VALUE', 10000), // Maximum transaction value in USD
  maxRetryAttempts: env('NODERR_MAX_RETRY_ATTEMPTS', 3), // Maximum retry attempts
  
  // Ethereum configuration
  ethereum: {
    // Common settings
    enabled: env('ETHEREUM_ENABLED', true),
    maxFeeBudget: env('ETHEREUM_MAX_FEE', 20), // Maximum fee budget in USD
    gasLimitMultiplier: env('ETHEREUM_GAS_MULTIPLIER', 1.2),
    maxConfirmTimeMs: env('ETHEREUM_CONFIRM_TIMEOUT', 120000), // 2 minutes
    confirmationBlocks: env('ETHEREUM_CONFIRM_BLOCKS', 2),
    useFlashbots: env('ETHEREUM_USE_FLASHBOTS', false),
    
    // Environment-specific settings
    mainnet: {
      rpcUrls: env('ETHEREUM_MAINNET_RPC_URLS', ['https://mainnet.infura.io/v3/YOUR_INFURA_KEY']),
      chainId: env('ETHEREUM_MAINNET_CHAIN_ID', '1'),
      networkName: 'ethereum',
      explorerUrl: 'https://etherscan.io'
    },
    testnet: {
      rpcUrls: env('ETHEREUM_TESTNET_RPC_URLS', ['https://sepolia.infura.io/v3/YOUR_INFURA_KEY']),
      chainId: env('ETHEREUM_TESTNET_CHAIN_ID', '11155111'), // Sepolia
      networkName: 'sepolia',
      explorerUrl: 'https://sepolia.etherscan.io'
    }
  },
  
  // Solana configuration
  solana: {
    // Common settings
    enabled: env('SOLANA_ENABLED', true),
    maxFeeBudget: env('SOLANA_MAX_FEE', 5), // Maximum fee budget in USD
    maxConfirmTimeMs: env('SOLANA_CONFIRM_TIMEOUT', 60000), // 1 minute
    commitment: env('SOLANA_COMMITMENT', 'confirmed'),
    maxComputeUnits: env('SOLANA_MAX_COMPUTE_UNITS', 200000),
    priorityFee: env('SOLANA_PRIORITY_FEE', 5000), // micro-lamports
    useDurableNonce: env('SOLANA_USE_DURABLE_NONCE', false),
    
    // Environment-specific settings
    mainnet: {
      rpcUrls: env('SOLANA_MAINNET_RPC_URLS', ['https://api.mainnet-beta.solana.com']),
      chainId: 'mainnet-beta',
      networkName: 'solana',
      explorerUrl: 'https://explorer.solana.com'
    },
    testnet: {
      rpcUrls: env('SOLANA_TESTNET_RPC_URLS', ['https://api.testnet.solana.com']),
      chainId: 'testnet',
      networkName: 'solana-testnet',
      explorerUrl: 'https://explorer.solana.com/?cluster=testnet'
    }
  },
  
  // Cosmos configuration
  cosmos: {
    // Common settings
    enabled: env('COSMOS_ENABLED', true),
    maxFeeBudget: env('COSMOS_MAX_FEE', 10), // Maximum fee budget in USD
    maxConfirmTimeMs: env('COSMOS_CONFIRM_TIMEOUT', 60000), // 1 minute
    gasAdjustment: env('COSMOS_GAS_ADJUSTMENT', 1.5),
    confirmationBlocks: env('COSMOS_CONFIRM_BLOCKS', 2),
    useIBC: env('COSMOS_USE_IBC', true),
    
    // Environment-specific settings
    mainnet: {
      rpcUrls: env('COSMOS_MAINNET_RPC_URLS', ['https://rpc.cosmos.network']),
      chainId: 'cosmoshub-4',
      networkName: 'cosmoshub',
      explorerUrl: 'https://cosmos.bigdipper.live',
      defaultFees: {
        slow: '0.025uatom',
        average: '0.05uatom',
        fast: '0.1uatom'
      },
      ibcInfo: {
        osmosis: {
          sourceChannel: 'channel-141',
          destChannel: 'channel-0',
          timeout: 600000 // 10 minutes
        },
        // Add other chains as needed
      }
    },
    testnet: {
      rpcUrls: env('COSMOS_TESTNET_RPC_URLS', ['https://rpc.testnet.cosmos.network']),
      chainId: 'cosmoshub-testnet',
      networkName: 'cosmoshub-testnet',
      explorerUrl: 'https://testnet.cosmos.bigdipper.live',
      defaultFees: {
        slow: '0.01uatom',
        average: '0.02uatom',
        fast: '0.04uatom'
      },
      ibcInfo: {
        osmosis: {
          sourceChannel: 'channel-test-1',
          destChannel: 'channel-test-2',
          timeout: 600000 // 10 minutes
        }
      }
    }
  }
};

/**
 * Get configuration for the current environment
 */
export function getCurrentChainConfig<T extends 'ethereum' | 'solana' | 'cosmos'>(chain: T): any {
  const env = ENVIRONMENT === Environment.MAINNET ? 'mainnet' : 'testnet';
  const commonConfig = CHAIN_CONFIG[chain];
  const envConfig = CHAIN_CONFIG[chain][env];
  
  // Log configuration loading
  logger.info(`Loaded ${env} configuration for ${chain}`);
  
  // Combine common and environment-specific configurations
  return {
    ...commonConfig,
    ...envConfig,
    enabled: commonConfig.enabled,
    maxFeeBudget: commonConfig.maxFeeBudget
  };
}

/**
 * Initialize all chain configurations
 */
export function initializeChainConfigurations() {
  logger.info(`Initializing chain configurations for ${ENVIRONMENT} environment`);
  
  // Log loaded configurations
  if (CHAIN_CONFIG.ethereum.enabled) {
    logger.info(`Ethereum enabled with ${getCurrentChainConfig('ethereum').rpcUrls.length} RPC endpoints`);
  }
  
  if (CHAIN_CONFIG.solana.enabled) {
    logger.info(`Solana enabled with ${getCurrentChainConfig('solana').rpcUrls.length} RPC endpoints`);
  }
  
  if (CHAIN_CONFIG.cosmos.enabled) {
    logger.info(`Cosmos enabled with ${getCurrentChainConfig('cosmos').rpcUrls.length} RPC endpoints`);
    
    // Log IBC configuration if enabled
    if (CHAIN_CONFIG.cosmos.useIBC) {
      const ibcInfo = getCurrentChainConfig('cosmos').ibcInfo;
      const channels = ibcInfo ? Object.keys(ibcInfo).length : 0;
      logger.info(`Cosmos IBC enabled with ${channels} configured channels`);
    }
  }
  
  return CHAIN_CONFIG;
}

// Export configuration 
export default CHAIN_CONFIG; 