import { UniversalXAdapter } from '../adapters/UniversalXAdapter';
import { AccountStatus, ChainInfo } from '../adapters/interfaces/ICrossChainAdapter';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { createLogger } from '../common/logger';

const logger = createLogger('UniversalAccountService');

/**
 * Account balance information
 */
export interface AccountBalance {
  chainId: string;
  chainName: string;
  token: string;
  balance: string;
  valueUSD?: number;
  lastUpdated: number;
}

/**
 * Account health status
 */
export interface AccountHealthStatus {
  accountId: string;
  isHealthy: boolean;
  totalValueUSD: number;
  chains: {
    chainId: string;
    chainName: string;
    status: 'active' | 'inactive' | 'error';
    lastActivity?: number;
  }[];
  warnings: string[];
  errors: string[];
  lastChecked: number;
}

/**
 * UniversalAccountService - Service for managing UniversalX account lifecycle
 * 
 * This service handles account creation, funding, monitoring, and health checks
 * for the UniversalX universal account system.
 */
export class UniversalAccountService {
  private static instance: UniversalAccountService | null = null;
  private adapter: UniversalXAdapter | null = null;
  private telemetryBus: TelemetryBus;
  private accountStatus: AccountStatus | null = null;
  private balances: Map<string, AccountBalance> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;
  private balanceCheckInterval?: NodeJS.Timeout;
  
  private constructor() {
    this.telemetryBus = TelemetryBus.getInstance();
  }
  
  /**
   * Get singleton instance of UniversalAccountService
   */
  public static getInstance(): UniversalAccountService {
    if (!UniversalAccountService.instance) {
      UniversalAccountService.instance = new UniversalAccountService();
    }
    return UniversalAccountService.instance;
  }
  
  /**
   * Initialize the service with a UniversalX adapter
   */
  public async initialize(adapter: UniversalXAdapter): Promise<void> {
    try {
      logger.info('Initializing UniversalAccountService');
      
      this.adapter = adapter;
      
      // Get initial account status
      await this.refreshAccountStatus();
      
      // Start monitoring
      this.startHealthMonitoring();
      this.startBalanceMonitoring();
      
      logger.info('UniversalAccountService initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize UniversalAccountService', error);
      throw error;
    }
  }
  
  /**
   * Create a new universal account
   */
  public async createAccount(): Promise<AccountStatus> {
    if (!this.adapter) {
      throw new Error('UniversalAccountService not initialized');
    }
    
    try {
      logger.info('Creating new universal account');
      
      // For UniversalX, account creation happens automatically on first authentication
      // So we just need to get the account status
      const status = await this.adapter.getUniversalAccountStatus();
      
      this.accountStatus = status;
      
      // Emit telemetry
      this.telemetryBus.emit('universal_account_created', {
        timestamp: Date.now(),
        accountId: status.accountId,
        isActive: status.isActive,
        chains: status.chains.length
      });
      
      logger.info(`Universal account created: ${status.accountId}`);
      return status;
    } catch (error) {
      logger.error('Failed to create universal account', error);
      throw error;
    }
  }
  
  /**
   * Get current account balances across all chains
   */
  public async getBalances(): Promise<AccountBalance[]> {
    if (!this.adapter || !this.accountStatus) {
      throw new Error('UniversalAccountService not initialized or no account');
    }
    
    try {
      const balances: AccountBalance[] = [];
      
      // Get balance for each supported chain
      for (const chain of this.accountStatus.chains) {
        if (chain.status !== 'active') continue;
        
        try {
          // Get native token balance
          const nativeBalance = await this.adapter.getBalance(
            this.accountStatus.accountId,
            {
              symbol: chain.nativeToken.symbol,
              name: chain.nativeToken.symbol,
              decimals: chain.nativeToken.decimals,
              chainId: chain.chainId,
              isNative: true
            }
          );
          
          const balance: AccountBalance = {
            chainId: chain.id,
            chainName: chain.name,
            token: chain.nativeToken.symbol,
            balance: nativeBalance,
            lastUpdated: Date.now()
          };
          
          balances.push(balance);
          this.balances.set(`${chain.id}-${chain.nativeToken.symbol}`, balance);
        } catch (error) {
          logger.error(`Failed to get balance for chain ${chain.name}`, error);
        }
      }
      
      return balances;
    } catch (error) {
      logger.error('Failed to get balances', error);
      throw error;
    }
  }
  
  /**
   * Get account health status
   */
  public async getHealthStatus(): Promise<AccountHealthStatus> {
    if (!this.adapter || !this.accountStatus) {
      throw new Error('UniversalAccountService not initialized or no account');
    }
    
    const warnings: string[] = [];
    const errors: string[] = [];
    const chainStatuses: AccountHealthStatus['chains'] = [];
    
    // Check each chain status
    for (const chain of this.accountStatus.chains) {
      const chainStatus = {
        chainId: chain.id,
        chainName: chain.name,
        status: chain.status as 'active' | 'inactive' | 'error'
      };
      
      if (chain.status === 'maintenance') {
        warnings.push(`Chain ${chain.name} is under maintenance`);
        chainStatus.status = 'inactive';
      } else if (chain.status === 'inactive') {
        errors.push(`Chain ${chain.name} is inactive`);
        chainStatus.status = 'error';
      }
      
      chainStatuses.push(chainStatus);
    }
    
    // Check account balance
    const totalValue = this.accountStatus.totalValueUSD || 0;
    if (totalValue < 10) {
      warnings.push('Low account balance detected');
    }
    
    const isHealthy = errors.length === 0 && this.accountStatus.isActive;
    
    const healthStatus: AccountHealthStatus = {
      accountId: this.accountStatus.accountId,
      isHealthy,
      totalValueUSD: totalValue,
      chains: chainStatuses,
      warnings,
      errors,
      lastChecked: Date.now()
    };
    
    // Emit telemetry
    this.telemetryBus.emit('universal_account_health_check', {
      timestamp: Date.now(),
      accountId: this.accountStatus.accountId,
      isHealthy,
      warningCount: warnings.length,
      errorCount: errors.length
    });
    
    return healthStatus;
  }
  
  /**
   * Fund the universal account from a specific chain
   */
  public async fundAccount(chainId: string, token: string, amount: string): Promise<string> {
    if (!this.adapter) {
      throw new Error('UniversalAccountService not initialized');
    }
    
    try {
      logger.info(`Funding universal account from chain ${chainId} with ${amount} ${token}`);
      
      const txResponse = await this.adapter.fundAccount!(chainId, token, amount);
      
      // Emit telemetry
      this.telemetryBus.emit('universal_account_funded', {
        timestamp: Date.now(),
        chainId,
        token,
        amount,
        transactionHash: txResponse.hash
      });
      
      // Refresh account status after funding
      setTimeout(() => this.refreshAccountStatus(), 5000);
      
      return txResponse.hash;
    } catch (error) {
      logger.error('Failed to fund account', error);
      throw error;
    }
  }
  
  /**
   * Refresh account status
   */
  private async refreshAccountStatus(): Promise<void> {
    if (!this.adapter) return;
    
    try {
      this.accountStatus = await this.adapter.getUniversalAccountStatus();
      logger.debug('Account status refreshed');
    } catch (error) {
      logger.error('Failed to refresh account status', error);
    }
  }
  
  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    // Check health every 5 minutes
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.getHealthStatus();
        
        if (!health.isHealthy) {
          logger.warn('Universal account health check failed', {
            warnings: health.warnings,
            errors: health.errors
          });
          
          // Emit alert if unhealthy
          this.telemetryBus.emit('universal_account_unhealthy', {
            timestamp: Date.now(),
            accountId: health.accountId,
            warnings: health.warnings,
            errors: health.errors
          });
        }
      } catch (error) {
        logger.error('Health check failed', error);
      }
    }, 5 * 60 * 1000); // 5 minutes
  }
  
  /**
   * Start balance monitoring
   */
  private startBalanceMonitoring(): void {
    // Check balances every 30 seconds
    this.balanceCheckInterval = setInterval(async () => {
      try {
        await this.getBalances();
      } catch (error) {
        logger.error('Balance check failed', error);
      }
    }, 30 * 1000); // 30 seconds
  }
  
  /**
   * Stop all monitoring
   */
  public stopMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
    
    if (this.balanceCheckInterval) {
      clearInterval(this.balanceCheckInterval);
      this.balanceCheckInterval = undefined;
    }
  }
  
  /**
   * Get current account status
   */
  public getAccountStatus(): AccountStatus | null {
    return this.accountStatus;
  }
  
  /**
   * Get cached balance for a specific chain and token
   */
  public getCachedBalance(chainId: string, token: string): AccountBalance | undefined {
    return this.balances.get(`${chainId}-${token}`);
  }
  
  /**
   * Check if the service is initialized
   */
  public isInitialized(): boolean {
    return this.adapter !== null && this.accountStatus !== null;
  }
  
  /**
   * Shutdown the service
   */
  public async shutdown(): Promise<void> {
    logger.info('Shutting down UniversalAccountService');
    
    this.stopMonitoring();
    this.adapter = null;
    this.accountStatus = null;
    this.balances.clear();
    
    logger.info('UniversalAccountService shut down');
  }
} 