/**
 * TreasuryContract.ts
 * 
 * A TypeScript representation of the on-chain treasury contract.
 * This class provides methods for interacting with the treasury contract
 * on various chains, including fund management, fee collection, and distribution.
 */

import { IChainAdapter, TransactionResponse, ChainId, Asset, TransactionReceipt } from '../../adapters/IChainAdapter';
import { EventEmitter } from '../../utils/EventEmitter';

export interface TreasuryAsset {
  asset: Asset;
  balance: bigint;
  allocation: number; // Percentage allocation target (0-100)
  lastUpdated: number;
  usdValue: number;
  vaultAddress?: string; // Optional external vault address
}

export enum TreasuryAction {
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
  ALLOCATE = 'allocate',
  TRANSFER = 'transfer',
  SWAP = 'swap',
  COLLECT_FEES = 'collect_fees',
  DISTRIBUTE = 'distribute'
}

export interface TreasuryTransaction {
  id: string;
  action: TreasuryAction;
  initiator: string;
  proposalId?: string;
  assets: {
    asset: Asset;
    amount: bigint;
  }[];
  timestamp: number;
  txHash: string;
  status: 'pending' | 'completed' | 'failed';
  metadata?: Record<string, any>;
}

export interface TreasuryAllocationStrategy {
  id: string;
  name: string;
  assetAllocations: {
    assetSymbol: string;
    targetPercentage: number;
  }[];
  rebalancingThreshold: number; // Percentage deviation to trigger rebalance
  rebalancingFrequency: number; // Milliseconds between rebalances
  lastRebalanced: number;
  isActive: boolean;
}

export interface FeeDistributionConfig {
  treasuryPercentage: number; // Percentage to treasury
  stakingRewardsPercentage: number; // Percentage to staking rewards
  burnPercentage: number; // Percentage to burn
  ecosystemFundPercentage: number; // Percentage to ecosystem fund
  lastUpdated: number;
}

export interface TreasuryContractConfig {
  chainId: ChainId;
  contractAddress: string;
  multisigAddresses: string[];
  governanceAddress: string;
  feeDistribution: FeeDistributionConfig;
  timelockSeconds: number;
  maxWithdrawalAmountUsd: number; // Maximum withdrawal without timelock
  rebalancingEnabled: boolean;
  allocationStrategy?: TreasuryAllocationStrategy;
  emergencyAdmin?: string; // Emergency admin for critical situations
}

/**
 * A class representing the on-chain treasury contract
 */
export class TreasuryContract {
  private adapter: IChainAdapter;
  private config: TreasuryContractConfig;
  private eventEmitter: EventEmitter;
  private assets: Map<string, TreasuryAsset> = new Map();
  private pendingTransactions: TreasuryTransaction[] = [];
  
  /**
   * Create a new treasury contract instance
   * 
   * @param adapter The chain adapter to use for transactions
   * @param config The contract configuration
   * @param eventEmitter Event emitter for treasury events
   */
  constructor(
    adapter: IChainAdapter,
    config: TreasuryContractConfig,
    eventEmitter: EventEmitter
  ) {
    this.adapter = adapter;
    this.config = config;
    this.eventEmitter = eventEmitter;
  }
  
  /**
   * Initialize the treasury contract by fetching current state
   */
  public async initialize(): Promise<void> {
    try {
      // Fetch current assets and balances
      await this.refreshAssets();
      
      // Fetch pending transactions
      await this.refreshPendingTransactions();
      
      console.log(`Treasury contract initialized for chain ${this.config.chainId}`);
    } catch (error) {
      console.error('Failed to initialize treasury contract:', error);
      throw error;
    }
  }
  
  /**
   * Get the current chain ID
   */
  public getChainId(): ChainId {
    return this.config.chainId;
  }
  
  /**
   * Get the contract address
   */
  public getAddress(): string {
    return this.config.contractAddress;
  }
  
  /**
   * Refresh the list of assets and balances
   */
  public async refreshAssets(): Promise<void> {
    try {
      // In a real implementation, this would fetch from the contract
      // For now, use mock data
      this.assets.clear();
      
      // Example asset: ETH
      const ethAsset: Asset = {
        symbol: 'ETH',
        name: 'Ethereum',
        decimals: 18,
        chainId: this.config.chainId,
        isNative: true
      };
      
      // Add to assets map
      this.assets.set(ethAsset.symbol, {
        asset: ethAsset,
        balance: BigInt(1000000000000000000), // 1 ETH
        allocation: 40, // 40%
        lastUpdated: Date.now(),
        usdValue: 3000 // $3000
      });
      
      // Example asset: USDC
      const usdcAsset: Asset = {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        chainId: this.config.chainId,
        isNative: false
      };
      
      // Add to assets map
      this.assets.set(usdcAsset.symbol, {
        asset: usdcAsset,
        balance: BigInt(5000000000), // 5000 USDC
        allocation: 50, // 50%
        lastUpdated: Date.now(),
        usdValue: 5000 // $5000
      });
      
      // Example asset: NODRTK (Noderr Token)
      const noderrAsset: Asset = {
        symbol: 'NODRTK',
        name: 'Noderr Token',
        decimals: 18,
        address: '0x1234567890123456789012345678901234567890', // Example address
        chainId: this.config.chainId,
        isNative: false
      };
      
      // Add to assets map
      this.assets.set(noderrAsset.symbol, {
        asset: noderrAsset,
        balance: BigInt(10000000000000000000000), // 10000 NODRTK
        allocation: 10, // 10%
        lastUpdated: Date.now(),
        usdValue: 2000 // $2000
      });
      
      console.log(`Refreshed treasury assets (${this.assets.size} assets)`);
    } catch (error) {
      console.error('Failed to refresh assets:', error);
      throw error;
    }
  }
  
  /**
   * Refresh pending transactions
   */
  private async refreshPendingTransactions(): Promise<void> {
    try {
      // In a real implementation, this would fetch from the contract
      // For now, use mock data
      this.pendingTransactions = [];
      
      // Example pending transaction
      const pendingTx: TreasuryTransaction = {
        id: '0x123456',
        action: TreasuryAction.WITHDRAW,
        initiator: '0x0000000000000000000000000000000000000001',
        proposalId: '0x789',
        assets: [
          {
            asset: {
              symbol: 'ETH',
              name: 'Ethereum',
              decimals: 18,
              chainId: this.config.chainId,
              isNative: true
            },
            amount: BigInt(100000000000000000) // 0.1 ETH
          }
        ],
        timestamp: Date.now() - 3600000, // 1 hour ago
        txHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        status: 'pending'
      };
      
      this.pendingTransactions.push(pendingTx);
      
      console.log(`Refreshed pending transactions (${this.pendingTransactions.length} transactions)`);
    } catch (error) {
      console.error('Failed to refresh pending transactions:', error);
      throw error;
    }
  }
  
  /**
   * Get all treasury assets
   */
  public getAllAssets(): TreasuryAsset[] {
    return Array.from(this.assets.values());
  }
  
  /**
   * Get a specific treasury asset
   * 
   * @param symbol Asset symbol
   */
  public getAsset(symbol: string): TreasuryAsset | undefined {
    return this.assets.get(symbol);
  }
  
  /**
   * Get total USD value of treasury
   */
  public getTotalUsdValue(): number {
    let total = 0;
    
    for (const asset of this.assets.values()) {
      total += asset.usdValue;
    }
    
    return total;
  }
  
  /**
   * Get pending transactions
   */
  public getPendingTransactions(): TreasuryTransaction[] {
    return this.pendingTransactions;
  }
  
  /**
   * Deposit assets into the treasury
   * 
   * @param asset Asset to deposit
   * @param amount Amount to deposit
   * @param from Address to deposit from (defaults to wallet address)
   */
  public async deposit(
    asset: Asset,
    amount: bigint,
    from?: string
  ): Promise<TransactionResponse> {
    try {
      // Check if native asset
      if (asset.isNative) {
        // Send ETH to treasury
        const tx = {
          to: this.config.contractAddress,
          value: amount
        };
        
        const response = await this.adapter.sendTransaction(tx);
        
        // Update local state
        const treasuryAsset = this.assets.get(asset.symbol);
        if (treasuryAsset) {
          treasuryAsset.balance += amount;
          treasuryAsset.lastUpdated = Date.now();
        }
        
        // Emit event
        this.eventEmitter.emit('treasury:deposit', {
          chainId: this.config.chainId,
          asset: asset.symbol,
          amount: amount.toString(),
          from: from || await this.adapter.getWalletAddress(),
          txHash: response.hash,
          timestamp: Date.now()
        });
        
        return response;
      } else {
        // For ERC20 tokens, need to call approve + transferFrom
        // This is a simplified implementation
        
        // Build calldata for depositToken function
        const data = this.encodeFunction(
          'depositToken(address,uint256)',
          ['address', 'uint256'],
          [asset.address, amount.toString()]
        );
        
        // Send transaction
        const response = await this.sendTransaction(data, 'depositToken');
        
        // Update local state
        const treasuryAsset = this.assets.get(asset.symbol);
        if (treasuryAsset) {
          treasuryAsset.balance += amount;
          treasuryAsset.lastUpdated = Date.now();
        }
        
        // Emit event
        this.eventEmitter.emit('treasury:deposit', {
          chainId: this.config.chainId,
          asset: asset.symbol,
          amount: amount.toString(),
          from: from || await this.adapter.getWalletAddress(),
          txHash: response.hash,
          timestamp: Date.now()
        });
        
        return response;
      }
    } catch (error) {
      console.error(`Failed to deposit ${asset.symbol}:`, error);
      throw error;
    }
  }
  
  /**
   * Withdraw assets from the treasury
   * 
   * @param asset Asset to withdraw
   * @param amount Amount to withdraw
   * @param to Address to withdraw to
   * @param proposalId ID of the proposal that authorized this withdrawal
   */
  public async withdraw(
    asset: Asset,
    amount: bigint,
    to: string,
    proposalId: string
  ): Promise<TransactionResponse> {
    try {
      // Check if the withdrawal requires timelock
      const assetUsdValue = this.getAssetUsdValue(asset, amount);
      
      if (assetUsdValue > this.config.maxWithdrawalAmountUsd) {
        // Should go through timelock process
        console.log(`Withdrawal of ${assetUsdValue} USD requires timelock`);
      }
      
      // Build calldata for withdraw function
      const data = this.encodeFunction(
        'withdraw(address,uint256,address,string)',
        ['address', 'uint256', 'address', 'string'],
        [
          asset.isNative ? '0x0000000000000000000000000000000000000000' : asset.address,
          amount.toString(),
          to,
          proposalId
        ]
      );
      
      // Send transaction
      const response = await this.sendTransaction(data, 'withdraw');
      
      // Update local state
      const treasuryAsset = this.assets.get(asset.symbol);
      if (treasuryAsset) {
        treasuryAsset.balance -= amount;
        treasuryAsset.lastUpdated = Date.now();
      }
      
      // Emit event
      this.eventEmitter.emit('treasury:withdraw', {
        chainId: this.config.chainId,
        asset: asset.symbol,
        amount: amount.toString(),
        to,
        proposalId,
        txHash: response.hash,
        timestamp: Date.now()
      });
      
      return response;
    } catch (error) {
      console.error(`Failed to withdraw ${asset.symbol}:`, error);
      throw error;
    }
  }
  
  /**
   * Calculate USD value of an asset amount
   * 
   * @param asset Asset to calculate
   * @param amount Amount to calculate
   */
  private getAssetUsdValue(asset: Asset, amount: bigint): number {
    const treasuryAsset = this.assets.get(asset.symbol);
    
    if (!treasuryAsset) {
      return 0;
    }
    
    // Calculate the USD value based on the current balance and USD value
    return Number(amount) * (treasuryAsset.usdValue / Number(treasuryAsset.balance));
  }
  
  /**
   * Update the treasury allocation strategy
   * 
   * @param strategy New allocation strategy
   */
  public async updateAllocationStrategy(
    strategy: TreasuryAllocationStrategy
  ): Promise<TransactionResponse> {
    try {
      // Validate strategy
      let totalAllocation = 0;
      for (const allocation of strategy.assetAllocations) {
        totalAllocation += allocation.targetPercentage;
      }
      
      if (totalAllocation !== 100) {
        throw new Error(`Total allocation must be 100%, got ${totalAllocation}%`);
      }
      
      // Build calldata for updateAllocationStrategy function
      const data = this.encodeFunction(
        'updateAllocationStrategy(string,bytes)',
        ['string', 'bytes'],
        [strategy.id, JSON.stringify(strategy)]
      );
      
      // Send transaction
      const response = await this.sendTransaction(data, 'updateAllocationStrategy');
      
      // Update local config
      this.config.allocationStrategy = strategy;
      
      // Emit event
      this.eventEmitter.emit('treasury:update_strategy', {
        chainId: this.config.chainId,
        strategyId: strategy.id,
        txHash: response.hash,
        timestamp: Date.now()
      });
      
      return response;
    } catch (error) {
      console.error('Failed to update allocation strategy:', error);
      throw error;
    }
  }
  
  /**
   * Update fee distribution configuration
   * 
   * @param config New fee distribution configuration
   */
  public async updateFeeDistribution(
    config: FeeDistributionConfig
  ): Promise<TransactionResponse> {
    try {
      // Validate config
      const total = 
        config.treasuryPercentage + 
        config.stakingRewardsPercentage + 
        config.burnPercentage + 
        config.ecosystemFundPercentage;
      
      if (total !== 100) {
        throw new Error(`Total fee distribution must be 100%, got ${total}%`);
      }
      
      // Build calldata for updateFeeDistribution function
      const data = this.encodeFunction(
        'updateFeeDistribution(uint256,uint256,uint256,uint256)',
        ['uint256', 'uint256', 'uint256', 'uint256'],
        [
          config.treasuryPercentage,
          config.stakingRewardsPercentage,
          config.burnPercentage,
          config.ecosystemFundPercentage
        ]
      );
      
      // Send transaction
      const response = await this.sendTransaction(data, 'updateFeeDistribution');
      
      // Update local config
      this.config.feeDistribution = {
        ...config,
        lastUpdated: Date.now()
      };
      
      // Emit event
      this.eventEmitter.emit('treasury:update_fee_distribution', {
        chainId: this.config.chainId,
        distribution: config,
        txHash: response.hash,
        timestamp: Date.now()
      });
      
      return response;
    } catch (error) {
      console.error('Failed to update fee distribution:', error);
      throw error;
    }
  }
  
  /**
   * Collect fees from various protocol contracts
   */
  public async collectFees(): Promise<TransactionResponse> {
    try {
      // Build calldata for collectFees function
      const data = this.encodeFunction(
        'collectFees()',
        [],
        []
      );
      
      // Send transaction
      const response = await this.sendTransaction(data, 'collectFees');
      
      // Refresh assets after collecting fees
      await this.refreshAssets();
      
      // Emit event
      this.eventEmitter.emit('treasury:collect_fees', {
        chainId: this.config.chainId,
        txHash: response.hash,
        timestamp: Date.now()
      });
      
      return response;
    } catch (error) {
      console.error('Failed to collect fees:', error);
      throw error;
    }
  }
  
  /**
   * Distribute fees according to the fee distribution configuration
   */
  public async distributeFees(): Promise<TransactionResponse> {
    try {
      // Build calldata for distributeFees function
      const data = this.encodeFunction(
        'distributeFees()',
        [],
        []
      );
      
      // Send transaction
      const response = await this.sendTransaction(data, 'distributeFees');
      
      // Refresh assets after distributing fees
      await this.refreshAssets();
      
      // Emit event
      this.eventEmitter.emit('treasury:distribute_fees', {
        chainId: this.config.chainId,
        txHash: response.hash,
        timestamp: Date.now()
      });
      
      return response;
    } catch (error) {
      console.error('Failed to distribute fees:', error);
      throw error;
    }
  }
  
  /**
   * Emergency withdrawal (requires emergency admin)
   * 
   * @param asset Asset to withdraw
   * @param amount Amount to withdraw
   * @param to Address to withdraw to
   * @param reason Reason for emergency withdrawal
   */
  public async emergencyWithdraw(
    asset: Asset,
    amount: bigint,
    to: string,
    reason: string
  ): Promise<TransactionResponse> {
    try {
      // Build calldata for emergencyWithdraw function
      const data = this.encodeFunction(
        'emergencyWithdraw(address,uint256,address,string)',
        ['address', 'uint256', 'address', 'string'],
        [
          asset.isNative ? '0x0000000000000000000000000000000000000000' : asset.address,
          amount.toString(),
          to,
          reason
        ]
      );
      
      // Send transaction
      const response = await this.sendTransaction(data, 'emergencyWithdraw');
      
      // Update local state
      const treasuryAsset = this.assets.get(asset.symbol);
      if (treasuryAsset) {
        treasuryAsset.balance -= amount;
        treasuryAsset.lastUpdated = Date.now();
      }
      
      // Emit event
      this.eventEmitter.emit('treasury:emergency_withdraw', {
        chainId: this.config.chainId,
        asset: asset.symbol,
        amount: amount.toString(),
        to,
        reason,
        txHash: response.hash,
        timestamp: Date.now()
      });
      
      return response;
    } catch (error) {
      console.error(`Failed to emergency withdraw ${asset.symbol}:`, error);
      throw error;
    }
  }
  
  /**
   * Execute a rebalance of assets according to the allocation strategy
   */
  public async executeRebalance(): Promise<TransactionResponse> {
    try {
      if (!this.config.rebalancingEnabled) {
        throw new Error('Rebalancing is not enabled');
      }
      
      if (!this.config.allocationStrategy) {
        throw new Error('No allocation strategy defined');
      }
      
      // Build calldata for executeRebalance function
      const data = this.encodeFunction(
        'executeRebalance()',
        [],
        []
      );
      
      // Send transaction
      const response = await this.sendTransaction(data, 'executeRebalance');
      
      // Refresh assets after rebalancing
      await this.refreshAssets();
      
      // Emit event
      this.eventEmitter.emit('treasury:rebalance', {
        chainId: this.config.chainId,
        strategyId: this.config.allocationStrategy.id,
        txHash: response.hash,
        timestamp: Date.now()
      });
      
      return response;
    } catch (error) {
      console.error('Failed to execute rebalance:', error);
      throw error;
    }
  }
  
  /**
   * Transfer assets between chains (cross-chain operation)
   * 
   * @param asset Asset to transfer
   * @param amount Amount to transfer
   * @param targetChainId Target chain ID
   * @param targetTreasuryAddress Target treasury address
   */
  public async transferCrossChain(
    asset: Asset,
    amount: bigint,
    targetChainId: ChainId,
    targetTreasuryAddress: string
  ): Promise<TransactionResponse> {
    try {
      // Build calldata for transferCrossChain function
      const data = this.encodeFunction(
        'transferCrossChain(address,uint256,uint256,address)',
        ['address', 'uint256', 'uint256', 'address'],
        [
          asset.isNative ? '0x0000000000000000000000000000000000000000' : asset.address,
          amount.toString(),
          targetChainId.toString(),
          targetTreasuryAddress
        ]
      );
      
      // Send transaction
      const response = await this.sendTransaction(data, 'transferCrossChain');
      
      // Update local state
      const treasuryAsset = this.assets.get(asset.symbol);
      if (treasuryAsset) {
        treasuryAsset.balance -= amount;
        treasuryAsset.lastUpdated = Date.now();
      }
      
      // Emit event
      this.eventEmitter.emit('treasury:cross_chain_transfer', {
        sourceChainId: this.config.chainId,
        targetChainId,
        asset: asset.symbol,
        amount: amount.toString(),
        targetAddress: targetTreasuryAddress,
        txHash: response.hash,
        timestamp: Date.now()
      });
      
      return response;
    } catch (error) {
      console.error(`Failed to transfer ${asset.symbol} cross-chain:`, error);
      throw error;
    }
  }
  
  /**
   * Update the configuration
   * 
   * @param config New configuration
   */
  public updateConfig(config: Partial<TreasuryContractConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * Helper function to encode function call data
   * 
   * @param signature Function signature
   * @param types Parameter types
   * @param values Parameter values
   * @returns Encoded function data
   */
  private encodeFunction(
    signature: string,
    types: string[],
    values: any[]
  ): string {
    // This is a placeholder for actual ABI encoding
    // In a real implementation, this would use ethers.js or a similar library
    
    // Example implementation with ethers would be:
    // const iface = new ethers.utils.Interface([`function ${signature}`]);
    // return iface.encodeFunctionData(signature.split('(')[0], values);
    
    // For now, return a dummy value
    return '0x';
  }
  
  /**
   * Helper function to send a transaction to the contract
   * 
   * @param data Transaction data
   * @param methodName Name of the method being called (for logging)
   * @returns Transaction response
   */
  private async sendTransaction(data: string, methodName: string): Promise<TransactionResponse> {
    try {
      // Create the transaction request
      const tx = {
        to: this.config.contractAddress,
        data
      };
      
      // Send the transaction
      const response = await this.adapter.sendTransaction(tx);
      
      // Log the event
      this.eventEmitter.emit('treasury:transaction', {
        chainId: this.config.chainId,
        contractAddress: this.config.contractAddress,
        method: methodName,
        txHash: response.hash,
        timestamp: Date.now()
      });
      
      return response;
    } catch (error) {
      console.error(`Error sending ${methodName} transaction:`, error);
      throw error;
    }
  }
  
  /**
   * Wait for a transaction to be confirmed
   * 
   * @param txHash Transaction hash
   * @param confirmations Number of confirmations to wait for
   * @returns Transaction receipt
   */
  public async waitForTransaction(txHash: string, confirmations: number = 1): Promise<TransactionReceipt> {
    // Check transaction status until confirmed
    while (true) {
      const status = await this.adapter.getTransactionStatus(txHash);
      
      if (status.status === 'confirmed' && status.confirmations && status.confirmations >= confirmations) {
        return status.receipt as TransactionReceipt;
      }
      
      if (status.status === 'failed') {
        throw new Error(`Transaction ${txHash} failed`);
      }
      
      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
} 