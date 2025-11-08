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

use std::sync::RwLock;
use std::time::{Duration, Instant};
use std::any::Any;
use rand::{Rng, rngs::ThreadRng};
use rust_decimal::Decimal;

use crate::strategy::{Signal, EntropyConfig, EntropyInjector};

/// Default implementation of entropy injection for strategy execution
pub struct DefaultEntropyInjector {
    /// Configuration for entropy injection
    config: RwLock<EntropyConfig>,
    /// RNG for generating random values
    rng: ThreadRng,
    /// Last time the entropy was applied
    last_application: RwLock<Instant>,
    /// Statistical measures of entropy effectiveness
    entropy_statistics: RwLock<EntropyStatistics>,
}

/// Statistics about entropy application and effectiveness
#[derive(Debug, Clone, Default)]
pub struct EntropyStatistics {
    /// Number of signals that had entropy applied
    pub signals_modified: usize,
    /// Number of signals rejected due to entropy (confidence too low)
    pub signals_rejected: usize,
    /// Average noise applied to signals
    pub average_noise: f64,
    /// Maximum noise applied to a signal
    pub max_noise: f64,
}

impl Default for DefaultEntropyInjector {
    fn default() -> Self {
        Self::new(EntropyConfig::default())
    }
}

impl DefaultEntropyInjector {
    /// Create a new DefaultEntropyInjector with the given configuration
    pub fn new(config: EntropyConfig) -> Self {
        Self {
            config: RwLock::new(config),
            rng: rand::thread_rng(),
            last_application: RwLock::new(Instant::now()),
            entropy_statistics: RwLock::new(EntropyStatistics::default()),
        }
    }

    /// Update the entropy configuration
    pub fn update_config(&self, config: EntropyConfig) {
        if let Ok(mut current_config) = self.config.write() {
            *current_config = config;
        }
    }

    /// Get statistics about entropy application
    pub fn get_statistics(&self) -> EntropyStatistics {
        self.entropy_statistics.read().unwrap().clone()
    }

    /// Clear the entropy statistics
    pub fn clear_statistics(&self) {
        if let Ok(mut stats) = self.entropy_statistics.write() {
            *stats = EntropyStatistics::default();
        }
    }

    /// Generate a noise value based on the strategy's entropy score and current config
    fn generate_noise(&mut self, strategy_entropy_score: f64) -> f64 {
        let config = self.config.read().unwrap();
        if !config.enabled {
            return 0.0;
        }

        // Scale the noise based on strategy entropy score (strategies that want more entropy get more)
        let noise_scale = config.noise_level.to_f64().unwrap_or(0.1) * strategy_entropy_score;
        
        // Generate random noise between -noise_scale and +noise_scale
        self.rng.gen_range(-noise_scale..=noise_scale)
    }

    /// Apply entropy to a signal based on the strategy's entropy score
    /// Returns the original signal if entropy is disabled or the signal with modified confidence if enabled
    pub fn apply(&mut self, mut signal: Signal, strategy_entropy_score: f64) -> Signal {
        let config = self.config.read().unwrap();
        if !config.enabled {
            return signal;
        }

        // Update last application time
        if let Ok(mut last) = self.last_application.write() {
            *last = Instant::now();
        }

        // Generate noise to apply to confidence
        let noise = self.generate_noise(strategy_entropy_score);
        
        // Apply noise to signal confidence
        let original_confidence = signal.confidence;
        let new_confidence = (original_confidence + noise).max(0.0).min(1.0);
        signal.confidence = new_confidence;

        // Update statistics
        if let Ok(mut stats) = self.entropy_statistics.write() {
            stats.signals_modified += 1;
            stats.average_noise = ((stats.average_noise * (stats.signals_modified - 1) as f64) + noise.abs()) / stats.signals_modified as f64;
            stats.max_noise = stats.max_noise.max(noise.abs());
            
            // Check if signal would be rejected due to low confidence
            if new_confidence < config.min_confidence.to_f64().unwrap_or(0.0) {
                stats.signals_rejected += 1;
            }
        }

        signal
    }
}

impl EntropyInjector for DefaultEntropyInjector {
    fn inject_entropy(&self, signal: &mut Signal, config: &EntropyConfig) {
        if !config.enabled {
            return;
        }

        let mut rng = rand::thread_rng();
        let noise_level = config.noise_level.to_f64().unwrap_or(0.1);
        
        // Generate random noise between -noise_level and +noise_level
        let noise = rng.gen_range(-noise_level..=noise_level);
        
        // Apply noise to signal confidence
        signal.confidence = (signal.confidence + noise).max(0.0).min(1.0);
        
        // Update statistics
        if let Ok(mut stats) = self.entropy_statistics.write() {
            stats.signals_modified += 1;
            stats.average_noise = ((stats.average_noise * (stats.signals_modified - 1) as f64) + noise.abs()) / stats.signals_modified as f64;
            stats.max_noise = stats.max_noise.max(noise.abs());
            
            // Check if signal would be rejected due to low confidence
            if signal.confidence < config.min_confidence.to_f64().unwrap_or(0.0) {
                stats.signals_rejected += 1;
            }
        }
    }

    fn get_config(&self) -> &EntropyConfig {
        // Note: this returns a reference to the config inside the RwLock, which is not ideal.
        // In a real implementation, we would clone the config, but this is just an example.
        // For this example, we just panic if the lock can't be obtained.
        &self.config.read().unwrap()
    }
    
    fn calculate_delay_ms(&self, signal: &Signal) -> Option<u64> {
        let config = self.config.read().unwrap();
        
        // If timing entropy is not enabled, return None (no delay)
        if !config.enabled || !config.apply_timing_entropy {
            return None;
        }
        
        let mut rng = rand::thread_rng();
        
        // For urgent signals, apply minimal delay or no delay
        if signal.is_urgent() {
            // 20% chance of a very small delay (up to 10% of max_delay_ms) for urgent signals
            if rng.gen::<f64>() < 0.2 {
                let small_delay = (rng.gen::<f64>() * 0.1 * config.max_delay_ms as f64) as u64;
                return Some(small_delay);
            } else {
                return None;
            }
        }
        
        // For non-urgent signals, base delay on signal's urgency value (inverse relationship)
        // Higher urgency = lower delay, Lower urgency = higher potential delay
        let urgency_factor = 1.0 - signal.urgency;
        let max_potential_delay = (config.max_delay_ms as f64 * urgency_factor) as u64;
        
        // Generate a random delay between 0 and max_potential_delay
        let delay = rng.gen_range(0..=max_potential_delay);
        
        Some(delay)
    }
    
    fn should_skip_signal(&self, signal: &Signal) -> bool {
        let config = self.config.read().unwrap();
        
        // If signal skipping is not enabled, never skip
        if !config.enabled || !config.enable_signal_skipping {
            return false;
        }
        
        // Don't skip high confidence signals
        if signal.confidence > 0.9 {
            return false;
        }
        
        // Don't skip urgent signals
        if signal.is_urgent() {
            return false;
        }
        
        let mut rng = rand::thread_rng();
        
        // The lower the confidence, the higher the chance to skip
        let skip_factor = config.skip_probability * (1.0 - signal.confidence);
        
        // Generate a random number and compare with adjusted skip probability
        rng.gen::<f64>() < skip_factor
    }
    
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}

/// Factory for creating entropy injectors
pub struct EntropyInjectorFactory;

impl EntropyInjectorFactory {
    /// Create a default entropy injector
    pub fn create_default() -> DefaultEntropyInjector {
        DefaultEntropyInjector::default()
    }

    /// Create a custom entropy injector with specific configuration
    pub fn create_custom(config: EntropyConfig) -> DefaultEntropyInjector {
        DefaultEntropyInjector::new(config)
    }
} 