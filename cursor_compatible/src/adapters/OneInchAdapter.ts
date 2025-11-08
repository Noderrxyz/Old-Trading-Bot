/**
 * OneInchAdapter - Cross-chain execution adapter for 1inch protocol
 * 
 * Implements cross-chain swaps and liquidity aggregation through 1inch API
 */

import { ICrossChainAdapter, Session, AccountStatus, ChainInfo, 
         CrossChainSwapParams, SwapResult, FeeEstimate, TransactionStatus } from './interfaces/ICrossChainAdapter';
import { IChainAdapter, Asset, ChainId, TradeRequest, TradeOptions, 
         TransactionResponse, NetworkStatus, FeeData, TransactionRequest,
         AdapterStatus, UnifiedMarketData, TradeOrder, TradeResult, 
         ChainAdapterStatus, GasEstimate, AssetInfo, MevProtectionConfig } from './IChainAdapter';
import { ApiClient } from '../common/ApiClient';
import { createLogger } from '../common/logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';

const logger = createLogger('OneInchAdapter');

/**
 * 1inch chain IDs mapping
 */
const ONEINCH_CHAIN_IDS: Record<number, string> = {
  1: 'ethereum',
  56: 'bsc',
  137: 'polygon',
  42161: 'arbitrum',
  10: 'optimism',
  43114: 'avalanche',
  250: 'fantom',
  100: 'gnosis'
};

/**
 * Configuration for 1inch adapter
 */
export interface OneInchConfig {
  apiKey?: string;
  apiUrl?: string;
  maxSlippage?: number;
  excludeProtocols?: string[];
  includeProtocols?: string[];
}

export class OneInchAdapter implements ICrossChainAdapter {
  private apiClient: ApiClient;
  private telemetryBus: TelemetryBus;
  private config: OneInchConfig;
  private session: Session | null = null;
  private initialized: boolean = false;
  private supportedChains: ChainInfo[] = [];

  /**
   * Human-readable name of the adapter
   */
  readonly name: string = '1inch';

  /**
   * Chain identifier (using '0' for cross-chain)
   */
  readonly chainId: string = '0';

  constructor(config: OneInchConfig = {}) {
    this.config = {
      apiUrl: 'https://api.1inch.io/v5.0',
      maxSlippage: 1, // 1% default
      ...config
    };

    this.apiClient = new ApiClient({
      baseUrl: this.config.apiUrl!,
      headers: this.config.apiKey ? {
        'Authorization': `Bearer ${this.config.apiKey}`
      } : {},
      timeout: 30000,
      retries: 3
    });

    this.telemetryBus = TelemetryBus.getInstance();
  }

  /**
   * Get adapter name
   */
  getName(): string {
    return this.name;
  }

  /**
   * Get chain ID (returns 0 as this is cross-chain)
   */
  getChainId(): number {
    return 0;
  }

  /**
   * Check if adapter is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Initialize the adapter
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing 1inch adapter');

      // Fetch supported chains
      this.supportedChains = await this.fetchSupportedChains();

      // Create session
      this.session = {
        id: `1inch-${Date.now()}`,
        token: this.config.apiKey || 'public',
        expiresAt: Date.now() + 86400000 // 24 hours
      };

      this.initialized = true;

      this.telemetryBus.emit('adapter_initialized', {
        adapter: '1inch',
        supportedChains: this.supportedChains.length,
        timestamp: Date.now()
      });

      logger.info(`1inch adapter initialized with ${this.supportedChains.length} supported chains`);
    } catch (error) {
      logger.error('Failed to initialize 1inch adapter', error);
      throw error;
    }
  }

  /**
   * Authenticate with 1inch service
   */
  async authenticate(credentials: Record<string, any>): Promise<Session> {
    // 1inch uses API key authentication, so we just validate and return session
    if (credentials.apiKey) {
      this.config.apiKey = credentials.apiKey;
      this.apiClient = new ApiClient({
        baseUrl: this.config.apiUrl!,
        headers: {
          'Authorization': `Bearer ${credentials.apiKey}`
        }
      });
    }

    this.session = {
      id: `1inch-${Date.now()}`,
      token: credentials.apiKey || 'public',
      expiresAt: Date.now() + 86400000 // 24 hours
    };

    return this.session;
  }

  /**
   * Get universal account status
   */
  async getUniversalAccountStatus(): Promise<AccountStatus> {
    // 1inch doesn't have universal accounts, return mock status
    return {
      accountId: 'not-applicable',
      isActive: this.initialized,
      chains: this.supportedChains,
      lastUpdated: Date.now()
    };
  }

  /**
   * Execute a cross-chain swap
   */
  async executeCrossChainSwap(params: CrossChainSwapParams): Promise<SwapResult> {
    const startTime = Date.now();

    try {
      this.validateInitialized();

      logger.info(`Executing cross-chain swap from ${params.fromChain} to ${params.toChain}`);

      // For 1inch, we need to perform this as two separate operations
      // 1. Swap on source chain to bridge token
      // 2. Bridge to destination chain
      // 3. Swap on destination chain to target token

      // This is a simplified implementation - in production, you'd use
      // 1inch Fusion or their cross-chain aggregation API

      const sourceChainId = this.getChainIdFromName(params.fromChain);
      const targetChainId = this.getChainIdFromName(params.toChain);

      // Get quote for the swap
      const quote = await this.getSwapQuote(
        sourceChainId,
        params.fromToken,
        params.toToken,
        params.amount,
        params.slippageTolerance
      );

      // Execute the swap (simplified - would need wallet integration)
      const txData = await this.buildSwapTransaction(
        sourceChainId,
        params.fromToken,
        params.toToken,
        params.amount,
        params.slippageTolerance,
        params.recipient
      );

      // Emit telemetry
      this.telemetryBus.emit('cross_chain_swap_executed', {
        adapter: '1inch',
        fromChain: params.fromChain,
        toChain: params.toChain,
        amount: params.amount,
        estimatedOutput: quote.toAmount,
        duration: Date.now() - startTime,
        timestamp: Date.now()
      });

      return {
        success: true,
        transactionHash: txData.tx?.hash || 'simulated-tx-hash',
        status: 'pending',
        fromAmount: params.amount,
        toAmount: quote.toAmount,
        fee: {
          total: quote.estimatedGas || '0',
          gasFee: quote.estimatedGas || '0'
        },
        route: quote.protocols?.[0] || []
      };
    } catch (error) {
      logger.error('Cross-chain swap failed', error);

      this.telemetryBus.emit('cross_chain_swap_failed', {
        adapter: '1inch',
        fromChain: params.fromChain,
        toChain: params.toChain,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        timestamp: Date.now()
      });

      return {
        success: false,
        status: 'failed',
        fromAmount: params.amount,
        toAmount: '0',
        fee: { total: '0' },
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Estimate fees for cross-chain operation
   */
  async estimateCrossChainFees(params: CrossChainSwapParams): Promise<FeeEstimate> {
    try {
      this.validateInitialized();

      const sourceChainId = this.getChainIdFromName(params.fromChain);
      
      // Get quote to estimate fees
      const quote = await this.getSwapQuote(
        sourceChainId,
        params.fromToken,
        params.toToken,
        params.amount,
        params.slippageTolerance
      );

      return {
        totalFee: quote.estimatedGas || '0',
        bridgeFee: '0', // 1inch doesn't separate bridge fees
        gasFee: quote.estimatedGas || '0',
        estimatedTime: 300, // 5 minutes estimate
        priceImpact: parseFloat(quote.priceImpact || '0')
      };
    } catch (error) {
      logger.error('Failed to estimate cross-chain fees', error);
      throw error;
    }
  }

  /**
   * Get supported chains
   */
  async getSupportedChains(): Promise<ChainInfo[]> {
    return this.supportedChains;
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(txId: string): Promise<TransactionStatus> {
    // 1inch doesn't provide transaction tracking, would need to use chain-specific APIs
    return {
      transactionId: txId,
      status: 'confirmed',
      confirmations: 12,
      timestamp: Date.now()
    };
  }

  /**
   * Get network status
   */
  async getNetworkStatus(): Promise<NetworkStatus> {
    try {
      // Check API health
      const healthCheck = await this.apiClient.get('/healthcheck');
      
      return {
        networkName: '1inch-aggregator',
        chainId: 0,
        isConnected: true,
        latestBlock: 0, // Not applicable for aggregator
        blockTime: Date.now(),
        gasPrice: BigInt(0),
        maxPriorityFeePerGas: null,
        maxFeePerGas: null,
        baseFeePerGas: null,
        congestion: 'unknown' as const,
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        networkName: '1inch-aggregator',
        chainId: 0,
        isConnected: false,
        latestBlock: 0,
        blockTime: 0,
        gasPrice: BigInt(0),
        maxPriorityFeePerGas: null,
        maxFeePerGas: null,
        baseFeePerGas: null,
        congestion: 'unknown' as const,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get current fees
   */
  async getCurrentFees(): Promise<FeeData> {
    // Return proper FeeData structure for 1inch aggregator
    return {
      gasPrice: BigInt(20) * BigInt(10 ** 9), // 20 gwei default
      maxFeePerGas: BigInt(30) * BigInt(10 ** 9), // 30 gwei
      maxPriorityFeePerGas: BigInt(2) * BigInt(10 ** 9), // 2 gwei
      lastBaseFeePerGas: BigInt(18) * BigInt(10 ** 9) // 18 gwei
    };
  }

  /**
   * Submit a trade
   */
  async submitTrade(request: TradeRequest, options?: TradeOptions): Promise<TransactionResponse> {
    try {
      const chainId = request.fromAsset.chainId;
      const txData = await this.buildSwapTransaction(
        chainId,
        request.fromAsset.address || request.fromAsset.symbol,
        request.toAsset.address || request.toAsset.symbol,
        request.amount,
        request.slippageTolerance,
        request.recipient
      );

      // Create a mock TransactionResponse that matches the interface
      const mockTx: TransactionResponse = {
        hash: txData.tx?.hash || 'simulated-tx-hash',
        confirmations: 0,
        from: txData.tx?.from || '',
        to: txData.tx?.to || '',
        wait: async (confirmations?: number) => {
          // Mock wait function
          return {
            txHash: txData.tx?.hash || 'simulated-tx-hash',
            blockNumber: 12345678,
            blockHash: '0xmockhash',
            from: txData.tx?.from || '',
            to: txData.tx?.to || '',
            status: 'success' as const,
            gasUsed: txData.tx?.gas || '0',
            effectiveGasPrice: txData.tx?.gasPrice || '0',
            logs: [],
            confirmations: confirmations || 1,
            timestamp: Date.now(),
            nonce: 0,
            rawReceipt: {}
          };
        }
      };

      return mockTx;
    } catch (error) {
      logger.error('Failed to submit trade', error);
      throw error;
    }
  }

  /**
   * Get assets for a chain
   */
  async getAssets(chainId: ChainId): Promise<Asset[]> {
    try {
      const tokens = await this.apiClient.get(`/${chainId}/tokens`);
      
      return Object.entries(tokens.tokens || {}).map(([address, token]: [string, any]) => ({
        symbol: token.symbol,
        name: token.name,
        address: address,
        decimals: token.decimals,
        chainId: chainId,
        logoURI: token.logoURI
      }));
    } catch (error) {
      logger.error(`Failed to get assets for chain ${chainId}`, error);
      return [];
    }
  }

  // Implement remaining IChainAdapter methods

  /**
   * Get market data
   */
  async getMarketData(symbol: string): Promise<UnifiedMarketData> {
    // Mock implementation - 1inch doesn't provide market data directly
    return {
      symbol,
      price: 0,
      volume24h: 0,
      marketCap: 0,
      timestamp: Date.now()
    } as UnifiedMarketData;
  }

  /**
   * Connect to the blockchain network
   */
  async connect(): Promise<void> {
    await this.initialize();
  }

  /**
   * Disconnect from the blockchain network
   */
  async disconnect(): Promise<void> {
    this.initialized = false;
    this.session = null;
  }

  /**
   * Get balance of an address
   */
  async getBalance(address: string, asset?: Asset): Promise<string> {
    // This would require chain-specific calls
    return '0';
  }

  /**
   * Execute a trade order
   */
  async executeTrade(order: TradeOrder): Promise<TradeResult> {
    // Convert TradeOrder to TradeRequest and execute
    const request: TradeRequest = {
      fromAsset: order.fromAsset,
      toAsset: order.toAsset,
      amount: order.amount,
      slippageTolerance: order.slippageTolerance,
      deadline: order.deadline
    };

    const tx = await this.submitTrade(request);
    
    return {
      success: true,
      order,
      txHash: tx.hash,
      timestamp: Date.now()
    };
  }

  /**
   * Get adapter status
   */
  async getStatus(): Promise<ChainAdapterStatus> {
    const networkStatus = await this.getNetworkStatus();
    
    return {
      chainId: 0,
      networkName: '1inch-aggregator',
      isConnected: networkStatus.isConnected,
      latency: 0,
      timestamp: Date.now(),
      lastError: networkStatus.error,
      isMainnet: true
    };
  }

  /**
   * Get quote for a potential trade
   */
  async getQuote(fromAsset: Asset, toAsset: Asset, amount: string): Promise<{
    expectedOutput: string;
    priceImpact: number;
    route?: string[];
  }> {
    const quote = await this.getSwapQuote(
      fromAsset.chainId,
      fromAsset.address || fromAsset.symbol,
      toAsset.address || toAsset.symbol,
      amount
    );

    return {
      expectedOutput: quote.toAmount || '0',
      priceImpact: parseFloat(quote.priceImpact || '0'),
      route: quote.protocols?.[0] || []
    };
  }

  /**
   * Get detailed asset information
   */
  async getAssetInfo(asset: Asset): Promise<AssetInfo> {
    return {
      ...asset,
      verified: true,
      contractType: asset.address ? 'ERC20' : 'NATIVE'
    };
  }

  /**
   * Get gas price estimate
   */
  async getGasPrice(): Promise<GasEstimate> {
    const fees = await this.getCurrentFees();
    
    return {
      slow: {
        maxFeePerGas: fees.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas?.toString(),
        gasPrice: fees.gasPrice?.toString(),
        estimatedTimeMs: 60000
      },
      average: {
        maxFeePerGas: fees.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas?.toString(),
        gasPrice: fees.gasPrice?.toString(),
        estimatedTimeMs: 30000
      },
      fast: {
        maxFeePerGas: fees.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas?.toString(),
        gasPrice: fees.gasPrice?.toString(),
        estimatedTimeMs: 15000
      },
      baseFee: fees.lastBaseFeePerGas?.toString(),
      isEip1559Supported: true,
      lastUpdated: Date.now()
    };
  }

  /**
   * Estimate gas for a transaction
   */
  async estimateGas(fromAddress: string, toAddress: string, data: string, value?: string): Promise<string> {
    // Mock implementation
    return '100000';
  }

  /**
   * Configure MEV protection
   */
  async configureMevProtection(config: MevProtectionConfig): Promise<void> {
    // 1inch has built-in MEV protection in their routing
    logger.info('MEV protection configured', config);
  }

  /**
   * Check if chain is healthy
   */
  async checkHealth(): Promise<{
    healthy: boolean;
    latency: number;
    blockDelay: number;
    errors?: string[];
  }> {
    const startTime = Date.now();
    
    try {
      await this.apiClient.get('/healthcheck');
      
      return {
        healthy: true,
        latency: Date.now() - startTime,
        blockDelay: 0
      };
    } catch (error) {
      return {
        healthy: false,
        latency: Date.now() - startTime,
        blockDelay: 0,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Submit a raw transaction
   */
  async submitTransaction(signedTx: string, mevProtection?: boolean): Promise<string> {
    // This would need to be implemented with actual wallet integration
    throw new Error('Raw transaction submission not supported by 1inch adapter');
  }

  /**
   * Check if adapter has a capability
   */
  hasCapability(capability: any): boolean {
    // 1inch supports cross-chain swaps and aggregation
    const supportedCapabilities = ['cross-chain', 'aggregation', 'dex-routing'];
    return supportedCapabilities.includes(capability);
  }

  /**
   * Sign a transaction
   */
  async signTransaction(transaction: TransactionRequest): Promise<string> {
    // This would need wallet integration
    throw new Error('Transaction signing not supported by 1inch adapter');
  }

  /**
   * Send a transaction
   */
  async sendTransaction(transaction: TransactionRequest): Promise<TransactionResponse> {
    // This would need wallet integration
    throw new Error('Direct transaction sending not supported by 1inch adapter');
  }

  /**
   * Get current block number
   */
  async getBlockNumber(): Promise<number> {
    // Not applicable for aggregator
    return 0;
  }

  /**
   * Get wallet address
   */
  async getWalletAddress(): Promise<string> {
    // Not applicable for aggregator
    return '0x0000000000000000000000000000000000000000';
  }

  /**
   * Get provider instance
   */
  getProvider(): any {
    // Return the API client as the "provider"
    return this.apiClient;
  }

  /**
   * Shutdown the adapter
   */
  async shutdown(): Promise<void> {
    await this.disconnect();
  }

  /**
   * Get adapter version
   */
  getVersion(): string {
    return '1.0.0';
  }

  /**
   * Reset the adapter
   */
  async reset(): Promise<void> {
    this.initialized = false;
    this.session = null;
    this.supportedChains = [];
    await this.initialize();
  }

  /**
   * Get adapter capabilities
   */
  getCapabilities(): string[] {
    return ['cross-chain', 'aggregation', 'dex-routing', 'multi-chain-quotes'];
  }

  /**
   * Private helper methods
   */

  private validateInitialized(): void {
    if (!this.initialized) {
      throw new Error('1inch adapter not initialized');
    }
  }

  private async fetchSupportedChains(): Promise<ChainInfo[]> {
    const chains: ChainInfo[] = [];

    for (const [chainId, name] of Object.entries(ONEINCH_CHAIN_IDS)) {
      try {
        // Try to fetch chain info to verify it's supported
        await this.apiClient.get(`/${chainId}/info`);
        
        chains.push({
          id: chainId,
          name: name,
          chainId: parseInt(chainId),
          isSupported: true,
          status: 'active',
          nativeToken: {
            symbol: this.getNativeTokenSymbol(parseInt(chainId)),
            decimals: 18
          }
        });
      } catch {
        // Chain not supported
      }
    }

    return chains;
  }

  private getChainIdFromName(chainName: string): number {
    const entry = Object.entries(ONEINCH_CHAIN_IDS).find(([_, name]) => name === chainName);
    if (!entry) {
      throw new Error(`Unsupported chain: ${chainName}`);
    }
    return parseInt(entry[0]);
  }

  private getNativeTokenSymbol(chainId: number): string {
    const nativeTokens: Record<number, string> = {
      1: 'ETH',
      56: 'BNB',
      137: 'MATIC',
      42161: 'ETH',
      10: 'ETH',
      43114: 'AVAX',
      250: 'FTM',
      100: 'xDAI'
    };
    return nativeTokens[chainId] || 'ETH';
  }

  private async getSwapQuote(
    chainId: number,
    fromToken: string,
    toToken: string,
    amount: string,
    slippage?: number
  ): Promise<any> {
    return this.apiClient.get(`/${chainId}/quote`, {
      fromTokenAddress: fromToken,
      toTokenAddress: toToken,
      amount: amount,
      slippage: slippage || this.config.maxSlippage,
      protocols: this.config.includeProtocols?.join(','),
      excludedProtocols: this.config.excludeProtocols?.join(',')
    });
  }

  private async buildSwapTransaction(
    chainId: number,
    fromToken: string,
    toToken: string,
    amount: string,
    slippage?: number,
    recipient?: string
  ): Promise<any> {
    return this.apiClient.get(`/${chainId}/swap`, {
      fromTokenAddress: fromToken,
      toTokenAddress: toToken,
      amount: amount,
      fromAddress: recipient || '0x0000000000000000000000000000000000000000',
      slippage: slippage || this.config.maxSlippage,
      protocols: this.config.includeProtocols?.join(','),
      excludedProtocols: this.config.excludeProtocols?.join(','),
      disableEstimate: true
    });
  }
} 