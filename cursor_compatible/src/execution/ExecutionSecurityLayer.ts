import { logger } from '../utils/logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { StrategyGenome } from '../evolution/StrategyGenome';
import { ExecutionParams } from './interfaces/IExecutionAdapter';
import { CrossChainStrategyRegistry } from './CrossChainStrategyRegistry';
import * as crypto from 'crypto';

/**
 * Security modes for private key storage
 */
export enum KeyStorageMode {
  MEMORY = 'memory', // In-memory storage (least secure)
  ENCRYPTED_FILE = 'encrypted_file', // Encrypted file storage
  HSM = 'hsm', // Hardware Security Module
  VAULT = 'vault', // Hashicorp Vault or similar
  MPC = 'mpc', // Multi-Party Computation
  TEE = 'tee' // Trusted Execution Environment
}

/**
 * Signing mechanism abstraction
 */
export enum SigningMechanism {
  LOCAL = 'local', // Sign locally using in-process key
  EXTERNAL_SERVICE = 'external_service', // External service/API
  HARDWARE_WALLET = 'hardware_wallet', // Physical hardware wallet
  MPC = 'mpc', // Multi-Party Computation signing
  MULTI_SIG = 'multi_sig' // Multi-signature scheme
}

/**
 * Authorization result
 */
export interface AuthorizationResult {
  /**
   * Whether the execution is authorized
   */
  isAuthorized: boolean;
  
  /**
   * Reason for rejection if not authorized
   */
  reason?: string;
  
  /**
   * Signature or authorization token if authorized
   */
  authToken?: string;
  
  /**
   * Expiration timestamp of the authorization
   */
  expirationTimestamp?: number;
  
  /**
   * Risk assessment score (0-1, higher is riskier)
   */
  riskScore?: number;
}

/**
 * Configuration for the execution security layer
 */
export interface ExecutionSecurityLayerConfig {
  /**
   * Maximum allowed gas/fee limit per chain
   */
  maxGasLimits: Record<string, number>;
  
  /**
   * Maximum transaction value per chain
   */
  maxTxValueLimits: Record<string, number>;
  
  /**
   * Whitelisted chains that are allowed for execution
   */
  allowedChains: string[];
  
  /**
   * Whitelisted contracts that are allowed to interact with
   */
  allowedContracts: Record<string, string[]>;
  
  /**
   * Rate limits per time window (in ms)
   */
  rateLimits: {
    /**
     * Maximum number of executions per time window
     */
    maxExecutionsPerWindow: number;
    
    /**
     * Time window in milliseconds
     */
    windowMs: number;
  };
  
  /**
   * Key storage mode
   */
  keyStorageMode: KeyStorageMode;
  
  /**
   * Signing mechanism
   */
  signingMechanism: SigningMechanism;
  
  /**
   * Key rotation frequency in milliseconds
   */
  keyRotationIntervalMs: number;
  
  /**
   * Whitelisted IP addresses for API access
   */
  allowedIpAddresses: string[];
  
  /**
   * Whether to enable slashing protection
   */
  enableSlashingProtection: boolean;
  
  /**
   * Slashing protection thresholds
   */
  slashingProtectionThresholds: {
    /**
     * Maximum allowed slippage percentage
     */
    maxSlippagePercentage: number;
    
    /**
     * Maximum allowed gas price multiplier
     */
    maxGasPriceMultiplier: number;
    
    /**
     * Maximum consecutive failed transactions
     */
    maxConsecutiveFailures: number;
  };
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ExecutionSecurityLayerConfig = {
  maxGasLimits: {
    ethereum: 5000000, // 5 million gas for Ethereum
    solana: 200000, // 200k compute units for Solana
    cosmos: 3000000 // 3 million gas for Cosmos
  },
  maxTxValueLimits: {
    ethereum: 1, // 1 ETH
    solana: 100, // 100 SOL
    cosmos: 100 // 100 ATOM
  },
  allowedChains: ['ethereum', 'solana'],
  allowedContracts: {
    ethereum: [],
    solana: []
  },
  rateLimits: {
    maxExecutionsPerWindow: 100,
    windowMs: 60 * 1000 // 1 minute
  },
  keyStorageMode: KeyStorageMode.ENCRYPTED_FILE,
  signingMechanism: SigningMechanism.LOCAL,
  keyRotationIntervalMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  allowedIpAddresses: ['127.0.0.1'],
  enableSlashingProtection: true,
  slashingProtectionThresholds: {
    maxSlippagePercentage: 5, // 5%
    maxGasPriceMultiplier: 2, // 2x
    maxConsecutiveFailures: 3
  }
};

/**
 * Execution attempt tracking
 */
interface ExecutionAttempt {
  /**
   * Timestamp of the attempt
   */
  timestamp: number;
  
  /**
   * Strategy ID
   */
  strategyId: string;
  
  /**
   * Chain ID
   */
  chainId: string;
  
  /**
   * Market symbol
   */
  market: string;
  
  /**
   * Whether the attempt was successful
   */
  success: boolean;
}

/**
 * Key information
 */
interface KeyInfo {
  /**
   * Key ID
   */
  keyId: string;
  
  /**
   * Chain ID this key is for
   */
  chainId: string;
  
  /**
   * Creation timestamp
   */
  createdAt: number;
  
  /**
   * Last rotation timestamp
   */
  lastRotatedAt: number;
  
  /**
   * Next scheduled rotation timestamp
   */
  nextRotationTimestamp: number;
  
  /**
   * Public address or identifier
   */
  publicAddress: string;
}

/**
 * ExecutionSecurityLayer
 * 
 * Provides security for the execution infrastructure including signing
 * abstraction, key management, and execution authorization.
 */
export class ExecutionSecurityLayer {
  private static instance: ExecutionSecurityLayer | null = null;
  private config: ExecutionSecurityLayerConfig;
  private telemetryBus: TelemetryBus;
  private registry: CrossChainStrategyRegistry;
  private recentExecutions: ExecutionAttempt[] = [];
  private consecutiveFailures: Map<string, number> = new Map();
  private keys: Map<string, KeyInfo> = new Map();
  private keyRotationTimer: NodeJS.Timeout | null = null;
  
  /**
   * Private constructor
   */
  private constructor(config: Partial<ExecutionSecurityLayerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.validateConfig();
    
    this.telemetryBus = TelemetryBus.getInstance();
    this.registry = CrossChainStrategyRegistry.getInstance();
    
    // Setup initial keys
    this.initializeKeys();
    
    // Start key rotation timer
    this.startKeyRotationTimer();
    
    logger.info('ExecutionSecurityLayer initialized');
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<ExecutionSecurityLayerConfig>): ExecutionSecurityLayer {
    if (!ExecutionSecurityLayer.instance) {
      ExecutionSecurityLayer.instance = new ExecutionSecurityLayer(config);
    } else if (config) {
      ExecutionSecurityLayer.instance.updateConfig(config);
    }
    return ExecutionSecurityLayer.instance;
  }
  
  /**
   * Authorize a strategy execution
   */
  public async authorizeExecution(
    genome: StrategyGenome,
    chainId: string,
    market: string,
    params: ExecutionParams
  ): Promise<AuthorizationResult> {
    try {
      const startTime = Date.now();
      let riskScore = 0;
      
      // Check if chain is allowed
      if (!this.config.allowedChains.includes(chainId)) {
        logger.warn(`Execution rejected: Chain ${chainId} is not in the allowed chains list`);
        
        this.telemetryBus.emit('execution_authorization_rejected', {
          strategyId: genome.id,
          chainId,
          market,
          reason: 'Chain not allowed',
          timestamp: Date.now()
        });
        
        return {
          isAuthorized: false,
          reason: `Chain ${chainId} is not allowed`,
          riskScore: 1.0
        };
      }
      
      // Check rate limits
      const windowStart = Date.now() - this.config.rateLimits.windowMs;
      const recentExecutionsCount = this.recentExecutions.filter(
        e => e.timestamp >= windowStart
      ).length;
      
      if (recentExecutionsCount >= this.config.rateLimits.maxExecutionsPerWindow) {
        logger.warn(`Execution rejected: Rate limit exceeded (${recentExecutionsCount} executions in window)`);
        
        this.telemetryBus.emit('execution_authorization_rejected', {
          strategyId: genome.id,
          chainId,
          market,
          reason: 'Rate limit exceeded',
          timestamp: Date.now()
        });
        
        return {
          isAuthorized: false,
          reason: 'Rate limit exceeded',
          riskScore: 0.9
        };
      }
      
      // Check gas limits if specified
      if (params.feeParams && params.feeParams.gasLimit) {
        const maxGasLimit = this.config.maxGasLimits[chainId] || 0;
        
        if (params.feeParams.gasLimit > maxGasLimit) {
          logger.warn(`Execution rejected: Gas limit ${params.feeParams.gasLimit} exceeds maximum ${maxGasLimit}`);
          
          this.telemetryBus.emit('execution_authorization_rejected', {
            strategyId: genome.id,
            chainId,
            market,
            reason: 'Gas limit exceeded',
            timestamp: Date.now()
          });
          
          return {
            isAuthorized: false,
            reason: `Gas limit ${params.feeParams.gasLimit} exceeds maximum ${maxGasLimit}`,
            riskScore: 0.8
          };
        }
      }
      
      // Check for slashing protection
      if (this.config.enableSlashingProtection) {
        // Check slippage
        if (params.slippageTolerance > this.config.slashingProtectionThresholds.maxSlippagePercentage) {
          logger.warn(`Execution rejected: Slippage ${params.slippageTolerance}% exceeds maximum ${this.config.slashingProtectionThresholds.maxSlippagePercentage}%`);
          
          this.telemetryBus.emit('execution_authorization_rejected', {
            strategyId: genome.id,
            chainId,
            market,
            reason: 'Slippage limit exceeded',
            timestamp: Date.now()
          });
          
          return {
            isAuthorized: false,
            reason: `Slippage ${params.slippageTolerance}% exceeds maximum ${this.config.slashingProtectionThresholds.maxSlippagePercentage}%`,
            riskScore: 0.7
          };
        }
        
        // Check consecutive failures
        const strategyKey = `${genome.id}:${chainId}:${market}`;
        const failureCount = this.consecutiveFailures.get(strategyKey) || 0;
        
        if (failureCount >= this.config.slashingProtectionThresholds.maxConsecutiveFailures) {
          logger.warn(`Execution rejected: Strategy has ${failureCount} consecutive failures`);
          
          this.telemetryBus.emit('execution_authorization_rejected', {
            strategyId: genome.id,
            chainId,
            market,
            reason: 'Too many consecutive failures',
            timestamp: Date.now()
          });
          
          return {
            isAuthorized: false,
            reason: `Strategy has ${failureCount} consecutive failures`,
            riskScore: 0.6
          };
        }
        
        // Add to risk score - higher number of failures means higher risk
        riskScore += (failureCount / this.config.slashingProtectionThresholds.maxConsecutiveFailures) * 0.5;
      }
      
      // Check transaction value if specified in params
      if (params.amount) {
        const maxValue = this.config.maxTxValueLimits[chainId] || 0;
        
        if (params.amount > maxValue) {
          logger.warn(`Execution rejected: Transaction value ${params.amount} exceeds maximum ${maxValue}`);
          
          this.telemetryBus.emit('execution_authorization_rejected', {
            strategyId: genome.id,
            chainId,
            market,
            reason: 'Transaction value limit exceeded',
            timestamp: Date.now()
          });
          
          return {
            isAuthorized: false,
            reason: `Transaction value ${params.amount} exceeds maximum ${maxValue}`,
            riskScore: 0.85
          };
        }
        
        // Add to risk score - higher value means higher risk (scale from 0 to maxValue)
        riskScore += (params.amount / maxValue) * 0.4;
      }
      
      // Get key for this chain
      const keyInfo = this.getKeyForChain(chainId);
      if (!keyInfo) {
        logger.error(`No key available for chain ${chainId}`);
        
        this.telemetryBus.emit('execution_authorization_rejected', {
          strategyId: genome.id,
          chainId,
          market,
          reason: 'No key available',
          timestamp: Date.now()
        });
        
        return {
          isAuthorized: false,
          reason: `No key available for chain ${chainId}`,
          riskScore: 0.5
        };
      }
      
      // Generate authorization token
      const authToken = this.generateAuthToken(genome.id, chainId, market, params);
      
      // Track execution attempt
      this.trackExecutionAttempt({
        timestamp: Date.now(),
        strategyId: genome.id,
        chainId,
        market,
        success: true // Assuming authorization successful at this point
      });
      
      // Emit telemetry
      this.telemetryBus.emit('execution_authorization_granted', {
        strategyId: genome.id,
        chainId,
        market,
        keyId: keyInfo.keyId,
        riskScore,
        processingTimeMs: Date.now() - startTime,
        timestamp: Date.now()
      });
      
      logger.info(`Execution authorized for strategy ${genome.id} on chain ${chainId} for market ${market} (risk: ${riskScore.toFixed(2)})`);
      
      return {
        isAuthorized: true,
        authToken,
        expirationTimestamp: Date.now() + 300000, // 5 minutes
        riskScore
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Error authorizing execution: ${errorMsg}`, error);
      
      this.telemetryBus.emit('execution_authorization_error', {
        strategyId: genome.id,
        chainId,
        market,
        error: errorMsg,
        timestamp: Date.now()
      });
      
      return {
        isAuthorized: false,
        reason: `Internal security error: ${errorMsg}`,
        riskScore: 1.0
      };
    }
  }
  
  /**
   * Record execution result for tracking
   */
  public recordExecutionResult(
    strategyId: string,
    chainId: string,
    market: string,
    success: boolean,
    error?: string
  ): void {
    // Track execution attempt
    this.trackExecutionAttempt({
      timestamp: Date.now(),
      strategyId,
      chainId,
      market,
      success
    });
    
    // Update consecutive failures
    const strategyKey = `${strategyId}:${chainId}:${market}`;
    
    if (success) {
      // Reset consecutive failures on success
      this.consecutiveFailures.set(strategyKey, 0);
    } else {
      // Increment consecutive failures
      const currentFailures = this.consecutiveFailures.get(strategyKey) || 0;
      this.consecutiveFailures.set(strategyKey, currentFailures + 1);
      
      // Emit telemetry if getting close to maximum failures
      if (currentFailures + 1 >= this.config.slashingProtectionThresholds.maxConsecutiveFailures) {
        this.telemetryBus.emit('execution_consecutive_failures_warning', {
          strategyId,
          chainId,
          market,
          failureCount: currentFailures + 1,
          maxFailures: this.config.slashingProtectionThresholds.maxConsecutiveFailures,
          lastError: error,
          timestamp: Date.now()
        });
        
        logger.warn(`Strategy ${strategyId} on chain ${chainId} for market ${market} has ${currentFailures + 1} consecutive failures`);
      }
    }
  }
  
  /**
   * Get key info for a specific chain
   */
  public getKeyForChain(chainId: string): KeyInfo | null {
    for (const keyInfo of this.keys.values()) {
      if (keyInfo.chainId === chainId) {
        return keyInfo;
      }
    }
    
    return null;
  }
  
  /**
   * Verify an authorization token
   */
  public verifyAuthToken(
    strategyId: string,
    chainId: string,
    market: string,
    authToken: string
  ): boolean {
    try {
      // Parse token
      const parts = authToken.split('.');
      if (parts.length !== 3) {
        logger.warn(`Invalid auth token format for strategy ${strategyId}`);
        return false;
      }
      
      const [headerBase64, payloadBase64, signature] = parts;
      
      // Decode payload
      const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf8');
      const payload = JSON.parse(payloadJson);
      
      // Verify token
      if (payload.strategyId !== strategyId || 
          payload.chainId !== chainId || 
          payload.market !== market) {
        logger.warn(`Auth token mismatch for strategy ${strategyId}`);
        return false;
      }
      
      // Check expiration
      if (payload.exp < Date.now()) {
        logger.warn(`Auth token expired for strategy ${strategyId}`);
        return false;
      }
      
      // In a real implementation, we would verify the signature here
      // For simplicity, we'll skip actual cryptographic verification
      
      return true;
    } catch (error) {
      logger.error(`Error verifying auth token: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
  
  /**
   * Get consecutive failure count for a strategy
   */
  public getConsecutiveFailures(
    strategyId: string,
    chainId: string,
    market: string
  ): number {
    const strategyKey = `${strategyId}:${chainId}:${market}`;
    return this.consecutiveFailures.get(strategyKey) || 0;
  }
  
  /**
   * Manually rotate keys for a chain
   */
  public async rotateKeys(chainId: string): Promise<boolean> {
    try {
      // Get key for this chain
      const keyInfo = this.getKeyForChain(chainId);
      if (!keyInfo) {
        logger.error(`No key available for chain ${chainId}`);
        return false;
      }
      
      // Generate new key
      const newKeyId = `key-${chainId}-${Date.now()}`;
      const publicAddress = this.generateMockAddress(chainId);
      
      // Replace the existing key
      const newKeyInfo: KeyInfo = {
        keyId: newKeyId,
        chainId,
        createdAt: Date.now(),
        lastRotatedAt: Date.now(),
        nextRotationTimestamp: Date.now() + this.config.keyRotationIntervalMs,
        publicAddress
      };
      
      this.keys.set(newKeyId, newKeyInfo);
      
      // Clean up old key
      this.keys.delete(keyInfo.keyId);
      
      // Emit telemetry
      this.telemetryBus.emit('key_rotated', {
        chainId,
        keyId: newKeyId,
        publicAddress,
        timestamp: Date.now()
      });
      
      logger.info(`Rotated key for chain ${chainId}: new key ID ${newKeyId}, address ${publicAddress}`);
      return true;
    } catch (error) {
      logger.error(`Error rotating keys for chain ${chainId}:`, error);
      return false;
    }
  }
  
  /**
   * Track an execution attempt
   */
  private trackExecutionAttempt(attempt: ExecutionAttempt): void {
    this.recentExecutions.push(attempt);
    
    // Cleanup old attempts - only keep last hour
    const cutoff = Date.now() - 3600000; // 1 hour
    this.recentExecutions = this.recentExecutions.filter(a => a.timestamp >= cutoff);
  }
  
  /**
   * Initialize keys for all supported chains
   */
  private initializeKeys(): void {
    for (const chainId of this.config.allowedChains) {
      const keyId = `key-${chainId}-${Date.now()}`;
      const publicAddress = this.generateMockAddress(chainId);
      
      const keyInfo: KeyInfo = {
        keyId,
        chainId,
        createdAt: Date.now(),
        lastRotatedAt: Date.now(),
        nextRotationTimestamp: Date.now() + this.config.keyRotationIntervalMs,
        publicAddress
      };
      
      this.keys.set(keyId, keyInfo);
      
      logger.info(`Initialized key for chain ${chainId}: key ID ${keyId}, address ${publicAddress}`);
    }
  }
  
  /**
   * Start the key rotation timer
   */
  private startKeyRotationTimer(): void {
    // Check for key rotation every hour
    this.keyRotationTimer = setInterval(() => {
      this.checkKeyRotation();
    }, 60 * 60 * 1000); // 1 hour
  }
  
  /**
   * Check if any keys need rotation
   */
  private checkKeyRotation(): void {
    const now = Date.now();
    
    for (const keyInfo of this.keys.values()) {
      if (now >= keyInfo.nextRotationTimestamp) {
        logger.info(`Key ${keyInfo.keyId} for chain ${keyInfo.chainId} due for rotation`);
        this.rotateKeys(keyInfo.chainId).catch(error => {
          logger.error(`Failed to rotate key: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    }
  }
  
  /**
   * Generate a mock address for a chain (for demo purposes)
   */
  private generateMockAddress(chainId: string): string {
    const randomBytes = crypto.randomBytes(20).toString('hex');
    
    if (chainId === 'ethereum') {
      return `0x${randomBytes}`;
    } else if (chainId === 'solana') {
      return randomBytes;
    } else {
      return `${chainId}-${randomBytes}`;
    }
  }
  
  /**
   * Generate an authorization token
   */
  private generateAuthToken(
    strategyId: string,
    chainId: string,
    market: string,
    params: ExecutionParams
  ): string {
    // In a real implementation, this would be a JWT or similar token
    // with proper cryptographic signatures
    
    // For simplicity, we'll create a basic token format
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };
    
    const payload = {
      strategyId,
      chainId,
      market,
      amount: params.amount,
      iat: Date.now(),
      exp: Date.now() + 300000 // 5 minutes
    };
    
    const headerBase64 = Buffer.from(JSON.stringify(header)).toString('base64');
    const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');
    
    // In a real implementation, this would be a real signature
    // For demo purposes, we'll just use a hash of the payload
    const mockSignature = crypto
      .createHash('sha256')
      .update(`${headerBase64}.${payloadBase64}`)
      .digest('base64');
    
    return `${headerBase64}.${payloadBase64}.${mockSignature}`;
  }
  
  /**
   * Update security configuration
   */
  private updateConfig(config: Partial<ExecutionSecurityLayerConfig>): void {
    this.config = { ...this.config, ...config };
    this.validateConfig();
    
    logger.info('ExecutionSecurityLayer configuration updated');
    
    // Restart key rotation timer if interval changed
    if (this.keyRotationTimer) {
      clearInterval(this.keyRotationTimer);
      this.startKeyRotationTimer();
    }
  }
  
  /**
   * Validate configuration
   */
  private validateConfig(): void {
    // Ensure allowed chains is not empty
    if (!this.config.allowedChains || this.config.allowedChains.length === 0) {
      logger.warn('No allowed chains specified, setting default to ethereum and solana');
      this.config.allowedChains = ['ethereum', 'solana'];
    }
    
    // Ensure rate limits are reasonable
    if (this.config.rateLimits.maxExecutionsPerWindow <= 0) {
      logger.warn('Invalid rate limit, setting to default of 100 per minute');
      this.config.rateLimits.maxExecutionsPerWindow = 100;
      this.config.rateLimits.windowMs = 60 * 1000;
    }
    
    // Validate key rotation interval
    if (this.config.keyRotationIntervalMs < 3600000) { // Minimum 1 hour
      logger.warn('Key rotation interval too small, setting to minimum of 1 hour');
      this.config.keyRotationIntervalMs = 3600000;
    }
  }
} 