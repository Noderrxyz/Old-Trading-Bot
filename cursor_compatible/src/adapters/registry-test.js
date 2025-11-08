#!/usr/bin/env node
/**
 * AdapterRegistry Integration Test
 * 
 * This script tests the AdapterRegistry implementation with our reliability features.
 */

import { AdapterRegistry } from './registry/AdapterRegistry.js';

// Test logger
function log(message, isError = false) {
  if (isError) {
    console.error(`❌ ${message}`);
  } else {
    console.log(`✅ ${message}`);
  }
}

// Assert function
function assert(condition, message) {
  if (!condition) {
    log(message, true);
    throw new Error(`Assertion failed: ${message}`);
  } else {
    log(message);
  }
}

// Delay function for tests
async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Test the adapter registry
 */
async function testAdapterRegistry() {
  console.log("\n=== Testing Adapter Registry ===");
  
  // Create registry with test settings
  const registry = new AdapterRegistry({
    retryBaseDelayMs: 50,
    retryMaxDelayMs: 500,
    maxRetries: 3,
    circuitBreakerThreshold: 3,
    circuitBreakerResetTimeoutMs: 500, // Short timeout for testing
    useFallbackChains: true,
    metricsEnabled: true
  });
  
  // Test 1: Register chains
  registry.registerChain(1); // Ethereum
  registry.registerChain(137); // Polygon
  
  assert(registry.adapters.has(1), "Should have Ethereum adapter");
  assert(registry.adapters.has(137), "Should have Polygon adapter");
  assert(registry.circuitBreakers.has(1), "Should have circuit breaker for Ethereum");
  assert(registry.retryHandlers.has(1), "Should have retry handler for Ethereum");
  
  // Test 2: Set fallback chain
  registry.setFallbackChain(1, 137);
  assert(registry.fallbackChains.get(1) === 137, "Should set Polygon as fallback for Ethereum");
  
  // Test 3: Initialize adapters
  await registry.initialize();
  log("Adapters initialized");
  
  // Test 4: Normal operation
  const balance = await registry.getBalance(1, '0x71C7656EC7ab88b098defB751B7401B5f6d8976F');
  assert(balance === "100.0", "Should get balance from adapter");
  
  // Test 5: Circuit breaker integration
  // Get access to the adapter to modify it for testing
  const ethAdapter = registry.getAdapter(1);
  const originalGetBalance = ethAdapter.getBalance;
  
  // Make the adapter fail
  ethAdapter.getBalance = async () => {
    throw new Error("network connection timeout");
  };
  
  // Trigger failures to open circuit breaker
  try { await registry.getBalance(1, '0x123'); } catch (e) {}
  try { await registry.getBalance(1, '0x123'); } catch (e) {}
  try { await registry.getBalance(1, '0x123'); } catch (e) {}
  
  // Get circuit breaker state
  const circuitBreaker = registry.getCircuitBreakerForChain(1);
  assert(circuitBreaker.state === 'OPEN', "Circuit breaker should be open after failures");
  
  // Try operation, should fail with circuit breaker error
  try {
    await registry.getBalance(1, '0x123');
    assert(false, "Should fail with circuit breaker open");
  } catch (error) {
    assert(error.message.includes("Circuit breaker open"), "Should get circuit breaker error");
  }
  
  // Test 6: Fallback chain
  // Try with fallback enabled
  try {
    const fallbackBalance = await registry.getBalance(1, '0x71C7656EC7ab88b098defB751B7401B5f6d8976F', true);
    assert(fallbackBalance === "100.0", "Should get balance from fallback chain");
  } catch (error) {
    assert(false, "Fallback should have succeeded: " + error.message);
  }
  
  // Test 7: Wait for circuit to reset and test recovery
  console.log("Waiting for circuit timeout (500ms)...");
  await delay(600);
  
  // Restore adapter for recovery test
  ethAdapter.getBalance = originalGetBalance;
  
  // Circuit should be half-open
  assert(circuitBreaker.state === 'HALF_OPEN', "Circuit should transition to HALF_OPEN after timeout");
  
  // Try operation in half-open state
  const recoveryBalance = await registry.getBalance(1, '0x71C7656EC7ab88b098defB751B7401B5f6d8976F');
  assert(recoveryBalance === "100.0", "Operation should succeed in half-open state");
  
  // We need multiple successful operations to close the circuit
  // The half-open success threshold is 2 by default
  const secondBalance = await registry.getBalance(1, '0x71C7656EC7ab88b098defB751B7401B5f6d8976F');
  assert(secondBalance === "100.0", "Second operation should succeed");
  
  // Circuit should be closed after successful operations reach the threshold
  assert(circuitBreaker.state === 'CLOSED', "Circuit should be CLOSED after successful operations");
  
  // Test 8: Check metrics
  const metrics = registry.getMetrics();
  assert(metrics.requestCount > 0, "Should record request count");
  assert(metrics.successCount > 0, "Should record success count");
  assert(metrics.failureCount > 0, "Should record failure count");
  assert(metrics.circuitBreakerStatus[1].state === 'CLOSED', "Should report circuit breaker state");
  
  // Test 9: Shutdown
  await registry.shutdown();
  log("Adapters shut down");
  
  console.log("All adapter registry tests passed!");
}

/**
 * Run all tests
 */
async function runTests() {
  console.log("=== AdapterRegistry Integration Tests ===");
  
  try {
    await testAdapterRegistry();
    
    console.log("\n=== All tests completed successfully! ===");
  } catch (error) {
    console.error("\n=== Test failed! ===");
    console.error(error);
    process.exit(1);
  }
}

// Run the tests
runTests().catch(error => {
  console.error("Test script failed:", error);
  process.exit(1);
}); 