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

use dashmap::DashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use std::collections::VecDeque;

/// Maximum number of measurements to keep per venue
const MAX_LATENCY_HISTORY: usize = 1000;

/// Sliding window size for recent latency calculations (last n measurements)
const RECENT_WINDOW_SIZE: usize = 50;

/// Venue latency statistics
#[derive(Clone, Debug)]
pub struct VenueLatencyStats {
    pub avg_ns: f64,
    pub p50_ns: f64,
    pub p90_ns: f64,
    pub p95_ns: f64,
    pub p99_ns: f64,
    pub min_ns: u128,
    pub max_ns: u128,
    pub recent_avg_ns: f64,
    pub sample_count: usize,
}

/// Venue latency tracker
/// High-performance, thread-safe latency tracker for trading venues
pub struct VenueLatencyTracker {
    // Using DashMap for concurrent access without locking
    latencies: DashMap<String, VecDeque<u128>>,
}

impl VenueLatencyTracker {
    /// Create a new venue latency tracker
    pub fn new() -> Self {
        Self {
            latencies: DashMap::new(),
        }
    }

    /// Record a latency measurement for a venue
    /// 
    /// # Arguments
    /// * `venue_id` - Identifier for the venue
    /// * `duration_ns` - Duration in nanoseconds
    pub fn record_latency(&self, venue_id: &str, duration_ns: u128) {
        self.latencies.entry(venue_id.to_string()).or_insert_with(|| VecDeque::with_capacity(MAX_LATENCY_HISTORY + 1))
            .with_mut(|latencies| {
                latencies.push_back(duration_ns);
                // Keep the history bounded
                if latencies.len() > MAX_LATENCY_HISTORY {
                    latencies.pop_front();
                }
            });
    }

    /// Start timing a venue operation
    /// Returns an Instant to be used with finish_timing
    pub fn start_timing(&self) -> Instant {
        Instant::now()
    }

    /// Finish timing a venue operation and record the latency
    /// 
    /// # Arguments
    /// * `venue_id` - Identifier for the venue
    /// * `start` - The Instant returned by start_timing
    pub fn finish_timing(&self, venue_id: &str, start: Instant) {
        let duration = start.elapsed();
        self.record_latency(venue_id, duration.as_nanos());
    }

    /// Get comprehensive latency statistics for a venue
    /// 
    /// # Arguments
    /// * `venue_id` - Identifier for the venue
    /// 
    /// # Returns
    /// Option containing latency statistics, or None if no data exists
    pub fn get_latency_stats(&self, venue_id: &str) -> Option<VenueLatencyStats> {
        self.latencies.get(venue_id).map(|latencies| {
            let mut values: Vec<u128> = latencies.iter().copied().collect();
            let count = values.len();
            
            if count == 0 {
                return VenueLatencyStats {
                    avg_ns: 0.0,
                    p50_ns: 0.0,
                    p90_ns: 0.0,
                    p95_ns: 0.0,
                    p99_ns: 0.0,
                    min_ns: 0,
                    max_ns: 0,
                    recent_avg_ns: 0.0,
                    sample_count: 0,
                };
            }

            // Sort for percentile calculations
            values.sort_unstable();
            
            // Calculate basic statistics
            let sum: u128 = values.iter().sum();
            let avg = sum as f64 / count as f64;
            let min = values[0];
            let max = values[count - 1];
            
            // Calculate percentiles
            let p50_idx = (count as f64 * 0.50) as usize;
            let p90_idx = (count as f64 * 0.90) as usize;
            let p95_idx = (count as f64 * 0.95) as usize;
            let p99_idx = (count as f64 * 0.99) as usize;
            
            let p50 = values[p50_idx] as f64;
            let p90 = values[p90_idx] as f64;
            let p95 = values[p95_idx] as f64;
            let p99 = values[p99_idx] as f64;
            
            // Calculate recent average (last RECENT_WINDOW_SIZE measurements)
            let recent_values = if count <= RECENT_WINDOW_SIZE {
                &values[..]
            } else {
                &values[count - RECENT_WINDOW_SIZE..]
            };
            
            let recent_sum: u128 = recent_values.iter().sum();
            let recent_avg = recent_sum as f64 / recent_values.len() as f64;
            
            VenueLatencyStats {
                avg_ns: avg,
                p50_ns: p50,
                p90_ns: p90,
                p95_ns: p95,
                p99_ns: p99,
                min_ns: min,
                max_ns: max,
                recent_avg_ns: recent_avg,
                sample_count: count,
            }
        })
    }

    /// Get average latency for a venue
    pub fn get_avg_latency(&self, venue_id: &str) -> Option<f64> {
        self.get_latency_stats(venue_id).map(|stats| stats.avg_ns)
    }

    /// Get 99th percentile latency for a venue
    pub fn get_p99_latency(&self, venue_id: &str) -> Option<f64> {
        self.get_latency_stats(venue_id).map(|stats| stats.p99_ns)
    }

    /// Get recent average latency for a venue (last RECENT_WINDOW_SIZE measurements)
    pub fn get_recent_avg_latency(&self, venue_id: &str) -> Option<f64> {
        self.get_latency_stats(venue_id).map(|stats| stats.recent_avg_ns)
    }

    /// Reset latency history for a venue
    pub fn reset(&self, venue_id: &str) {
        self.latencies.entry(venue_id.to_string()).or_default().with_mut(|latencies| {
            latencies.clear();
        });
    }

    /// Reset all latency history
    pub fn reset_all(&self) {
        self.latencies.iter_mut().for_each(|mut entry| {
            entry.value_mut().clear();
        });
    }

    /// Get all venue IDs being tracked
    pub fn get_tracked_venues(&self) -> Vec<String> {
        self.latencies.iter().map(|entry| entry.key().clone()).collect()
    }
}

impl Default for VenueLatencyTracker {
    fn default() -> Self {
        Self::new()
    }
}

/// Create a venue latency tracker
pub fn create_venue_latency_tracker() -> Arc<VenueLatencyTracker> {
    Arc::new(VenueLatencyTracker::new())
} 