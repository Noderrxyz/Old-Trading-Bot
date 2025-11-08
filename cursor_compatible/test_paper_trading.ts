import { EnhancedPaperTradingAdapter } from '../execution/adapters/EnhancedPaperTradingAdapter';
import { SlippageModel } from '../execution/interfaces/PaperTradingTypes';
import { Order, OrderSide, OrderType } from '../execution/order';
import { v4 as uuidv4 } from 'uuid';

async function testPaperTrading() {
  console.log("Testing EnhancedPaperTradingAdapter...");
  
  // Create adapter instance
  const adapter = EnhancedPaperTradingAdapter.getEnhancedInstance({
    initialBalance: 100000,
    defaultSlippageModel: SlippageModel.SizeDependent,
    defaultCommissionRate: 0.1,
    maxPositionSizePercent: 15,
    defaultLatencyMs: 150,
    enforceRealisticConstraints: true,
    orderFillProbability: 0.98,
    verboseLogging: true
  });
  
  // Enable streaming mode
  adapter.addMarketDataStream('BTC/USD', 1000);
  adapter.addMarketDataStream('ETH/USD', 1000);
  adapter.startMarketDataStreams();
  
  // Wait for some price data to be generated
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Create a test order
  const order: Order = {
    id: uuidv4(),
    symbol: 'BTC/USD',
    side: OrderSide.Buy,
    type: OrderType.Market,
    amount: 0.1,
    price: adapter.getPrice('BTC/USD') || 0,
    venues: ['paper']
  };
  
  console.log(`Executing order to buy 0.1 BTC at ~$${adapter.getPrice('BTC/USD')?.toFixed(2)}`);
  
  try {
    // Execute the order
    const result = await adapter.executeOrder(order);
    
    console.log("Order execution result:");
    console.log(`- Status: ${result.order?.status}`);
    console.log(`- Filled amount: ${result.order?.filledAmount}`);
    console.log(`- Avg fill price: $${result.order?.avgFillPrice.toFixed(2)}`);
    console.log(`- Commission: $${result.order?.commission.toFixed(2)}`);
    console.log(`- Slippage: ${result.order?.slippage.toFixed(4)}%`);
    
    // Get portfolio snapshot
    const portfolio = adapter.getPortfolioSnapshot();
    console.log("\nPortfolio snapshot:");
    console.log(`- Cash balance: $${portfolio.cashBalance.toFixed(2)}`);
    console.log(`- Portfolio value: $${portfolio.portfolioValue.toFixed(2)}`);
    console.log(`- Positions count: ${portfolio.positions.length}`);
    
    // List positions
    if (portfolio.positions.length > 0) {
      console.log("\nPositions:");
      for (const position of portfolio.positions) {
        console.log(`- ${position.symbol}: ${position.size} @ $${position.entryPrice.toFixed(2)}`);
        console.log(`  Current price: $${position.currentPrice.toFixed(2)}`);
        if (position.unrealizedPnl) {
          console.log(`  Unrealized P&L: $${position.unrealizedPnl.toFixed(2)} (${position.unrealizedPnlPct?.toFixed(2)}%)`);
        }
      }
    }
    
    // Create another test order (sell half)
    if (portfolio.positions.length > 0) {
      const position = portfolio.positions[0];
      const sellOrder: Order = {
        id: uuidv4(),
        symbol: position.symbol,
        side: OrderSide.Sell,
        type: OrderType.Market,
        amount: position.size / 2,
        price: adapter.getPrice(position.symbol) || 0,
        venues: ['paper']
      };
      
      console.log(`\nExecuting order to sell ${sellOrder.amount} ${position.symbol} at ~$${adapter.getPrice(position.symbol)?.toFixed(2)}`);
      
      // Execute the sell order
      const sellResult = await adapter.executeOrder(sellOrder);
      
      console.log("Sell order execution result:");
      console.log(`- Status: ${sellResult.order?.status}`);
      console.log(`- Filled amount: ${sellResult.order?.filledAmount}`);
      console.log(`- Avg fill price: $${sellResult.order?.avgFillPrice.toFixed(2)}`);
      console.log(`- P&L: $${sellResult.pnl.toFixed(2)}`);
    }
    
    // Get updated portfolio
    const updatedPortfolio = adapter.getPortfolioSnapshot();
    console.log("\nUpdated portfolio snapshot:");
    console.log(`- Cash balance: $${updatedPortfolio.cashBalance.toFixed(2)}`);
    console.log(`- Portfolio value: $${updatedPortfolio.portfolioValue.toFixed(2)}`);
    
    // Let prices update for a while
    console.log("\nWaiting for market data updates...");
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Get final portfolio state
    const finalPortfolio = adapter.getPortfolioSnapshot();
    console.log("\nFinal portfolio snapshot:");
    console.log(`- Cash balance: $${finalPortfolio.cashBalance.toFixed(2)}`);
    console.log(`- Portfolio value: $${finalPortfolio.portfolioValue.toFixed(2)}`);
    console.log(`- Total P&L: $${finalPortfolio.totalPnl.toFixed(2)}`);
    
    // Now test the checkpoint functionality
    console.log("\nTesting state persistence...");
    adapter.saveStateToDisk();
    console.log("State saved to disk");
    
    // Shut down adapter
    await adapter.shutdown();
    console.log("Test completed successfully");
  } catch (error) {
    console.error("Error during test:", error);
  }
}

// Run the test
testPaperTrading().catch(error => {
  console.error("Unhandled error:", error);
}); 