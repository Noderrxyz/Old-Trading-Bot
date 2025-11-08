/**
 * Uniswap Venue
 * 
 * Provides execution functionality for Uniswap V3 DEX.
 */

import { OrderIntent, ExecutedOrder, ExecutionStyle } from '../../../types/execution.types.js';
import { ExecutionVenue, VenueConfig } from '../VenueRegistry.js';
import { createLogger } from '../../../common/logger.js';

const logger = createLogger('UniswapVenue');

/**
 * Uniswap specific venue configuration
 */
export interface UniswapVenueConfig extends VenueConfig {
  // Uniswap router address
  routerAddress: string;
  
  // Default fee tier to use (0.05%, 0.3%, 1%)
  defaultFeeTier: 500 | 3000 | 10000;
  
  // Web3 provider URL
  providerUrl: string;
  
  // Whether to use Universal Router
  useUniversalRouter: boolean;
  
  // Gas limit for swaps (0 for auto)
  gasLimitOverride: number;
}

/**
 * Implementation of ExecutionVenue for Uniswap V3
 */
export class UniswapVenue implements ExecutionVenue {
  public readonly id: string;
  public readonly name: string;
  public readonly type: string = 'dex';
  public enabled: boolean;
  
  private supportedAssets: string[] = [];
  private mockLatencyMs: number = 0;
  
  /**
   * Create a new Uniswap venue
   * @param config Venue configuration
   */
  constructor(private readonly config: UniswapVenueConfig) {
    this.id = config.id;
    this.name = config.name;
    this.enabled = config.enabled;
    this.supportedAssets = config.supportedAssets;
    
    // Simulate network latency in development/testing
    this.mockLatencyMs = process.env.NODE_ENV === 'production' ? 0 : (100 + Math.random() * 300);
    
    logger.info(`Initialized ${this.name} venue (type: ${this.type})`);
  }
  
  /**
   * Get all supported assets
   * @returns Array of supported asset pairs
   */
  async getSupportedAssets(): Promise<string[]> {
    // Simulate network latency
    await this.simulateLatency();
    return this.supportedAssets;
  }
  
  /**
   * Check if an asset is supported
   * @param asset Asset pair to check
   * @returns True if supported
   */
  async isAssetSupported(asset: string): Promise<boolean> {
    // Simulate network latency
    await this.simulateLatency();
    return this.supportedAssets.includes(asset);
  }
  
  /**
   * Check venue health status
   * @returns True if venue is healthy
   */
  async checkHealth(): Promise<boolean> {
    // In a real implementation, we would make a call to the Uniswap API
    // or attempt to query a pool to verify connectivity
    
    // Simulate network latency
    await this.simulateLatency();
    
    // Simulate occasional health issues
    return Math.random() > 0.05; // 95% healthy
  }
  
  /**
   * Get current market data for an asset
   * @param asset Asset pair
   * @returns Market data
   */
  async getMarketData(asset: string): Promise<any> {
    // Simulate network latency
    await this.simulateLatency();
    
    const [token0, token1] = asset.split('/');
    
    // Mock market data
    const basePrice = token0 === 'ETH' || token0 === 'WETH' 
      ? 2500 + (Math.random() * 100 - 50) // ETH around $2500
      : token0 === 'BTC' || token0 === 'WBTC'
        ? 50000 + (Math.random() * 1000 - 500) // BTC around $50000
        : 1 + Math.random(); // Generic price
    
    return {
      asset,
      lastPrice: basePrice,
      bid: basePrice * 0.999,
      ask: basePrice * 1.001,
      volume24h: 1000000 + Math.random() * 5000000,
      liquidity: 10000000 + Math.random() * 50000000,
      timestamp: Date.now(),
      source: this.name
    };
  }
  
  /**
   * Execute an order
   * @param order Order to execute
   * @param style Execution style
   * @returns Executed order details
   */
  async execute(order: OrderIntent, style?: ExecutionStyle): Promise<ExecutedOrder> {
    logger.info(`Executing ${order.side} order for ${order.quantity} ${order.asset} with style ${style || 'default'}`);
    
    // Validate order
    if (!order.asset || !order.side || !order.quantity) {
      throw new Error('Invalid order: missing required fields');
    }
    
    // Check if asset is supported
    const supported = await this.isAssetSupported(order.asset);
    if (!supported) {
      throw new Error(`Asset ${order.asset} not supported on ${this.name}`);
    }
    
    // Simulate network latency and execution time
    const startTime = Date.now();
    await this.simulateLatency(300, 1000); // Higher latency for execution
    const endTime = Date.now();
    
    // Get market data for pricing
    const marketData = await this.getMarketData(order.asset);
    
    // Calculate execution details
    const basePrice = marketData.lastPrice;
    
    // Apply slippage based on order size and execution style
    const sizeImpact = Math.min(order.quantity / 10000, 0.05); // 0-5% based on size
    const styleImpact = style === ExecutionStyle.Aggressive ? 0.002 : 
                        style === ExecutionStyle.Passive ? -0.001 : 0.001;
    
    // For buys, price goes up (worse); for sells, price goes down (worse)
    const slippageDirection = order.side === 'buy' ? 1 : -1;
    const maxSlippageBps = order.maxSlippageBps || 100; // Default 1%
    
    // Calculate executed price with realistic slippage
    let priceImpactPct = (sizeImpact + styleImpact) * 100; // Convert to percentage
    // Cap at max slippage
    priceImpactPct = Math.min(priceImpactPct, maxSlippageBps / 100);
    
    const executedPrice = basePrice * (1 + (slippageDirection * priceImpactPct / 100));
    
    // Generate order ID
    const orderId = `uniswap-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    
    // Create executed order result
    const result: ExecutedOrder = {
      intent: order,
      venue: this.id,
      orderId: orderId,
      executedPrice: executedPrice,
      executedQuantity: order.quantity, // Assume full fill
      timestamp: endTime,
      status: 'filled',
      latencyMs: endTime - startTime,
      slippageBps: Math.round(priceImpactPct * 100), // Convert to basis points
      fees: {
        asset: order.asset.split('/')[1], // Fee in quote currency
        amount: order.quantity * executedPrice * (this.config.feeBps / 10000) // Convert bps to decimal
      },
      metadata: {
        executionStyle: style || ExecutionStyle.Adaptive,
        route: {
          protocol: 'uniswapv3',
          path: order.asset.split('/'),
          feeTier: this.config.defaultFeeTier,
          pool: `${order.asset.replace('/', '')}_${this.config.defaultFeeTier}`
        }
      }
    };
    
    logger.info(`Executed order ${orderId} at price ${executedPrice} with ${result.slippageBps} bps slippage`);
    return result;
  }
  
  /**
   * Cancel an existing order
   * @param orderId Order ID to cancel
   * @returns True if canceled
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    logger.info(`Attempting to cancel order ${orderId}`);
    
    // Uniswap is an AMM with atomic transactions, so cancellation isn't typically applicable
    // For pending transactions, this would interact with the mempool
    
    throw new Error('Cancel not supported for atomic DEX transactions');
  }
  
  /**
   * Get status of an order
   * @param orderId Order ID to check
   * @returns Order status
   */
  async getOrderStatus(orderId: string): Promise<any> {
    logger.info(`Checking status for order ${orderId}`);
    
    // In a real implementation, this would check transaction status on-chain
    
    // Simulate network latency
    await this.simulateLatency();
    
    // For Uniswap, transactions are typically either completed or failed
    // Return mock transaction status
    return {
      orderId,
      status: 'filled', // Uniswap transactions are atomic
      transactionHash: `0x${Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`,
      blockNumber: 15000000 + Math.floor(Math.random() * 1000),
      timestamp: Date.now() - 60000, // 1 minute ago
      confirmations: 3 + Math.floor(Math.random() * 10)
    };
  }
  
  /**
   * Enable this venue
   */
  enable(): void {
    logger.info(`Enabling ${this.name} venue`);
    this.enabled = true;
  }
  
  /**
   * Disable this venue
   */
  disable(): void {
    logger.info(`Disabling ${this.name} venue`);
    this.enabled = false;
  }
  
  /**
   * Simulate network latency for testing
   * @param minMs Minimum latency in ms
   * @param maxMs Maximum latency in ms
   */
  private async simulateLatency(minMs?: number, maxMs?: number): Promise<void> {
    if (process.env.NODE_ENV === 'production') return;
    
    const min = minMs || 50;
    const max = maxMs || 200;
    const latency = this.mockLatencyMs || (min + Math.random() * (max - min));
    
    await new Promise(resolve => setTimeout(resolve, latency));
  }
} 