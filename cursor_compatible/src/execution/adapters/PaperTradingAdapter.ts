import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { IExecutionAdapter, ExecutionParams, ExecutionResult, FeeEstimation, ChainHealthStatus } from '../interfaces/IExecutionAdapter';
import { 
  PaperTradingConfig, 
  DEFAULT_PAPER_TRADING_CONFIG,
  PaperOrder,
  OrderStatus,
  SlippageModel,
  ExecutionReport,
  PositionUpdateEvent,
  PortfolioSnapshot,
  OrderFill
} from '../interfaces/PaperTradingTypes';
import { Order, OrderSide, OrderType } from '../order';
import { Position, PositionDirection } from '../../types/position';
import { Signal } from '../../strategy/AdaptiveStrategy';
import { StrategyGenome } from '../../evolution/StrategyGenome';
import { logger } from '../../utils/logger';
import { RegimeClassifier } from '../../regime/RegimeClassifier';
import { TelemetryBus } from '../../telemetry/TelemetryBus';

/**
 * Market hours definition
 */
interface MarketHours {
  /**
   * Trading days (0 = Sunday, 1 = Monday, etc.)
   */
  tradingDays: number[];
  
  /**
   * Opening hour (0-23)
   */
  openHour: number;
  
  /**
   * Opening minute (0-59)
   */
  openMinute: number;
  
  /**
   * Closing hour (0-23)
   */
  closeHour: number;
  
  /**
   * Closing minute (0-59)
   */
  closeMinute: number;
}

/**
 * Paper Trading Adapter for simulating trade execution
 * Implements the IExecutionAdapter interface for integration with the StrategyEngine
 */
export class PaperTradingAdapter implements IExecutionAdapter {
  // Singleton instance
  private static instance: PaperTradingAdapter | null = null;
  
  // Configuration
  private config: PaperTradingConfig;
  
  // Internal state
  private positions: Map<string, Position> = new Map();
  private orders: Map<string, PaperOrder> = new Map();
  private priceCache: Map<string, number> = new Map();
  private cashBalance: number;
  private executionHistory: ExecutionReport[] = [];
  private openOrders: PaperOrder[] = [];
  
  // Event emitter
  private events: EventEmitter = new EventEmitter();
  
  // Dependencies
  private regimeClassifier: RegimeClassifier;
  private telemetry: TelemetryBus;
  
  // Starting timestamp for PnL calculation
  private simulationStartTime: Date;
  private dayStartTimestamp: number;
  private totalPnl: number = 0;
  private dayPnl: number = 0;
  
  /**
   * Private constructor (use getInstance)
   * @param config Paper trading configuration
   */
  private constructor(config: Partial<PaperTradingConfig> = {}) {
    this.config = {
      ...DEFAULT_PAPER_TRADING_CONFIG,
      ...config
    };
    
    // Initialize dependencies
    this.regimeClassifier = RegimeClassifier.getInstance();
    this.telemetry = TelemetryBus.getInstance();
    
    // Initialize state
    this.cashBalance = this.config.initialBalance;
    this.simulationStartTime = new Date();
    this.dayStartTimestamp = this.getDayStartTimestamp();
    
    logger.info(`PaperTradingAdapter initialized with balance: $${this.cashBalance}`);
    
    // Set up tick handling for updating positions
    this.setupTickHandling();
  }
  
  /**
   * Get singleton instance
   * @param config Optional configuration
   * @returns PaperTradingAdapter instance
   */
  public static getInstance(config?: Partial<PaperTradingConfig>): PaperTradingAdapter {
    if (!PaperTradingAdapter.instance) {
      PaperTradingAdapter.instance = new PaperTradingAdapter(config);
    } else if (config) {
      // Update config if provided
      PaperTradingAdapter.instance.updateConfig(config);
    }
    return PaperTradingAdapter.instance;
  }
  
  /**
   * Update adapter configuration
   * @param config Partial config to update
   */
  public updateConfig(config: Partial<PaperTradingConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };
    logger.info('PaperTradingAdapter configuration updated');
  }
  
  /**
   * Get the chain identifier for this adapter
   */
  public getChainId(): string {
    return 'paper_trading';
  }
  
  /**
   * Execute a strategy on the target chain
   * @param genome Strategy genome containing execution parameters
   * @param market Market to execute on (e.g. "BTC/USD")
   * @param params Execution parameters
   */
  public async executeStrategy(
    genome: StrategyGenome, 
    market: string, 
    params: ExecutionParams
  ): Promise<ExecutionResult> {
    try {
      const startTime = Date.now();
      
      // Create an order from the strategy
      const order = this.createOrderFromStrategy(genome, market, params);
      
      // Execute the order
      const result = await this.executeOrder(order);
      
      // Calculate execution time
      const executionTime = Date.now() - startTime;
      
      // Check if result.order is null
      if (!result.order) {
        return {
          success: false,
          error: "Order execution failed",
          timestamp: Date.now(),
          executionTimeMs: executionTime,
          feeCost: 0
        };
      }
      
      // Return execution result with non-null order
      return {
        success: result.order.status === OrderStatus.Filled || result.order.status === OrderStatus.PartiallyFilled,
        transactionId: result.order.id,
        error: result.order.status === OrderStatus.Rejected ? "Order rejected" : undefined,
        timestamp: Date.now(),
        executionTimeMs: executionTime,
        feeCost: result.order.commission,
        actualSlippage: result.order.slippage,
        blockHeight: 0, // Not applicable for paper trading
        chainData: {
          orderStatus: result.order.status,
          filledAmount: result.order.filledAmount,
          avgFillPrice: result.order.avgFillPrice,
          positionId: result.position?.id
        }
      };
    } catch (error) {
      logger.error(`Paper trading execution error: ${error instanceof Error ? error.message : String(error)}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
        executionTimeMs: 0,
        feeCost: 0
      };
    }
  }
  
  /**
   * Estimate fees for a potential execution
   * @param genome Strategy genome to execute
   * @param market Market to execute on
   * @param params Execution parameters
   */
  public async estimateFees(
    genome: StrategyGenome,
    market: string,
    params: ExecutionParams
  ): Promise<FeeEstimation> {
    // Get current price
    const price = this.priceCache.get(market) || 0;
    if (price === 0) {
      logger.warn(`No price available for ${market}`);
    }
    
    // Calculate fee based on amount and commission rate
    const venue = params.chainSpecific?.venue as string || 'default';
    const commissionRate = this.config.commissionRates[venue] || this.config.defaultCommissionRate;
    const estimatedFee = (params.amount * price * commissionRate) / 100;
    
    return {
      estimatedFee,
      networkCongestion: 0.1, // Always low for paper trading
      recommendedFees: {
        slow: estimatedFee * 0.8,
        average: estimatedFee,
        fast: estimatedFee * 1.2
      },
      estimatedTimeToConfirmation: {
        slow: 5000,  // 5 seconds
        average: 2000, // 2 seconds
        fast: 500   // 0.5 seconds
      }
    };
  }
  
  /**
   * Execute an order and update positions
   * @param order Order to execute
   * @returns Execution report
   */
  public async executeOrder(order: Order): Promise<ExecutionReport> {
    // Get the current time for execution timestamp
    const now = new Date();
    
    // Create Paper Order from basic Order
    const paperOrder: PaperOrder = {
      ...order,
      status: OrderStatus.Created,
      createdAt: now,
      updatedAt: now,
      filledAmount: 0,
      avgFillPrice: 0,
      remainingAmount: order.amount,
      commission: 0,
      slippage: 0,
      fills: []
    };
    
    // Simulate execution latency
    const latencyMs = this.simulateLatency();
    paperOrder.executionLatencyMs = latencyMs;
    await this.sleep(latencyMs);
    
    try {
      // Update order status to submitted
      paperOrder.status = OrderStatus.Submitted;
      paperOrder.updatedAt = new Date();
      
      // Validate the order
      const validationResult = this.validateOrder(paperOrder);
      if (!validationResult.isValid) {
        paperOrder.status = OrderStatus.Rejected;
        logger.warn(`Order ${paperOrder.id} rejected: ${validationResult.reason}`);
        
        const report: ExecutionReport = {
          order: paperOrder,
          position: null,
          balance: this.cashBalance,
          accountValue: this.calculateAccountValue(),
          pnl: 0,
          isSimulation: true,
          timestamp: new Date(),
          messages: validationResult.reason ? [validationResult.reason] : ['Order validation failed']
        };
        
        // Store the order and report
        this.orders.set(paperOrder.id, paperOrder);
        this.executionHistory.push(report);
        
        return report;
      }
      
      // Get current price and apply slippage
      const marketPrice = this.priceCache.get(paperOrder.symbol);
      if (!marketPrice || marketPrice <= 0) {
        paperOrder.status = OrderStatus.Rejected;
        const message = `No price available for ${paperOrder.symbol}`;
        logger.warn(message);
        
        const report: ExecutionReport = {
          order: paperOrder,
          position: null,
          balance: this.cashBalance,
          accountValue: this.calculateAccountValue(),
          pnl: 0,
          isSimulation: true,
          timestamp: new Date(),
          messages: [message]
        };
        
        // Store the order and report
        this.orders.set(paperOrder.id, paperOrder);
        this.executionHistory.push(report);
        
        return report;
      }
      
      // Apply slippage to the price
      const slippagePct = this.calculateSlippage(paperOrder);
      const executionPrice = paperOrder.side === OrderSide.Buy
        ? marketPrice * (1 + slippagePct / 100)  // Buy orders get worse price (higher)
        : marketPrice * (1 - slippagePct / 100); // Sell orders get worse price (lower)
      
      paperOrder.slippage = slippagePct;
      
      // Calculate fill amount (usually full amount, but can simulate partial fills)
      const fillAmount = this.calculateFillAmount(paperOrder);
      
      // Calculate commission
      const venue = paperOrder.venues?.[0] || 'default';
      const commissionRate = this.config.commissionRates[venue] || this.config.defaultCommissionRate;
      const commission = (fillAmount * executionPrice * commissionRate) / 100;
      
      // Create the fill
      const fill: OrderFill = {
        id: uuidv4(),
        orderId: paperOrder.id,
        timestamp: new Date(),
        amount: fillAmount,
        price: executionPrice,
        fee: commission
      };
      
      // Update the order with the fill
      paperOrder.fills.push(fill);
      paperOrder.filledAmount = fillAmount;
      paperOrder.remainingAmount = paperOrder.amount - fillAmount;
      paperOrder.avgFillPrice = executionPrice;
      paperOrder.commission = commission;
      paperOrder.updatedAt = new Date();
      paperOrder.status = fillAmount === paperOrder.amount ? OrderStatus.Filled : OrderStatus.PartiallyFilled;
      
      // Get or create position for this symbol
      let position = this.getPosition(paperOrder.symbol);
      if (!position) {
        position = this.createPosition(paperOrder.symbol);
      }
      
      // Apply the fill to the position
      position = this.updatePositionWithOrder(position, paperOrder, fill);
      
      // Update cash balance
      if (paperOrder.side === OrderSide.Buy) {
        // Buy reduces cash (cost + commission)
        this.cashBalance -= (fillAmount * executionPrice) + commission;
      } else {
        // Sell increases cash (proceeds - commission)
        this.cashBalance += (fillAmount * executionPrice) - commission;
      }
      
      // Calculate PnL if this is a position-reducing trade
      let pnl = 0;
      if ((paperOrder.side === OrderSide.Sell && position.direction === PositionDirection.Long) ||
          (paperOrder.side === OrderSide.Buy && position.direction === PositionDirection.Short)) {
        // This is a position-reducing trade
        pnl = this.calculateTradeProfit(position, paperOrder, fill);
        
        // Update overall PnL
        this.totalPnl += pnl;
        this.dayPnl += pnl;
      }
      
      // Create execution report
      const report: ExecutionReport = {
        order: paperOrder,
        position: position,
        balance: this.cashBalance,
        accountValue: this.calculateAccountValue(),
        pnl,
        isSimulation: true,
        timestamp: new Date(),
        messages: []
      };
      
      // Store the updated order
      this.orders.set(paperOrder.id, paperOrder);
      
      // If the order is filled, remove from open orders
      if (paperOrder.status === OrderStatus.Filled) {
        this.openOrders = this.openOrders.filter(o => o.id !== paperOrder.id);
      } else {
        // Otherwise, add to open orders if not already there
        if (!this.openOrders.find(o => o.id === paperOrder.id)) {
          this.openOrders.push(paperOrder);
        }
      }
      
      // Store the execution history
      this.executionHistory.push(report);
      
      // Emit events
      this.emitPositionUpdate(position, paperOrder);
      this.emitOrderExecuted(paperOrder);
      
      return report;
    } catch (error) {
      logger.error(`Error executing order: ${error instanceof Error ? error.message : String(error)}`);
      
      // Update order status to rejected
      paperOrder.status = OrderStatus.Rejected;
      paperOrder.updatedAt = new Date();
      
      const report: ExecutionReport = {
        order: paperOrder,
        position: null,
        balance: this.cashBalance,
        accountValue: this.calculateAccountValue(),
        pnl: 0,
        isSimulation: true,
        timestamp: new Date(),
        messages: error instanceof Error ? [error.message || 'Unknown error'] : ['Unknown error']
      };
      
      // Store the order and report
      this.orders.set(paperOrder.id, paperOrder);
      this.executionHistory.push(report);
      
      return report;
    }
  }
  
  /**
   * Create an order from strategy parameters
   * @param genome Strategy genome
   * @param market Symbol/market
   * @param params Execution parameters
   * @returns Order object
   */
  private createOrderFromStrategy(
    genome: StrategyGenome,
    market: string,
    params: ExecutionParams
  ): Order {
    // Extract parameters from genome
    const direction = genome.parameters.direction as PositionDirection || PositionDirection.Long;
    const side = direction === PositionDirection.Long ? OrderSide.Buy : OrderSide.Sell;
    const orderType = genome.parameters.orderType as OrderType || OrderType.Market;
    
    // Extract venue
    const venue = params.chainSpecific?.venue as string || 'default';
    
    // Create the order
    return {
      id: uuidv4(),
      symbol: market,
      side,
      type: orderType,
      amount: params.amount,
      price: this.priceCache.get(market) || 0,
      venues: [venue],
      maxSlippage: params.slippageTolerance,
      additionalParams: {
        genome: genome.id,
        isSimulation: params.isSimulation
      }
    };
  }
  
  /**
   * Validate an order before execution
   */
  private validateOrder(order: PaperOrder): { isValid: boolean, reason?: string } {
    // Check if the price is available
    if (!this.priceCache.has(order.symbol)) {
      return { isValid: false, reason: `No price available for ${order.symbol}` };
    }
    
    // Check if the order amount is valid
    if (order.amount <= 0) {
      return { isValid: false, reason: 'Order amount must be positive' };
    }
    
    // For buy orders, check if we have enough cash
    if (order.side === OrderSide.Buy) {
      const price = this.priceCache.get(order.symbol) || 0;
      if (price <= 0) {
        return { isValid: false, reason: `Invalid price for ${order.symbol}: ${price}` };
      }
      
      const estimatedCost = price * order.amount;
      
      // Include worst-case slippage
      const maxSlippage = order.maxSlippage || 1; // 1% default
      const worstCaseCost = estimatedCost * (1 + maxSlippage / 100);
      
      // Add estimated commission
      const venue = order.venues?.[0] || 'default';
      const commissionRate = this.config.commissionRates[venue] || this.config.defaultCommissionRate;
      const estimatedCommission = (worstCaseCost * commissionRate) / 100;
      
      const totalCost = worstCaseCost + estimatedCommission;
      
      if (totalCost > this.cashBalance) {
        return { 
          isValid: false, 
          reason: `Insufficient funds: required $${totalCost.toFixed(2)}, available $${this.cashBalance.toFixed(2)}` 
        };
      }
    }
    
    // Position size check
    const position = this.getPosition(order.symbol);
    const price = this.priceCache.get(order.symbol) || 0;
    const orderValue = price * order.amount;
    
    // Check against max position size as % of account
    const accountValue = this.calculateAccountValue();
    const maxPositionValue = accountValue * (this.config.maxPositionSizePercent / 100);
    
    if (order.side === OrderSide.Buy) {
      const currentPositionValue = position ? (position.size * price) : 0;
      const newPositionValue = currentPositionValue + orderValue;
      
      if (newPositionValue > maxPositionValue) {
        return {
          isValid: false,
          reason: `Position size exceeds maximum allowed (${this.config.maxPositionSizePercent}% of account value)`
        };
      }
    }
    
    // If realistic constraints are enabled, check for market hours
    if (this.config.enforceMarketHours && this.config.marketHours) {
      const marketHours = this.config.marketHours[order.symbol];
      if (marketHours && !this.isMarketOpen(marketHours)) {
        return { isValid: false, reason: `Market is closed for ${order.symbol}` };
      }
    }
    
    return { isValid: true };
  }
  
  /**
   * Check if the market is currently open based on market hours configuration
   */
  private isMarketOpen(marketHours: MarketHours): boolean {
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    // Check if today is a trading day
    if (!marketHours.tradingDays.includes(day)) {
      return false;
    }
    
    // Convert to target timezone
    // This is a simplified approach - for production, use a proper timezone library
    const nowHours = now.getHours();
    const nowMinutes = now.getMinutes();
    
    // Convert to minutes from start of day
    const nowTimeInMinutes = nowHours * 60 + nowMinutes;
    const openTimeInMinutes = marketHours.openHour * 60 + marketHours.openMinute;
    const closeTimeInMinutes = marketHours.closeHour * 60 + marketHours.closeMinute;
    
    return nowTimeInMinutes >= openTimeInMinutes && nowTimeInMinutes < closeTimeInMinutes;
  }
  
  /**
   * Calculate slippage for an order
   * @param order The order
   * @returns Slippage as percentage
   */
  private calculateSlippage(order: PaperOrder): number {
    const venue = order.venues?.[0] || 'default';
    const slippageModel = this.config.slippageModels[venue] || this.config.defaultSlippageModel;
    
    // Get market price
    const marketPrice = this.priceCache.get(order.symbol) || 0;
    
    // Default slippage value
    let slippage = 0;
    
    switch (slippageModel) {
      case SlippageModel.Fixed:
        // Fixed slippage between 0.05% and 0.2%
        slippage = 0.05 + (Math.random() * 0.15);
        break;
        
      case SlippageModel.SizeDependent:
        // Size-dependent slippage - larger orders have more slippage
        // Calculate order value
        const orderValue = order.amount * marketPrice;
        
        // Estimate market liquidity (simplified)
        const baseSlippage = 0.05;
        const sizeMultiplier = 0.01; // 0.01% additional slippage per $1000 of order size
        
        slippage = baseSlippage + (orderValue / 1000) * sizeMultiplier;
        break;
        
      case SlippageModel.VolatilityBased:
        // Use the symbol's volatility to determine slippage
        // This is a simplified approach
        const regime = this.regimeClassifier.getCurrentPrimaryRegime(order.symbol);
        
        if (regime === 'high_volatility' || regime === 'market_stress') {
          slippage = 0.2 + (Math.random() * 0.3); // 0.2% to 0.5%
        } else if (regime === 'low_volatility') {
          slippage = 0.02 + (Math.random() * 0.08); // 0.02% to 0.1%
        } else {
          slippage = 0.05 + (Math.random() * 0.15); // 0.05% to 0.2%
        }
        break;
        
      case SlippageModel.OrderBookBased:
        // Simplified order book depth estimation
        // In a real system, this would use actual order book data
        const baseOrderBookSlippage = 0.08;
        const randomVariation = (Math.random() - 0.5) * 0.04; // ±0.02%
        slippage = baseOrderBookSlippage + randomVariation;
        break;
        
      case SlippageModel.Custom:
        // Custom slippage model would be implemented here
        slippage = 0.1; // Default for custom model
        break;
        
      case SlippageModel.None:
        // No slippage
        slippage = 0;
        break;
        
      default:
        // Default slippage
        slippage = 0.1;
    }
    
    // Apply maximum slippage if specified
    if (order.maxSlippage !== undefined && slippage > order.maxSlippage) {
      slippage = order.maxSlippage;
    }
    
    return slippage;
  }
  
  /**
   * Calculate fill amount for an order (can simulate partial fills)
   * @param order The order
   * @returns Fill amount
   */
  private calculateFillAmount(order: PaperOrder): number {
    // Check if the order should be filled completely based on probability
    if (Math.random() < this.config.orderFillProbability) {
      return order.amount;
    }
    
    // Otherwise, calculate a partial fill (between 60% and 90% of order amount)
    const fillPercentage = 0.6 + Math.random() * 0.3;
    return order.amount * fillPercentage;
  }
  
  /**
   * Check status of a previous execution
   * @param transactionId Transaction hash/ID
   */
  public async checkTransactionStatus(transactionId: string): Promise<ExecutionResult> {
    // Find the order
    const order = this.orders.get(transactionId);
    if (!order) {
      return {
        success: false,
        error: `Order ${transactionId} not found`,
        timestamp: Date.now(),
        executionTimeMs: 0,
        feeCost: 0
      };
    }
    
    return {
      success: order.status === OrderStatus.Filled || order.status === OrderStatus.PartiallyFilled,
      transactionId: order.id,
      error: order.status === OrderStatus.Rejected ? "Order rejected" : undefined,
      timestamp: Date.now(),
      executionTimeMs: order.executionLatencyMs || 0,
      feeCost: order.commission,
      actualSlippage: order.slippage,
      blockHeight: 0,
      chainData: {
        orderStatus: order.status,
        filledAmount: order.filledAmount,
        avgFillPrice: order.avgFillPrice
      }
    };
  }
  
  /**
   * Get chain health status
   */
  public async getChainHealthStatus(): Promise<ChainHealthStatus> {
    return {
      isOperational: true,
      currentBlockHeight: 0,
      latestBlockTimestamp: Date.now(),
      averageBlockTimeMs: 1000,
      networkCongestion: 0.1,
      currentTps: 1000,
      rpcResponseTimeMs: 50,
      isConfigured: true,
      chainSpecific: {
        simulationMode: true,
        orderCount: this.orders.size,
        positionCount: this.positions.size
      }
    };
  }
  
  /**
   * Initialize the adapter with configuration
   * @param config Adapter-specific configuration
   */
  public async initialize(config: Record<string, any>): Promise<boolean> {
    try {
      this.updateConfig(config as Partial<PaperTradingConfig>);
      return true;
    } catch (error) {
      logger.error(`Failed to initialize paper trading adapter: ${error}`);
      return false;
    }
  }
  
  /**
   * Validate if a strategy can be executed by this adapter
   * @param genome Strategy genome to validate
   */
  public async validateStrategy(genome: StrategyGenome): Promise<{
    isValid: boolean;
    errors?: string[];
  }> {
    // All strategies are valid for paper trading
    return {
      isValid: true
    };
  }
  
  /**
   * Get a position by symbol
   * @param symbol Market symbol
   * @returns Position or null if not found
   */
  public getPosition(symbol: string): Position | null {
    // Check for exact match
    const exactPosition = Array.from(this.positions.values()).find(p => p.symbol === symbol);
    if (exactPosition) {
      return exactPosition;
    }
    
    return null;
  }
  
  /**
   * Create a new position for a symbol
   * @param symbol Market symbol
   * @returns New position
   */
  private createPosition(symbol: string): Position {
    const position: Position = {
      id: uuidv4(),
      symbol,
      venue: 'paper',
      size: 0,
      value: 0,
      direction: PositionDirection.Long, // Default direction
      entryPrice: 0,
      currentPrice: this.priceCache.get(symbol) || 0,
      leverage: 1,
      timestamp: new Date()
    };
    
    this.positions.set(position.id, position);
    return position;
  }
  
  /**
   * Update position with a new order fill
   * @param position Position to update
   * @param order Order that was executed
   * @param fill Fill details
   * @returns Updated position
   */
  private updatePositionWithOrder(position: Position, order: PaperOrder, fill: OrderFill): Position {
    const price = fill.price;
    const amount = fill.amount;
    
    if (position.size === 0) {
      // New position
      position.size = amount;
      position.entryPrice = price;
      position.value = amount * price;
      position.direction = order.side === OrderSide.Buy ? PositionDirection.Long : PositionDirection.Short;
    } else if (position.direction === PositionDirection.Long) {
      if (order.side === OrderSide.Buy) {
        // Adding to long position
        const oldValue = position.size * position.entryPrice;
        const newValue = amount * price;
        const newSize = position.size + amount;
        position.entryPrice = (oldValue + newValue) / newSize;
        position.size = newSize;
        position.value = newSize * price;
      } else {
        // Reducing long position
        position.size -= amount;
        
        // If position flips to short
        if (position.size < 0) {
          position.direction = PositionDirection.Short;
          position.entryPrice = price;
          position.size = Math.abs(position.size);
        }
        
        position.value = position.size * price;
      }
    } else {
      // Short position
      if (order.side === OrderSide.Sell) {
        // Adding to short position
        const oldValue = position.size * position.entryPrice;
        const newValue = amount * price;
        const newSize = position.size + amount;
        position.entryPrice = (oldValue + newValue) / newSize;
        position.size = newSize;
        position.value = newSize * price;
      } else {
        // Reducing short position
        position.size -= amount;
        
        // If position flips to long
        if (position.size < 0) {
          position.direction = PositionDirection.Long;
          position.entryPrice = price;
          position.size = Math.abs(position.size);
        }
        
        position.value = position.size * price;
      }
    }
    
    // Update current price
    position.currentPrice = price;
    
    // Update unrealized PnL
    if (position.size > 0) {
      position.unrealizedPnl = position.direction === PositionDirection.Long
        ? (price - position.entryPrice) * position.size
        : (position.entryPrice - price) * position.size;
      
      position.unrealizedPnlPct = position.unrealizedPnl / position.value * 100;
    } else {
      position.unrealizedPnl = 0;
      position.unrealizedPnlPct = 0;
    }
    
    // Update timestamp
    position.timestamp = new Date();
    
    // If position size is 0, remove it
    if (position.size === 0) {
      this.positions.delete(position.id);
    } else {
      // Otherwise, update it
      this.positions.set(position.id, position);
    }
    
    return position;
  }
  
  /**
   * Calculate profit from a trade
   * @param position Position
   * @param order Order
   * @param fill Fill details
   * @returns Profit amount
   */
  private calculateTradeProfit(position: Position, order: PaperOrder, fill: OrderFill): number {
    let profit = 0;
    
    if (position.direction === PositionDirection.Long && order.side === OrderSide.Sell) {
      // Selling a long position
      profit = (fill.price - position.entryPrice) * fill.amount;
    } else if (position.direction === PositionDirection.Short && order.side === OrderSide.Buy) {
      // Buying back a short position
      profit = (position.entryPrice - fill.price) * fill.amount;
    }
    
    // Subtract commission
    profit -= fill.fee;
    
    return profit;
  }
  
  /**
   * Calculate total account value
   * @returns Account value
   */
  private calculateAccountValue(): number {
    let positionsValue = 0;
    
    // Sum up all position values
    for (const position of this.positions.values()) {
      const currentPrice = this.priceCache.get(position.symbol) || position.currentPrice;
      positionsValue += position.size * currentPrice;
    }
    
    return this.cashBalance + positionsValue;
  }
  
  /**
   * Simulate execution latency
   * @returns Latency in milliseconds
   */
  private simulateLatency(): number {
    const baseLatency = this.config.defaultLatencyMs;
    const randomVariation = Math.random() * (baseLatency / 2);
    return baseLatency + randomVariation;
  }
  
  /**
   * Sleep for a given amount of time
   * @param ms Milliseconds to sleep
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Emit position update event
   * @param position Updated position
   * @param order Related order
   */
  private emitPositionUpdate(position: Position, order: PaperOrder | null): void {
    if (!position) return;
    
    const updateType = position.size === 0 ? 'close' : 
      this.positions.has(position.id) ? 'update' : 'open';
    
    const event: PositionUpdateEvent = {
      positionId: position.id,
      position,
      updateType,
      order,
      timestamp: new Date()
    };
    
    this.events.emit('position_update', event);
    
    // Also emit telemetry
    this.telemetry.emit('paper_trading.position_update', {
      symbol: position.symbol,
      size: position.size,
      direction: position.direction,
      entryPrice: position.entryPrice,
      currentPrice: position.currentPrice,
      unrealizedPnl: position.unrealizedPnl,
      timestamp: Date.now()
    });
  }
  
  /**
   * Emit order executed event
   * @param order Executed order
   */
  private emitOrderExecuted(order: PaperOrder): void {
    this.events.emit('order_executed', order);
    
    // Also emit telemetry
    this.telemetry.emit('paper_trading.order_executed', {
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      amount: order.amount,
      filledAmount: order.filledAmount,
      price: order.price,
      avgFillPrice: order.avgFillPrice,
      status: order.status,
      timestamp: Date.now()
    });
  }
  
  /**
   * Set up tick handling for price updates
   */
  private setupTickHandling(): void {
    // Implementation to be added
  }
  
  /**
   * Get the timestamp for the start of the current day
   */
  private getDayStartTimestamp(): number {
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0, 0, 0, 0
    );
    return startOfDay.getTime();
  }
  
  /**
   * Update market price for a symbol
   * @param symbol Market symbol
   * @param price Current price
   * @returns True if update was successful
   */
  public updatePrice(symbol: string, price: number): boolean {
    try {
      if (price <= 0) {
        logger.warn(`Invalid price for ${symbol}: ${price}`);
        return false;
      }
      
      // Get previous price if any
      const oldPrice = this.priceCache.get(symbol);
      
      // Update price cache
      this.priceCache.set(symbol, price);
      
      // Update positions with new price
      for (const position of this.positions.values()) {
        if (position.symbol === symbol) {
          // Update position with new price
          position.currentPrice = price;
          
          // Recalculate unrealized PnL
          if (position.size > 0) {
            position.unrealizedPnl = position.direction === PositionDirection.Long
              ? (price - position.entryPrice) * position.size
              : (position.entryPrice - price) * position.size;
            
            position.unrealizedPnlPct = position.unrealizedPnl / (position.size * price) * 100;
          }
          
          // Recalculate position value
          position.value = position.size * price;
          
          // Emit update event
          this.emitPositionUpdate(position, null);
        }
      }
      
      // Emit price update event
      this.events.emit('price_update', { symbol, price, oldPrice, timestamp: new Date() });
      
      // Emit telemetry
      this.telemetry.emit('paper_trading.price_update', {
        symbol,
        price,
        timestamp: Date.now()
      });
      
      return true;
    } catch (error) {
      logger.error(`Error updating price for ${symbol}: ${error}`);
      return false;
    }
  }
  
  /**
   * Update multiple prices at once
   * @param prices Map of symbol to price
   * @returns Number of successful updates
   */
  public updatePrices(prices: Map<string, number> | Record<string, number>): number {
    let successCount = 0;
    
    // Convert to map if needed
    const priceMap = prices instanceof Map ? prices : new Map(Object.entries(prices));
    
    // Update each price
    for (const [symbol, price] of priceMap.entries()) {
      if (this.updatePrice(symbol, price)) {
        successCount++;
      }
    }
    
    // Update portfolio after price changes
    this.recalculatePortfolio();
    
    return successCount;
  }
  
  /**
   * Get the current price for a symbol
   * @param symbol Market symbol
   * @returns Current price or undefined if not available
   */
  public getPrice(symbol: string): number | undefined {
    return this.priceCache.get(symbol);
  }
  
  /**
   * Get all positions
   * @returns Array of positions
   */
  public getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }
  
  /**
   * Get current cash balance
   * @returns Cash balance
   */
  public getCashBalance(): number {
    return this.cashBalance;
  }
  
  /**
   * Get portfolio snapshot
   * @returns Portfolio snapshot
   */
  public getPortfolioSnapshot(): PortfolioSnapshot {
    // Recalculate portfolio with latest prices
    this.recalculatePortfolio();
    
    // Calculate portfolio value
    const portfolioValue = this.calculateAccountValue();
    
    // Check if day has changed
    const currentDayTimestamp = this.getDayStartTimestamp();
    if (currentDayTimestamp > this.dayStartTimestamp) {
      // Reset day PnL
      this.dayPnl = 0;
      this.dayStartTimestamp = currentDayTimestamp;
    }
    
    return {
      timestamp: new Date(),
      cashBalance: this.cashBalance,
      positions: Array.from(this.positions.values()),
      openOrders: this.openOrders,
      portfolioValue,
      dayPnl: this.dayPnl,
      totalPnl: this.totalPnl
    };
  }
  
  /**
   * Subscribe to an event
   * @param event Event name
   * @param listener Event listener
   * @returns Unsubscribe function
   */
  public on(event: string, listener: (...args: any[]) => void): () => void {
    this.events.on(event, listener);
    
    // Return unsubscribe function
    return () => this.events.off(event, listener);
  }
  
  /**
   * Get execution history
   * @param limit Maximum number of reports to return
   * @returns Array of execution reports
   */
  public getExecutionHistory(limit?: number): ExecutionReport[] {
    if (limit) {
      return this.executionHistory.slice(-limit);
    }
    return [...this.executionHistory];
  }
  
  /**
   * Get open orders
   * @returns Array of open orders
   */
  public getOpenOrders(): PaperOrder[] {
    return [...this.openOrders];
  }
  
  /**
   * Get order by ID
   * @param orderId Order ID
   * @returns Order or undefined if not found
   */
  public getOrder(orderId: string): PaperOrder | undefined {
    return this.orders.get(orderId);
  }
  
  /**
   * Execute a signal directly
   * @param signal Trading signal
   * @returns Execution report
   */
  public async executeSignal(signal: Signal): Promise<ExecutionReport> {
    try {
      // Convert signal to order
      const order = this.createOrderFromSignal(signal);
      
      // Execute the order
      const report = await this.executeOrder(order);
      
      // Add signal to the report
      report.signal = signal;
      
      return report;
    } catch (error) {
      logger.error(`Error executing signal: ${error}`);
      
      // Create a failed execution report
      return {
        order: null,
        position: null,
        balance: this.cashBalance,
        accountValue: this.calculateAccountValue(),
        pnl: 0,
        isSimulation: true,
        timestamp: new Date(),
        signal,
        messages: [error instanceof Error ? error.message : String(error)]
      };
    }
  }
  
  /**
   * Cancel an open order
   * @param orderId Order ID
   * @returns True if successfully canceled
   */
  public cancelOrder(orderId: string): boolean {
    // Find the order
    const order = this.orders.get(orderId);
    if (!order || order.status !== OrderStatus.PartiallyFilled && order.status !== OrderStatus.Submitted) {
      return false;
    }
    
    // Update order status
    order.status = OrderStatus.Canceled;
    order.updatedAt = new Date();
    
    // Remove from open orders
    this.openOrders = this.openOrders.filter(o => o.id !== orderId);
    
    // Emit order canceled event
    this.events.emit('order_canceled', order);
    
    // Emit telemetry
    this.telemetry.emit('paper_trading.order_canceled', {
      orderId: order.id,
      symbol: order.symbol,
      timestamp: Date.now()
    });
    
    return true;
  }
  
  /**
   * Reset the paper trading adapter to initial state
   */
  public reset(): void {
    // Reset state
    this.positions.clear();
    this.orders.clear();
    this.openOrders = [];
    this.executionHistory = [];
    this.cashBalance = this.config.initialBalance;
    this.totalPnl = 0;
    this.dayPnl = 0;
    this.simulationStartTime = new Date();
    this.dayStartTimestamp = this.getDayStartTimestamp();
    
    logger.info(`PaperTradingAdapter reset to initial state with balance: $${this.cashBalance}`);
    
    // Emit reset event
    this.events.emit('reset', { timestamp: new Date() });
    
    // Emit telemetry
    this.telemetry.emit('paper_trading.reset', {
      timestamp: Date.now(),
      initialBalance: this.cashBalance
    });
  }
  
  /**
   * Recalculate entire portfolio with latest prices
   */
  private recalculatePortfolio(): void {
    for (const position of this.positions.values()) {
      const price = this.priceCache.get(position.symbol);
      if (price) {
        // Update position with new price
        position.currentPrice = price;
        
        // Recalculate unrealized PnL
        if (position.size > 0) {
          position.unrealizedPnl = position.direction === PositionDirection.Long
            ? (price - position.entryPrice) * position.size
            : (position.entryPrice - price) * position.size;
          
          position.unrealizedPnlPct = position.unrealizedPnl / (position.size * price) * 100;
        }
        
        // Recalculate position value
        position.value = position.size * price;
      }
    }
  }
  
  /**
   * Create an order from a signal
   * @param signal Signal
   * @returns Order
   */
  private createOrderFromSignal(signal: Signal): Order {
    // Get price from cache or use a default of 0 (will be rejected)
    const price = this.priceCache.get(signal.symbol) || 0;
    
    // Determine order side
    let side: OrderSide;
    if (signal.direction === 'buy') {
      side = OrderSide.Buy;
    } else if (signal.direction === 'sell') {
      side = OrderSide.Sell;
    } else {
      // 'hold' or any other value is treated as no order
      throw new Error(`Invalid signal direction: ${signal.direction}`);
    }
    
    // Calculate order amount based on signal strength and portfolio value
    const portfolioValue = this.calculateAccountValue();
    const positionSizePercent = signal.metadata?.positionSizePercent || 10; // Default 10%
    const targetAmount = (portfolioValue * positionSizePercent / 100) / price;
    
    // Apply signal strength as a multiplier if available
    const amount = signal.strength ? targetAmount * signal.strength : targetAmount;
    
    // Create order
    return {
      id: uuidv4(),
      symbol: signal.symbol,
      side,
      type: OrderType.Market,
      amount,
      price,
      venues: ['paper'],
      additionalParams: {
        signalId: signal.id,
        signalConfidence: signal.confidence,
        regimeType: signal.regimeType,
        metadata: signal.metadata
      }
    };
  }
} 