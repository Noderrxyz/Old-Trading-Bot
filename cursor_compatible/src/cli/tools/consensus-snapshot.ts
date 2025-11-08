#!/usr/bin/env node
/**
 * Consensus Snapshot CLI
 * 
 * Displays current global consensus information for all monitored assets and timeframes.
 */

import { TrendSignalAggregator } from '../../services/global/TrendSignalAggregator.js';
import { TrendConsensusEngine } from '../../services/global/TrendConsensusEngine.js';
import { RedisService } from '../../services/infrastructure/RedisService.js';

/**
 * Bootstrap the CLI application
 */
async function bootstrap() {
  console.log('Initializing consensus snapshot tool...');
  
  // Initialize services
  const redis = new RedisService();
  const aggregator = new TrendSignalAggregator(redis);
  const consensusEngine = new TrendConsensusEngine(aggregator);
  
  try {
    // Get current consensus data
    const consensus = await consensusEngine.calculateConsensus();
    const detailedConsensus = await consensusEngine.calculateDetailedConsensus();
    
    console.log('\n===== GLOBAL MARKET TREND CONSENSUS =====\n');
    
    if (Object.keys(consensus).length === 0) {
      console.log('No consensus data available. Agents may not have submitted signals yet.');
    } else {
      // Print header
      console.log('ASSET:TIMEFRAME'.padEnd(20) + 'DIRECTION'.padEnd(10) + 'CONFIDENCE'.padEnd(12) + 'SIGNALS');
      console.log('-'.repeat(60));
      
      // Print data for each asset/timeframe
      for (const [key, direction] of Object.entries(consensus)) {
        const [asset, timeframe] = key.split(':');
        const details = detailedConsensus[key];
        
        const directionEmoji = 
          direction === 'up' ? '🔼' : 
          direction === 'down' ? '🔽' : 
          '➡️';
        
        const confidence = details ? 
          (details.confidence * 100).toFixed(1) + '%' : 
          'N/A';
        
        const signalCount = details ? details.signalCount : 0;
        
        console.log(
          `${key}`.padEnd(20) + 
          `${directionEmoji} ${direction}`.padEnd(10) + 
          `${confidence}`.padEnd(12) + 
          `${signalCount}`
        );
      }
    }
    
    console.log('\nConsensus data is updated in real-time as agents submit signals.');
    console.log('Signals expire after 5 minutes to ensure data freshness.');
  } catch (error) {
    console.error('Error retrieving consensus data:', error);
  } finally {
    // Clean up
    await redis.close();
  }
}

// Execute the CLI
bootstrap()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  }); 