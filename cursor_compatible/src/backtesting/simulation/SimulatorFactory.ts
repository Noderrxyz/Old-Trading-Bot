import { OrderExecutionSimulator, OrderExecutionSimulatorConfig, LatencyProfile } from './OrderExecutionSimulator';

/**
 * Factory for creating simulator instances with predefined configurations
 */
export class SimulatorFactory {
  /**
   * Create a simulator instance with high-frequency trading configuration
   */
  static createHighFrequencySimulator(): OrderExecutionSimulator {
    const config: OrderExecutionSimulatorConfig = {
      latencyModel: {
        profile: LatencyProfile.HIGH_FREQUENCY,
        minLatencyMs: 1,
        maxLatencyMs: 10,
        jitterMs: 2,
        probabilityOfTimeout: 0.001,
        timeoutMs: 1000
      },
      slippageModel: {
        baseSlippagePercent: 0.0001, // 0.01%
        volatilityFactor: 0.1,
        sizeFactor: 0.05,
        maxSlippagePercent: 0.001, // 0.1%
        extremeSlippageProbability: 0.0005,
        extremeSlippageMultiplier: 10
      },
      fillModel: {
        partialFillProbability: 0.1,
        minPartialFillPercent: 0.8,
        maxPartialFills: 2,
        rejectionProbability: 0.001,
        enableTimedFills: true
      },
      orderBookModel: {
        minDepth: 5,
        useSyntheticBook: false,
        syntheticLevels: 10,
        syntheticSpreadPercent: 0.0005
      },
      feeModel: {
        makerFeePercent: 0.0001, // 0.01%
        takerFeePercent: 0.0005, // 0.05%
        feeCurrency: 'quote'
      },
      verbose: false
    };
    
    return new OrderExecutionSimulator(config);
  }
  
  /**
   * Create a simulator instance with retail trading configuration
   */
  static createRetailSimulator(): OrderExecutionSimulator {
    const config: OrderExecutionSimulatorConfig = {
      latencyModel: {
        profile: LatencyProfile.NORMAL,
        minLatencyMs: 50,
        maxLatencyMs: 200,
        jitterMs: 30,
        probabilityOfTimeout: 0.01,
        timeoutMs: 5000
      },
      slippageModel: {
        baseSlippagePercent: 0.001, // 0.1%
        volatilityFactor: 0.5,
        sizeFactor: 0.2,
        maxSlippagePercent: 0.01, // 1%
        extremeSlippageProbability: 0.005,
        extremeSlippageMultiplier: 5
      },
      fillModel: {
        partialFillProbability: 0.2,
        minPartialFillPercent: 0.5,
        maxPartialFills: 3,
        rejectionProbability: 0.01,
        enableTimedFills: true
      },
      orderBookModel: {
        minDepth: 3,
        useSyntheticBook: true,
        syntheticLevels: 5,
        syntheticSpreadPercent: 0.002
      },
      feeModel: {
        makerFeePercent: 0.001, // 0.1%
        takerFeePercent: 0.002, // 0.2%
        feeCurrency: 'quote'
      },
      verbose: false
    };
    
    return new OrderExecutionSimulator(config);
  }
  
  /**
   * Create a simulator instance with institutional trading configuration
   */
  static createInstitutionalSimulator(): OrderExecutionSimulator {
    const config: OrderExecutionSimulatorConfig = {
      latencyModel: {
        profile: LatencyProfile.FAST,
        minLatencyMs: 10,
        maxLatencyMs: 50,
        jitterMs: 10,
        probabilityOfTimeout: 0.005,
        timeoutMs: 2000
      },
      slippageModel: {
        baseSlippagePercent: 0.0005, // 0.05%
        volatilityFactor: 0.3,
        sizeFactor: 0.1,
        maxSlippagePercent: 0.005, // 0.5%
        extremeSlippageProbability: 0.002,
        extremeSlippageMultiplier: 8
      },
      fillModel: {
        partialFillProbability: 0.15,
        minPartialFillPercent: 0.7,
        maxPartialFills: 2,
        rejectionProbability: 0.005,
        enableTimedFills: true
      },
      orderBookModel: {
        minDepth: 10,
        useSyntheticBook: false,
        syntheticLevels: 20,
        syntheticSpreadPercent: 0.001
      },
      feeModel: {
        makerFeePercent: 0.0005, // 0.05%
        takerFeePercent: 0.001, // 0.1%
        feeCurrency: 'quote'
      },
      verbose: false
    };
    
    return new OrderExecutionSimulator(config);
  }
  
  /**
   * Create a simulator instance with poor connectivity configuration
   */
  static createPoorConnectivitySimulator(): OrderExecutionSimulator {
    const config: OrderExecutionSimulatorConfig = {
      latencyModel: {
        profile: LatencyProfile.POOR,
        minLatencyMs: 500,
        maxLatencyMs: 2000,
        jitterMs: 300,
        probabilityOfTimeout: 0.05,
        timeoutMs: 10000
      },
      slippageModel: {
        baseSlippagePercent: 0.002, // 0.2%
        volatilityFactor: 0.8,
        sizeFactor: 0.3,
        maxSlippagePercent: 0.02, // 2%
        extremeSlippageProbability: 0.01,
        extremeSlippageMultiplier: 3
      },
      fillModel: {
        partialFillProbability: 0.3,
        minPartialFillPercent: 0.3,
        maxPartialFills: 4,
        rejectionProbability: 0.05,
        enableTimedFills: true
      },
      orderBookModel: {
        minDepth: 2,
        useSyntheticBook: true,
        syntheticLevels: 3,
        syntheticSpreadPercent: 0.005
      },
      feeModel: {
        makerFeePercent: 0.002, // 0.2%
        takerFeePercent: 0.005, // 0.5%
        feeCurrency: 'quote'
      },
      verbose: false
    };
    
    return new OrderExecutionSimulator(config);
  }
  
  /**
   * Create a deterministic simulator for testing
   */
  static createDeterministicSimulator(seed: number = 42): OrderExecutionSimulator {
    const config: OrderExecutionSimulatorConfig = {
      latencyModel: {
        profile: LatencyProfile.NORMAL,
        minLatencyMs: 50,
        maxLatencyMs: 200,
        jitterMs: 30,
        probabilityOfTimeout: 0.01
      },
      slippageModel: {
        baseSlippagePercent: 0.001,
        volatilityFactor: 0.5,
        sizeFactor: 0.2,
        maxSlippagePercent: 0.01
      },
      fillModel: {
        partialFillProbability: 0.2,
        minPartialFillPercent: 0.5,
        maxPartialFills: 3,
        rejectionProbability: 0.01,
        enableTimedFills: true
      },
      orderBookModel: {
        minDepth: 3,
        useSyntheticBook: true,
        syntheticLevels: 5,
        syntheticSpreadPercent: 0.002
      },
      feeModel: {
        makerFeePercent: 0.001,
        takerFeePercent: 0.002,
        feeCurrency: 'quote'
      },
      // Use deterministic seed for reproducible results
      seed,
      verbose: false
    };
    
    return new OrderExecutionSimulator(config);
  }
  
  /**
   * Create a custom simulator with the provided configuration
   */
  static createCustomSimulator(config: Partial<OrderExecutionSimulatorConfig>): OrderExecutionSimulator {
    // Start with retail configuration as a base
    const baseConfig = this.createRetailSimulator().getConfig();
    
    // Merge with custom config
    const mergedConfig: OrderExecutionSimulatorConfig = {
      ...baseConfig,
      ...config,
      // Merge nested objects if provided
      latencyModel: {
        ...baseConfig.latencyModel,
        ...(config.latencyModel || {})
      },
      slippageModel: {
        ...baseConfig.slippageModel,
        ...(config.slippageModel || {})
      },
      fillModel: {
        ...baseConfig.fillModel,
        ...(config.fillModel || {})
      },
      orderBookModel: {
        ...baseConfig.orderBookModel,
        ...(config.orderBookModel || {})
      },
      feeModel: {
        ...baseConfig.feeModel,
        ...(config.feeModel || {})
      }
    };
    
    return new OrderExecutionSimulator(mergedConfig);
  }
} 