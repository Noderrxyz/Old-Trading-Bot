/**
 * Multicall3 Integration
 * 
 * Provides efficient batching of multiple contract calls into a single RPC request
 * using the Multicall3 contract deployed on all major chains.
 * 
 * @module performance/Multicall3
 */

import { ethers } from 'ethers';

/**
 * Multicall3 contract addresses (same address on all chains)
 */
export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

/**
 * Multicall3 ABI (minimal interface)
 */
export const MULTICALL3_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'target', type: 'address' },
          { name: 'allowFailure', type: 'bool' },
          { name: 'callData', type: 'bytes' },
        ],
        name: 'calls',
        type: 'tuple[]',
      },
    ],
    name: 'aggregate3',
    outputs: [
      {
        components: [
          { name: 'success', type: 'bool' },
          { name: 'returnData', type: 'bytes' },
        ],
        name: 'returnData',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { name: 'target', type: 'address' },
          { name: 'allowFailure', type: 'bool' },
          { name: 'value', type: 'uint256' },
          { name: 'callData', type: 'bytes' },
        ],
        name: 'calls',
        type: 'tuple[]',
      },
    ],
    name: 'aggregate3Value',
    outputs: [
      {
        components: [
          { name: 'success', type: 'bool' },
          { name: 'returnData', type: 'bytes' },
        ],
        name: 'returnData',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
];

/**
 * Call configuration for Multicall3
 */
export interface Call3 {
  target: string;
  allowFailure: boolean;
  callData: string;
}

/**
 * Call configuration with value for Multicall3
 */
export interface Call3Value extends Call3 {
  value: bigint;
}

/**
 * Result from Multicall3
 */
export interface Result {
  success: boolean;
  returnData: string;
}

/**
 * Decoded result with typed data
 */
export interface DecodedResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Multicall3 Helper
 * 
 * Provides convenient methods for batching contract calls.
 */
export class Multicall3 {
  private contract: ethers.Contract;
  private provider: ethers.Provider;

  constructor(provider: ethers.Provider) {
    this.provider = provider;
    this.contract = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  }

  /**
   * Execute multiple calls in a single transaction
   */
  async aggregate(calls: Call3[]): Promise<Result[]> {
    const results = await this.contract.aggregate3(calls);
    return results.map((r: any) => ({
      success: r.success,
      returnData: r.returnData,
    }));
  }

  /**
   * Execute multiple calls with ETH value in a single transaction
   */
  async aggregateValue(calls: Call3Value[], totalValue: bigint): Promise<Result[]> {
    const results = await this.contract.aggregate3Value(calls, { value: totalValue });
    return results.map((r: any) => ({
      success: r.success,
      returnData: r.returnData,
    }));
  }

  /**
   * Encode a function call for multicall
   */
  static encodeCall(
    contractInterface: ethers.Interface,
    functionName: string,
    params: any[]
  ): string {
    return contractInterface.encodeFunctionData(functionName, params);
  }

  /**
   * Decode a result from multicall
   */
  static decodeResult<T = any>(
    contractInterface: ethers.Interface,
    functionName: string,
    returnData: string
  ): T {
    return contractInterface.decodeFunctionResult(functionName, returnData)[0] as T;
  }

  /**
   * Create a call configuration
   */
  static createCall(target: string, callData: string, allowFailure = true): Call3 {
    return { target, allowFailure, callData };
  }

  /**
   * Create a call configuration with value
   */
  static createCallValue(
    target: string,
    callData: string,
    value: bigint,
    allowFailure = true
  ): Call3Value {
    return { target, allowFailure, callData, value };
  }

  /**
   * Batch multiple contract calls and decode results
   */
  async batchCall<T = any>(
    calls: {
      target: string;
      interface: ethers.Interface;
      functionName: string;
      params: any[];
      allowFailure?: boolean;
    }[]
  ): Promise<DecodedResult<T>[]> {
    const multicalls: Call3[] = calls.map(call =>
      Multicall3.createCall(
        call.target,
        Multicall3.encodeCall(call.interface, call.functionName, call.params),
        call.allowFailure ?? true
      )
    );

    const results = await this.aggregate(multicalls);

    return results.map((result, index) => {
      if (!result.success) {
        return {
          success: false,
          error: 'Call failed',
        };
      }

      try {
        const data = Multicall3.decodeResult<T>(
          calls[index].interface,
          calls[index].functionName,
          result.returnData
        );
        return {
          success: true,
          data,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
        };
      }
    });
  }

  /**
   * Get multiple token balances in a single call
   */
  async getTokenBalances(
    tokenAddresses: string[],
    accountAddress: string
  ): Promise<Map<string, bigint>> {
    const erc20Interface = new ethers.Interface([
      'function balanceOf(address) view returns (uint256)',
    ]);

    const calls = tokenAddresses.map(token =>
      Multicall3.createCall(
        token,
        Multicall3.encodeCall(erc20Interface, 'balanceOf', [accountAddress])
      )
    );

    const results = await this.aggregate(calls);
    const balances = new Map<string, bigint>();

    results.forEach((result, index) => {
      if (result.success) {
        try {
          const balance = Multicall3.decodeResult<bigint>(
            erc20Interface,
            'balanceOf',
            result.returnData
          );
          balances.set(tokenAddresses[index], balance);
        } catch (error) {
          balances.set(tokenAddresses[index], 0n);
        }
      } else {
        balances.set(tokenAddresses[index], 0n);
      }
    });

    return balances;
  }

  /**
   * Check if Multicall3 is available on the current chain
   */
  async isAvailable(): Promise<boolean> {
    try {
      const code = await this.provider.getCode(MULTICALL3_ADDRESS);
      return code !== '0x';
    } catch {
      return false;
    }
  }

  /**
   * Get the Multicall3 contract address
   */
  getAddress(): string {
    return MULTICALL3_ADDRESS;
  }
}

/**
 * Multicall3 Builder
 * 
 * Provides a fluent interface for building multicall batches.
 */
export class Multicall3Builder {
  private calls: {
    target: string;
    interface: ethers.Interface;
    functionName: string;
    params: any[];
    allowFailure: boolean;
  }[] = [];

  /**
   * Add a call to the batch
   */
  addCall(
    target: string,
    contractInterface: ethers.Interface,
    functionName: string,
    params: any[],
    allowFailure = true
  ): this {
    this.calls.push({
      target,
      interface: contractInterface,
      functionName,
      params,
      allowFailure,
    });
    return this;
  }

  /**
   * Add multiple calls to the batch
   */
  addCalls(
    calls: {
      target: string;
      interface: ethers.Interface;
      functionName: string;
      params: any[];
      allowFailure?: boolean;
    }[]
  ): this {
    calls.forEach(call => this.addCall(
      call.target,
      call.interface,
      call.functionName,
      call.params,
      call.allowFailure ?? true
    ));
    return this;
  }

  /**
   * Execute the batch and return results
   */
  async execute<T = any>(multicall: Multicall3): Promise<DecodedResult<T>[]> {
    return await multicall.batchCall<T>(this.calls);
  }

  /**
   * Get the number of calls in the batch
   */
  getCallCount(): number {
    return this.calls.length;
  }

  /**
   * Clear all calls
   */
  clear(): this {
    this.calls = [];
    return this;
  }
}
