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
import * as web3 from '@solana/web3.js';
import * as bs58 from 'bs58';

/**
 * Configuration for Solana adapter
 */
export interface SolanaAdapterConfig {
  /**
   * RPC endpoint URLs (primary and fallbacks)
   */
  rpcUrls: string[];
  
  /**
   * Solana network (mainnet-beta, testnet, devnet)
   */
  network: 'mainnet-beta' | 'testnet' | 'devnet';
  
  /**
   * Private key for signing transactions (base58 encoded)
   */
  privateKey?: string;
  
  /**
   * Path to keypair file
   */
  keypairPath?: string;
  
  /**
   * Default commitment level
   */
  commitment: web3.Commitment;
  
  /**
   * Maximum retries for transaction confirmation
   */
  maxRetries: number;
  
  /**
   * Maximum compute units per transaction
   */
  maxComputeUnits: number;
  
  /**
   * Maximum retries for RPC failures
   */
  rpcRetries: number;
  
  /**
   * Default priority fee in micro-lamports
   */
  priorityFee: number;
  
  /**
   * Maximum wait time for transaction confirmation in ms
   */
  maxConfirmTimeMs: number;
  
  /**
   * Whether to use durable nonces for transactions
   */
  useDurableNonce: boolean;
  
  /**
   * Whether to skip preflight checks
   */
  skipPreflight: boolean;
}

/**
 * Default Solana configuration
 */
const DEFAULT_CONFIG: SolanaAdapterConfig = {
  rpcUrls: ['https://api.mainnet-beta.solana.com'],
  network: 'mainnet-beta',
  commitment: 'confirmed',
  maxRetries: 3,
  maxComputeUnits: 200000,
  rpcRetries: 3,
  priorityFee: 1000, // 1000 micro-lamports
  maxConfirmTimeMs: 60000, // 1 minute
  useDurableNonce: false,
  skipPreflight: false
};

/**
 * Solana chain adapter
 */
export class SolanaAdapter implements IExecutionAdapter {
  private config: SolanaAdapterConfig;
  private connection: web3.Connection;
  private payer: web3.Keypair | null = null;
  private telemetryBus: TelemetryBus;
  private isInitialized: boolean = false;
  private healthCheckTimestamp: number = 0;
  private healthStatus: ChainHealthStatus | null = null;
  private fallbackConnections: web3.Connection[] = [];
  private activeConnectionIndex: number = 0;
  
  /**
   * Constructor
   */
  constructor(config: Partial<SolanaAdapterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    
    // Create connection from first RPC URL
    this.connection = new web3.Connection(
      this.config.rpcUrls[0],
      this.config.commitment
    );
    
    // Create fallback connections if available
    for (let i = 1; i < this.config.rpcUrls.length; i++) {
      this.fallbackConnections.push(
        new web3.Connection(
          this.config.rpcUrls[i],
          this.config.commitment
        )
      );
    }
    
    logger.info(`SolanaAdapter created for ${this.config.network}`);
  }
  
  /**
   * Get chain identifier
   */
  public getChainId(): string {
    return `solana-${this.config.network}`;
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
      
      // Initialize connection
      this.connection = new web3.Connection(
        this.config.rpcUrls[0],
        this.config.commitment
      );
      
      // Initialize keypair if private key is provided
      if (this.config.privateKey) {
        const privateKeyBytes = bs58.decode(this.config.privateKey);
        this.payer = web3.Keypair.fromSecretKey(privateKeyBytes);
        logger.info(`Wallet initialized with address ${this.payer.publicKey.toBase58()}`);
      } else if (this.config.keypairPath) {
        // In a real implementation, we would read the keypair file
        // For simplicity in this example, we'll just log a message
        logger.info('Keypair file-based wallet initialization would happen here');
        this.payer = null;
      } else {
        logger.warn('No private key or keypair file provided. Adapter can only perform read operations.');
        this.payer = null;
      }
      
      // Check connection
      const version = await this.connection.getVersion();
      logger.info(`Connected to Solana ${this.config.network}, version: ${version["solana-core"]}`);
      
      // Check chain health
      await this.getChainHealthStatus();
      
      this.isInitialized = true;
      
      // Emit telemetry
      this.telemetryBus.emit('solana_adapter_initialized', {
        chainId: this.getChainId(),
        network: this.config.network,
        timestamp: Date.now()
      });
      
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error initializing SolanaAdapter: ${errorMsg}`, error);
      
      // Emit telemetry
      this.telemetryBus.emit('solana_adapter_initialization_failed', {
        chainId: this.getChainId(),
        error: errorMsg,
        timestamp: Date.now()
      });
      
      return false;
    }
  }
  
  /**
   * Execute a strategy on Solana
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
      
      if (!this.payer) {
        throw new Error('No keypair configured for transaction signing');
      }
      
      logger.info(`Executing strategy ${genome.id} on ${this.config.network} for market ${market}`);
      
      // Emit telemetry for execution start
      this.telemetryBus.emit('solana_execution_started', {
        strategyId: genome.id,
        market,
        chainId: this.getChainId(),
        timestamp: startTime
      });
      
      // Build transaction instructions from genome and params
      const { instructions, signers } = await this.buildInstructions(genome, market, params);
      
      // Get recent blockhash
      const { blockhash, lastValidBlockHeight } = await this.getCurrentBlockhash();
      
      // Create transaction
      const transaction = new web3.Transaction({
        feePayer: this.payer.publicKey,
        blockhash,
        lastValidBlockHeight
      });
      
      // Add instructions to transaction
      transaction.add(...instructions);
      
      // Set compute units limit if needed
      if (this.config.maxComputeUnits > 0) {
        transaction.add(
          web3.ComputeBudgetProgram.setComputeUnitLimit({
            units: this.config.maxComputeUnits
          })
        );
      }
      
      // Add priority fee if configured
      if (this.config.priorityFee > 0) {
        transaction.add(
          web3.ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: this.config.priorityFee
          })
        );
      }
      
      // Sign transaction with all signers
      const allSigners = [this.payer, ...signers];
      transaction.sign(...allSigners);
      
      // Serialize transaction
      const serializedTx = transaction.serialize({
        requireAllSignatures: true,
        verifySignatures: true
      });
      
      // Get fee estimate
      const fee = await this.connection.getFeeForMessage(
        web3.Message.from(serializedTx)
      );
      
      // Send transaction
      const signature = await this.sendTransaction(serializedTx);
      
      // Wait for confirmation
      const confirmation = await this.confirmTransaction(
        signature,
        params.timeoutMs || this.config.maxConfirmTimeMs
      );
      
      if (!confirmation) {
        throw new Error(`Transaction ${signature} failed to confirm within timeout`);
      }
      
      // Get transaction details
      const txDetails = await this.connection.getTransaction(signature, {
        commitment: this.config.commitment,
        maxSupportedTransactionVersion: 0
      });
      
      // Calculate execution time
      const executionTimeMs = Date.now() - startTime;
      
      // Create result
      const result: ExecutionResult = {
        success: true,
        transactionId: signature,
        timestamp: Date.now(),
        executionTimeMs,
        feeCost: (fee?.value || 0) / web3.LAMPORTS_PER_SOL,
        actualSlippage: 0, // Would calculate from event logs in a real implementation
        blockHeight: txDetails?.slot || 0,
        chainData: {
          slot: txDetails?.slot || 0,
          computeUnitsConsumed: txDetails?.meta?.computeUnitsConsumed || 0,
          logMessages: txDetails?.meta?.logMessages || [],
          fee: txDetails?.meta?.fee || 0
        }
      };
      
      // Emit telemetry for execution completion
      this.telemetryBus.emit('solana_execution_completed', {
        strategyId: genome.id,
        market,
        chainId: this.getChainId(),
        transactionId: signature,
        blockHeight: result.blockHeight,
        executionTimeMs,
        feeCost: result.feeCost,
        success: true,
        timestamp: Date.now()
      });
      
      logger.info(`Strategy ${genome.id} executed successfully on ${this.config.network}: ${signature}`);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error executing strategy ${genome.id} on ${this.config.network}: ${errorMsg}`, error);
      
      // Emit telemetry for execution failure
      this.telemetryBus.emit('solana_execution_failed', {
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
      
      // Build instructions from the genome
      const { instructions } = await this.buildInstructions(genome, market, params);
      
      // Get recent blockhash
      const { blockhash } = await this.getCurrentBlockhash();
      
      // Create a transaction with the instructions
      const transaction = new web3.Transaction({
        feePayer: this.payer?.publicKey || web3.Keypair.generate().publicKey,
        blockhash
      });
      
      // Add instructions
      transaction.add(...instructions);
      
      // Add compute budget instructions
      if (this.config.maxComputeUnits > 0) {
        transaction.add(
          web3.ComputeBudgetProgram.setComputeUnitLimit({
            units: this.config.maxComputeUnits
          })
        );
      }
      
      // Serialize transaction
      const serializedTx = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false
      });
      
      // Get fee estimate
      const fee = await this.connection.getFeeForMessage(
        web3.Message.from(serializedTx)
      );
      
      // Get network health to estimate congestion
      const { networkCongestion } = await this.getNetworkCongestion();
      
      // Calculate fees with different priority levels
      const baseFee = fee?.value || 5000; // Default 5000 lamports if estimate fails
      
      // Calculate fee estimates for different speeds (using priority fees)
      const slow = baseFee / web3.LAMPORTS_PER_SOL;
      const average = (baseFee + 10000 * networkCongestion) / web3.LAMPORTS_PER_SOL;
      const fast = (baseFee + 50000 * networkCongestion) / web3.LAMPORTS_PER_SOL;
      
      // Estimate confirmation times based on priority fees and congestion
      const avgBlockTime = 0.4; // seconds for Solana
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
          baseFee,
          priorityFee: this.config.priorityFee,
          computeUnits: this.config.maxComputeUnits,
          instructionCount: instructions.length
        }
      };
      
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error estimating fees for ${genome.id} on ${this.config.network}: ${errorMsg}`, error);
      
      // Return default values in case of error
      return {
        estimatedFee: 0.000005, // Default 5000 lamports
        networkCongestion: 0.5, // Assume moderate congestion
        recommendedFees: {
          slow: 0.000005,
          average: 0.00001,
          fast: 0.00002
        },
        estimatedTimeToConfirmation: {
          slow: 2000, // 2 seconds
          average: 1000, // 1 second
          fast: 600 // 600 ms
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
      
      // Get transaction details
      const txDetails = await this.connection.getTransaction(transactionId, {
        commitment: this.config.commitment,
        maxSupportedTransactionVersion: 0
      });
      
      if (!txDetails) {
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
      const feeCost = (txDetails.meta?.fee || 0) / web3.LAMPORTS_PER_SOL;
      
      return {
        success: txDetails.meta?.err === null,
        transactionId,
        timestamp: Date.now(),
        executionTimeMs: 0, // Not tracked for status checks
        feeCost,
        blockHeight: txDetails.slot,
        chainData: {
          slot: txDetails.slot,
          computeUnitsConsumed: txDetails.meta?.computeUnitsConsumed || 0,
          logMessages: txDetails.meta?.logMessages || [],
          fee: txDetails.meta?.fee || 0,
          errorMessage: txDetails.meta?.err ? JSON.stringify(txDetails.meta.err) : undefined
        }
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error checking transaction status ${transactionId} on ${this.config.network}: ${errorMsg}`, error);
      
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
      
      // Get latest block (slot)
      const slot = await this.connection.getSlot();
      
      // Get block time
      const blockTime = await this.connection.getBlockTime(slot);
      
      // Get block production stats
      const { circulating: circulatingSupply } = await this.connection.getSupply();
      
      // Get network congestion
      const { networkCongestion, currentTps } = await this.getNetworkCongestion();
      
      // Response time
      const rpcResponseTimeMs = Date.now() - startTime;
      
      // Create health status
      this.healthStatus = {
        isOperational: true,
        currentBlockHeight: slot,
        latestBlockTimestamp: (blockTime || Math.floor(Date.now() / 1000)) * 1000, // Convert to ms
        averageBlockTimeMs: 400, // Solana targets 400ms per slot
        networkCongestion,
        currentTps,
        rpcResponseTimeMs,
        isConfigured: this.isInitialized && this.payer !== null,
        chainSpecific: {
          network: this.config.network,
          circulatingSupply: circulatingSupply?.amount || 0,
          clusterNodes: 0, // Would get in real implementation
          version: '' // Would get from getVersion in real implementation
        }
      };
      
      this.healthCheckTimestamp = Date.now();
      
      // Emit telemetry
      this.telemetryBus.emit('solana_health_check', {
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
      logger.error(`Error getting chain health status for ${this.config.network}: ${errorMsg}`, error);
      
      // Try switching to a fallback RPC if available
      this.tryFallbackRpc();
      
      // Create a degraded health status
      const degradedStatus: ChainHealthStatus = {
        isOperational: false,
        currentBlockHeight: 0,
        latestBlockTimestamp: 0,
        averageBlockTimeMs: 0,
        networkCongestion: 1, // Maximum congestion
        currentTps: 0,
        rpcResponseTimeMs: 0,
        isConfigured: this.isInitialized && this.payer !== null,
        chainSpecific: {
          network: this.config.network,
          error: errorMsg
        }
      };
      
      // Emit telemetry
      this.telemetryBus.emit('solana_health_check_failed', {
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
      
      // In a real implementation, we would check constraints specific to Solana
      // For this example, we'll do some basic checks
      
      // Check if the genome is compatible with Solana
      const isCompatible = true; // Placeholder for real validation logic
      
      if (!isCompatible) {
        return {
          isValid: false,
          errors: ['Strategy is not compatible with Solana']
        };
      }
      
      // Success
      return {
        isValid: true
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error validating strategy ${genome.id} for ${this.config.network}: ${errorMsg}`, error);
      
      return {
        isValid: false,
        errors: [errorMsg]
      };
    }
  }
  
  /**
   * Private: Build instructions from genome and params
   */
  private async buildInstructions(
    genome: StrategyGenome,
    market: string,
    params: ExecutionParams
  ): Promise<{
    instructions: web3.TransactionInstruction[];
    signers: web3.Keypair[];
  }> {
    // In a real implementation, this would build the instructions based on the strategy
    // For this example, we'll create a simple token transfer instruction
    
    // Example: Transfer tokens (simulating strategy execution)
    const recipientAddress = new web3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'); // SPL Token program
    const amount = params.amount * web3.LAMPORTS_PER_SOL; // Convert to lamports
    
    // Create a simple system transfer instruction
    const instructions = [
      web3.SystemProgram.transfer({
        fromPubkey: this.payer!.publicKey,
        toPubkey: recipientAddress,
        lamports: amount
      })
    ];
    
    // No additional signers needed for this example
    const signers: web3.Keypair[] = [];
    
    return {
      instructions,
      signers
    };
  }
  
  /**
   * Private: Get current blockhash
   */
  private async getCurrentBlockhash(): Promise<web3.BlockhashWithExpiryBlockHeight> {
    try {
      return await this.connection.getLatestBlockhash({
        commitment: this.config.commitment
      });
    } catch (error) {
      // Try fallback RPC
      this.tryFallbackRpc();
      
      // Retry with new connection
      return await this.connection.getLatestBlockhash({
        commitment: this.config.commitment
      });
    }
  }
  
  /**
   * Private: Send a transaction
   */
  private async sendTransaction(
    serializedTx: Buffer
  ): Promise<string> {
    let signature = '';
    let retries = 0;
    
    while (retries <= this.config.maxRetries) {
      try {
        signature = await this.connection.sendRawTransaction(serializedTx, {
          skipPreflight: this.config.skipPreflight,
          preflightCommitment: this.config.commitment,
          maxRetries: this.config.rpcRetries
        });
        return signature;
      } catch (error) {
        retries++;
        
        if (retries > this.config.maxRetries) {
          throw error;
        }
        
        // Try a fallback RPC
        this.tryFallbackRpc();
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    throw new Error('Failed to send transaction after maximum retries');
  }
  
  /**
   * Private: Confirm a transaction
   */
  private async confirmTransaction(
    signature: string,
    timeoutMs: number
  ): Promise<boolean> {
    // Calculate timeout
    const startTime = Date.now();
    const maxEndTime = startTime + timeoutMs;
    
    // Create a blockhash-based confirmation strategy
    const { blockhash, lastValidBlockHeight } = await this.getCurrentBlockhash();
    
    while (Date.now() < maxEndTime) {
      const status = await this.connection.getSignatureStatus(signature);
      
      // Check if confirmed
      if (
        status?.value?.confirmationStatus === this.config.commitment ||
        status?.value?.confirmationStatus === 'finalized'
      ) {
        return true;
      }
      
      // If we have a last valid block height and we've exceeded it, the transaction has expired
      if (lastValidBlockHeight) {
        const currentBlockHeight = await this.connection.getBlockHeight();
        if (currentBlockHeight > lastValidBlockHeight) {
          throw new Error(`Transaction ${signature} expired at block height ${lastValidBlockHeight}, current height ${currentBlockHeight}`);
        }
      }
      
      // Sleep before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Timeout occurred
    return false;
  }
  
  /**
   * Private: Get network congestion estimate
   */
  private async getNetworkCongestion(): Promise<{ networkCongestion: number, currentTps: number }> {
    try {
      // In a real implementation, this could be calculated from recent block samples
      // For this example, we'll use random values
      
      // Get a recent performance sample
      const perfSamples = await this.connection.getRecentPerformanceSamples(5);
      
      if (perfSamples && perfSamples.length > 0) {
        // Calculate average TPS from samples
        let totalTps = 0;
        
        for (const sample of perfSamples) {
          totalTps += sample.numTransactions / Math.max(1, sample.samplePeriodSecs);
        }
        
        const avgTps = totalTps / perfSamples.length;
        
        // Normalize to congestion (0-1)
        // Assuming 50k TPS is max capacity for Solana
        const congestion = Math.min(1, avgTps / 50000);
        
        return {
          networkCongestion: congestion,
          currentTps: avgTps
        };
      }
      
      // Fallback values
      return {
        networkCongestion: 0.3, // Moderate congestion
        currentTps: 2000 // Typical TPS for Solana
      };
    } catch (error) {
      logger.error(`Error getting network congestion: ${error instanceof Error ? error.message : String(error)}`);
      return {
        networkCongestion: 0.5, // Default to medium congestion
        currentTps: 1500 // Default TPS
      };
    }
  }
  
  /**
   * Private: Try to switch to a fallback RPC
   */
  private tryFallbackRpc(): boolean {
    if (this.fallbackConnections.length === 0) {
      logger.warn('No fallback RPC connections available');
      return false;
    }
    
    // Move to next connection
    this.activeConnectionIndex = (this.activeConnectionIndex + 1) % (this.fallbackConnections.length + 1);
    
    if (this.activeConnectionIndex === 0) {
      // Back to primary
      this.connection = new web3.Connection(
        this.config.rpcUrls[0],
        this.config.commitment
      );
      logger.info(`Switched back to primary RPC: ${this.config.rpcUrls[0]}`);
    } else {
      // Use fallback
      this.connection = this.fallbackConnections[this.activeConnectionIndex - 1];
      logger.info(`Switched to fallback RPC ${this.activeConnectionIndex}: ${this.config.rpcUrls[this.activeConnectionIndex]}`);
    }
    
    return true;
  }
} 