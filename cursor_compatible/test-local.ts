/**
 * Local Testing Script for Noderr Protocol
 * 
 * Run this to test the full system locally with simulated data
 * Usage: npx ts-node test-local.ts
 */

import { SystemOrchestrator, SystemConfig } from './packages/system-orchestrator/src';

// Test configuration for local development
const testConfig: SystemConfig = {
  mode: 'local',
  tradingMode: 'SIMULATION',
  initialCapital: 100000, // $100k test capital
  
  dataConnectors: {
    binance: {
      enabled: true,
      testnet: true,
      symbols: ['BTC-USDT', 'ETH-USDT', 'BNB-USDT']
    },
    coinbase: {
      enabled: false,
      sandbox: true,
      symbols: ['BTC-USD', 'ETH-USD']
    }
  },
  
  strategies: {
    enabled: ['test-momentum'],
    config: {
      'test-momentum': {
        riskPerTrade: 0.02,
        stopLoss: 0.03,
        takeProfit: 0.05,
        minConfidence: 0.65
      }
    }
  }
};

// Helper to format uptime
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// Main test function
async function runLocalTest() {
  console.log('🚀 Starting Noderr Protocol Local Test...\n');
  console.log('📋 Configuration:');
  console.log(`   Mode: ${testConfig.mode}`);
  console.log(`   Trading Mode: ${testConfig.tradingMode}`);
  console.log(`   Initial Capital: $${testConfig.initialCapital.toLocaleString()}`);
  console.log(`   Binance: ${testConfig.dataConnectors.binance?.enabled ? 'Enabled (Testnet)' : 'Disabled'}`);
  console.log(`   Strategies: ${testConfig.strategies.enabled.join(', ')}\n`);
  
  // Create system orchestrator
  const system = new SystemOrchestrator(testConfig);
  
  // Setup event listeners
  system.on('system-started', (event) => {
    console.log('✅ System started successfully\n');
  });
  
  system.on('market-data', (data) => {
    // Log sample market data (throttled)
    if (Math.random() < 0.01) { // 1% of events
      console.log(`📊 Market: ${data.exchange} ${data.symbol} @ $${data.price?.toFixed(2) || 'N/A'}`);
    }
  });
  
  system.on('system-stopped', (event) => {
    console.log(`\n⛔ System stopped: ${event.reason}`);
  });
  
  try {
    // Start the system
    await system.start();
    
    // Initial status
    const initialStatus = system.getStatus();
    console.log('📈 Initial System Status:');
    console.log(`   Alpha Module: ${initialStatus.modules.alpha.status}`);
    console.log(`   Capital Module: ${initialStatus.modules.capital.status}`);
    console.log(`   Execution Module: ${initialStatus.modules.execution}`);
    console.log(`   Safety Module: ${initialStatus.modules.safety}\n`);
    
    // Status monitoring
    const statusInterval = setInterval(() => {
      const status = system.getStatus();
      
      console.log('\n📈 System Status Update:');
      console.log(`   Uptime: ${formatUptime(status.uptime)}`);
      console.log(`   Trading Mode: ${status.tradingMode}`);
      console.log(`   Alpha Signals: ${status.modules.alpha.signalsProcessed}`);
      console.log(`   Alpha Events: ${status.modules.alpha.alphaEvents}`);
      console.log(`   Capital - Total: $${status.modules.capital.total.toLocaleString()}`);
      console.log(`   Capital - Available: $${status.modules.capital.available.toLocaleString()}`);
      console.log(`   Data Feeds: Binance(${status.dataFeeds.binance}), Coinbase(${status.dataFeeds.coinbase})`);
    }, 30000); // Every 30 seconds
    
    // Interactive commands
    console.log('💡 Interactive Commands:');
    console.log('   Press "s" for detailed status');
    console.log('   Press "p" to pause trading');
    console.log('   Press "r" to resume trading');
    console.log('   Press "q" to quit\n');
    
    // Setup keyboard input (if TTY is available)
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      
      process.stdin.on('data', async (chunk) => {
        const key = chunk.toString();
        
        if (key === '\u0003' || key === 'q') { // Ctrl+C or 'q'
          console.log('\n\n🛑 Shutting down...');
          clearInterval(statusInterval);
          await system.shutdown();
          process.exit(0);
        }
        
        if (key === 's') {
          const status = system.getStatus();
          console.log('\n📊 Detailed Status:', JSON.stringify(status, null, 2));
        }
        
        if (key === 'p') {
          console.log('\n⏸️  Pausing trading...');
          // Would integrate with safety controller to pause
        }
        
        if (key === 'r') {
          console.log('\n▶️  Resuming trading...');
          // Would integrate with safety controller to resume
        }
      });
    } else {
      console.log('⚠️  Running in non-interactive mode. Press Ctrl+C to stop.\n');
    }
    
    // Keep the process running
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Received SIGINT, shutting down gracefully...');
      clearInterval(statusInterval);
      await system.shutdown();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\n\n🛑 Received SIGTERM, shutting down gracefully...');
      clearInterval(statusInterval);
      await system.shutdown();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start system:', error);
    process.exit(1);
  }
}

// Run the test
console.log('='.repeat(60));
console.log(' '.repeat(15) + 'NODERR PROTOCOL - LOCAL TEST');
console.log('='.repeat(60) + '\n');

runLocalTest().catch((error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
}); 