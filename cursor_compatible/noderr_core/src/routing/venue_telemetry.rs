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

use crate::routing::venue_scorer::VenueId;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use serde::{Serialize, Deserialize};
use tokio::sync::RwLock as AsyncRwLock;
use tracing::{debug, error, info, warn};
use crate::telemetry::TelemetryManager;

/// Represents a telemetry event related to venue performance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum VenueTelemetryEvent {
    /// Latency measurement for a venue operation
    Latency {
        venue_id: VenueId,
        operation: String,
        duration_ms: f64,
        timestamp: DateTime<Utc>,
    },
    
    /// Fill rate information for orders at a venue
    FillRate {
        venue_id: VenueId,
        order_id: String,
        fill_percentage: f64,
        timestamp: DateTime<Utc>,
    },
    
    /// Error encountered when interacting with a venue
    Error {
        venue_id: VenueId,
        error_type: String,
        error_message: String,
        timestamp: DateTime<Utc>,
    },
    
    /// Status change of a venue
    StatusChange {
        venue_id: VenueId,
        previous_status: String,
        new_status: String,
        timestamp: DateTime<Utc>,
    },
}

/// Tracks and manages venue performance statistics
#[derive(Debug)]
pub struct VenueTelemetry {
    /// Average latency for each venue in milliseconds
    latencies: HashMap<VenueId, f64>,
    /// Fill rates for each venue (0.0 to 1.0)
    fill_rates: HashMap<VenueId, f64>,
    /// Error counts for each venue
    error_counts: HashMap<VenueId, u64>,
    /// Last status update for each venue
    statuses: HashMap<VenueId, String>,
    /// History of telemetry events with a cap on size
    event_history: Vec<VenueTelemetryEvent>,
    /// Maximum number of events to store in history
    max_history_size: usize,
}

impl VenueTelemetry {
    /// Create a new venue telemetry tracker
    pub fn new(max_history_size: usize) -> Self {
        Self {
            latencies: HashMap::new(),
            fill_rates: HashMap::new(),
            error_counts: HashMap::new(),
            statuses: HashMap::new(),
            event_history: Vec::with_capacity(max_history_size),
            max_history_size,
        }
    }

    /// Record a new telemetry event
    pub fn record_event(&mut self, event: VenueTelemetryEvent) {
        match &event {
            VenueTelemetryEvent::Latency { venue_id, operation: _, duration_ms, timestamp: _ } => {
                let avg_latency = self.latencies.entry(venue_id.clone()).or_insert(0.0);
                // Update as exponential moving average
                *avg_latency = 0.9 * *avg_latency + 0.1 * duration_ms;
                debug!("Updated venue latency for {}: {}ms", venue_id, avg_latency);
            },
            VenueTelemetryEvent::FillRate { venue_id, order_id: _, fill_percentage, timestamp: _ } => {
                let avg_fill_rate = self.fill_rates.entry(venue_id.clone()).or_insert(0.0);
                // Update as exponential moving average
                *avg_fill_rate = 0.9 * *avg_fill_rate + 0.1 * (fill_percentage / 100.0);
                debug!("Updated venue fill rate for {}: {:.2}%", venue_id, *avg_fill_rate * 100.0);
            },
            VenueTelemetryEvent::Error { venue_id, error_type, error_message, timestamp: _ } => {
                let error_count = self.error_counts.entry(venue_id.clone()).or_insert(0);
                *error_count += 1;
                warn!("Venue error on {}: {} - {}", venue_id, error_type, error_message);
            },
            VenueTelemetryEvent::StatusChange { venue_id, previous_status, new_status, timestamp: _ } => {
                self.statuses.insert(venue_id.clone(), new_status.clone());
                info!("Venue status change for {}: {} -> {}", venue_id, previous_status, new_status);
            },
        }

        // Add to history with size limit
        self.event_history.push(event);
        if self.event_history.len() > self.max_history_size {
            self.event_history.remove(0);
        }
    }

    /// Get the average latency for a venue
    pub fn get_average_latency(&self, venue_id: &VenueId) -> Option<f64> {
        self.latencies.get(venue_id).copied()
    }

    /// Get the average fill rate for a venue
    pub fn get_fill_rate(&self, venue_id: &VenueId) -> Option<f64> {
        self.fill_rates.get(venue_id).copied()
    }

    /// Get the error count for a venue
    pub fn get_error_count(&self, venue_id: &VenueId) -> u64 {
        *self.error_counts.get(venue_id).unwrap_or(&0)
    }

    /// Get the current status of a venue
    pub fn get_status(&self, venue_id: &VenueId) -> Option<String> {
        self.statuses.get(venue_id).cloned()
    }

    /// Get recent telemetry events for a venue
    pub fn get_recent_events(&self, venue_id: &VenueId, limit: usize) -> Vec<VenueTelemetryEvent> {
        self.event_history
            .iter()
            .rev()
            .filter(|event| {
                match event {
                    VenueTelemetryEvent::Latency { venue_id: v, .. } => v == venue_id,
                    VenueTelemetryEvent::FillRate { venue_id: v, .. } => v == venue_id,
                    VenueTelemetryEvent::Error { venue_id: v, .. } => v == venue_id,
                    VenueTelemetryEvent::StatusChange { venue_id: v, .. } => v == venue_id,
                }
            })
            .take(limit)
            .cloned()
            .collect()
    }
}

/// Manager for venue telemetry that provides thread-safe access
#[derive(Debug, Clone)]
pub struct VenueTelemetryManager {
    telemetry: Arc<AsyncRwLock<VenueTelemetry>>,
}

impl VenueTelemetryManager {
    /// Create a new venue telemetry manager
    pub fn new(max_history_size: usize) -> Self {
        Self {
            telemetry: Arc::new(AsyncRwLock::new(VenueTelemetry::new(max_history_size))),
        }
    }

    /// Record a new telemetry event
    pub async fn record_event(&self, event: VenueTelemetryEvent) {
        let mut telemetry = self.telemetry.write().await;
        telemetry.record_event(event);
    }

    /// Get the average latency for a venue
    pub async fn get_average_latency(&self, venue_id: &VenueId) -> Option<f64> {
        let telemetry = self.telemetry.read().await;
        telemetry.get_average_latency(venue_id)
    }

    /// Get the average fill rate for a venue
    pub async fn get_fill_rate(&self, venue_id: &VenueId) -> Option<f64> {
        let telemetry = self.telemetry.read().await;
        telemetry.get_fill_rate(venue_id)
    }

    /// Get the error count for a venue
    pub async fn get_error_count(&self, venue_id: &VenueId) -> u64 {
        let telemetry = self.telemetry.read().await;
        telemetry.get_error_count(venue_id)
    }

    /// Get the current status of a venue
    pub async fn get_status(&self, venue_id: &VenueId) -> Option<String> {
        let telemetry = self.telemetry.read().await;
        telemetry.get_status(venue_id)
    }

    /// Get recent telemetry events for a venue
    pub async fn get_recent_events(&self, venue_id: &VenueId, limit: usize) -> Vec<VenueTelemetryEvent> {
        let telemetry = self.telemetry.read().await;
        telemetry.get_recent_events(venue_id, limit)
    }
}

/// Utility for tracking venue latency with timing operations
#[derive(Debug, Clone)]
pub struct VenueLatencyTracker {
    telemetry_manager: VenueTelemetryManager,
}

impl VenueLatencyTracker {
    /// Create a new venue latency tracker
    pub fn new(telemetry_manager: VenueTelemetryManager) -> Self {
        Self { telemetry_manager }
    }

    /// Start timing an operation
    pub fn start_timing(&self) -> Instant {
        Instant::now()
    }

    /// Record the latency of an operation
    pub async fn record_latency(&self, venue_id: VenueId, operation: String, start: Instant) {
        let duration = start.elapsed();
        let duration_ms = duration.as_secs_f64() * 1000.0;
        
        self.telemetry_manager.record_event(VenueTelemetryEvent::Latency {
            venue_id,
            operation,
            duration_ms,
            timestamp: Utc::now(),
        }).await;
    }
}

/// Utility for tracking venue fill rates
#[derive(Debug, Clone)]
pub struct VenueFillRateTracker {
    telemetry_manager: VenueTelemetryManager,
}

impl VenueFillRateTracker {
    /// Create a new venue fill rate tracker
    pub fn new(telemetry_manager: VenueTelemetryManager) -> Self {
        Self { telemetry_manager }
    }

    /// Record the fill rate of an order
    pub async fn record_fill_rate(&self, venue_id: VenueId, order_id: String, fill_percentage: f64) {
        self.telemetry_manager.record_event(VenueTelemetryEvent::FillRate {
            venue_id,
            order_id,
            fill_percentage,
            timestamp: Utc::now(),
        }).await;
    }
}

/// Unique identifier for a trading venue
pub type VenueId = String;

/// Events that can be recorded for venue telemetry
#[derive(Debug, Clone)]
pub enum VenueTelemetryEvent {
    /// A request was sent to the venue
    RequestSent {
        venue_id: VenueId,
        request_type: String,
        timestamp: DateTime<Utc>,
    },
    /// A response was received from the venue
    ResponseReceived {
        venue_id: VenueId,
        request_type: String,
        latency_ms: f64,
        success: bool,
        timestamp: DateTime<Utc>,
    },
    /// An order was filled at the venue
    OrderFilled {
        venue_id: VenueId,
        requested_size: f64,
        filled_size: f64,
        timestamp: DateTime<Utc>,
    },
    /// An error occurred with the venue
    Error {
        venue_id: VenueId,
        error_type: String,
        error_message: String,
        timestamp: DateTime<Utc>,
    },
}

/// Tracks latency metrics for a venue
#[derive(Debug, Clone)]
pub struct VenueLatencyTracker {
    /// Recent latency measurements in milliseconds
    recent_latencies: Vec<f64>,
    /// Maximum number of records to keep
    max_records: usize,
    /// Average latency in milliseconds
    avg_latency_ms: f64,
    /// 95th percentile latency in milliseconds
    p95_latency_ms: f64,
    /// Last updated timestamp
    last_updated: DateTime<Utc>,
}

impl VenueLatencyTracker {
    /// Create a new latency tracker
    pub fn new(max_records: usize) -> Self {
        Self {
            recent_latencies: Vec::with_capacity(max_records),
            max_records,
            avg_latency_ms: 0.0,
            p95_latency_ms: 0.0,
            last_updated: Utc::now(),
        }
    }

    /// Add a new latency measurement
    pub fn add_measurement(&mut self, latency_ms: f64) {
        self.recent_latencies.push(latency_ms);
        
        // Maintain fixed size by removing oldest measurements
        if self.recent_latencies.len() > self.max_records {
            self.recent_latencies.remove(0);
        }
        
        // Update statistics
        self.update_statistics();
        self.last_updated = Utc::now();
    }
    
    /// Update latency statistics based on recent measurements
    fn update_statistics(&mut self) {
        if self.recent_latencies.is_empty() {
            return;
        }
        
        // Calculate average
        let sum: f64 = self.recent_latencies.iter().sum();
        self.avg_latency_ms = sum / self.recent_latencies.len() as f64;
        
        // Calculate 95th percentile
        if self.recent_latencies.len() >= 20 {
            let mut sorted = self.recent_latencies.clone();
            sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
            
            let index = (self.recent_latencies.len() as f64 * 0.95) as usize;
            self.p95_latency_ms = sorted[index];
        } else {
            // If too few samples, use max as p95
            self.p95_latency_ms = *self.recent_latencies.iter().max_by(|a, b| {
                a.partial_cmp(b).unwrap()
            }).unwrap();
        }
    }
    
    /// Get the average latency in milliseconds
    pub fn avg_latency(&self) -> f64 {
        self.avg_latency_ms
    }
    
    /// Get the 95th percentile latency in milliseconds
    pub fn p95_latency(&self) -> f64 {
        self.p95_latency_ms
    }
    
    /// Get the last updated timestamp
    pub fn last_updated(&self) -> DateTime<Utc> {
        self.last_updated
    }
}

/// Tracks fill rate metrics for a venue
#[derive(Debug, Clone)]
pub struct VenueFillRateTracker {
    /// Total requested size
    total_requested: f64,
    /// Total filled size
    total_filled: f64,
    /// Fill rate as a percentage
    fill_rate: f64,
    /// Recent fill records (requested, filled)
    recent_fills: Vec<(f64, f64)>,
    /// Maximum number of records to keep
    max_records: usize,
    /// Last updated timestamp
    last_updated: DateTime<Utc>,
}

impl VenueFillRateTracker {
    /// Create a new fill rate tracker
    pub fn new(max_records: usize) -> Self {
        Self {
            total_requested: 0.0,
            total_filled: 0.0,
            fill_rate: 100.0,
            recent_fills: Vec::with_capacity(max_records),
            max_records,
            last_updated: Utc::now(),
        }
    }
    
    /// Add a new fill record
    pub fn add_fill(&mut self, requested: f64, filled: f64) {
        self.total_requested += requested;
        self.total_filled += filled;
        
        self.recent_fills.push((requested, filled));
        
        // Maintain fixed size by removing oldest fill records
        if self.recent_fills.len() > self.max_records {
            let (old_req, old_fill) = self.recent_fills.remove(0);
            self.total_requested -= old_req;
            self.total_filled -= old_fill;
        }
        
        // Update fill rate
        if self.total_requested > 0.0 {
            self.fill_rate = (self.total_filled / self.total_requested) * 100.0;
        }
        
        self.last_updated = Utc::now();
    }
    
    /// Get the current fill rate as a percentage
    pub fn fill_rate(&self) -> f64 {
        self.fill_rate
    }
    
    /// Get the total requested size
    pub fn total_requested(&self) -> f64 {
        self.total_requested
    }
    
    /// Get the total filled size
    pub fn total_filled(&self) -> f64 {
        self.total_filled
    }
    
    /// Get the last updated timestamp
    pub fn last_updated(&self) -> DateTime<Utc> {
        self.last_updated
    }
}

/// Aggregated telemetry data for a venue
#[derive(Debug, Clone)]
pub struct VenueTelemetry {
    /// Venue identifier
    venue_id: VenueId,
    /// Latency tracker
    latency: VenueLatencyTracker,
    /// Fill rate tracker
    fill_rate: VenueFillRateTracker,
    /// Error count by error type
    error_counts: HashMap<String, usize>,
    /// Last error message
    last_error: Option<String>,
    /// Last error timestamp
    last_error_time: Option<DateTime<Utc>>,
    /// Time of last successful operation
    last_success: Option<DateTime<Utc>>,
}

impl VenueTelemetry {
    /// Create new venue telemetry
    pub fn new(venue_id: VenueId) -> Self {
        Self {
            venue_id,
            latency: VenueLatencyTracker::new(100),
            fill_rate: VenueFillRateTracker::new(100),
            error_counts: HashMap::new(),
            last_error: None,
            last_error_time: None,
            last_success: None,
        }
    }
    
    /// Record a latency measurement
    pub fn record_latency(&mut self, latency_ms: f64, success: bool) {
        self.latency.add_measurement(latency_ms);
        
        if success {
            self.last_success = Some(Utc::now());
        }
    }
    
    /// Record a fill
    pub fn record_fill(&mut self, requested: f64, filled: f64) {
        self.fill_rate.add_fill(requested, filled);
        self.last_success = Some(Utc::now());
    }
    
    /// Record an error
    pub fn record_error(&mut self, error_type: String, error_message: String) {
        *self.error_counts.entry(error_type).or_insert(0) += 1;
        self.last_error = Some(error_message);
        self.last_error_time = Some(Utc::now());
    }
    
    /// Get venue identifier
    pub fn venue_id(&self) -> &VenueId {
        &self.venue_id
    }
    
    /// Get the latency tracker
    pub fn latency(&self) -> &VenueLatencyTracker {
        &self.latency
    }
    
    /// Get the fill rate tracker
    pub fn fill_rate(&self) -> &VenueFillRateTracker {
        &self.fill_rate
    }
    
    /// Get error counts
    pub fn error_counts(&self) -> &HashMap<String, usize> {
        &self.error_counts
    }
    
    /// Get the total error count
    pub fn total_error_count(&self) -> usize {
        self.error_counts.values().sum()
    }
    
    /// Check if the venue is healthy based on recent activity
    pub fn is_healthy(&self) -> bool {
        // Venue is healthy if it had a success more recently than an error
        match (self.last_success, self.last_error_time) {
            (Some(success), Some(error)) => success > error,
            (Some(_), None) => true,
            _ => false,
        }
    }
    
    /// Calculate a health score from 0.0 to 1.0
    pub fn health_score(&self) -> f64 {
        // Get time since last error and success
        let now = Utc::now();
        let time_since_error = self.last_error_time
            .map(|t| (now - t).num_seconds() as f64)
            .unwrap_or(f64::MAX);
        
        let time_since_success = self.last_success
            .map(|t| (now - t).num_seconds() as f64)
            .unwrap_or(f64::MAX);
            
        // Calculate error rate based on recent fill rate
        let fill_rate_factor = self.fill_rate.fill_rate() / 100.0;
        
        // Calculate latency factor (lower is better)
        let latency_factor = if self.latency.avg_latency() <= 0.0 {
            1.0
        } else {
            (1.0 / (1.0 + self.latency.avg_latency() / 1000.0)).min(1.0)
        };
        
        // Calculate recency factor
        // Higher score if successful operations are more recent than errors
        let recency_factor = if time_since_error > time_since_success {
            1.0
        } else if time_since_success == f64::MAX {
            0.0
        } else {
            (time_since_error / time_since_success).min(1.0)
        };
        
        // Combine factors with weights
        let health = (0.4 * fill_rate_factor) + 
                     (0.3 * latency_factor) + 
                     (0.3 * recency_factor);
                     
        health.max(0.0).min(1.0)
    }
}

/// Manager for collecting and accessing venue telemetry
#[derive(Debug, Clone)]
pub struct VenueTelemetryManager {
    /// Telemetry data by venue
    venues: Arc<RwLock<HashMap<VenueId, VenueTelemetry>>>,
    /// Global telemetry manager for reporting
    telemetry: Arc<TelemetryManager>,
}

impl VenueTelemetryManager {
    /// Create a new venue telemetry manager
    pub fn new(telemetry: Arc<TelemetryManager>) -> Self {
        Self {
            venues: Arc::new(RwLock::new(HashMap::new())),
            telemetry,
        }
    }
    
    /// Process a venue telemetry event
    pub async fn process_event(&self, event: VenueTelemetryEvent) {
        match event {
            VenueTelemetryEvent::RequestSent { venue_id, request_type, timestamp } => {
                // Report to telemetry
                self.telemetry.record_counter(
                    "venue.requests.sent", 
                    1, 
                    Some(vec![
                        ("venue_id", venue_id.clone()),
                        ("request_type", request_type),
                    ])
                );
            },
            
            VenueTelemetryEvent::ResponseReceived { venue_id, request_type, latency_ms, success, timestamp } => {
                // Update venue telemetry
                let mut venues = self.venues.write().await;
                let venue = venues.entry(venue_id.clone()).or_insert_with(|| VenueTelemetry::new(venue_id.clone()));
                venue.record_latency(latency_ms, success);
                
                // Report to telemetry
                self.telemetry.record_histogram(
                    "venue.response.latency_ms", 
                    latency_ms, 
                    Some(vec![
                        ("venue_id", venue_id),
                        ("request_type", request_type),
                        ("success", success.to_string()),
                    ])
                );
            },
            
            VenueTelemetryEvent::OrderFilled { venue_id, requested_size, filled_size, timestamp } => {
                // Update venue telemetry
                let mut venues = self.venues.write().await;
                let venue = venues.entry(venue_id.clone()).or_insert_with(|| VenueTelemetry::new(venue_id.clone()));
                venue.record_fill(requested_size, filled_size);
                
                // Calculate fill percentage
                let fill_percentage = if requested_size > 0.0 {
                    (filled_size / requested_size) * 100.0
                } else {
                    0.0
                };
                
                // Report to telemetry
                self.telemetry.record_histogram(
                    "venue.order.fill_percentage", 
                    fill_percentage, 
                    Some(vec![
                        ("venue_id", venue_id),
                    ])
                );
            },
            
            VenueTelemetryEvent::Error { venue_id, error_type, error_message, timestamp } => {
                // Update venue telemetry
                let mut venues = self.venues.write().await;
                let venue = venues.entry(venue_id.clone()).or_insert_with(|| VenueTelemetry::new(venue_id.clone()));
                venue.record_error(error_type.clone(), error_message.clone());
                
                // Report to telemetry
                self.telemetry.record_counter(
                    "venue.errors", 
                    1, 
                    Some(vec![
                        ("venue_id", venue_id),
                        ("error_type", error_type),
                    ])
                );
                
                // Log the error
                self.telemetry.log_error(
                    &format!("Venue error: {}", error_message),
                    Some(vec![
                        ("venue_id", venue_id),
                        ("error_type", error_type),
                    ])
                );
            },
        }
    }
    
    /// Get telemetry for a specific venue
    pub async fn get_venue_telemetry(&self, venue_id: &VenueId) -> Option<VenueTelemetry> {
        let venues = self.venues.read().await;
        venues.get(venue_id).cloned()
    }
    
    /// Get health scores for all venues
    pub async fn get_venue_health_scores(&self) -> HashMap<VenueId, f64> {
        let venues = self.venues.read().await;
        venues.iter()
            .map(|(id, telemetry)| (id.clone(), telemetry.health_score()))
            .collect()
    }
    
    /// Get the healthiest venues based on their health scores
    pub async fn get_healthiest_venues(&self, min_health_score: f64) -> Vec<(VenueId, f64)> {
        let venues = self.venues.read().await;
        let mut scores: Vec<(VenueId, f64)> = venues.iter()
            .map(|(id, telemetry)| (id.clone(), telemetry.health_score()))
            .filter(|(_, score)| *score >= min_health_score)
            .collect();
            
        // Sort by score (highest first)
        scores.sort_by(|(_, a), (_, b)| b.partial_cmp(a).unwrap());
        
        scores
    }
    
    /// Report current venue health metrics to telemetry
    pub async fn report_venue_health_metrics(&self) {
        let venues = self.venues.read().await;
        
        for (venue_id, telemetry) in venues.iter() {
            // Report health score
            self.telemetry.record_gauge(
                "venue.health_score",
                telemetry.health_score(),
                Some(vec![("venue_id", venue_id.clone())])
            );
            
            // Report fill rate
            self.telemetry.record_gauge(
                "venue.fill_rate",
                telemetry.fill_rate().fill_rate(),
                Some(vec![("venue_id", venue_id.clone())])
            );
            
            // Report latency
            self.telemetry.record_gauge(
                "venue.avg_latency_ms",
                telemetry.latency().avg_latency(),
                Some(vec![("venue_id", venue_id.clone())])
            );
            
            self.telemetry.record_gauge(
                "venue.p95_latency_ms",
                telemetry.latency().p95_latency(),
                Some(vec![("venue_id", venue_id.clone())])
            );
            
            // Report error count
            self.telemetry.record_gauge(
                "venue.error_count",
                telemetry.total_error_count() as f64,
                Some(vec![("venue_id", venue_id.clone())])
            );
        }
    }
} 