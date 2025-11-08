export class ChainAdapterMock {
  private chain: string;

  constructor(chain: string) {
    this.chain = chain;
  }

  async executeTransaction(tx: any): Promise<any> {
    // Simulate transaction execution
    console.log(`[${this.chain}] Executing transaction:`, tx);
    return { success: true, txHash: 'mock-tx-hash' };
  }

  async getBalance(address: string): Promise<number> {
    // Simulate balance check
    console.log(`[${this.chain}] Getting balance for address:`, address);
    return 1000;
  }
} 