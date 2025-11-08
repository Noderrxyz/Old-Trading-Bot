import path from 'path';
import fs from 'fs';
import { logger } from '../../utils/logger';

/**
 * Environment enum
 */
export enum Environment {
  LOCAL = 'local',
  TESTNET = 'testnet',
  MAINNET = 'mainnet',
  PRODUCTION = 'production'
}

/**
 * Generic chain configuration interface
 */
export interface ChainConfig {
  /**
   * RPC endpoint URLs (primary and fallbacks)
   */
  rpcUrls: string[];
  
  /**
   * Chain or network identifier
   */
  chainId: string;
  
  /**
   * Network name
   */
  networkName: string;
  
  /**
   * Whether this chain is enabled
   */
  isEnabled: boolean;
  
  /**
   * Maximum fee budget in native currency
   */
  maxFeeBudget: number;
  
  /**
   * Block explorer URL
   */
  explorerUrl?: string;
  
  /**
   * Default gas/fee settings
   */
  defaultFees: {
    slow: number | string;
    average: number | string;
    fast: number | string;
  };
  
  /**
   * Maximum wait time for confirmation in ms
   */
  maxConfirmTimeMs: number;
  
  /**
   * Chain-specific configuration
   */
  chainSpecific: Record<string, any>;
}

/**
 * Ethereum chain configuration
 */
export interface EthereumChainConfig extends ChainConfig {
  /**
   * Gas limit multiplier for safety
   */
  gasLimitMultiplier: number;
  
  /**
   * Block confirmations required
   */
  confirmationBlocks: number;
  
  /**
   * Whether to use Flashbots
   */
  useFlashbots: boolean;
  
  /**
   * Flashbots relay URL if applicable
   */
  flashbotsRelayUrl?: string;
}

/**
 * Solana chain configuration
 */
export interface SolanaChainConfig extends ChainConfig {
  /**
   * Commitment level
   */
  commitment: string;
  
  /**
   * Max compute units per transaction
   */
  maxComputeUnits: number;
  
  /**
   * Priority fee in micro-lamports
   */
  priorityFee: number;
  
  /**
   * Whether to use durable nonce
   */
  useDurableNonce: boolean;
}

/**
 * Cosmos chain configuration
 */
export interface CosmosChainConfig extends ChainConfig {
  /**
   * Gas adjustment factor
   */
  gasAdjustment: number;
  
  /**
   * Block confirmations required
   */
  confirmationBlocks: number;
  
  /**
   * Whether to use IBC
   */
  useIBC: boolean;
  
  /**
   * IBC channel info if applicable
   */
  ibcInfo?: Record<string, {
    sourceChannel: string;
    destChannel: string;
    timeout: number;
  }>;
}

/**
 * Chain configuration repository
 * Manages configurations for all supported chains
 */
export class ChainConfigRepository {
  private static instance: ChainConfigRepository | null = null;
  private configs: Map<string, ChainConfig> = new Map();
  private environment: Environment = Environment.TESTNET;
  
  /**
   * Private constructor
   */
  private constructor() {
    // Set environment from env var or default to testnet
    const envName = process.env.NODE_ENV || 'testnet';
    this.environment = this.parseEnvironment(envName);
    
    // Initialize default configurations
    this.initializeDefaultConfigs();
    
    // Try to load from config file
    this.loadConfigFile();
    
    // Override with environment variables
    this.applyEnvironmentOverrides();
    
    logger.info(`ChainConfigRepository initialized with ${this.configs.size} chains in ${this.environment} environment`);
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(): ChainConfigRepository {
    if (!ChainConfigRepository.instance) {
      ChainConfigRepository.instance = new ChainConfigRepository();
    }
    return ChainConfigRepository.instance;
  }
  
  /**
   * Get configuration for a specific chain
   */
  public getConfig<T extends ChainConfig>(chainId: string): T | null {
    const config = this.configs.get(chainId);
    return config ? config as T : null;
  }
  
  /**
   * Get all enabled chains
   */
  public getEnabledChains(): string[] {
    return Array.from(this.configs.entries())
      .filter(([_, config]) => config.isEnabled)
      .map(([chainId, _]) => chainId);
  }
  
  /**
   * Get current environment
   */
  public getEnvironment(): Environment {
    return this.environment;
  }
  
  /**
   * Set configuration for a chain
   */
  public setConfig(chainId: string, config: ChainConfig): void {
    this.configs.set(chainId, config);
    logger.info(`Updated configuration for chain ${chainId}`);
  }
  
  /**
   * Update configuration for a chain
   */
  public updateConfig(chainId: string, config: Partial<ChainConfig>): void {
    const existingConfig = this.configs.get(chainId);
    
    if (existingConfig) {
      // Create a new config object by merging the existing config with the new config
      const updatedConfig: ChainConfig = {
        ...existingConfig,
        rpcUrls: config.rpcUrls || existingConfig.rpcUrls,
        chainId: config.chainId || existingConfig.chainId,
        networkName: config.networkName || existingConfig.networkName,
        isEnabled: config.isEnabled !== undefined ? config.isEnabled : existingConfig.isEnabled,
        maxFeeBudget: config.maxFeeBudget !== undefined ? config.maxFeeBudget : existingConfig.maxFeeBudget,
        explorerUrl: config.explorerUrl || existingConfig.explorerUrl,
        defaultFees: config.defaultFees || existingConfig.defaultFees,
        maxConfirmTimeMs: config.maxConfirmTimeMs || existingConfig.maxConfirmTimeMs,
        chainSpecific: config.chainSpecific || existingConfig.chainSpecific
      };
      
      this.configs.set(chainId, updatedConfig);
      logger.info(`Updated configuration for chain ${chainId}`);
    } else {
      logger.warn(`Cannot update config for non-existent chain ${chainId}`);
    }
  }
  
  /**
   * Override current environment
   */
  public setEnvironment(environment: Environment): void {
    this.environment = environment;
    
    // Reinitialize with new environment
    this.initializeDefaultConfigs();
    this.loadConfigFile();
    this.applyEnvironmentOverrides();
    
    logger.info(`Environment changed to ${environment}`);
  }
  
  /**
   * Initialize default configurations
   */
  private initializeDefaultConfigs(): void {
    this.configs.clear();
    
    // Default Ethereum configuration
    const ethereumConfig: EthereumChainConfig = {
      rpcUrls: this.getDefaultRpcUrls('ethereum'),
      chainId: 'ethereum-1',
      networkName: this.getNetworkName('ethereum'),
      isEnabled: true,
      maxFeeBudget: 0.1, // 0.1 ETH
      explorerUrl: 'https://etherscan.io',
      defaultFees: {
        slow: 20, // gwei
        average: 40,
        fast: 60
      },
      maxConfirmTimeMs: 120000, // 2 minutes
      gasLimitMultiplier: 1.2,
      confirmationBlocks: 2,
      useFlashbots: false,
      chainSpecific: {}
    };
    
    // Default Solana configuration
    const solanaConfig: SolanaChainConfig = {
      rpcUrls: this.getDefaultRpcUrls('solana'),
      chainId: 'solana-mainnet-beta',
      networkName: this.getNetworkName('solana'),
      isEnabled: true,
      maxFeeBudget: 0.1, // 0.1 SOL
      explorerUrl: 'https://explorer.solana.com',
      defaultFees: {
        slow: 5000, // lamports
        average: 10000,
        fast: 20000
      },
      maxConfirmTimeMs: 60000, // 1 minute
      commitment: 'confirmed',
      maxComputeUnits: 200000,
      priorityFee: 1000, // micro-lamports
      useDurableNonce: false,
      chainSpecific: {}
    };
    
    // Default Cosmos configuration
    const cosmosConfig: CosmosChainConfig = {
      rpcUrls: this.getDefaultRpcUrls('cosmos'),
      chainId: 'cosmos-cosmoshub-4',
      networkName: this.getNetworkName('cosmos'),
      isEnabled: true,
      maxFeeBudget: 1, // 1 ATOM
      explorerUrl: 'https://www.mintscan.io/cosmos',
      defaultFees: {
        slow: '0.025uatom',
        average: '0.05uatom',
        fast: '0.1uatom'
      },
      maxConfirmTimeMs: 60000, // 1 minute
      gasAdjustment: 1.5,
      confirmationBlocks: 2,
      useIBC: false,
      chainSpecific: {}
    };
    
    // Add configurations to the map
    this.configs.set('ethereum-1', ethereumConfig);
    this.configs.set('solana-mainnet-beta', solanaConfig);
    this.configs.set('cosmos-cosmoshub-4', cosmosConfig);
  }
  
  /**
   * Load configuration from file
   */
  private loadConfigFile(): void {
    try {
      const configDir = process.env.CONFIG_DIR || 'config';
      const configFile = path.join(configDir, `chains.${this.environment}.json`);
      
      if (!fs.existsSync(configFile)) {
        logger.debug(`Config file ${configFile} not found, using defaults`);
        return;
      }
      
      const fileContent = fs.readFileSync(configFile, 'utf8');
      const fileConfigs = JSON.parse(fileContent);
      
      // Merge file configs with current configs
      for (const [chainId, fileConfig] of Object.entries(fileConfigs)) {
        const existingConfig = this.configs.get(chainId);
        
        if (existingConfig) {
          // Manually merge the configs to avoid spread operator on unknown types
          this.updateConfig(chainId, fileConfig as Partial<ChainConfig>);
        } else {
          this.configs.set(chainId, fileConfig as ChainConfig);
        }
      }
      
      logger.info(`Loaded chain configurations from ${configFile}`);
    } catch (error) {
      logger.warn(`Failed to load config file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Apply environment variable overrides
   */
  private applyEnvironmentOverrides(): void {
    // Override RPC URLs from environment variables
    for (const [chainId, config] of this.configs.entries()) {
      const envPrefix = chainId.replace(/-/g, '_').toUpperCase();
      
      // RPC URLs
      const rpcEnvVar = `${envPrefix}_RPC_URL`;
      const rpcUrls = process.env[rpcEnvVar];
      
      if (rpcUrls) {
        config.rpcUrls = rpcUrls.split(',').map(url => url.trim());
      }
      
      // Enabled status
      const enabledEnvVar = `${envPrefix}_ENABLED`;
      const isEnabled = process.env[enabledEnvVar];
      
      if (isEnabled !== undefined) {
        config.isEnabled = isEnabled.toLowerCase() === 'true';
      }
      
      // Max fee budget
      const maxFeeBudgetEnvVar = `${envPrefix}_MAX_FEE_BUDGET`;
      const maxFeeBudget = process.env[maxFeeBudgetEnvVar];
      
      if (maxFeeBudget !== undefined) {
        config.maxFeeBudget = parseFloat(maxFeeBudget);
      }
    }
  }
  
  /**
   * Parse environment string to Environment enum
   */
  private parseEnvironment(env: string): Environment {
    switch (env.toLowerCase()) {
      case 'local':
        return Environment.LOCAL;
      case 'testnet':
        return Environment.TESTNET;
      case 'mainnet':
        return Environment.MAINNET;
      case 'production':
        return Environment.PRODUCTION;
      default:
        logger.warn(`Unknown environment "${env}", defaulting to testnet`);
        return Environment.TESTNET;
    }
  }
  
  /**
   * Get default RPC URLs based on environment
   */
  private getDefaultRpcUrls(chain: string): string[] {
    switch (chain) {
      case 'ethereum':
        switch (this.environment) {
          case Environment.LOCAL:
            return ['http://localhost:8545'];
          case Environment.TESTNET:
            return ['https://goerli.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161'];
          case Environment.MAINNET:
          case Environment.PRODUCTION:
            return ['https://ethereum.publicnode.com'];
        }
        break;
      case 'solana':
        switch (this.environment) {
          case Environment.LOCAL:
            return ['http://localhost:8899'];
          case Environment.TESTNET:
            return ['https://api.testnet.solana.com'];
          case Environment.MAINNET:
          case Environment.PRODUCTION:
            return ['https://api.mainnet-beta.solana.com'];
        }
        break;
      case 'cosmos':
        switch (this.environment) {
          case Environment.LOCAL:
            return ['http://localhost:26657'];
          case Environment.TESTNET:
            return ['https://rpc.testnet.cosmos.network'];
          case Environment.MAINNET:
          case Environment.PRODUCTION:
            return ['https://rpc.cosmos.network'];
        }
        break;
    }
    
    // Default fallback
    return [''];
  }
  
  /**
   * Get network name based on environment
   */
  private getNetworkName(chain: string): string {
    switch (chain) {
      case 'ethereum':
        switch (this.environment) {
          case Environment.LOCAL:
            return 'development';
          case Environment.TESTNET:
            return 'goerli';
          case Environment.MAINNET:
          case Environment.PRODUCTION:
            return 'mainnet';
        }
        break;
      case 'solana':
        switch (this.environment) {
          case Environment.LOCAL:
            return 'localnet';
          case Environment.TESTNET:
            return 'testnet';
          case Environment.MAINNET:
          case Environment.PRODUCTION:
            return 'mainnet-beta';
        }
        break;
      case 'cosmos':
        switch (this.environment) {
          case Environment.LOCAL:
            return 'localnet';
          case Environment.TESTNET:
            return 'testnet';
          case Environment.MAINNET:
          case Environment.PRODUCTION:
            return 'cosmoshub-4';
        }
        break;
    }
    
    // Default fallback
    return this.environment.toString();
  }
} 