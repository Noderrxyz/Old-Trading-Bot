import { 
  IChainAdapter, 
  Asset, 
  TradeOrder, 
  TradeResult,
  createAdapter
} from '../../index';

/**
 * A simplified mock of a trading engine to test adapter integration
 */
export class MockTradingEngine {
  private adapters: Map<number, IChainAdapter> = new Map();
  private isRunning: boolean = false;
  private pendingOrders: TradeOrder[] = [];
  private completedTrades: TradeResult[] = [];
  private failedTrades: TradeResult[] = [];
  
  /**
   * Create a new mock trading engine
   * @param autoInitialize If true, the engine will automatically initialize adapters when start is called
   */
  constructor(private autoInitialize: boolean = true) {}
  
  /**
   * Register an adapter for a specific chain
   * @param chainId The chain ID to register the adapter for
   * @param adapter The adapter instance
   */
  public registerAdapter(chainId: number, adapter: IChainAdapter): void {
    this.adapters.set(chainId, adapter);
  }
  
  /**
   * Register multiple adapters using the chain IDs provided
   * @param chainIds Array of chain IDs to register adapters for
   * @param config Optional configuration to pass to the adapters
   */
  public async registerAdaptersFromChainIds(chainIds: number[], config?: any): Promise<void> {
    for (const chainId of chainIds) {
      try {
        const adapter = createAdapter(chainId, config);
        this.registerAdapter(chainId, adapter);
      } catch (error) {
        console.error(`Failed to create adapter for chain ID ${chainId}:`, error);
      }
    }
  }
  
  /**
   * Start the trading engine and connect all registered adapters
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Trading engine is already running');
    }
    
    if (this.adapters.size === 0) {
      throw new Error('No adapters registered');
    }
    
    // Initialize and connect all adapters
    const initPromises: Promise<void>[] = [];
    
    for (const [chainId, adapter] of this.adapters.entries()) {
      if (this.autoInitialize) {
        initPromises.push(
          adapter.initialize({})
            .then(() => adapter.connect())
            .catch(error => {
              console.error(`Failed to initialize/connect adapter for chain ID ${chainId}:`, error);
              // Remove failed adapter
              this.adapters.delete(chainId);
            })
        );
      }
    }
    
    await Promise.all(initPromises);
    
    if (this.adapters.size === 0) {
      throw new Error('All adapters failed to initialize');
    }
    
    this.isRunning = true;
    console.log('Trading engine started with adapters for chains:', Array.from(this.adapters.keys()));
  }
  
  /**
   * Stop the trading engine and disconnect all adapters
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    
    const shutdownPromises: Promise<void>[] = [];
    
    for (const [chainId, adapter] of this.adapters.entries()) {
      shutdownPromises.push(
        adapter.shutdown()
          .catch(error => {
            console.error(`Failed to shutdown adapter for chain ID ${chainId}:`, error);
          })
      );
    }
    
    await Promise.all(shutdownPromises);
    this.isRunning = false;
    console.log('Trading engine stopped');
  }
  
  /**
   * Submit a trade order to be executed
   * @param order The trade order to execute
   */
  public async submitOrder(order: TradeOrder): Promise<TradeResult> {
    if (!this.isRunning) {
      throw new Error('Trading engine is not running');
    }
    
    const adapter = this.adapters.get(order.fromAsset.chainId);
    if (!adapter) {
      const failedResult: TradeResult = {
        success: false,
        order: {
          ...order,
          status: 'failed'
        },
        timestamp: Date.now(),
        failureReason: `No adapter registered for chain ID ${order.fromAsset.chainId}`
      };
      this.failedTrades.push(failedResult);
      return failedResult;
    }
    
    // Check if assets are on the same chain
    if (order.fromAsset.chainId !== order.toAsset.chainId) {
      throw new Error('Cross-chain trades not supported in mock engine');
    }
    
    try {
      this.pendingOrders.push(order);
      const result = await adapter.executeTrade(order);
      
      if (result.success) {
        this.completedTrades.push(result);
      } else {
        this.failedTrades.push(result);
      }
      
      // Remove from pending
      this.pendingOrders = this.pendingOrders.filter(o => o.id !== order.id);
      
      return result;
    } catch (error) {
      const failedResult: TradeResult = {
        success: false,
        order: {
          ...order,
          status: 'failed'
        },
        timestamp: Date.now(),
        failureReason: error instanceof Error ? error.message : String(error)
      };
      this.failedTrades.push(failedResult);
      
      // Remove from pending
      this.pendingOrders = this.pendingOrders.filter(o => o.id !== order.id);
      
      return failedResult;
    }
  }
  
  /**
   * Get a price quote for a potential trade
   * @param fromAsset Source asset
   * @param toAsset Destination asset
   * @param amount Amount to trade
   */
  public async getQuote(fromAsset: Asset, toAsset: Asset, amount: string): Promise<{
    expectedOutput: string;
    priceImpact: number;
    route?: string[];
  }> {
    if (!this.isRunning) {
      throw new Error('Trading engine is not running');
    }
    
    const adapter = this.adapters.get(fromAsset.chainId);
    if (!adapter) {
      throw new Error(`No adapter registered for chain ID ${fromAsset.chainId}`);
    }
    
    // Check if assets are on the same chain
    if (fromAsset.chainId !== toAsset.chainId) {
      throw new Error('Cross-chain quotes not supported in mock engine');
    }
    
    return adapter.getQuote(fromAsset, toAsset, amount);
  }
  
  /**
   * Get the status of all connected adapters
   */
  public async getStatus(): Promise<{
    isRunning: boolean;
    registeredChains: number[];
    adapterStatuses: Record<number, any>;
    pendingOrders: number;
    completedTrades: number;
    failedTrades: number;
  }> {
    const adapterStatuses: Record<number, any> = {};
    
    for (const [chainId, adapter] of this.adapters.entries()) {
      try {
        adapterStatuses[chainId] = await adapter.getStatus();
      } catch (error) {
        adapterStatuses[chainId] = {
          isConnected: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
    
    return {
      isRunning: this.isRunning,
      registeredChains: Array.from(this.adapters.keys()),
      adapterStatuses,
      pendingOrders: this.pendingOrders.length,
      completedTrades: this.completedTrades.length,
      failedTrades: this.failedTrades.length
    };
  }
  
  /**
   * Get the balance of an address on a specific chain
   * @param chainId Chain ID to check balance on
   * @param address Wallet address to check
   * @param asset Optional asset to check balance for
   */
  public async getBalance(chainId: number, address: string, asset?: Asset): Promise<string> {
    if (!this.isRunning) {
      throw new Error('Trading engine is not running');
    }
    
    const adapter = this.adapters.get(chainId);
    if (!adapter) {
      throw new Error(`No adapter registered for chain ID ${chainId}`);
    }
    
    return adapter.getBalance(address, asset);
  }
  
  /**
   * Get the history of completed trades
   */
  public getCompletedTrades(): TradeResult[] {
    return [...this.completedTrades];
  }
  
  /**
   * Get the history of failed trades
   */
  public getFailedTrades(): TradeResult[] {
    return [...this.failedTrades];
  }
} 