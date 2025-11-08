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