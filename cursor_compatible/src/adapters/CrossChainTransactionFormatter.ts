/**
 * CrossChainTransactionFormatter - Normalizes transaction formats across different blockchains
 * 
 * This utility provides consistent transaction formatting across different chains,
 * ensuring that trade requests and transaction data are properly formatted for
 * each specific blockchain implementation.
 */

import { TradeRequest, TransactionRequest, Asset, ChainId, TransactionOptions,
         TradeOptions } from './IChainAdapter';

// Declare ethers interface to avoid direct dependency
declare const ethers: {
  parseUnits: (value: string, decimals: number) => bigint;
  formatUnits: (value: bigint, decimals: number) => string;
};

/**
 * Chain-specific asset information
 */
export interface ChainAssetInfo {
  chainId: number;
  nativeSymbol: string;
  nativeDecimals: number;
  wrappedNativeAddress?: string;
  multicallAddress?: string;
  gasToken?: {
    symbol: string;
    address: string;
    decimals: number;
  };
}

/**
 * Cross-chain asset identifier
 */
export interface CrossChainAsset {
  symbol: string;
  name?: string;
  logoURI?: string;
  addresses: {
    [chainId: number]: string;
  };
  decimals: {
    [chainId: number]: number;
  };
  isNative?: boolean;
}

/**
 * Configuration for the transaction formatter
 */
export interface TransactionFormatterConfig {
  chainConfigs: ChainAssetInfo[];
  crossChainAssets?: CrossChainAsset[];
}

/**
 * CrossChainTransactionFormatter implementation
 */
export class CrossChainTransactionFormatter {
  // Chain-specific configuration
  private chainConfigs: Map<number, ChainAssetInfo> = new Map();
  
  // Cross-chain asset registry
  private assetRegistry: Map<string, CrossChainAsset> = new Map();
  
  /**
   * Constructor for the transaction formatter
   * @param config Formatter configuration
   */
  constructor(config: TransactionFormatterConfig) {
    // Initialize chain configs
    for (const chainConfig of config.chainConfigs) {
      this.chainConfigs.set(chainConfig.chainId, chainConfig);
    }
    
    // Initialize asset registry if provided
    if (config.crossChainAssets) {
      for (const asset of config.crossChainAssets) {
        this.assetRegistry.set(asset.symbol.toUpperCase(), asset);
        
        // Also index by addresses for lookup
        for (const [chainId, address] of Object.entries(asset.addresses)) {
          const key = `${chainId}:${address.toLowerCase()}`;
          this.assetRegistry.set(key, asset);
        }
      }
    }
  }
  
  /**
   * Get chain configuration for a specific chain ID
   * @param chainId Blockchain chain ID
   * @returns Chain configuration
   */
  public getChainConfig(chainId: number): ChainAssetInfo {
    const config = this.chainConfigs.get(chainId);
    
    if (!config) {
      throw new Error(`No configuration found for chain ID ${chainId}`);
    }
    
    return config;
  }
  
  /**
   * Get asset information by symbol and chain ID
   * @param symbol Asset symbol
   * @param chainId Blockchain chain ID
   * @returns Asset for the specified chain
   */
  public getAssetForChain(symbol: string, chainId: number): Asset {
    const crossChainAsset = this.assetRegistry.get(symbol.toUpperCase());
    
    if (!crossChainAsset) {
      throw new Error(`Asset ${symbol} not found in registry`);
    }
    
    if (!crossChainAsset.addresses[chainId] && !crossChainAsset.isNative) {
      throw new Error(`Asset ${symbol} not available on chain ID ${chainId}`);
    }
    
    const chainConfig = this.getChainConfig(chainId);
    
    // For native assets, use the chain's native token info
    if (crossChainAsset.isNative || symbol.toUpperCase() === chainConfig.nativeSymbol) {
      return {
        symbol: chainConfig.nativeSymbol,
        name: crossChainAsset.name || chainConfig.nativeSymbol,
        decimals: chainConfig.nativeDecimals,
        chainId,
        isNative: true,
        logoURI: crossChainAsset.logoURI
      };
    }
    
    // For non-native tokens
    return {
      symbol: crossChainAsset.symbol,
      name: crossChainAsset.name || crossChainAsset.symbol,
      decimals: crossChainAsset.decimals[chainId],
      chainId,
      address: crossChainAsset.addresses[chainId],
      isNative: false,
      logoURI: crossChainAsset.logoURI
    };
  }
  
  /**
   * Get asset by address on a specific chain
   * @param address Token address
   * @param chainId Blockchain chain ID
   * @returns Asset information if found
   */
  public getAssetByAddress(address: string, chainId: number): Asset | null {
    const key = `${chainId}:${address.toLowerCase()}`;
    const crossChainAsset = this.assetRegistry.get(key);
    
    if (!crossChainAsset) {
      return null;
    }
    
    return {
      symbol: crossChainAsset.symbol,
      name: crossChainAsset.name || crossChainAsset.symbol,
      decimals: crossChainAsset.decimals[chainId],
      chainId,
      address: address,
      isNative: false,
      logoURI: crossChainAsset.logoURI
    };
  }
  
  /**
   * Format amount based on asset decimals
   * @param amount Amount as string, number, or bigint
   * @param asset Asset information
   * @returns Amount as bigint with proper decimals
   */
  public formatAmount(amount: string | number | bigint, asset: Asset): bigint {
    if (typeof amount === 'bigint') {
      return amount;
    }
    
    const amountStr = typeof amount === 'number' ? amount.toString() : amount;
    return ethers.parseUnits(amountStr, asset.decimals);
  }
  
  /**
   * Parse amount from bigint to human-readable format
   * @param amount Amount as bigint
   * @param asset Asset information
   * @returns Human-readable amount as string
   */
  public parseAmount(amount: bigint, asset: Asset): string {
    return ethers.formatUnits(amount, asset.decimals);
  }
  
  /**
   * Format a trade request for the specified chain
   * @param request The original trade request
   * @param chainId The target chain ID
   * @returns A formatted trade request for the specified chain
   */
  public formatTradeRequest(request: TradeRequest & { inputAmount?: string }, chainId: number): TradeRequest & { inputAmount?: string } {
    // Create a copy of the request to avoid modifying the original
    const formattedRequest = { ...request };
    
    // Format the assets for the target chain
    if (formattedRequest.fromAsset) {
      formattedRequest.fromAsset = this.getAssetForChain(
        formattedRequest.fromAsset.symbol,
        chainId
      );
    }
    
    if (formattedRequest.toAsset) {
      formattedRequest.toAsset = this.getAssetForChain(
        formattedRequest.toAsset.symbol,
        chainId
      );
    }
    
    // Format amounts based on chain-specific decimals
    if (request.inputAmount) {
      formattedRequest.inputAmount = this.formatAmount(
        request.inputAmount, 
        formattedRequest.fromAsset
      ).toString();
    }
    
    if (formattedRequest.amount) {
      formattedRequest.amount = this.formatAmount(
        formattedRequest.amount,
        formattedRequest.fromAsset
      ).toString();
    }
    
    if (formattedRequest.expectedOutput) {
      formattedRequest.expectedOutput = this.formatAmount(
        formattedRequest.expectedOutput,
        formattedRequest.toAsset
      ).toString();
    }
    
    if (formattedRequest.minOutput) {
      formattedRequest.minOutput = this.formatAmount(
        formattedRequest.minOutput,
        formattedRequest.toAsset
      ).toString();
    }
    
    // Format contract address if using a different address on the target chain
    if (formattedRequest.contractAddress) {
      // Check if we need to replace the contract address for this chain
      // This would typically be done if DEXes have different router addresses per chain
      // For now, we'll leave it as is, but this could be enhanced with a contract registry
    }
    
    // Add any chain-specific parameters
    // ...
    
    // Return the formatted request
    return formattedRequest;
  }
  
  /**
   * Format a transaction request for a specific chain
   * @param transaction Transaction request
   * @param chainId Target chain ID
   * @returns Transaction request formatted for the specified chain
   */
  public formatTransactionRequest(
    transaction: TransactionRequest,
    chainId: number
  ): TransactionRequest {
    // Start with a copy of the original transaction
    const formattedTx: TransactionRequest = { ...transaction };
    
    // Format value if present
    if (formattedTx.value && (typeof formattedTx.value === 'string' || typeof formattedTx.value === 'number')) {
      // Get native asset info
      const chainConfig = this.getChainConfig(chainId);
      const nativeAsset: Asset = {
        symbol: chainConfig.nativeSymbol,
        name: chainConfig.nativeSymbol,
        decimals: chainConfig.nativeDecimals,
        chainId,
        isNative: true
      };
      
      formattedTx.value = this.formatAmount(formattedTx.value, nativeAsset);
    }
    
    // Handle chain-specific gas parameters
    if (chainId === ChainId.ETHEREUM || 
        chainId === ChainId.POLYGON || 
        chainId === ChainId.OPTIMISM || 
        chainId === ChainId.BASE) {
      // These chains support EIP-1559, so we preserve maxFeePerGas and maxPriorityFeePerGas
    } else if (chainId === ChainId.ARBITRUM) {
      // Arbitrum uses custom gas parameters
      // Convert maxFeePerGas to gasPrice if present
      if (formattedTx.maxFeePerGas && !formattedTx.gasPrice) {
        formattedTx.gasPrice = formattedTx.maxFeePerGas;
        delete formattedTx.maxFeePerGas;
        delete formattedTx.maxPriorityFeePerGas;
      }
    } else {
      // For other chains like BSC and Avalanche, use only gasPrice
      if (formattedTx.maxFeePerGas && !formattedTx.gasPrice) {
        formattedTx.gasPrice = formattedTx.maxFeePerGas;
        delete formattedTx.maxFeePerGas;
        delete formattedTx.maxPriorityFeePerGas;
      }
    }
    
    return formattedTx;
  }
  
  /**
   * Format transaction options for a specific chain
   * @param options Transaction options
   * @param chainId Target chain ID
   * @returns Options formatted for the specified chain
   */
  public formatTransactionOptions(
    options: TransactionOptions,
    chainId: number
  ): TransactionOptions {
    // Start with a copy of the original options
    const formattedOptions: TransactionOptions = { ...options };
    
    // Format nonce if needed
    if (formattedOptions.nonce !== undefined && typeof formattedOptions.nonce === 'string') {
      formattedOptions.nonce = parseInt(formattedOptions.nonce, 10);
    }
    
    // Format gas price if needed
    if (formattedOptions.gasPrice && (typeof formattedOptions.gasPrice === 'string' || typeof formattedOptions.gasPrice === 'number')) {
      formattedOptions.gasPrice = BigInt(formattedOptions.gasPrice);
    }
    
    return formattedOptions;
  }
  
  /**
   * Format trade options for a specific chain
   * @param options Trade options
   * @param chainId Target chain ID
   * @returns Options formatted for the specified chain
   */
  public formatTradeOptions(
    options: TradeOptions,
    chainId: number
  ): TradeOptions {
    // Start with base transaction options formatting
    const formattedOptions = this.formatTransactionOptions(options, chainId) as TradeOptions;
    
    // Format slippage tolerance if needed
    if (formattedOptions.slippageTolerance !== undefined && typeof formattedOptions.slippageTolerance === 'string') {
      formattedOptions.slippageTolerance = parseFloat(formattedOptions.slippageTolerance);
    }
    
    // Format deadline if needed (convert seconds to timestamp)
    if (formattedOptions.deadline !== undefined && typeof formattedOptions.deadline === 'number' && formattedOptions.deadline < 10000) {
      // If deadline is a small number, interpret as minutes and convert to timestamp
      formattedOptions.deadline = Math.floor(Date.now() / 1000) + formattedOptions.deadline * 60;
    }
    
    return formattedOptions;
  }
  
  /**
   * Add a new cross-chain asset to the registry
   * @param asset Cross-chain asset information
   */
  public addCrossChainAsset(asset: CrossChainAsset): void {
    this.assetRegistry.set(asset.symbol.toUpperCase(), asset);
    
    // Also index by addresses for lookup
    for (const [chainId, address] of Object.entries(asset.addresses)) {
      const key = `${chainId}:${address.toLowerCase()}`;
      this.assetRegistry.set(key, asset);
    }
  }
  
  /**
   * Extract calldata from a transaction for cross-chain use
   * @param transaction Original transaction request
   * @returns Extracted call data and parameters
   */
  public extractCallData(transaction: TransactionRequest): {
    to: string;
    data: string;
    value: bigint;
    gasLimit?: bigint;
  } {
    if (!transaction.to) {
      throw new Error("Transaction must have a 'to' address for calldata extraction");
    }
    
    return {
      to: transaction.to.toString(),
      data: transaction.data?.toString() || '0x',
      value: transaction.value || BigInt(0),
      gasLimit: transaction.gasLimit
    };
  }
  
  /**
   * Create a unified swap calldata that works across chains
   * @param fromAsset Source asset
   * @param toAsset Destination asset
   * @param amount Amount to swap
   * @param slippage Slippage tolerance percentage
   * @param recipient Recipient address (defaults to sender)
   * @returns Call data formatted for the specified chain
   */
  public createUnifiedSwapCallData(
    fromAsset: Asset,
    toAsset: Asset,
    amount: string | bigint,
    slippage: number,
    recipient?: string
  ): {
    to: string;
    data: string;
    value: bigint;
  } {
    // This is a placeholder implementation
    // In a real system, you would need chain-specific DEX router addresses and ABIs
    
    throw new Error("createUnifiedSwapCallData is not implemented");
  }
} 