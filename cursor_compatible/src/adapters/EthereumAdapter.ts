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

// Fix for AssetInfo errors property issue
interface AssetInfoWithErrors extends AssetInfo {
  errors?: string[];
}

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

/**
 * Configuration for Ethereum adapter
 */
export interface EthereumAdapterConfig extends ChainAdapterConfig {
  // Ethereum-specific configuration
  eip1559Support?: boolean;
  feeHistory?: {
    blocks: number;
    percentiles: number[];
  };
  priorityFeeCap?: string;
  maxFeePerGas?: string;
  // Uniswap router addresses
  uniswapV2RouterAddress?: string;
  uniswapV3RouterAddress?: string;
  // Flashbots specific configuration
  flashbotsRelayUrl?: string;
  flashbotsAuthSigner?: string;
}

/**
 * Ethereum adapter implementation
 * 
 * Provides functionality to interact with the Ethereum network using ethers.js
 */
export class EthereumAdapter extends BaseChainAdapter {
  // Default Ethereum constants
  private static readonly DEFAULT_CHAIN_ID = 1; // Ethereum Mainnet
  private static readonly DEFAULT_TESTNET_CHAIN_ID = 5; // Goerli Testnet
  private static readonly DEFAULT_MAINNET_RPC = 'https://eth-mainnet.g.alchemy.com/v2/demo';
  private static readonly DEFAULT_TESTNET_RPC = 'https://eth-goerli.g.alchemy.com/v2/demo';
  
  // Ethers.js client objects
  private provider!: ethers.JsonRpcProvider;
  private flashbotsProvider?: any; // Flashbots provider if enabled
  
  // Cache for contract instances
  private contractCache: Map<string, ethers.Contract> = new Map();
  
  // Track current block number
  private currentBlockNumber?: number;
  
  // Watch interval for new blocks
  private blockWatchInterval?: NodeJS.Timeout;
  
  // Token price cache
  private tokenPriceCache: Map<string, { price: number, timestamp: number }> = new Map();
  
  /**
   * Constructor for Ethereum adapter
   * @param config Optional configuration
   */
  constructor(config?: Partial<EthereumAdapterConfig>) {
    super({
      chainId: EthereumAdapter.DEFAULT_CHAIN_ID,
      networkName: 'Ethereum Mainnet',
      rpcUrl: EthereumAdapter.DEFAULT_MAINNET_RPC,
      isMainnet: true,
      blockExplorerUrl: 'https://etherscan.io',
      ...config
    });
    
    this._name = 'EthereumAdapter';
    this._version = '1.0.0';
    
    // Add Ethereum-specific capabilities
    this.addCapability(AdapterCapability.BALANCE_QUERY);
    this.addCapability(AdapterCapability.TRADE_EXECUTION);
    this.addCapability(AdapterCapability.QUOTE);
    this.addCapability(AdapterCapability.TRANSACTION_STATUS);
    this.addCapability(AdapterCapability.GAS_ESTIMATION);
    this.addCapability(AdapterCapability.TOKEN_METADATA);
  }
  
  /**
   * Ethereum-specific initialization
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
      
    } catch (error) {
      throw new Error(`Failed to initialize Ethereum adapter: ${error instanceof Error ? error.message : String(error)}`);
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
    }, 15000); // Check every 15 seconds
  }
  
  /**
   * Connect to Ethereum network
   */
  protected async connectImpl(): Promise<void> {
    try {
      // Get current block number to verify connection
      const blockNumber = await this.provider.getBlockNumber();
      this.currentBlockNumber = blockNumber;
      this._lastBlockHeight = blockNumber;
      
      // Get network information
      const network = await this.provider.getNetwork();
      console.log(`Connected to Ethereum network: ${network.name} (Chain ID: ${network.chainId})`);
      
    } catch (error) {
      throw new Error(`Failed to connect to Ethereum network: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Disconnect from Ethereum network
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
    this.tokenPriceCache.clear();
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
   * Get Ethereum-specific status
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
        gasPrice: gasPrice.gasPrice ? ethers.formatUnits(gasPrice.gasPrice, 'gwei') + ' gwei' : undefined,
        baseFeePerGas,
        syncStatus: 'synced', // Assume synced since most providers are fully synced
        pendingTransactions: 0, // Would need mempool access to get this accurately
        metadata: {
          networkUtilization: 'unknown', // Would need additional API access
          maxFeePerGas: gasPrice.maxFeePerGas ? ethers.formatUnits(gasPrice.maxFeePerGas, 'gwei') + ' gwei' : undefined,
          maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas ? ethers.formatUnits(gasPrice.maxPriorityFeePerGas, 'gwei') + ' gwei' : undefined,
          eip1559Support: !!gasPrice.maxFeePerGas
        }
      };
    } catch (error) {
      return {
        errors: [`Failed to get status: ${error instanceof Error ? error.message : String(error)}`]
      };
    }
  }
  
  /**
   * Get balance for address and asset on Ethereum
   */
  public async getBalance(address: string, asset?: Asset): Promise<string> {
    try {
      // For native ETH
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
      
      throw new Error('Asset must have an address if not native ETH');
    } catch (error) {
      throw new Error(`Failed to get balance: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Execute a trade on Ethereum
   */
  public async executeTrade(order: TradeOrder): Promise<TradeResult> {
    try {
      // This is a placeholder for the actual implementation
      // A real implementation would:
      // 1. Determine the right DEX to use (Uniswap, Sushiswap, etc.)
      // 2. Create the appropriate transaction
      // 3. Estimate gas and set fees
      // 4. Submit the transaction (with MEV protection if enabled)
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
        executionPrice: '1850.25', // Mock price
        amountOut: '0.92', // Mock amount out
        fees: {
          networkFee: '0.005',
          protocolFee: '0.001'
        },
        timestamp: Date.now(),
        mevProtectionApplied: order.mevProtection
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
   * Get a quote for a potential trade on Ethereum
   */
  public async getQuote(fromAsset: Asset, toAsset: Asset, amount: string): Promise<{
    expectedOutput: string;
    priceImpact: number;
    route?: string[];
  }> {
    try {
      // This is a placeholder for the actual implementation
      // A real implementation would:
      // 1. Query the appropriate DEX for a quote
      // 2. Calculate price impact
      // 3. Find the optimal route if multiple DEXes are available
      
      // For now, return mock data
      return {
        expectedOutput: '0.92',
        priceImpact: 0.15,
        route: ['Uniswap V3']
      };
    } catch (error) {
      throw new Error(`Failed to get quote: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get the transaction status on Ethereum
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
      // For native ETH
      if (asset.isNative) {
        return {
          ...asset,
          totalSupply: 'N/A', // Infinite/undefined for ETH
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
          verified: true, // Placeholder - would need to check with Etherscan or similar
          riskScore: 0 // Placeholder - would need risk assessment logic
        };
      }
      
      throw new Error('Asset must have an address if not native ETH');
    } catch (error) {
      // Fallback to basic asset info with errors field
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
          estimatedTimeMs: 120000 // 2 minutes
        },
        average: {
          estimatedTimeMs: 60000 // 1 minute
        },
        fast: {
          estimatedTimeMs: 30000 // 30 seconds
        },
        isEip1559Supported,
        lastUpdated: Date.now()
      };
      
      // For EIP-1559
      if (isEip1559Supported && feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        // Use nullish coalescing to handle possibly undefined value
        const baseFee = feeData.lastBaseFeePerGas ?? 0n;
        
        // Set base fee
        result.baseFee = ethers.formatUnits(baseFee, 'gwei');
        
        // Calculate fee estimates (simplified approach)
        // This would ideally query a gas price oracle for more accuracy
        const lowPriority = feeData.maxPriorityFeePerGas * 80n / 100n;
        const highPriority = feeData.maxPriorityFeePerGas * 150n / 100n;
        
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
        const highGas = feeData.gasPrice * 130n / 100n;
        
        result.slow.gasPrice = ethers.formatUnits(lowGas, 'gwei');
        result.average.gasPrice = ethers.formatUnits(feeData.gasPrice, 'gwei');
        result.fast.gasPrice = ethers.formatUnits(highGas, 'gwei');
      }
      
      return result;
    } catch (error) {
      // Fallback to a basic estimate
      return {
        slow: {
          gasPrice: '20',
          estimatedTimeMs: 120000
        },
        average: {
          gasPrice: '25',
          estimatedTimeMs: 60000
        },
        fast: {
          gasPrice: '30',
          estimatedTimeMs: 30000
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
      
      // Apply gas multiplier for safety margin
      const gasMultiplier = this.config.gasMultiplier || 1.1; // Default to 1.1 if undefined
      const multipliedGas = estimate * BigInt(Math.floor(gasMultiplier * 100)) / 100n;
      
      return multipliedGas.toString();
    } catch (error) {
      throw new Error(`Failed to estimate gas: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Configure MEV protection
   */
  protected async configureMevProtectionImpl(config: MevProtectionConfig): Promise<void> {
    if (!config.enabled) {
      this._mevProtectionEnabled = false;
      return;
    }
    
    try {
      if (config.useFlashbots) {
        // This is a placeholder for actual Flashbots integration
        // In a real implementation, we would:
        // 1. Import the @flashbots/ethers-provider-bundle package
        // 2. Create a Flashbots provider
        // 3. Connect it to the relay
        
        // Mock implementation for now
        this.flashbotsProvider = {
          sendBundle: async (bundle: any) => {
            console.log('Sending bundle to Flashbots:', bundle);
            return { success: true };
          }
        };
        
        this._mevProtectionEnabled = true;
        this.addCapability(AdapterCapability.FLASHBOTS);
      } else if (config.providerUrl) {
        // Use MEV-protected RPC
        this.provider = new ethers.JsonRpcProvider(config.providerUrl, this.config.chainId);
        this._mevProtectionEnabled = true;
      } else {
        throw new Error('MEV protection requires either Flashbots or a protected RPC URL');
      }
    } catch (error) {
      throw new Error(`Failed to configure MEV protection: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Calculate block delay
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
      if (mevProtection && this._mevProtectionEnabled && this.flashbotsProvider) {
        // This is a placeholder for actual Flashbots submission
        // In a real implementation, we would:
        // 1. Create a bundle with the signed transaction
        // 2. Submit it via the Flashbots provider
        
        // For now, just log and use regular submission
        console.log('Would submit via Flashbots, but using regular submission for demo');
      }
      
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
    this.tokenPriceCache.clear();
    
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