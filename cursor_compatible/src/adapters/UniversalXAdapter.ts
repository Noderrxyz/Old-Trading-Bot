import { BaseChainAdapter, ChainAdapterConfig } from './BaseChainAdapter';
import { 
  ICrossChainAdapter, 
  Session, 
  AccountStatus, 
  CrossChainSwapParams, 
  SwapResult, 
  FeeEstimate, 
  ChainInfo, 
  TransactionStatus 
} from './interfaces/ICrossChainAdapter';
import { 
  IChainAdapter,
  Asset,
  AssetInfo,
  TradeOrder,
  TradeResult,
  TransactionRequest,
  TransactionResponse,
  GasEstimate,
  NetworkStatus,
  TradeRequest,
  TradeOptions,
  ChainAdapterStatus,
  AdapterCapability,
  ExecutionResult,
  ExecutionParams,
  MevProtectionConfig
} from './IChainAdapter';
import { UnifiedMarketData } from '../types/UnifiedMarketData.types';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { createLogger } from '../common/logger';
import axios, { AxiosInstance } from 'axios';

const logger = createLogger('UniversalXAdapter');

/**
 * UniversalX configuration
 */
export interface UniversalXConfig extends Partial<ChainAdapterConfig> {
  apiUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  environment?: 'mainnet' | 'testnet' | 'sandbox';
}

/**
 * UniversalXAdapter - Adapter for UniversalX (Particle Network) cross-chain execution
 * 
 * This adapter provides seamless cross-chain trading capabilities through UniversalX's
 * universal account system, eliminating the need for manual bridging.
 */
export class UniversalXAdapter extends BaseChainAdapter implements ICrossChainAdapter {
  public readonly name = 'UniversalX';
  public readonly chainId = 'universalx';
  
  private apiClient: AxiosInstance;
  private session: Session | null = null;
  private telemetryBus: TelemetryBus;
  private sessionRefreshTimer?: NodeJS.Timeout;
  private accountStatus: AccountStatus | null = null;
  private supportedChains: ChainInfo[] = [];
  
  constructor(config: UniversalXConfig = {}) {
    // UniversalX is a meta-adapter that works across chains, so we use a special chain ID
    const baseConfig: ChainAdapterConfig = {
      chainId: 0, // Chain ID 0 indicates cross-chain
      networkName: 'UniversalX',
      rpcUrl: config.apiUrl || process.env.UNIVERSALX_API_URL || 'https://api.universalx.app/v1',
      isMainnet: config.environment !== 'testnet' && config.environment !== 'sandbox',
      apiKey: config.apiKey || process.env.UNIVERSALX_API_KEY || '',
      ...config
    };
    
    super(baseConfig);
    
    this._name = 'UniversalX';
    this.telemetryBus = TelemetryBus.getInstance();
    
    // Initialize API client
    this.apiClient = axios.create({
      baseURL: this.config.rpcUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey
      }
    });
    
    // Add request/response interceptors for logging and error handling
    this.setupInterceptors();
  }
  
  /**
   * Setup axios interceptors for request/response handling
   */
  private setupInterceptors(): void {
    // Request interceptor
    this.apiClient.interceptors.request.use(
      (config) => {
        // Add authentication header if we have a session
        if (this.session?.token) {
          config.headers['Authorization'] = `Bearer ${this.session.token}`;
        }
        
        // Log request (without sensitive data)
        logger.debug('UniversalX API Request', {
          method: config.method,
          url: config.url,
          params: config.params
        });
        
        return config;
      },
      (error) => {
        logger.error('UniversalX Request Error', error);
        return Promise.reject(error);
      }
    );
    
    // Response interceptor
    this.apiClient.interceptors.response.use(
      (response) => {
        logger.debug('UniversalX API Response', {
          status: response.status,
          url: response.config.url
        });
        return response;
      },
      async (error) => {
        const originalRequest = error.config;
        
        // Handle 401 errors by refreshing the session
        if (error.response?.status === 401 && !originalRequest._retry && this.session) {
          originalRequest._retry = true;
          
          try {
            await this.refreshSession(this.session);
            return this.apiClient(originalRequest);
          } catch (refreshError) {
            logger.error('Failed to refresh session', refreshError);
            this.session = null;
          }
        }
        
        logger.error('UniversalX Response Error', {
          status: error.response?.status,
          message: error.response?.data?.message || error.message
        });
        
        return Promise.reject(error);
      }
    );
  }
  
  /**
   * Implementation-specific initialization
   */
  protected async initializeImpl(): Promise<void> {
    try {
      logger.info('Initializing UniversalX adapter');
      
      // Authenticate with UniversalX
      await this.authenticate({
        apiKey: this.config.apiKey,
        apiSecret: (this.config as any).apiSecret || process.env.UNIVERSALX_API_SECRET || ''
      });
      
      // Fetch supported chains
      this.supportedChains = await this.getSupportedChains();
      
      // Get initial account status
      this.accountStatus = await this.getUniversalAccountStatus();
      
      // Set up session refresh timer
      this.setupSessionRefresh();
      
      // Add capabilities
      this.addCapability(AdapterCapability.TRADING);
      this.addCapability(AdapterCapability.CROSS_CHAIN);
      this.addCapability(AdapterCapability.UNIVERSAL_ACCOUNT);
      
      // Emit telemetry
      this.telemetryBus.emit('adapter_initialized', {
        timestamp: Date.now(),
        adapter: 'UniversalX',
        supportedChains: this.supportedChains.length,
        accountActive: this.accountStatus.isActive
      });
      
      logger.info('UniversalX adapter initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize UniversalX adapter', error);
      throw error;
    }
  }
  
  /**
   * Implementation-specific connection logic
   */
  protected async connectImpl(): Promise<void> {
    // Connection is handled during initialization for UniversalX
    logger.info('UniversalX adapter connected');
  }
  
  /**
   * Implementation-specific disconnection logic
   */
  protected async disconnectImpl(): Promise<void> {
    if (this.sessionRefreshTimer) {
      clearInterval(this.sessionRefreshTimer);
    }
    this.session = null;
    logger.info('UniversalX adapter disconnected');
  }
  
  /**
   * Implementation-specific shutdown logic
   */
  protected async shutdownImpl(): Promise<void> {
    if (this.sessionRefreshTimer) {
      clearInterval(this.sessionRefreshTimer);
    }
    this.session = null;
    this.accountStatus = null;
    this.supportedChains = [];
    logger.info('UniversalX adapter shut down');
  }
  
  /**
   * Implementation-specific status information
   */
  protected async getStatusImpl(): Promise<Partial<ChainAdapterStatus>> {
    const health = await this.checkHealth();
    return {
      blockHeight: 0, // Not applicable for cross-chain adapter
      gasPrice: '0',
      baseFeePerGas: '0',
      syncStatus: health.healthy ? 'synced' : 'stalled',
      connectedNode: this.config.rpcUrl,
      protocolVersion: '1.0.0'
    };
  }
  
  /**
   * Implementation-specific reset logic
   */
  protected async resetImpl(): Promise<void> {
    this.session = null;
    this.accountStatus = null;
    this.supportedChains = [];
    logger.info('UniversalX adapter reset');
  }
  
  /**
   * Calculate block delay (not applicable for cross-chain adapter)
   */
  protected async calculateBlockDelay(currentBlockHeight: number): Promise<number> {
    return 0; // No block delay for cross-chain adapter
  }
  
  /**
   * Configure MEV protection (handled internally by UniversalX)
   */
  protected async configureMevProtectionImpl(config: MevProtectionConfig): Promise<void> {
    logger.info('MEV protection is handled internally by UniversalX');
  }
  
  /**
   * Authenticate with UniversalX
   */
  async authenticate(credentials: Record<string, any>): Promise<Session> {
    try {
      const response = await this.apiClient.post('/auth/login', {
        apiKey: credentials.apiKey,
        apiSecret: credentials.apiSecret
      });
      
      this.session = {
        id: response.data.sessionId,
        token: response.data.token,
        expiresAt: response.data.expiresAt,
        refreshToken: response.data.refreshToken,
        accountId: response.data.accountId
      };
      
      logger.info('Successfully authenticated with UniversalX');
      return this.session;
    } catch (error: any) {
      logger.error('Authentication failed', error);
      throw new Error(`UniversalX authentication failed: ${error.message}`);
    }
  }
  
  /**
   * Get universal account status
   */
  async getUniversalAccountStatus(): Promise<AccountStatus> {
    try {
      const response = await this.apiClient.get('/account/status');
      
      this.accountStatus = {
        accountId: response.data.accountId,
        isActive: response.data.isActive,
        chains: response.data.chains,
        totalValueUSD: response.data.totalValueUSD,
        lastUpdated: Date.now()
      };
      
      return this.accountStatus;
    } catch (error: any) {
      logger.error('Failed to get account status', error);
      throw new Error(`Failed to get account status: ${error.message}`);
    }
  }
  
  /**
   * Execute a cross-chain swap
   */
  async executeCrossChainSwap(params: CrossChainSwapParams): Promise<SwapResult> {
    const startTime = Date.now();
    
    try {
      logger.info('Executing cross-chain swap', {
        fromChain: params.fromChain,
        toChain: params.toChain,
        fromToken: params.fromToken,
        toToken: params.toToken,
        amount: params.amount
      });
      
      // First, get a quote
      const quote = await this.apiClient.post('/swap/quote', params);
      
      // Execute the swap
      const response = await this.apiClient.post('/swap/execute', {
        quoteId: quote.data.quoteId,
        ...params
      });
      
      const result: SwapResult = {
        success: true,
        transactionHash: response.data.transactionHash,
        fromChainTxHash: response.data.fromChainTxHash,
        toChainTxHash: response.data.toChainTxHash,
        status: 'pending',
        estimatedTime: response.data.estimatedTime,
        fromAmount: params.amount,
        toAmount: response.data.expectedOutput,
        fee: response.data.fee,
        route: response.data.route
      };
      
      // Emit telemetry
      this.telemetryBus.emit('cross_chain_swap_executed', {
        timestamp: Date.now(),
        adapter: 'UniversalX',
        ...params,
        executionTime: Date.now() - startTime,
        result
      });
      
      return result;
    } catch (error: any) {
      logger.error('Cross-chain swap failed', error);
      
      const result: SwapResult = {
        success: false,
        status: 'failed',
        fromAmount: params.amount,
        toAmount: '0',
        fee: { total: '0' },
        error: error.message
      };
      
      // Emit telemetry for failed swap
      this.telemetryBus.emit('cross_chain_swap_failed', {
        timestamp: Date.now(),
        adapter: 'UniversalX',
        ...params,
        executionTime: Date.now() - startTime,
        error: error.message
      });
      
      return result;
    }
  }
  
  /**
   * Estimate fees for cross-chain operation
   */
  async estimateCrossChainFees(params: CrossChainSwapParams): Promise<FeeEstimate> {
    try {
      const response = await this.apiClient.post('/swap/estimate', params);
      
      return {
        totalFee: response.data.totalFee,
        bridgeFee: response.data.bridgeFee,
        gasFee: response.data.gasFee,
        protocolFee: response.data.protocolFee,
        estimatedTime: response.data.estimatedTime,
        priceImpact: response.data.priceImpact
      };
    } catch (error: any) {
      logger.error('Failed to estimate fees', error);
      throw new Error(`Failed to estimate fees: ${error.message}`);
    }
  }
  
  /**
   * Get supported chains
   */
  async getSupportedChains(): Promise<ChainInfo[]> {
    try {
      const response = await this.apiClient.get('/chains');
      return response.data.chains;
    } catch (error: any) {
      logger.error('Failed to get supported chains', error);
      throw new Error(`Failed to get supported chains: ${error.message}`);
    }
  }
  
  /**
   * Get transaction status
   */
  async getTransactionStatus(txId: string): Promise<TransactionStatus> {
    try {
      const response = await this.apiClient.get(`/transaction/${txId}`);
      
      return {
        transactionId: txId,
        status: response.data.status,
        confirmations: response.data.confirmations,
        blockNumber: response.data.blockNumber,
        timestamp: response.data.timestamp
      };
    } catch (error: any) {
      logger.error('Failed to get transaction status', error);
      throw new Error(`Failed to get transaction status: ${error.message}`);
    }
  }
  
  /**
   * Refresh authentication session
   */
  async refreshSession(session: Session): Promise<Session> {
    try {
      const response = await this.apiClient.post('/auth/refresh', {
        refreshToken: session.refreshToken
      });
      
      this.session = {
        id: response.data.sessionId,
        token: response.data.token,
        expiresAt: response.data.expiresAt,
        refreshToken: response.data.refreshToken,
        accountId: response.data.accountId
      };
      
      return this.session;
    } catch (error: any) {
      logger.error('Failed to refresh session', error);
      throw new Error(`Failed to refresh session: ${error.message}`);
    }
  }
  
  /**
   * Fund the universal account
   */
  async fundAccount(chainId: string, token: string, amount: string): Promise<TransactionResponse> {
    try {
      const response = await this.apiClient.post('/account/fund', {
        chainId,
        token,
        amount
      });
      
      // Create a transaction response compatible with IChainAdapter
      return {
        hash: response.data.transactionHash,
        confirmations: 0,
        from: response.data.from,
        to: response.data.to,
        wait: async (confirmations?: number) => {
          // Poll for transaction confirmation
          let status = await this.getTransactionStatus(response.data.transactionHash);
          while (status.status === 'pending') {
            await new Promise(resolve => setTimeout(resolve, 5000));
            status = await this.getTransactionStatus(response.data.transactionHash);
          }
          
          return {
            txHash: response.data.transactionHash,
            blockNumber: status.blockNumber!,
            blockHash: '',
            from: response.data.from,
            to: response.data.to,
            status: status.status === 'confirmed' ? 'success' : 'failure',
            gasUsed: response.data.gasUsed || '0',
            effectiveGasPrice: response.data.gasPrice || '0',
            logs: [],
            confirmations: status.confirmations || 0
          };
        }
      };
    } catch (error: any) {
      logger.error('Failed to fund account', error);
      throw new Error(`Failed to fund account: ${error.message}`);
    }
  }
  
  /**
   * Setup session refresh timer
   */
  private setupSessionRefresh(): void {
    if (this.sessionRefreshTimer) {
      clearInterval(this.sessionRefreshTimer);
    }
    
    // Refresh session 5 minutes before expiry
    if (this.session) {
      const refreshInterval = Math.max(
        (this.session.expiresAt - Date.now() - 5 * 60 * 1000) / 2,
        60000 // Minimum 1 minute
      );
      
      this.sessionRefreshTimer = setInterval(async () => {
        if (this.session && Date.now() > this.session.expiresAt - 5 * 60 * 1000) {
          try {
            await this.refreshSession(this.session);
          } catch (error) {
            logger.error('Failed to refresh session automatically', error);
          }
        }
      }, refreshInterval);
    }
  }
  
  // Implement required IChainAdapter methods
  
  async getBalance(address: string, asset?: Asset): Promise<string> {
    try {
      const response = await this.apiClient.get('/account/balance', {
        params: {
          address,
          token: asset?.symbol
        }
      });
      return response.data.balance;
    } catch (error) {
      logger.error('Failed to get balance', error);
      throw error;
    }
  }
  
  async executeTrade(order: TradeOrder): Promise<TradeResult> {
    // Convert TradeOrder to CrossChainSwapParams
    const params: CrossChainSwapParams = {
      fromChain: order.fromAsset.chainId.toString(),
      toChain: order.toAsset.chainId.toString(),
      fromToken: order.fromAsset.address || order.fromAsset.symbol,
      toToken: order.toAsset.address || order.toAsset.symbol,
      amount: order.amount,
      slippageTolerance: order.slippageTolerance,
      deadline: order.deadline
    };
    
    const swapResult = await this.executeCrossChainSwap(params);
    
    return {
      success: swapResult.success,
      order,
      txHash: swapResult.transactionHash,
      amountOut: swapResult.toAmount,
      fees: {
        networkFee: swapResult.fee.gasFee || '0',
        protocolFee: swapResult.fee.protocolFee,
        otherFees: swapResult.fee.breakdown
      },
      timestamp: Date.now(),
      failureReason: swapResult.error,
      route: swapResult.route,
      executionTime: swapResult.actualTime
    };
  }
  
  async getMarketData(symbol: string): Promise<UnifiedMarketData> {
    // UniversalX doesn't provide market data directly
    throw new Error('Market data not available through UniversalX adapter');
  }
  
  async getQuote(fromAsset: Asset, toAsset: Asset, amount: string): Promise<{
    expectedOutput: string;
    priceImpact: number;
    route?: string[];
  }> {
    const params: CrossChainSwapParams = {
      fromChain: fromAsset.chainId.toString(),
      toChain: toAsset.chainId.toString(),
      fromToken: fromAsset.address || fromAsset.symbol,
      toToken: toAsset.address || toAsset.symbol,
      amount
    };
    
    const response = await this.apiClient.post('/swap/quote', params);
    
    return {
      expectedOutput: response.data.expectedOutput,
      priceImpact: response.data.priceImpact,
      route: response.data.route
    };
  }
  
  async getAssetInfo(asset: Asset): Promise<AssetInfo> {
    // Return basic asset info
    return {
      ...asset,
      verified: true,
      contractType: asset.isNative ? 'NATIVE' : 'ERC20'
    };
  }
  
  async getGasPrice(): Promise<GasEstimate> {
    // UniversalX handles gas internally
    return {
      slow: { gasPrice: '0', estimatedTimeMs: 60000 },
      average: { gasPrice: '0', estimatedTimeMs: 30000 },
      fast: { gasPrice: '0', estimatedTimeMs: 10000 },
      isEip1559Supported: false,
      lastUpdated: Date.now()
    };
  }
  
  async estimateGas(fromAddress: string, toAddress: string, data: string, value?: string): Promise<string> {
    // UniversalX handles gas estimation internally
    return '0';
  }
  
  async checkHealth(): Promise<{
    healthy: boolean;
    latency: number;
    blockDelay: number;
    errors?: string[];
  }> {
    const startTime = Date.now();
    try {
      await this.apiClient.get('/health');
      return {
        healthy: true,
        latency: Date.now() - startTime,
        blockDelay: 0
      };
    } catch (error: any) {
      return {
        healthy: false,
        latency: Date.now() - startTime,
        blockDelay: 0,
        errors: [error.message]
      };
    }
  }
  
  async submitTransaction(signedTx: string, mevProtection?: boolean): Promise<string> {
    // UniversalX handles transaction submission internally
    throw new Error('Direct transaction submission not supported by UniversalX');
  }
  
  async getNetworkStatus(): Promise<NetworkStatus> {
    const health = await this.checkHealth();
    return {
      networkName: 'UniversalX',
      chainId: 0,
      isConnected: health.healthy,
      latestBlock: 0,
      blockTime: 0,
      gasPrice: BigInt(0),
      maxPriorityFeePerGas: null,
      maxFeePerGas: null,
      baseFeePerGas: null,
      congestion: 'unknown',
      timestamp: Date.now()
    };
  }
  
  async submitTrade(request: TradeRequest, options?: TradeOptions): Promise<TransactionResponse> {
    const params: CrossChainSwapParams = {
      fromChain: request.fromAsset.chainId.toString(),
      toChain: request.toAsset.chainId.toString(),
      fromToken: request.fromAsset.address || request.fromAsset.symbol,
      toToken: request.toAsset.address || request.toAsset.symbol,
      amount: request.amount,
      slippageTolerance: options?.slippageTolerance || request.slippageTolerance,
      recipient: request.recipient,
      deadline: options?.deadline || request.deadline
    };
    
    const swapResult = await this.executeCrossChainSwap(params);
    
    return {
      hash: swapResult.transactionHash!,
      confirmations: 0,
      from: this.accountStatus?.accountId || '',
      to: request.recipient || this.accountStatus?.accountId || '',
      wait: async () => {
        let status = await this.getTransactionStatus(swapResult.transactionHash!);
        while (status.status === 'pending') {
          await new Promise(resolve => setTimeout(resolve, 5000));
          status = await this.getTransactionStatus(swapResult.transactionHash!);
        }
        
        return {
          txHash: swapResult.transactionHash!,
          blockNumber: status.blockNumber || 0,
          blockHash: '',
          from: this.accountStatus?.accountId || '',
          to: request.recipient || this.accountStatus?.accountId || '',
          status: status.status === 'confirmed' ? 'success' : 'failure',
          gasUsed: swapResult.fee.gasFee || '0',
          effectiveGasPrice: '0',
          logs: [],
          confirmations: status.confirmations || 0
        };
      }
    };
  }
  
  async signTransaction(transaction: TransactionRequest): Promise<string> {
    throw new Error('Direct transaction signing not supported by UniversalX');
  }
  
  async sendTransaction(transaction: TransactionRequest): Promise<TransactionResponse> {
    throw new Error('Direct transaction sending not supported by UniversalX');
  }
  
  async getBlockNumber(): Promise<number> {
    return 0; // Not applicable for cross-chain adapter
  }
  
  async getWalletAddress(): Promise<string> {
    return this.accountStatus?.accountId || '';
  }
  
  getProvider(): any {
    return null; // No direct provider for UniversalX
  }
  
  async close(): Promise<void> {
    await this.disconnect();
  }
} 