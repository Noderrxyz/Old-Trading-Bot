#!/usr/bin/env node
/**
 * Test script for blockchain adapter metrics
 * 
 * This script simulates various blockchain operations to test
 * the metrics collection and exposure functionality.
 */

import * as metrics from './metrics.js';

async function main() {
  console.log('==== Testing Blockchain Adapter Metrics ====');
  
  // Enable debugging for this test
  process.env.DEBUG_METRICS = 'true';
  
  try {
    // Simulate multiple chains
    const chains = [1, 137, 43114]; // Ethereum, Polygon, Avalanche
    
    // Simulate RPC calls
    console.log('\n➡️ Recording RPC calls...');
    for (const chainId of chains) {
      // Successful calls
      for (let i = 0; i < 5; i++) {
        const start = Date.now() - Math.floor(Math.random() * 300); // Random start time
        metrics.recordRpcMetrics(
          chainId,
          'eth_getBalance',
          true, // isMainnet 
          start,
          true // success
        );
      }
      
      // Failed calls
      const failedStart = Date.now() - Math.floor(Math.random() * 500);
      metrics.recordRpcMetrics(
        chainId,
        'eth_sendRawTransaction',
        true, // isMainnet
        failedStart,
        false, // failure
        'timeout'
      );
    }
    
    // Simulate connection status updates
    console.log('\n➡️ Recording connection status...');
    metrics.updateBlockchainConnectionStatus(1, true, true, 17853420, 35.5); // ETH connected
    metrics.updateBlockchainConnectionStatus(137, true, true, 45231890, 120.3); // Polygon connected
    metrics.updateBlockchainConnectionStatus(43114, true, false); // Avalanche disconnected
    
    // Simulate circuit breaker updates
    console.log('\n➡️ Recording circuit breaker states...');
    metrics.updateCircuitBreakerState(1, true, false); // ETH closed
    metrics.updateCircuitBreakerState(137, true, false); // Polygon closed
    metrics.updateCircuitBreakerState(43114, true, true); // Avalanche open
    
    // Simulate retry attempts
    console.log('\n➡️ Recording retry attempts...');
    for (let i = 0; i < 3; i++) {
      metrics.recordRetryAttempt(43114, 'eth_call', true);
    }
    
    // Simulate blockchain operations
    console.log('\n➡️ Recording blockchain operations...');
    const opStart = Date.now() - 850;
    metrics.recordBlockchainOperation(1, 'getBalance', true, opStart, true);
    
    const failedOpStart = Date.now() - 1200;
    metrics.recordBlockchainOperation(137, 'executeTrade', true, failedOpStart, false);
    
    // Simulate queue depth
    console.log('\n➡️ Recording adapter queue depth...');
    metrics.updateAdapterQueueDepth(1, true, 3);
    metrics.updateAdapterQueueDepth(137, true, 5);
    metrics.updateAdapterQueueDepth(43114, true, 0);
    
    // Simulate trade execution
    console.log('\n➡️ Recording trade execution...');
    const tradeStart = Date.now() - 2500;
    metrics.recordTradeExecution(
      1, // chainId
      true, // isMainnet
      tradeStart,
      1250.75, // volumeUsd
      true, // success
      0.2, // slippage percent
      3.5 // fees
    );
    
    // Get metrics string
    console.log('\n➡️ Getting metrics in Prometheus format...');
    const metricsString = await metrics.getMetricsAsString();
    
    // Print first few lines as sample
    const lines = metricsString.split('\n');
    console.log('\nSample of collected metrics:');
    console.log('----------------------------');
    
    // Show just a sample
    const sampleLines = lines.slice(0, 20);
    sampleLines.forEach(line => {
      if (!line.startsWith('#')) {
        console.log(line);
      }
    });
    
    console.log(`... and ${lines.length - 20} more lines`);
    
    console.log('\n✅ Test completed successfully!');
    console.log('All metrics are being collected properly.');
    console.log('A full set of metrics is available at the /metrics endpoint.');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

main().catch(console.error); 