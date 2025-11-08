// @ts-ignore
import { ethers } from 'ethers';
import { BaseChainAdapter, ChainAdapterConfig } from './BaseChainAdapter';
import { 
  Asset, 
  ChainAdapterStatus, 
  TradeOrder, 
  TradeResult,
  GasEstimate,
  AssetInfo,
  MevProtectionConfig,
  TransactionReceipt,
  ExecutionStrategy
} from './IChainAdapter';
import { AdapterCapability } from './IAdapter';

// Avalanche-specific constants
const AVALANCHE_C_CHAIN_ID = 43114;
const AVALANCHE_TESTNET_CHAIN_ID = 43113;
const AVALANCHE_C_CHAIN_NAME = 'Avalanche C-Chain';
const AVALANCHE_TESTNET_NAME = 'Avalanche Fuji';

// Gas price defaults for Avalanche (typically much lower than Ethereum)
const DEFAULT_GAS_PRICE = '25';
const DEFAULT_MAX_FEE = '30';
const DEFAULT_MAX_PRIORITY_FEE = '2';

// Default RPC endpoints
const AVALANCHE_MAINNET_RPC = 'https://api.avax.network/ext/bc/C/rpc';
const AVALANCHE_TESTNET_RPC = 'https://api.avax-test.network/ext/bc/C/rpc';

// Standard ERC20 ABI for basic token interactions
const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint amount) returns (bool)',
  'function transferFrom(address from, address to, uint amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint amount)',
  'event Approval(address indexed owner, address indexed spender, uint amount)'
];

// Interface for AssetInfo with errors field
interface AssetInfoWithErrors extends AssetInfo {
  errors?: string[];
}

/**
 * Configuration for Avalanche adapter
 */
export interface AvalancheAdapterConfig extends ChainAdapterConfig {
  // Avalanche-specific configuration
  subnetID?: string; // Optional subnet ID for subnet deployments
  delegationFee?: number; // For staking/delegation operations
  useTraderJoeRouter?: boolean; // Whether to use TraderJoe as primary DEX
  joeRouterAddress?: string; // TraderJoe router address
  pangolinRouterAddress?: string; // Pangolin router address
  useAvalancheGasEstimator?: boolean; // Use Avalanche-specific gas estimation
}

/**
 * Avalanche adapter implementation
 * 
 * Provides functionality to interact with the Avalanche C-Chain
 */
export class AvalancheAdapter extends BaseChainAdapter {
  // Ethers.js client objects
  private provider!: ethers.JsonRpcProvider;
  
  // Cache for contract instances
  private contractCache: Map<string, ethers.Contract> = new Map();
  
  // Track current block number
  private currentBlockNumber?: number;
  
  // Watch interval for new blocks
  private blockWatchInterval?: NodeJS.Timeout;
  
  // Primary DEX router addresses
  private primaryDexRouterAddress: string;
  private secondaryDexRouterAddress: string;
  
  /**
   * Constructor for Avalanche adapter
   * @param config Optional configuration
   */
  constructor(config?: Partial<AvalancheAdapterConfig>) {
    super({
      chainId: AVALANCHE_C_CHAIN_ID,
      networkName: AVALANCHE_C_CHAIN_NAME,
      rpcUrl: AVALANCHE_MAINNET_RPC,
      isMainnet: true,
      blockExplorerUrl: 'https://snowtrace.io',
      gasMultiplier: 1.2, // Higher for Avalanche to handle volatility
      ...config
    });
    
    this._name = 'AvalancheAdapter';
    this._version = '1.0.0';
    
    // Set default DEX router addresses
    this.primaryDexRouterAddress = 
      (config as AvalancheAdapterConfig)?.joeRouterAddress || 
      '0x60aE616a2155Ee3d9A68541Ba4544862310933d4'; // TraderJoe router
    
    this.secondaryDexRouterAddress = 
      (config as AvalancheAdapterConfig)?.pangolinRouterAddress || 
      '0xE54Ca86531e17Ef3616d22Ca28b0D458b6C89106'; // Pangolin router
    
    // Add Avalanche-specific capabilities
    this.addCapability(AdapterCapability.BALANCE_QUERY);
    this.addCapability(AdapterCapability.TRADE_EXECUTION);
    this.addCapability(AdapterCapability.QUOTE);
    this.addCapability(AdapterCapability.TRANSACTION_STATUS);
    this.addCapability(AdapterCapability.GAS_ESTIMATION);
    this.addCapability(AdapterCapability.TOKEN_METADATA);
  }
  
  /**
   * Avalanche-specific initialization
   */
  protected async initializeImpl(): Promise<void> {
    // Initialize ethers provider
    this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl, this.config.chainId);
    
    try {
      // Check connection by getting the network
      const network = await this.provider.getNetwork();
      
      // Verify chain ID matches config
      const providedChainId = Number(network.chainId);
      if (providedChainId !== this.config.chainId) {
        throw new Error(`Chain ID mismatch: config=${this.config.chainId}, provider=${providedChainId}`);
      }
      
      // Setup event listener for new blocks
      this.provider.on('block', this.handleNewBlock.bind(this));
      
      // Start block watch interval as a fallback
      this.startBlockWatcher();
      
      console.log(`Initialized Avalanche adapter for ${this.config.networkName} (Chain ID: ${this.config.chainId})`);
    } catch (error) {
      throw new Error(`Failed to initialize Avalanche adapter: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Handle new block event
   * @param blockNumber Block number
   */
  private handleNewBlock(blockNumber: number): void {
    this.currentBlockNumber = blockNumber;
    this._lastBlockHeight = blockNumber;
  }
  
  /**
   * Start watcher for new blocks (fallback for providers that don't support events)
   */
  private startBlockWatcher(): void {
    // Clear existing interval if any
    if (this.blockWatchInterval) {
      clearInterval(this.blockWatchInterval);
    }
    
    // Set up interval to check for new blocks
    this.blockWatchInterval = setInterval(async () => {
      try {
        const blockNumber = await this.provider.getBlockNumber();
        this.handleNewBlock(blockNumber);
      } catch (error) {
        // Log error but don't throw to prevent crashing the interval
        console.error('Error fetching block number:', error);
      }
    }, 10000); // Check every 10 seconds (faster than Ethereum)
  }
  
  /**
   * Connect to Avalanche network
   */
  protected async connectImpl(): Promise<void> {
    try {
      // Get current block number to verify connection
      const blockNumber = await this.provider.getBlockNumber();
      this.currentBlockNumber = blockNumber;
      this._lastBlockHeight = blockNumber;
      
      // Get network information
      const network = await this.provider.getNetwork();
      console.log(`Connected to Avalanche network: ${this.config.networkName} (Chain ID: ${network.chainId})`);
      
    } catch (error) {
      throw new Error(`Failed to connect to Avalanche network: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Disconnect from Avalanche network
   */
  protected async disconnectImpl(): Promise<void> {
    // Remove event listeners
    this.provider.removeAllListeners();
    
    // Clear block watcher interval
    if (this.blockWatchInterval) {
      clearInterval(this.blockWatchInterval);
      this.blockWatchInterval = undefined;
    }
    
    // Clear cache
    this.contractCache.clear();
  }
  
  /**
   * Shutdown adapter-specific resources
   */
  protected async shutdownImpl(): Promise<void> {
    // Disconnect from the network
    await this.disconnectImpl();
    
    // Close provider connection if possible
    if (typeof this.provider.destroy === 'function') {
      await this.provider.destroy();
    }
  }
  
  /**
   * Get Avalanche-specific status
   */
  protected async getStatusImpl(): Promise<Partial<ChainAdapterStatus>> {
    try {
      // Get current gas price
      const gasPrice = await this.provider.getFeeData();
      
      // Get block info
      const blockHeight = this.currentBlockNumber || await this.provider.getBlockNumber();
      
      let baseFeePerGas: string | undefined;
      if (gasPrice.lastBaseFeePerGas) {
        baseFeePerGas = ethers.formatUnits(gasPrice.lastBaseFeePerGas, 'gwei') + ' gwei';
      }
      
      return {
        blockHeight,
        gasPrice: gasPrice.gasPrice ? ethers.formatUnits(gasPrice.gasPrice, 'gwei') + ' gwei' : DEFAULT_GAS_PRICE + ' gwei',
        baseFeePerGas,
        syncStatus: 'synced', // Assume synced since most providers are fully synced
        metadata: {
          network: this.config.isMainnet ? 'mainnet' : 'testnet',
          maxFeePerGas: gasPrice.maxFeePerGas ? ethers.formatUnits(gasPrice.maxFeePerGas, 'gwei') + ' gwei' : undefined,
          primaryDex: (this.config as AvalancheAdapterConfig).useTraderJoeRouter !== false ? 'TraderJoe' : 'Pangolin',
          subnetID: (this.config as AvalancheAdapterConfig).subnetID
        }
      };
    } catch (error) {
      return {
        errors: [`Failed to get status: ${error instanceof Error ? error.message : String(error)}`]
      };
    }
  }
  
  /**
   * Get balance for address and asset on Avalanche
   */
  public async getBalance(address: string, asset?: Asset): Promise<string> {
    try {
      // For native AVAX
      if (!asset || asset.isNative) {
        const balance = await this.provider.getBalance(address);
        return ethers.formatEther(balance);
      }
      
      // For ERC20 tokens
      if (asset.address) {
        const tokenContract = this.getERC20Contract(asset.address);
        const balance = await tokenContract.balanceOf(address);
        return ethers.formatUnits(balance, asset.decimals);
      }
      
      throw new Error('Asset must have an address if not native AVAX');
    } catch (error) {
      throw new Error(`Failed to get balance: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Execute a trade on Avalanche
   */
  public async executeTrade(order: TradeOrder): Promise<TradeResult> {
    try {
      // This is a placeholder for the actual implementation
      // A real implementation would:
      // 1. Determine whether to use TraderJoe or Pangolin based on config and optimal price
      // 2. Create the appropriate transaction
      // 3. Estimate gas and set fees (typically lower on Avalanche)
      // 4. Submit the transaction
      // 5. Wait for confirmation and parse results
      
      // For now, we'll just simulate a successful trade
      const mockTxHash = '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
      
      return {
        success: true,
        order: {
          ...order,
          status: 'completed',
          txHash: mockTxHash
        },
        txHash: mockTxHash,
        blockNumber: this.currentBlockNumber,
        executionPrice: '42.75', // Mock price
        amountOut: '100.5', // Mock amount out
        fees: {
          networkFee: '0.002', // Typically lower on Avalanche
          protocolFee: '0.001'
        },
        timestamp: Date.now(),
        route: [(this.config as AvalancheAdapterConfig).useTraderJoeRouter !== false ? 'TraderJoe' : 'Pangolin']
      };
    } catch (error) {
      return {
        success: false,
        order: {
          ...order,
          status: 'failed'
        },
        failureReason: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      };
    }
  }
  
  /**
   * Get a quote for a potential trade on Avalanche
   */
  public async getQuote(fromAsset: Asset, toAsset: Asset, amount: string): Promise<{
    expectedOutput: string;
    priceImpact: number;
    route?: string[];
  }> {
    try {
      // This is a placeholder for the actual implementation
      // A real implementation would:
      // 1. Query TraderJoe and/or Pangolin for quotes
      // 2. Compare them to find the best rate
      // 3. Calculate price impact
      
      // For now, return mock data
      return {
        expectedOutput: '105.42',
        priceImpact: 0.12,
        route: [(this.config as AvalancheAdapterConfig).useTraderJoeRouter !== false ? 'TraderJoe' : 'Pangolin']
      };
    } catch (error) {
      throw new Error(`Failed to get quote: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get the transaction status on Avalanche
   */
  public async getTransactionStatus(txHash: string): Promise<{
    status: 'pending' | 'confirmed' | 'failed';
    confirmations?: number;
    receipt?: TransactionReceipt;
  }> {
    try {
      // Get transaction receipt
      const receipt = await this.provider.getTransactionReceipt(txHash);
      
      // If no receipt, transaction is pending
      if (!receipt) {
        return { status: 'pending' };
      }
      
      // Get current block for confirmations
      const currentBlock = this.currentBlockNumber || await this.provider.getBlockNumber();
      const confirmations = receipt.blockNumber ? currentBlock - receipt.blockNumber + 1 : 0;
      
      // Determine status from receipt
      const success = receipt.status === 1;
      
      // Create formatted receipt
      const formattedReceipt: TransactionReceipt = {
        txHash,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        from: receipt.from,
        to: receipt.to || '',
        status: success ? 'success' : 'failure',
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.gasPrice ? receipt.gasPrice.toString() : '0',
        logs: receipt.logs,
        confirmations,
        rawReceipt: receipt
      };
      
      // Get transaction timestamp if available
      try {
        const block = await this.provider.getBlock(receipt.blockHash);
        if (block && block.timestamp) {
          formattedReceipt.timestamp = Number(block.timestamp) * 1000; // Convert to milliseconds
        }
      } catch (error) {
        console.warn('Failed to get block timestamp:', error);
      }
      
      return {
        status: success ? 'confirmed' : 'failed',
        confirmations,
        receipt: formattedReceipt
      };
    } catch (error) {
      throw new Error(`Failed to get transaction status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get detailed information about an asset
   */
  public async getAssetInfo(asset: Asset): Promise<AssetInfoWithErrors> {
    try {
      // For native AVAX
      if (asset.isNative) {
        return {
          ...asset,
          totalSupply: 'N/A', // Variable for AVAX
          contractType: 'NATIVE',
          verified: true
        };
      }
      
      // For ERC20 tokens
      if (asset.address) {
        const tokenContract = this.getERC20Contract(asset.address);
        
        // Get token info
        const [totalSupply, name, symbol, decimals] = await Promise.all([
          tokenContract.totalSupply(),
          tokenContract.name(),
          tokenContract.symbol(),
          tokenContract.decimals()
        ]);
        
        return {
          ...asset,
          name: asset.name || name,
          symbol: asset.symbol || symbol,
          decimals: asset.decimals || decimals,
          totalSupply: ethers.formatUnits(totalSupply, decimals),
          contractType: 'ERC20',
          verified: true, // Placeholder - would need to check with Snowtrace or similar
          riskScore: 0 // Placeholder - would need risk assessment logic
        };
      }
      
      throw new Error('Asset must have an address if not native AVAX');
    } catch (error) {
      // Fallback to basic asset info
      return {
        ...asset,
        contractType: asset.isNative ? 'NATIVE' : 'ERC20',
        verified: false,
        riskScore: 50, // Medium risk for unknown tokens
        errors: [`Failed to get asset info: ${error instanceof Error ? error.message : String(error)}`]
      };
    }
  }
  
  /**
   * Get current gas price estimate
   * Avalanche typically has much lower gas prices than Ethereum
   */
  public async getGasPrice(): Promise<GasEstimate> {
    try {
      // Get fee data from provider
      const feeData = await this.provider.getFeeData();
      
      // Check if EIP-1559 is supported
      const isEip1559Supported = !!feeData.maxFeePerGas;
      
      // Initialize result
      const result: GasEstimate = {
        slow: {
          estimatedTimeMs: 6000 // 6 seconds for slow (Avalanche is fast)
        },
        average: {
          estimatedTimeMs: 3000 // 3 seconds for average
        },
        fast: {
          estimatedTimeMs: 1500 // 1.5 seconds for fast
        },
        isEip1559Supported,
        lastUpdated: Date.now()
      };
      
      // For EIP-1559
      if (isEip1559Supported && feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        const baseFee = feeData.lastBaseFeePerGas ?? 0n;
        
        // Set base fee
        result.baseFee = ethers.formatUnits(baseFee, 'gwei');
        
        // Calculate fee estimates
        const lowPriority = feeData.maxPriorityFeePerGas * 80n / 100n;
        const highPriority = feeData.maxPriorityFeePerGas * 120n / 100n;
        
        result.slow.maxPriorityFeePerGas = ethers.formatUnits(lowPriority, 'gwei');
        result.slow.maxFeePerGas = ethers.formatUnits(baseFee + lowPriority, 'gwei');
        
        result.average.maxPriorityFeePerGas = ethers.formatUnits(feeData.maxPriorityFeePerGas, 'gwei');
        result.average.maxFeePerGas = ethers.formatUnits(feeData.maxFeePerGas, 'gwei');
        
        result.fast.maxPriorityFeePerGas = ethers.formatUnits(highPriority, 'gwei');
        result.fast.maxFeePerGas = ethers.formatUnits(baseFee + highPriority, 'gwei');
      } 
      // For legacy gas pricing
      else if (feeData.gasPrice) {
        const lowGas = feeData.gasPrice * 80n / 100n;
        const highGas = feeData.gasPrice * 120n / 100n;
        
        result.slow.gasPrice = ethers.formatUnits(lowGas, 'gwei');
        result.average.gasPrice = ethers.formatUnits(feeData.gasPrice, 'gwei');
        result.fast.gasPrice = ethers.formatUnits(highGas, 'gwei');
      }
      // Fallback to default values
      else {
        result.slow.gasPrice = DEFAULT_GAS_PRICE;
        result.average.gasPrice = (Number(DEFAULT_GAS_PRICE) * 1.2).toString();
        result.fast.gasPrice = (Number(DEFAULT_GAS_PRICE) * 1.5).toString();
      }
      
      return result;
    } catch (error) {
      // Fallback to a basic estimate for Avalanche
      return {
        slow: {
          gasPrice: DEFAULT_GAS_PRICE,
          estimatedTimeMs: 6000
        },
        average: {
          gasPrice: (Number(DEFAULT_GAS_PRICE) * 1.2).toString(),
          estimatedTimeMs: 3000
        },
        fast: {
          gasPrice: (Number(DEFAULT_GAS_PRICE) * 1.5).toString(),
          estimatedTimeMs: 1500
        },
        isEip1559Supported: false,
        lastUpdated: Date.now()
      };
    }
  }
  
  /**
   * Estimate gas for a transaction
   */
  public async estimateGas(fromAddress: string, toAddress: string, data: string, value?: string): Promise<string> {
    try {
      const valueWei = value ? ethers.parseEther(value) : 0n;
      
      const estimate = await this.provider.estimateGas({
        from: fromAddress,
        to: toAddress,
        data,
        value: valueWei
      });
      
      // Apply gas multiplier - Avalanche can have higher variability
      const gasMultiplier = this.config.gasMultiplier || 1.2; // Default to 1.2 if undefined
      const multipliedGas = estimate * BigInt(Math.floor(gasMultiplier * 100)) / 100n;
      
      return multipliedGas.toString();
    } catch (error) {
      throw new Error(`Failed to estimate gas: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Configure MEV protection
   * Note: Avalanche has less MEV activity than Ethereum, but still needs protection
   */
  protected async configureMevProtectionImpl(config: MevProtectionConfig): Promise<void> {
    if (!config.enabled) {
      this._mevProtectionEnabled = false;
      return;
    }
    
    try {
      // For Avalanche, MEV protection primarily means using protected RPC
      if (config.providerUrl) {
        this.provider = new ethers.JsonRpcProvider(config.providerUrl, this.config.chainId);
        this._mevProtectionEnabled = true;
        console.log('Configured MEV protection for Avalanche using protected RPC');
      } else {
        throw new Error('MEV protection on Avalanche requires a protected RPC URL');
      }
    } catch (error) {
      throw new Error(`Failed to configure MEV protection: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Calculate block delay
   * Avalanche has much faster block times (~2 seconds) compared to Ethereum
   */
  protected async calculateBlockDelay(currentBlockHeight: number): Promise<number> {
    try {
      // Get the current block
      const currentBlock = await this.provider.getBlock(currentBlockHeight);
      
      // If no block, return default delay
      if (!currentBlock || !currentBlock.timestamp) {
        return 0;
      }
      
      // Calculate delay in seconds
      const blockTimestamp = Number(currentBlock.timestamp);
      const now = Math.floor(Date.now() / 1000);
      const delay = Math.max(0, now - blockTimestamp);
      
      return delay;
    } catch (error) {
      console.warn('Failed to calculate block delay:', error);
      return 0;
    }
  }
  
  /**
   * Submit a raw transaction
   */
  public async submitTransaction(signedTx: string, mevProtection: boolean = false): Promise<string> {
    try {
      // Avalanche doesn't need special handling like Flashbots
      // Just use the configured provider (which may be MEV-protected if set up)
      
      // Regular submission
      const txHash = await this.provider.broadcastTransaction(signedTx);
      return txHash;
    } catch (error) {
      throw new Error(`Failed to submit transaction: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Implementation-specific reset logic
   */
  protected async resetImpl(): Promise<void> {
    // Clear caches
    this.contractCache.clear();
    
    // Reset provider
    this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl, this.config.chainId);
    
    // Reset MEV protection if needed
    if (this.config.mevProtection?.enabled) {
      await this.configureMevProtection(this.config.mevProtection);
    }
  }
  
  /**
   * Get an ERC20 contract instance
   */
  private getERC20Contract(tokenAddress: string): ethers.Contract {
    // Check cache first
    const cachedContract = this.contractCache.get(tokenAddress);
    if (cachedContract) {
      return cachedContract;
    }
    
    // Create new contract
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    
    // Cache it
    this.contractCache.set(tokenAddress, contract);
    
    return contract;
  }
} 