use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use metrics::{counter, gauge, histogram, describe_counter, describe_gauge, describe_histogram};
use tracing::{info, warn, error};
use std::collections::HashMap;

/// Enhanced telemetry configuration
#[derive(Debug, Clone)]
pub struct TelemetryConfig {
    /// Enable detailed metrics
    pub enabled: bool,
    /// Histogram buckets for latency (microseconds)
    pub latency_buckets: Vec<f64>,
    /// Alert thresholds
    pub alert_thresholds: LatencyThresholds,
    /// Export interval
    pub export_interval: Duration,
}

impl Default for TelemetryConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            latency_buckets: vec![
                10.0, 25.0, 50.0, 100.0, 250.0, 500.0, 1000.0, 2500.0, 5000.0, 10000.0
            ],
            alert_thresholds: LatencyThresholds::default(),
            export_interval: Duration::from_secs(10),
        }
    }
}

/// Latency thresholds for alerting (microseconds)
#[derive(Debug, Clone)]
pub struct LatencyThresholds {
    pub p50_warning: u64,
    pub p50_critical: u64,
    pub p90_warning: u64,
    pub p90_critical: u64,
    pub p99_warning: u64,
    pub p99_critical: u64,
}

impl Default for LatencyThresholds {
    fn default() -> Self {
        Self {
            p50_warning: 100,    // 100μs
            p50_critical: 500,   // 500μs
            p90_warning: 500,    // 500μs
            p90_critical: 1000,  // 1ms
            p99_warning: 1000,   // 1ms
            p99_critical: 5000,  // 5ms
        }
    }
}

/// Operation timing guard
pub struct TimingGuard {
    operation: String,
    start: Instant,
    telemetry: Arc<EnhancedTelemetry>,
}

impl Drop for TimingGuard {
    fn drop(&mut self) {
        let duration = self.start.elapsed();
        self.telemetry.record_latency(&self.operation, duration);
    }
}

/// Enhanced telemetry system
pub struct EnhancedTelemetry {
    config: TelemetryConfig,
    latency_stats: Arc<RwLock<HashMap<String, LatencyStats>>>,
}

/// Latency statistics for an operation
#[derive(Debug, Clone)]
struct LatencyStats {
    count: u64,
    sum_micros: u64,
    sum_squared_micros: u128,
    min_micros: u64,
    max_micros: u64,
    buckets: Vec<(u64, u64)>, // (threshold_micros, count)
}

impl LatencyStats {
    fn new(buckets: &[f64]) -> Self {
        Self {
            count: 0,
            sum_micros: 0,
            sum_squared_micros: 0,
            min_micros: u64::MAX,
            max_micros: 0,
            buckets: buckets.iter().map(|&b| ((b * 1000.0) as u64, 0)).collect(),
        }
    }
    
    fn record(&mut self, micros: u64) {
        self.count += 1;
        self.sum_micros += micros;
        self.sum_squared_micros += (micros as u128) * (micros as u128);
        self.min_micros = self.min_micros.min(micros);
        self.max_micros = self.max_micros.max(micros);
        
        // Update histogram buckets
        for (threshold, count) in &mut self.buckets {
            if micros <= *threshold {
                *count += 1;
            }
        }
    }
    
    fn mean(&self) -> f64 {
        if self.count == 0 {
            0.0
        } else {
            self.sum_micros as f64 / self.count as f64
        }
    }
    
    fn std_dev(&self) -> f64 {
        if self.count < 2 {
            0.0
        } else {
            let mean = self.mean();
            let variance = (self.sum_squared_micros as f64 / self.count as f64) - (mean * mean);
            variance.sqrt()
        }
    }
    
    fn percentile(&self, p: f64) -> u64 {
        if self.count == 0 {
            return 0;
        }
        
        let target_count = ((self.count as f64) * p / 100.0).ceil() as u64;
        
        for &(threshold, count) in &self.buckets {
            if count >= target_count {
                return threshold;
            }
        }
        
        self.max_micros
    }
}

impl EnhancedTelemetry {
    /// Create a new enhanced telemetry instance
    pub fn new(config: TelemetryConfig) -> Self {
        // Initialize metric descriptions
        describe_counter!("trading_operations_total", "Total number of trading operations");
        describe_histogram!("trading_latency_microseconds", "Trading operation latency in microseconds");
        describe_gauge!("trading_current_latency_microseconds", "Current latency in microseconds");
        
        Self {
            config,
            latency_stats: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    
    /// Start timing an operation
    pub fn start_timer(&self, operation: &str) -> TimingGuard {
        TimingGuard {
            operation: operation.to_string(),
            start: Instant::now(),
            telemetry: Arc::new(self.clone()),
        }
    }
    
    /// Record a latency measurement
    pub fn record_latency(&self, operation: &str, duration: Duration) {
        if !self.config.enabled {
            return;
        }
        
        let micros = duration.as_micros() as u64;
        
        // Update internal stats
        {
            let mut stats = self.latency_stats.write().unwrap();
            let op_stats = stats.entry(operation.to_string())
                .or_insert_with(|| LatencyStats::new(&self.config.latency_buckets));
            op_stats.record(micros);
        }
        
        // Export to metrics system
        counter!("trading_operations_total", 1, "operation" => operation.to_string());
        histogram!("trading_latency_microseconds", micros as f64, "operation" => operation.to_string());
        gauge!("trading_current_latency_microseconds", micros as f64, "operation" => operation.to_string());
        
        // Check thresholds
        self.check_thresholds(operation, micros);
    }
    
    /// Check latency against thresholds
    fn check_thresholds(&self, operation: &str, micros: u64) {
        let thresholds = &self.config.alert_thresholds;
        
        // Get current stats
        let stats = self.latency_stats.read().unwrap();
        if let Some(op_stats) = stats.get(operation) {
            let p50 = op_stats.percentile(50.0);
            let p90 = op_stats.percentile(90.0);
            let p99 = op_stats.percentile(99.0);
            
            // Check P50
            if p50 >= thresholds.p50_critical {
                error!(
                    "Critical latency alert: {} P50={}μs (threshold={}μs)",
                    operation, p50, thresholds.p50_critical
                );
            } else if p50 >= thresholds.p50_warning {
                warn!(
                    "Latency warning: {} P50={}μs (threshold={}μs)",
                    operation, p50, thresholds.p50_warning
                );
            }
            
            // Check P90
            if p90 >= thresholds.p90_critical {
                error!(
                    "Critical latency alert: {} P90={}μs (threshold={}μs)",
                    operation, p90, thresholds.p90_critical
                );
            } else if p90 >= thresholds.p90_warning {
                warn!(
                    "Latency warning: {} P90={}μs (threshold={}μs)",
                    operation, p90, thresholds.p90_warning
                );
            }
            
            // Check P99
            if p99 >= thresholds.p99_critical {
                error!(
                    "Critical latency alert: {} P99={}μs (threshold={}μs)",
                    operation, p99, thresholds.p99_critical
                );
            } else if p99 >= thresholds.p99_warning {
                warn!(
                    "Latency warning: {} P99={}μs (threshold={}μs)",
                    operation, p99, thresholds.p99_warning
                );
            }
        }
    }
    
    /// Get latency report for an operation
    pub fn get_latency_report(&self, operation: &str) -> Option<LatencyReport> {
        let stats = self.latency_stats.read().unwrap();
        stats.get(operation).map(|s| LatencyReport {
            operation: operation.to_string(),
            count: s.count,
            mean_micros: s.mean(),
            std_dev_micros: s.std_dev(),
            min_micros: if s.min_micros == u64::MAX { 0 } else { s.min_micros },
            max_micros: s.max_micros,
            p50_micros: s.percentile(50.0),
            p90_micros: s.percentile(90.0),
            p95_micros: s.percentile(95.0),
            p99_micros: s.percentile(99.0),
        })
    }
    
    /// Get all latency reports
    pub fn get_all_reports(&self) -> Vec<LatencyReport> {
        let stats = self.latency_stats.read().unwrap();
        stats.iter().map(|(op, s)| LatencyReport {
            operation: op.clone(),
            count: s.count,
            mean_micros: s.mean(),
            std_dev_micros: s.std_dev(),
            min_micros: if s.min_micros == u64::MAX { 0 } else { s.min_micros },
            max_micros: s.max_micros,
            p50_micros: s.percentile(50.0),
            p90_micros: s.percentile(90.0),
            p95_micros: s.percentile(95.0),
            p99_micros: s.percentile(99.0),
        }).collect()
    }
    
    /// Reset statistics for an operation
    pub fn reset(&self, operation: &str) {
        let mut stats = self.latency_stats.write().unwrap();
        stats.remove(operation);
    }
    
    /// Reset all statistics
    pub fn reset_all(&self) {
        let mut stats = self.latency_stats.write().unwrap();
        stats.clear();
    }
}

impl Clone for EnhancedTelemetry {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            latency_stats: Arc::clone(&self.latency_stats),
        }
    }
}

/// Latency report for an operation
#[derive(Debug, Clone)]
pub struct LatencyReport {
    pub operation: String,
    pub count: u64,
    pub mean_micros: f64,
    pub std_dev_micros: f64,
    pub min_micros: u64,
    pub max_micros: u64,
    pub p50_micros: u64,
    pub p90_micros: u64,
    pub p95_micros: u64,
    pub p99_micros: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    
    #[test]
    fn test_telemetry_recording() {
        let telemetry = EnhancedTelemetry::new(TelemetryConfig::default());
        
        // Record some latencies
        for i in 0..100 {
            let duration = Duration::from_micros(i * 10);
            telemetry.record_latency("test_op", duration);
        }
        
        // Get report
        let report = telemetry.get_latency_report("test_op").unwrap();
        assert_eq!(report.count, 100);
        assert!(report.mean_micros > 0.0);
        assert!(report.p50_micros > 0);
        assert!(report.p90_micros > report.p50_micros);
    }
    
    #[test]
    fn test_timing_guard() {
        let telemetry = EnhancedTelemetry::new(TelemetryConfig::default());
        
        {
            let _guard = telemetry.start_timer("test_operation");
            thread::sleep(Duration::from_millis(1));
        }
        
        let report = telemetry.get_latency_report("test_operation").unwrap();
        assert_eq!(report.count, 1);
        assert!(report.mean_micros > 1000.0); // Should be > 1ms
    }
} 