import { logger } from '../../utils/logger';
import { TelemetryBus } from '../../telemetry/TelemetryBus';
import { StrategyGenome } from '../../evolution/StrategyGenome';
import { 
  IExecutionAdapter, 
  ExecutionParams, 
  ExecutionResult, 
  FeeEstimation,
  ChainHealthStatus
} from '../interfaces/IExecutionAdapter';
import * as ethers from 'ethers';
import { ExecutionAdapter } from './ExecutionAdapter';
import { ChainTransactionStatus, ChainTransaction, OrderExecutionResult } from '../../types/execution';
import { ChainConfigRepository, EthereumChainConfig } from '../config/ChainConfig';

/**
 * Configuration for Ethereum adapter
 */
export interface EthereumAdapterConfig {
  /**
   * RPC endpoint URLs (primary and fallbacks)
   */
  rpcUrls: string[];
  
  /**
   * ChainId for this Ethereum network
   */
  chainId: number;
  
  /**
   * Network name
   */
  networkName: string;
  
  /**
   * Default gas price in gwei for slow transactions
   */
  defaultGasPriceSlow: number;
  
  /**
   * Default gas price in gwei for average transactions
   */
  defaultGasPriceAverage: number;
  
  /**
   * Default gas price in gwei for fast transactions
   */
  defaultGasPriceFast: number;
  
  /**
   * Private key or mnemonic for signing transactions
   * Optional: can use a keystore instead
   */
  privateKey?: string;
  
  /**
   * Path to keystore file
   */
  keystorePath?: string;
  
  /**
   * Password for keystore
   */
  keystorePassword?: string;
  
  /**
   * Whether to use Flashbots for transaction sending (reduces MEV)
   */
  useFlashbots: boolean;
  
  /**
   * Flashbots relay URL if useFlashbots is true
   */
  flashbotsRelayUrl?: string;
  
  /**
   * Default gas limit multiplier for safety
   */
  gasLimitMultiplier: number;
  
  /**
   * Maximum wait time for transaction confirmation in ms
   */
  maxConfirmTimeMs: number;
  
  /**
   * Block of confirmations to wait for
   */
  confirmationBlocks: number;
}

/**
 * Ethereum transaction data
 */
interface EthereumTransactionData {
  to: string;
  data: string;
  value?: string;
  gasLimit: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: number;
}

/**
 * Default Ethereum configuration
 */
const DEFAULT_CONFIG: EthereumAdapterConfig = {
  rpcUrls: ['https://ethereum.publicnode.com'],
  chainId: 1,
  networkName: 'mainnet',
  defaultGasPriceSlow: 20,
  defaultGasPriceAverage: 40,
  defaultGasPriceFast: 60,
  useFlashbots: false,
  gasLimitMultiplier: 1.2,
  maxConfirmTimeMs: 120000, // 2 minutes
  confirmationBlocks: 2
};

// Interface for Ethereum log
interface EthereumLog {
  address: string;
  data: string;
  topics: string[];
}

/**
 * Ethereum chain adapter
 */
export class EthereumAdapter implements IExecutionAdapter {
  private config: EthereumAdapterConfig;
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet | null = null;
  private telemetryBus: TelemetryBus;
  private isInitialized: boolean = false;
  private healthCheckTimestamp: number = 0;
  private healthStatus: ChainHealthStatus | null = null;
  private gasPrice: { slow: number, average: number, fast: number };
  
  /**
   * Constructor
   */
  constructor(config: Partial<EthereumAdapterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    
    // Initialize gas prices
    this.gasPrice = {
      slow: this.config.defaultGasPriceSlow,
      average: this.config.defaultGasPriceAverage,
      fast: this.config.defaultGasPriceFast
    };
    
    // Create provider from first RPC URL
    this.provider = new ethers.JsonRpcProvider(this.config.rpcUrls[0]);
    
    logger.info(`EthereumAdapter created for ${this.config.networkName} (Chain ID: ${this.config.chainId})`);
  }
  
  /**
   * Get chain identifier
   */
  public getChainId(): string {
    return `ethereum-${this.config.chainId}`;
  }
  
  /**
   * Initialize the adapter
   */
  public async initialize(config: Record<string, any> = {}): Promise<boolean> {
    try {
      // Override config if provided
      if (Object.keys(config).length > 0) {
        this.config = { ...this.config, ...config };
      }
      
      // Initialize provider
      this.provider = new ethers.JsonRpcProvider(this.config.rpcUrls[0]);
      
      // Check network
      const network = await this.provider.getNetwork();
      const chainId = Number(network.chainId);
      
      if (chainId !== this.config.chainId) {
        logger.error(`Network chain ID ${chainId} does not match configured chain ID ${this.config.chainId}`);
        return false;
      }
      
      // Initialize wallet if private key is provided
      if (this.config.privateKey) {
        this.wallet = new ethers.Wallet(this.config.privateKey, this.provider);
        logger.info(`Wallet initialized with address ${this.wallet.address}`);
      } else if (this.config.keystorePath && this.config.keystorePassword) {
        // In a real implementation, we would read the keystore file and decrypt it
        // For simplicity in this example, we'll just log a message
        logger.info('Keystore-based wallet initialization would happen here');
        this.wallet = null;
      } else {
        logger.warn('No private key or keystore provided. Adapter can only perform read operations.');
        this.wallet = null;
      }
      
      // Update gas prices
      await this.updateGasPrices();
      
      // Check chain health
      await this.getChainHealthStatus();
      
      this.isInitialized = true;
      logger.info(`EthereumAdapter initialized for ${this.config.networkName}`);
      
      // Emit telemetry
      this.telemetryBus.emit('ethereum_adapter_initialized', {
        chainId: this.getChainId(),
        networkName: this.config.networkName,
        timestamp: Date.now()
      });
      
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error initializing EthereumAdapter: ${errorMsg}`, error);
      
      // Emit telemetry
      this.telemetryBus.emit('ethereum_adapter_initialization_failed', {
        chainId: this.getChainId(),
        error: errorMsg,
        timestamp: Date.now()
      });
      
      return false;
    }
  }
  
  /**
   * Execute a strategy on Ethereum
   */
  public async executeStrategy(
    genome: StrategyGenome, 
    market: string, 
    params: ExecutionParams
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    try {
      if (!this.isInitialized) {
        throw new Error('Adapter not initialized. Call initialize() first.');
      }
      
      if (!this.wallet) {
        throw new Error('No wallet configured for transaction signing');
      }
      
      logger.info(`Executing strategy ${genome.id} on ${this.config.networkName} for market ${market}`);
      
      // Emit telemetry for execution start
      this.telemetryBus.emit('ethereum_execution_started', {
        strategyId: genome.id,
        market,
        chainId: this.getChainId(),
        timestamp: startTime
      });
      
      // Build transaction data from genome and params
      const txData = await this.buildTransactionData(genome, market, params);
      
      // Send transaction
      const tx = await this.sendTransaction(txData, params);
      
      // Wait for confirmation
      const receipt = await this.waitForTransaction(tx.hash, params.timeoutMs);
      
      // Calculate actual fees
      const feeCost = Number(receipt.gasUsed) * Number(receipt.gasPrice) / 1e18;
      
      // Calculate execution time
      const executionTimeMs = Date.now() - startTime;
      
      // Create result
      const result: ExecutionResult = {
        success: receipt.status === 1, // 1 = success
        transactionId: receipt.hash,
        timestamp: Date.now(),
        executionTimeMs,
        feeCost,
        actualSlippage: 0, // We would calculate this from event logs in a real implementation
        blockHeight: Number(receipt.blockNumber),
        chainData: {
          gasUsed: receipt.gasUsed.toString(),
          gasPrice: receipt.gasPrice?.toString() || '0',
          blockHash: receipt.blockHash,
          contractAddress: receipt.contractAddress || null,
          logs: receipt.logs.map((log: EthereumLog) => ({
            address: log.address,
            data: log.data,
            topics: log.topics
          }))
        }
      };
      
      // Emit telemetry for execution completion
      this.telemetryBus.emit('ethereum_execution_completed', {
        strategyId: genome.id,
        market,
        chainId: this.getChainId(),
        transactionId: tx.hash,
        blockHeight: result.blockHeight,
        executionTimeMs,
        feeCost,
        success: true,
        timestamp: Date.now()
      });
      
      logger.info(`Strategy ${genome.id} executed successfully on ${this.config.networkName}: ${tx.hash}`);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error executing strategy ${genome.id} on ${this.config.networkName}: ${errorMsg}`, error);
      
      // Emit telemetry for execution failure
      this.telemetryBus.emit('ethereum_execution_failed', {
        strategyId: genome.id,
        market,
        chainId: this.getChainId(),
        error: errorMsg,
        executionTimeMs: Date.now() - startTime,
        timestamp: Date.now()
      });
      
      return {
        success: false,
        error: errorMsg,
        timestamp: Date.now(),
        executionTimeMs: Date.now() - startTime,
        feeCost: 0 // No fees if transaction failed before submission
      };
    }
  }
  
  /**
   * Estimate fees for an execution
   */
  public async estimateFees(
    genome: StrategyGenome,
    market: string,
    params: ExecutionParams
  ): Promise<FeeEstimation> {
    try {
      if (!this.isInitialized) {
        throw new Error('Adapter not initialized. Call initialize() first.');
      }
      
      // Build transaction data
      const txData = await this.buildTransactionData(genome, market, params);
      
      // Estimate gas
      const gasEstimate = await this.provider.estimateGas({
        to: txData.to,
        data: txData.data,
        value: txData.value ? ethers.parseEther(txData.value) : undefined
      });
      
      // Get current gas prices
      await this.updateGasPrices();
      
      // Calculate fee estimates for different speeds
      const slow = Number(gasEstimate) * this.gasPrice.slow * 1e-9;
      const average = Number(gasEstimate) * this.gasPrice.average * 1e-9;
      const fast = Number(gasEstimate) * this.gasPrice.fast * 1e-9;
      
      // Get network congestion estimate
      const { networkCongestion } = await this.getNetworkCongestion();
      
      // Estimate confirmation times based on gas prices and congestion
      const avgBlockTime = 12; // seconds for Ethereum
      const estimatedBlocks = {
        slow: Math.max(1, Math.ceil(3 * (1 + networkCongestion))),
        average: Math.max(1, Math.ceil(2 * (1 + networkCongestion))),
        fast: 1
      };
      
      const result: FeeEstimation = {
        estimatedFee: average, // Use average as default
        networkCongestion,
        recommendedFees: {
          slow,
          average,
          fast
        },
        estimatedTimeToConfirmation: {
          slow: estimatedBlocks.slow * avgBlockTime * 1000, // Convert to ms
          average: estimatedBlocks.average * avgBlockTime * 1000,
          fast: estimatedBlocks.fast * avgBlockTime * 1000
        },
        chainSpecific: {
          gasEstimate: gasEstimate.toString(),
          maxFeePerGas: ethers.formatUnits(this.gasPrice.fast * 1e9, 'gwei'),
          maxPriorityFeePerGas: ethers.formatUnits(Math.min(this.gasPrice.fast, 3) * 1e9, 'gwei'),
          eip1559Support: true,
          currentBaseFee: '0' // Would get this from the latest block in real implementation
        }
      };
      
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error estimating fees for ${genome.id} on ${this.config.networkName}: ${errorMsg}`, error);
      
      // Return default values in case of error
      return {
        estimatedFee: this.gasPrice.average * 21000 * 1e-9, // Simple transfer gas limit
        networkCongestion: 0.5, // Assume moderate congestion
        recommendedFees: {
          slow: this.gasPrice.slow * 21000 * 1e-9,
          average: this.gasPrice.average * 21000 * 1e-9,
          fast: this.gasPrice.fast * 21000 * 1e-9
        },
        estimatedTimeToConfirmation: {
          slow: 60000, // 1 minute
          average: 30000, // 30 seconds
          fast: 15000 // 15 seconds
        }
      };
    }
  }
  
  /**
   * Check status of a transaction
   */
  public async checkTransactionStatus(transactionId: string): Promise<ExecutionResult> {
    try {
      if (!this.isInitialized) {
        throw new Error('Adapter not initialized. Call initialize() first.');
      }
      
      // Get transaction receipt
      const receipt = await this.provider.getTransactionReceipt(transactionId);
      
      if (!receipt) {
        return {
          success: false,
          transactionId,
          error: 'Transaction not found or still pending',
          timestamp: Date.now(),
          executionTimeMs: 0,
          feeCost: 0
        };
      }
      
      // Calculate fee cost
      const feeCost = Number(receipt.gasUsed) * Number(receipt.gasPrice) / 1e18;
      
      return {
        success: receipt.status === 1, // 1 = success
        transactionId: receipt.hash,
        timestamp: Date.now(),
        executionTimeMs: 0, // Not tracked for status checks
        feeCost,
        blockHeight: Number(receipt.blockNumber),
        chainData: {
          gasUsed: receipt.gasUsed.toString(),
          gasPrice: receipt.gasPrice?.toString() || '0',
          blockHash: receipt.blockHash,
          contractAddress: receipt.contractAddress || null,
          logs: receipt.logs.map((log: EthereumLog) => ({
            address: log.address,
            data: log.data,
            topics: log.topics
          }))
        }
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error checking transaction status ${transactionId} on ${this.config.networkName}: ${errorMsg}`, error);
      
      return {
        success: false,
        transactionId,
        error: errorMsg,
        timestamp: Date.now(),
        executionTimeMs: 0,
        feeCost: 0
      };
    }
  }
  
  /**
   * Get chain health status
   */
  public async getChainHealthStatus(): Promise<ChainHealthStatus> {
    try {
      // Check if we have a recent health check (within 30 seconds)
      if (this.healthStatus && Date.now() - this.healthCheckTimestamp < 30000) {
        return this.healthStatus;
      }
      
      const startTime = Date.now();
      
      // Get latest block
      const latestBlock = await this.provider.getBlock('latest');
      
      if (!latestBlock) {
        throw new Error('Could not fetch latest block');
      }
      
      // Get block N-100 to calculate average block time
      const oldBlock = await this.provider.getBlock(Number(latestBlock.number) - 100);
      
      let averageBlockTimeMs = 12000; // 12 seconds default
      
      if (oldBlock) {
        const timeDiff = (Number(latestBlock.timestamp) - Number(oldBlock.timestamp)) * 1000; // Convert to ms
        const blockDiff = Number(latestBlock.number) - Number(oldBlock.number);
        averageBlockTimeMs = timeDiff / blockDiff;
      }
      
      // Get network congestion
      const { networkCongestion, currentTps } = await this.getNetworkCongestion();
      
      // Response time
      const rpcResponseTimeMs = Date.now() - startTime;
      
      // Create health status
      this.healthStatus = {
        isOperational: true,
        currentBlockHeight: Number(latestBlock.number),
        latestBlockTimestamp: Number(latestBlock.timestamp) * 1000, // Convert to ms
        averageBlockTimeMs,
        networkCongestion,
        currentTps,
        rpcResponseTimeMs,
        isConfigured: this.isInitialized && this.wallet !== null,
        chainSpecific: {
          networkName: this.config.networkName,
          gasPrice: {
            slow: this.gasPrice.slow,
            average: this.gasPrice.average,
            fast: this.gasPrice.fast
          },
          pendingTransactions: 0, // Would get from mempool in real implementation
          peerCount: 0 // Would get from RPC in real implementation
        }
      };
      
      this.healthCheckTimestamp = Date.now();
      
      // Emit telemetry
      this.telemetryBus.emit('ethereum_health_check', {
        chainId: this.getChainId(),
        blockHeight: this.healthStatus.currentBlockHeight,
        averageBlockTimeMs: this.healthStatus.averageBlockTimeMs,
        networkCongestion: this.healthStatus.networkCongestion,
        rpcResponseTimeMs: this.healthStatus.rpcResponseTimeMs,
        timestamp: Date.now()
      });
      
      return this.healthStatus;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error getting chain health status for ${this.config.networkName}: ${errorMsg}`, error);
      
      // Create a degraded health status
      const degradedStatus: ChainHealthStatus = {
        isOperational: false,
        currentBlockHeight: 0,
        latestBlockTimestamp: 0,
        averageBlockTimeMs: 0,
        networkCongestion: 1, // Maximum congestion
        currentTps: 0,
        rpcResponseTimeMs: 0,
        isConfigured: this.isInitialized && this.wallet !== null,
        chainSpecific: {
          networkName: this.config.networkName,
          error: errorMsg
        }
      };
      
      // Emit telemetry
      this.telemetryBus.emit('ethereum_health_check_failed', {
        chainId: this.getChainId(),
        error: errorMsg,
        timestamp: Date.now()
      });
      
      return degradedStatus;
    }
  }
  
  /**
   * Validate if a strategy can be executed by this adapter
   */
  public async validateStrategy(genome: StrategyGenome): Promise<{
    isValid: boolean;
    errors?: string[];
  }> {
    try {
      // Basic validation
      if (!genome || !genome.id) {
        return {
          isValid: false,
          errors: ['Invalid strategy genome']
        };
      }
      
      // In a real implementation, we would check the bytecode, gas requirements, etc.
      // For this example, we'll do some basic checks
      
      // Check if the genome is compatible with Ethereum
      const isCompatible = true; // Placeholder for real validation logic
      
      if (!isCompatible) {
        return {
          isValid: false,
          errors: ['Strategy is not compatible with Ethereum']
        };
      }
      
      // Success
      return {
        isValid: true
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error validating strategy ${genome.id} for ${this.config.networkName}: ${errorMsg}`, error);
      
      return {
        isValid: false,
        errors: [errorMsg]
      };
    }
  }
  
  /**
   * Private: Build transaction data from genome and params
   */
  private async buildTransactionData(
    genome: StrategyGenome,
    market: string,
    params: ExecutionParams
  ): Promise<EthereumTransactionData> {
    // In a real implementation, this would build the transaction data based on the strategy
    // For this example, we'll create a simple token transfer transaction
    
    // Example: Transfer tokens (simulating strategy execution)
    const recipientAddress = '0x1234567890123456789012345678901234567890'; // Example address
    const tokenAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'; // Example token address
    
    // ERC20 transfer function signature
    const transferFnSignature = '0xa9059cbb';
    
    // Encode recipient address (pad to 32 bytes)
    const encodedRecipient = recipientAddress.slice(2).padStart(64, '0');
    
    // Encode amount (example: 1.0 tokens with 18 decimals = 1000000000000000000)
    const amount = ethers.parseEther(params.amount.toString());
    const encodedAmount = amount.toString(16).padStart(64, '0');
    
    // Combine to create data
    const data = `${transferFnSignature}${encodedRecipient}${encodedAmount}`;
    
    // Create transaction data
    const txData: EthereumTransactionData = {
      to: tokenAddress,
      data,
      gasLimit: '200000', // Example gas limit
      value: '0' // No ETH value for token transfers
    };
    
    // Add gas price based on slippage tolerance (higher slippage = can use faster gas)
    if (params.slippageTolerance > 3) {
      // High slippage tolerance, use fast gas
      txData.gasPrice = ethers.formatUnits(this.gasPrice.fast * 1e9, 'wei');
    } else if (params.slippageTolerance > 1) {
      // Medium slippage tolerance, use average gas
      txData.gasPrice = ethers.formatUnits(this.gasPrice.average * 1e9, 'wei');
    } else {
      // Low slippage tolerance, use slow gas
      txData.gasPrice = ethers.formatUnits(this.gasPrice.slow * 1e9, 'wei');
    }
    
    return txData;
  }
  
  /**
   * Private: Send a transaction
   */
  private async sendTransaction(
    txData: EthereumTransactionData,
    params: ExecutionParams
  ): Promise<ethers.TransactionResponse> {
    if (!this.wallet) {
      throw new Error('No wallet configured for transaction signing');
    }
    
    // Get current nonce
    const nonce = await this.provider.getTransactionCount(this.wallet.address);
    
    // Prepare transaction request
    const txRequest: ethers.TransactionRequest = {
      to: txData.to,
      data: txData.data,
      value: txData.value ? ethers.parseEther(txData.value) : undefined,
      gasLimit: ethers.parseUnits(txData.gasLimit, 'wei'),
      nonce
    };
    
    // Add gas price or EIP-1559 fees
    if (params.feeParams?.useEIP1559) {
      // Use EIP-1559 fields
      txRequest.maxFeePerGas = txData.maxFeePerGas ? 
        ethers.parseUnits(txData.maxFeePerGas, 'wei') : 
        ethers.parseUnits((this.gasPrice.average * 2).toString(), 'gwei');
      
      txRequest.maxPriorityFeePerGas = txData.maxPriorityFeePerGas ? 
        ethers.parseUnits(txData.maxPriorityFeePerGas, 'wei') : 
        ethers.parseUnits(Math.min(this.gasPrice.average, 3).toString(), 'gwei');
    } else {
      // Use legacy gas price
      txRequest.gasPrice = txData.gasPrice ? 
        ethers.parseUnits(txData.gasPrice, 'wei') : 
        ethers.parseUnits(this.gasPrice.average.toString(), 'gwei');
    }
    
    // Send transaction
    let tx: ethers.TransactionResponse;
    
    if (this.config.useFlashbots && this.config.flashbotsRelayUrl) {
      // In a real implementation, we would use the Flashbots bundle provider
      // For this example, we'll just log a message and use regular sending
      logger.info('Would use Flashbots for MEV protection in a real implementation');
      tx = await this.wallet.sendTransaction(txRequest);
    } else {
      // Regular transaction sending
      tx = await this.wallet.sendTransaction(txRequest);
    }
    
    logger.info(`Transaction sent: ${tx.hash}`);
    return tx;
  }
  
  /**
   * Private: Wait for transaction confirmation
   */
  private async waitForTransaction(
    txHash: string,
    timeoutMs: number
  ): Promise<ethers.TransactionReceipt> {
    // Calculate timeout
    const startTime = Date.now();
    const maxEndTime = startTime + (timeoutMs || this.config.maxConfirmTimeMs);
    
    while (Date.now() < maxEndTime) {
      const receipt = await this.provider.getTransactionReceipt(txHash);
      
      if (receipt) {
        // Wait for confirmations
        if (receipt.confirmations >= this.config.confirmationBlocks) {
          return receipt;
        }
      }
      
      // Sleep for 2 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    throw new Error(`Transaction ${txHash} was not confirmed within the timeout period`);
  }
  
  /**
   * Private: Update gas prices
   */
  private async updateGasPrices(): Promise<void> {
    try {
      // In a real implementation, we would get this from a gas price oracle or the RPC
      // For this example, we'll use default values with a small random variation
      
      const variation = 0.8 + (Math.random() * 0.4); // 0.8 to 1.2
      
      this.gasPrice = {
        slow: Math.round(this.config.defaultGasPriceSlow * variation),
        average: Math.round(this.config.defaultGasPriceAverage * variation),
        fast: Math.round(this.config.defaultGasPriceFast * variation)
      };
      
      logger.debug(`Updated gas prices for ${this.config.networkName}: slow=${this.gasPrice.slow}, average=${this.gasPrice.average}, fast=${this.gasPrice.fast}`);
    } catch (error) {
      logger.error(`Error updating gas prices: ${error instanceof Error ? error.message : String(error)}`);
      // Keep existing prices if update fails
    }
  }
  
  /**
   * Private: Get network congestion estimate
   */
  private async getNetworkCongestion(): Promise<{ networkCongestion: number, currentTps: number }> {
    try {
      // In a real implementation, this would be calculated from the mempool and recent blocks
      // For this example, we'll return a random value
      const congestion = Math.random() * 0.7; // 0 to 0.7
      const tps = 10 + Math.random() * 20; // 10 to 30
      
      return {
        networkCongestion: congestion,
        currentTps: tps
      };
    } catch (error) {
      logger.error(`Error getting network congestion: ${error instanceof Error ? error.message : String(error)}`);
      return {
        networkCongestion: 0.5, // Default to medium congestion
        currentTps: 15 // Default TPS
      };
    }
  }
} 