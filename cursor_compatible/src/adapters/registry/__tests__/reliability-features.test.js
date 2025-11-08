/**
 * Reliability Features Integration Tests
 * 
 * This test suite validates the proper functioning of reliability features
 * including circuit breakers, retry with exponential backoff, and adaptive
 * failure handling in the blockchain adapters.
 */

import { CircuitBreaker } from '../reliability/CircuitBreaker.js';
import { RetryHandler } from '../reliability/RetryHandler.js';
import { AdapterRegistry } from '../AdapterRegistry.js';

// Mock adapter for testing
class MockAdapter {
  constructor(config = {}) {
    this.config = {
      shouldFail: false,
      shouldTimeout: false,
      failureCount: 0,
      currentFailures: 0,
      ...config
    };
    
    this.connectCalls = 0;
    this.getBalanceCalls = 0;
    this.getQuoteCalls = 0;
    this.chainId = config.chainId || 1;
  }
  
  async connect() {
    this.connectCalls++;
    return this._processOperation('connect');
  }
  
  async getBalance(address) {
    this.getBalanceCalls++;
    return this._processOperation('getBalance', '100.0');
  }
  
  async getQuote(fromAsset, toAsset, amount) {
    this.getQuoteCalls++;
    return this._processOperation('getQuote', {
      fromAsset,
      toAsset,
      amount,
      rate: '1.5',
      fee: '0.1'
    });
  }
  
  async _processOperation(operation, returnValue) {
    if (this.config.shouldFail) {
      if (this.config.failureCount === 0 || this.config.currentFailures < this.config.failureCount) {
        this.config.currentFailures++;
        
        // Simulate different types of failures
        if (this.config.errorType === 'network') {
          throw new Error('Network error: connection refused');
        } else if (this.config.errorType === 'timeout') {
          throw new Error('Request timed out');
        } else if (this.config.errorType === 'rpc') {
          const error = new Error('RPC error: service unavailable');
          error.code = -32603;
          throw error;
        } else {
          throw new Error(`Mock ${operation} failure`);
        }
      }
    }
    
    if (this.config.shouldTimeout) {
      // Simulate async timeout
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    return returnValue;
  }
  
  // Method to simulate recovery
  recover() {
    this.config.shouldFail = false;
    this.config.currentFailures = 0;
  }
  
  // Method to start failing
  startFailing(errorType = 'general') {
    this.config.shouldFail = true;
    this.config.errorType = errorType;
  }
}

describe('Blockchain Adapter Reliability Features', () => {
  describe('CircuitBreaker', () => {
    test('should open circuit after failures threshold is reached', async () => {
      // Create a circuit breaker with a low threshold
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeoutMs: 100,
        chainId: 1
      });
      
      // Should start closed
      expect(circuitBreaker.state).toBe('CLOSED');
      
      // Record failures
      circuitBreaker.recordFailure(new Error('Test failure 1'));
      expect(circuitBreaker.state).toBe('CLOSED');
      
      circuitBreaker.recordFailure(new Error('Test failure 2'));
      expect(circuitBreaker.state).toBe('CLOSED');
      
      // This should open the circuit
      circuitBreaker.recordFailure(new Error('Test failure 3'));
      expect(circuitBreaker.state).toBe('OPEN');
      expect(circuitBreaker.isOpen()).toBe(true);
      
      // Execute should fail immediately when circuit is open
      await expect(
        circuitBreaker.execute(() => Promise.resolve('should not reach here'))
      ).rejects.toThrow('Circuit breaker open');
    });
    
    test('should transition to half-open after reset timeout', async () => {
      // Create a circuit breaker with a short reset timeout
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 100 // 100ms for quick testing
      });
      
      // Open the circuit
      circuitBreaker.recordFailure(new Error('Test failure 1'));
      circuitBreaker.recordFailure(new Error('Test failure 2'));
      expect(circuitBreaker.state).toBe('OPEN');
      
      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Should be half-open now
      expect(circuitBreaker.state).toBe('HALF_OPEN');
    });
    
    test('should close circuit after successful operations in half-open state', async () => {
      // Create a circuit breaker
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 100,
        halfOpenSuccessThreshold: 2
      });
      
      // Open the circuit
      circuitBreaker.open();
      expect(circuitBreaker.state).toBe('OPEN');
      
      // Transition to half-open
      circuitBreaker.transitionToHalfOpen();
      expect(circuitBreaker.state).toBe('HALF_OPEN');
      
      // Record successful operations
      circuitBreaker.recordSuccess();
      expect(circuitBreaker.state).toBe('HALF_OPEN');
      
      // This should close the circuit
      circuitBreaker.recordSuccess();
      expect(circuitBreaker.state).toBe('CLOSED');
    });
    
    test('should reopen circuit on failure in half-open state', async () => {
      // Create a circuit breaker
      const circuitBreaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 100
      });
      
      // Open and transition to half-open
      circuitBreaker.open();
      circuitBreaker.transitionToHalfOpen();
      expect(circuitBreaker.state).toBe('HALF_OPEN');
      
      // Record a success
      circuitBreaker.recordSuccess();
      expect(circuitBreaker.state).toBe('HALF_OPEN');
      
      // Record a failure - should reopen
      circuitBreaker.recordFailure(new Error('Test failure in half-open'));
      expect(circuitBreaker.state).toBe('OPEN');
    });
  });
  
  describe('RetryHandler', () => {
    test('should retry operation on failure with exponential backoff', async () => {
      const retryHandler = new RetryHandler({
        maxRetries: 3,
        baseDelayMs: 50,
        useJitter: false // Disable jitter for consistent testing
      });
      
      let attempts = 0;
      const operation = async () => {
        attempts++;
        if (attempts <= 2) {
          throw new Error('Retriable network error');
        }
        return 'success';
      };
      
      const result = await retryHandler.execute(operation, 'test-operation');
      
      expect(result).toBe('success');
      expect(attempts).toBe(3); // Initial + 2 retries
    });
    
    test('should not retry non-retriable errors', async () => {
      const retryHandler = new RetryHandler({
        maxRetries: 3,
        baseDelayMs: 50
      });
      
      let attempts = 0;
      const operation = async () => {
        attempts++;
        // Throw a non-retriable error
        const error = new Error('Circuit breaker open');
        throw error;
      };
      
      await expect(
        retryHandler.execute(operation, 'test-operation')
      ).rejects.toThrow('Circuit breaker open');
      
      expect(attempts).toBe(1); // Only the initial attempt, no retries
    });
    
    test('should validate results and retry if validation fails', async () => {
      const retryHandler = new RetryHandler({
        maxRetries: 2,
        baseDelayMs: 50
      });
      
      let attempts = 0;
      const operation = async () => {
        attempts++;
        // Return invalid results for first 2 attempts
        if (attempts <= 1) {
          return null;
        }
        return { value: 'valid data' };
      };
      
      // Validator function - checks for non-null result with value property
      const validator = (result) => result !== null && result.value !== undefined;
      
      const result = await retryHandler.executeWithResultValidation(
        operation, 
        validator,
        'test-validation'
      );
      
      expect(result).toEqual({ value: 'valid data' });
      expect(attempts).toBe(2); // Should succeed on second attempt
    });
    
    test('should throw if all retry attempts fail validation', async () => {
      const retryHandler = new RetryHandler({
        maxRetries: 2,
        baseDelayMs: 50
      });
      
      const operation = async () => {
        // Always return invalid result
        return null;
      };
      
      const validator = (result) => result !== null;
      
      await expect(
        retryHandler.executeWithResultValidation(operation, validator, 'always-invalid')
      ).rejects.toThrow('failed validation after all retry attempts');
    });
  });
  
  describe('Integrated Reliability Features', () => {
    test('should handle transient failures with retries', async () => {
      // Create a mock adapter that will fail twice then succeed
      const mockAdapter = new MockAdapter({
        shouldFail: true,
        failureCount: 2,
        errorType: 'network'
      });
      
      // Create registry with retry settings
      const registry = new AdapterRegistry({
        retryBaseDelayMs: 50,
        retryMaxDelayMs: 200,
        maxRetries: 3
      });
      
      // Register the mock adapter
      registry.adapters.set(1, mockAdapter);
      
      // Should succeed despite failures, thanks to retries
      const balance = await registry.getBalance(1, '0x123');
      
      expect(balance).toBe('100.0');
      expect(mockAdapter.getBalanceCalls).toBe(3); // Initial + 2 retries
    });
    
    test('should open circuit breaker after too many failures', async () => {
      // Create a mock adapter that will always fail
      const mockAdapter = new MockAdapter({
        shouldFail: true,
        errorType: 'rpc'
      });
      
      // Create registry with circuit breaker settings
      const registry = new AdapterRegistry({
        retryBaseDelayMs: 50,
        maxRetries: 2,
        circuitBreakerThreshold: 3,
        circuitBreakerResetTimeoutMs: 1000
      });
      
      // Register the mock adapter
      registry.adapters.set(1, mockAdapter);
      
      // Make enough calls to trigger circuit breaker
      try { await registry.getBalance(1, '0x123'); } catch (e) {}
      try { await registry.getBalance(1, '0x123'); } catch (e) {}
      try { await registry.getBalance(1, '0x123'); } catch (e) {}
      
      // This should fail with circuit breaker error
      await expect(
        registry.getBalance(1, '0x123')
      ).rejects.toThrow('Circuit breaker open');
    });
    
    test('should route to fallback chain when primary fails', async () => {
      // Primary chain adapter (will fail)
      const primaryAdapter = new MockAdapter({
        shouldFail: true,
        chainId: 1
      });
      
      // Fallback chain adapter (will work)
      const fallbackAdapter = new MockAdapter({
        shouldFail: false,
        chainId: 137
      });
      
      // Create registry
      const registry = new AdapterRegistry({
        useFallbackChains: true
      });
      
      // Register both adapters
      registry.adapters.set(1, primaryAdapter);
      registry.adapters.set(137, fallbackAdapter);
      
      // Set fallback relationship
      registry.setFallbackChain(1, 137);
      
      // This should use the fallback
      const quote = await registry.getQuote({
        chainId: 1,
        symbol: 'ETH'
      }, {
        chainId: 1,
        symbol: 'USDC'
      }, '1.0');
      
      // Verify the right adapter was called
      expect(primaryAdapter.getQuoteCalls).toBe(1); // Tried primary first
      expect(fallbackAdapter.getQuoteCalls).toBe(1); // Used fallback
    });
    
    test('should heal circuit breaker after network recovers', async () => {
      jest.setTimeout(5000); // This test needs a longer timeout
      
      // Create a failing adapter
      const mockAdapter = new MockAdapter({
        shouldFail: true,
        errorType: 'network',
        chainId: 1
      });
      
      // Create registry with circuit breaker
      const registry = new AdapterRegistry({
        maxRetries: 1,
        circuitBreakerThreshold: 2,
        circuitBreakerResetTimeoutMs: 200 // Short timeout for testing
      });
      
      // Register adapter
      registry.adapters.set(1, mockAdapter);
      
      // Make calls to trigger circuit breaker
      try { await registry.getBalance(1, '0x123'); } catch (e) {}
      try { await registry.getBalance(1, '0x123'); } catch (e) {}
      
      // This should fail with circuit breaker
      await expect(
        registry.getBalance(1, '0x123')
      ).rejects.toThrow('Circuit breaker open');
      
      // Fix the mock adapter
      mockAdapter.recover();
      
      // Wait for circuit breaker to go to half-open
      await new Promise(resolve => setTimeout(resolve, 250));
      
      // Should work now that adapter is recovered and circuit is half-open
      const balance = await registry.getBalance(1, '0x123');
      
      expect(balance).toBe('100.0');
      
      // Circuit should be closed after successful operation
      const circuitBreaker = registry.getCircuitBreakerForChain(1);
      expect(circuitBreaker.state).toBe('CLOSED');
    });
  });
}); 