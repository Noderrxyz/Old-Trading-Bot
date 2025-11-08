use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use parking_lot::RwLock;
use std::time::Instant;
use dashmap::DashMap;

/// Fast risk check result
#[derive(Debug, Clone)]
pub struct FastRiskResult {
    pub passed: bool,
    pub reason: Option<String>,
    pub check_time_ns: u64,
}

/// Risk limits configuration
#[derive(Debug, Clone)]
pub struct RiskLimits {
    /// Maximum position size in USD
    pub max_position_size_usd: f64,
    /// Maximum daily loss in USD
    pub max_daily_loss_usd: f64,
    /// Maximum drawdown percentage
    pub max_drawdown_pct: f64,
    /// Maximum leverage
    pub max_leverage: f64,
    /// Minimum time between trades (microseconds)
    pub min_trade_interval_us: u64,
    /// Maximum orders per second
    pub max_orders_per_second: u32,
    /// Maximum exposure per symbol
    pub max_symbol_exposure_pct: f64,
}

/// Fast risk state tracking
struct RiskState {
    /// Current positions by symbol
    positions: DashMap<String, f64>,
    /// Daily P&L
    daily_pnl: AtomicU64, // Stored as fixed point (multiply by 1e6)
    /// Peak equity for drawdown calculation
    peak_equity: AtomicU64,
    /// Current equity
    current_equity: AtomicU64,
    /// Last trade timestamp (nanoseconds)
    last_trade_ns: AtomicU64,
    /// Order count in current second
    orders_this_second: AtomicU64,
    /// Current second for rate limiting
    current_second: AtomicU64,
    /// Circuit breaker flag
    circuit_breaker_active: AtomicBool,
}

/// Ultra-fast risk checking layer
pub struct FastRiskLayer {
    limits: Arc<RwLock<RiskLimits>>,
    state: Arc<RiskState>,
}

impl FastRiskLayer {
    /// Create a new fast risk layer
    pub fn new(limits: RiskLimits, initial_equity: f64) -> Self {
        let equity_fixed = (initial_equity * 1e6) as u64;
        
        Self {
            limits: Arc::new(RwLock::new(limits)),
            state: Arc::new(RiskState {
                positions: DashMap::new(),
                daily_pnl: AtomicU64::new(0),
                peak_equity: AtomicU64::new(equity_fixed),
                current_equity: AtomicU64::new(equity_fixed),
                last_trade_ns: AtomicU64::new(0),
                orders_this_second: AtomicU64::new(0),
                current_second: AtomicU64::new(0),
                circuit_breaker_active: AtomicBool::new(false),
            }),
        }
    }
    
    /// Perform ultra-fast pre-trade risk check
    #[inline(always)]
    pub fn check_order(
        &self,
        symbol: &str,
        size_usd: f64,
        leverage: f64,
    ) -> FastRiskResult {
        let start = Instant::now();
        
        // Check circuit breaker first (fastest check)
        if self.state.circuit_breaker_active.load(Ordering::Relaxed) {
            return FastRiskResult {
                passed: false,
                reason: Some("Circuit breaker active".to_string()),
                check_time_ns: start.elapsed().as_nanos() as u64,
            };
        }
        
        let limits = self.limits.read();
        
        // Check position size
        if size_usd > limits.max_position_size_usd {
            return FastRiskResult {
                passed: false,
                reason: Some(format!(
                    "Position size ${:.2} exceeds limit ${:.2}",
                    size_usd, limits.max_position_size_usd
                )),
                check_time_ns: start.elapsed().as_nanos() as u64,
            };
        }
        
        // Check leverage
        if leverage > limits.max_leverage {
            return FastRiskResult {
                passed: false,
                reason: Some(format!(
                    "Leverage {:.1}x exceeds limit {:.1}x",
                    leverage, limits.max_leverage
                )),
                check_time_ns: start.elapsed().as_nanos() as u64,
            };
        }
        
        // Check rate limiting
        let now_ns = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64;
        
        let now_second = now_ns / 1_000_000_000;
        let current_second = self.state.current_second.load(Ordering::Relaxed);
        
        if now_second != current_second {
            // New second, reset counter
            self.state.current_second.store(now_second, Ordering::Relaxed);
            self.state.orders_this_second.store(1, Ordering::Relaxed);
        } else {
            // Same second, increment counter
            let orders = self.state.orders_this_second.fetch_add(1, Ordering::Relaxed) + 1;
            if orders > limits.max_orders_per_second {
                return FastRiskResult {
                    passed: false,
                    reason: Some(format!(
                        "Rate limit exceeded: {} orders/second",
                        orders
                    )),
                    check_time_ns: start.elapsed().as_nanos() as u64,
                };
            }
        }
        
        // Check minimum trade interval
        let last_trade = self.state.last_trade_ns.load(Ordering::Relaxed);
        if last_trade > 0 {
            let interval_ns = now_ns - last_trade;
            let interval_us = interval_ns / 1000;
            if interval_us < limits.min_trade_interval_us {
                return FastRiskResult {
                    passed: false,
                    reason: Some(format!(
                        "Trade interval {}μs below minimum {}μs",
                        interval_us, limits.min_trade_interval_us
                    )),
                    check_time_ns: start.elapsed().as_nanos() as u64,
                };
            }
        }
        
        // Check daily loss limit
        let daily_pnl = self.state.daily_pnl.load(Ordering::Relaxed) as f64 / 1e6;
        if daily_pnl < -limits.max_daily_loss_usd {
            return FastRiskResult {
                passed: false,
                reason: Some(format!(
                    "Daily loss ${:.2} exceeds limit ${:.2}",
                    -daily_pnl, limits.max_daily_loss_usd
                )),
                check_time_ns: start.elapsed().as_nanos() as u64,
            };
        }
        
        // Check drawdown
        let current_equity = self.state.current_equity.load(Ordering::Relaxed) as f64 / 1e6;
        let peak_equity = self.state.peak_equity.load(Ordering::Relaxed) as f64 / 1e6;
        let drawdown_pct = if peak_equity > 0.0 {
            (peak_equity - current_equity) / peak_equity * 100.0
        } else {
            0.0
        };
        
        if drawdown_pct > limits.max_drawdown_pct {
            return FastRiskResult {
                passed: false,
                reason: Some(format!(
                    "Drawdown {:.1}% exceeds limit {:.1}%",
                    drawdown_pct, limits.max_drawdown_pct
                )),
                check_time_ns: start.elapsed().as_nanos() as u64,
            };
        }
        
        // Check symbol exposure
        let current_exposure = self.state.positions.get(symbol)
            .map(|v| *v)
            .unwrap_or(0.0);
        
        let new_exposure = current_exposure + size_usd;
        let exposure_pct = new_exposure / current_equity * 100.0;
        
        if exposure_pct > limits.max_symbol_exposure_pct {
            return FastRiskResult {
                passed: false,
                reason: Some(format!(
                    "Symbol exposure {:.1}% would exceed limit {:.1}%",
                    exposure_pct, limits.max_symbol_exposure_pct
                )),
                check_time_ns: start.elapsed().as_nanos() as u64,
            };
        }
        
        // All checks passed
        FastRiskResult {
            passed: true,
            reason: None,
            check_time_ns: start.elapsed().as_nanos() as u64,
        }
    }
    
    /// Update position after trade execution
    #[inline(always)]
    pub fn update_position(&self, symbol: &str, size_change_usd: f64) {
        if size_change_usd.abs() < 0.01 {
            return;
        }
        
        self.state.positions
            .entry(symbol.to_string())
            .and_modify(|e| *e += size_change_usd)
            .or_insert(size_change_usd);
        
        // Update last trade timestamp
        let now_ns = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64;
        
        self.state.last_trade_ns.store(now_ns, Ordering::Relaxed);
    }
    
    /// Update P&L
    #[inline(always)]
    pub fn update_pnl(&self, pnl_usd: f64) {
        let pnl_fixed = (pnl_usd * 1e6) as i64;
        
        // Update daily P&L
        if pnl_fixed > 0 {
            self.state.daily_pnl.fetch_add(pnl_fixed as u64, Ordering::Relaxed);
        } else {
            self.state.daily_pnl.fetch_sub((-pnl_fixed) as u64, Ordering::Relaxed);
        }
        
        // Update current equity
        let new_equity = if pnl_fixed > 0 {
            self.state.current_equity.fetch_add(pnl_fixed as u64, Ordering::Relaxed) + pnl_fixed as u64
        } else {
            self.state.current_equity.fetch_sub((-pnl_fixed) as u64, Ordering::Relaxed) - (-pnl_fixed) as u64
        };
        
        // Update peak equity if needed
        let mut peak = self.state.peak_equity.load(Ordering::Relaxed);
        loop {
            if new_equity <= peak {
                break;
            }
            match self.state.peak_equity.compare_exchange_weak(
                peak,
                new_equity,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(x) => peak = x,
            }
        }
    }
    
    /// Activate circuit breaker
    pub fn activate_circuit_breaker(&self) {
        self.state.circuit_breaker_active.store(true, Ordering::Relaxed);
    }
    
    /// Deactivate circuit breaker
    pub fn deactivate_circuit_breaker(&self) {
        self.state.circuit_breaker_active.store(false, Ordering::Relaxed);
    }
    
    /// Reset daily statistics
    pub fn reset_daily_stats(&self) {
        self.state.daily_pnl.store(0, Ordering::Relaxed);
    }
    
    /// Get current risk metrics
    pub fn get_metrics(&self) -> RiskMetrics {
        let current_equity = self.state.current_equity.load(Ordering::Relaxed) as f64 / 1e6;
        let peak_equity = self.state.peak_equity.load(Ordering::Relaxed) as f64 / 1e6;
        let daily_pnl = self.state.daily_pnl.load(Ordering::Relaxed) as f64 / 1e6;
        
        let drawdown_pct = if peak_equity > 0.0 {
            (peak_equity - current_equity) / peak_equity * 100.0
        } else {
            0.0
        };
        
        let total_exposure: f64 = self.state.positions.iter()
            .map(|entry| entry.value().abs())
            .sum();
        
        RiskMetrics {
            current_equity,
            peak_equity,
            daily_pnl,
            drawdown_pct,
            total_exposure,
            position_count: self.state.positions.len(),
            circuit_breaker_active: self.state.circuit_breaker_active.load(Ordering::Relaxed),
        }
    }
    
    /// Update risk limits
    pub fn update_limits(&self, new_limits: RiskLimits) {
        let mut limits = self.limits.write();
        *limits = new_limits;
    }
}

/// Risk metrics snapshot
#[derive(Debug, Clone)]
pub struct RiskMetrics {
    pub current_equity: f64,
    pub peak_equity: f64,
    pub daily_pnl: f64,
    pub drawdown_pct: f64,
    pub total_exposure: f64,
    pub position_count: usize,
    pub circuit_breaker_active: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;
    
    #[test]
    fn test_fast_risk_checks() {
        let limits = RiskLimits {
            max_position_size_usd: 10000.0,
            max_daily_loss_usd: 1000.0,
            max_drawdown_pct: 10.0,
            max_leverage: 3.0,
            min_trade_interval_us: 1000, // 1ms
            max_orders_per_second: 100,
            max_symbol_exposure_pct: 20.0,
        };
        
        let risk_layer = FastRiskLayer::new(limits, 100000.0);
        
        // Test position size limit
        let result = risk_layer.check_order("BTC", 15000.0, 1.0);
        assert!(!result.passed);
        assert!(result.check_time_ns < 1000); // Should be < 1 microsecond
        
        // Test valid order
        let result = risk_layer.check_order("BTC", 5000.0, 2.0);
        assert!(result.passed);
        
        // Test rate limiting
        for _ in 0..100 {
            let _ = risk_layer.check_order("ETH", 100.0, 1.0);
        }
        let result = risk_layer.check_order("ETH", 100.0, 1.0);
        assert!(!result.passed);
        assert!(result.reason.unwrap().contains("Rate limit"));
    }
    
    #[test]
    fn test_pnl_tracking() {
        let limits = RiskLimits {
            max_position_size_usd: 10000.0,
            max_daily_loss_usd: 1000.0,
            max_drawdown_pct: 10.0,
            max_leverage: 3.0,
            min_trade_interval_us: 0,
            max_orders_per_second: 1000,
            max_symbol_exposure_pct: 50.0,
        };
        
        let risk_layer = FastRiskLayer::new(limits, 10000.0);
        
        // Simulate losses
        risk_layer.update_pnl(-500.0);
        risk_layer.update_pnl(-600.0);
        
        // Should fail due to daily loss limit
        let result = risk_layer.check_order("BTC", 1000.0, 1.0);
        assert!(!result.passed);
        assert!(result.reason.unwrap().contains("Daily loss"));
        
        // Check metrics
        let metrics = risk_layer.get_metrics();
        assert_eq!(metrics.daily_pnl, -1100.0);
        assert_eq!(metrics.current_equity, 8900.0);
    }
} 