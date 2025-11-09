import { ethers } from 'ethers';

/**
 * Transaction status enum
 */
export enum TransactionStatus {
  PENDING = 'pending',
  SUBMITTED = 'submitted',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * Transaction priority levels
 */
export enum TransactionPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

/**
 * Queued transaction interface
 */
export interface QueuedTransaction {
  id: string;
  chainId: number;
  to: string;
  data: string;
  value: bigint;
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce?: number;
  priority: TransactionPriority;
  status: TransactionStatus;
  retryCount: number;
  maxRetries: number;
  submittedAt?: number;
  confirmedAt?: number;
  txHash?: string;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Transaction queue configuration
 */
export interface TransactionQueueConfig {
  maxQueueSize: number;
  maxRetries: number;
  retryDelay: number;
  confirmationBlocks: number;
  maxPendingTransactions: number;
  nonceRefreshInterval: number;
}

/**
 * Transaction queue for managing nonce and transaction ordering
 * 
 * Features:
 * - Automatic nonce management
 * - Transaction prioritization
 * - Retry logic with exponential backoff
 * - Concurrent transaction limiting
 * - Transaction cancellation
 * - Status tracking
 */
export class TransactionQueue {
  private queue: Map<string, QueuedTransaction> = new Map();
  private pendingNonces: Map<number, number> = new Map(); // chainId -> next nonce
  private processing: Set<string> = new Set();
  private config: TransactionQueueConfig;
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;

  constructor(
    provider: ethers.Provider,
    wallet: ethers.Wallet,
    config?: Partial<TransactionQueueConfig>
  ) {
    this.provider = provider;
    this.wallet = wallet;
    this.config = {
      maxQueueSize: config?.maxQueueSize ?? 100,
      maxRetries: config?.maxRetries ?? 3,
      retryDelay: config?.retryDelay ?? 5000, // 5 seconds
      confirmationBlocks: config?.confirmationBlocks ?? 2,
      maxPendingTransactions: config?.maxPendingTransactions ?? 5,
      nonceRefreshInterval: config?.nonceRefreshInterval ?? 60000, // 1 minute
    };

    // Start nonce refresh interval
    this.startNonceRefresh();
  }

  /**
   * Add transaction to queue
   */
  async addTransaction(
    chainId: number,
    to: string,
    data: string,
    value: bigint = 0n,
    priority: TransactionPriority = TransactionPriority.NORMAL,
    metadata?: Record<string, any>
  ): Promise<string> {
    // Check queue size
    if (this.queue.size >= this.config.maxQueueSize) {
      throw new Error('Transaction queue is full');
    }

    // Generate transaction ID
    const id = this.generateTransactionId();

    // Create queued transaction
    const queuedTx: QueuedTransaction = {
      id,
      chainId,
      to,
      data,
      value,
      priority,
      status: TransactionStatus.PENDING,
      retryCount: 0,
      maxRetries: this.config.maxRetries,
      metadata,
    };

    // Add to queue
    this.queue.set(id, queuedTx);

    // Process queue
    this.processQueue().catch(err => {
      console.error('Error processing queue:', err);
    });

    return id;
  }

  /**
   * Get transaction by ID
   */
  getTransaction(id: string): QueuedTransaction | undefined {
    return this.queue.get(id);
  }

  /**
   * Get all transactions
   */
  getAllTransactions(): QueuedTransaction[] {
    return Array.from(this.queue.values());
  }

  /**
   * Get transactions by status
   */
  getTransactionsByStatus(status: TransactionStatus): QueuedTransaction[] {
    return Array.from(this.queue.values()).filter(tx => tx.status === status);
  }

  /**
   * Get transactions by chain
   */
  getTransactionsByChain(chainId: number): QueuedTransaction[] {
    return Array.from(this.queue.values()).filter(tx => tx.chainId === chainId);
  }

  /**
   * Cancel transaction
   */
  async cancelTransaction(id: string): Promise<boolean> {
    const tx = this.queue.get(id);
    if (!tx) {
      return false;
    }

    // Can only cancel pending or failed transactions
    if (tx.status !== TransactionStatus.PENDING && tx.status !== TransactionStatus.FAILED) {
      return false;
    }

    // Update status
    tx.status = TransactionStatus.CANCELLED;
    this.queue.set(id, tx);

    return true;
  }

  /**
   * Remove transaction from queue
   */
  removeTransaction(id: string): boolean {
    return this.queue.delete(id);
  }

  /**
   * Clear completed transactions
   */
  clearCompleted(): number {
    let count = 0;
    for (const [id, tx] of this.queue.entries()) {
      if (tx.status === TransactionStatus.CONFIRMED || tx.status === TransactionStatus.CANCELLED) {
        this.queue.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * Get queue statistics
   */
  getStatistics() {
    const txs = Array.from(this.queue.values());
    return {
      total: txs.length,
      pending: txs.filter(tx => tx.status === TransactionStatus.PENDING).length,
      submitted: txs.filter(tx => tx.status === TransactionStatus.SUBMITTED).length,
      confirmed: txs.filter(tx => tx.status === TransactionStatus.CONFIRMED).length,
      failed: txs.filter(tx => tx.status === TransactionStatus.FAILED).length,
      cancelled: txs.filter(tx => tx.status === TransactionStatus.CANCELLED).length,
      processing: this.processing.size,
    };
  }

  /**
   * Process transaction queue
   */
  private async processQueue(): Promise<void> {
    // Get pending transactions sorted by priority
    const pendingTxs = Array.from(this.queue.values())
      .filter(tx => tx.status === TransactionStatus.PENDING)
      .sort((a, b) => b.priority - a.priority);

    // Check if we can process more transactions
    const currentPending = Array.from(this.queue.values())
      .filter(tx => tx.status === TransactionStatus.SUBMITTED).length;

    if (currentPending >= this.config.maxPendingTransactions) {
      return;
    }

    // Process transactions up to max pending limit
    const toProcess = pendingTxs.slice(0, this.config.maxPendingTransactions - currentPending);

    for (const tx of toProcess) {
      if (this.processing.has(tx.id)) {
        continue;
      }

      this.processing.add(tx.id);
      this.submitTransaction(tx).catch(err => {
        console.error(`Error submitting transaction ${tx.id}:`, err);
      }).finally(() => {
        this.processing.delete(tx.id);
      });
    }
  }

  /**
   * Submit transaction to blockchain
   */
  private async submitTransaction(tx: QueuedTransaction): Promise<void> {
    try {
      // Get nonce
      const nonce = await this.getNextNonce(tx.chainId);
      tx.nonce = nonce;

      // Estimate gas if not provided
      if (!tx.gasLimit) {
        try {
          const gasEstimate = await this.provider.estimateGas({
            to: tx.to,
            data: tx.data,
            value: tx.value,
          });
          tx.gasLimit = (gasEstimate * 120n) / 100n; // Add 20% buffer
        } catch (err) {
          tx.gasLimit = 500000n; // Default fallback
        }
      }

      // Get gas prices if not provided
      if (!tx.maxFeePerGas || !tx.maxPriorityFeePerGas) {
        const feeData = await this.provider.getFeeData();
        tx.maxFeePerGas = feeData.maxFeePerGas ?? undefined;
        tx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? undefined;
      }

      // Create transaction
      const txRequest: ethers.TransactionRequest = {
        to: tx.to,
        data: tx.data,
        value: tx.value,
        nonce: tx.nonce,
        gasLimit: tx.gasLimit,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        chainId: tx.chainId,
      };

      // Send transaction
      const txResponse = await this.wallet.sendTransaction(txRequest);
      tx.txHash = txResponse.hash;
      tx.status = TransactionStatus.SUBMITTED;
      tx.submittedAt = Date.now();
      this.queue.set(tx.id, tx);

      // Increment nonce
      this.incrementNonce(tx.chainId);

      // Wait for confirmation
      this.waitForConfirmation(tx).catch(err => {
        console.error(`Error waiting for confirmation ${tx.id}:`, err);
      });

    } catch (error: any) {
      // Handle error
      tx.error = error.message;
      tx.retryCount++;

      if (tx.retryCount >= tx.maxRetries) {
        tx.status = TransactionStatus.FAILED;
      } else {
        tx.status = TransactionStatus.PENDING;
        // Retry after delay
        setTimeout(() => {
          this.processQueue().catch(err => {
            console.error('Error processing queue:', err);
          });
        }, this.config.retryDelay * Math.pow(2, tx.retryCount)); // Exponential backoff
      }

      this.queue.set(tx.id, tx);
    }
  }

  /**
   * Wait for transaction confirmation
   */
  private async waitForConfirmation(tx: QueuedTransaction): Promise<void> {
    if (!tx.txHash) {
      return;
    }

    try {
      const receipt = await this.provider.waitForTransaction(
        tx.txHash,
        this.config.confirmationBlocks
      );

      if (receipt && receipt.status === 1) {
        tx.status = TransactionStatus.CONFIRMED;
        tx.confirmedAt = Date.now();
      } else {
        tx.status = TransactionStatus.FAILED;
        tx.error = 'Transaction reverted';
      }

      this.queue.set(tx.id, tx);

      // Process next transactions
      this.processQueue().catch(err => {
        console.error('Error processing queue:', err);
      });

    } catch (error: any) {
      tx.status = TransactionStatus.FAILED;
      tx.error = error.message;
      this.queue.set(tx.id, tx);
    }
  }

  /**
   * Get next nonce for chain
   */
  private async getNextNonce(chainId: number): Promise<number> {
    // Check if we have a cached nonce
    let nonce = this.pendingNonces.get(chainId);

    if (nonce === undefined) {
      // Get nonce from provider
      nonce = await this.wallet.getNonce();
      this.pendingNonces.set(chainId, nonce);
    }

    return nonce;
  }

  /**
   * Increment nonce for chain
   */
  private incrementNonce(chainId: number): void {
    const currentNonce = this.pendingNonces.get(chainId);
    if (currentNonce !== undefined) {
      this.pendingNonces.set(chainId, currentNonce + 1);
    }
  }

  /**
   * Refresh nonce from blockchain
   */
  private async refreshNonce(chainId: number): Promise<void> {
    try {
      const nonce = await this.wallet.getNonce();
      this.pendingNonces.set(chainId, nonce);
    } catch (error) {
      console.error(`Error refreshing nonce for chain ${chainId}:`, error);
    }
  }

  /**
   * Start nonce refresh interval
   */
  private startNonceRefresh(): void {
    setInterval(() => {
      for (const chainId of this.pendingNonces.keys()) {
        this.refreshNonce(chainId).catch(err => {
          console.error(`Error refreshing nonce for chain ${chainId}:`, err);
        });
      }
    }, this.config.nonceRefreshInterval);
  }

  /**
   * Generate unique transaction ID
   */
  private generateTransactionId(): string {
    return `tx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
}
