/**
 * Blockchain Adapter Metrics Example
 * 
 * This example demonstrates how to use the metrics system with blockchain adapters
 * to collect and expose metrics on adapter performance and reliability.
 */

import express from 'express';
import cors from 'cors';
import { AdapterRegistry } from '../../adapters/registry/AdapterRegistry.js';
import * as metrics from '../metrics.js';
import { enhanceAdapterWithTelemetry } from '../../adapters/telemetry/BlockchainTelemetry.js';

// Sample wallet address for testing
const TEST_WALLET = '0x0000000000000000000000000000000000000000';

// Main example function
async function runExample() {
  console.log('Blockchain Adapter Metrics Example');
  console.log('================================\n');
  
  // Create adapter registry
  console.log('1. Creating adapter registry...');
  const registry = new AdapterRegistry({
    metricsEnabled: true
  });
  
  // Register chains - using Ethereum mainnet, Polygon, Avalanche
  console.log('2. Registering chains...');
  const chainIds = [1, 137, 43114];
  
  chainIds.forEach(chainId => {
    registry.registerChain(chainId);
    console.log(`   - Registered chain ${chainId}`);
  });
  
  try {
    // Initialize adapters
    console.log('\n3. Initializing adapters...');
    await registry.initialize();
    console.log('   - All adapters initialized successfully');
    
    // Set up fallback chains
    console.log('\n4. Setting up fallback chains...');
    registry.setFallbackChain(1, 137);  // Ethereum -> Polygon as fallback
    console.log('   - Set Polygon as fallback for Ethereum');
    
    // Simulate operations with metrics collection
    console.log('\n5. Simulating adapter operations...');
    
    // Get balance (should succeed)
    console.log('   - Getting balance on Ethereum...');
    try {
      const balance = await registry.getBalance(1, TEST_WALLET);
      console.log(`     Balance: ${balance}`);
    } catch (error) {
      console.error(`     Failed: ${error.message}`);
    }
    
    // Simulate a quote operation
    console.log('   - Getting quote on Polygon...');
    try {
      const fromAsset = { chainId: 137, symbol: 'MATIC', address: '0x0000000000000000000000000000000000000000' };
      const toAsset = { chainId: 137, symbol: 'USDC', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' };
      const amount = '10.0';
      
      const quote = await registry.getQuote(fromAsset, toAsset, amount);
      console.log(`     Quote rate: ${quote.rate}`);
    } catch (error) {
      console.error(`     Failed: ${error.message}`);
    }
    
    // Simulate circuit breaker triggering
    console.log('\n6. Simulating circuit breaker...');
    console.log('   - Updating Avalanche circuit breaker state');
    
    // Get the circuit breaker for Avalanche
    const circuitBreaker = registry.getCircuitBreakerForChain(43114);
    
    // Simulate the circuit breaker opening
    circuitBreaker.open();
    console.log('   - Circuit breaker opened');
    
    // Simulate operation with circuit breaker open (should fail)
    console.log('   - Attempting operation with circuit breaker open...');
    try {
      await registry.getBalance(43114, TEST_WALLET);
      console.log('     Operation succeeded (unexpected)');
    } catch (error) {
      console.log(`     Operation failed as expected: ${error.message}`);
    }
    
    // Close the circuit breaker
    circuitBreaker.close();
    console.log('   - Circuit breaker closed');
    
    // Show collected metrics in Prometheus format
    console.log('\n7. Generated Prometheus metrics:\n');
    const metricsText = await metrics.getMetricsAsString();
    
    // Show just a sample for demonstration purposes
    console.log('Sample of metrics (truncated):');
    console.log('------------------------------');
    const lines = metricsText.split('\n');
    
    // Show blockchain-specific metrics
    const blockchainMetrics = lines.filter(line => 
      line.includes('blockchain_') && 
      !line.includes('# HELP') && 
      !line.includes('# TYPE')
    );
    
    blockchainMetrics.slice(0, 15).forEach(line => console.log(line));
    console.log(`... and ${blockchainMetrics.length - 15} more metrics`);
    
    // Set up metrics HTTP endpoint
    console.log('\n8. Setting up metrics HTTP endpoint...');
    await setupMetricsEndpoint();
    
    // Cleanup
    console.log('\n9. Shutting down adapters...');
    await registry.shutdown();
    
    console.log('\nExample complete! Metrics server is still running.');
    console.log('Visit http://localhost:3000/metrics to see all metrics.');
    console.log('Press Ctrl+C to exit.');
    
  } catch (error) {
    console.error('\nExample failed with error:', error);
    
    // Attempt cleanup
    try {
      await registry.shutdown();
    } catch (err) {
      // Ignore shutdown errors
    }
  }
}

/**
 * Set up an Express server to expose metrics endpoint
 */
async function setupMetricsEndpoint() {
  const app = express();
  app.use(cors());
  
  // Metrics endpoint
  app.get('/metrics', async (req, res) => {
    try {
      res.set('Content-Type', 'text/plain');
      const metricsText = await metrics.getMetricsAsString();
      res.send(metricsText);
    } catch (error) {
      console.error('Error serving metrics:', error);
      res.status(500).send('Error collecting metrics');
    }
  });
  
  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });
  
  // Start server
  const port = 3000;
  app.listen(port, () => {
    console.log(`   - Metrics server running at http://localhost:${port}/metrics`);
  });
}

// Run the example
runExample().catch(console.error); 