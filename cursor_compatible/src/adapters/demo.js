#!/usr/bin/env node
/**
 * Blockchain Adapter Demo
 * 
 * This script demonstrates the key features of the blockchain adapter system
 * including reliability features, monitoring, and cross-chain operations.
 */

import { AdapterRegistry } from './registry/AdapterRegistry.js';
import { createAdapter } from './index.js';
import { CHAINS, ASSETS } from './constants.js';
import { BlockchainTelemetry } from './telemetry/BlockchainTelemetry.js';

// Sample wallet address for demo
const WALLET_ADDRESS = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';

/**
 * Demo implementation
 */
async function runDemo() {
  console.log('Blockchain Adapter Demo');
  console.log('======================\n');
  
  // Create a registry with reliability features
  const registry = new AdapterRegistry({
    retryBaseDelayMs: 500,
    retryMaxDelayMs: 5000,
    maxRetries: 3,
    circuitBreakerThreshold: 5,
    circuitBreakerResetTimeoutMs: 10000,
    useFallbackChains: true,
    metricsEnabled: true
  });
  
  console.log('1. Registering chains...');
  
  // Register Ethereum, Polygon, and Avalanche
  registry.registerChain(CHAINS.ETHEREUM.id);
  registry.registerChain(CHAINS.POLYGON.id);
  registry.registerChain(CHAINS.AVALANCHE.id);
  
  // Set up fallback relationships
  registry.setFallbackChain(CHAINS.ETHEREUM.id, CHAINS.POLYGON.id);
  registry.setFallbackChain(CHAINS.POLYGON.id, CHAINS.AVALANCHE.id);
  
  console.log('2. Initializing adapters...');
  await registry.initialize();
  
  console.log('3. Checking balances...');
  
  // Check balance on Ethereum
  try {
    const ethBalance = await registry.getBalance(CHAINS.ETHEREUM.id, WALLET_ADDRESS);
    console.log(`   ETH Balance: ${ethBalance}`);
  } catch (error) {
    console.error(`   Failed to get ETH balance: ${error.message}`);
  }
  
  // Check balance on Polygon
  try {
    const maticBalance = await registry.getBalance(CHAINS.POLYGON.id, WALLET_ADDRESS);
    console.log(`   MATIC Balance: ${maticBalance}`);
  } catch (error) {
    console.error(`   Failed to get MATIC balance: ${error.message}`);
  }
  
  console.log('\n4. Getting quotes...');
  
  // Get quote on Ethereum (ETH -> USDC)
  try {
    const ethQuote = await registry.getQuote(
      ASSETS[CHAINS.ETHEREUM.id].NATIVE,
      ASSETS[CHAINS.ETHEREUM.id].USDC,
      '1.0'
    );
    console.log(`   1 ETH -> ${ethQuote.rate} USDC (fee: ${ethQuote.fee})`);
  } catch (error) {
    console.error(`   Failed to get ETH quote: ${error.message}`);
  }
  
  // Get cross-chain quote (ETH -> MATIC)
  try {
    const crossChainQuote = await registry.getQuote(
      ASSETS[CHAINS.ETHEREUM.id].NATIVE,
      ASSETS[CHAINS.POLYGON.id].NATIVE,
      '1.0'
    );
    console.log(`   1 ETH -> ${crossChainQuote.rate} MATIC (fee: ${crossChainQuote.fee})`);
    if (crossChainQuote.route) {
      console.log(`   Route: ${crossChainQuote.route.join(' -> ')}`);
    }
  } catch (error) {
    console.error(`   Failed to get cross-chain quote: ${error.message}`);
  }
  
  console.log('\n5. Demonstrating circuit breaker...');
  
  // Get the Ethereum adapter
  const ethAdapter = registry.getAdapter(CHAINS.ETHEREUM.id);
  
  // Force failures to trigger circuit breaker
  const originalGetBalance = ethAdapter.getBalance;
  ethAdapter.getBalance = async () => {
    throw new Error('Simulated RPC failure');
  };
  
  console.log('   Sending requests to failing adapter...');
  
  // Send multiple requests to trigger circuit breaker
  for (let i = 1; i <= 6; i++) {
    try {
      await registry.getBalance(CHAINS.ETHEREUM.id, WALLET_ADDRESS);
      console.log(`   Request ${i}: Success (unexpected)`);
    } catch (error) {
      console.log(`   Request ${i}: Failed - ${error.message}`);
    }
  }
  
  // Check circuit breaker state
  const circuitBreaker = registry.getCircuitBreakerForChain(CHAINS.ETHEREUM.id);
  console.log(`   Circuit breaker state: ${circuitBreaker.state}`);
  
  // Try with fallback enabled
  console.log('\n6. Testing fallback to Polygon...');
  try {
    // This should use the fallback chain (Polygon)
    const balanceWithFallback = await registry.getBalance(CHAINS.ETHEREUM.id, WALLET_ADDRESS, true);
    console.log(`   Balance through fallback: ${balanceWithFallback}`);
    console.log('   Fallback successful!');
  } catch (error) {
    console.error(`   Fallback failed: ${error.message}`);
  }
  
  // Restore adapter
  ethAdapter.getBalance = originalGetBalance;
  
  console.log('\n7. Checking registry metrics...');
  
  // Get adapter metrics
  const metrics = registry.getMetrics();
  console.log('   Registry metrics:');
  console.log(JSON.stringify(metrics, null, 2));
  
  // Shutdown
  console.log('\n8. Shutting down adapters...');
  await registry.shutdown();
  
  console.log('\nDemo completed successfully!');
}

// Run the demo
runDemo().catch(error => {
  console.error('Demo failed with error:', error);
  process.exit(1);
}); 