# EIM Research to Old-Trading-Bot Component Mapping

**Date:** November 10, 2025

## 1. Overview

This document maps the research findings from the `Noder-x-EIM` repository to specific components in the `Old-Trading-Bot` system, identifying where each technique should be implemented.

## 2. Component Mapping

### 2.1. Moving Block Bootstrap → @noderr/backtesting

**Research:** Künsch (1993) - Jackknife and Bootstrap for Stationary Observations

**Old-Trading-Bot Component:** `packages/backtesting/`

**Current Status:** The backtesting package exists but is incomplete (no package.json, likely placeholder code).

**Implementation:**
- Create a `MovingBlockBootstrap` class that resamples historical data while preserving temporal dependencies
- Use this to generate confidence intervals for backtest metrics (Sharpe ratio, max drawdown, win rate)
- Integrate with the existing backtesting engine

**Why This Matters:**
- Financial time series data is non-stationary and has temporal dependencies
- Standard bootstrap (i.i.d. resampling) will underestimate the variance of performance metrics
- Moving block bootstrap preserves the autocorrelation structure of returns

**Code Location:** `packages/backtesting/src/MovingBlockBootstrap.ts` (new file)

---

### 2.2. White's Reality Check → @noderr/quant-research

**Research:** White (2000) - A Reality Check for Data Snooping

**Old-Trading-Bot Component:** `packages/quant-research/` (8,906 lines)

**Current Status:** Production-ready quant research package with strategy development tools.

**Implementation:**
- Add a `RealityCheck` class that implements White's statistical test
- Use this to validate that the best strategy from a backtest is not just the result of data snooping
- Integrate with the strategy selection pipeline

**Why This Matters:**
- Testing hundreds or thousands of strategy variations will inevitably produce some that look good by pure chance
- White's Reality Check provides a p-value that accounts for the multiple testing problem
- This prevents deploying strategies that will fail in live trading

**Code Location:** `packages/quant-research/src/RealityCheck.ts` (new file)

---

### 2.3. Particle Swarm Optimization → @noderr/ml

**Research:** Eberhart & Kennedy (2001) - Particle Swarm Optimization

**Old-Trading-Bot Component:** `packages/ml/` (13,904 lines)

**Current Status:** Full ML implementation exists but not exported. Contains `TransformerPredictor`, `ReinforcementLearner`, `FeatureEngineer`.

**Implementation:**
- Create a `ParticleSwarmOptimizer` class for hyperparameter tuning
- Use PSO to optimize:
  - Transformer hyperparameters (learning rate, num_heads, num_layers, dropout)
  - RL hyperparameters (gamma, epsilon, learning_rate, batch_size)
  - Feature engineering parameters (lookback windows, technical indicator periods)
- Integrate with the existing model training pipeline

**Why This Matters:**
- Grid search and random search are inefficient for high-dimensional hyperparameter spaces
- PSO is a global optimization algorithm that can find better hyperparameters faster
- It's particularly well-suited for non-differentiable objective functions (like Sharpe ratio)

**Code Location:** `packages/ml/src/ParticleSwarmOptimizer.ts` (new file)

---

### 2.4. Estimation of Distribution Algorithms → @noderr/evolution

**Research:** Larrañaga et al. (2006) - Estimation of Distribution Algorithms

**Old-Trading-Bot Component:** `packages/evolution/` (likely contains genetic algorithms)

**Current Status:** Unknown - need to check if this package exists and what it contains.

**Implementation:**
- Create an `EstimationOfDistributionAlgorithm` class as an alternative to genetic algorithms
- Use EDA to evolve trading strategies by:
  1. Evaluating a population of strategies
  2. Building a probabilistic model of the best strategies
  3. Sampling from this model to generate new strategies
- Integrate with the existing strategy generation pipeline

**Why This Matters:**
- EDAs can be more efficient than genetic algorithms for complex search spaces
- They explicitly model the structure of good solutions, which can lead to faster convergence
- They avoid the disruptive effects of crossover, which can break good strategy patterns

**Code Location:** `packages/evolution/src/EstimationOfDistributionAlgorithm.ts` (new file)

---

### 2.5. Bailey's Methodological Framework → @noderr/quant-research

**Research:** Bailey et al. (2017) - The Pseudo-Mathematics of Financial Charlatanism

**Old-Trading-Bot Component:** `packages/quant-research/` (8,906 lines)

**Current Status:** Production-ready quant research package.

**Implementation:**
- Add a `MethodologicalChecklist` class that validates research processes
- Implement checks for:
  - Selection bias (are we only reporting the best results?)
  - Backtest overfitting (is the model too complex for the data?)
  - Non-stationarity (does the strategy adapt to changing markets?)
  - Economic plausibility (does the strategy make economic sense?)
- Integrate with the strategy development workflow

**Why This Matters:**
- Most financial ML research is methodologically flawed
- Bailey's framework provides a systematic way to avoid common pitfalls
- This ensures that our research process is rigorous and our strategies are robust

**Code Location:** `packages/quant-research/src/MethodologicalChecklist.ts` (new file)

---

## 3. Summary of New Components

| Component | Package | Lines (Est.) | Complexity |
|-----------|---------|--------------|------------|
| MovingBlockBootstrap | @noderr/backtesting | 500-800 | Medium |
| RealityCheck | @noderr/quant-research | 300-500 | Medium |
| ParticleSwarmOptimizer | @noderr/ml | 800-1,200 | High |
| EstimationOfDistributionAlgorithm | @noderr/evolution | 1,000-1,500 | High |
| MethodologicalChecklist | @noderr/quant-research | 400-600 | Low |

**Total New Code:** ~3,000-4,600 lines

---

## 4. Integration Points

### 4.1. Backtesting Pipeline

```
Strategy → Backtest → MovingBlockBootstrap → Confidence Intervals → RealityCheck → Validation
```

### 4.2. Model Training Pipeline

```
Data → FeatureEngineer → ParticleSwarmOptimizer → Hyperparameters → TransformerPredictor/ReinforcementLearner → Trained Model
```

### 4.3. Strategy Generation Pipeline

```
Initial Population → EstimationOfDistributionAlgorithm → New Strategies → Backtest → Selection
```

### 4.4. Research Validation Pipeline

```
Strategy Development → MethodologicalChecklist → Validation → Deployment Decision
```

---

## 5. Dependencies

### External Libraries Needed

1. **For Moving Block Bootstrap:**
   - No new dependencies (can be implemented with standard TypeScript/JavaScript)

2. **For Reality Check:**
   - `jstat` (JavaScript statistical library) for p-value calculations

3. **For Particle Swarm Optimization:**
   - No new dependencies (can be implemented from scratch)

4. **For Estimation of Distribution Algorithms:**
   - `gaussian-mixture` or similar for probabilistic modeling
   - Or implement from scratch using TensorFlow.js

5. **For Methodological Checklist:**
   - No new dependencies (rule-based validation)

---

## 6. Testing Strategy

Each new component will require comprehensive testing:

1. **Unit Tests:** Test individual functions and classes
2. **Integration Tests:** Test interaction with existing components
3. **Validation Tests:** Compare results to known benchmarks from the research papers
4. **Performance Tests:** Ensure the new components don't slow down the system

---

## 7. Documentation Requirements

Each new component will require:

1. **API Documentation:** JSDoc comments for all public methods
2. **Usage Examples:** Code examples showing how to use the component
3. **Research Background:** Links to the original papers and explanations of the theory
4. **Performance Benchmarks:** Timing and accuracy comparisons

---

## 8. Next Steps

1. Verify that `@noderr/evolution` package exists and understand its current implementation
2. Create detailed implementation plans for each new component
3. Integrate these new components into the 43-week roadmap
4. Begin implementation in the appropriate phases
