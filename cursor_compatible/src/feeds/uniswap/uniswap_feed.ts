import { ethers } from 'ethers';
import { MarketSnapshot, FeedConfig } from '../../types/MarketSnapshot.types.js';
import { FeedBus } from '../publishers/FeedBus.js';
import logger from '../../utils/logger.js';

const UNISWAP_V3_POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)'
];

export class UniswapV3Feed {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;
  private feedBus: FeedBus;
  private config: FeedConfig;
  private isRunning: boolean;
  private lastBlock: number;

  constructor(config: FeedConfig) {
    if (!config.rpcUrl || !config.contractAddress) {
      throw new Error('RPC URL and contract address are required for Uniswap V3 feed');
    }

    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.contract = new ethers.Contract(
      config.contractAddress,
      UNISWAP_V3_POOL_ABI,
      this.provider
    );
    this.feedBus = FeedBus.getInstance();
    this.isRunning = false;
    this.lastBlock = 0;
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Uniswap V3 feed is already running');
      return;
    }

    this.isRunning = true;
    await this.initialize();
    this.startPolling();
  }

  public stop(): void {
    this.isRunning = false;
  }

  private async initialize(): Promise<void> {
    try {
      const blockNumber = await this.provider.getBlockNumber();
      this.lastBlock = blockNumber;
      logger.info(`Uniswap V3 feed initialized at block ${blockNumber}`);
    } catch (error) {
      logger.error('Failed to initialize Uniswap V3 feed:', error);
      throw error;
    }
  }

  private startPolling(): void {
    const interval = this.config.pollingIntervalMs || 1000;
    
    setInterval(async () => {
      if (!this.isRunning) return;

      try {
        await this.pollEvents();
        await this.updatePrice();
      } catch (error) {
        logger.error('Error in Uniswap V3 feed polling:', error);
      }
    }, interval);
  }

  private async pollEvents(): Promise<void> {
    try {
      const currentBlock = await this.provider.getBlockNumber();
      const filter = this.contract.filters.Swap();
      
      const events = await this.contract.queryFilter(
        filter,
        this.lastBlock,
        currentBlock
      );

      for (const event of events) {
        await this.handleSwapEvent(event);
      }

      this.lastBlock = currentBlock;
    } catch (error) {
      logger.error('Error polling Uniswap V3 events:', error);
    }
  }

  private async handleSwapEvent(event: ethers.ContractEvent): Promise<void> {
    try {
      const block = await event.getBlock();
      const tx = await event.getTransaction();
      
      const snapshot: MarketSnapshot = {
        source: 'uniswap_v3',
        symbol: this.config.symbol,
        timestamp: block.timestamp * 1000,
        txHash: tx.hash,
        latencyMs: Date.now() - block.timestamp * 1000
      };

      this.feedBus.publish(snapshot);
    } catch (error) {
      logger.error('Error handling Uniswap V3 swap event:', error);
    }
  }

  private async updatePrice(): Promise<void> {
    try {
      const slot0 = await this.contract.slot0();
      const sqrtPriceX96 = slot0.sqrtPriceX96;
      const price = (sqrtPriceX96 * sqrtPriceX96) / (2 ** 192);

      const snapshot: MarketSnapshot = {
        source: 'uniswap_v3',
        symbol: this.config.symbol,
        timestamp: Date.now(),
        lastPrice: price,
        latencyMs: 0
      };

      this.feedBus.publish(snapshot);
    } catch (error) {
      logger.error('Error updating Uniswap V3 price:', error);
    }
  }
} 