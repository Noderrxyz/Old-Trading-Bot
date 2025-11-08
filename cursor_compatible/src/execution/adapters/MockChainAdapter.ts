import { BaseChainAdapter, BaseChainAdapterConfig } from './BaseChainAdapter';
import { StrategyGenome } from '../../evolution/StrategyGenome';
import { ExecutionParams, ExecutionResult, FeeEstimation, ChainHealthStatus } from '../interfaces/IExecutionAdapter';
import { logger } from '../../utils/logger';

/**
 * Mock chain adapter configuration
 */
export interface MockChainAdapterConfig extends BaseChainAdapterConfig {
  chainId: string;
  mockSuccessRate: number; // 0-1 success rate for testing
  mockLatency: number; // Mock latency in ms
}

/**
 * Mock chain adapter for testing purposes
 * This provides a concrete implementation of BaseChainAdapter for development and testing
 */
export class MockChainAdapter extends BaseChainAdapter<MockChainAdapterConfig> {
  private mockTransactionCounter = 0;

  constructor(config: MockChainAdapterConfig) {
    const defaultConfig: MockChainAdapterConfig = {
      rpcUrls: ['http://mock-rpc'],
      networkName: 'Mock Network',
      maxConfirmTimeMs: 30000,
      emitDetailedTelemetry: true,
      rpcRetries: 3,
      chainId: 'mock',
      mockSuccessRate: 0.9,
      mockLatency: 1000
    };
    
    super({ ...defaultConfig, ...config });
  }

  public getChainId(): string {
    return this.config.chainId;
  }

  protected async initializeAdapter(): Promise<boolean> {
    logger.info(`Initializing mock adapter for chain ${this.config.chainId}`);
    
    // Simulate initialization delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return true;
  }

  protected async executeStrategyInternal(
    genome: StrategyGenome,
    market: string,
    params: ExecutionParams
  ): Promise<ExecutionResult> {
    logger.info(`Mock executing strategy ${genome.id} on ${market}`);
    
    // Simulate execution time
    await new Promise(resolve => setTimeout(resolve, this.config.mockLatency));
    
    const isSuccess = Math.random() < this.config.mockSuccessRate;
    this.mockTransactionCounter++;
    
    if (isSuccess) {
      return {
        success: true,
        transactionId: `mock-tx-${this.config.chainId}-${this.mockTransactionCounter}`,
        timestamp: Date.now(),
        executionTimeMs: this.config.mockLatency,
        feeCost: 0.01 * params.amount,
        actualSlippage: Math.random() * 0.5, // 0-0.5% slippage
        blockHeight: 1000000 + this.mockTransactionCounter,
        chainData: {
          mockExecution: true,
          chainId: this.config.chainId,
          market
        }
      };
    } else {
      return {
        success: false,
        error: `Mock execution failed for ${genome.id}`,
        timestamp: Date.now(),
        executionTimeMs: this.config.mockLatency,
        feeCost: 0
      };
    }
  }

  protected async estimateFeesInternal(
    genome: StrategyGenome,
    market: string,
    params: ExecutionParams
  ): Promise<FeeEstimation> {
    // Mock fee estimation based on chain type
    let baseFee = 0.001;
    if (this.config.chainId === 'ethereum') baseFee = 0.01;
    else if (this.config.chainId === 'solana') baseFee = 0.0001;
    else if (this.config.chainId === 'polygon') baseFee = 0.001;
    
    const mockCongestion = Math.random() * 0.8; // 0-80% congestion
    const feeMultiplier = 1 + mockCongestion;
    
    return {
      estimatedFee: baseFee * params.amount * feeMultiplier,
      networkCongestion: mockCongestion,
      recommendedFees: {
        slow: baseFee * params.amount,
        average: baseFee * params.amount * 1.5,
        fast: baseFee * params.amount * 2.0
      },
      estimatedTimeToConfirmation: {
        slow: 30000,
        average: 15000,
        fast: 5000
      },
      chainSpecific: {
        mockEstimation: true,
        chainId: this.config.chainId
      }
    };
  }

  protected async checkTransactionStatusInternal(transactionId: string): Promise<ExecutionResult> {
    logger.info(`Checking mock transaction status: ${transactionId}`);
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Mock successful confirmation
    return {
      success: true,
      transactionId,
      timestamp: Date.now(),
      executionTimeMs: 0,
      feeCost: 0.001,
      blockHeight: 1000000 + Math.floor(Math.random() * 1000),
      chainData: {
        confirmed: true,
        confirmations: 6
      }
    };
  }

  protected async getChainHealthStatusInternal(): Promise<ChainHealthStatus> {
    const mockCongestion = Math.random() * 0.6; // 0-60% congestion
    const mockLatency = 50 + Math.random() * 200; // 50-250ms latency
    
    return {
      isOperational: true,
      currentBlockHeight: 1000000 + Math.floor(Date.now() / 1000),
      latestBlockTimestamp: Date.now() - 1000, // 1 second ago
      averageBlockTimeMs: this.config.chainId === 'ethereum' ? 12000 : 
                         this.config.chainId === 'solana' ? 400 : 2000,
      networkCongestion: mockCongestion,
      currentTps: this.config.chainId === 'solana' ? 2000 : 
                  this.config.chainId === 'ethereum' ? 15 : 100,
      rpcResponseTimeMs: mockLatency,
      isConfigured: true,
      chainSpecific: {
        mockHealth: true,
        chainId: this.config.chainId,
        uptime: 99.9
      }
    };
  }

  protected async validateStrategyInternal(genome: StrategyGenome): Promise<{
    isValid: boolean;
    errors?: string[];
  }> {
    // Basic mock validation
    if (!genome.id || genome.id.length === 0) {
      return {
        isValid: false,
        errors: ['Strategy genome must have a valid ID']
      };
    }
    
    // Mock chain-specific validation
    if (this.config.chainId === 'bitcoin' && genome.id.includes('defi')) {
      return {
        isValid: false,
        errors: ['DeFi strategies not supported on Bitcoin']
      };
    }
    
    return {
      isValid: true
    };
  }

  protected getDefaultFeeEstimation(): FeeEstimation {
    return {
      estimatedFee: 0.001,
      networkCongestion: 0.5,
      recommendedFees: {
        slow: 0.0005,
        average: 0.001,
        fast: 0.002
      },
      estimatedTimeToConfirmation: {
        slow: 60000,
        average: 30000,
        fast: 10000
      }
    };
  }

  protected getTelemetryPrefix(): string {
    return `mock_${this.config.chainId}`;
  }

  protected async getMarketDataInternal(symbol: string): Promise<any> {
    // Mock market data
    return {
      symbol,
      price: 50000 + Math.random() * 10000, // Mock price between 50k-60k
      volume24h: Math.random() * 1000000,
      timestamp: Date.now(),
      source: 'mock',
      chainId: this.config.chainId
    };
  }

  protected async monitorCongestion(): Promise<void> {
    // Mock congestion monitoring
    logger.debug(`Monitoring congestion for mock chain ${this.config.chainId}`);
    // In real implementation, this would collect actual network metrics
  }

  protected async collectBridgeMetrics(): Promise<void> {
    // Mock bridge metrics collection
    logger.debug(`Collecting bridge metrics for mock chain ${this.config.chainId}`);
    // In real implementation, this would collect actual bridge performance data
  }

  protected async shutdownAdapterInternal(): Promise<void> {
    logger.info(`Shutting down mock adapter for chain ${this.config.chainId}`);
    // Mock cleanup - in real implementation, this would close connections, etc.
  }
} 