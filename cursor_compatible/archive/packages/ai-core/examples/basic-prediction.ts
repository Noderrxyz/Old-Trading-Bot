/**
 * Basic Prediction Example - AI Core Module
 * Demonstrates how to use the AI Core for trading predictions
 */

import { AICoreService, FeatureSet, MarketRegime } from '../src';

async function runExample() {
  console.log('🚀 AI Core Basic Prediction Example\n');
  
  // Initialize AI Core
  const aiCore = new AICoreService();
  
  console.log('📊 Initializing AI Core system...');
  await aiCore.initialize();
  
  // Prepare sample features
  const features: FeatureSet = {
    symbol: 'BTC/USDT',
    timestamp: Date.now(),
    
    priceFeatures: {
      open: 50000,
      high: 51000,
      low: 49500,
      close: 50500,
      returns1m: 0.002,
      returns5m: 0.005,
      returns15m: 0.008,
      returns1h: 0.01,
      returns4h: 0.015,
      returns1d: 0.02,
      logReturns: [0.002, 0.003, 0.004],
      hlRatio: 51000 / 49500,
      ocRatio: 50500 / 50000,
      realizedVol1h: 0.02,
      realizedVol24h: 0.025,
      garchVol: 0.023,
      bidAskSpread: 0.0001,
      midPrice: 50499.5,
      microPrice: 50499.75,
      vwap: 50250,
      twap: 50300,
      percentileRank: 0.75
    },
    
    volumeFeatures: {
      volume: 1000000,
      volumeMA: 950000,
      volumeRatio: 1.05,
      buyVolume: 600000,
      sellVolume: 400000,
      volumeImbalance: 0.2,
      largeOrderRatio: 0.3,
      volumeProfile: [100, 200, 300, 400, 300, 200, 100],
      poc: 50250,
      valueAreaHigh: 50400,
      valueAreaLow: 50100,
      orderFlowImbalance: 0.15,
      aggressiveBuyRatio: 0.6,
      aggressiveSellRatio: 0.4,
      liquidityScore: 0.85,
      marketDepth: 1000,
      resilience: 0.9
    },
    
    technicalFeatures: {
      sma: { 20: 50100, 50: 49800, 200: 48500 },
      ema: { 12: 50200, 26: 50000 },
      wma: { 10: 50150 },
      rsi: { 14: 65, 21: 62 },
      macd: {
        macd: 200,
        signal: 150,
        histogram: 50
      },
      stochastic: {
        k: 75,
        d: 70
      },
      momentum: { 10: 0.02, 20: 0.03 },
      roc: { 10: 2.5, 20: 3.0 },
      atr: { 14: 500, 20: 450 },
      bollingerBands: {
        upper: 51000,
        middle: 50000,
        lower: 49000,
        width: 2000,
        percentB: 0.75
      },
      keltnerChannels: {
        upper: 50800,
        middle: 50000,
        lower: 49200
      },
      adx: 35,
      aroon: {
        up: 80,
        down: 20,
        oscillator: 60
      },
      ichimoku: {
        tenkan: 50200,
        kijun: 50000,
        senkouA: 50100,
        senkouB: 49900,
        chikou: 50300
      },
      supertrend: {
        trend: 'up',
        value: 49500
      },
      obv: 5000000,
      cmf: 0.15,
      mfi: 70,
      vwma: { 20: 50150 },
      pivotPoints: {
        r3: 52000,
        r2: 51500,
        r1: 51000,
        pivot: 50500,
        s1: 50000,
        s2: 49500,
        s3: 49000
      },
      fibonacciLevels: {
        levels: { 0.236: 50800, 0.382: 51200, 0.5: 51500, 0.618: 51800 },
        trend: 'up'
      },
      marketProfile: {
        valueArea: [50100, 50400],
        pointOfControl: 50250,
        balanceArea: [49900, 50600]
      }
    },
    
    marketFeatures: {
      regime: MarketRegime.BULL_QUIET,
      trendStrength: 0.75,
      volatilityRegime: 'low',
      correlations: { 'SPY': 0.6, 'ETH': 0.8, 'GOLD': -0.3 },
      beta: { 'SPY': 1.2 },
      advanceDeclineRatio: 1.8,
      newHighsLows: 0.7,
      percentAbove20MA: 0.65,
      vix: 15,
      termStructure: 0.02,
      creditSpread: 0.015,
      dollarIndex: 92,
      yieldCurve: 0.02,
      commodityIndex: 100
    },
    
    sentimentFeatures: {
      twitterSentiment: 0.7,
      redditSentiment: 0.65,
      newsSentiment: 0.6,
      bullBearRatio: 1.5,
      fearGreedIndex: 75,
      putCallRatio: 0.8,
      socialVolume: 10000,
      mentionGrowth: 0.1,
      viralScore: 0.3,
      sentimentConfidence: 0.85,
      sentimentDispersion: 0.2
    },
    
    onChainFeatures: {
      hashRate: 150000000,
      difficulty: 20000000000000,
      blockTime: 600,
      transactionCount: 300000,
      transactionVolume: 5000000000,
      averageFee: 0.0001,
      circulatingSupply: 19000000,
      inflationRate: 0.018,
      burnRate: 0,
      tvl: 10000000000,
      dexVolume: 1000000000,
      stablecoinSupply: 100000000000,
      activeAddresses: 1000000,
      whaleActivity: 0.3,
      exchangeInflow: 50000,
      exchangeOutflow: 45000,
      minerRevenue: 30000000,
      minerBalance: 100000,
      hashRibbons: 0.7
    }
  };
  
  console.log('\n🎯 Making prediction for', features.symbol);
  console.log('Current price:', features.priceFeatures.close);
  console.log('RSI:', features.technicalFeatures.rsi[14]);
  console.log('Market regime:', features.marketFeatures.regime);
  
  // Get prediction
  const signal = await aiCore.predict(features);
  
  console.log('\n✨ Prediction Results:');
  console.log('=====================================');
  console.log('Action:', signal.action.type.toUpperCase());
  console.log('Position Size:', (signal.action.size * 100).toFixed(1) + '%');
  console.log('Confidence:', (signal.confidence * 100).toFixed(1) + '%');
  
  if (signal.action.stopLoss) {
    console.log('Stop Loss:', signal.action.stopLoss);
  }
  if (signal.action.takeProfit) {
    console.log('Take Profit:', signal.action.takeProfit);
  }
  
  console.log('\n📋 Reasoning:');
  signal.reasons.forEach((reason, i) => {
    console.log(`${i + 1}. ${reason}`);
  });
  
  console.log('\n📊 Risk Assessment:');
  console.log('Overall Risk:', (signal.risk.overallRisk * 100).toFixed(1) + '%');
  console.log('Recommendation:', signal.risk.recommendation.toUpperCase());
  console.log('- Drawdown Risk:', (signal.risk.drawdownRisk * 100).toFixed(1) + '%');
  console.log('- Volatility Risk:', (signal.risk.volatilityRisk * 100).toFixed(1) + '%');
  console.log('- Correlation Risk:', (signal.risk.correlationRisk * 100).toFixed(1) + '%');
  console.log('- Liquidity Risk:', (signal.risk.liquidityRisk * 100).toFixed(1) + '%');
  
  // Check for patterns
  const patterns = aiCore.getActivePatterns();
  if (patterns.length > 0) {
    console.log('\n🔍 Detected Patterns:');
    patterns.slice(0, 3).forEach(pattern => {
      console.log(`- ${pattern.type}: ${(pattern.confidence * 100).toFixed(1)}% confidence`);
      console.log(`  Scale: ${pattern.scale}, Predictive Power: ${(pattern.predictivePower * 100).toFixed(1)}%`);
    });
  }
  
  // Get performance metrics
  const performance = aiCore.getPerformance();
  console.log('\n📈 Model Performance:');
  console.log('Transformer Accuracy:', (performance.transformer?.accuracy * 100).toFixed(1) + '%');
  console.log('Transformer Sharpe:', performance.transformer?.sharpeRatio.toFixed(2));
  console.log('RL Sharpe:', performance.reinforcement?.sharpeRatio.toFixed(2));
  
  // Monitor events
  aiCore.on('patternsDetected', (data) => {
    console.log('\n🆕 New patterns detected:', data.patterns.length);
  });
  
  aiCore.on('performanceUpdate', (metrics) => {
    console.log('\n📊 Performance update received');
  });
  
  // Simulate multiple predictions
  console.log('\n\n🔄 Running batch predictions...');
  const symbols = ['ETH/USDT', 'SOL/USDT', 'MATIC/USDT'];
  
  for (const symbol of symbols) {
    const modifiedFeatures = { ...features, symbol };
    const batchSignal = await aiCore.predict(modifiedFeatures);
    console.log(`${symbol}: ${batchSignal.action.type.toUpperCase()} with ${(batchSignal.confidence * 100).toFixed(1)}% confidence`);
  }
  
  // Clean up
  console.log('\n\n🧹 Cleaning up resources...');
  aiCore.dispose();
  
  console.log('✅ Example completed successfully!');
}

// Run example
runExample().catch(console.error); 