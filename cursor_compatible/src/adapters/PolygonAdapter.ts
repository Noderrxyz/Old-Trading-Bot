/**
 * PolygonAdapter - Chain adapter implementation for Polygon network
 * 
 * This adapter provides interaction with the Polygon (Matic) network,
 * supporting token trading, gas estimation, and chain-specific operations.
 */

import { BaseChainAdapter } from './BaseChainAdapter';
import { ChainId, NetworkConfig, TransactionRequest, TransactionResponse, 
         Asset, AssetInfo, TradeRequest, NetworkStatus, Network,
         FeeData, TransactionOptions, TradeOptions, TradeOrder, TradeResult, TransactionReceipt, MevProtectionConfig } from './IChainAdapter';
import { AdapterCapability } from './IAdapter';
import { BlockchainTelemetry } from './telemetry/BlockchainTelemetry';
import { CircuitBreaker, CircuitBreakerConfig, CircuitBreakerState } from './telemetry/CircuitBreaker';

// Polygon-specific configuration options
export interface PolygonAdapterConfig {
  rpcUrl: string;
  rpcUrls?: string[]; // List of fallback RPC endpoints
  chainId: number;
  isMainnet: boolean;
  networkName: string;
  blockExplorerUrl?: string;
  nativeCurrency?: {
    name: string;
    symbol: string;
    decimals: number;
  };
  gasMultiplier?: number;
  maxPriorityFeePerGas?: bigint;
  telemetry?: BlockchainTelemetry;
  retryConfig?: {
    maxRetries: number;
    initialDelay: number;
    maxDelay: number;
  };
  privateKey?: string;
  mevProtection?: MevProtectionConfig;
  circuitBreakerConfig?: CircuitBreakerConfig;
}

/**
 * Polygon adapter implementation
 */
export class PolygonAdapter extends BaseChainAdapter {
  // Polygon-specific configuration
  protected config: PolygonAdapterConfig;
  
  // Track gas prices for optimization
  private lastGasPrice: bigint = BigInt(0);
  private lastGasPriceTimestamp: number = 0;
  private gasPriceValidityPeriod: number = 30000; // 30 seconds
  
  private rpcUrls: string[];
  private currentRpcIndex: number = 0;
  private maxRetries: number = 3;
  private retryBaseDelay: number = 500; // ms
  
  private telemetry?: BlockchainTelemetry;
  
  private circuitBreaker: CircuitBreaker;
  
  // Add chainInfo property
  protected chainInfo: NetworkConfig = {
    name: "Polygon",
    chainId: ChainId.POLYGON,
    network: Network.POLYGON,
    nativeCurrency: this.config.nativeCurrency || {
      name: "MATIC",
      symbol: "MATIC",
      decimals: 18
    },
    blockExplorerUrl: this.config.blockExplorerUrl
  };
  
  /**
   * Constructor for Polygon adapter
   * @param config Configuration options
   */
  constructor(config: PolygonAdapterConfig) {
    const rpcUrls = config.rpcUrls && config.rpcUrls.length > 0
      ? config.rpcUrls
      : (config.rpcUrl ? [config.rpcUrl] : []);
    const isMainnet = typeof config.isMainnet === 'boolean' ? config.isMainnet : config.chainId === ChainId.POLYGON;
    super({
      ...config,
      rpcUrl: rpcUrls[0] || '',
      isMainnet,
      networkName: config.networkName,
      mevProtection: typeof config.mevProtection === 'object' ? config.mevProtection : undefined,
    });
    
    this.config = { ...config, isMainnet, networkName: config.networkName };
    this.rpcUrls = rpcUrls;
    if (config.retryConfig?.maxRetries) this.maxRetries = config.retryConfig.maxRetries;
    this._name = "PolygonAdapter";
    this._version = "1.0.0";
    this.telemetry = config.telemetry;
    
    // Initialize circuit breaker with config or defaults
    this.circuitBreaker = new CircuitBreaker(config.circuitBreakerConfig || {});
    
    // Add EIP-1559 capability for Polygon
    this.addCapability(AdapterCapability.FEE_MARKET);
    
    // Polygon specific capabilities
    this.addCapability(AdapterCapability.MULTICALL);
    this.addCapability(AdapterCapability.BALANCE_QUERY);
    this.addCapability(AdapterCapability.TOKEN_TRANSFER);
    this.addCapability(AdapterCapability.NFT_SUPPORT);
  }
  
  /**
   * Initialize the Polygon adapter
   */
  public async initialize(): Promise<void> {
    await this.initializeImpl();
  }
  
  /**
   * Implementation-specific initialization
   */
  protected async initializeImpl(): Promise<void> {
    try {
      const network = await this.provider.getNetwork();
      if (network.chainId !== BigInt(this.config.chainId)) {
        throw new Error(`Expected Polygon chain ID ${this.config.chainId}, got ${network.chainId}`);
      }
      
      this.logInfo("Polygon adapter initialized successfully");
    } catch (error) {
      this.logError("Failed to initialize Polygon adapter", error);
      throw error;
    }
  }
  
  /**
   * Get the current gas price with Polygon-specific optimizations
   */
  public async getGasPrice(): Promise<import('./IChainAdapter').GasEstimate> {
    return this.retryWithFailover(async () => {
      const now = Date.now();
      let gasPrice: bigint;
      if (this.lastGasPrice > 0 && (now - this.lastGasPriceTimestamp) < this.gasPriceValidityPeriod) {
        gasPrice = this.lastGasPrice;
      } else {
        try {
          const feeData = await this.provider.getFeeData();
          if (feeData.maxFeePerGas !== null) {
            const baseFee = feeData.maxFeePerGas - (feeData.maxPriorityFeePerGas || BigInt(0));
            const priorityFee = this.config.maxPriorityFeePerGas || feeData.maxPriorityFeePerGas || BigInt(30000000000);
            gasPrice = baseFee + priorityFee;
          } else {
            gasPrice = feeData.gasPrice || BigInt(100000000000);
          }
          gasPrice = this.applyGasMultiplier(gasPrice);
          this.lastGasPrice = gasPrice;
          this.lastGasPriceTimestamp = now;
        } catch (error) {
          this.logError("Failed to get gas price", error);
          gasPrice = this.lastGasPrice > 0 ? this.lastGasPrice : BigInt(100000000000);
        }
      }
      return {
        slow: {
          gasPrice: gasPrice.toString(),
          estimatedTimeMs: 60000
        },
        average: {
          gasPrice: gasPrice.toString(),
          estimatedTimeMs: 30000
        },
        fast: {
          gasPrice: (gasPrice * BigInt(11) / BigInt(10)).toString(),
          estimatedTimeMs: 15000
        },
        isEip1559Supported: true,
        lastUpdated: now
      };
    }, 'getGasPrice');
  }
  
  /**
   * Get fee data with Polygon-specific optimizations
   */
  public async getFeeData(): Promise<FeeData> {
    return this.retryWithFailover(
      async () => {
        try {
          const feeData = await this.provider.getFeeData();
          const gasPrice = feeData.gasPrice || await this.getGasPrice();
          
          // Apply gas multiplier if needed
          const adjustedGasPrice = this.applyGasMultiplier(gasPrice);
          
          // For Polygon, ensure maxPriorityFeePerGas is reasonable
          let maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
          if (!maxPriorityFeePerGas || maxPriorityFeePerGas < BigInt(30000000000)) { // 30 gwei minimum
            maxPriorityFeePerGas = this.config.maxPriorityFeePerGas || BigInt(30000000000);
          }
          
          // Calculate maxFeePerGas if we have a base fee
          let maxFeePerGas = feeData.maxFeePerGas;
          if (!maxFeePerGas && feeData.lastBaseFeePerGas) {
            // maxFeePerGas = (2 * baseFee) + priorityFee is a common formula
            maxFeePerGas = (feeData.lastBaseFeePerGas * BigInt(2)) + maxPriorityFeePerGas;
          }
          
          return {
            gasPrice: adjustedGasPrice,
            maxFeePerGas: maxFeePerGas === null ? undefined : maxFeePerGas,
            maxPriorityFeePerGas: maxPriorityFeePerGas === null ? undefined : maxPriorityFeePerGas,
            lastBaseFeePerGas: feeData.lastBaseFeePerGas === null ? undefined : feeData.lastBaseFeePerGas
          };
        } catch (error) {
          this.logError("Failed to get fee data", error);
          
          // Return a reasonable default
          const gasPrice = BigInt(100000000000); // 100 gwei
          return {
            gasPrice,
            maxFeePerGas: undefined,
            maxPriorityFeePerGas: undefined,
            lastBaseFeePerGas: undefined
          };
        }
      },
      'getFeeData'
    );
  }
  
  /**
   * Estimate gas for a transaction with Polygon adjustments
   * @param fromAddress The address of the sender
   * @param toAddress The address of the recipient
   * @param data The data for the transaction
   * @param value The value for the transaction
   * @returns Estimated gas units
   */
  public async estimateGas(fromAddress: string, toAddress: string, data: string, value?: string): Promise<string> {
    if (!this.circuitBreaker.allowRequest()) {
      throw new Error('Circuit breaker is open: gas estimation temporarily disabled');
    }
    const startTime = Date.now();
    return this.retryWithFailover(async () => {
      try {
        const tx: TransactionRequest = {
          from: fromAddress,
          to: toAddress,
          data,
          value: value ? BigInt(value) : undefined
        };
        if (!tx.gasPrice && !tx.maxFeePerGas) {
          const gasEstimate = await this.getGasPrice();
          tx.gasPrice = gasEstimate.average.gasPrice ? BigInt(gasEstimate.average.gasPrice) : undefined;
        }
        const estimate = await this.provider.estimateGas(tx);
        const adjusted = (estimate * BigInt(120)) / BigInt(100);
        if (this.telemetry) {
          this.telemetry.recordGasEstimation(
            "polygon",
            tx.to?.toString() || "contract_creation",
            adjusted,
            Date.now() - startTime
          );
        }
        this.circuitBreaker.recordSuccess();
        return adjusted.toString();
      } catch (error) {
        if (this.telemetry) {
          this.telemetry.recordFailedGasEstimation(
            "polygon",
            toAddress,
            error instanceof Error ? error.message : String(error)
          );
        }
        this.circuitBreaker.recordFailure();
        this.logError("Failed to estimate gas", error);
        throw error;
      }
    }, 'estimateGas');
  }
  
  /**
   * Submit a trade on Polygon
   * @param request Trade request details
   * @param options Trade options
   * @returns Transaction response
   */
  public async submitTrade(request: TradeRequest, options?: TradeOptions): Promise<TransactionResponse> {
    if (!this.circuitBreaker.allowRequest()) {
      throw new Error('Circuit breaker is open: trade submission temporarily disabled');
    }
    const startTime = Date.now();
    let txHash: string | undefined;
    
    return this.retryWithFailover(
      async () => {
        try {
          // Record trade attempt
          if (this.telemetry) {
            this.telemetry.recordTradeStart(
              "polygon",
              request.fromAsset.symbol,
              request.toAsset.symbol,
              request.protocol || "unknown"
            );
          }
          
          // Validate the trade request
          this.validateTradeRequest(request);
          
          // Check slippage if provided
          if (request.expectedOutput && request.slippageTolerance) {
            this.validateSlippage(request);
          }
          
          // Convert the trade request to a transaction
          const transaction = await this.buildTradeTransaction(request, options);
          
          // Submit the transaction
          const response = await this.sendTransaction(transaction);
          txHash = response.hash;
          
          // Record successful trade submission
          if (this.telemetry) {
            this.telemetry.recordTradeSubmitted(
              "polygon",
              request.fromAsset.symbol,
              request.toAsset.symbol,
              request.protocol || "unknown",
              response.hash,
              Date.now() - startTime
            );
          }
          
          this.circuitBreaker.recordSuccess();
          return response;
        } catch (error) {
          // Record failed trade
          if (this.telemetry) {
            this.telemetry.recordTradeFailed(
              "polygon",
              request.fromAsset.symbol,
              request.toAsset.symbol,
              request.protocol || "unknown",
              txHash,
              error instanceof Error ? error.message : String(error),
              Date.now() - startTime
            );
          }
          
          this.circuitBreaker.recordFailure();
          this.logError("Failed to submit trade", error);
          throw error;
        }
      },
      'submitTrade'
    );
  }
  
  /**
   * Build a transaction from a trade request
   * @param request Trade request
   * @param options Trade options
   * @returns Transaction request
   */
  private async buildTradeTransaction(
    request: TradeRequest,
    options?: TradeOptions
  ): Promise<TransactionRequest> {
    // Get the current wallet address
    const walletAddress = await this.getWalletAddress();
    
    // Create transaction data based on the request type
    let txData: TransactionRequest;
    
    if (request.callData) {
      // Direct call data provided
      txData = {
        to: request.contractAddress || '',
        data: request.callData,
        value: request.value || BigInt(0)
      };
    } else {
      // We need to encode the call data
      throw new Error("Direct callData is required for Polygon trades - ABI encoding not yet implemented");
    }
    
    // Set transaction specifics
    txData.from = walletAddress;
    
    // Get fee data if not provided
    if (!txData.gasPrice && !txData.maxFeePerGas) {
      const feeData = await this.getFeeData();
      
      // Prefer EIP-1559 when available
      if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        txData.maxFeePerGas = feeData.maxFeePerGas;
        txData.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
      } else if (feeData.gasPrice) {
        txData.gasPrice = feeData.gasPrice;
      }
    }
    
    // Estimate gas if not provided
    if (!txData.gasLimit) {
      try {
        const toAddress = txData.to || '';
        const value = txData.value ? txData.value.toString() : '0';
        const data = txData.data || '';
        const gasEstimate = await this.estimateGas(
          txData.from,
          toAddress,
          data,
          value
        );
        txData.gasLimit = BigInt(gasEstimate);
      } catch (error) {
        this.logError("Failed to estimate gas for trade", error);
        
        // Use a conservative gas limit if estimation fails
        txData.gasLimit = BigInt(500000); // 500K gas units should be enough for most trades
      }
    }
    
    return txData;
  }
  
  /**
   * Validate slippage for a trade
   * @param request Trade request
   * @throws Error if slippage exceeds tolerance
   */
  public validateSlippage(request: TradeRequest): void {
    if (!request.expectedOutput || !request.slippageTolerance) {
      // Can't validate without both values
      return;
    }
    
    const expectedAmount = BigInt(request.expectedOutput);
    const minAmount = request.minOutput ? BigInt(request.minOutput) : undefined;
    
    if (!minAmount) {
      // Calculate min amount from slippage tolerance
      // slippageTolerance is a percentage like 0.5 for 0.5%
      const slippageFactor = 1000 - Math.floor(request.slippageTolerance * 10);
      const calculatedMinAmount = (expectedAmount * BigInt(slippageFactor)) / BigInt(1000);
      
      // No explicit validation needed since we're calculating the min amount
      this.logInfo(`Calculated minimum output: ${calculatedMinAmount} based on tolerance ${request.slippageTolerance}%`);
    } else {
      // Validate provided min amount against expected output and slippage tolerance
      const slippageFactor = 1000 - Math.floor(request.slippageTolerance * 10);
      const calculatedMinAmount = (expectedAmount * BigInt(slippageFactor)) / BigInt(1000);
      
      if (minAmount < calculatedMinAmount) {
        throw new Error(
          `Minimum output ${minAmount} is less than allowed by slippage tolerance ` +
          `(${request.slippageTolerance}%). Minimum should be at least ${calculatedMinAmount}.`
        );
      }
    }
  }
  
  /**
   * Apply gas multiplier to a gas price or limit
   * @param value The gas value to adjust
   * @returns Adjusted gas value
   */
  private applyGasMultiplier(value: bigint): bigint {
    const multiplier = this.config.gasMultiplier || 1.1;
    return BigInt(Math.floor(Number(value) * multiplier));
  }
  
  /**
   * Get the status of the Polygon network
   */
  public async getNetworkStatus(): Promise<NetworkStatus> {
    try {
      // Get basic network info
      const [blockNumber, feeData, network] = await Promise.all([
        this.provider.getBlockNumber(),
        this.getFeeData(),
        this.provider.getNetwork()
      ]);
      
      // Get latest block
      const block = await this.provider.getBlock(blockNumber);
      const timestamp = block?.timestamp ? Number(block.timestamp) * 1000 : Date.now();
      
      // Calculate block time (average time between blocks)
      const blockTime = this.calculateBlockTime(timestamp);
      
      // Calculate network congestion based on gas prices
      const congestion = this.calculateNetworkCongestion(feeData);
      
      return {
        networkName: this.chainInfo.name,
        chainId: Number(network.chainId),
        isConnected: true,
        latestBlock: blockNumber,
        blockTime: blockTime,
        gasPrice: feeData.gasPrice || BigInt(0),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || null,
        maxFeePerGas: feeData.maxFeePerGas || null,
        baseFeePerGas: feeData.lastBaseFeePerGas || null,
        congestion: congestion,
        timestamp: timestamp
      };
    } catch (error) {
      this.logError("Failed to get network status", error);
      
      // Return a status indicating connection issue
      return {
        networkName: this.chainInfo.name,
        chainId: this.chainInfo.chainId,
        isConnected: false,
        latestBlock: 0,
        blockTime: 0,
        gasPrice: BigInt(0),
        maxPriorityFeePerGas: null,
        maxFeePerGas: null,
        baseFeePerGas: null,
        congestion: "unknown",
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Calculate average block time
   */
  private calculateBlockTime(latestBlockTimestamp: number): number {
    // For Polygon, the target block time is 2 seconds
    // This is a simple implementation - a production version would use historical data
    return 2000; // 2 seconds in ms
  }
  
  /**
   * Calculate network congestion level based on gas prices
   */
  private calculateNetworkCongestion(feeData: FeeData): "low" | "medium" | "high" | "unknown" {
    if (!feeData.gasPrice && !feeData.maxFeePerGas) {
      return "unknown";
    }
    
    const gasPrice = Number(feeData.gasPrice || feeData.maxFeePerGas || 0) / 1e9; // Convert to Gwei
    
    // Polygon-specific thresholds (may need adjustment based on network conditions)
    if (gasPrice < 50) {
      return "low";
    } else if (gasPrice < 200) {
      return "medium";
    } else {
      return "high";
    }
  }

  /**
   * Implementation-specific connection logic
   */
  protected async connectImpl(): Promise<void> {
    try {
      await this.provider.getBlockNumber();
      this.logInfo("Successfully connected to Polygon network");
    } catch (error) {
      this.logError("Failed to connect to Polygon network", error);
      throw error;
    }
  }

  /**
   * Implementation-specific disconnection logic
   */
  protected async disconnectImpl(): Promise<void> {
    // For Polygon, there's not much to do for disconnection
    // as the provider handles connection state internally
    this.logInfo("Disconnected from Polygon network");
  }

  /**
   * Implementation-specific shutdown logic
   */
  protected async shutdownImpl(): Promise<void> {
    // Clean up any resources
    this.lastGasPrice = BigInt(0);
    this.lastGasPriceTimestamp = 0;
    this.logInfo("Polygon adapter shut down");
  }

  /**
   * Implementation-specific reset logic
   */
  protected async resetImpl(): Promise<void> {
    // Reset cached data
  }

  // Logging helpers
  private logInfo(message: string): void {
    console.log(`[PolygonAdapter] ${message}`);
  }
  private logWarning(message: string): void {
    console.warn(`[PolygonAdapter] ${message}`);
  }
  private logError(message: string, error?: unknown): void {
    console.error(`[PolygonAdapter] ${message}`, error);
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
      // Re-instantiate provider here if needed
      this.logWarning(`Failing over to next RPC endpoint: ${this.rpcUrls[this.currentRpcIndex]}`);
      // TODO: Actually re-instantiate the provider with the new RPC URL
      // this.provider = new ethers.providers.JsonRpcProvider(this.rpcUrls[this.currentRpcIndex]);
      // Reset attempt and try again
      return this.retryWithFailover(fn, context);
    }
    // All failovers exhausted
    this.logError(`All RPC endpoints failed in ${context}`, lastError);
    throw lastError;
  }

  // Implement required abstract methods as stubs if not present
  protected async getStatusImpl(): Promise<any> { return {}; }
  public async getBalance(address: string, asset?: Asset): Promise<string> { return '0'; }
  public async executeTrade(order: TradeOrder): Promise<TradeResult> { return { success: false, order, timestamp: Date.now() }; }
  public async getQuote(fromAsset: Asset, toAsset: Asset, amount: string): Promise<{ expectedOutput: string; priceImpact: number; route?: string[]; }> { return { expectedOutput: '0', priceImpact: 0 }; }
  public async getTransactionStatus(txHash: string): Promise<{ status: 'pending' | 'confirmed' | 'failed'; confirmations?: number; receipt?: TransactionReceipt; }> { return { status: 'pending' }; }
  public async signTransaction(transaction: TransactionRequest): Promise<string> { return ''; }
  public async sendTransaction(transaction: TransactionRequest): Promise<TransactionResponse> {
    if (!this.circuitBreaker.allowRequest()) {
      throw new Error('Circuit breaker is open: transaction sending temporarily disabled');
    }
    return this.retryWithFailover(async () => {
      try {
        const tx = await this.provider.sendTransaction(transaction);
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
        this.logError("Failed to send transaction", error);
        throw error;
      }
    }, 'sendTransaction');
  }
  public async getBlockNumber(): Promise<number> { return 0; }
  public async getWalletAddress(): Promise<string> { return ''; }

  // Add stub for validateTradeRequest
  private validateTradeRequest(request: TradeRequest): void {
    // No-op for now
  }

  // Add/ensure stubs for required abstract methods
  protected async configureMevProtectionImpl(config: any): Promise<void> { return; }
  protected async calculateBlockDelay(currentBlockHeight: number): Promise<number> { return 0; }
  public async submitTransaction(signedTx: string, mevProtection?: boolean): Promise<string> { return ''; }

  /**
   * Expose circuit breaker status for monitoring/telemetry
   */
  public getCircuitBreakerStatus() {
    return this.circuitBreaker.getStatus();
  }
} 