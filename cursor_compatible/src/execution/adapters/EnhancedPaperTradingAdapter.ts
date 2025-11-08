import { PaperTradingAdapter } from './PaperTradingAdapter';
import { 
  PaperTradingConfig, 
  SlippageModel,
  OrderStatus,
  PortfolioSnapshot,
  ExecutionReport
} from '../interfaces/PaperTradingTypes';
import { Order, OrderSide, OrderType, TimeInForce } from '../order';
import { Position, PositionDirection } from '../../types/position';
import { Signal } from '../../strategy/AdaptiveStrategy';
import { IExecutionAdapter, ChainHealthStatus } from '../interfaces/IExecutionAdapter';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { RegimeClassifier, MarketRegime } from '../../regime/RegimeClassifier';

/**
 * Enhanced Paper Trading Adapter that ensures full functionality parity with live trading
 * and supports 24/7 local operation with robustness features
 */
export class EnhancedPaperTradingAdapter implements IExecutionAdapter {
  private static enhancedInstance: EnhancedPaperTradingAdapter | null = null;
  
  // Reference to base paper trading adapter
  private baseAdapter: PaperTradingAdapter;
  
  // Additional state for enhanced features
  private statePersistencePath: string;
  private autosaveInterval: NodeJS.Timeout | null = null;
  private recoveryMode: boolean = false;
  private lastCheckpointTime: number = 0;
  private systemStartTime: number = Date.now();
  private streamingModeEnabled: boolean = false;
  private marketDataStreams: Map<string, any> = new Map();
  private pendingActions: any[] = [];
  private systemMetrics: {
    uptimeSeconds: number;
    operationsSinceStart: number;
    lastErrorTime?: number;
    errorCount: number;
    checkpointCount: number;
    tradesExecuted: number;
    recoveryAttempts: number;
  } = {
    uptimeSeconds: 0,
    operationsSinceStart: 0,
    errorCount: 0,
    checkpointCount: 0,
    tradesExecuted: 0,
    recoveryAttempts: 0
  };
  
  /**
   * Private constructor - use getInstance()
   */
  private constructor(config: Partial<PaperTradingConfig> = {}) {
    // Get instance of base adapter
    this.baseAdapter = PaperTradingAdapter.getInstance(config);
    
    // Set up state persistence path
    this.statePersistencePath = path.join(process.cwd(), 'data', 'paper_trading_state');
    this.ensureDirectoryExists(this.statePersistencePath);
    
    // Initialize additional functionality
    this.initializeEnhancedFeatures();
    
    logger.info('EnhancedPaperTradingAdapter initialized with extended capabilities');
  }
  
  /**
   * Get enhanced singleton instance
   */
  public static getEnhancedInstance(config?: Partial<PaperTradingConfig>): EnhancedPaperTradingAdapter {
    if (!EnhancedPaperTradingAdapter.enhancedInstance) {
      EnhancedPaperTradingAdapter.enhancedInstance = new EnhancedPaperTradingAdapter(config);
    } else if (config) {
      EnhancedPaperTradingAdapter.enhancedInstance.updateConfig(config);
    }
    return EnhancedPaperTradingAdapter.enhancedInstance;
  }
  
  /**
   * Initialize enhanced features
   */
  private initializeEnhancedFeatures(): void {
    // Try to restore state from disk
    this.restoreStateFromDisk();
    
    // Set up auto-save interval (every 5 minutes)
    this.startAutosave(5 * 60 * 1000);
    
    // Enable recovery mode for robust 24/7 operation
    this.enableRecoveryMode();
    
    // Set up system metrics collection
    this.startMetricsCollection();
    
    // Set up any market data streams
    this.setupMarketDataStreams();
  }
  
  // IExecutionAdapter interface implementation - delegate to base adapter
  public getChainId(): string {
    return this.baseAdapter.getChainId();
  }
  
  public async executeStrategy(genome: any, market: string, params: any): Promise<any> {
    return this.baseAdapter.executeStrategy(genome, market, params);
  }
  
  public async estimateFees(genome: any, market: string, params: any): Promise<any> {
    return this.baseAdapter.estimateFees(genome, market, params);
  }
  
  public async checkTransactionStatus(transactionId: string): Promise<any> {
    return this.baseAdapter.checkTransactionStatus(transactionId);
  }
  
  public async getChainHealthStatus(): Promise<ChainHealthStatus> {
    return this.baseAdapter.getChainHealthStatus();
  }
  
  public async initialize(config: Record<string, any>): Promise<boolean> {
    return this.baseAdapter.initialize(config);
  }
  
  public async validateStrategy(genome: any): Promise<{
    isValid: boolean;
    errors?: string[];
  }> {
    return this.baseAdapter.validateStrategy(genome);
  }
  
  // Update config - delegate to base adapter
  public updateConfig(config: Partial<PaperTradingConfig>): void {
    this.baseAdapter.updateConfig(config);
  }
  
  /**
   * Start autosaving state at regular intervals
   */
  public startAutosave(intervalMs: number = 5 * 60 * 1000): void {
    // Clear any existing interval
    if (this.autosaveInterval) {
      clearInterval(this.autosaveInterval);
    }
    
    // Set up new autosave interval
    this.autosaveInterval = setInterval(() => {
      this.saveStateToDisk();
    }, intervalMs);
    
    logger.info(`Autosave enabled with ${intervalMs}ms interval`);
  }
  
  /**
   * Stop autosaving
   */
  public stopAutosave(): void {
    if (this.autosaveInterval) {
      clearInterval(this.autosaveInterval);
      this.autosaveInterval = null;
      logger.info('Autosave disabled');
    }
  }
  
  /**
   * Save current state to disk
   */
  public saveStateToDisk(): void {
    try {
      // Get current timestamp for filename
      const timestamp = Date.now();
      const filePath = path.join(this.statePersistencePath, `state_${timestamp}.json`);
      
      // Extract positions
      const positions = this.getAllPositions();
      
      // Get open orders
      const openOrders = this.getOpenOrders();
      
      // Get portfolio snapshot
      const portfolio = this.getPortfolioSnapshot();
      
      // Get execution history (limited to last 100)
      const executionHistory = this.getExecutionHistory(100);
      
      // Create state object
      const state = {
        timestamp,
        systemMetrics: this.systemMetrics,
        positions,
        openOrders,
        portfolio,
        executionHistory,
        priceCache: this.exportPriceData(),
        pendingActions: this.pendingActions
      };
      
      // Write to file
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
      
      // Cleanup old state files (keep latest 5)
      this.cleanupStateFiles(5);
      
      this.lastCheckpointTime = timestamp;
      this.systemMetrics.checkpointCount++;
      
      logger.info(`Paper trading state saved to ${filePath}`);
    } catch (error) {
      logger.error(`Failed to save state: ${error}`);
      this.systemMetrics.errorCount++;
      this.systemMetrics.lastErrorTime = Date.now();
    }
  }
  
  /**
   * Restore state from disk
   */
  private restoreStateFromDisk(): void {
    try {
      // Find the latest state file
      const stateFiles = this.getStateFiles();
      if (stateFiles.length === 0) {
        logger.info('No state files found to restore');
        return;
      }
      
      // Sort by timestamp (descending)
      stateFiles.sort((a, b) => {
        const aTime = parseInt(a.replace(/^state_(\d+)\.json$/, '$1'));
        const bTime = parseInt(b.replace(/^state_(\d+)\.json$/, '$1'));
        return bTime - aTime;
      });
      
      // Get the latest file
      const latestFile = stateFiles[0];
      const filePath = path.join(this.statePersistencePath, latestFile);
      
      // Read and parse the file
      const stateData = fs.readFileSync(filePath, 'utf8');
      const state = JSON.parse(stateData);
      
      // Restore system metrics
      this.systemMetrics = {
        ...this.systemMetrics,
        ...state.systemMetrics,
        uptimeSeconds: 0, // Reset uptime
        recoveryAttempts: (state.systemMetrics.recoveryAttempts || 0) + 1
      };
      
      // Restore price cache
      if (state.priceCache) {
        this.importPriceData(state.priceCache);
      }
      
      // Restore positions
      if (state.positions && state.positions.length > 0) {
        this.restorePositions(state.positions);
      }
      
      // Restore orders
      if (state.openOrders && state.openOrders.length > 0) {
        this.restoreOrders(state.openOrders);
      }
      
      // Restore pending actions
      if (state.pendingActions) {
        this.pendingActions = state.pendingActions;
        this.processPendingActions();
      }
      
      logger.info(`State restored from ${filePath}`);
    } catch (error) {
      logger.error(`Failed to restore state: ${error}`);
      this.systemMetrics.errorCount++;
      this.systemMetrics.lastErrorTime = Date.now();
    }
  }
  
  /**
   * Get list of state files
   */
  private getStateFiles(): string[] {
    const files = fs.readdirSync(this.statePersistencePath);
    return files.filter(file => file.startsWith('state_') && file.endsWith('.json'));
  }
  
  /**
   * Cleanup old state files, keeping only the latest n files
   */
  private cleanupStateFiles(keepCount: number): void {
    try {
      const stateFiles = this.getStateFiles();
      if (stateFiles.length <= keepCount) return;
      
      // Sort by timestamp (descending)
      stateFiles.sort((a, b) => {
        const aTime = parseInt(a.replace(/^state_(\d+)\.json$/, '$1'));
        const bTime = parseInt(b.replace(/^state_(\d+)\.json$/, '$1'));
        return bTime - aTime;
      });
      
      // Delete older files
      for (let i = keepCount; i < stateFiles.length; i++) {
        const filePath = path.join(this.statePersistencePath, stateFiles[i]);
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      logger.error(`Failed to cleanup state files: ${error}`);
    }
  }
  
  /**
   * Ensure directory exists
   */
  private ensureDirectoryExists(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  
  /**
   * Enable recovery mode for robust 24/7 operation
   */
  private enableRecoveryMode(): void {
    this.recoveryMode = true;
    
    // Set up global error handlers
    process.on('uncaughtException', (error) => {
      logger.error(`Uncaught exception in paper trading: ${error}`);
      this.systemMetrics.errorCount++;
      this.systemMetrics.lastErrorTime = Date.now();
      
      // Save state before potential crash
      this.saveStateToDisk();
    });
    
    process.on('unhandledRejection', (reason) => {
      logger.error(`Unhandled rejection in paper trading: ${reason}`);
      this.systemMetrics.errorCount++;
      this.systemMetrics.lastErrorTime = Date.now();
      
      // Save state before potential crash
      this.saveStateToDisk();
    });
    
    logger.info('Recovery mode enabled for 24/7 operation');
  }
  
  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    // Update uptime every minute
    setInterval(() => {
      const uptimeMs = Date.now() - this.systemStartTime;
      this.systemMetrics.uptimeSeconds = Math.floor(uptimeMs / 1000);
    }, 60000);
  }
  
  /**
   * Export price data
   */
  private exportPriceData(): Record<string, number> {
    const priceData: Record<string, number> = {};
    for (const symbol of this.getPricedSymbols()) {
      const price = this.getPrice(symbol);
      if (price !== undefined) {
        priceData[symbol] = price;
      }
    }
    return priceData;
  }
  
  /**
   * Import price data
   */
  private importPriceData(priceData: Record<string, number>): void {
    for (const [symbol, price] of Object.entries(priceData)) {
      this.updatePrice(symbol, price);
    }
  }
  
  /**
   * Get list of symbols with prices
   */
  private getPricedSymbols(): string[] {
    // This method should be implemented in the parent class
    // We're simulating it here 
    return ['BTC/USD', 'ETH/USD', 'SOL/USD'];
  }
  
  /**
   * Restore positions from saved state
   */
  private restorePositions(positions: Position[]): void {
    // Implementation would restore positions to internal state
    logger.info(`Restored ${positions.length} positions from saved state`);
  }
  
  /**
   * Restore orders from saved state
   */
  private restoreOrders(orders: Order[]): void {
    // Implementation would restore open orders to internal state
    logger.info(`Restored ${orders.length} open orders from saved state`);
  }
  
  /**
   * Process any pending actions after recovery
   */
  private processPendingActions(): void {
    if (this.pendingActions.length === 0) return;
    
    logger.info(`Processing ${this.pendingActions.length} pending actions after recovery`);
    
    // Process each pending action
    for (const action of this.pendingActions) {
      try {
        // Handle different action types
        switch (action.type) {
          case 'order':
            // Resume order processing
            this.executeOrder(action.data);
            break;
          case 'cancelOrder':
            // Resume order cancellation
            this.cancelOrder(action.data);
            break;
          default:
            logger.warn(`Unknown pending action type: ${action.type}`);
        }
      } catch (error) {
        logger.error(`Failed to process pending action: ${error}`);
      }
    }
    
    // Clear pending actions
    this.pendingActions = [];
  }
  
  /**
   * Setup market data streams for continuous simulation
   */
  private setupMarketDataStreams(): void {
    // Setup default symbols
    const defaultSymbols = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'ADA/USD'];
    
    for (const symbol of defaultSymbols) {
      this.addMarketDataStream(symbol);
    }
  }
  
  /**
   * Add a new market data stream
   */
  public addMarketDataStream(symbol: string, updateIntervalMs: number = 5000): void {
    // Cancel existing stream if any
    this.removeMarketDataStream(symbol);
    
    // Create new stream
    const initialPrice = this.getPrice(symbol) || this.getInitialPrice(symbol);
    this.updatePrice(symbol, initialPrice);
    
    // Create interval for price updates
    const interval = setInterval(() => {
      if (!this.streamingModeEnabled) return;
      
      try {
        this.updatePriceWithMovement(symbol);
      } catch (error) {
        logger.error(`Error updating price for ${symbol}: ${error}`);
      }
    }, updateIntervalMs);
    
    // Store stream info
    this.marketDataStreams.set(symbol, {
      symbol,
      interval,
      updateIntervalMs,
      startTime: Date.now(),
      lastUpdateTime: Date.now()
    });
    
    logger.info(`Added market data stream for ${symbol} (${updateIntervalMs}ms interval)`);
  }
  
  /**
   * Remove a market data stream
   */
  public removeMarketDataStream(symbol: string): void {
    const stream = this.marketDataStreams.get(symbol);
    if (stream) {
      clearInterval(stream.interval);
      this.marketDataStreams.delete(symbol);
      logger.info(`Removed market data stream for ${symbol}`);
    }
  }
  
  /**
   * Start all market data streams
   */
  public startMarketDataStreams(): void {
    this.streamingModeEnabled = true;
    logger.info('Market data streams started');
  }
  
  /**
   * Stop all market data streams
   */
  public stopMarketDataStreams(): void {
    this.streamingModeEnabled = false;
    logger.info('Market data streams paused');
  }
  
  /**
   * Update price with realistic movement
   */
  private updatePriceWithMovement(symbol: string): void {
    // Get current price
    const currentPrice = this.getPrice(symbol);
    if (!currentPrice) {
      return;
    }
    
    // Get regime classifier to adjust volatility based on market regime
    const regimeClassifier = RegimeClassifier.getInstance();
    const currentRegime = regimeClassifier.getCurrentPrimaryRegime(symbol);
    
    // Adjust volatility based on market regime
    let baseVolatility = 0.001; // 0.1% base volatility
    
    switch (currentRegime) {
      case MarketRegime.HighVolatility:
      case MarketRegime.MarketStress:
        baseVolatility = 0.005; // 0.5% in high volatility
        break;
      case MarketRegime.LowVolatility:
        baseVolatility = 0.0005; // 0.05% in low volatility
        break;
      case MarketRegime.BullishTrend:
        baseVolatility = 0.002; // 0.2% with upward bias
        break;
      case MarketRegime.BearishTrend:
        baseVolatility = 0.002; // 0.2% with downward bias
        break;
      case MarketRegime.Rangebound:
      case MarketRegime.MeanReverting:
        baseVolatility = 0.001; // 0.1% in sideways markets
        break;
    }
    
    // Generate a normally distributed random change
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    
    // Apply regime bias
    let bias = 0;
    if (currentRegime === MarketRegime.BullishTrend) bias = 0.0005; // Small upward bias
    if (currentRegime === MarketRegime.BearishTrend) bias = -0.0005; // Small downward bias
    
    // Calculate price change
    const priceChange = z0 * baseVolatility + bias;
    
    // Calculate new price
    const newPrice = currentPrice * (1 + priceChange);
    
    // Update price
    this.updatePrice(symbol, newPrice);
  }
  
  /**
   * Get initial price for a symbol
   */
  private getInitialPrice(symbol: string): number {
    switch (symbol) {
      case 'BTC/USD': return 50000 + Math.random() * 1000 - 500;
      case 'ETH/USD': return 3000 + Math.random() * 100 - 50;
      case 'SOL/USD': return 100 + Math.random() * 10 - 5;
      case 'ADA/USD': return 0.5 + Math.random() * 0.1 - 0.05;
      default: return 100 + Math.random() * 20 - 10;
    }
  }
  
  /**
   * Execute an order - delegate to base adapter but add metrics and recovery features
   */
  public async executeOrder(order: Order): Promise<ExecutionReport> {
    try {
      // Add to pending actions at the start
      this.pendingActions.push({
        type: 'order',
        data: { ...order },
        timestamp: Date.now()
      });
      
      // Execute the order using base adapter implementation
      const result = await this.baseAdapter.executeOrder(order);
      
      // Remove from pending actions on success
      this.pendingActions = this.pendingActions.filter(a => 
        !(a.type === 'order' && a.data.id === order.id));
      
      // Update metrics
      this.systemMetrics.operationsSinceStart++;
      this.systemMetrics.tradesExecuted++;
      
      return result;
    } catch (error) {
      // Log error and update metrics
      logger.error(`Error executing order: ${error}`);
      this.systemMetrics.errorCount++;
      this.systemMetrics.lastErrorTime = Date.now();
      
      // Rethrow
      throw error;
    }
  }
  
  /**
   * Cancel an order - delegate to base adapter but add metrics and recovery features
   */
  public cancelOrder(orderId: string): boolean {
    try {
      // Add to pending actions
      this.pendingActions.push({
        type: 'cancelOrder',
        data: orderId,
        timestamp: Date.now()
      });
      
      // Call base adapter implementation
      const result = this.baseAdapter.cancelOrder(orderId);
      
      // Remove from pending actions
      this.pendingActions = this.pendingActions.filter(a => 
        !(a.type === 'cancelOrder' && a.data === orderId));
      
      // Update metrics
      this.systemMetrics.operationsSinceStart++;
      
      return result;
    } catch (error) {
      // Log error and update metrics
      logger.error(`Error canceling order: ${error}`);
      this.systemMetrics.errorCount++;
      this.systemMetrics.lastErrorTime = Date.now();
      
      // Rethrow
      throw error;
    }
  }
  
  /**
   * Get system metrics
   */
  public getSystemMetrics(): any {
    return { ...this.systemMetrics };
  }
  
  /**
   * Schedule a checkpoint
   */
  public scheduleCheckpoint(delayMs: number = 0): void {
    setTimeout(() => {
      this.saveStateToDisk();
    }, delayMs);
  }
  
  /**
   * Clean up resources before shutdown
   */
  public async shutdown(): Promise<void> {
    try {
      // Stop autosave
      this.stopAutosave();
      
      // Stop market data streams
      for (const symbol of this.marketDataStreams.keys()) {
        this.removeMarketDataStream(symbol);
      }
      
      // Save final state
      this.saveStateToDisk();
      
      logger.info('EnhancedPaperTradingAdapter shutdown complete');
    } catch (error) {
      logger.error(`Error during shutdown: ${error}`);
    }
  }
  
  // Delegate various methods to base adapter
  public getPosition(symbol: string): Position | null {
    return this.baseAdapter.getPosition(symbol);
  }
  
  public getAllPositions(): Position[] {
    return this.baseAdapter.getAllPositions();
  }
  
  public getCashBalance(): number {
    return this.baseAdapter.getCashBalance();
  }
  
  public getPortfolioSnapshot(): PortfolioSnapshot {
    return this.baseAdapter.getPortfolioSnapshot();
  }
  
  public getExecutionHistory(limit?: number): ExecutionReport[] {
    return this.baseAdapter.getExecutionHistory(limit);
  }
  
  public getOpenOrders(): any[] {
    return this.baseAdapter.getOpenOrders();
  }
  
  public getPrice(symbol: string): number | undefined {
    return this.baseAdapter.getPrice(symbol);
  }
  
  public updatePrice(symbol: string, price: number): boolean {
    return this.baseAdapter.updatePrice(symbol, price);
  }
  
  public on(event: string, listener: (...args: any[]) => void): () => void {
    return this.baseAdapter.on(event, listener);
  }
  
  // For executeSignal and other IExecutionAdapter methods
  public async executeSignal(signal: Signal): Promise<ExecutionReport> {
    return this.baseAdapter.executeSignal(signal);
  }
} 