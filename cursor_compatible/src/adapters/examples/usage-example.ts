/**
 * Noderr Protocol - Adapter Usage Example
 * 
 * This file demonstrates how to use the chain adapters in a practical
 * application scenario.
 */

import { createAdapter, Asset, TradeOrder } from '../index';

/**
 * Example function to showcase a cross-chain trade scenario
 */
async function performCrossChainTradeExample() {
  console.log('Starting cross-chain trade example...');
  
  // Step 1: Create adapters for source and destination chains
  console.log('Creating adapters...');
  const arbitrumAdapter = createAdapter(42161, {
    rpcUrl: 'https://arb1.arbitrum.io/rpc'
  });
  
  const bscAdapter = createAdapter(56, {
    rpcUrl: 'https://bsc-dataseed.binance.org/'
  });
  
  try {
    // Step 2: Initialize and connect both adapters
    console.log('Initializing and connecting adapters...');
    await Promise.all([
      arbitrumAdapter.initialize({}).then(() => arbitrumAdapter.connect()),
      bscAdapter.initialize({}).then(() => bscAdapter.connect())
    ]);
    
    // Step 3: Check adapter statuses
    const [arbitrumStatus, bscStatus] = await Promise.all([
      arbitrumAdapter.getStatus(),
      bscAdapter.getStatus()
    ]);
    
    console.log(`Arbitrum connected: ${arbitrumStatus.isConnected}, block height: ${arbitrumStatus.blockHeight}`);
    console.log(`BSC connected: ${bscStatus.isConnected}, block height: ${bscStatus.blockHeight}`);
    
    // Step 4: Define assets for the trade
    const sourceAsset: Asset = {
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      chainId: 42161,
      isNative: true
    };
    
    const destinationAsset: Asset = {
      symbol: 'BUSD',
      name: 'Binance USD',
      decimals: 18,
      address: '0xe9e7cea3dedca5984780bafc599bd69add087d56',
      chainId: 56
    };
    
    // Step 5: Get a quote for the source trade
    console.log('Getting trade quote on Arbitrum...');
    const quoteAmount = '1.0'; // 1 ETH
    const sourceQuote = await arbitrumAdapter.getQuote(
      sourceAsset,
      {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
        chainId: 42161
      },
      quoteAmount
    );
    
    console.log(`Quote received: ${quoteAmount} ETH → ${sourceQuote.expectedOutput} USDC on Arbitrum`);
    console.log(`Price impact: ${sourceQuote.priceImpact}%`);
    console.log(`Route: ${sourceQuote.route?.join(' → ')}`);
    
    // Step 6: Execute the source trade
    console.log('Executing trade on Arbitrum...');
    const sourceOrder: TradeOrder = {
      id: `trade-${Date.now()}`,
      fromAsset: sourceAsset,
      toAsset: {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
        chainId: 42161
      },
      amount: quoteAmount,
      slippageTolerance: 0.5, // 0.5%
      timestamp: Date.now(),
      status: 'pending'
    };
    
    const sourceResult = await arbitrumAdapter.executeTrade(sourceOrder);
    
    if (sourceResult.success) {
      console.log(`Trade successful! Received ${sourceResult.amountOut} USDC`);
      console.log(`Transaction hash: ${sourceResult.txHash}`);
      
      // Step 7: Get a quote for the destination trade
      console.log('Getting trade quote on BSC...');
      const destQuote = await bscAdapter.getQuote(
        {
          symbol: 'USDT',
          name: 'Tether USD',
          decimals: 18,
          address: '0x55d398326f99059ff775485246999027b3197955',
          chainId: 56
        },
        destinationAsset,
        sourceResult.amountOut || '0'
      );
      
      console.log(`Quote received: ${sourceResult.amountOut} USDT → ${destQuote.expectedOutput} BUSD on BSC`);
      
      // Step 8: Execute the destination trade
      console.log('Executing trade on BSC...');
      const destOrder: TradeOrder = {
        id: `trade-${Date.now()}`,
        fromAsset: {
          symbol: 'USDT',
          name: 'Tether USD',
          decimals: 18,
          address: '0x55d398326f99059ff775485246999027b3197955',
          chainId: 56
        },
        toAsset: destinationAsset,
        amount: sourceResult.amountOut || '0',
        slippageTolerance: 0.5,
        timestamp: Date.now(),
        status: 'pending'
      };
      
      const destResult = await bscAdapter.executeTrade(destOrder);
      
      if (destResult.success) {
        console.log(`BSC trade successful! Received ${destResult.amountOut} BUSD`);
        console.log(`Transaction hash: ${destResult.txHash}`);
        console.log('Cross-chain trade complete!');
      } else {
        console.error('BSC trade failed:', destResult.failureReason);
      }
    } else {
      console.error('Arbitrum trade failed:', sourceResult.failureReason);
    }
  } catch (error) {
    console.error('Error during cross-chain trade:', error);
  } finally {
    // Step 9: Clean up resources
    console.log('Shutting down adapters...');
    await Promise.all([
      arbitrumAdapter.shutdown(),
      bscAdapter.shutdown()
    ]);
    console.log('Example completed');
  }
}

/**
 * Main function to run the example
 */
async function main() {
  await performCrossChainTradeExample();
}

// Only run the example if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

// Export the example function for potential reuse
export { performCrossChainTradeExample }; 