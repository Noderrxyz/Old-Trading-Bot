import { ethers } from 'ethers';
import { FlashbotsBundleProvider } from '@flashbots/ethers-provider-bundle';
import logger from '../utils/logger.js';

interface FlashbotsBundle {
  tx: string;
  signer: string;
  gasLimit: number;
  maxFeePerGas: number;
  nonce: number;
}

interface FlashbotsConfig {
  rpcUrl: string;
  flashbotsRpcUrl: string;
  privateKey: string;
  maxRetries: number;
  fallbackGasMultiplier: number;
}

const DEFAULT_CONFIG: FlashbotsConfig = {
  rpcUrl: process.env.ETH_RPC_URL || '',
  flashbotsRpcUrl: 'https://relay.flashbots.net',
  privateKey: process.env.PRIVATE_KEY || '',
  maxRetries: 3,
  fallbackGasMultiplier: 1.2
};

export class FlashbotsExecutor {
  private static instance: FlashbotsExecutor;
  private config: FlashbotsConfig;
  private provider: ethers.JsonRpcProvider;
  private flashbotsProvider: FlashbotsBundleProvider | null;
  private wallet: ethers.Wallet;

  private constructor(config: Partial<FlashbotsConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
    this.wallet = new ethers.Wallet(this.config.privateKey, this.provider);
    this.flashbotsProvider = null;
  }

  public static getInstance(config?: Partial<FlashbotsConfig>): FlashbotsExecutor {
    if (!FlashbotsExecutor.instance) {
      FlashbotsExecutor.instance = new FlashbotsExecutor(config);
    }
    return FlashbotsExecutor.instance;
  }

  public async initialize(): Promise<void> {
    try {
      this.flashbotsProvider = await FlashbotsBundleProvider.create(
        this.provider,
        this.wallet,
        this.config.flashbotsRpcUrl
      );
      logger.info('Flashbots provider initialized');
    } catch (error) {
      logger.error('Failed to initialize Flashbots provider:', error);
      this.flashbotsProvider = null;
    }
  }

  public async executeBundle(bundle: FlashbotsBundle): Promise<boolean> {
    if (!this.flashbotsProvider) {
      logger.warn('Flashbots provider not initialized, falling back to public mempool');
      return this.executePublic(bundle);
    }

    try {
      const targetBlock = await this.provider.getBlockNumber() + 1;
      const signedBundle = await this.flashbotsProvider.signBundle([
        {
          transaction: bundle.tx,
          signer: bundle.signer
        }
      ]);

      const simulation = await this.flashbotsProvider.simulate(signedBundle, targetBlock);
      if ('error' in simulation) {
        logger.warn('Flashbots simulation failed:', simulation.error);
        return this.executePublic(bundle);
      }

      const response = await this.flashbotsProvider.sendBundle(signedBundle, targetBlock);
      if ('error' in response) {
        logger.warn('Flashbots bundle submission failed:', response.error);
        return this.executePublic(bundle);
      }

      const receipt = await response.wait();
      if (receipt === 0) {
        logger.warn('Flashbots bundle not included in block');
        return this.executePublic(bundle);
      }

      logger.info('Flashbots bundle executed successfully');
      return true;
    } catch (error) {
      logger.error('Flashbots execution failed:', error);
      return this.executePublic(bundle);
    }
  }

  private async executePublic(bundle: FlashbotsBundle): Promise<boolean> {
    try {
      const tx = {
        to: bundle.signer,
        nonce: bundle.nonce,
        gasLimit: bundle.gasLimit,
        maxFeePerGas: Math.floor(bundle.maxFeePerGas * this.config.fallbackGasMultiplier),
        data: bundle.tx
      };

      const signedTx = await this.wallet.signTransaction(tx);
      const response = await this.wallet.sendTransaction(tx);
      await response.wait();

      logger.info('Public mempool execution successful');
      return true;
    } catch (error) {
      logger.error('Public mempool execution failed:', error);
      return false;
    }
  }

  public cleanup(): void {
    this.provider.removeAllListeners();
  }
} 