#!/usr/bin/env node

/**
 * Regime Classification Simulation Script
 * 
 * This script simulates market data and runs the regime classifier to test detection.
 * It outputs regime changes and visualizes the classification confidence over time.
 */

import { MarketRegimeClassifier } from '../src/regime/MarketRegimeClassifier.js';
import { RegimeTransitionEngine } from '../src/regime/RegimeTransitionEngine.js';
import { MarketRegime } from '../src/regime/MarketRegimeTypes.js';
import { TelemetryBus } from '../src/telemetry/TelemetryBus.js';

// Configure simulation
const SIMULATION_DAYS = 100;
const SAMPLES_PER_DAY = 24;
const SYMBOL = 'BTC/USD';
const SIMULATION_REGIMES = [
  { regime: 'bullish_trend', days: 30 },
  { regime: 'rangebound', days: 20 },
  { regime: 'high_volatility', days: 10 },
  { regime: 'bearish_trend', days: 30 },
  { regime: 'low_volatility', days: 10 }
];

// Initialize components
const classifier = MarketRegimeClassifier.getInstance();
const transitionEngine = RegimeTransitionEngine.getInstance({
  transitionSmoothingWindow: 6,
  minimumTransitionConfidence: 0.7
});

// Disable telemetry for simulation
TelemetryBus.getInstance = jest.fn().mockReturnValue({
  emit: jest.fn()
});

// Track regime changes
const regimeChanges = [];
transitionEngine.onTransition((transition, symbol) => {
  regimeChanges.push({
    day: Math.floor(currentSample / SAMPLES_PER_DAY),
    from: transition.fromRegime,
    to: transition.toRegime,
    confidence: transition.confidence
  });
  
  console.log(`[Day ${Math.floor(currentSample / SAMPLES_PER_DAY)}] Regime change: ${transition.fromRegime} -> ${transition.toRegime} (confidence: ${transition.confidence.toFixed(2)})`);
});

// Generate features based on regime
function generateFeaturesForRegime(regime, day, volatilityOverride = null) {
  // Base values
  const basePrice = 10000;
  const baseVolume = 100;
  
  // Noise function
  const noise = (amplitude) => (Math.random() - 0.5) * amplitude;
  
  // Trend parameters
  let trendRate = 0;
  let volatility = volatilityOverride || 0.02;
  let volumeMultiplier = 1;
  let rsiBase = 50;
  
  // Configure parameters based on regime
  switch (regime) {
    case 'bullish_trend':
      trendRate = 0.02;
      volatility = 0.02;
      volumeMultiplier = 1.2;
      rsiBase = 65;
      break;
    case 'bearish_trend':
      trendRate = -0.02;
      volatility = 0.03;
      volumeMultiplier = 1.3;
      rsiBase = 35;
      break;
    case 'rangebound':
      trendRate = 0;
      volatility = 0.01;
      volumeMultiplier = 0.8;
      rsiBase = 50;
      break;
    case 'high_volatility':
      trendRate = 0;
      volatility = 0.05;
      volumeMultiplier = 1.5;
      rsiBase = 50;
      break;
    case 'low_volatility':
      trendRate = 0;
      volatility = 0.008;
      volumeMultiplier = 0.7;
      rsiBase = 50;
      break;
  }
  
  // Calculate price based on trend and day
  const price = basePrice * (1 + trendRate * day + noise(0.1));
  
  // Calculate returns with noise
  const returns1d = trendRate / SAMPLES_PER_DAY + noise(volatility);
  const returns5d = trendRate * 5 / SAMPLES_PER_DAY + noise(volatility * 0.8);
  const returns20d = trendRate * 20 / SAMPLES_PER_DAY + noise(volatility * 0.6);
  
  // Simulate RSI based on trend
  const rsi = Math.min(100, Math.max(0, rsiBase + noise(20)));
  
  // Simulate volume
  const volume = baseVolume * volumeMultiplier * (1 + noise(0.3));
  
  // Create features object
  return {
    price,
    returns1d,
    returns5d,
    returns20d,
    volatility1d: volatility * (1 + noise(0.2)),
    volatility5d: volatility * 0.9 * (1 + noise(0.15)),
    volatility20d: volatility * 0.8 * (1 + noise(0.1)),
    volumeRatio1d: volumeMultiplier * (1 + noise(0.2)),
    volumeRatio5d: volumeMultiplier * (1 + noise(0.15)),
    rsi14: rsi,
    atr14: price * volatility * 0.5,
    bbWidth: 0.5 + volatility * 10,
    macdHistogram: returns5d * 10,
    advanceDeclineRatio: 1 + returns1d * 5,
    marketCap: price * 1000000,
    vix: 15 + volatility * 300
  };
}

// Run simulation
console.log(`Running ${SIMULATION_DAYS} day regime simulation with ${SAMPLES_PER_DAY} samples per day...`);
console.log('Simulated regime sequence:');
SIMULATION_REGIMES.forEach(r => console.log(`- ${r.regime} (${r.days} days)`));
console.log('\n');

// Expand regime sequence to cover all simulation days
const regimeSequence = [];
for (const regimeData of SIMULATION_REGIMES) {
  for (let i = 0; i < regimeData.days; i++) {
    regimeSequence.push(regimeData.regime);
  }
}

// Ensure we have enough regimes for the simulation
while (regimeSequence.length < SIMULATION_DAYS) {
  regimeSequence.push(SIMULATION_REGIMES[0].regime);
}

// Limit to simulation days
regimeSequence.length = SIMULATION_DAYS;

// Store simulation results
const results = [];
let currentSample = 0;

// Run each day
for (let day = 0; day < SIMULATION_DAYS; day++) {
  const regime = regimeSequence[day];
  
  // Introduce volatility spikes at certain points
  const isVolatilitySpike = day % 30 === 29;
  const volatilityOverride = isVolatilitySpike ? 0.1 : null;
  
  // Run samples for each day
  for (let h = 0; h < SAMPLES_PER_DAY; h++) {
    // Generate features
    const features = generateFeaturesForRegime(regime, day, volatilityOverride);
    
    // Run classification
    const classification = classifier.classifyRegime(SYMBOL, features);
    
    // Process through transition engine
    transitionEngine.processClassification(classification, SYMBOL);
    
    // Get smoothed regime
    const smoothedRegime = transitionEngine.getSmoothRegime(SYMBOL);
    
    // Store results
    results.push({
      day,
      hour: h,
      sample: currentSample,
      simulatedRegime: regime,
      detectedRegime: smoothedRegime.primaryRegime,
      confidence: smoothedRegime.confidence,
      transitionState: smoothedRegime.transitionState
    });
    
    currentSample++;
  }
}

// Calculate accuracy
const totalSamples = results.length;
let correctSamples = 0;

results.forEach(r => {
  // Convert regime names to match
  const simulatedRegimeFixed = r.simulatedRegime.includes('bullish') ? MarketRegime.BullishTrend :
                             r.simulatedRegime.includes('bearish') ? MarketRegime.BearishTrend :
                             r.simulatedRegime.includes('rangebound') ? MarketRegime.Rangebound :
                             r.simulatedRegime.includes('high_volatility') ? MarketRegime.HighVolatility :
                             r.simulatedRegime.includes('low_volatility') ? MarketRegime.LowVolatility :
                             MarketRegime.Unknown;
  
  if (r.detectedRegime === simulatedRegimeFixed) {
    correctSamples++;
  }
});

const accuracy = (correctSamples / totalSamples) * 100;

// Print results
console.log('\nSimulation Results:');
console.log(`Total samples: ${totalSamples}`);
console.log(`Correct classifications: ${correctSamples}`);
console.log(`Accuracy: ${accuracy.toFixed(2)}%`);
console.log(`Regime transitions detected: ${regimeChanges.length}`);

console.log('\nDetailed Regime Transitions:');
regimeChanges.forEach((change, i) => {
  console.log(`${i+1}. Day ${change.day}: ${change.from} -> ${change.to} (confidence: ${change.confidence.toFixed(2)})`);
});

// Simple ASCII visualization of regimes over time
console.log('\nRegime Classification Visualization:');
console.log('Each character represents 1 day, showing primary regime:');
console.log('B = Bullish, b = Bearish, R = Rangebound, H = High Volatility, L = Low Volatility, ? = Other');

let visualization = '';
for (let day = 0; day < SIMULATION_DAYS; day++) {
  // Get the most frequent regime for this day
  const daySamples = results.filter(r => r.day === day);
  const regimeCounts = {};
  
  daySamples.forEach(sample => {
    if (!regimeCounts[sample.detectedRegime]) {
      regimeCounts[sample.detectedRegime] = 0;
    }
    regimeCounts[sample.detectedRegime]++;
  });
  
  let mostFrequentRegime = '?';
  let maxCount = 0;
  
  Object.entries(regimeCounts).forEach(([regime, count]) => {
    if (count > maxCount) {
      maxCount = count;
      mostFrequentRegime = regime;
    }
  });
  
  // Convert to a character
  let char = '?';
  if (mostFrequentRegime === MarketRegime.BullishTrend) char = 'B';
  else if (mostFrequentRegime === MarketRegime.BearishTrend) char = 'b';
  else if (mostFrequentRegime === MarketRegime.Rangebound) char = 'R';
  else if (mostFrequentRegime === MarketRegime.HighVolatility) char = 'H';
  else if (mostFrequentRegime === MarketRegime.LowVolatility) char = 'L';
  
  visualization += char;
  
  // Add newline every 50 days
  if ((day + 1) % 50 === 0) {
    visualization += '\n';
  }
}

console.log(visualization);

// Save results to CSV if there's a filename argument
if (process.argv[2]) {
  const fs = require('fs');
  const filename = process.argv[2];
  
  const csvHeader = 'day,hour,sample,simulatedRegime,detectedRegime,confidence,transitionState\n';
  const csvRows = results.map(r => 
    `${r.day},${r.hour},${r.sample},${r.simulatedRegime},${r.detectedRegime},${r.confidence},${r.transitionState}`
  ).join('\n');
  
  fs.writeFileSync(filename, csvHeader + csvRows);
  console.log(`\nResults saved to ${filename}`);
} 