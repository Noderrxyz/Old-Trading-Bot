import { jest } from '@jest/globals';
import { 
  ExecutionSecurityLayer, 
  KeyStorageMode, 
  SigningMechanism 
} from '../src/execution/ExecutionSecurityLayer';
import { StrategyGenome } from '../src/evolution/StrategyGenome';
import { TelemetryBus } from '../src/telemetry/TelemetryBus';
import { CrossChainStrategyRegistry } from '../src/execution/CrossChainStrategyRegistry';

// Mock dependencies
jest.mock('../src/telemetry/TelemetryBus', () => {
  return {
    TelemetryBus: {
      getInstance: jest.fn().mockReturnValue({
        emit: jest.fn(),
        on: jest.fn(),
        off: jest.fn()
      })
    }
  };
});

jest.mock('../src/execution/CrossChainStrategyRegistry', () => {
  return {
    CrossChainStrategyRegistry: {
      getInstance: jest.fn().mockReturnValue({
        registerStrategy: jest.fn(),
        getStrategy: jest.fn().mockReturnValue({
          id: 'test-strategy',
          chain: 'ethereum',
          market: 'ETH/USD'
        })
      })
    }
  };
});

// Helper to create mock strategy genomes
const createMockGenome = (id) => {
  return {
    id,
    parameters: {
      timePeriod: 14,
      threshold: 0.5,
      stopLoss: 0.1
    },
    metrics: {
      sharpeRatio: 1.2,
      volatility: 0.15,
      drawdown: 0.1,
      winRate: 0.65
    },
    createdAt: Date.now(),
    generation: 1,
    parentIds: []
  };
};

describe('ExecutionSecurityLayer', () => {
  let securityLayer;
  let mockGenome;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create instance with test config
    securityLayer = ExecutionSecurityLayer.getInstance({
      allowedChains: ['ethereum', 'solana'],
      maxGasLimits: {
        ethereum: 1000000,
        solana: 100000
      },
      maxTxValueLimits: {
        ethereum: 0.5,
        solana: 50
      },
      rateLimits: {
        maxExecutionsPerWindow: 10,
        windowMs: 60000 // 1 minute
      },
      keyStorageMode: KeyStorageMode.MEMORY,
      signingMechanism: SigningMechanism.LOCAL
    });
    
    mockGenome = createMockGenome('test-strategy');
  });
  
  test('should initialize with default config', () => {
    expect(securityLayer).toBeDefined();
  });
  
  test('should authorize valid execution parameters', async () => {
    const result = await securityLayer.authorizeExecution(
      mockGenome,
      'ethereum',
      'ETH/USD',
      {
        amount: 0.1,
        slippageTolerance: 1.0,
        feeParams: {
          gasLimit: 500000
        }
      }
    );
    
    expect(result.isAuthorized).toBe(true);
    expect(result.authToken).toBeDefined();
    expect(result.expirationTimestamp).toBeGreaterThan(Date.now());
    
    // Should emit telemetry
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'execution_authorization_granted',
      expect.any(Object)
    );
  });
  
  test('should reject execution on non-allowed chain', async () => {
    const result = await securityLayer.authorizeExecution(
      mockGenome,
      'binance',
      'BNB/USD',
      {
        amount: 0.1
      }
    );
    
    expect(result.isAuthorized).toBe(false);
    expect(result.reason).toContain('not allowed');
    
    // Should emit telemetry
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'execution_authorization_rejected',
      expect.any(Object)
    );
  });
  
  test('should reject execution with excessive gas limit', async () => {
    const result = await securityLayer.authorizeExecution(
      mockGenome,
      'ethereum',
      'ETH/USD',
      {
        amount: 0.1,
        feeParams: {
          gasLimit: 2000000 // Over the limit
        }
      }
    );
    
    expect(result.isAuthorized).toBe(false);
    expect(result.reason).toContain('Gas limit');
    
    // Should emit telemetry
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'execution_authorization_rejected',
      expect.any(Object)
    );
  });
  
  test('should reject execution with excessive transaction value', async () => {
    const result = await securityLayer.authorizeExecution(
      mockGenome,
      'ethereum',
      'ETH/USD',
      {
        amount: 0.6, // Over the limit
        feeParams: {
          gasLimit: 500000
        }
      }
    );
    
    expect(result.isAuthorized).toBe(false);
    expect(result.reason).toContain('Transaction value');
    
    // Should emit telemetry
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'execution_authorization_rejected',
      expect.any(Object)
    );
  });
  
  test('should reject execution with excessive slippage', async () => {
    const result = await securityLayer.authorizeExecution(
      mockGenome,
      'ethereum',
      'ETH/USD',
      {
        amount: 0.1,
        slippageTolerance: 10.0, // Over the limit
        feeParams: {
          gasLimit: 500000
        }
      }
    );
    
    expect(result.isAuthorized).toBe(false);
    expect(result.reason).toContain('Slippage');
    
    // Should emit telemetry
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'execution_authorization_rejected',
      expect.any(Object)
    );
  });
  
  test('should enforce rate limits', async () => {
    // Execute multiple requests to exceed rate limit
    const execParams = {
      amount: 0.1,
      feeParams: {
        gasLimit: 500000
      }
    };
    
    // First 10 should be authorized
    for (let i = 0; i < 10; i++) {
      const result = await securityLayer.authorizeExecution(
        mockGenome,
        'ethereum',
        'ETH/USD',
        execParams
      );
      
      expect(result.isAuthorized).toBe(true);
    }
    
    // 11th should be rejected due to rate limit
    const result = await securityLayer.authorizeExecution(
      mockGenome,
      'ethereum',
      'ETH/USD',
      execParams
    );
    
    expect(result.isAuthorized).toBe(false);
    expect(result.reason).toContain('Rate limit');
    
    // Should emit telemetry
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'execution_authorization_rejected',
      expect.any(Object)
    );
  });
  
  test('should track consecutive failures', () => {
    const strategyId = 'test-strategy';
    const chainId = 'ethereum';
    const market = 'ETH/USD';
    
    // Record multiple failures
    securityLayer.recordExecutionResult(strategyId, chainId, market, false, 'Test error');
    securityLayer.recordExecutionResult(strategyId, chainId, market, false, 'Test error');
    
    // Get consecutive failures
    const failures = securityLayer.getConsecutiveFailures(strategyId, chainId, market);
    expect(failures).toBe(2);
    
    // Record a success
    securityLayer.recordExecutionResult(strategyId, chainId, market, true);
    
    // Failures should be reset
    const failuresAfterSuccess = securityLayer.getConsecutiveFailures(strategyId, chainId, market);
    expect(failuresAfterSuccess).toBe(0);
  });
  
  test('should reject executions after too many consecutive failures', async () => {
    const strategyId = 'failing-strategy';
    const chainId = 'ethereum';
    const market = 'ETH/USD';
    const mockFailingGenome = createMockGenome(strategyId);
    
    // Record multiple failures to reach the threshold
    securityLayer.recordExecutionResult(strategyId, chainId, market, false, 'Test error');
    securityLayer.recordExecutionResult(strategyId, chainId, market, false, 'Test error');
    securityLayer.recordExecutionResult(strategyId, chainId, market, false, 'Test error');
    
    // Attempt execution
    const result = await securityLayer.authorizeExecution(
      mockFailingGenome,
      chainId,
      market,
      {
        amount: 0.1,
        feeParams: {
          gasLimit: 500000
        }
      }
    );
    
    expect(result.isAuthorized).toBe(false);
    expect(result.reason).toContain('consecutive failures');
    
    // Should emit telemetry
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'execution_authorization_rejected',
      expect.any(Object)
    );
  });
  
  test('should be able to rotate keys', async () => {
    // Get initial key for ethereum
    const initialKey = securityLayer.getKeyForChain('ethereum');
    expect(initialKey).not.toBeNull();
    
    // Rotate the key
    const rotated = await securityLayer.rotateKeys('ethereum');
    expect(rotated).toBe(true);
    
    // Get the new key
    const newKey = securityLayer.getKeyForChain('ethereum');
    expect(newKey).not.toBeNull();
    
    // Should be a different key
    expect(newKey.keyId).not.toBe(initialKey.keyId);
    
    // Should emit telemetry
    expect(TelemetryBus.getInstance().emit).toHaveBeenCalledWith(
      'key_rotated',
      expect.any(Object)
    );
  });
  
  test('should verify valid auth tokens', () => {
    // First authorize to get a token
    return securityLayer.authorizeExecution(
      mockGenome,
      'ethereum',
      'ETH/USD',
      {
        amount: 0.1,
        feeParams: {
          gasLimit: 500000
        }
      }
    ).then(authResult => {
      expect(authResult.isAuthorized).toBe(true);
      
      // Verify the token
      const isValid = securityLayer.verifyAuthToken(
        mockGenome.id,
        'ethereum',
        'ETH/USD',
        authResult.authToken
      );
      
      expect(isValid).toBe(true);
    });
  });
  
  test('should reject invalid auth tokens', () => {
    // Invalid token format
    const isValidFormat = securityLayer.verifyAuthToken(
      mockGenome.id,
      'ethereum',
      'ETH/USD',
      'invalid-token'
    );
    expect(isValidFormat).toBe(false);
    
    // First authorize to get a valid token
    return securityLayer.authorizeExecution(
      mockGenome,
      'ethereum',
      'ETH/USD',
      {
        amount: 0.1
      }
    ).then(authResult => {
      // Verify with wrong parameters
      const isValidParams = securityLayer.verifyAuthToken(
        mockGenome.id,
        'solana', // Wrong chain
        'ETH/USD',
        authResult.authToken
      );
      
      expect(isValidParams).toBe(false);
    });
  });
}); 