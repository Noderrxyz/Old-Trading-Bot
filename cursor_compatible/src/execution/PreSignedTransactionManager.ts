import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { Logger } from 'winston';

// NODERR_EXEC_OPTIMIZATION_STAGE_1: Pre-signed transaction management for ultra-low latency

/**
 * Pre-signed transaction template for common operations
 */
interface PreSignedTemplate {
  id: string;
  operation: string; // 'swap', 'limit_order', 'cancel', etc.
  chainId: number;
  baseTransaction: Partial<ethers.Transaction>;
  gasEstimate: number;
  timestamp: number;
  expiresAt: number;
}

/**
 * Cached nonce information for rapid transaction dispatch
 */
interface NonceCache {
  address: string;
  currentNonce: number;
  pendingNonces: Set<number>;
  lastUpdate: number;
}

/**
 * Pre-encoded transaction ready for instant dispatch
 */
interface PreEncodedTransaction {
  id: string;
  operation: string;
  rawTransaction: string;
  gasLimit: number;
  gasPrice: ethers.BigNumber;
  nonce: number;
  value: ethers.BigNumber;
  to: string;
  data: string;
  expiresAt: number;
}

/**
 * Configuration for pre-signing manager
 */
interface PreSignConfig {
  // Maximum number of pre-signed transactions to maintain
  maxPreSigned: number;
  
  // Nonce refresh interval in ms
  nonceRefreshInterval: number;
  
  // Gas estimate refresh interval in ms
  gasRefreshInterval: number;
  
  // Template expiration time in ms
  templateTTL: number;
  
  // Supported chain IDs
  supportedChains: number[];
  
  // RPC providers for each chain
  rpcProviders: Record<number, string>;
}

/**
 * Pre-signed transaction manager for ultra-low latency execution
 */
export class PreSignedTransactionManager extends EventEmitter {
  private logger: Logger;
  private config: PreSignConfig;
  
  // Core caches
  private nonceCache: Map<string, NonceCache> = new Map();
  private gasEstimates: Map<string, { estimate: number; timestamp: number }> = new Map();
  private preSignedTemplates: Map<string, PreSignedTemplate> = new Map();
  private preEncodedTransactions: Map<string, PreEncodedTransaction> = new Map();
  
  // Provider connections
  private providers: Map<number, ethers.providers.JsonRpcProvider> = new Map();
  private wallets: Map<string, ethers.Wallet> = new Map();
  
  // Background timers
  private nonceUpdateTimer?: NodeJS.Timeout;
  private gasUpdateTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: Partial<PreSignConfig>, logger: Logger) {
    super();
    
    this.logger = logger;
    this.config = {
      maxPreSigned: 100,
      nonceRefreshInterval: 5000, // 5 seconds
      gasRefreshInterval: 10000, // 10 seconds  
      templateTTL: 60000, // 1 minute
      supportedChains: [1, 137, 56, 42161], // ETH, Polygon, BSC, Arbitrum
      rpcProviders: {},
      ...config
    };
    
    this.initializeProviders();
    this.startBackgroundTasks();
    
    this.logger.info('PreSignedTransactionManager initialized');
  }

  /**
   * Initialize RPC providers for supported chains
   */
  private initializeProviders(): void {
    for (const chainId of this.config.supportedChains) {
      const rpcUrl = this.config.rpcProviders[chainId];
      if (rpcUrl) {
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
        this.providers.set(chainId, provider);
        this.logger.debug(`Initialized provider for chain ${chainId}`);
      } else {
        this.logger.warn(`No RPC URL configured for chain ${chainId}`);
      }
    }
  }

  /**
   * Add a wallet for pre-signing transactions
   */
  addWallet(address: string, privateKey: string): void {
    const wallet = new ethers.Wallet(privateKey);
    this.wallets.set(address.toLowerCase(), wallet);
    
    // Initialize nonce cache for this address
    this.initializeNonceCache(address);
    
    this.logger.info(`Wallet added for address ${address}`);
  }

  /**
   * Initialize nonce cache for an address
   */
  private async initializeNonceCache(address: string): Promise<void> {
    for (const [chainId, provider] of this.providers) {
      try {
        const nonce = await provider.getTransactionCount(address, 'pending');
        
        this.nonceCache.set(`${address}-${chainId}`, {
          address,
          currentNonce: nonce,
          pendingNonces: new Set(),
          lastUpdate: Date.now()
        });
        
        this.logger.debug(`Initialized nonce cache for ${address} on chain ${chainId}: ${nonce}`);
      } catch (error) {
        this.logger.error(`Failed to initialize nonce for ${address} on chain ${chainId}:`, error);
      }
    }
  }

  /**
   * Pre-compute and cache gas estimates for common operations
   */
  async precomputeGasEstimates(): Promise<void> {
    const commonOperations = [
      { operation: 'erc20_transfer', data: '0xa9059cbb', value: '0' },
      { operation: 'uniswap_v2_swap', data: '0x38ed1739', value: '0' },
      { operation: 'uniswap_v3_swap', data: '0x414bf389', value: '0' },
      { operation: 'approve_max', data: '0x095ea7b3', value: '0' },
      { operation: 'cancel_order', data: '0x2e1a7d4d', value: '0' }
    ];

    for (const op of commonOperations) {
      for (const [chainId, provider] of this.providers) {
        try {
          // Mock transaction for gas estimation
          const mockTx = {
            to: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI token as example
            data: op.data + '0'.repeat(64), // Padded data
            value: ethers.utils.parseEther(op.value)
          };
          
          const gasEstimate = await provider.estimateGas(mockTx);
          const key = `${op.operation}-${chainId}`;
          
          this.gasEstimates.set(key, {
            estimate: gasEstimate.toNumber(),
            timestamp: Date.now()
          });
          
          this.logger.debug(`Cached gas estimate for ${op.operation} on chain ${chainId}: ${gasEstimate.toString()}`);
        } catch (error) {
          this.logger.debug(`Failed to estimate gas for ${op.operation} on chain ${chainId}:`, error);
        }
      }
    }
  }

  /**
   * Create pre-signed transaction template for instant use
   */
  async createTemplate(
    operation: string,
    chainId: number,
    fromAddress: string,
    toAddress: string,
    data: string,
    value: string = '0'
  ): Promise<string> {
    const provider = this.providers.get(chainId);
    const wallet = this.wallets.get(fromAddress.toLowerCase());
    
    if (!provider || !wallet) {
      throw new Error(`Provider or wallet not available for chain ${chainId} and address ${fromAddress}`);
    }

    // Get or estimate gas
    const gasKey = `${operation}-${chainId}`;
    let gasEstimate = this.gasEstimates.get(gasKey)?.estimate || 21000;
    
    // Get current gas price
    const gasPrice = await provider.getGasPrice();
    
    // Get next nonce
    const nonce = await this.getNextNonce(fromAddress, chainId);
    
    const baseTransaction: Partial<ethers.Transaction> = {
      to: toAddress,
      value: ethers.utils.parseEther(value),
      data,
      gasLimit: ethers.BigNumber.from(gasEstimate),
      gasPrice,
      nonce,
      chainId
    };

    const templateId = `${operation}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const template: PreSignedTemplate = {
      id: templateId,
      operation,
      chainId,
      baseTransaction,
      gasEstimate,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.config.templateTTL
    };

    this.preSignedTemplates.set(templateId, template);
    
    // Pre-encode the transaction
    await this.preEncodeTransaction(template, wallet);
    
    this.logger.info(`Created pre-signed template ${templateId} for ${operation}`);
    return templateId;
  }

  /**
   * Pre-encode transaction for instant dispatch
   */
  private async preEncodeTransaction(template: PreSignedTemplate, wallet: ethers.Wallet): Promise<void> {
    try {
      const signedTx = await wallet.signTransaction(template.baseTransaction as any);
      
      const preEncoded: PreEncodedTransaction = {
        id: template.id,
        operation: template.operation,
        rawTransaction: signedTx,
        gasLimit: (template.baseTransaction.gasLimit as ethers.BigNumber)?.toNumber() || 21000,
        gasPrice: template.baseTransaction.gasPrice as ethers.BigNumber,
        nonce: template.baseTransaction.nonce as number,
        value: template.baseTransaction.value as ethers.BigNumber,
        to: template.baseTransaction.to as string,
        data: template.baseTransaction.data as string,
        expiresAt: template.expiresAt
      };

      this.preEncodedTransactions.set(template.id, preEncoded);
      this.logger.debug(`Pre-encoded transaction ${template.id}`);
    } catch (error) {
      this.logger.error(`Failed to pre-encode transaction ${template.id}:`, error);
    }
  }

  /**
   * Get next available nonce (with local increment)
   */
  private async getNextNonce(address: string, chainId: number): Promise<number> {
    const key = `${address}-${chainId}`;
    const cached = this.nonceCache.get(key);
    
    if (!cached) {
      await this.initializeNonceCache(address);
      return this.nonceCache.get(key)?.currentNonce || 0;
    }

    // Increment local nonce
    const nextNonce = cached.currentNonce;
    cached.currentNonce++;
    cached.pendingNonces.add(nextNonce);
    
    return nextNonce;
  }

  /**
   * Instantly dispatch a pre-signed transaction
   */
  async dispatchTransaction(templateId: string): Promise<string> {
    const preEncoded = this.preEncodedTransactions.get(templateId);
    
    if (!preEncoded) {
      throw new Error(`Pre-encoded transaction ${templateId} not found`);
    }

    if (Date.now() > preEncoded.expiresAt) {
      throw new Error(`Pre-encoded transaction ${templateId} has expired`);
    }

    const provider = this.providers.get(1); // Use default provider for now
    if (!provider) {
      throw new Error('No provider available');
    }

    try {
      const txResponse = await provider.sendTransaction(preEncoded.rawTransaction);
      
      this.logger.info(`Dispatched pre-signed transaction ${templateId}: ${txResponse.hash}`);
      
      // Clean up used transaction
      this.preEncodedTransactions.delete(templateId);
      this.preSignedTemplates.delete(templateId);
      
      return txResponse.hash;
    } catch (error) {
      this.logger.error(`Failed to dispatch transaction ${templateId}:`, error);
      throw error;
    }
  }

  /**
   * Start background tasks for nonce and gas updates
   */
  private startBackgroundTasks(): void {
    // Nonce refresh
    this.nonceUpdateTimer = setInterval(() => {
      this.refreshNonces();
    }, this.config.nonceRefreshInterval);

    // Gas estimate refresh
    this.gasUpdateTimer = setInterval(() => {
      this.precomputeGasEstimates();
    }, this.config.gasRefreshInterval);

    // Cleanup expired templates
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredTemplates();
    }, this.config.templateTTL / 2);
  }

  /**
   * Refresh nonce values from blockchain
   */
  private async refreshNonces(): Promise<void> {
    for (const [key, cached] of this.nonceCache) {
      const [address, chainId] = key.split('-');
      const provider = this.providers.get(parseInt(chainId));
      
      if (!provider) continue;

      try {
        const onChainNonce = await provider.getTransactionCount(address, 'pending');
        
        // Update if blockchain nonce is higher (transactions were mined)
        if (onChainNonce > cached.currentNonce) {
          cached.currentNonce = onChainNonce;
          cached.pendingNonces.clear();
          cached.lastUpdate = Date.now();
        }
      } catch (error) {
        this.logger.debug(`Failed to refresh nonce for ${key}:`, error);
      }
    }
  }

  /**
   * Clean up expired templates and pre-encoded transactions
   */
  private cleanupExpiredTemplates(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, template] of this.preSignedTemplates) {
      if (now > template.expiresAt) {
        this.preSignedTemplates.delete(id);
        this.preEncodedTransactions.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} expired transaction templates`);
    }
  }

  /**
   * Get current cache statistics
   */
  getStats() {
    return {
      wallets: this.wallets.size,
      providers: this.providers.size,
      noncesCached: this.nonceCache.size,
      gasEstimates: this.gasEstimates.size,
      preSignedTemplates: this.preSignedTemplates.size,
      preEncodedTransactions: this.preEncodedTransactions.size
    };
  }

  /**
   * Cleanup and destroy
   */
  destroy(): void {
    if (this.nonceUpdateTimer) clearInterval(this.nonceUpdateTimer);
    if (this.gasUpdateTimer) clearInterval(this.gasUpdateTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    
    this.nonceCache.clear();
    this.gasEstimates.clear();
    this.preSignedTemplates.clear();
    this.preEncodedTransactions.clear();
    this.providers.clear();
    this.wallets.clear();
    
    this.logger.info('PreSignedTransactionManager destroyed');
  }
} 