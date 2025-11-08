/**
 * Basic usage example for Noderr Trading System
 * This demonstrates how to initialize and use the system
 */

import { createSystem, SystemOrchestrator } from '../packages/core/src';

async function main() {
  console.log('Starting Noderr Trading System...');
  
  // Create system with default configuration
  const system = await createSystem({
    name: 'My Trading Bot',
    environment: 'development',
    logLevel: 'info'
  });
  
  // Listen to system events
  system.on('system-ready', () => {
    console.log('System is ready!');
  });
  
  system.on('alert', (alert) => {
    console.log(`Alert: [${alert.severity}] ${alert.message}`);
  });
  
  system.on('metrics-update', (metrics) => {
    console.log('Metrics:', {
      orders: metrics.ordersProcessed,
      positions: metrics.positionsHeld,
      alerts: metrics.activeAlerts
    });
  });
  
  // Get system components
  const orderManager = system.getComponent('orderManager');
  const multiAsset = system.getComponent('multiAsset');
  const compliance = system.getComponent('compliance');
  
  try {
    // Subscribe to market data
    await multiAsset.subscribe(['BTCUSD', 'ETHUSD']);
    
    // Place a test order
    console.log('Placing test order...');
    const orderId = await multiAsset.placeOrder({
      symbol: 'BTCUSD',
      side: 'BUY',
      quantity: 0.01,
      orderType: 'LIMIT',
      price: 50000,
      timeInForce: 'GTC'
    });
    
    console.log(`Order placed: ${orderId}`);
    
    // Check system status
    const status = system.getStatus();
    console.log('System Status:', {
      status: status.status,
      uptime: Math.floor(status.uptime / 1000) + 's',
      components: Array.from(status.components.values()).map(c => ({
        name: c.name,
        health: c.health
      }))
    });
    
    // Run for 60 seconds
    await new Promise(resolve => setTimeout(resolve, 60000));
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Graceful shutdown
    console.log('Shutting down system...');
    await system.shutdown();
    console.log('System shut down successfully');
  }
}

// Run the example
main().catch(console.error); 