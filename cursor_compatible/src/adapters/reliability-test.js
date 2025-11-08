#!/usr/bin/env node
/**
 * Direct Testing Script for Reliability Features
 * 
 * This script tests the circuit breaker and retry handler components
 * without relying on Jest, useful when the test infrastructure has issues.
 */

import { CircuitBreaker } from './registry/reliability/CircuitBreaker.js';
import { RetryHandler } from './registry/reliability/RetryHandler.js';

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
 * Test circuit breaker functionality
 */
async function testCircuitBreaker() {
  console.log("\n=== Testing Circuit Breaker ===");
  
  // Create a circuit breaker with test settings
  const circuitBreaker = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 500, // Short timeout for testing
    halfOpenSuccessThreshold: 2,
    chainId: 1,
    isMainnet: true
  });
  
  // Test 1: Initial state should be CLOSED
  assert(circuitBreaker.state === 'CLOSED', "Initial state should be CLOSED");
  assert(circuitBreaker.isOpen() === false, "Circuit should not be open initially");
  
  // Test 2: After failures, circuit should open
  circuitBreaker.recordFailure(new Error("Test failure 1"));
  assert(circuitBreaker.state === 'CLOSED', "Circuit should remain CLOSED after 1 failure");
  
  circuitBreaker.recordFailure(new Error("Test failure 2"));
  assert(circuitBreaker.state === 'CLOSED', "Circuit should remain CLOSED after 2 failures");
  
  circuitBreaker.recordFailure(new Error("Test failure 3"));
  assert(circuitBreaker.state === 'OPEN', "Circuit should be OPEN after 3 failures");
  assert(circuitBreaker.isOpen() === true, "isOpen() should report true for open circuit");
  
  // Test 3: Circuit should transition to half-open after timeout
  console.log("Waiting for circuit timeout (500ms)...");
  await delay(600);
  assert(circuitBreaker.state === 'HALF_OPEN', "Circuit should transition to HALF_OPEN after timeout");
  
  // Test 4: Successful operations in half-open should close circuit
  circuitBreaker.recordSuccess();
  assert(circuitBreaker.state === 'HALF_OPEN', "Circuit should remain HALF_OPEN after 1 success");
  
  circuitBreaker.recordSuccess();
  assert(circuitBreaker.state === 'CLOSED', "Circuit should be CLOSED after successful operations in half-open state");
  
  // Test 5: Failure in half-open should reopen circuit
  // First, get back to HALF_OPEN state
  circuitBreaker.recordFailure(new Error("Test failure 4"));
  circuitBreaker.recordFailure(new Error("Test failure 5"));
  circuitBreaker.recordFailure(new Error("Test failure 6"));
  assert(circuitBreaker.state === 'OPEN', "Circuit should be OPEN again after failures");
  
  await delay(600);
  assert(circuitBreaker.state === 'HALF_OPEN', "Circuit should transition to HALF_OPEN again");
  
  // Now fail in half-open state
  circuitBreaker.recordFailure(new Error("Half-open failure"));
  assert(circuitBreaker.state === 'OPEN', "Circuit should reopen immediately on failure in half-open state");
  
  // Test 6: Force reset
  circuitBreaker.forceReset();
  assert(circuitBreaker.state === 'CLOSED', "Circuit should be CLOSED after force reset");
  
  console.log("All circuit breaker tests passed!");
}

/**
 * Test retry handler functionality
 */
async function testRetryHandler() {
  console.log("\n=== Testing Retry Handler ===");
  
  // Create a retry handler with test settings
  const retryHandler = new RetryHandler({
    maxRetries: 3,
    baseDelayMs: 50,
    maxDelayMs: 500,
    useJitter: false, // Disable jitter for predictable testing
    chainId: 1,
    isMainnet: true
  });
  
  // Test 1: Successful operation should not retry
  let attempts = 0;
  await retryHandler.execute(async () => {
    attempts++;
    return "success";
  }, "test-operation");
  
  assert(attempts === 1, "Successful operation should not retry");
  
  // Test 2: Retry on failure
  attempts = 0;
  let succeeded = false;
  
  try {
    await retryHandler.execute(async () => {
      attempts++;
      if (attempts <= 3) {
        throw new Error("Retriable network error");
      }
      succeeded = true;
      return "success after retry";
    }, "test-retry-operation");
    
    assert(succeeded, "Operation should succeed after retries");
    assert(attempts === 4, "Operation should be attempted 4 times (initial + 3 retries)");
  } catch (error) {
    assert(false, "Retry should have succeeded but failed: " + error.message);
  }
  
  // Test 3: Maximum retries exhausted
  attempts = 0;
  let errorCaught = false;
  
  try {
    await retryHandler.execute(async () => {
      attempts++;
      // Use a known retriable error type
      throw new Error("network connection timeout");
    }, "test-max-retries");
  } catch (error) {
    errorCaught = true;
    assert(attempts === 4, "Should attempt 4 times (initial + 3 retries) before giving up");
  }
  
  assert(errorCaught, "Error should be thrown after max retries");
  
  // Test 4: Don't retry non-retriable errors
  attempts = 0;
  errorCaught = false;
  
  try {
    await retryHandler.execute(async () => {
      attempts++;
      const error = new Error("Circuit breaker open");
      throw error;
    }, "test-non-retriable");
  } catch (error) {
    errorCaught = true;
    assert(error.message === "Circuit breaker open", "Should get the original error");
  }
  
  assert(errorCaught, "Non-retriable error should be thrown immediately");
  assert(attempts === 1, "Non-retriable errors should not be retried");
  
  // Test 5: Result validation and retry
  attempts = 0;
  
  const result = await retryHandler.executeWithResultValidation(
    async () => {
      attempts++;
      if (attempts <= 2) {
        return null; // Invalid result
      }
      return { value: "valid result" };
    },
    (result) => result !== null && result.value !== undefined,
    "test-validation"
  );
  
  assert(result.value === "valid result", "Should eventually return valid result");
  assert(attempts === 3, "Should retry until valid result obtained");
  
  console.log("All retry handler tests passed!");
}

/**
 * Run all tests
 */
async function runTests() {
  console.log("=== Reliability Features Direct Tests ===");
  
  try {
    // Test circuit breaker
    await testCircuitBreaker();
    
    // Test retry handler
    await testRetryHandler();
    
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