# STAGE 3: Regime Classification & Detection Engine

## Overview

The Market Regime Classification system is a critical component of the Noderr Protocol Trading Bot that detects and tracks different market environments. This system enables the bot to adapt its strategy execution, capital allocation, and portfolio optimization based on current market conditions.

## Components

The Regime Classification system consists of three core components:

1. **MarketRegimeTypes** - Defines the enum types, interfaces, and configuration structures for market regimes
2. **MarketRegimeClassifier** - Detects market regimes using statistical models and ML approaches
3. **RegimeTransitionEngine** - Tracks regime changes over time and emits events to update downstream components

## Market Regime Types

The system recognizes the following regime categories:

### Trend Regimes
- **BullishTrend** - Strong upward price movement
- **BearishTrend** - Strong downward price movement

### Mean-Reversion Regimes
- **Rangebound** - Price oscillates within a defined range
- **MeanReverting** - Price tends to revert to a moving average

### Volatility Regimes
- **HighVolatility** - Above-average price fluctuations
- **LowVolatility** - Below-average price fluctuations

### Liquidity Regimes
- **HighLiquidity** - Above-average trading volume and market depth
- **LowLiquidity** - Below-average trading volume and market depth

### Combined Regimes
- **BullVolatile** - Bullish trend with high volatility
- **BearVolatile** - Bearish trend with high volatility
- **RangeboundLowVol** - Range-bound price action with low volatility

### Special Periods
- **MarketStress** - Extreme market conditions indicating potential crisis
- **Unknown** - Default when insufficient data is available

## Market Features

The classifier uses various market features for regime detection:

1. **Price Features**
   - Price levels
   - Returns over different time horizons (1d, 5d, 20d)

2. **Volatility Features**
   - Historical volatility measures
   - ATR (Average True Range)
   - Bollinger Band width

3. **Volume Features**
   - Volume ratios compared to historical averages

4. **Technical Indicators**
   - RSI (Relative Strength Index)
   - MACD (Moving Average Convergence Divergence)
   - Market breadth indicators

5. **Optional Macro Features**
   - VIX (volatility index)
   - USD Index strength
   - Yield curve measurements

## Transition States

The system tracks not just the current regime, but also the transition state between regimes:

- **Stable** - High confidence in the current regime
- **Developing** - Potential transition starting to emerge
- **Transitioning** - Confirmed regime transition in progress
- **Ambiguous** - Low confidence or conflicting signals

## Classification Process

The regime classification process follows these steps:

1. Market features are collected from price, volume, and indicator data
2. Individual regime scores are calculated for each regime type
3. The highest scoring regime is selected as the primary regime
4. Confidence is calculated based on the difference between top regime scores
5. Transition state is determined by analyzing recent classifications
6. Results are stored in history and evaluated for potential regime transitions

## Tuning Classification Thresholds

The classification system can be tuned through several configuration parameters:

```javascript
const config = {
  // Trend detection
  trendWindow: 20,             // Window for trend calculation (days)
  
  // Volatility calculation
  volatilityWindow: 20,        // Window for volatility calculation (days)
  
  // RSI thresholds
  rsiOverbought: 70,           // RSI threshold for overbought
  rsiOversold: 30,             // RSI threshold for oversold
  
  // Volatility thresholds
  highVolatilityThreshold: 30, // Annual volatility percentage
  
  // Confidence thresholds
  minimumConfidence: 0.6,      // Minimum confidence for valid classification
  transitionConfidenceThreshold: 0.75, // Confidence needed for transitions
  
  // History settings
  maxHistoryItems: 100,        // Maximum history items per symbol
  
  // Transition detection
  regimeConfirmationCount: 3,  // Consecutive readings to confirm regime
};
```

## Regime Transitions

The `RegimeTransitionEngine` tracks regime changes over time and provides:

1. Smooth transitions between regimes to avoid classification noise
2. Event emission when regimes change
3. Historical record of all regime transitions
4. Statistical tracking of regime duration and frequency

### Transition Events

When a regime transition occurs, the system emits an event containing:

- Previous regime
- New regime
- Confidence in the new regime
- Timestamp of detection
- Estimated start time of the transition
- Duration of the transition period

## Integration with Other Components

The regime classification system integrates with other Noderr Protocol components:

1. **RegimeCapitalAllocator** - Adjusts capital allocation based on regime
2. **StrategyPortfolioOptimizer** - Optimizes strategy weights by regime
3. **BiasEngine** - Calculates strategy bias scores per regime
4. **AdaptiveIntelligenceSystem** - Coordinates adaptive response to regime changes

## Telemetry and Monitoring

The system emits detailed telemetry events:

- **regime.classification** - New regime classifications
- **regime.transition** - Regime transition events
- **regime.smoothed_classification** - Smoothed regime data
- **regime.classification_error** - Error events

## Handling Ambiguity and Errors

The system includes robust error handling:

1. **Fallback Classifications** - Default to `Unknown` with low confidence when errors occur
2. **Classification Smoothing** - Reduces noise by using a window of recent classifications
3. **Confidence Thresholds** - Prevents acting on low-confidence regime detections
4. **Redundant Signals** - Considers multiple technical indicators to improve robustness

## Usage Example

```javascript
// Initialize components
const classifier = MarketRegimeClassifier.getInstance();
const transitionEngine = RegimeTransitionEngine.getInstance();

// Register for regime transition events
transitionEngine.onTransition((transition, symbol) => {
  console.log(`Regime changed for ${symbol}: ${transition.fromRegime} -> ${transition.toRegime}`);
  // Update strategy allocation based on new regime
});

// Collect market features
const features = {
  price: currentPrice,
  returns1d: dailyReturn,
  returns5d: fiveDayReturn,
  returns20d: twentyDayReturn,
  // ... other features
};

// Classify regime
const classification = classifier.classifyRegime('BTC/USD', features);

// Process classification (applies smoothing and detects transitions)
transitionEngine.processClassification(classification, 'BTC/USD');

// Get current smoothed regime
const currentRegime = transitionEngine.getSmoothRegime('BTC/USD');
```

## Extending the System

The regime classification system can be extended in several ways:

1. **Additional Regime Types** - New regimes can be added to the `MarketRegime` enum
2. **Enhanced Feature Set** - Additional market features can be incorporated
3. **Alternative Classification Models** - The scoring functions can be replaced with ML models
4. **Multi-Timeframe Analysis** - Regime detection across different timeframes
5. **Cross-Asset Correlations** - Incorporating correlations between different markets 