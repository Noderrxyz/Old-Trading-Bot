/**
 * Execution Feedback Loop Example
 * 
 * Demonstrates the execution feedback loop system that captures execution telemetry,
 * analyzes post-trade movements, and adapts routing decisions.
 */

import { ExecutionTelemetryService } from '../services/execution/ExecutionTelemetryService.js';
import { ExecutionFeedbackService } from '../services/execution/ExecutionFeedbackService.js';
import { ExecutionFeedbackLoop } from '../services/execution/ExecutionFeedbackLoop.js';
import { ExecutionRouter } from '../infra/execution/ExecutionRouter.js';
import { MicrostructureAnalyzer } from '../infra/marketdata/MicrostructureAnalyzer.js';
import { TrustEngine } from '../infra/risk/TrustEngine.js';
import { FusionMemory } from '../fusion/FusionMemory.js';
import { ExecutedOrder, ExecutionStyle, OrderIntent } from '../types/execution.types.js';
import { VenueRegistry, ExecutionVenue } from '../infra/venues/VenueRegistry.js';

/**
 * Create a mock market data source
 */
function createMockMarketDataSource() {
  // Current prices for assets
  const prices: Record<string, number> = {
    'BTC/USDT': 50000,
    'ETH/USDT': 2500,
    'SOL/USDT': 100
  };
  
  // Price history (for adverse selection analysis)
  const priceHistory: Record<string, number[]> = {};
  
  return {
    // Get the current price of an asset
    getCurrentPrice: async (asset: string): Promise<number> => {
      return prices[asset] || 0;
    },
    
    // Get price history for an asset
    getPriceHistory: async (
      asset: string,
      startTime: number,
      endTime: number,
      intervalMs: number
    ): Promise<number[]> => {
      // Generate a random price series that either moves slightly upward or downward
      const currentPrice = prices[asset] || 0;
      const direction = Math.random() > 0.5 ? 1 : -1;
      const volatility = 0.001; // 0.1% per step on average
      
      const steps = Math.ceil((endTime - startTime) / intervalMs);
      const history: number[] = [];
      
      let price = currentPrice;
      for (let i = 0; i < steps; i++) {
        // Random walk with a slight trend
        const change = price * volatility * (Math.random() * 2 - 1 + 0.1 * direction);
        price += change;
        history.push(price);
      }
      
      // Store in cache for future reference
      priceHistory[asset] = history;
      
      return history;
    },
    
    // Set a specific price for testing
    setPrice: (asset: string, price: number): void => {
      prices[asset] = price;
    },
    
    // Set a specific price series for testing
    setPriceHistory: (asset: string, history: number[]): void => {
      priceHistory[asset] = [...history];
    }
  };
}

/**
 * Create a mock executed order for testing
 * @param order Order intent
 * @param venue Venue ID
 * @param slippageBps Slippage in basis points
 * @returns Executed order
 */
function createMockExecutedOrder(
  order: OrderIntent,
  venue: string,
  slippageBps: number = 0
): ExecutedOrder {
  const orderId = `order-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const executedPrice = order.price ? 
    order.price * (1 + (order.side === 'buy' ? 1 : -1) * slippageBps / 10000) : 
    0;
  
  return {
    intent: order,
    venue,
    orderId,
    executedPrice,
    executedQuantity: order.quantity,
    timestamp: Date.now(),
    status: 'filled',
    latencyMs: Math.floor(Math.random() * 500),
    slippageBps,
    metadata: {
      executionStyle: ExecutionStyle.Adaptive
    }
  };
}

/**
 * Run the execution feedback loop example
 */
async function runExecutionFeedbackExample() {
  console.log('Starting execution feedback loop example...\n');
  
  // Create the mock market data source
  const marketDataSource = createMockMarketDataSource();
  
  // Set up core components
  const fusionMemory = new FusionMemory();
  const trustEngine = new TrustEngine();
  const microAnalyzer = new MicrostructureAnalyzer({
    getMarketData: async () => ({
      topImbalance: 0.1,
      quoteVolatility: 0.2,
      spreadPressure: 0.005,
      sweepRisk: 0.3,
      spoofingScore: 0.1
    })
  } as any);
  
  // Set up venue registry with test venues
  const venueRegistry = new VenueRegistry();
  
  // Create mock venues with different characteristics
  const venues: Record<string, ExecutionVenue> = {
    'binance': {
      id: 'binance',
      name: 'Binance',
      type: 'cex',
      enabled: true,
      getSupportedAssets: async () => ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
      isAssetSupported: async (asset) => ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'].includes(asset),
      checkHealth: async () => true,
      getMarketData: async () => ({}),
      execute: async (order) => createMockExecutedOrder(order, 'binance', 5), // 5 bps slippage
      cancelOrder: async () => true,
      getOrderStatus: async () => ({}),
      enable: () => {},
      disable: () => {}
    },
    'coinbase': {
      id: 'coinbase',
      name: 'Coinbase',
      type: 'cex',
      enabled: true,
      getSupportedAssets: async () => ['BTC/USDT', 'ETH/USDT'],
      isAssetSupported: async (asset) => ['BTC/USDT', 'ETH/USDT'].includes(asset),
      checkHealth: async () => true,
      getMarketData: async () => ({}),
      execute: async (order) => createMockExecutedOrder(order, 'coinbase', 10), // 10 bps slippage
      cancelOrder: async () => true,
      getOrderStatus: async () => ({}),
      enable: () => {},
      disable: () => {}
    },
    'kraken': {
      id: 'kraken',
      name: 'Kraken',
      type: 'cex',
      enabled: true,
      getSupportedAssets: async () => ['BTC/USDT', 'ETH/USDT'],
      isAssetSupported: async (asset) => ['BTC/USDT', 'ETH/USDT'].includes(asset),
      checkHealth: async () => true,
      getMarketData: async () => ({}),
      execute: async (order) => createMockExecutedOrder(order, 'kraken', 7), // 7 bps slippage
      cancelOrder: async () => true,
      getOrderStatus: async () => ({}),
      enable: () => {},
      disable: () => {}
    }
  };
  
  // Register the venues
  Object.values(venues).forEach(venue => venueRegistry.register(venue));
  
  // Create telemetry service
  const telemetryService = new ExecutionTelemetryService();
  
  // Create the execution router with Fill IQ adaptation
  const router = new ExecutionRouter(
    venueRegistry.getAll(),
    microAnalyzer,
    trustEngine,
    fusionMemory,
    undefined, // No temporal risk model for this example
    telemetryService,
    {
      minTrustScore: 0.5,
      autoRetryFailures: true,
      maxRetryAttempts: 2,
      retryDelayMs: 500,
      adaptToTimeOfDay: false,
      adaptToFillIQ: true,
      minFillIQ: 50,
      fillIQWeight: 0.3,
      minFillsForIQAdaptation: 3,
      thresholds: {
        spoofingThreshold: 0.6,
        sweepRiskThreshold: 0.8,
        spreadPressureThreshold: 0.01,
        quoteVolatilityThreshold: 0.2
      }
    }
  );
  
  // Create the execution feedback loop
  const feedbackLoop = new ExecutionFeedbackLoop(
    telemetryService,
    router,
    marketDataSource,
    {
      autoProcessExecutions: true,
      rankingRefreshIntervalMs: 30 * 1000, // 30 seconds for the example
      maxTelemetryAgeMs: 1 * 60 * 60 * 1000, // 1 hour for the example
      updateRouterAfterExecution: true
    }
  );
  
  // Start the feedback loop
  feedbackLoop.start();
  
  // Set asset prices
  marketDataSource.setPrice('BTC/USDT', 50000);
  marketDataSource.setPrice('ETH/USDT', 2500);
  
  /**
   * Test 1: Initial routing without telemetry data
   */
  console.log('Test 1: Initial routing without telemetry data');
  const order1: OrderIntent = {
    asset: 'ETH/USDT',
    side: 'buy',
    quantity: 1.0,
    price: 2500,
    urgency: 'medium'
  };
  
  // Route the order
  const initialRoute = await router.route(order1);
  console.log(`Initial routing result: ${initialRoute.venue}`);
  console.log(`Score: ${initialRoute.score.toFixed(2)}, Style: ${initialRoute.recommendedStyle}`);
  console.log('No Fill IQ data yet\n');
  
  /**
   * Test 2: Execute orders on different venues and collect telemetry
   */
  console.log('Test 2: Executing orders and collecting telemetry');
  
  // Execute on binance (5 bps slippage)
  const binanceOrder = createMockExecutedOrder(order1, 'binance', 5);
  await feedbackLoop.processExecution(binanceOrder);
  
  // Make the price move slightly against us after binance execution
  marketDataSource.setPriceHistory('ETH/USDT', [2500.5, 2501, 2502, 2503, 2504]);
  
  // Execute on coinbase (10 bps slippage)
  const coinbaseOrder = createMockExecutedOrder(order1, 'coinbase', 10);
  await feedbackLoop.processExecution(coinbaseOrder);
  
  // Make the price move favorable to us after coinbase execution
  marketDataSource.setPriceHistory('ETH/USDT', [2499, 2498, 2497, 2496, 2495]);
  
  // Execute on kraken (7 bps slippage)
  const krakenOrder = createMockExecutedOrder(order1, 'kraken', 7);
  await feedbackLoop.processExecution(krakenOrder);
  
  // Make the price move slightly against us after kraken execution
  marketDataSource.setPriceHistory('ETH/USDT', [2501, 2502, 2503, 2504, 2505]);
  
  // Wait for execution monitoring to complete
  console.log('Waiting for post-execution monitoring to complete...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  /**
   * Test A: Check telemetry data
   */
  console.log('\nTest A: Checking telemetry data');
  const telemetry = await telemetryService.getRecent('ETH/USDT');
  console.log(`Collected ${telemetry.length} telemetry records`);
  
  // Display telemetry summary
  for (const entry of telemetry) {
    console.log(`Venue: ${entry.venue}, Slippage: ${entry.slippage.toFixed(4)}%, ` +
                `Post-fill delta: ${entry.postFillDelta.toFixed(4)}, ` +
                `Fill IQ: ${entry.fillIQ?.toFixed(1) || 'N/A'}`);
  }
  
  /**
   * Test 3: Route another order after collecting telemetry
   */
  console.log('\nTest 3: Routing with Fill IQ data');
  const order2: OrderIntent = {
    asset: 'ETH/USDT',
    side: 'buy',
    quantity: 0.5,
    price: 2500,
    urgency: 'medium'
  };
  
  // Route the order
  const adaptedRoute = await router.route(order2);
  console.log(`Adapted routing result: ${adaptedRoute.venue}`);
  console.log(`Score: ${adaptedRoute.score.toFixed(2)}, Style: ${adaptedRoute.recommendedStyle}`);
  console.log(`Fill IQ adjusted: ${adaptedRoute.metadata?.fillIQAdjusted || false}`);
  if (adaptedRoute.metadata?.fillIQAdjusted) {
    console.log(`Fill IQ: ${adaptedRoute.metadata.fillIQ}, Venue ranking: ${adaptedRoute.metadata.venueRanking}`);
  }
  
  /**
   * Test 4: Generate quality report
   */
  console.log('\nTest 4: Generating execution quality report');
  const report = await feedbackLoop.generateQualityReport('ETH/USDT');
  
  console.log('Venue Performance:');
  for (const venue of report.venuePerformance) {
    console.log(`${venue.venue}: Fill IQ ${venue.fillIQ.toFixed(1)}, ` +
                `Avg Slippage ${(venue.avgSlippage * 100).toFixed(2)}%, ` +
                `Fills: ${venue.fillCount}`);
  }
  
  console.log(`\nOverall Fill IQ: ${report.overallFillIQ.toFixed(1)}`);
  console.log(`Total executions: ${report.totalExecutions}`);
  
  // Stop the feedback loop
  feedbackLoop.stop();
  console.log('\nExecution feedback loop example completed');
}

// Run the example
runExecutionFeedbackExample().catch(error => {
  console.error('Error in execution feedback example:', error);
}); 