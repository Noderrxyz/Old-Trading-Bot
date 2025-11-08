// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025 Noderr Protocol Foundation
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.

use std::collections::HashMap;
use std::sync::Arc;
use nalgebra::{DMatrix, DVector};
use rand::distributions::{Distribution, Normal, Uniform};
use rand::prelude::*;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, error, info, warn};
use chrono::{DateTime, Utc};

use crate::market_regime::{MarketRegimeError, MarketRegimeState, MarketRegimeResult};

/// Hidden Markov Model for market regime detection
#[derive(Debug, Clone)]
pub struct HiddenMarkovModel {
    /// Number of hidden states
    n_states: usize,
    /// Number of features in the observation
    n_features: usize,
    /// Initial state probabilities
    pi: DVector<f64>,
    /// Transition probabilities between states
    transitions: DMatrix<f64>,
    /// Means of the gaussian emissions for each state and feature
    means: Vec<DVector<f64>>,
    /// Covariances of the gaussian emissions for each state
    covariances: Vec<DMatrix<f64>>,
    /// Trained flag
    is_trained: bool,
    /// State labels mapping
    state_labels: HashMap<usize, MarketRegimeState>,
}

/// Error types for HMM operations
#[derive(Debug, Error)]
pub enum HmmError {
    #[error("Insufficient data for training: {0}")]
    InsufficientData(String),
    
    #[error("Invalid model parameters: {0}")]
    InvalidParameters(String),
    
    #[error("Computation error: {0}")]
    ComputationError(String),
    
    #[error("Model not trained")]
    NotTrained,
}

/// Observation data for market regime analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketObservation {
    /// Timestamp of the observation
    pub timestamp: DateTime<Utc>,
    /// Current price
    pub price: f64,
    /// Log return (ln(price_t / price_t-1))
    pub log_return: f64,
    /// Volatility estimate 
    pub volatility: f64,
    /// 10-period momentum
    pub momentum_10: f64,
    /// 30-period momentum
    pub momentum_30: f64,
    /// 14-period RSI
    pub rsi_14: f64,
    /// MACD value
    pub macd: f64,
    /// On-balance volume
    pub on_balance_volume: f64,
}

impl HiddenMarkovModel {
    /// Create a new Hidden Markov Model with the specified number of states and features
    pub fn new(n_states: usize, n_features: usize) -> Self {
        // Initialize random model parameters
        let mut rng = rand::thread_rng();
        
        // Initialize transition matrix with random values and normalize
        let mut transitions = DMatrix::from_fn(n_states, n_states, |_, _| rng.gen::<f64>());
        for i in 0..n_states {
            let row_sum = transitions.row(i).sum();
            for j in 0..n_states {
                transitions[(i, j)] /= row_sum;
            }
        }
        
        // Initialize initial state probabilities and normalize
        let mut pi = DVector::from_fn(n_states, |_, _| rng.gen::<f64>());
        let pi_sum = pi.sum();
        for i in 0..n_states {
            pi[i] /= pi_sum;
        }
        
        // Initialize emission parameters
        let means = vec![DVector::zeros(n_features); n_states];
        let covariances = vec![DMatrix::identity(n_features, n_features); n_states];
        
        // Create default state labels
        let mut state_labels = HashMap::new();
        state_labels.insert(0, MarketRegimeState::Bull);
        state_labels.insert(1, MarketRegimeState::Bear);
        if n_states > 2 {
            state_labels.insert(2, MarketRegimeState::Volatile);
        }
        if n_states > 3 {
            state_labels.insert(3, MarketRegimeState::Sideways);
        }
        
        Self {
            n_states,
            n_features,
            pi,
            transitions,
            means,
            covariances,
            is_trained: false,
            state_labels,
        }
    }
    
    /// Fit model to training data using Baum-Welch algorithm (simplified approach)
    pub fn fit(&mut self, observations: &[Vec<f64>]) -> Result<(), HmmError> {
        if observations.is_empty() {
            return Err(HmmError::InsufficientData("No observations provided".to_string()));
        }
        
        // Check if all observations have the correct number of features
        for (i, obs) in observations.iter().enumerate() {
            if obs.len() != self.n_features {
                return Err(HmmError::InvalidParameters(
                    format!("Observation {} has {} features, expected {}", 
                            i, obs.len(), self.n_features)
                ));
            }
        }
        
        // Initialize means with K-means clustering
        self.initialize_with_kmeans(observations)?;
        
        // TODO: Implement full Baum-Welch algorithm
        // For now, we'll just use the initialized parameters
        
        self.is_trained = true;
        
        Ok(())
    }
    
    /// Initialize means with K-means clustering
    fn initialize_with_kmeans(&mut self, observations: &[Vec<f64>]) -> Result<(), HmmError> {
        if observations.len() < self.n_states {
            return Err(HmmError::InsufficientData(
                format!("Not enough observations ({}) for {} states", 
                        observations.len(), self.n_states)
            ));
        }
        
        // Random initialization of centroids
        let mut rng = rand::thread_rng();
        let indices: Vec<usize> = (0..observations.len()).collect();
        let mut selected_indices = Vec::new();
        
        // Choose n_states distinct observations as initial centroids
        while selected_indices.len() < self.n_states {
            let idx = indices[rng.gen_range(0..indices.len())];
            if !selected_indices.contains(&idx) {
                selected_indices.push(idx);
            }
        }
        
        // Initialize centroids from selected observations
        let mut centroids: Vec<DVector<f64>> = selected_indices.iter()
            .map(|&idx| {
                DVector::from_vec(observations[idx].clone())
            })
            .collect();
        
        // K-means iterations
        let max_iterations = 100;
        let mut assignments = vec![0; observations.len()];
        
        for iteration in 0..max_iterations {
            let mut changed = false;
            
            // Assign each observation to nearest centroid
            for (i, obs) in observations.iter().enumerate() {
                let obs_vec = DVector::from_vec(obs.clone());
                let mut min_dist = f64::INFINITY;
                let mut min_idx = 0;
                
                for (j, centroid) in centroids.iter().enumerate() {
                    let dist = (obs_vec - centroid).norm_squared();
                    if dist < min_dist {
                        min_dist = dist;
                        min_idx = j;
                    }
                }
                
                if assignments[i] != min_idx {
                    assignments[i] = min_idx;
                    changed = true;
                }
            }
            
            // Update centroids
            let mut new_centroids = vec![DVector::zeros(self.n_features); self.n_states];
            let mut counts = vec![0; self.n_states];
            
            for (i, &cluster) in assignments.iter().enumerate() {
                let obs_vec = DVector::from_vec(observations[i].clone());
                new_centroids[cluster] += &obs_vec;
                counts[cluster] += 1;
            }
            
            for j in 0..self.n_states {
                if counts[j] > 0 {
                    new_centroids[j] /= counts[j] as f64;
                }
            }
            
            centroids = new_centroids;
            
            // Check for convergence
            if !changed {
                debug!("K-means converged after {} iterations", iteration);
                break;
            }
        }
        
        // Set means from centroids
        self.means = centroids;
        
        // Calculate covariances
        for state in 0..self.n_states {
            let mut cov = DMatrix::zeros(self.n_features, self.n_features);
            let mut count = 0;
            
            for (i, &cluster) in assignments.iter().enumerate() {
                if cluster == state {
                    let obs_vec = DVector::from_vec(observations[i].clone());
                    let diff = &obs_vec - &self.means[state];
                    cov += &(diff * diff.transpose());
                    count += 1;
                }
            }
            
            if count > 0 {
                cov /= count as f64;
            }
            
            // Add small regularization to ensure covariance is positive definite
            for i in 0..self.n_features {
                cov[(i, i)] += 1e-6;
            }
            
            self.covariances[state] = cov;
        }
        
        Ok(())
    }
    
    /// Predict the most likely state for a given observation
    pub fn predict(&self, observation: &[f64]) -> Result<usize, HmmError> {
        if !self.is_trained {
            return Err(HmmError::NotTrained);
        }
        
        if observation.len() != self.n_features {
            return Err(HmmError::InvalidParameters(
                format!("Observation has {} features, expected {}", 
                        observation.len(), self.n_features)
            ));
        }
        
        let obs_vec = DVector::from_vec(observation.to_vec());
        
        // Calculate emission probabilities for each state
        let mut max_prob = f64::NEG_INFINITY;
        let mut max_state = 0;
        
        for state in 0..self.n_states {
            let emission_prob = self.emission_probability(state, &obs_vec);
            
            if emission_prob > max_prob {
                max_prob = emission_prob;
                max_state = state;
            }
        }
        
        Ok(max_state)
    }
    
    /// Calculate emission probability for a given state and observation
    fn emission_probability(&self, state: usize, observation: &DVector<f64>) -> f64 {
        let mean = &self.means[state];
        let cov = &self.covariances[state];
        
        // Calculate multivariate normal density
        let diff = observation - mean;
        let inv_cov = match cov.try_inverse() {
            Some(inv) => inv,
            None => {
                error!("Covariance matrix is not invertible for state {}", state);
                return f64::NEG_INFINITY;
            }
        };
        
        let exponent = -0.5 * (diff.transpose() * &inv_cov * diff)[0];
        let det = match cov.determinant() {
            det if det <= 0.0 => {
                error!("Covariance determinant is non-positive for state {}", state);
                return f64::NEG_INFINITY;
            },
            det => det,
        };
        
        let normalization = 1.0 / ((2.0 * std::f64::consts::PI).powf(self.n_features as f64 / 2.0) * det.sqrt());
        
        normalization * exponent.exp()
    }
    
    /// Get model confidence in the prediction (normalized emission probability)
    pub fn predict_with_confidence(&self, observation: &[f64]) -> Result<(usize, f64), HmmError> {
        if !self.is_trained {
            return Err(HmmError::NotTrained);
        }
        
        let state = self.predict(observation)?;
        let obs_vec = DVector::from_vec(observation.to_vec());
        
        // Calculate emission probabilities for each state
        let mut probs = Vec::with_capacity(self.n_states);
        let mut total_prob = 0.0;
        
        for s in 0..self.n_states {
            let prob = self.emission_probability(s, &obs_vec);
            probs.push(prob.exp()); // Convert from log-prob to prob
            total_prob += probs[s];
        }
        
        // Normalize probabilities
        let confidence = if total_prob > 0.0 {
            probs[state] / total_prob
        } else {
            // If all probabilities are essentially zero, assign equal probability
            1.0 / self.n_states as f64
        };
        
        Ok((state, confidence))
    }
    
    /// Set state labels for interpreting the hidden states
    pub fn set_state_labels(&mut self, labels: HashMap<usize, MarketRegimeState>) -> Result<(), HmmError> {
        for (&state, _) in labels.iter() {
            if state >= self.n_states {
                return Err(HmmError::InvalidParameters(
                    format!("State {} is out of bounds for model with {} states", state, self.n_states)
                ));
            }
        }
        
        self.state_labels = labels;
        Ok(())
    }
    
    /// Get the market regime state corresponding to a state index
    pub fn get_regime_state(&self, state: usize) -> MarketRegimeState {
        self.state_labels.get(&state).cloned().unwrap_or(MarketRegimeState::Unknown)
    }
    
    /// Convert raw features to observations used by the HMM
    pub fn features_to_observation(features: &HashMap<String, f64>) -> Result<Vec<f64>, HmmError> {
        let required_features = vec![
            "log_return", "volatility", "momentum_10", "momentum_30", 
            "rsi_14", "macd", "on_balance_volume"
        ];
        
        let mut observation = Vec::with_capacity(required_features.len());
        
        for feature in &required_features {
            match features.get(*feature) {
                Some(value) => observation.push(*value),
                None => return Err(HmmError::InvalidParameters(
                    format!("Missing required feature: {}", feature)
                )),
            }
        }
        
        Ok(observation)
    }
    
    /// Predict regime from a market observation
    pub fn predict_regime(&self, observation: &MarketObservation) -> MarketRegimeResult<(MarketRegimeState, f64)> {
        let features = vec![
            observation.log_return,
            observation.volatility,
            observation.momentum_10,
            observation.momentum_30,
            observation.rsi_14,
            observation.macd,
            observation.on_balance_volume,
        ];
        
        let (state, confidence) = self.predict_with_confidence(&features)
            .map_err(|e| MarketRegimeError::Internal(e.to_string()))?;
        
        let regime = self.get_regime_state(state);
        
        Ok((regime, confidence))
    }
    
    /// Create a new HMM model with default parameters for market regime detection
    pub fn new_default() -> Self {
        let n_states = 4; // Bull, Bear, Volatile, Sideways
        let n_features = 7; // log_return, volatility, momentum_10, momentum_30, rsi_14, macd, obv
        
        let mut model = Self::new(n_states, n_features);
        
        // Set state labels
        let mut state_labels = HashMap::new();
        state_labels.insert(0, MarketRegimeState::Bull);
        state_labels.insert(1, MarketRegimeState::Bear);
        state_labels.insert(2, MarketRegimeState::Volatile);
        state_labels.insert(3, MarketRegimeState::Sideways);
        model.set_state_labels(state_labels).unwrap();
        
        model
    }
}

/// Calculate features for market regime detection from candle data
pub fn calculate_market_features(
    candles: &[crate::market::Candle],
    current_price: f64
) -> Result<MarketObservation, HmmError> {
    if candles.len() < 30 {
        return Err(HmmError::InsufficientData(
            format!("Need at least 30 candles, but got {}", candles.len())
        ));
    }
    
    // Current time
    let timestamp = chrono::Utc::now();
    
    // Convert Decimal to f64 for calculations
    let prices: Vec<f64> = candles.iter()
        .map(|c| c.close.to_f64().unwrap_or(0.0))
        .collect();
    
    // Calculate log returns
    let log_return = if prices.len() >= 2 {
        (prices[prices.len() - 1] / prices[prices.len() - 2]).ln()
    } else {
        0.0
    };
    
    // Calculate volatility (standard deviation of returns over last 20 periods)
    let volatility = if prices.len() >= 20 {
        let returns: Vec<f64> = prices.windows(2)
            .map(|window| (window[1] / window[0]).ln())
            .collect();
        
        let n = returns.len();
        let mean = returns.iter().sum::<f64>() / n as f64;
        let variance = returns.iter()
            .map(|x| (x - mean).powi(2))
            .sum::<f64>() / n as f64;
        
        variance.sqrt()
    } else {
        0.0
    };
    
    // Calculate momentum (price change over periods)
    let momentum_10 = if prices.len() >= 10 {
        (prices[prices.len() - 1] - prices[prices.len() - 10]) / prices[prices.len() - 10]
    } else {
        0.0
    };
    
    let momentum_30 = if prices.len() >= 30 {
        (prices[prices.len() - 1] - prices[prices.len() - 30]) / prices[prices.len() - 30]
    } else {
        0.0
    };
    
    // Calculate RSI-14
    let rsi_14 = calculate_rsi(&prices, 14);
    
    // Calculate MACD (12, 26, 9)
    let macd = calculate_macd(&prices, 12, 26, 9);
    
    // Calculate on-balance volume (simple proxy)
    let on_balance_volume = calculate_obv(candles);
    
    Ok(MarketObservation {
        timestamp,
        price: current_price,
        log_return,
        volatility,
        momentum_10,
        momentum_30,
        rsi_14,
        macd,
        on_balance_volume,
    })
}

/// Calculate Relative Strength Index
fn calculate_rsi(prices: &[f64], period: usize) -> f64 {
    if prices.len() <= period {
        return 50.0; // Default value if not enough data
    }
    
    let mut gains = 0.0;
    let mut losses = 0.0;
    
    // Calculate initial gains and losses
    for i in 1..=period {
        let change = prices[prices.len() - i] - prices[prices.len() - i - 1];
        if change > 0.0 {
            gains += change;
        } else {
            losses += -change;
        }
    }
    
    // Calculate average gains and losses
    let avg_gain = gains / period as f64;
    let avg_loss = losses / period as f64;
    
    // Calculate RS and RSI
    if avg_loss == 0.0 {
        return 100.0;
    }
    
    let rs = avg_gain / avg_loss;
    100.0 - (100.0 / (1.0 + rs))
}

/// Calculate Moving Average Convergence Divergence
fn calculate_macd(prices: &[f64], fast_period: usize, slow_period: usize, signal_period: usize) -> f64 {
    if prices.len() <= slow_period + signal_period {
        return 0.0; // Default value if not enough data
    }
    
    // Calculate EMAs
    let fast_ema = calculate_ema(prices, fast_period);
    let slow_ema = calculate_ema(prices, slow_period);
    
    // MACD line = fast EMA - slow EMA
    fast_ema - slow_ema
}

/// Calculate Exponential Moving Average
fn calculate_ema(prices: &[f64], period: usize) -> f64 {
    if prices.len() <= period {
        return prices.last().copied().unwrap_or(0.0);
    }
    
    // Calculate multiplier
    let multiplier = 2.0 / (period as f64 + 1.0);
    
    // Calculate SMA as the first EMA value
    let sma = prices[prices.len() - period..].iter().sum::<f64>() / period as f64;
    
    // Calculate EMA
    let mut ema = sma;
    for i in (prices.len() - period + 1..prices.len()).rev() {
        ema = (prices[i] - ema) * multiplier + ema;
    }
    
    ema
}

/// Calculate On-Balance Volume
fn calculate_obv(candles: &[crate::market::Candle]) -> f64 {
    if candles.is_empty() {
        return 0.0;
    }
    
    let mut obv = 0.0;
    
    for i in 1..candles.len() {
        let current_close = candles[i].close.to_f64().unwrap_or(0.0);
        let previous_close = candles[i-1].close.to_f64().unwrap_or(0.0);
        let volume = candles[i].volume.to_f64().unwrap_or(0.0);
        
        if current_close > previous_close {
            obv += volume;
        } else if current_close < previous_close {
            obv -= volume;
        }
        // If prices are equal, OBV remains unchanged
    }
    
    // Normalize OBV to a reasonable range for the model
    let avg_volume = candles.iter()
        .map(|c| c.volume.to_f64().unwrap_or(0.0))
        .sum::<f64>() / candles.len() as f64;
    
    if avg_volume > 0.0 {
        obv / (avg_volume * 10.0) // Normalize to approximate range of -1 to 1
    } else {
        0.0
    }
}

/// Z-score normalize a vector of observations
pub fn normalize_observations(observations: Vec<Vec<f64>>) -> Vec<Vec<f64>> {
    if observations.is_empty() {
        return observations;
    }
    
    let n_features = observations[0].len();
    let n_samples = observations.len();
    
    // Calculate mean and standard deviation for each feature
    let mut means = vec![0.0; n_features];
    let mut stds = vec![0.0; n_features];
    
    // Calculate means
    for observation in &observations {
        for (j, &value) in observation.iter().enumerate() {
            means[j] += value;
        }
    }
    
    for j in 0..n_features {
        means[j] /= n_samples as f64;
    }
    
    // Calculate standard deviations
    for observation in &observations {
        for (j, &value) in observation.iter().enumerate() {
            stds[j] += (value - means[j]).powi(2);
        }
    }
    
    for j in 0..n_features {
        stds[j] = (stds[j] / n_samples as f64).sqrt();
        if stds[j] < 1e-10 {
            stds[j] = 1.0; // Avoid division by zero
        }
    }
    
    // Normalize observations
    let mut normalized = Vec::with_capacity(n_samples);
    
    for observation in observations {
        let mut normalized_obs = Vec::with_capacity(n_features);
        
        for (j, &value) in observation.iter().enumerate() {
            let normalized_value = (value - means[j]) / stds[j];
            normalized_obs.push(normalized_value);
        }
        
        normalized.push(normalized_obs);
    }
    
    normalized
} 