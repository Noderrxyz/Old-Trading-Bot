import { PaperTradingAdapter } from '../execution/adapters/PaperTradingAdapter';
import { SlippageModel } from '../execution/interfaces/PaperTradingTypes';
import { OrderSide, OrderType } from '../execution/order';
import { PositionDirection } from '../types/position';

// Simple test function for paper trading
async function testPaperTrading() {
  console.log('Starting Simple Paper Trading Test');
  
  // Initialize paper trading adapter
  const paperTrading = PaperTradingAdapter.getInstance({
    initialBalance: 10000,
    defaultSlippageModel: SlippageModel.Fixed,
    verboseLogging: true
  });
  
  // Set up basic event listeners
  paperTrading.on('position_update', (event) => {
    const { position, updateType } = event;
    console.log(`Position ${updateType}: ${position.symbol} ${position.direction} ${position.size} @ ${position.entryPrice}`);
    
    if (position.unrealizedPnl) {
      console.log(`Unrealized P&L: $${position.unrealizedPnl.toFixed(2)} (${position.unrealizedPnlPct?.toFixed(2)}%)`);
    }
  });
  
  paperTrading.on('order_executed', (order) => {
    console.log(`Order executed: ${order.symbol} ${order.side} ${order.filledAmount} @ ${order.avgFillPrice}`);
    console.log(`Commission paid: $${order.commission.toFixed(2)}, Slippage: ${order.slippage.toFixed(2)}%`);
  });
  
  // Update prices for some symbols
  paperTrading.updatePrice('BTC/USD', 50000);
  paperTrading.updatePrice('ETH/USD', 3000);
  
  console.log('\n--- Creating Buy Order ---');
  // Create a simple buy order
  const buyOrder = {
    id: 'order1',
    symbol: 'BTC/USD',
    side: OrderSide.Buy,
    type: OrderType.Market,
    amount: 0.1,  // Buy 0.1 BTC
    price: 50000,
    venues: ['paper'],
    maxSlippage: 0.5
  };
  
  // Execute the order
  const buyResult = await paperTrading.executeOrder(buyOrder);
  console.log('Buy execution result:', 
    `Status: ${buyResult.order.status}`,
    `Filled: ${buyResult.order.filledAmount}`,
    `Price: ${buyResult.order.avgFillPrice}`,
    `Commission: ${buyResult.order.commission}`
  );
  
  // Get current portfolio
  const portfolioAfterBuy = paperTrading.getPortfolioSnapshot();
  console.log('\nPortfolio after buy:');
  console.log(`Cash Balance: $${portfolioAfterBuy.cashBalance.toFixed(2)}`);
  console.log(`Portfolio Value: $${portfolioAfterBuy.portfolioValue.toFixed(2)}`);
  console.log('Positions:');
  portfolioAfterBuy.positions.forEach(pos => {
    console.log(`- ${pos.symbol}: ${pos.size} @ ${pos.entryPrice} (${pos.direction})`);
  });
  
  // Simulate price change
  console.log('\n--- Price Change ---');
  paperTrading.updatePrice('BTC/USD', 52000);
  
  // Get updated portfolio
  const portfolioAfterPriceChange = paperTrading.getPortfolioSnapshot();
  console.log('\nPortfolio after price change:');
  console.log(`Cash Balance: $${portfolioAfterPriceChange.cashBalance.toFixed(2)}`);
  console.log(`Portfolio Value: $${portfolioAfterPriceChange.portfolioValue.toFixed(2)}`);
  console.log('Positions:');
  portfolioAfterPriceChange.positions.forEach(pos => {
    console.log(`- ${pos.symbol}: ${pos.size} @ ${pos.entryPrice} (${pos.direction}, Current: ${pos.currentPrice})`);
    if (pos.unrealizedPnl !== undefined && pos.unrealizedPnlPct !== undefined) {
      console.log(`  Unrealized P&L: $${pos.unrealizedPnl.toFixed(2)} (${pos.unrealizedPnlPct.toFixed(2)}%)`);
    }
  });
  
  // Create a sell order
  console.log('\n--- Creating Sell Order ---');
  const sellOrder = {
    id: 'order2',
    symbol: 'BTC/USD',
    side: OrderSide.Sell,
    type: OrderType.Market,
    amount: 0.1,  // Sell all BTC
    price: 52000,
    venues: ['paper'],
    maxSlippage: 0.5
  };
  
  // Execute the sell order
  const sellResult = await paperTrading.executeOrder(sellOrder);
  console.log('Sell execution result:', 
    `Status: ${sellResult.order.status}`,
    `Filled: ${sellResult.order.filledAmount}`,
    `Price: ${sellResult.order.avgFillPrice}`,
    `Commission: ${sellResult.order.commission}`,
    `P&L: $${sellResult.pnl.toFixed(2)}`
  );
  
  // Get final portfolio
  const finalPortfolio = paperTrading.getPortfolioSnapshot();
  console.log('\nFinal Portfolio:');
  console.log(`Cash Balance: $${finalPortfolio.cashBalance.toFixed(2)}`);
  console.log(`Portfolio Value: $${finalPortfolio.portfolioValue.toFixed(2)}`);
  console.log(`Total P&L: $${finalPortfolio.totalPnl.toFixed(2)}`);
  
  console.log('\nTest completed');
}

// Run the test
testPaperTrading().catch(error => {
  console.error('Error in paper trading test:', error);
}); 