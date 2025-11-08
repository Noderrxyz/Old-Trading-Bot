/**
 * Elite Trading Example - SystemVanguard
 * 
 * WARNING: This example demonstrates aggressive trading capabilities.
 * Use only in appropriate environments with proper risk controls.
 */

import { 
  SystemVanguardService,
  DEFAULT_VANGUARD_CONFIG,
  PerformanceMode,
  VanguardEventType
} from '../index';
import { createLogger, format, transports } from 'winston';

// Create logger
const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.colorize(),
    format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''}`;
    })
  ),
  transports: [new transports.Console()]
});

async function runEliteTrading() {
  logger.info('🚀 Starting Elite 0.1% Trading System');
  
  // Configure for maximum performance
  const eliteConfig = {
    ...DEFAULT_VANGUARD_CONFIG,
    latencyTargets: {
      p50: 0.5,    // 500 microseconds
      p99: 1,      // 1ms
      p999: 5,     // 5ms
      p9999: 10    // 10ms
    },
    adversarial: {
      detectionEnabled: true,
      autoCountermeasures: true,
      aggressiveness: 0.9  // Maximum aggression
    },
    deception: {
      ...DEFAULT_VANGUARD_CONFIG.deception,
      fingerPrintRotation: 60000, // Rotate every minute
      orderRandomization: {
        sizeJitter: 0.1,      // 10% size variation
        timingJitter: 200,    // 200ms timing variation
        venueRotation: true,
        priceOffsets: [0, 1, 2, 3, 5, 8], // Fibonacci offsets
        sliceVariation: 0.3   // 30% slice variation
      }
    },
    mempool: {
      chains: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'avalanche'],
      providers: [],
      updateFrequency: 50  // 50ms updates for ultra-fast MEV
    },
    evolution: {
      enabled: true,
      generationInterval: 1800000, // 30 minutes
      populationSize: 200,
      eliteRatio: 0.05  // Top 5% only
    }
  };
  
  // Initialize SystemVanguard
  const vanguard = new SystemVanguardService(logger, eliteConfig);
  
  // Set up event handlers
  vanguard.on('vanguardEvent', (event) => {
    switch (event.type) {
      case VanguardEventType.THREAT_DETECTED:
        logger.warn('⚠️  THREAT DETECTED:', event.data);
        break;
        
      case VanguardEventType.ALPHA_LEAK:
        logger.error('🚨 ALPHA LEAK DETECTED:', event.data);
        break;
        
      case VanguardEventType.OPPORTUNITY_FOUND:
        logger.info('💰 OPPORTUNITY:', event.data);
        break;
        
      case VanguardEventType.MODEL_EVOLVED:
        logger.info('🧬 MODEL EVOLVED:', event.data);
        break;
        
      case VanguardEventType.DECEPTION_ACTIVATED:
        logger.info('🎭 DECEPTION ACTIVE:', event.data);
        break;
    }
  });
  
  try {
    // Initialize the system
    await vanguard.initialize();
    logger.info('✅ SystemVanguard initialized');
    
    // Set ultra-low latency mode
    vanguard.setMode(PerformanceMode.ULTRA_LOW_LATENCY);
    logger.info('⚡ Ultra-low latency mode activated');
    
    // Simulate trading session
    logger.info('📊 Starting elite trading session...');
    
    // 1. Check for threats
    const threats = vanguard.detectThreats();
    logger.info(`🔍 Detected ${threats.length} threats`);
    
    // 2. Analyze mempools
    const mempoolStates = vanguard.analyzeMempools();
    logger.info(`📡 Monitoring ${mempoolStates.length} chain mempools`);
    
    // 3. Find opportunities
    const opportunities = vanguard.findCrossChainOpportunities();
    logger.info(`💎 Found ${opportunities.length} cross-chain opportunities`);
    
    // 4. Execute with deception
    if (opportunities.length > 0) {
      const bestOpp = opportunities.sort((a, b) => b.estimatedProfit - a.estimatedProfit)[0];
      logger.info('🎯 Executing best opportunity:', {
        type: bestOpp.type,
        chains: bestOpp.chains,
        profit: `${(bestOpp.estimatedProfit * 100).toFixed(2)}%`,
        risk: bestOpp.riskScore
      });
      
      // Execute with full deception
      const order = {
        symbol: 'ETH/USDT',
        side: 'buy',
        size: 10,
        price: 3000,
        venue: bestOpp.chains[0]
      };
      
      const result = await vanguard.executeWithDeception(order);
      logger.info('✅ Order executed with deception:', result);
    }
    
    // 5. Check system performance
    const stats = vanguard.getStatistics();
    logger.info('📈 System Statistics:', {
      uptime: `${(stats.uptime / 1000).toFixed(0)}s`,
      adaptations: stats.adaptationCount,
      threats: stats.threatsMitigated,
      mode: stats.currentMode,
      latencyP99: `${stats.latencyP99.toFixed(2)}ms`
    });
    
    // 6. Demonstrate different modes
    logger.info('🔄 Testing different performance modes...');
    
    // Stealth mode
    vanguard.setMode(PerformanceMode.STEALTH);
    logger.info('🥷 Stealth mode - maximum obfuscation');
    
    // Aggressive mode
    vanguard.setMode(PerformanceMode.AGGRESSIVE);
    logger.info('⚔️  Aggressive mode - maximum profit seeking');
    
    // Defensive mode
    vanguard.setMode(PerformanceMode.DEFENSIVE);
    logger.info('🛡️  Defensive mode - maximum protection');
    
    // Adaptive mode
    vanguard.setMode(PerformanceMode.ADAPTIVE);
    logger.info('🧠 Adaptive mode - self-optimizing');
    
    // 7. Monitor for 30 seconds
    logger.info('⏱️  Monitoring for 30 seconds...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // Final statistics
    const finalStats = vanguard.getStatistics();
    logger.info('📊 Final Statistics:', {
      totalThreats: finalStats.activeThreats,
      alphaLeaks: finalStats.alphaLeaks,
      adaptations: finalStats.adaptationCount,
      latencyP99: `${finalStats.latencyP99.toFixed(2)}ms`
    });
    
  } catch (error) {
    logger.error('❌ Error in elite trading:', error);
  } finally {
    // Shutdown
    logger.info('🔌 Shutting down SystemVanguard...');
    await vanguard.shutdown();
    logger.info('✅ Shutdown complete');
  }
}

// Run the example
if (require.main === module) {
  runEliteTrading().catch(console.error);
}

export { runEliteTrading }; 