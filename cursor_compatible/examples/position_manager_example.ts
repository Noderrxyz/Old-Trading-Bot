import { 
  getPositionManager, 
  OrderSide, 
  positionManagerIntegration, 
  PositionEvents 
} from '../src/risk';
import { logger } from '../src/utils/logger';

/**
 * Example script demonstrating how to use the Position Manager
 */
async function runPositionManagerExample() {
  // Get the singleton instance of the Position Manager
  const positionManager = getPositionManager();
  
  // Start the integration layer with monitoring
  positionManagerIntegration.start();
  
  // Set up event listeners for position events
  positionManagerIntegration.onPositionEvent(
    PositionEvents.POSITION_UPDATED,
    (data) => {
      logger.info(`Position updated for ${data.agentId} on ${data.symbol}:`, 
        data.position.netSize, 
        `@ ${data.position.averagePrice}`);
    }
  );
  
  positionManagerIntegration.onPositionEvent(
    PositionEvents.LIMIT_EXCEEDED,
    (data) => {
      logger.warn(`Position limit exceeded for ${data.agentId} on ${data.symbol}!`, 
        `Attempted ${data.side === OrderSide.Buy ? 'buy' : 'sell'} of ${data.size}`);
    }
  );
  
  positionManagerIntegration.onPositionEvent(
    PositionEvents.PNL_THRESHOLD_REACHED,
    (data) => {
      logger.info(`PnL threshold reached for ${data.agentId} on ${data.symbol}:`,
        `Realized: ${data.realizedPnl}, Unrealized: ${data.unrealizedPnl}`);
    }
  );
  
  // Demo using the position manager
  
  // 1. Update market prices
  logger.info('Setting initial market prices...');
  positionManagerIntegration.updateMarketPrice('BTC-USD', 50000.0);
  positionManagerIntegration.updateMarketPrice('ETH-USD', 3000.0);
  
  // 2. Process some orders and fills
  logger.info('Processing orders...');
  
  // Open buy order
  const openBuyOrder = createOrder('BTC-USD', OrderSide.Buy, 1.0, 49500.0, false);
  positionManagerIntegration.handleOrderOrFill('agent1', openBuyOrder);
  
  // Buy order fill
  const buyFill = createOrder('BTC-USD', OrderSide.Buy, 1.0, 50000.0, true, openBuyOrder.orderId);
  positionManagerIntegration.handleOrderOrFill('agent1', buyFill);
  
  // Buy some ETH
  const ethBuy = createOrder('ETH-USD', OrderSide.Buy, 5.0, 3000.0);
  positionManagerIntegration.handleOrderOrFill('agent1', ethBuy);
  
  // 3. Check positions and exposure
  logger.info('Checking positions...');
  const btcPosition = positionManager.getSymbolPosition('agent1', 'BTC-USD');
  logger.info('BTC Position:', btcPosition);
  
  const ethPosition = positionManager.getSymbolPosition('agent1', 'ETH-USD');
  logger.info('ETH Position:', ethPosition);
  
  const totalExposure = positionManager.calculateExposure('agent1');
  logger.info('Total Exposure:', totalExposure);
  
  // 4. Update market price to see unrealized PnL change
  logger.info('Updating market prices to simulate market movement...');
  positionManagerIntegration.updateMarketPrice('BTC-USD', 52000.0);
  positionManagerIntegration.updateMarketPrice('ETH-USD', 3100.0);
  
  // Check updated positions
  const updatedBtcPosition = positionManager.getSymbolPosition('agent1', 'BTC-USD');
  logger.info('Updated BTC Position (after price change):', updatedBtcPosition);
  
  // 5. Sell half the BTC position
  logger.info('Selling half the BTC position...');
  const sellBtc = createOrder('BTC-USD', OrderSide.Sell, 0.5, 52000.0);
  positionManagerIntegration.handleOrderOrFill('agent1', sellBtc);
  
  // Check positions again
  const finalBtcPosition = positionManager.getSymbolPosition('agent1', 'BTC-USD');
  logger.info('Final BTC Position (after partial sell):', finalBtcPosition);
  
  // Get full agent position
  const agentPosition = positionManager.getPosition('agent1');
  logger.info('Full Agent Position:', agentPosition);
  
  // 6. Try to exceed position limits
  logger.info('Attempting to exceed position limits...');
  const bigBuy = createOrder('BTC-USD', OrderSide.Buy, 10.0, 52000.0);
  positionManagerIntegration.handleOrderOrFill('agent1', bigBuy);
  
  // Clean up
  positionManagerIntegration.stop();
  logger.info('Position Manager example completed.');
}

/**
 * Helper function to create an order or fill object
 */
function createOrder(
  symbol: string, 
  side: OrderSide, 
  size: number, 
  price: number, 
  isFill: boolean = true,
  orderId: string = `order-${Date.now()}`
) {
  return {
    symbol,
    side,
    size,
    price,
    timestamp: Date.now(),
    orderId,
    fillId: isFill ? `fill-${Date.now()}` : undefined,
    isFill,
    venue: 'example-exchange',
    strategyId: 'example-strategy'
  };
}

// Run the example
runPositionManagerExample()
  .catch(error => {
    logger.error('Error running Position Manager example:', error);
  }); 