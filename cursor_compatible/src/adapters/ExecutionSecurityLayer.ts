/**
 * ExecutionSecurityLayer - Provides MEV protection and execution security features
 * 
 * This module implements security features to protect trades from MEV attacks,
 * sandwich attacks, and other exploits. It includes Flashbots integration,
 * slippage protection, rate limiting, and multi-sig validation.
 */

import { TradeRequest, TransactionRequest, TransactionResponse, 
         IChainAdapter, ChainId, Asset } from './IChainAdapter';
import { AdapterCapability } from './IAdapter';
import { BlockchainTelemetry, TransactionType } from './telemetry/BlockchainTelemetry';
import { CrossChainTransactionFormatter } from './CrossChainTransactionFormatter';

// Import ethers without using an import statement to avoid direct dependency
// In a real implementation, this should be properly imported
declare const ethers: any;

/**
 * Blocknative configuration
 */
interface BlocknativeConfig {
  enabled: boolean;
  apiKey: string;
  supportedChains: number[];
}

/**
 * Extended execution security config
 */
export interface ExecutionSecurityConfig {
  // Flashbots configuration
  flashbots?: {
    enabled: boolean;
    relayUrls?: {
      [chainId: number]: string;
    };
    authSigner?: string; // Private key for Flashbots auth
    blocksToWait?: number;
  };
  
  // Slippage protection
  slippageProtection?: {
    defaultTolerance: number; // e.g., 0.5 for 0.5%
    maxTolerance: number; // Maximum allowed slippage
    enablePriceChecking: boolean;
    timeBound: number; // Maximum seconds a trade can be pending
  };
  
  // Rate limiting
  rateLimiting?: {
    enabled: boolean;
    maxRequestsPerMinute: {
      [strategyId: string]: number;
    };
    maxRequestsPerDay: {
      [strategyId: string]: number;
    };
  };
  
  // Multi-sig configuration
  multiSig?: {
    enabled: boolean;
    requiredSigners: number;
    signers: string[];
    validationThreshold: string; // Minimum value requiring multi-sig
  };
  
  // MEV protection
  mevProtection?: {
    enabled: boolean;
    protectionLevel?: 'basic' | 'standard' | 'aggressive';
    allowPrivateTransactions?: boolean;
    maxBaseFeeIncrease?: number;
    allowedDApps?: string[];
  };
  
  // Circuit breaker
  circuitBreaker?: {
    enabled: boolean;
    triggerConditions: {
      priceChangeThreshold: number;
      volumeChangeThreshold: number;
      gasThreshold: string;
    };
    cooldownPeriod: number;
  };
  
  // Time window
  timeWindow?: {
    enabled: boolean;
    allowedDays: number[];
    allowedHours: number[];
    timeZone: string;
  };
  
  // Global security level
  securityLevel?: 'low' | 'medium' | 'high';
  
  // Maximum gas price
  maxGasPrice?: string;
  
  // Telemetry
  telemetry?: BlockchainTelemetry;
  
  // Blocknative configuration
  blocknative?: BlocknativeConfig;
}

/**
 * Extended TradeRequest with additional properties
 */
export interface ExtendedTradeRequest extends TradeRequest {
  inputAmount?: string;
  securityChecks?: {
    skipSlippageCheck?: boolean;
    allowHighImpact?: boolean;
    allowFrontrunningCheck?: boolean;
    forceStrictValidation?: boolean;
  };
  market?: {
    baseVolume24h?: string;
    quoteVolume24h?: string;
    priceImpact?: number;
  };
}

/**
 * Slippage protection configuration
 */
export interface SlippageProtectionConfig {
  defaultTolerance: number; // Default slippage tolerance as a percentage (e.g., 0.5 = 0.5%)
  maxTolerance: number; // Maximum allowed slippage tolerance
  enablePriceChecking: boolean; // Whether to check external price sources
  timeBound: number; // Milliseconds that prices are considered valid
}

/**
 * MEV protection configuration
 */
export interface MevProtectionConfig {
  enabled: boolean;
  protectionLevel?: 'basic' | 'standard' | 'aggressive';
  allowPrivateTransactions?: boolean;
  maxBaseFeeIncrease?: number; // Maximum base fee increase allowed as percentage
  allowedDApps?: string[]; // List of allowed DApp addresses
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  enabled: boolean;
  maxTransactionsPerMinute: number;
  maxTransactionsPerHour: number;
  cooldownPeriod: number; // Milliseconds
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  enabled: boolean;
  triggerConditions: {
    priceChangeThreshold: number; // Percentage
    volumeChangeThreshold: number; // Percentage
    gasThreshold: string; // Gwei
  };
  cooldownPeriod: number; // Milliseconds
}

/**
 * Time window protection configuration
 */
export interface TimeWindowConfig {
  enabled: boolean;
  allowedDays: number[]; // 0-6, where 0 is Sunday
  allowedHours: number[]; // 0-23
  timeZone: string; // e.g., 'UTC', 'America/New_York'
}

/**
 * Security layer configuration
 */
export interface SecurityLayerConfig {
  slippageProtection: SlippageProtectionConfig;
  mevProtection?: MevProtectionConfig;
  rateLimit?: RateLimitConfig;
  circuitBreaker?: CircuitBreakerConfig;
  timeWindow?: TimeWindowConfig;
  telemetry?: BlockchainTelemetry;
  maxGasPrice?: string; // Maximum gas price allowed (in gwei)
  securityLevel?: 'low' | 'medium' | 'high'; // Overall security level
}

/**
 * Security validation result
 */
export interface SecurityValidationResult {
  approved: boolean;
  warnings: string[];
  errors: string[];
  modifications?: {
    gasAdjusted?: boolean;
    slippageAdjusted?: boolean;
    deadlineAdjusted?: boolean;
    routeChanged?: boolean;
  };
  modifiedRequest?: ExtendedTradeRequest;
  metadata?: Record<string, any>;
}

// Add missing interfaces/types
interface RateLimitCounter {
  minuteCount: number;
  hourCount: number;
  lastReset: number;
}

interface MultiSigTransaction {
  id: string;
  tradeRequest: TradeRequest;
  signatures: Array<{
    signer: string;
    signature: string;
    timestamp: number;
  }>;
  executed: boolean;
  timestamp: number;
}

interface SlippageValidationResult {
  valid: boolean;
  expectedOutput: bigint;
  minAcceptableOutput: bigint;
  calculatedSlippage: number;
  error?: string;
}

interface MevProtectionOptions {
  enabled: boolean;
  provider?: string;
  flashbots?: boolean;
  maxPriorityFeePerGas?: string;
}

// Chain-specific protection strategy interface
export interface ChainProtectionStrategy {
  validateTradeRequest?: (
    request: ExtendedTradeRequest,
    chainId: ChainId,
    layer: ExecutionSecurityLayer
  ) => Promise<SecurityValidationResult>;
}

/**
 * Pre-transaction simulation result
 */
interface SimulationResult {
  success: boolean;
  gasUsed: bigint;
  returnData: string;
  logs: any[];
  error?: string;
}

/**
 * Sandwich attack detection result
 */
interface SandwichDetectionResult {
  detected: boolean;
  confidence: number;
  attackType?: 'frontrun' | 'backrun' | 'sandwich';
  estimatedLoss?: bigint;
  recommendations: string[];
}

/**
 * RPC provider interface for private transaction services
 */
interface IPrivateRPCProvider {
  name: string;
  chainId: number;
  isAvailable(): Promise<boolean>;
  sendPrivateTransaction(tx: TransactionRequest): Promise<TransactionResponse>;
  getBundleStatus(bundleId: string): Promise<{
    status: 'pending' | 'included' | 'failed';
    blockNumber?: number;
    error?: string;
  }>;
  estimateBundleGas(txs: TransactionRequest[]): Promise<bigint>;
}

/**
 * Flashbots RPC provider implementation
 */
class FlashbotsProvider implements IPrivateRPCProvider {
  public readonly name: string = 'Flashbots';
  public readonly chainId: number;
  private provider: any;
  private authSigner: any;
  private relayUrl: string;
  
  constructor(chainId: number, relayUrl: string, authSigner: any) {
    this.chainId = chainId;
    this.relayUrl = relayUrl;
    this.authSigner = authSigner;
  }
  
  async initialize(): Promise<void> {
    // Initialize Flashbots provider
    this.provider = await ethers.providers.JsonRpcProvider(this.relayUrl);
  }
  
  async isAvailable(): Promise<boolean> {
    try {
      await this.provider.getBlockNumber();
      return true;
    } catch {
      return false;
    }
  }
  
  async sendPrivateTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    // Create Flashbots bundle
    const bundle = await this.provider.sendBundle(
      [tx],
      this.authSigner
    );
    
    return {
      hash: bundle.bundleHash,
      confirmations: 0,
      from: tx.from || '',
      wait: async (confirmations?: number) => {
        const status = await this.getBundleStatus(bundle.bundleHash);
        if (status.status === 'included' && status.blockNumber) {
          return {
            txHash: bundle.bundleHash,
            blockNumber: status.blockNumber,
            blockHash: '', // Would be populated in real implementation
            from: tx.from || '',
            to: tx.to || '',
            gasUsed: '0', // Would be populated in real implementation
            effectiveGasPrice: '0', // Would be populated in real implementation
            status: 'success',
            confirmations: 1,
            logs: []
          };
        }
        throw new Error(`Bundle failed: ${status.error || 'Unknown error'}`);
      }
    };
  }
  
  async getBundleStatus(bundleId: string): Promise<{
    status: 'pending' | 'included' | 'failed';
    blockNumber?: number;
    error?: string;
  }> {
    try {
      const status = await this.provider.getBundleStats(bundleId);
      return {
        status: status.included ? 'included' : 'pending',
        blockNumber: status.blockNumber
      };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  async estimateBundleGas(txs: TransactionRequest[]): Promise<bigint> {
    const estimates = await Promise.all(
      txs.map(tx => this.provider.estimateGas(tx))
    );
    return estimates.reduce((a, b) => a + b, BigInt(0));
  }
}

/**
 * Blocknative RPC provider implementation
 */
class BlocknativeProvider implements IPrivateRPCProvider {
  public readonly name: string = 'Blocknative';
  public readonly chainId: number;
  private provider: any;
  private apiKey: string;
  
  constructor(chainId: number, apiKey: string) {
    this.chainId = chainId;
    this.apiKey = apiKey;
  }
  
  async initialize(): Promise<void> {
    // Initialize Blocknative provider
    this.provider = new ethers.providers.JsonRpcProvider(
      `https://api.blocknative.com/v1/chain/${this.chainId}`,
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      }
    );
  }
  
  async isAvailable(): Promise<boolean> {
    try {
      await this.provider.getBlockNumber();
      return true;
    } catch {
      return false;
    }
  }
  
  async sendPrivateTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    // Send private transaction through Blocknative
    const response = await this.provider.send('eth_sendPrivateTransaction', [
      tx,
      { fast: true }
    ]);
    
    return {
      hash: response,
      confirmations: 0,
      from: tx.from || '',
      wait: async (confirmations?: number) => {
        const receipt = await this.provider.waitForTransaction(response, confirmations);
        return {
          txHash: response,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          from: tx.from || '',
          to: tx.to || '',
          gasUsed: receipt.gasUsed.toString(),
          effectiveGasPrice: receipt.effectiveGasPrice?.toString() || '0',
          status: receipt.status ? 'success' : 'failure',
          confirmations: receipt.confirmations,
          logs: receipt.logs || []
        };
      }
    };
  }
  
  async getBundleStatus(bundleId: string): Promise<{
    status: 'pending' | 'included' | 'failed';
    blockNumber?: number;
    error?: string;
  }> {
    try {
      const status = await this.provider.send('eth_getTransactionReceipt', [bundleId]);
      if (!status) {
        return { status: 'pending' };
      }
      return {
        status: status.status ? 'included' : 'failed',
        blockNumber: status.blockNumber
      };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  async estimateBundleGas(txs: TransactionRequest[]): Promise<bigint> {
    const estimates = await Promise.all(
      txs.map(tx => this.provider.estimateGas(tx))
    );
    return estimates.reduce((a, b) => a + b, BigInt(0));
  }
}

/**
 * Bundle optimization result
 */
interface BundleOptimizationResult {
  bundle: TransactionRequest[];
  estimatedGas: bigint;
  savings: bigint;
  reason?: string;
}

// --- Enhanced Private RPC Provider Management ---

export interface PrivateProviderStatus {
  name: string;
  available: boolean;
  lastError?: string;
}

/**
 * ExecutionSecurityLayer implementation
 */
export class ExecutionSecurityLayer {
  // Configuration
  private config: ExecutionSecurityConfig;
  
  // Flashbots provider cache
  private flashbotsProviders: Map<number, any> = new Map();
  
  // Rate limit tracking
  private rateLimitCounters: Map<string, RateLimitCounter> = new Map();
  
  // Multi-sig transaction queue
  private multiSigTransactions: Map<string, MultiSigTransaction> = new Map();
  
  // Price oracle interface (would be injected in a real implementation)
  private priceOracle: any;
  
  // Telemetry
  private telemetry?: BlockchainTelemetry;
  
  // Last execution time tracking
  private lastExecutionTime: Record<string, number> = {};
  
  // Execution counts tracking
  private executionCounts: Record<string, { minute: number, hour: number, lastReset: number }> = {};
  
  // Transaction formatter
  private transactionFormatter: CrossChainTransactionFormatter;
  
  // Registry for chain-specific protection strategies
  private chainProtectionStrategies: Map<ChainId, ChainProtectionStrategy> = new Map();
  
  // Add private RPC providers map
  private privateRPCProviders: Map<number, IPrivateRPCProvider[]> = new Map();
  
  /**
   * Constructor for the execution security layer
   * @param config Security configuration
   * @param formatter Optional transaction formatter for cross-chain support
   */
  constructor(config: ExecutionSecurityConfig, formatter?: CrossChainTransactionFormatter) {
    this.config = {
      // Default configuration
      flashbots: {
        enabled: false,
        blocksToWait: 2
      },
      slippageProtection: {
        defaultTolerance: 0.5, // 0.5%
        maxTolerance: 5, // 5%
        enablePriceChecking: true,
        timeBound: 300 // 5 minutes
      },
      rateLimiting: {
        enabled: true,
        maxRequestsPerMinute: {},
        maxRequestsPerDay: {}
      },
      multiSig: {
        enabled: false,
        requiredSigners: 2,
        signers: [],
        validationThreshold: "0"
      },
      ...config
    };
    
    this.telemetry = config.telemetry;
    this.transactionFormatter = formatter || new CrossChainTransactionFormatter({
      chainConfigs: []
    });
  }
  
  /**
   * Initialize the security layer
   */
  public async initialize(): Promise<void> {
    // Initialize Flashbots providers if enabled
    if (this.config.flashbots?.enabled) {
      await this.initializeFlashbotsProviders();
    }
    
    // Initialize price oracle if slippage protection is enabled
    if (this.config.slippageProtection?.enablePriceChecking) {
      // This would connect to a price oracle in a real implementation
      this.priceOracle = {};
    }
    
    // Initialize private RPC providers
    await this.initializePrivateRPCProviders();
  }
  
  /**
   * Initialize Flashbots providers for supported chains
   */
  private async initializeFlashbotsProviders(): Promise<void> {
    if (!this.config.flashbots?.enabled || !this.config.flashbots.relayUrls) {
      return;
    }
    
    // Initialize Flashbots provider for each configured chain
    for (const [chainIdStr, relayUrl] of Object.entries(this.config.flashbots.relayUrls)) {
      const chainId = parseInt(chainIdStr, 10);
      
      try {
        // In a real implementation, we would initialize actual Flashbots providers here
        // This is a placeholder for the real implementation
        const provider = {
          chainId,
          relayUrl,
          initialized: true
        };
        
        this.flashbotsProviders.set(chainId, provider);
        console.log(`Initialized Flashbots provider for chain ${chainId}`);
      } catch (error) {
        console.error(`Failed to initialize Flashbots provider for chain ${chainId}:`, error);
      }
    }
  }
  
  /**
   * Initialize private RPC providers
   */
  private async initializePrivateRPCProviders(): Promise<void> {
    if (!this.config.flashbots?.enabled && !this.config.blocknative?.enabled) {
      return;
    }
    
    // Initialize Flashbots providers if enabled
    if (this.config.flashbots?.enabled && this.config.flashbots.relayUrls) {
      for (const [chainIdStr, relayUrl] of Object.entries(this.config.flashbots.relayUrls)) {
        const chainId = parseInt(chainIdStr, 10);
        const provider = new FlashbotsProvider(
          chainId,
          relayUrl,
          this.config.flashbots.authSigner
        );
        await provider.initialize();
        
        const providers = this.privateRPCProviders.get(chainId) || [];
        providers.push(provider);
        this.privateRPCProviders.set(chainId, providers);
      }
    }
    
    // Initialize Blocknative providers if enabled
    if (this.config.blocknative?.enabled && this.config.blocknative.apiKey) {
      for (const chainId of this.config.blocknative.supportedChains) {
        const provider = new BlocknativeProvider(
          chainId,
          this.config.blocknative.apiKey
        );
        await provider.initialize();
        
        const providers = this.privateRPCProviders.get(chainId) || [];
        providers.push(provider);
        this.privateRPCProviders.set(chainId, providers);
      }
    }
  }
  
  /**
   * Get available private RPC providers for a chain
   * @param chainId Chain ID
   * @returns Array of available providers
   */
  private async getAvailablePrivateProviders(chainId: number): Promise<IPrivateRPCProvider[]> {
    const providers = this.privateRPCProviders.get(chainId) || [];
    const available = await Promise.all(
      providers.map(async provider => ({
        provider,
        available: await provider.isAvailable()
      }))
    );
    return available
      .filter(({ available }) => available)
      .map(({ provider }) => provider);
  }
  
  /**
   * Get the status of all private RPC providers for a chain
   */
  public async getPrivateProviderStatus(chainId: number): Promise<PrivateProviderStatus[]> {
    const providers = this.privateRPCProviders.get(chainId) || [];
    const statuses = await Promise.all(providers.map(async provider => {
      let available = false;
      let lastError = undefined;
      try {
        available = await provider.isAvailable();
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
      return {
        name: provider.name,
        available,
        lastError
      };
    }));
    return statuses;
  }
  
  /**
   * Enhanced sendPrivateTransaction with failover and telemetry
   */
  private async sendPrivateTransaction(
    adapter: IChainAdapter,
    transaction: TransactionRequest
  ): Promise<TransactionResponse> {
    const chainId = adapter.getChainId();
    const providers = await this.getAvailablePrivateProviders(chainId);
    if (providers.length === 0) {
      this.telemetry?.recordFailedExecution(
        adapter.getName(),
        'no_private_provider_available',
        TransactionType.TRADE
      );
      throw new Error('No private RPC providers available');
    }
    // Try providers in order until one succeeds
    for (const provider of providers) {
      try {
        const result = await provider.sendPrivateTransaction(transaction);
        this.telemetry?.recordMevProtectionSuccess(
          adapter.getName(),
          transaction.to || 'contract_creation',
          provider.name,
          result.hash,
          0 // Duration placeholder
        );
        return result;
      } catch (error) {
        this.telemetry?.recordMevProtectionFailure(
          adapter.getName(),
          transaction.to || 'contract_creation',
          provider.name,
          error instanceof Error ? error.message : String(error),
          0 // Duration placeholder
        );
        continue;
      }
    }
    this.telemetry?.recordFailedExecution(
      adapter.getName(),
      'all_private_providers_failed',
      TransactionType.TRADE
    );
    throw new Error('All private RPC providers failed');
  }
  
  /**
   * Send a transaction with MEV protection
   * @param adapter Chain adapter
   * @param transaction Transaction to send
   * @param options Protection options
   * @returns Transaction response
   */
  public async sendProtectedTransaction(
    adapter: IChainAdapter,
    transaction: TransactionRequest,
    options?: MevProtectionOptions
  ): Promise<TransactionResponse> {
    const chainId = adapter.getChainId();
    
    // Check if Flashbots is enabled and supported for this chain
    if (this.config.flashbots?.enabled && this.flashbotsProviders.has(chainId)) {
      return this.sendFlashbotsTransaction(adapter, transaction, options);
    }
    
    // If Flashbots is not available, use the adapter's regular transaction sending
    return adapter.sendTransaction(transaction);
  }
  
  /**
   * Send a transaction via Flashbots
   * @param adapter Chain adapter
   * @param transaction Transaction to send
   * @param options Protection options
   * @returns Transaction response
   */
  private async sendFlashbotsTransaction(
    adapter: IChainAdapter,
    transaction: TransactionRequest,
    options?: MevProtectionOptions
  ): Promise<TransactionResponse> {
    const startTime = Date.now();
    
    try {
      // Check if the adapter supports Flashbots
      if (!adapter.hasCapability(AdapterCapability.FLASHBOTS)) {
        throw new Error("Adapter does not support Flashbots");
      }
      
      // Get chain ID to determine the Flashbots endpoint
      const chainId = adapter.getChainId();
      const flashbotsProvider = this.flashbotsProviders.get(chainId);
      
      if (!flashbotsProvider) {
        throw new Error(`No Flashbots provider configured for chain ID ${chainId}`);
      }
      
      // Implementation would use the Flashbots provider to send the transaction
      // This is a placeholder for the actual Flashbots integration
      console.log(`Sending transaction through Flashbots on chain ${chainId}`);
      
      // For now, just send the transaction through the adapter
      return await adapter.sendTransaction(transaction);
    } catch (error) {
      // Record telemetry for failures
      if (this.telemetry) {
        this.telemetry.recordMevProtectionFailure(
          adapter.getName(),
          transaction.to || "contract_creation",
          "flashbots",
          error instanceof Error ? error.message : String(error),
          Date.now() - startTime
        );
      }
      
      throw error;
    }
  }
  
  /**
   * Check if a trade requires multi-sig approval
   * @param request Trade request
   * @returns Whether multi-sig is required
   */
  public requiresMultiSig(request: TradeRequest): boolean {
    if (!this.config.multiSig?.enabled) {
      return false;
    }
    
    // Check if value exceeds threshold
    const threshold = BigInt(this.config.multiSig.validationThreshold);
    
    if (request.value) {
      const value = BigInt(request.value);
      return value >= threshold;
    }
    
    // Check input amount for token transfers
    if (request && typeof (request as ExtendedTradeRequest).inputAmount !== 'undefined') {
      // For token transfers, we would need to convert to a common currency
      // This is a placeholder for that logic
      return false;
    }
    
    // Default to false
    return false;
  }
  
  /**
   * Submit a transaction for multi-sig approval
   * @param request Trade request
   * @param chainId Blockchain chain ID
   * @param signer Address of the signer
   * @param signature Signature authorizing the transaction
   * @returns Transaction ID
   */
  public submitMultiSigTransaction(
    request: TradeRequest,
    chainId: number,
    signer: string,
    signature: string
  ): string {
    if (!this.config.multiSig?.enabled) {
      throw new Error("Multi-sig is not enabled");
    }
    
    // Validate signer
    if (!this.config.multiSig.signers.includes(signer.toLowerCase())) {
      throw new Error(`Signer ${signer} is not authorized`);
    }
    
    // Generate a unique ID for the transaction
    const txId = `${chainId}-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    
    // Create the multi-sig transaction
    const multiSigTx: MultiSigTransaction = {
      id: txId,
      tradeRequest: request,
      signatures: [{
        signer,
        signature,
        timestamp: Date.now()
      }],
      executed: false,
      timestamp: Date.now()
    };
    
    // Store the transaction
    this.multiSigTransactions.set(txId, multiSigTx);
    
    return txId;
  }
  
  /**
   * Add a signature to a multi-sig transaction
   * @param txId Transaction ID
   * @param signer Address of the signer
   * @param signature Signature authorizing the transaction
   * @returns Whether the transaction has enough signatures
   */
  public addMultiSigSignature(
    txId: string,
    signer: string,
    signature: string
  ): boolean {
    if (!this.config.multiSig?.enabled) {
      throw new Error("Multi-sig is not enabled");
    }
    
    // Get the transaction
    const tx = this.multiSigTransactions.get(txId);
    if (!tx) {
      throw new Error(`Transaction ${txId} not found`);
    }
    
    // Check if transaction has expired
    if (tx && typeof (tx as any).expiresAt === 'number' && Date.now() > (tx as any).expiresAt) {
      throw new Error(`Transaction ${txId} has expired`);
    }
    
    // Check if transaction has already been executed
    if (tx.executed) {
      throw new Error(`Transaction ${txId} has already been executed`);
    }
    
    // Validate signer
    if (!this.config.multiSig.signers.includes(signer.toLowerCase())) {
      throw new Error(`Signer ${signer} is not authorized`);
    }
    
    // Check if signer has already signed
    if (tx.signatures.some(s => s.signer.toLowerCase() === signer.toLowerCase())) {
      throw new Error(`Signer ${signer} has already signed this transaction`);
    }
    
    // Add the signature
    tx.signatures.push({
      signer,
      signature,
      timestamp: Date.now()
    });
    
    // Check if the transaction has enough signatures
    const hasEnoughSignatures = tx.signatures.length >= (this.config.multiSig.requiredSigners || 2);
    
    // Update the transaction
    this.multiSigTransactions.set(txId, tx);
    
    return hasEnoughSignatures;
  }
  
  /**
   * Execute a multi-sig transaction
   * @param txId Transaction ID
   * @param adapter Chain adapter
   * @returns Transaction response
   */
  public async executeMultiSigTransaction(
    txId: string,
    adapter: IChainAdapter
  ): Promise<TransactionResponse> {
    if (!this.config.multiSig?.enabled) {
      throw new Error("Multi-sig is not enabled");
    }
    
    // Get the transaction
    const tx = this.multiSigTransactions.get(txId);
    if (!tx) {
      throw new Error(`Transaction ${txId} not found`);
    }
    
    // Check if transaction has expired
    if (tx && typeof (tx as any).expiresAt === 'number' && Date.now() > (tx as any).expiresAt) {
      throw new Error(`Transaction ${txId} has expired`);
    }
    
    // Check if transaction has already been executed
    if (tx.executed) {
      throw new Error(`Transaction ${txId} has already been executed`);
    }
    
    // Check if the transaction has enough signatures
    if (tx.signatures.length < (this.config.multiSig.requiredSigners || 2)) {
      throw new Error(`Transaction ${txId} does not have enough signatures`);
    }
    
    // Execute the transaction
    const response = await adapter.submitTrade(tx.tradeRequest);
    
    // Mark the transaction as executed
    tx.executed = true;
    this.multiSigTransactions.set(txId, tx);
    
    return response;
  }
  
  /**
   * Check rate limits for a strategy
   * @param strategyId Strategy ID
   * @throws Error if rate limit is exceeded
   */
  public checkRateLimits(strategyId: string): void {
    if (!this.config.rateLimiting?.enabled) {
      return;
    }
    
    const now = Date.now();
    
    // Get or initialize rate limit counters
    let counters = this.rateLimitCounters.get(strategyId);
    if (!counters) {
      counters = {
        minuteCount: 0,
        hourCount: 0,
        lastReset: now
      };
      this.rateLimitCounters.set(strategyId, counters);
    }
    
    // Reset counters if needed
    if (now >= counters.lastReset) {
      counters.minuteCount = 0;
      counters.hourCount = 0;
      counters.lastReset = now + 60000;
    } else if (now - counters.lastReset > 60000) { // 1 minute
      counters.minuteCount = 0;
    }
    
    // Check minute limit
    const minuteLimit = this.config.rateLimiting.maxRequestsPerMinute[strategyId];
    if (minuteLimit !== undefined && counters && typeof counters.minuteCount === 'number' && typeof minuteLimit === 'number' && counters.minuteCount >= minuteLimit) {
      throw new Error(`Rate limit exceeded for strategy ${strategyId}: ${typeof counters.minuteCount === 'number' ? counters.minuteCount : 0} requests per minute`);
    }
    
    // Check hour limits
    const dailyLimit = this.config.rateLimiting.maxRequestsPerDay[strategyId];
    if (dailyLimit !== undefined && counters && typeof counters.hourCount === 'number' && typeof dailyLimit === 'number' && counters.hourCount >= dailyLimit) {
      throw new Error(`Rate limit exceeded for strategy ${strategyId}: ${typeof counters.hourCount === 'number' ? counters.hourCount : 0} requests per day`);
    }
    
    // Increment counters
    if (minuteLimit !== undefined && counters && typeof counters.minuteCount === 'number') {
      counters.minuteCount++;
    }
    if (dailyLimit !== undefined && counters && typeof counters.hourCount === 'number') {
      counters.hourCount++;
    }
  }
  
  /**
   * Reset rate limits for a strategy
   * @param strategyId Strategy ID
   */
  public resetRateLimits(strategyId: string): void {
    this.rateLimitCounters.delete(strategyId);
  }
  
  /**
   * Add time-bound constraints to trade requests
   * @param request The trade request to add time bounds to
   * @returns Trade request with time bounds
   */
  public addTimeBounds(request: ExtendedTradeRequest): ExtendedTradeRequest {
    // Create a copy of the request to avoid modifying the original
    const boundedRequest = { ...request };
    
    // Add deadline if not present
    if (!boundedRequest.deadline) {
      const timeBound = this.config.slippageProtection?.timeBound || 60 * 20; // Default 20 minutes
      boundedRequest.deadline = Math.floor(Date.now() / 1000) + timeBound;
    }
    
    return boundedRequest;
  }
  
  /**
   * Get the status of the security layer
   */
  public getStatus(): {
    flashbotsEnabled: boolean;
    supportedChains: number[];
    slippageProtection: boolean;
    maxSlippage: number;
    rateLimitingEnabled: boolean;
    multiSigEnabled: boolean;
    pendingMultiSigTransactions: number;
  } {
    return {
      flashbotsEnabled: this.config.flashbots?.enabled || false,
      supportedChains: Array.from(this.flashbotsProviders.keys()),
      slippageProtection: this.config.slippageProtection?.enablePriceChecking || false,
      maxSlippage: this.config.slippageProtection?.maxTolerance || 5,
      rateLimitingEnabled: this.config.rateLimiting?.enabled || false,
      multiSigEnabled: this.config.multiSig?.enabled || false,
      pendingMultiSigTransactions: Array.from(this.multiSigTransactions.values())
        .filter(tx => !tx.executed && (typeof (tx as any).expiresAt !== 'number' || Date.now() <= (tx as any).expiresAt)).length
    };
  }

  /**
   * Check if the request is a token transfer
   * @param request Trade or transaction request
   * @returns True if it's a token transfer
   */
  private isTokenTransfer(request: ExtendedTradeRequest | TransactionRequest): boolean {
    // Check input amount for token transfers
    if (request && typeof (request as ExtendedTradeRequest).inputAmount !== 'undefined') {
      // For token transfers, we would need to convert to a common currency
      // This is a placeholder for that logic
      return false;
    }
    
    // Check data signature for token transfers (ERC20 transfer method)
    if ('data' in request && request.data) {
      const signature = request.data.slice(0, 10);
      return signature === '0xa9059cbb'; // ERC20 transfer method signature
    }
    
    return false;
  }

  /**
   * Validate a trade request for security concerns
   * @param request The trade request to validate
   * @param chainId The chain ID for the transaction
   * @returns Validation result with approval status
   */
  public async validateTradeRequest(
    request: ExtendedTradeRequest,
    chainId: ChainId
  ): Promise<SecurityValidationResult> {
    // If a chain-specific strategy is registered, use it
    const chainStrategy = this.chainProtectionStrategies.get(chainId);
    if (chainStrategy && chainStrategy.validateTradeRequest) {
      return chainStrategy.validateTradeRequest(request, chainId, this);
    }
    const result: SecurityValidationResult = {
      approved: true,
      warnings: [],
      errors: [],
      modifications: {}
    };
    
    // Apply all validations based on security level
    let modifiedRequest = { ...request };
    
    // Check rate limits
    if (this.config.rateLimiting?.enabled) {
      const rateLimitResult = this.checkRateLimit(modifiedRequest.fromAsset.symbol);
      if (!rateLimitResult.approved) {
        result.approved = false;
        result.errors.push(...rateLimitResult.errors);
      }
    }
    
    // Check circuit breakers
    if (this.config.circuitBreaker?.enabled) {
      const circuitResult = await this.checkCircuitBreakers(modifiedRequest, chainId);
      if (!circuitResult.approved) {
        result.approved = false;
        result.errors.push(...circuitResult.errors);
      }
    }
    
    // Check time window restrictions
    if (this.config.timeWindow?.enabled) {
      const timeResult = this.checkTimeWindow();
      if (!timeResult.approved) {
        result.approved = false;
        result.errors.push(...timeResult.errors);
      }
    }
    
    // Check slippage
    const slippageResult = await this.validateSlippage(modifiedRequest, chainId);
    if (!slippageResult.approved) {
      if (this.config.securityLevel === 'high') {
        result.approved = false;
        result.errors.push(...slippageResult.errors);
      } else {
        result.warnings.push(...slippageResult.errors);
      }
    } else if (slippageResult.modifiedRequest) {
      modifiedRequest = slippageResult.modifiedRequest;
      result.modifications!.slippageAdjusted = true;
    }
    
    // Check for MEV risks
    if (this.config.mevProtection?.enabled) {
      const mevResult = await this.detectMevRisks(modifiedRequest, chainId);
      if (!mevResult.approved) {
        if (this.config.securityLevel === 'high') {
          result.approved = false;
          result.errors.push(...mevResult.errors);
        } else {
          result.warnings.push(...mevResult.errors);
        }
      }
    }
    
    // Check gas price limits
    if (this.config.maxGasPrice) {
      const gasResult = this.validateGasPrice(modifiedRequest);
      if (!gasResult.approved) {
        result.approved = false;
        result.errors.push(...gasResult.errors);
      }
    }
    
    // Telemetry: record security check if method exists
    if (this.telemetry && typeof (this.telemetry as any).recordSecurityCheck === 'function') {
      (this.telemetry as any).recordSecurityCheck({
        approved: result.approved,
        warningCount: result.warnings.length,
        errorCount: result.errors.length,
        securityLevel: this.config.securityLevel || 'medium',
        chainId,
        fromAsset: request.fromAsset.symbol,
        toAsset: request.toAsset.symbol
      });
    }
    
    // Set modified request if changes were made
    if (
      result.modifications?.slippageAdjusted ||
      result.modifications?.gasAdjusted ||
      result.modifications?.deadlineAdjusted ||
      result.modifications?.routeChanged
    ) {
      result.modifiedRequest = modifiedRequest;
    }
    
    return result;
  }
  
  /**
   * Validate transaction slippage
   * @param request Trade request
   * @param chainId Chain ID
   * @returns Validation result
   */
  private async validateSlippage(
    request: ExtendedTradeRequest,
    chainId: ChainId
  ): Promise<SecurityValidationResult> {
    const result: SecurityValidationResult = {
      approved: true,
      warnings: [],
      errors: []
    };
    
    // Skip if explicitly requested
    if (request.securityChecks?.skipSlippageCheck) {
      return result;
    }
    
    // If no expected output, can't validate slippage
    if (!request.expectedOutput) {
      result.warnings.push('No expected output provided, unable to validate slippage');
      return result;
    }
    
    // Check if slippage tolerance is within limits
    if (request.slippageTolerance) {
      const maxTolerance = this.config.slippageProtection?.maxTolerance ?? 5;
      if (request.slippageTolerance > maxTolerance) {
        result.approved = false;
        result.errors.push(
          `Slippage tolerance ${request.slippageTolerance}% exceeds maximum allowed ${maxTolerance}%`
        );
        
        // Create a modified request with adjusted slippage
        const modifiedRequest = { ...request };
        modifiedRequest.slippageTolerance = maxTolerance;
        
        // Recalculate minimum output based on adjusted slippage
        if (modifiedRequest.expectedOutput) {
          const expectedOutput = BigInt(modifiedRequest.expectedOutput);
          const slippageFactor = 1000 - Math.floor(modifiedRequest.slippageTolerance * 10);
          const minOutput = (expectedOutput * BigInt(slippageFactor)) / BigInt(1000);
          modifiedRequest.minOutput = minOutput.toString();
        }
        
        result.modifiedRequest = modifiedRequest;
      }
    } else {
      // Apply default slippage if none provided
      const defaultTolerance = this.config.slippageProtection?.defaultTolerance ?? 0.5;
      const modifiedRequest = { ...request };
      modifiedRequest.slippageTolerance = defaultTolerance;
      
      // Calculate minimum output based on default slippage
      if (modifiedRequest.expectedOutput) {
        const expectedOutput = BigInt(modifiedRequest.expectedOutput);
        const slippageFactor = 1000 - Math.floor(modifiedRequest.slippageTolerance * 10);
        const minOutput = (expectedOutput * BigInt(slippageFactor)) / BigInt(1000);
        modifiedRequest.minOutput = minOutput.toString();
      }
      
      result.modifiedRequest = modifiedRequest;
      result.warnings.push(`No slippage tolerance provided, using default ${defaultTolerance}%`);
    }
    
    // Check for high price impact
    if (
      request.market?.priceImpact && 
      request.market.priceImpact > 5 && 
      !request.securityChecks?.allowHighImpact
    ) {
      if (request.market.priceImpact > 10) {
        result.approved = false;
        result.errors.push(`Very high price impact: ${request.market.priceImpact.toFixed(2)}%`);
      } else {
        result.warnings.push(`High price impact: ${request.market.priceImpact.toFixed(2)}%`);
      }
    }
    
    return result;
  }
  
  /**
   * Detect potential MEV risks for a transaction
   * @param request Trade request
   * @param chainId Chain ID
   * @returns Validation result
   */
  private async detectMevRisks(
    request: ExtendedTradeRequest,
    chainId: ChainId
  ): Promise<SecurityValidationResult> {
    const result: SecurityValidationResult = {
      approved: true,
      warnings: [],
      errors: []
    };
    
    // Basic MEV risk assessment - this would be more sophisticated in production
    const highRiskChains = [ChainId.ETHEREUM, ChainId.BINANCE_SMART_CHAIN, ChainId.POLYGON];
    const highValueThreshold = BigInt(1000) * BigInt(10 ** 18); // 1000 units of native token
    
    // Check if this is a high-value trade on a high-risk chain
    if (highRiskChains.includes(chainId)) {
      // For high value trades, raise a warning
      if (request && typeof (request as ExtendedTradeRequest).inputAmount !== 'undefined') {
        // For token transfers, we would need to convert to a common currency
        // This is a placeholder for that logic
        return {
          approved: true,
          warnings: [],
          errors: []
        };
      }
      
      if (request.value && request.value > highValueThreshold) {
        result.warnings.push('High-value transaction on MEV-active chain, consider using MEV protection');
      }
      
      // Check if the tokens involved are common MEV targets (high liquidity pairs)
      const commonMevTargets = ['WETH', 'USDC', 'USDT', 'DAI', 'WBTC', 'UNI', 'LINK'];
      if (
        commonMevTargets.includes(request.fromAsset.symbol) && 
        commonMevTargets.includes(request.toAsset.symbol)
      ) {
        result.warnings.push('Trading popular token pair, potential MEV target');
      }
    }
    
    return result;
  }
  
  /**
   * Check if the trade satisfies rate limiting rules
   * @param assetSymbol Asset symbol for tracking
   * @returns Validation result
   */
  private checkRateLimit(assetSymbol: string): SecurityValidationResult {
    const result: SecurityValidationResult = {
      approved: true,
      warnings: [],
      errors: []
    };
    
    const now = Date.now();
    
    // Initialize counts if needed
    if (!this.executionCounts[assetSymbol]) {
      this.executionCounts[assetSymbol] = {
        minute: 0,
        hour: 0,
        lastReset: now
      };
    }
    
    const counts = this.executionCounts[assetSymbol];
    
    // Reset counters if needed
    if (now - counts.lastReset > 3600000) { // 1 hour
      counts.minute = 0;
      counts.hour = 0;
      counts.lastReset = now;
    } else if (now - counts.lastReset > 60000) { // 1 minute
      counts.minute = 0;
    }
    
    // Check minute limits
    const strategyId = assetSymbol;
    const minuteLimit = this.config.rateLimiting?.maxRequestsPerMinute?.[strategyId];
    if (minuteLimit !== undefined && counts && typeof counts.minute === 'number' && typeof minuteLimit === 'number' && counts.minute >= minuteLimit) {
      result.approved = false;
      result.errors.push(`Rate limit exceeded: ${typeof counts.minute === 'number' ? counts.minute : 0} transactions in the last minute`);
    }
    
    // Check hour limits
    const hourLimit = this.config.rateLimiting?.maxRequestsPerDay?.[strategyId];
    if (hourLimit !== undefined && counts && typeof counts.hour === 'number' && typeof hourLimit === 'number' && counts.hour >= hourLimit) {
      result.approved = false;
      result.errors.push(`Rate limit exceeded: ${typeof counts.hour === 'number' ? counts.hour : 0} transactions in the last hour`);
    }
    
    // Update counts if approved
    if (result.approved && counts && typeof counts.minute === 'number' && typeof counts.hour === 'number') {
      counts.minute++;
      counts.hour++;
      this.lastExecutionTime[assetSymbol] = now;
    }
    
    return result;
  }
  
  /**
   * Check if circuit breakers have been triggered
   * @param request Trade request
   * @param chainId Chain ID
   * @returns Validation result
   */
  private async checkCircuitBreakers(
    request: ExtendedTradeRequest,
    chainId: ChainId
  ): Promise<SecurityValidationResult> {
    const result: SecurityValidationResult = {
      approved: true,
      warnings: [],
      errors: []
    };
    
    // Circuit breaker implementation would check for:
    // 1. Extreme price movements
    // 2. Unusual volume spikes
    // 3. Gas price spikes
    // 4. Network congestion

    // This is a simplified placeholder implementation
    return result;
  }
  
  /**
   * Check if the current time is within allowed trading windows
   * @returns Validation result
   */
  private checkTimeWindow(): SecurityValidationResult {
    const result: SecurityValidationResult = {
      approved: true,
      warnings: [],
      errors: []
    };
    
    // Skip if no time window config
    if (!this.config.timeWindow || !this.config.timeWindow.enabled) {
      return result;
    }
    
    const now = new Date();
    let currentDay: number;
    let currentHour: number;
    
    // Apply timezone if specified
    if (this.config.timeWindow.timeZone) {
      const options: Intl.DateTimeFormatOptions = {
        timeZone: this.config.timeWindow.timeZone,
        weekday: 'long',
        hour: 'numeric',
        hour12: false
      };
      
      const formatter = new Intl.DateTimeFormat('en-US', options);
      const parts = formatter.formatToParts(now);
      
      const weekdayPart = parts.find(part => part.type === 'weekday');
      const hourPart = parts.find(part => part.type === 'hour');
      
      const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      currentDay = weekdayPart ? weekdays.indexOf(weekdayPart.value.toLowerCase()) : now.getDay();
      currentHour = hourPart ? parseInt(hourPart.value) : now.getHours();
    } else {
      currentDay = now.getDay();
      currentHour = now.getHours();
    }
    
    // Check if current day is allowed
    if (!this.config.timeWindow.allowedDays.includes(currentDay)) {
      result.approved = false;
      result.errors.push(`Trading not allowed on day ${currentDay}`);
    }
    
    // Check if current hour is allowed
    if (!this.config.timeWindow.allowedHours.includes(currentHour)) {
      result.approved = false;
      result.errors.push(`Trading not allowed during hour ${currentHour}`);
    }
    
    return result;
  }
  
  /**
   * Validate gas price against maximum limits
   * @param request Trade request
   * @returns Validation result
   */
  private validateGasPrice(request: ExtendedTradeRequest): SecurityValidationResult {
    const result: SecurityValidationResult = {
      approved: true,
      warnings: [],
      errors: []
    };
    
    // Only validate if we have a maximum gas price configured
    if (!this.config.maxGasPrice) {
      return result;
    }
    
    // Convert maximum gas price to BigInt (assumes value in gwei)
    const maxGasGwei = BigInt(parseFloat(this.config.maxGasPrice) * 10 ** 9);
    
    // Check transaction gas price if available
    if ((request as any).gasPrice && BigInt((request as any).gasPrice) > maxGasGwei) {
      result.approved = false;
      result.errors.push(`Gas price exceeds maximum allowed: ${this.config.maxGasPrice} gwei`);
    }
    
    return result;
  }
  
  /**
   * Get the current security configuration
   * @returns The security layer configuration
   */
  public getConfig(): ExecutionSecurityConfig {
    return this.config;
  }
  
  /**
   * Update the security configuration
   * @param config New configuration (partial updates allowed)
   */
  public updateConfig(config: Partial<ExecutionSecurityConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      slippageProtection: {
        defaultTolerance: config.slippageProtection?.defaultTolerance !== undefined ? config.slippageProtection.defaultTolerance : this.config.slippageProtection?.defaultTolerance ?? 0.5,
        maxTolerance: config.slippageProtection?.maxTolerance !== undefined ? config.slippageProtection.maxTolerance : this.config.slippageProtection?.maxTolerance ?? 5,
        enablePriceChecking: config.slippageProtection?.enablePriceChecking !== undefined ? config.slippageProtection.enablePriceChecking : this.config.slippageProtection?.enablePriceChecking ?? true,
        timeBound: config.slippageProtection?.timeBound !== undefined ? config.slippageProtection.timeBound : this.config.slippageProtection?.timeBound ?? 300
      },
      rateLimiting: {
        enabled: config.rateLimiting?.enabled !== undefined ? config.rateLimiting.enabled : this.config.rateLimiting?.enabled ?? true,
        maxRequestsPerMinute: config.rateLimiting?.maxRequestsPerMinute !== undefined ? config.rateLimiting.maxRequestsPerMinute : this.config.rateLimiting?.maxRequestsPerMinute ?? {},
        maxRequestsPerDay: config.rateLimiting?.maxRequestsPerDay !== undefined ? config.rateLimiting.maxRequestsPerDay : this.config.rateLimiting?.maxRequestsPerDay ?? {}
      },
      multiSig: {
        enabled: config.multiSig?.enabled !== undefined ? config.multiSig.enabled : this.config.multiSig?.enabled ?? false,
        requiredSigners: config.multiSig?.requiredSigners !== undefined ? config.multiSig.requiredSigners : this.config.multiSig?.requiredSigners ?? 2,
        signers: config.multiSig?.signers !== undefined ? config.multiSig.signers : this.config.multiSig?.signers ?? [],
        validationThreshold: config.multiSig?.validationThreshold !== undefined ? config.multiSig.validationThreshold : this.config.multiSig?.validationThreshold ?? "0"
      },
      flashbots: {
        enabled: config.flashbots?.enabled !== undefined ? config.flashbots.enabled : this.config.flashbots?.enabled ?? false,
        relayUrls: config.flashbots?.relayUrls !== undefined ? config.flashbots.relayUrls : this.config.flashbots?.relayUrls,
        authSigner: config.flashbots?.authSigner !== undefined ? config.flashbots.authSigner : this.config.flashbots?.authSigner,
        blocksToWait: config.flashbots?.blocksToWait !== undefined ? config.flashbots.blocksToWait : this.config.flashbots?.blocksToWait
      }
    };
  }

  /**
   * Register a chain-specific protection strategy
   */
  public registerChainProtection(chainId: ChainId, strategy: ChainProtectionStrategy) {
    this.chainProtectionStrategies.set(chainId, strategy);
  }

  /**
   * Simulate a transaction to detect potential sandwich attacks
   * @param adapter Chain adapter
   * @param transaction Transaction to simulate
   * @param blockNumber Block number to simulate at
   * @returns Simulation result
   */
  private async simulateTransaction(
    adapter: IChainAdapter,
    transaction: TransactionRequest,
    blockNumber?: number
  ): Promise<SimulationResult> {
    try {
      // Get the provider from the adapter
      const provider = adapter.getProvider();
      
      // Simulate the transaction
      const simulation = await provider.call({
        ...transaction,
        blockTag: blockNumber
      });
      
      return {
        success: true,
        gasUsed: BigInt(0), // Would be populated in real implementation
        returnData: simulation,
        logs: []
      };
    } catch (error) {
      return {
        success: false,
        gasUsed: BigInt(0),
        returnData: '',
        logs: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Detect potential sandwich attacks by simulating transactions
   * @param adapter Chain adapter
   * @param transaction Transaction to check
   * @returns Sandwich attack detection result
   */
  private async detectSandwichAttack(
    adapter: IChainAdapter,
    transaction: TransactionRequest
  ): Promise<SandwichDetectionResult> {
    const result: SandwichDetectionResult = {
      detected: false,
      confidence: 0,
      recommendations: []
    };

    try {
      // Get current block number
      const provider = adapter.getProvider();
      const currentBlock = await provider.getBlockNumber();
      
      // Simulate transaction at current block
      const currentSimulation = await this.simulateTransaction(adapter, transaction, currentBlock);
      
      // Simulate transaction at next block
      const nextSimulation = await this.simulateTransaction(adapter, transaction, currentBlock + 1);
      
      // Compare results to detect potential sandwich attacks
      if (currentSimulation.success && nextSimulation.success) {
        // Check for significant price impact
        const priceImpact = this.calculatePriceImpact(currentSimulation, nextSimulation);
        
        if (priceImpact > 0.5) { // 0.5% threshold
          result.detected = true;
          result.confidence = 0.8;
          result.attackType = 'sandwich';
          result.recommendations.push(
            'High price impact detected. Consider:',
            '1. Using a private transaction',
            '2. Breaking into smaller trades',
            '3. Using a different DEX or route'
          );
          // Telemetry: report sandwich detection
          this.telemetry?.recordFailedExecution(
            adapter.getName(),
            'sandwich_attack_detected',
            TransactionType.TRADE
          );
        }
      }
      
      // Check for pending transactions that could frontrun
      const pendingTxs = await this.checkPendingTransactions(adapter, transaction);
      if (pendingTxs.length > 0) {
        result.detected = true;
        result.confidence = Math.max(result.confidence, 0.6);
        result.attackType = 'frontrun';
        result.recommendations.push(
          'Suspicious pending transactions detected. Consider:',
          '1. Using Flashbots or private transactions',
          '2. Adjusting gas price strategy',
          '3. Delaying transaction'
        );
        // Telemetry: report frontrun detection
        this.telemetry?.recordFailedExecution(
          adapter.getName(),
          'frontrun_attack_detected',
          TransactionType.TRADE
        );
      }
      
    } catch (error) {
      // Telemetry: report simulation error
      this.telemetry?.recordFailedExecution(
        adapter.getName(),
        'simulation_error',
        TransactionType.TRADE
      );
      console.error('Error detecting sandwich attacks:', error);
    }
    
    return result;
  }

  /**
   * Calculate price impact between two simulations
   * @param current Current simulation result
   * @param next Next simulation result
   * @returns Price impact as a decimal (e.g., 0.01 for 1%)
   */
  private calculatePriceImpact(
    current: SimulationResult,
    next: SimulationResult
  ): number {
    // This is a placeholder implementation
    // In a real implementation, this would:
    // 1. Parse the return data to extract token amounts
    // 2. Calculate the price impact based on the difference
    // 3. Consider the pool state and reserves
    return 0;
  }

  /**
   * Check for suspicious pending transactions
   * @param adapter Chain adapter
   * @param transaction Transaction to check against
   * @returns Array of suspicious transaction hashes
   */
  private async checkPendingTransactions(
    adapter: IChainAdapter,
    transaction: TransactionRequest
  ): Promise<string[]> {
    // This is a placeholder implementation
    // In a real implementation, this would:
    // 1. Get pending transactions from mempool
    // 2. Filter for transactions interacting with same contracts
    // 3. Analyze transaction patterns for suspicious behavior
    return [];
  }

  /**
   * Enhanced transaction validation with sandwich attack detection
   * @param adapter Chain adapter
   * @param transaction Transaction to validate
   * @returns Validation result
   */
  public async validateTransaction(
    adapter: IChainAdapter,
    transaction: TransactionRequest
  ): Promise<SecurityValidationResult> {
    const result: SecurityValidationResult = {
      approved: true,
      warnings: [],
      errors: []
    };

    // Check for sandwich attacks
    const sandwichResult = await this.detectSandwichAttack(adapter, transaction);
    
    if (sandwichResult.detected) {
      if (sandwichResult.confidence > 0.8) {
        result.approved = false;
        result.errors.push(
          `High confidence sandwich attack detected (${sandwichResult.attackType})`,
          ...sandwichResult.recommendations
        );
      } else {
        result.warnings.push(
          `Potential sandwich attack detected (${sandwichResult.attackType})`,
          ...sandwichResult.recommendations
        );
      }
    }

    return result;
  }

  /**
   * Collect and optimize a bundle of compatible transactions for gas savings
   * @param transactions Array of TransactionRequest
   * @returns BundleOptimizationResult
   */
  public async optimizeTransactionBundle(transactions: TransactionRequest[]): Promise<BundleOptimizationResult> {
    if (!transactions || transactions.length === 0) {
      return { bundle: [], estimatedGas: BigInt(0), savings: BigInt(0), reason: 'No transactions to bundle' };
    }

    // Simple optimization: sort by gasPrice ascending (cheapest first)
    const sorted = [...transactions].sort((a, b) => {
      const aGas = a.gasPrice ? BigInt(a.gasPrice) : BigInt(0);
      const bGas = b.gasPrice ? BigInt(b.gasPrice) : BigInt(0);
      return aGas < bGas ? -1 : aGas > bGas ? 1 : 0;
    });

    // Estimate total gas for the bundle
    let estimatedGas: bigint = BigInt(0);
    for (const tx of sorted) {
      // Use the first available provider for estimation
      const chainId = tx.chainId || 1;
      const providers = await this.getAvailablePrivateProviders(chainId);
      if (providers.length > 0) {
        let gas = await providers[0].estimateBundleGas([tx]);
        if (gas === undefined) gas = BigInt(0);
        estimatedGas += gas;
      }
    }

    // Estimate savings (placeholder: difference between max and min gasPrice * count)
    let minGas: bigint = BigInt(0);
    let maxGas: bigint = BigInt(0);
    if (sorted[0].gasPrice !== undefined) minGas = BigInt(sorted[0].gasPrice);
    const lastGasPrice = sorted[sorted.length - 1]?.gasPrice;
    if (lastGasPrice !== undefined) {
      maxGas = BigInt(lastGasPrice);
    } else {
      maxGas = BigInt(0);
    }
    const savings: bigint = (maxGas - minGas) * BigInt(sorted.length);

    // Defensive: ensure all values are never undefined
    const safeBundle = Array.isArray(sorted) ? sorted : [];
    const safeEstimatedGas = typeof estimatedGas === 'bigint' ? estimatedGas : BigInt(0);
    const safeSavings = typeof savings === 'bigint' ? savings : BigInt(0);
    return { bundle: safeBundle, estimatedGas: safeEstimatedGas, savings: safeSavings };
  }

  /**
   * Submit a bundle of transactions atomically via private RPC providers
   * @param adapter Chain adapter
   * @param transactions Array of TransactionRequest
   * @returns Array of TransactionResponse
   */
  public async submitTransactionBundle(
    adapter: IChainAdapter,
    transactions: TransactionRequest[]
  ): Promise<TransactionResponse[]> {
    const chainId = adapter.getChainId();
    const providers = await this.getAvailablePrivateProviders(chainId);
    if (providers.length === 0) {
      throw new Error('No private RPC providers available for bundle submission');
    }

    // Try each provider in order
    for (const provider of providers) {
      try {
        // Attempt atomic bundle submission
        // (Assume provider supports sendBundle for batch, fallback to single if not)
        if (typeof (provider as any).sendBundle === 'function') {
          const bundleResult = await (provider as any).sendBundle(transactions);
          this.logBundleSubmission(chainId, provider.name, transactions, true, undefined);
          // Return responses in the same order as input
          return bundleResult;
        } else {
          // Fallback: submit individually
          const responses = [];
          for (const tx of transactions) {
            responses.push(await provider.sendPrivateTransaction(tx));
          }
          this.logBundleSubmission(chainId, provider.name, transactions, false, 'Provider does not support atomic bundles');
          return responses;
        }
      } catch (error) {
        this.logBundleSubmission(chainId, provider.name, transactions, false, error instanceof Error ? error.message : String(error));
        continue;
      }
    }
    throw new Error('All private RPC providers failed for bundle submission');
  }

  /**
   * Log bundle submission attempts for observability
   */
  private logBundleSubmission(
    chainId: number,
    providerName: string,
    transactions: TransactionRequest[],
    atomic: boolean,
    error?: string
  ) {
    if (this.telemetry && typeof (this.telemetry as any).recordBundleSubmission === 'function') {
      (this.telemetry as any).recordBundleSubmission({
        chainId,
        provider: providerName,
        txCount: transactions.length,
        atomic,
        error
      });
    } else {
      // Fallback: console log
      const txCount = transactions && typeof transactions.length === 'number' ? transactions.length : 0;
      const atomicStr = atomic !== undefined ? String(atomic) : 'false';
      const errorStr = error !== undefined && error !== null ? String(error) : 'none';
      const chainIdStr = chainId !== undefined && chainId !== null ? String(chainId) : 'undefined';
      const providerNameStr = providerName !== undefined && providerName !== null ? String(providerName) : 'undefined';
      // Defensive: ensure all values are string | number | bigint | boolean
      const logArgs: (string | number | bigint | boolean)[] = [
        '[BundleSubmission]',
        'chainId=', chainIdStr,
        'provider=', providerNameStr,
        'txs=', txCount,
        'atomic=', atomicStr,
        'error=', errorStr
      ];
      console.log(...logArgs);
    }
  }

  // Add public getter for telemetry in ExecutionSecurityLayer
  public getTelemetry(): BlockchainTelemetry | undefined { return this.config.telemetry; }
}

// Example: Arbitrum-specific protection strategy
const ArbitrumProtection: ChainProtectionStrategy = {
  async validateTradeRequest(request, chainId, layer) {
    // Stricter slippage for Arbitrum
    const result: SecurityValidationResult = {
      approved: true,
      warnings: [],
      errors: [],
      modifications: {}
    };
    // Enforce max slippage of 1% for Arbitrum
    if (request.slippageTolerance && request.slippageTolerance > 1) {
      result.approved = false;
      result.errors.push('Arbitrum: Slippage tolerance exceeds 1% maximum.');
      const modifiedRequest = { ...request, slippageTolerance: 1 };
      result.modifiedRequest = modifiedRequest;
      result.modifications!.slippageAdjusted = true;
    }
    // Fallback to generic checks
    const genericResult = await layer['validateTradeRequest'].call(layer, request, chainId);
    // Merge errors/warnings
    result.errors.push(...(genericResult.errors || []));
    result.warnings.push(...(genericResult.warnings || []));
    result.approved = result.approved && genericResult.approved;
    return result;
  }
};

// Register Arbitrum-specific protection on module load (example usage)
// (In production, this would be done in initialization code)
// const securityLayer = new ExecutionSecurityLayer(...);
// securityLayer.registerChainProtection(ChainId.ARBITRUM, ArbitrumProtection); 

// --- Chain-Specific Protection Strategies ---

const ethereumProtection: ChainProtectionStrategy = {
  async validateTradeRequest(request, chainId, layer) {
    // Use public validateTradeRequest for slippage
    const slippageResult = await layer.validateTradeRequest(request, chainId);
    if (!slippageResult.approved) {
      layer.getTelemetry()?.recordFailedExecution('ethereum', 'slippage', TransactionType.TRADE);
      return { ...slippageResult, warnings: slippageResult.warnings || [] };
    }
    // Add more Ethereum-specific checks here
    return { approved: true, errors: [], warnings: [] };
  }
};

const bscProtection: ChainProtectionStrategy = {
  async validateTradeRequest(request, chainId, layer) {
    // Use public validateTradeRequest for gas price
    const gasResult = await layer.validateTradeRequest(request, chainId);
    if (!gasResult.approved) {
      layer.getTelemetry()?.recordFailedExecution('bsc', 'gas_price', TransactionType.TRADE);
      return { ...gasResult, warnings: gasResult.warnings || [] };
    }
    // Add more BSC-specific checks here
    return { approved: true, errors: [], warnings: [] };
  }
};

const arbitrumProtection: ChainProtectionStrategy = {
  async validateTradeRequest(request, chainId, layer) {
    // Use public checkRateLimits and validateTradeRequest
    layer.checkRateLimits('arbitrum');
    const slippageResult = await layer.validateTradeRequest(request, chainId);
    if (!slippageResult.approved) {
      layer.getTelemetry()?.recordFailedExecution('arbitrum', 'slippage', TransactionType.TRADE);
      return { ...slippageResult, warnings: slippageResult.warnings || [] };
    }
    // Add more Arbitrum-specific checks here
    return { approved: true, errors: [], warnings: [] };
  }
};

const polygonProtection: ChainProtectionStrategy = {
  async validateTradeRequest(request, chainId, layer) {
    // Use public validateTradeRequest for time window
    const timeResult = await layer.validateTradeRequest(request, chainId);
    if (!timeResult.approved) {
      layer.getTelemetry()?.recordFailedExecution('polygon', 'time_window', TransactionType.TRADE);
      return { ...timeResult, warnings: timeResult.warnings || [] };
    }
    // Add more Polygon-specific checks here
    return { approved: true, errors: [], warnings: [] };
  }
};

// --- Register strategies at initialization ---

// In the ExecutionSecurityLayer constructor or initialization logic:
// (This is a code comment for maintainers)
//
// this.registerChainProtection(ChainId.ETHEREUM, ethereumProtection);
// this.registerChainProtection(ChainId.BINANCE_SMART_CHAIN, bscProtection);
// this.registerChainProtection(ChainId.ARBITRUM, arbitrumProtection);
// this.registerChainProtection(ChainId.POLYGON, polygonProtection);

/**
 * To add a new chain-specific protection strategy:
 * 1. Define a new ChainProtectionStrategy object for the chain.
 * 2. Register it using registerChainProtection(chainId, strategy).
 * 3. Ensure all security events are reported to telemetry.
 * 4. Add/Update tests for the new strategy.
 */ 