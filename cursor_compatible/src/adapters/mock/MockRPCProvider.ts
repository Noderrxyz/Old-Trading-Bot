/**
 * Mock RPC Provider
 * 
 * Simulates blockchain RPC operations for paper trading mode.
 * Provides realistic blockchain behavior including gas estimation and transaction simulation.
 */

import { 
  IRPCProvider, 
  BlockInfo, 
  TransactionInfo, 
  TransactionReceipt, 
  LogEntry, 
  GasEstimate, 
  NetworkStatus, 
  ContractCallRequest, 
  ContractCallResult 
} from '../interfaces/IRPCProvider';
import { logPaperModeCall, getSimulationConfig } from '../../config/PaperModeConfig';
import { logger } from '../../utils/logger';

interface SimulatedAccount {
  address: string;
  balance: string; // in wei
  nonce: number;
  code?: string; // for contracts
  storage: Map<string, string>;
}

interface SimulatedTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  data: string;
  gas: number;
  gasPrice: number;
  nonce: number;
  blockNumber?: number;
  blockHash?: string;
  transactionIndex?: number;
  status?: number;
  gasUsed?: number;
  timestamp: number;
}

interface SimulatedBlock {
  number: number;
  hash: string;
  parentHash: string;
  timestamp: number;
  gasUsed: number;
  gasLimit: number;
  baseFeePerGas: number;
  transactions: string[]; // transaction hashes
  difficulty: string;
  totalDifficulty: string;
  nonce: string;
}

export class MockRPCProvider implements IRPCProvider {
  private providerId: string;
  private providerName: string;
  private chainId: number;
  private networkId: number;
  private connected: boolean = false;
  
  // Blockchain simulation state
  private accounts: Map<string, SimulatedAccount> = new Map();
  private transactions: Map<string, SimulatedTransaction> = new Map();
  private transactionReceipts: Map<string, TransactionReceipt> = new Map();
  private blocks: Map<number, SimulatedBlock> = new Map();
  private currentBlockNumber: number = 18500000; // Realistic block number
  private gasPrice: number = 20000000000; // 20 gwei
  private baseFeePerGas: number = 15000000000; // 15 gwei
  
  // Simulation timers
  private blockGenerationTimer?: NodeJS.Timeout;
  private transactionPoolTimer?: NodeJS.Timeout;
  
  // Transaction pool
  private pendingTransactions: Map<string, SimulatedTransaction> = new Map();
  private transactionCounter: number = 1;
  
  // Contract simulation
  private contractImplementations: Map<string, any> = new Map();
  
  // Oracle price feeds (for DeFi simulation)
  private priceFeeds: Map<string, number> = new Map([
    ['ETH/USD', 3000],
    ['BTC/USD', 45000],
    ['USDC/USD', 1.0001],
    ['DAI/USD', 0.9999],
    ['LINK/USD', 14.5],
    ['UNI/USD', 6.2]
  ]);

  constructor(
    providerId: string = 'mock_rpc',
    providerName: string = 'Mock RPC Provider',
    chainId: number = 1, // Ethereum mainnet
    networkId: number = 1
  ) {
    this.providerId = providerId;
    this.providerName = providerName;
    this.chainId = chainId;
    this.networkId = networkId;
    
    this.initializeAccounts();
    this.initializeBlocks();
    this.initializeContracts();
  }

  getProviderId(): string {
    return this.providerId;
  }

  getProviderName(): string {
    return this.providerName;
  }

  async getChainId(): Promise<number> {
    logPaperModeCall('MockRPCProvider', 'getChainId');
    await this.simulateLatency();
    return this.chainId;
  }

  async getNetworkId(): Promise<number> {
    logPaperModeCall('MockRPCProvider', 'getNetworkId');
    await this.simulateLatency();
    return this.networkId;
  }

  async connect(): Promise<boolean> {
    logPaperModeCall('MockRPCProvider', 'connect', { providerId: this.providerId });
    
    const config = getSimulationConfig();
    
    // Simulate connection latency
    const connectionLatency = config.networkLatency.min + 
      Math.random() * (config.networkLatency.max - config.networkLatency.min);
    await this.sleep(connectionLatency);
    
    // Simulate occasional connection failures
    if (Math.random() < config.failureRate * 0.05) { // Very low failure rate for RPC
      logger.warn(`[PAPER_MODE] Simulated RPC connection failure for ${this.providerId}`);
      return false;
    }
    
    this.connected = true;
    this.startBlockGeneration();
    
    logger.info(`[PAPER_MODE] Connected to ${this.providerName}`, {
      providerId: this.providerId,
      chainId: this.chainId,
      latency: connectionLatency
    });
    
    return true;
  }

  async disconnect(): Promise<void> {
    logPaperModeCall('MockRPCProvider', 'disconnect');
    
    this.connected = false;
    this.stopBlockGeneration();
    
    logger.info(`[PAPER_MODE] Disconnected from ${this.providerName}`);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getBlockNumber(): Promise<number> {
    logPaperModeCall('MockRPCProvider', 'getBlockNumber');
    
    this.ensureConnected();
    await this.simulateLatency();
    
    return this.currentBlockNumber;
  }

  async getBlock(blockNumber: number | 'latest' | 'pending'): Promise<BlockInfo> {
    logPaperModeCall('MockRPCProvider', 'getBlock', { blockNumber });
    
    this.ensureConnected();
    await this.simulateLatency();
    
    let targetBlockNumber: number;
    
    if (blockNumber === 'latest') {
      targetBlockNumber = this.currentBlockNumber;
    } else if (blockNumber === 'pending') {
      targetBlockNumber = this.currentBlockNumber + 1;
    } else {
      targetBlockNumber = blockNumber;
    }
    
    let block = this.blocks.get(targetBlockNumber);
    if (!block) {
      // Generate block if it doesn't exist
      block = this.generateBlock(targetBlockNumber);
      this.blocks.set(targetBlockNumber, block);
    }
    
    return {
      number: block.number,
      hash: block.hash,
      parentHash: block.parentHash,
      timestamp: block.timestamp,
      gasUsed: block.gasUsed,
      gasLimit: block.gasLimit,
      difficulty: block.difficulty,
      totalDifficulty: block.totalDifficulty,
      nonce: block.nonce,
      baseFeePerGas: block.baseFeePerGas
    };
  }

  async getBlockWithTransactions(blockNumber: number | 'latest' | 'pending'): Promise<BlockInfo & { transactions: TransactionInfo[] }> {
    logPaperModeCall('MockRPCProvider', 'getBlockWithTransactions', { blockNumber });
    
    const block = await this.getBlock(blockNumber);
    const simulatedBlock = this.blocks.get(block.number);
    
    const transactions: TransactionInfo[] = [];
    
    if (simulatedBlock) {
      for (const txHash of simulatedBlock.transactions) {
        const tx = this.transactions.get(txHash);
        if (tx) {
          transactions.push({
            hash: tx.hash,
            blockNumber: tx.blockNumber || block.number,
            blockHash: tx.blockHash || block.hash,
            transactionIndex: tx.transactionIndex || 0,
            from: tx.from,
            to: tx.to,
            value: tx.value,
            gas: tx.gas,
            gasPrice: tx.gasPrice,
            gasUsed: tx.gasUsed,
            status: tx.status,
            input: tx.data,
            nonce: tx.nonce,
            timestamp: tx.timestamp
          });
        }
      }
    }
    
    return { ...block, transactions };
  }

  async getTransaction(hash: string): Promise<TransactionInfo> {
    logPaperModeCall('MockRPCProvider', 'getTransaction', { hash });
    
    this.ensureConnected();
    await this.simulateLatency();
    
    const tx = this.transactions.get(hash);
    if (!tx) {
      throw new Error(`Transaction not found: ${hash}`);
    }
    
    return {
      hash: tx.hash,
      blockNumber: tx.blockNumber || 0,
      blockHash: tx.blockHash || '',
      transactionIndex: tx.transactionIndex || 0,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      gas: tx.gas,
      gasPrice: tx.gasPrice,
      gasUsed: tx.gasUsed,
      status: tx.status,
      input: tx.data,
      nonce: tx.nonce,
      timestamp: tx.timestamp
    };
  }

  async getTransactionReceipt(hash: string): Promise<TransactionReceipt> {
    logPaperModeCall('MockRPCProvider', 'getTransactionReceipt', { hash });
    
    this.ensureConnected();
    await this.simulateLatency();
    
    const receipt = this.transactionReceipts.get(hash);
    if (!receipt) {
      throw new Error(`Transaction receipt not found: ${hash}`);
    }
    
    return { ...receipt };
  }

  async sendRawTransaction(signedTransaction: string): Promise<string> {
    logPaperModeCall('MockRPCProvider', 'sendRawTransaction', { 
      signedTransaction: signedTransaction.substring(0, 20) + '...' 
    });
    
    this.ensureConnected();
    await this.simulateLatency();
    
    // Generate transaction hash
    const txHash = `0x${Date.now().toString(16)}${Math.random().toString(16).substring(2, 18)}`;
    
    // Create simulated transaction
    const tx: SimulatedTransaction = {
      hash: txHash,
      from: this.generateRandomAddress(),
      to: this.generateRandomAddress(),
      value: '1000000000000000000', // 1 ETH
      data: signedTransaction,
      gas: 21000,
      gasPrice: this.gasPrice,
      nonce: this.getRandomNonce(),
      timestamp: Date.now()
    };
    
    // Add to pending transactions
    this.pendingTransactions.set(txHash, tx);
    
    logger.info(`[PAPER_MODE] Transaction submitted to mempool: ${txHash}`);
    
    return txHash;
  }

  async getTransactionCount(address: string, block?: number | 'latest' | 'pending'): Promise<number> {
    logPaperModeCall('MockRPCProvider', 'getTransactionCount', { address, block });
    
    this.ensureConnected();
    await this.simulateLatency();
    
    const account = this.accounts.get(address);
    return account ? account.nonce : 0;
  }

  async getBalance(address: string, block?: number | 'latest' | 'pending'): Promise<string> {
    logPaperModeCall('MockRPCProvider', 'getBalance', { address, block });
    
    this.ensureConnected();
    await this.simulateLatency();
    
    const account = this.accounts.get(address);
    return account ? account.balance : '0x0';
  }

  async getCode(address: string, block?: number | 'latest' | 'pending'): Promise<string> {
    logPaperModeCall('MockRPCProvider', 'getCode', { address, block });
    
    this.ensureConnected();
    await this.simulateLatency();
    
    const account = this.accounts.get(address);
    return account?.code || '0x';
  }

  async getStorageAt(address: string, position: string, block?: number | 'latest' | 'pending'): Promise<string> {
    logPaperModeCall('MockRPCProvider', 'getStorageAt', { address, position, block });
    
    this.ensureConnected();
    await this.simulateLatency();
    
    const account = this.accounts.get(address);
    return account?.storage.get(position) || '0x0000000000000000000000000000000000000000000000000000000000000000';
  }

  async call(request: ContractCallRequest): Promise<ContractCallResult> {
    logPaperModeCall('MockRPCProvider', 'call', { to: request.to, data: request.data?.substring(0, 20) + '...' });
    
    this.ensureConnected();
    await this.simulateLatency();
    
    const config = getSimulationConfig();
    
    // Simulate call failures
    if (Math.random() < config.failureRate * 0.1) {
      return {
        result: '0x',
        success: false,
        error: 'Contract call reverted'
      };
    }
    
    // Check if this is a known contract
    const contractImpl = this.contractImplementations.get(request.to);
    if (contractImpl) {
      return this.executeContractCall(contractImpl, request);
    }
    
    // Default successful call
    return {
      result: '0x0000000000000000000000000000000000000000000000000000000000000001',
      gasUsed: 21000,
      success: true
    };
  }

  async estimateGas(request: ContractCallRequest): Promise<GasEstimate> {
    logPaperModeCall('MockRPCProvider', 'estimateGas', { to: request.to });
    
    this.ensureConnected();
    await this.simulateLatency();
    
    // Simulate gas estimation based on transaction type
    let gasLimit = 21000; // Basic transfer
    
    if (request.data && request.data !== '0x') {
      // Contract interaction
      gasLimit = 100000 + Math.floor(Math.random() * 200000); // 100k-300k gas
    }
    
    const maxFeePerGas = Math.floor(this.baseFeePerGas * 1.5);
    const maxPriorityFeePerGas = Math.floor(this.gasPrice * 0.1);
    const estimatedCost = gasLimit * this.gasPrice;
    
    return {
      gasLimit,
      gasPrice: this.gasPrice,
      maxFeePerGas,
      maxPriorityFeePerGas,
      estimatedCost,
      estimatedTimeSeconds: 15 + Math.random() * 30 // 15-45 seconds
    };
  }

  async getGasPrice(): Promise<number> {
    logPaperModeCall('MockRPCProvider', 'getGasPrice');
    
    this.ensureConnected();
    await this.simulateLatency();
    
    // Add some volatility to gas price
    const volatility = 0.1; // 10% volatility
    const multiplier = 1 + (Math.random() - 0.5) * volatility;
    
    return Math.floor(this.gasPrice * multiplier);
  }

  async getFeeHistory(blockCount: number, newestBlock: number | 'latest'): Promise<{
    baseFeePerGas: number[];
    gasUsedRatio: number[];
    reward?: number[][];
  }> {
    logPaperModeCall('MockRPCProvider', 'getFeeHistory', { blockCount, newestBlock });
    
    this.ensureConnected();
    await this.simulateLatency();
    
    const baseFeePerGas: number[] = [];
    const gasUsedRatio: number[] = [];
    const reward: number[][] = [];
    
    for (let i = 0; i < blockCount; i++) {
      baseFeePerGas.push(this.baseFeePerGas + Math.floor(Math.random() * 5000000000)); // ±5 gwei
      gasUsedRatio.push(0.5 + Math.random() * 0.4); // 50-90% utilization
      reward.push([
        Math.floor(this.gasPrice * 0.05), // 10th percentile
        Math.floor(this.gasPrice * 0.1),  // 25th percentile
        Math.floor(this.gasPrice * 0.15)  // 50th percentile
      ]);
    }
    
    return { baseFeePerGas, gasUsedRatio, reward };
  }

  async getNetworkStatus(): Promise<NetworkStatus> {
    logPaperModeCall('MockRPCProvider', 'getNetworkStatus');
    
    this.ensureConnected();
    await this.simulateLatency();
    
    return {
      chainId: this.chainId,
      blockNumber: this.currentBlockNumber,
      gasPrice: this.gasPrice,
      peerCount: 25 + Math.floor(Math.random() * 50),
      syncing: false,
      networkId: this.networkId
    };
  }

  async getPeerCount(): Promise<number> {
    logPaperModeCall('MockRPCProvider', 'getPeerCount');
    await this.simulateLatency();
    return 25 + Math.floor(Math.random() * 50);
  }

  async isSyncing(): Promise<boolean> {
    logPaperModeCall('MockRPCProvider', 'isSyncing');
    await this.simulateLatency();
    return false; // Always synced in simulation
  }

  async getLogs(filter: {
    fromBlock?: number | 'latest' | 'pending';
    toBlock?: number | 'latest' | 'pending';
    address?: string | string[];
    topics?: (string | string[] | null)[];
  }): Promise<LogEntry[]> {
    logPaperModeCall('MockRPCProvider', 'getLogs', filter);
    
    this.ensureConnected();
    await this.simulateLatency();
    
    // Generate some mock logs
    const logs: LogEntry[] = [];
    
    for (let i = 0; i < Math.min(10, Math.floor(Math.random() * 20)); i++) {
      logs.push({
        address: filter.address ? (Array.isArray(filter.address) ? filter.address[0] : filter.address) : this.generateRandomAddress(),
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer event signature
          `0x000000000000000000000000${this.generateRandomAddress().substring(2)}`,
          `0x000000000000000000000000${this.generateRandomAddress().substring(2)}`
        ],
        data: '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000', // 1 ETH
        blockNumber: this.currentBlockNumber - Math.floor(Math.random() * 100),
        transactionHash: `0x${Math.random().toString(16).substring(2)}${Math.random().toString(16).substring(2)}`,
        transactionIndex: i,
        blockHash: `0x${Math.random().toString(16).substring(2)}${Math.random().toString(16).substring(2)}`,
        logIndex: i,
        removed: false
      });
    }
    
    return logs;
  }

  async waitForTransaction(hash: string, confirmations: number = 1, timeout: number = 60000): Promise<TransactionReceipt> {
    logPaperModeCall('MockRPCProvider', 'waitForTransaction', { hash, confirmations, timeout });
    
    this.ensureConnected();
    
    // Simulate transaction confirmation delay
    const confirmationTime = 15000 + Math.random() * 30000; // 15-45 seconds
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Transaction ${hash} timed out after ${timeout}ms`));
      }, timeout);
      
      setTimeout(async () => {
        try {
          // Generate transaction receipt if it doesn't exist
          let receipt = this.transactionReceipts.get(hash);
          if (!receipt) {
            receipt = this.generateTransactionReceipt(hash);
            this.transactionReceipts.set(hash, receipt);
          }
          
          clearTimeout(timeoutId);
          resolve(receipt);
        } catch (error) {
          clearTimeout(timeoutId);
          reject(error);
        }
      }, confirmationTime);
    });
  }

  async batchRequest(requests: any[]): Promise<any[]> {
    logPaperModeCall('MockRPCProvider', 'batchRequest', { requestCount: requests.length });
    
    const results = [];
    
    for (const request of requests) {
      // Process each request based on method
      try {
        let result;
        switch (request.method) {
          case 'eth_getBalance':
            result = await this.getBalance(request.params[0], request.params[1]);
            break;
          case 'eth_blockNumber':
            result = '0x' + this.currentBlockNumber.toString(16);
            break;
          case 'eth_gasPrice':
            result = '0x' + this.gasPrice.toString(16);
            break;
          default:
            result = '0x0';
        }
        
        results.push({
          id: request.id,
          jsonrpc: '2.0',
          result
        });
      } catch (error) {
        results.push({
          id: request.id,
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : 'Unknown error'
          }
        });
      }
    }
    
    return results;
  }

  // Private helper methods

  private initializeAccounts(): void {
    // Create some mock accounts with balances
    const testAccounts = [
      { address: '0x742d35cc6466db4a0dd7a4e1d9b8a8e6f2f2e4b3', balance: '0x56BC75E2D630E9', nonce: 42 }, // 100 ETH
      { address: '0x8ba1f109551bD432803012645Hac136c22C2', balance: '0x2B5E3AF16B18800000', nonce: 15 }, // 50 ETH
      { address: '0x123f681646d4a755815f9cb19e1acc8565a0c2ac', balance: '0x1BC16D674EC80000', nonce: 8 },   // 2 ETH
    ];
    
    for (const account of testAccounts) {
      this.accounts.set(account.address, {
        address: account.address,
        balance: account.balance,
        nonce: account.nonce,
        storage: new Map()
      });
    }
  }

  private initializeBlocks(): void {
    // Generate some recent blocks
    for (let i = 0; i < 10; i++) {
      const blockNumber = this.currentBlockNumber - i;
      const block = this.generateBlock(blockNumber);
      this.blocks.set(blockNumber, block);
    }
  }

  private initializeContracts(): void {
    // Mock ERC-20 token contract
    this.contractImplementations.set('0xA0b86a33E6441f8C8F992f62e5b8A8E6c18e1d3', {
      type: 'ERC20',
      name: 'Mock Token',
      symbol: 'MOCK',
      decimals: 18,
      totalSupply: '1000000000000000000000000' // 1M tokens
    });
    
    // Mock price oracle contract
    this.contractImplementations.set('0xB1c84f82E9A5c65f124a8e6c1F8e2b7c2D3e4f5', {
      type: 'PriceOracle',
      feeds: this.priceFeeds
    });
  }

  private generateBlock(blockNumber: number): SimulatedBlock {
    const previousBlock = this.blocks.get(blockNumber - 1);
    const parentHash = previousBlock ? previousBlock.hash : 
      `0x${Math.random().toString(16).substring(2)}${Math.random().toString(16).substring(2)}`;
    
    return {
      number: blockNumber,
      hash: `0x${Math.random().toString(16).substring(2)}${Math.random().toString(16).substring(2)}`,
      parentHash,
      timestamp: Date.now() - (this.currentBlockNumber - blockNumber) * 12000, // 12s block time
      gasUsed: Math.floor(Math.random() * 15000000), // 0-15M gas used
      gasLimit: 30000000, // 30M gas limit
      baseFeePerGas: this.baseFeePerGas,
      transactions: [],
      difficulty: '0x' + (BigInt('3000000000000000') + BigInt(Math.floor(Math.random() * 1000000000000000))).toString(16),
      totalDifficulty: '0x' + (BigInt('58750003716598352816469') + BigInt(blockNumber)).toString(16),
      nonce: '0x' + Math.random().toString(16).substring(2, 18)
    };
  }

  private generateTransactionReceipt(hash: string): TransactionReceipt {
    const config = getSimulationConfig();
    
    // Simulate transaction success/failure
    const status = Math.random() < config.failureRate * 0.1 ? 0 : 1;
    
    return {
      transactionHash: hash,
      transactionIndex: Math.floor(Math.random() * 100),
      blockNumber: this.currentBlockNumber,
      blockHash: `0x${Math.random().toString(16).substring(2)}${Math.random().toString(16).substring(2)}`,
      from: this.generateRandomAddress(),
      to: this.generateRandomAddress(),
      gasUsed: 21000 + Math.floor(Math.random() * 100000),
      cumulativeGasUsed: Math.floor(Math.random() * 5000000),
      contractAddress: Math.random() < 0.1 ? this.generateRandomAddress() : undefined,
      logs: [],
      status,
      effectiveGasPrice: this.gasPrice
    };
  }

  private executeContractCall(contractImpl: any, request: ContractCallRequest): ContractCallResult {
    if (contractImpl.type === 'ERC20') {
      // Simulate ERC-20 calls
      if (request.data?.startsWith('0x70a08231')) { // balanceOf
        return {
          result: '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000', // 1 token
          gasUsed: 2300,
          success: true
        };
      }
      if (request.data?.startsWith('0x18160ddd')) { // totalSupply
        return {
          result: '0x' + BigInt(contractImpl.totalSupply).toString(16),
          gasUsed: 2300,
          success: true
        };
      }
    }
    
    if (contractImpl.type === 'PriceOracle') {
      // Simulate price oracle calls
      const feedKeys = Array.from(contractImpl.feeds.keys());
      const randomFeed = feedKeys[Math.floor(Math.random() * feedKeys.length)];
      const price = contractImpl.feeds.get(randomFeed);
      
      return {
        result: '0x' + Math.floor(price * 100000000).toString(16), // Price with 8 decimals
        gasUsed: 5000,
        success: true
      };
    }
    
    return {
      result: '0x0000000000000000000000000000000000000000000000000000000000000001',
      gasUsed: 21000,
      success: true
    };
  }

  private generateRandomAddress(): string {
    return '0x' + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }

  private getRandomNonce(): number {
    return Math.floor(Math.random() * 1000);
  }

  private startBlockGeneration(): void {
    // Generate new blocks every 12-15 seconds (Ethereum-like)
    this.blockGenerationTimer = setInterval(() => {
      this.currentBlockNumber++;
      const newBlock = this.generateBlock(this.currentBlockNumber);
      
      // Process pending transactions
      const txsToProcess = Math.min(this.pendingTransactions.size, 150); // Max transactions per block
      const processedTxs: string[] = [];
      
      let txIndex = 0;
      for (const [hash, tx] of this.pendingTransactions) {
        if (txIndex >= txsToProcess) break;
        
        // Confirm transaction
        tx.blockNumber = this.currentBlockNumber;
        tx.blockHash = newBlock.hash;
        tx.transactionIndex = txIndex;
        tx.status = Math.random() < 0.95 ? 1 : 0; // 95% success rate
        tx.gasUsed = Math.floor(tx.gas * (0.5 + Math.random() * 0.5)); // 50-100% gas usage
        
        this.transactions.set(hash, tx);
        processedTxs.push(hash);
        
        // Generate receipt
        const receipt = this.generateTransactionReceipt(hash);
        this.transactionReceipts.set(hash, receipt);
        
        txIndex++;
      }
      
      // Remove processed transactions from pending pool
      for (const hash of processedTxs) {
        this.pendingTransactions.delete(hash);
      }
      
      newBlock.transactions = processedTxs;
      this.blocks.set(this.currentBlockNumber, newBlock);
      
      // Update gas prices slightly
      this.gasPrice = Math.floor(this.gasPrice * (0.95 + Math.random() * 0.1)); // ±5% variation
      this.baseFeePerGas = Math.floor(this.baseFeePerGas * (0.95 + Math.random() * 0.1));
      
      logger.debug(`[PAPER_MODE] Generated block ${this.currentBlockNumber} with ${processedTxs.length} transactions`);
      
    }, 12000 + Math.random() * 3000); // 12-15 second blocks
  }

  private stopBlockGeneration(): void {
    if (this.blockGenerationTimer) {
      clearInterval(this.blockGenerationTimer);
      this.blockGenerationTimer = undefined;
    }
    
    if (this.transactionPoolTimer) {
      clearInterval(this.transactionPoolTimer);
      this.transactionPoolTimer = undefined;
    }
  }

  private async simulateLatency(): Promise<void> {
    const config = getSimulationConfig();
    const latency = config.networkLatency.min + 
      Math.random() * (config.networkLatency.max - config.networkLatency.min);
    await this.sleep(latency);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(`RPC Provider ${this.providerId} is not connected`);
    }
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    this.stopBlockGeneration();
    this.accounts.clear();
    this.transactions.clear();
    this.transactionReceipts.clear();
    this.blocks.clear();
    this.pendingTransactions.clear();
    this.contractImplementations.clear();
    this.connected = false;
    
    logger.info(`[PAPER_MODE] MockRPCProvider cleaned up: ${this.providerId}`);
  }
} 