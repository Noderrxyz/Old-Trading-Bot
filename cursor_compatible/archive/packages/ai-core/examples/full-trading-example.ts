/**
 * Full Trading Example - AI Core Module
 * 
 * This example demonstrates how to use all AI Core components together
 * for institutional-grade trading predictions.
 */

import {
  AICoreService,
  FeatureEngineer,
  createLogger,
  FeatureSet,
  MarketRegime
} from '../src';

async function runTradingExample() {
  // Initialize logger
  const logger = createLogger('trading-example');
  
  logger.info('🚀 Starting AI Core Trading Example');
  
  try {
    // 1. Initialize AI Core Service
    logger.info('Initializing AI Core Service...');
    const aiCore = new AICoreService(logger);
    
    // 2. Create sample feature set (in production, this would come from market data)
    const features: FeatureSet = {
      timestamp: Date.now(),
      symbol: 'BTC/USD',
      priceFeatures: {
        open: 45000,
        high: 45500,
        low: 44800,
        close: 45200,
        returns1m: 0.002,
        returns5m: 0.005,
        returns15m: 0.008,
        returns1h: 0.015,
        returns4h: 0.02,
        returns1d: 0.03,
        logReturns: [0.002, 0.003, 0.001, 0.004],
        hlRatio: 1.0156,
        ocRatio: 1.0044,
        realizedVol1h: 0.015,
        realizedVol24h: 0.025,
        garchVol: 0.02,
        bidAskSpread: 0.10,
        midPrice: 45200.05,
        microPrice: 45200.08,
        vwap: 45180,
        twap: 45190,
        percentileRank: 0.65
      },
      volumeFeatures: {
        volume: 1500000,
        volumeMA: 1200000,
        volumeRatio: 1.25,
        buyVolume: 850000,
        sellVolume: 650000,
        volumeImbalance: 0.23,
        largeOrderRatio: 0.15,
        volumeProfile: [100, 200, 300, 400, 500, 400, 300, 200, 100],
        poc: 45150,
        valueAreaHigh: 45300,
        valueAreaLow: 45000,
        orderFlowImbalance: 0.18,
        aggressiveBuyRatio: 0.55,
        aggressiveSellRatio: 0.45,
        liquidityScore: 0.85,
        marketDepth: 500,
        resilience: 0.9
      },
      technicalFeatures: {
        sma: { 20: 44800, 50: 44500, 200: 43000 },
        ema: { 12: 45100, 26: 44900 },
        wma: { 20: 45050 },
        rsi: { 14: 65 },
        macd: { macd: 200, signal: 150, histogram: 50 },
        stochastic: { k: 75, d: 70 },
        momentum: { 10: 0.02 },
        roc: { 10: 0.015 },
        atr: { 14: 250 },
        bollingerBands: {
          upper: 45800,
          middle: 45200,
          lower: 44600,
          width: 1200,
          percentB: 0.5
        },
        keltnerChannels: {
          upper: 45700,
          middle: 45200,
          lower: 44700
        },
        adx: 35,
        aroon: { up: 80, down: 20, oscillator: 60 },
        ichimoku: {
          tenkan: 45100,
          kijun: 45000,
          senkouA: 45300,
          senkouB: 45400,
          chikou: 45150
        },
        supertrend: { trend: 'up', value: 44800 },
        obv: 5000000,
        cmf: 0.15,
        mfi: 70,
        vwma: { 20: 45100 },
        pivotPoints: {
          r3: 46000,
          r2: 45700,
          r1: 45450,
          pivot: 45200,
          s1: 44950,
          s2: 44700,
          s3: 44400
        },
        fibonacciLevels: {
          levels: { 0: 44000, 0.236: 44500, 0.382: 44800, 0.5: 45000, 0.618: 45200, 1: 46000 },
          trend: 'up'
        },
        marketProfile: {
          valueArea: [45000, 45300],
          pointOfControl: 45150,
          balanceArea: [44800, 45500]
        }
      },
      marketFeatures: {
        regime: MarketRegime.BULL_QUIET,
        trendStrength: 0.7,
        volatilityRegime: 'normal',
        correlations: { 'ETH/USD': 0.85, 'SPY': 0.45 },
        beta: { 'SPY': 1.2 },
        advanceDeclineRatio: 1.3,
        newHighsLows: 0.6,
        percentAbove20MA: 0.65,
        vix: 18,
        termStructure: 0.02,
        creditSpread: 0.015,
        dollarIndex: 95,
        yieldCurve: 0.02,
        commodityIndex: 100
      },
      sentimentFeatures: {
        twitterSentiment: 0.7,
        redditSentiment: 0.65,
        newsSentiment: 0.6,
        bullBearRatio: 1.5,
        fearGreedIndex: 72,
        putCallRatio: 0.8,
        socialVolume: 10000,
        mentionGrowth: 0.15,
        viralScore: 0.8,
        sentimentConfidence: 0.85,
        sentimentDispersion: 0.2
      },
      onChainFeatures: {
        hashRate: 150000000,
        difficulty: 25000000000000,
        blockTime: 600,
        transactionCount: 300000,
        transactionVolume: 5000000000,
        averageFee: 15,
        circulatingSupply: 19500000,
        inflationRate: 0.018,
        burnRate: 0,
        tvl: 50000000000,
        dexVolume: 1000000000,
        stablecoinSupply: 100000000000,
        activeAddresses: 1000000,
        whaleActivity: 0.3,
        exchangeInflow: 50000,
        exchangeOutflow: 45000,
        minerRevenue: 30000000,
        minerBalance: 1000000,
        hashRibbons: 0.7
      },
      customFeatures: {
        customIndicator1: 0.75,
        customIndicator2: 1.2
      }
    };
    
    // 3. Get AI predictions
    logger.info('Getting AI predictions...');
    const signal = await aiCore.predict(features);
    
    logger.info('Prediction Results:', {
      action: signal.action.type,
      confidence: `${(signal.confidence * 100).toFixed(1)}%`,
      actionSize: `${(signal.action.size * 100).toFixed(1)}%`,
      reasons: signal.reasons,
      marketRegime: signal.marketRegime,
      risk: {
        overall: `${(signal.risk.overallRisk * 100).toFixed(1)}%`,
        recommendation: signal.risk.recommendation
      }
    });
    
    // 4. Detect fractal patterns (already included in signal)
    logger.info('Detected Patterns:');
    if (signal.patterns.length > 0) {
      signal.patterns.forEach(p => {
        logger.info(`  - ${p.type}: ${(p.confidence * 100).toFixed(0)}% confidence, ${(p.predictivePower * 100).toFixed(0)}% predictive power`);
      });
    } else {
      logger.info('  No significant patterns detected');
    }
    
    // 5. Market regime (already included in signal)
    logger.info('Market Regime:', signal.marketRegime);
    
    // 6. Engineer advanced features
    logger.info('Engineering advanced features...');
    const featureEngineer = new FeatureEngineer(logger, {
      polynomialDegree: 3,
      interactionDepth: 2,
      lagPeriods: [1, 5, 10],
      rollingWindows: [5, 10, 20],
      wavelets: true,
      fourier: true,
      entropy: true,
      fractal: true,
      microstructure: true
    });
    
    const engineeredFeatures = await featureEngineer.engineerFeatures(features);
    logger.info('Engineered Features:', {
      polynomialFeatures: Object.keys(engineeredFeatures.polynomial).length,
      interactionFeatures: Object.keys(engineeredFeatures.interactions).length,
      rollingFeatures: Object.keys(engineeredFeatures.rolling).length,
      entropyMetrics: Object.keys(engineeredFeatures.entropy || {}).length,
      microstructureMetrics: Object.keys(engineeredFeatures.microstructure || {}).length
    });
    
    // 7. Get model performance metrics
    const performance = aiCore.getPerformance();
    logger.info('Model Performance:', {
      transformer: performance.transformer ? {
        accuracy: `${(performance.transformer.accuracy * 100).toFixed(1)}%`,
        sharpeRatio: performance.transformer.sharpeRatio.toFixed(2)
      } : 'Not available',
      reinforcement: performance.reinforcement ? {
        winRate: `${(performance.reinforcement.winRate * 100).toFixed(1)}%`,
        sharpeRatio: performance.reinforcement.sharpeRatio.toFixed(2)
      } : 'Not available'
    });
    
    // 8. Risk assessment details
    logger.info('Risk Assessment Details:', {
      drawdown: `${(signal.risk.drawdownRisk * 100).toFixed(1)}%`,
      volatility: `${(signal.risk.volatilityRisk * 100).toFixed(1)}%`,
      correlation: `${(signal.risk.correlationRisk * 100).toFixed(1)}%`,
      liquidity: `${(signal.risk.liquidityRisk * 100).toFixed(1)}%`,
      overall: `${(signal.risk.overallRisk * 100).toFixed(1)}%`,
      recommendation: signal.risk.recommendation.toUpperCase()
    });
    
    // 9. Trading decision summary
    logger.info('═══════════════════════════════════════════════════');
    logger.info('📊 TRADING DECISION SUMMARY');
    logger.info('═══════════════════════════════════════════════════');
    logger.info(`Symbol: ${features.symbol}`);
    logger.info(`Market Regime: ${signal.marketRegime}`);
    logger.info(`Signal: ${signal.action.type.toUpperCase()}`);
    logger.info(`Position Size: ${(signal.action.size * 100).toFixed(0)}% of capital`);
    logger.info(`Confidence: ${(signal.confidence * 100).toFixed(0)}%`);
    logger.info(`Risk Level: ${signal.risk.overallRisk > 0.7 ? 'HIGH' : signal.risk.overallRisk > 0.5 ? 'MEDIUM' : 'LOW'}`);
    
    if (signal.action.stopLoss) {
      logger.info(`Stop Loss: $${signal.action.stopLoss.toFixed(2)}`);
    }
    if (signal.action.takeProfit) {
      logger.info(`Take Profit: $${signal.action.takeProfit.toFixed(2)}`);
    }
    
    logger.info(`Recommendation: ${signal.risk.recommendation.toUpperCase()}`);
    logger.info(`Reasons:`);
    signal.reasons.forEach(reason => {
      logger.info(`  - ${reason}`);
    });
    logger.info('═══════════════════════════════════════════════════');
    
    logger.info('✅ AI Core Trading Example completed successfully!');
    
  } catch (error) {
    logger.error('Error in trading example:', error);
  }
}

// Run the example
runTradingExample().catch(console.error); 