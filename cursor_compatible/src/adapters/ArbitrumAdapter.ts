/**
 * ArbitrumAdapter - Implementation of IChainAdapter for Arbitrum network
 * 
 * Provides specialized handling for Arbitrum's L2 rollup with sequencer awareness
 * and optimized gas handling for the network.
 */

import { BaseChainAdapter, ChainAdapterConfig } from './BaseChainAdapter';
import { 
  AdapterCapability, 
  Asset, 
  ChainId,
  GasEstimate, 
  Network,
  NetworkStatus,
  TradeOrder,
  TradeRequest,
  TradeOptions,
  TradeResult, 
  TransactionRequest, 
  TransactionResponse,
  TransactionReceipt,
  MevProtectionConfig,
  FeeData
} from './IChainAdapter';
import { BlockchainTelemetry } from './telemetry/BlockchainTelemetry';
import { CircuitBreaker, CircuitBreakerConfig, CircuitBreakerState } from './telemetry/CircuitBreaker';

/**
 * Arbitrum-specific adapter configuration
 */
export interface ArbitrumAdapterConfig extends ChainAdapterConfig {
  sequencerStatusUrl?: string;
  rpcUrls?: string[]; // List of fallback RPC endpoints
  maxRetries?: number;
  telemetry?: BlockchainTelemetry;
  circuitBreakerConfig?: CircuitBreakerConfig;
}

/**
 * Arbitrum adapter implementation
 */
export class ArbitrumAdapter extends BaseChainAdapter {
  // Arbitrum-specific configuration
  private arbitrumConfig: ArbitrumAdapterConfig;
  
  // Track gas prices for optimization
  private lastGasPrice: bigint = BigInt(0);
  private lastGasPriceTimestamp: number = 0;
  private gasPriceValidityPeriod: number = 10000; // 10 seconds
  
  // Sequencer health tracking
  private sequencerHealthy: boolean = true;
  
  // Wallet and provider
  protected wallet: any; // Wallet instance (ethers.Wallet)
  protected provider: any; // Provider instance (ethers.providers.Provider)
  
  private rpcUrls: string[];
  private currentRpcIndex: number = 0;
  private maxRetries: number;
  private retryBaseDelay: number = 500; // ms
  
  // Telemetry for observability
  private telemetry?: BlockchainTelemetry;
  
  private circuitBreaker: CircuitBreaker;
  
  /**
   * Constructor for Arbitrum adapter
   */
  constructor(config: ArbitrumAdapterConfig) {
    // Accept both rpcUrl and rpcUrls for backward compatibility
    const rpcUrls = config.rpcUrls && config.rpcUrls.length > 0
      ? config.rpcUrls
      : (config.rpcUrl ? [config.rpcUrl] : []);
    super({
      ...config,
      rpcUrl: rpcUrls[0] || '',
    });
    
    this.arbitrumConfig = config;
    this.rpcUrls = rpcUrls;
    this.maxRetries = config.maxRetries || 3;
    this._name = 'ArbitrumAdapter';
    this._version = '1.0.0';
    
    // Initialize circuit breaker with config or defaults
    this.circuitBreaker = new CircuitBreaker(config.circuitBreakerConfig || {});
    
    if (config.telemetry) {
      this.telemetry = config.telemetry;
    }
    
    // Add Arbitrum-specific capabilities
    this.addCapability(AdapterCapability.TRADE_EXECUTION);
    this.addCapability(AdapterCapability.FEE_MARKET);
    this.addCapability(AdapterCapability.TOKEN_TRANSFER);
  }
  
  /**
   * Implementation-specific initialization
   */
  protected async initializeImpl(): Promise<void> {
    try {
      // Initialize wallet and provider
      // Code to set up ethers provider and wallet
      
      // Check sequencer status
      await this.checkSequencerStatus();
      
      this.logInfo("Arbitrum adapter initialized successfully");
    } catch (error) {
      this.logError("Failed to initialize Arbitrum adapter", error);
      throw error;
    }
  }
  
  /**
   * Implementation for connecting to the Arbitrum network
   */
  protected async connectImpl(): Promise<void> {
    try {
      await this.provider.getBlockNumber();
      this.logInfo("Successfully connected to Arbitrum network");
    } catch (error) {
      this.logError("Failed to connect to Arbitrum network", error);
      throw error;
    }
  }
  
  /**
   * Implementation for disconnecting from the Arbitrum network
   */
  protected async disconnectImpl(): Promise<void> {
    try {
      // Perform cleanup operations
      // For instance, unsubscribe from any active subscriptions
      
      this.logInfo("Disconnected from Arbitrum network");
    } catch (error) {
      this.logError("Error disconnecting from Arbitrum network", error);
      throw error;
    }
  }
  
  /**
   * Implementation-specific shutdown
   */
  protected async shutdownImpl(): Promise<void> {
    try {
      // Additional teardown logic specific to Arbitrum
      
      this.logInfo("Arbitrum adapter shutdown successfully");
    } catch (error) {
      this.logError("Error during Arbitrum adapter shutdown", error);
      throw error;
    }
  }
  
  /**
   * Get the current status of the Arbitrum adapter
   */
  protected async getStatusImpl(): Promise<any> {
    try {
      const blockNumber = await this.getBlockNumber();
      const gasPrice = await this.getGasPrice();
      
      return {
        blockHeight: blockNumber,
        gasPrice: gasPrice.toString(),
        sequencerHealthy: this.sequencerHealthy
      };
    } catch (error) {
      this.logError("Failed to get adapter status", error);
      return {
        error: error instanceof Error ? error.message : String(error),
        sequencerHealthy: false
      };
    }
  }
  
  /**
   * Submit a raw transaction to the Arbitrum network
   */
  public async submitTransaction(signedTx: string, mevProtection?: boolean): Promise<string> {
    if (!this._isInitialized) {
      throw new Error("Adapter not initialized");
    }
    
    try {
      // Check sequencer health first
      if (!this.sequencerHealthy) {
        throw new Error("Arbitrum sequencer is not healthy, transaction may be delayed or fail");
      }
      
      // Submit transaction
      const tx = await this.provider.broadcastTransaction(signedTx);
      return tx.hash;
    } catch (error) {
      this.logError("Failed to submit transaction", error);
      throw error;
    }
  }
  
  /**
   * Calculate block delay compared to the canonical chain
   */
  protected async calculateBlockDelay(currentBlockHeight: number): Promise<number> {
    // For Arbitrum, we can check the delay by comparing with the L1 block
    // that the sequencer has processed
    try {
      const l1BlockNumber = await this.provider.send("eth_getBlockByNumber", ["latest", false]);
      
      // This is a simplified example, in a real implementation you would
      // need to calculate the expected L2 block based on the L1 block
      return 0; // Placeholder
    } catch (error) {
      this.logError("Failed to calculate block delay", error);
      return 0;
    }
  }
  
  /**
   * Reset the adapter to initial state
   */
  protected async resetImpl(): Promise<void> {
    this.lastGasPrice = BigInt(0);
    this.lastGasPriceTimestamp = 0;
    this.sequencerHealthy = true;
    
    // Re-check sequencer status
    await this.checkSequencerStatus();
  }
  
  /**
   * Implementation-specific MEV protection configuration
   */
  protected async configureMevProtectionImpl(config: MevProtectionConfig): Promise<void> {
    // Arbitrum has different MEV dynamics than Ethereum mainnet
    // Here we'd configure any Arbitrum-specific MEV protection
    if (!config.enabled) {
      this._mevProtectionEnabled = false;
      this.removeCapability(AdapterCapability.MEV_PROTECTION);
      return;
    }
    
    // Set up MEV protection
    this._mevProtectionEnabled = true;
    this.addCapability(AdapterCapability.MEV_PROTECTION);
  }
  
  /**
   * Get the balance of an address
   */
  public async getBalance(address: string, asset?: Asset): Promise<string> {
    if (!this._isInitialized) {
      throw new Error("Adapter not initialized");
    }
    
    return this.retryWithFailover(async () => {
      if (!asset || asset.isNative) {
        // Get native ETH balance
        const balance = await this.provider.getBalance(address);
        return balance.toString();
      } else {
        // Get token balance using contract call
        // This would use ethers.js Contract to call balanceOf
        return "0"; // Placeholder
      }
    }, 'getBalance');
  }
  
  /**
   * Execute a trade on Arbitrum
   */
  public async executeTrade(order: TradeOrder): Promise<TradeResult> {
    if (!this._isInitialized) {
      throw new Error("Adapter not initialized");
    }
    
    // Implementation here
    return {
      success: false,
      order,
      failureReason: "Not implemented",
      timestamp: Date.now()
    };
  }
  
  /**
   * Get a quote for a potential trade
   */
  public async getQuote(fromAsset: Asset, toAsset: Asset, amount: string): Promise<{
    expectedOutput: string;
    priceImpact: number;
    route?: string[];
  }> {
    if (!this._isInitialized) {
      throw new Error("Adapter not initialized");
    }
    
    // Implementation here
    return {
      expectedOutput: "0",
      priceImpact: 0
    };
  }
  
  /**
   * Get transaction status
   */
  public async getTransactionStatus(txHash: string): Promise<{
    status: 'pending' | 'confirmed' | 'failed';
    confirmations?: number;
    receipt?: TransactionReceipt;
  }> {
    if (!this._isInitialized) {
      throw new Error("Adapter not initialized");
    }
    
    try {
      const tx = await this.provider.getTransaction(txHash);
      
      if (!tx) {
        return { status: 'pending' };
      }
      
      const receipt = await this.provider.getTransactionReceipt(txHash);
      
      if (!receipt) {
        return { 
          status: 'pending',
          confirmations: tx.confirmations
        };
      }
      
      const status = receipt.status === 1 ? 'confirmed' : 'failed';
      
      return {
        status,
        confirmations: tx.confirmations,
        receipt: {
          txHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          from: receipt.from,
          to: receipt.to || '',
          status: status === 'confirmed' ? 'success' : 'failure',
          gasUsed: receipt.gasUsed.toString(),
          effectiveGasPrice: receipt.effectiveGasPrice.toString(),
          logs: receipt.logs,
          confirmations: tx.confirmations,
          rawReceipt: receipt
        }
      };
    } catch (error) {
      this.logError("Failed to get transaction status", error);
      throw error;
    }
  }
  
  /**
   * Get gas price on Arbitrum
   */
  public async getGasPrice(): Promise<GasEstimate> {
    if (!this._isInitialized) {
      throw new Error("Adapter not initialized");
    }
    return this.retryWithFailover(async () => {
      const feeDataRaw = await this.getFeeData();
      const feeData = this.normalizeFeeData(feeDataRaw);
      const gasPrice = feeData.gasPrice;
      const lastBaseFeePerGas = feeData.lastBaseFeePerGas;
      return {
        slow: {
          gasPrice: gasPrice ? gasPrice.toString() : undefined,
          estimatedTimeMs: 60000 // 1 minute
        },
        average: {
          gasPrice: gasPrice ? gasPrice.toString() : undefined,
          estimatedTimeMs: 30000 // 30 seconds
        },
        fast: {
          gasPrice: gasPrice ? (BigInt(gasPrice) * BigInt(11) / BigInt(10)).toString() : undefined,
          estimatedTimeMs: 15000 // 15 seconds
        },
        baseFee: lastBaseFeePerGas ? lastBaseFeePerGas.toString() : undefined,
        isEip1559Supported: true,
        lastUpdated: Date.now()
      };
    }, 'getGasPrice');
  }
  
  /**
   * Helper to normalize FeeData fields (convert null to undefined)
   */
  private normalizeFeeData(feeData: any): FeeData {
    return {
      gasPrice: feeData.gasPrice === null ? undefined : feeData.gasPrice,
      maxFeePerGas: feeData.maxFeePerGas === null ? undefined : feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas === null ? undefined : feeData.maxPriorityFeePerGas,
      lastBaseFeePerGas: feeData.lastBaseFeePerGas === null ? undefined : feeData.lastBaseFeePerGas
    };
  }
  
  /**
   * Get fee data for Arbitrum
   */
  public async getFeeData(): Promise<FeeData> {
    return this.retryWithFailover(async () => {
      const feeData = await this.provider.getFeeData();
      return this.normalizeFeeData(feeData);
    }, 'getFeeData');
  }
  
  /**
   * Estimate gas for a transaction
   */
  public async estimateGas(fromAddress: string, toAddress: string, data: string, value?: string): Promise<string> {
    if (!this.circuitBreaker.allowRequest()) {
      throw new Error('Circuit breaker is open: gas estimation temporarily disabled');
    }
    const startTime = Date.now();
    try {
      const tx: TransactionRequest = {
        from: fromAddress,
        to: toAddress,
        data,
        value: value ? BigInt(value) : undefined
      };
      const gasEstimate = await this.provider.estimateGas(tx);
      const multiplier = this.arbitrumConfig.gasMultiplier || 1.1;
      const adjusted = BigInt(Math.ceil(Number(gasEstimate) * multiplier));
      if (this.telemetry) {
        this.telemetry.recordGasEstimation(
          'arbitrum',
          tx.to?.toString() || 'contract_creation',
          adjusted,
          Date.now() - startTime
        );
      }
      this.circuitBreaker.recordSuccess();
      return adjusted.toString();
    } catch (error) {
      if (this.telemetry) {
        this.telemetry.recordFailedGasEstimation(
          'arbitrum',
          toAddress,
          error instanceof Error ? error.message : String(error)
        );
      }
      this.circuitBreaker.recordFailure();
      this.logError("Failed to estimate gas", error);
      throw error;
    }
  }
  
  /**
   * Check Arbitrum sequencer status
   */
  public async checkSequencerStatus(): Promise<boolean> {
    try {
      if (!this.arbitrumConfig.sequencerStatusUrl) {
        // If no status URL provided, assume healthy
        return true;
      }
      
      // Fetch sequencer status
      const response = await fetch(this.arbitrumConfig.sequencerStatusUrl);
      const data = await response.json();
      
      // Update sequencer health state
      this.sequencerHealthy = data.status === "ok";
      
      return this.sequencerHealthy;
    } catch (error) {
      this.logError("Failed to check sequencer status", error);
      // Default to assuming healthy to not block operations
      return true;
    }
  }
  
  /**
   * Get network status
   */
  public async getNetworkStatus(): Promise<NetworkStatus> {
    try {
      // Check sequencer health
      await this.checkSequencerStatus();
      
      const blockNumber = await this.getBlockNumber();
      const network = await this.provider.getNetwork();
      const feeData = await this.getFeeData();
      
      // Get latest block timestamp
      const block = await this.provider.getBlock("latest");
      const blockTime = this.calculateBlockTime(block.timestamp);
      
      return {
        networkName: this.config.networkName,
        chainId: this.config.chainId,
        isConnected: true,
        latestBlock: blockNumber,
        blockTime,
        gasPrice: feeData.gasPrice || BigInt(0),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        maxFeePerGas: feeData.maxFeePerGas,
        baseFeePerGas: feeData.lastBaseFeePerGas,
        congestion: this.calculateNetworkCongestion(feeData),
        timestamp: Date.now(),
        sequencerHealthy: this.sequencerHealthy
      };
    } catch (error) {
      this.logError("Failed to get network status", error);
      
      return {
        networkName: this.config.networkName,
        chainId: this.config.chainId,
        isConnected: false,
        latestBlock: 0,
        blockTime: 0,
        gasPrice: BigInt(0),
        maxPriorityFeePerGas: null,
        maxFeePerGas: null,
        baseFeePerGas: null,
        congestion: "unknown",
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error),
        sequencerHealthy: false
      };
    }
  }
  
  /**
   * Calculate network congestion based on fee data
   */
  private calculateNetworkCongestion(feeData: FeeData): "low" | "medium" | "high" | "unknown" {
    if (!feeData.gasPrice || !feeData.lastBaseFeePerGas) {
      return "unknown";
    }
    
    // These thresholds should be adjusted based on Arbitrum-specific analysis
    const lowThreshold = BigInt(100000000); // 0.1 gwei
    const highThreshold = BigInt(300000000); // 0.3 gwei
    
    if (feeData.gasPrice < lowThreshold) {
      return "low";
    } else if (feeData.gasPrice < highThreshold) {
      return "medium";
    } else {
      return "high";
    }
  }
  
  /**
   * Submit a trade transaction to Arbitrum
   */
  public async submitTrade(request: TradeRequest, options?: TradeOptions): Promise<TransactionResponse> {
    if (!this.circuitBreaker.allowRequest()) {
      throw new Error('Circuit breaker is open: trade submission temporarily disabled');
    }
    const startTime = Date.now();
    let txHash: string | undefined;
    try {
      if (this.telemetry) {
        this.telemetry.recordTradeStart(
          'arbitrum',
          request.fromAsset.symbol,
          request.toAsset.symbol,
          request.protocol || 'unknown'
        );
      }
      // Build the transaction from the trade request
      const transaction = await this.buildTradeTransaction(request, options);
      // Send the transaction
      let response: TransactionResponse;
      if (options?.mevProtection && this._mevProtectionEnabled) {
        response = await this.sendMevProtectedTransaction(transaction);
      } else {
        response = await this.sendTransaction(transaction);
      }
      txHash = response.hash;
      if (this.telemetry) {
        this.telemetry.recordTradeSubmitted(
          'arbitrum',
          request.fromAsset.symbol,
          request.toAsset.symbol,
          request.protocol || 'unknown',
          response.hash,
          Date.now() - startTime
        );
      }
      this.circuitBreaker.recordSuccess();
      return response;
    } catch (error) {
      if (this.telemetry) {
        this.telemetry.recordTradeFailed(
          'arbitrum',
          request.fromAsset.symbol,
          request.toAsset.symbol,
          request.protocol || 'unknown',
          txHash,
          error instanceof Error ? error.message : String(error),
          Date.now() - startTime
        );
      }
      this.circuitBreaker.recordFailure();
      this.logError("Failed to submit trade", error);
      throw error;
    }
  }
  
  /**
   * Send a transaction with MEV protection on Arbitrum
   */
  private async sendMevProtectedTransaction(transaction: TransactionRequest): Promise<TransactionResponse> {
    this.logInfo("Sending transaction with MEV protection");
    
    // Arbitrum-specific MEV protection logic would go here
    // For now, just use regular transaction sending
    return this.sendTransaction(transaction);
  }
  
  /**
   * Build a transaction from a trade request
   */
  private async buildTradeTransaction(request: TradeRequest, options?: TradeOptions): Promise<TransactionRequest> {
    // Construct a transaction from the trade request
    const tx: TransactionRequest = {
      to: request.contractAddress,
      data: request.callData,
      value: request.value
    };
    // Add gas parameters
    if (options?.gasPrice) {
      tx.gasPrice = options.gasPrice;
    } else if (options?.maxFeePerGas && options?.maxPriorityFeePerGas) {
      tx.maxFeePerGas = options.maxFeePerGas;
      tx.maxPriorityFeePerGas = options.maxPriorityFeePerGas;
    } else {
      // Get current fee data
      const feeDataRaw = await this.getFeeData();
      const feeData = this.normalizeFeeData(feeDataRaw);
      tx.maxFeePerGas = feeData.maxFeePerGas === null ? undefined : feeData.maxFeePerGas;
      tx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas === null ? undefined : feeData.maxPriorityFeePerGas;
    }
    // Set gas limit
    if (options?.gasLimit) {
      tx.gasLimit = options.gasLimit;
    } else {
      try {
        tx.gasLimit = BigInt(await this.estimateGas(
          await this.getWalletAddress(),
          tx.to || "",
          tx.data || ""
        ));
      } catch (error) {
        this.logError("Failed to estimate gas for trade", error);
        // Use a conservative gas limit if estimation fails
        tx.gasLimit = BigInt(3000000); // Arbitrum has higher gas limits than other chains
      }
    }
    // Set nonce if provided
    if (options?.nonce !== undefined) {
      tx.nonce = options.nonce;
    }
    return tx;
  }
  
  /**
   * Get current block number
   */
  public async getBlockNumber(): Promise<number> {
    return this.retryWithFailover(
      async () => await this.provider.getBlockNumber(),
      'getBlockNumber'
    );
  }
  
  /**
   * Get wallet address
   */
  public async getWalletAddress(): Promise<string> {
    if (!this.wallet) {
      throw new Error("Wallet not initialized");
    }
    
    try {
      return await this.wallet.getAddress();
    } catch (error) {
      this.logError("Failed to get wallet address", error);
      throw error;
    }
  }
  
  /**
   * Sign a transaction
   */
  public async signTransaction(transaction: TransactionRequest): Promise<string> {
    if (!this.wallet) {
      throw new Error("Wallet not initialized");
    }
    
    try {
      // Set chainId if not already set
      if (!transaction.chainId) {
        transaction.chainId = this.config.chainId;
      }
      
      return await this.wallet.signTransaction(transaction);
    } catch (error) {
      this.logError("Failed to sign transaction", error);
      throw error;
    }
  }
  
  /**
   * Send a transaction
   */
  public async sendTransaction(transaction: TransactionRequest): Promise<TransactionResponse> {
    if (!this.circuitBreaker.allowRequest()) {
      throw new Error('Circuit breaker is open: transaction sending temporarily disabled');
    }
    const startTime = Date.now();
    return this.retryWithFailover(async () => {
      try {
        const tx = await this.provider.sendTransaction(transaction);
        if (this.telemetry) {
          this.telemetry.recordSuccessfulExecution('arbitrum');
        }
        return {
          hash: tx.hash,
          confirmations: 0,
          from: transaction.from || '',
          wait: async () => {
            const receipt = await tx.wait();
            return {
              txHash: receipt.hash,
              blockNumber: receipt.blockNumber,
              blockHash: receipt.blockHash,
              from: receipt.from,
              to: receipt.to || '',
              status: receipt.status === 1 ? 'success' : 'failure',
              gasUsed: receipt.gasUsed.toString(),
              effectiveGasPrice: receipt.effectiveGasPrice.toString(),
              logs: receipt.logs,
              confirmations: receipt.confirmations
            };
          }
        };
        this.circuitBreaker.recordSuccess();
      } catch (error) {
        this.circuitBreaker.recordFailure();
        if (this.telemetry) {
          this.telemetry.recordFailedExecution(
            'arbitrum',
            error instanceof Error ? error.message : String(error)
          );
        }
        this.logError("Failed to send transaction", error);
        throw error;
      }
    }, 'sendTransaction');
  }
  
  /**
   * Calculate block time (average time between blocks)
   */
  private calculateBlockTime(latestBlockTimestamp: number): number {
    // This is a simplified implementation
    // In a real adapter, you might track the last several blocks and calculate average
    return 250; // Arbitrum blocks are typically faster than Ethereum mainnet
  }
  
  /**
   * Helper method to apply gas multiplier
   */
  private applyGasMultiplier(value: bigint): bigint {
    const multiplier = this.arbitrumConfig.gasMultiplier || 1.2;
    return BigInt(Math.ceil(Number(value) * multiplier));
  }
  
  /**
   * Log info message
   */
  private logInfo(message: string): void {
    console.log(`[ArbitrumAdapter] ${message}`);
  }
  
  /**
   * Log warning message
   */
  private logWarning(message: string): void {
    console.warn(`[ArbitrumAdapter] ${message}`);
  }
  
  /**
   * Log error message
   */
  private logError(message: string, error: unknown): void {
    console.error(`[ArbitrumAdapter] ${message}:`, error);
  }
  
  // Helper to re-initialize provider with the current RPC URL
  private async reinitProvider(): Promise<void> {
    // ... implementation to re-instantiate ethers provider with this.rpcUrls[this.currentRpcIndex] ...
    // For example:
    // this.provider = new ethers.providers.JsonRpcProvider(this.rpcUrls[this.currentRpcIndex]);
    // (Assume ethers is imported and available)
    this.logInfo(`Switched to fallback RPC: ${this.rpcUrls[this.currentRpcIndex]}`);
  }
  
  // Retry/failover wrapper for provider calls
  private async retryWithFailover<T>(fn: () => Promise<T>, context: string): Promise<T> {
    let attempt = 0;
    let lastError: any;
    let delay = this.retryBaseDelay;
    while (attempt <= this.maxRetries) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        this.logWarning(`Attempt ${attempt + 1} failed in ${context}: ${error}`);
        if (attempt < this.maxRetries) {
          await new Promise(res => setTimeout(res, delay));
          delay *= 2; // Exponential backoff
        }
        attempt++;
      }
    }
    // If all retries failed, try next RPC URL if available
    if (this.rpcUrls.length > 1 && this.currentRpcIndex < this.rpcUrls.length - 1) {
      this.currentRpcIndex++;
      await this.reinitProvider();
      this.logWarning(`Failing over to next RPC endpoint: ${this.rpcUrls[this.currentRpcIndex]}`);
      // Reset attempt and try again
      return this.retryWithFailover(fn, context);
    }
    // All failovers exhausted
    this.logError(`All RPC endpoints failed in ${context}`, lastError);
    throw lastError;
  }
  
  /**
   * Expose circuit breaker status for monitoring/telemetry
   */
  public getCircuitBreakerStatus() {
    return this.circuitBreaker.getStatus();
  }
} 