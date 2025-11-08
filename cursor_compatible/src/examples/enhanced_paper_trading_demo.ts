import { EnhancedPaperTrading } from './enhanced_paper_trading';

/**
 * Demo for running the enhanced paper trading system with a shorter timeframe
 */
async function runEnhancedPaperTradingDemo() {
  console.log('Starting Enhanced Paper Trading Demo');
  
  // Define symbols to trade
  const symbols = ['BTC/USD', 'ETH/USD'];
  
  // Create the enhanced paper trading system
  const system = new EnhancedPaperTrading(symbols, 10000); // $10k initial balance
  
  // Start the system
  system.start(1000); // 1-second update interval for faster demo
  
  // Run for 30 seconds
  console.log('System will run for 30 seconds...');
  await new Promise(resolve => setTimeout(resolve, 30000));
  
  // Run a quick backtest
  const backtestResult = await system.runBacktest('BTC/USD', 7); // 7-day backtest
  console.log('Backtest results:', backtestResult);
  
  // Get performance report
  const report = system.getPerformanceReport();
  console.log('\nPerformance Report:');
  console.log(`Portfolio Value: $${report.portfolio.portfolioValue.toFixed(2)}`);
  console.log(`Total P&L: $${report.portfolio.totalPnl.toFixed(2)}`);
  
  // Stop the system
  system.stop();
  
  console.log('\nDemo completed');
}

// Run the demo
runEnhancedPaperTradingDemo().catch(err => {
  console.error('Error in paper trading demo:', err);
  process.exit(1);
}); 