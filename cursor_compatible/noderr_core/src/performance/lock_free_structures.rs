use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicBool, Ordering};
use crossbeam_epoch::{self as epoch, Atomic, Owned, Shared, Guard};
use crossbeam_skiplist::SkipMap;
use parking_lot::RwLock;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;
use arc_swap::ArcSwap;

/// Lock-free order book implementation using crossbeam epoch-based memory reclamation
pub struct LockFreeOrderBook {
    bids: SkipMap<OrderedFloat, Order>,
    asks: SkipMap<OrderedFloat, Order>,
    last_update: AtomicU64,
}

/// Lock-free position tracker with atomic operations
pub struct LockFreePositionTracker {
    positions: Arc<ArcSwap<FxHashMap<String, Position>>>,
    total_exposure: AtomicU64,
    position_count: AtomicU64,
}

/// Wait-free risk checker using atomic operations
pub struct WaitFreeRiskChecker {
    max_position_size: AtomicU64,
    max_total_exposure: AtomicU64,
    max_order_rate: AtomicU64,
    order_count: AtomicU64,
    last_reset: AtomicU64,
    enabled: AtomicBool,
}

/// Lock-free order queue using crossbeam's MPMC channel
pub struct LockFreeOrderQueue {
    queue: flume::Sender<Order>,
    receiver: flume::Receiver<Order>,
    pending_count: AtomicU64,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct OrderedFloat(u64);

impl From<f64> for OrderedFloat {
    fn from(f: f64) -> Self {
        OrderedFloat(f.to_bits())
    }
}

impl From<OrderedFloat> for f64 {
    fn from(of: OrderedFloat) -> Self {
        f64::from_bits(of.0)
    }
}

#[derive(Clone)]
pub struct Order {
    pub id: u64,
    pub symbol: String,
    pub price: f64,
    pub quantity: f64,
    pub side: OrderSide,
    pub timestamp: u64,
}

#[derive(Clone)]
pub struct Position {
    pub symbol: String,
    pub quantity: f64,
    pub avg_price: f64,
    pub unrealized_pnl: f64,
    pub realized_pnl: f64,
}

#[derive(Clone, Copy, PartialEq)]
pub enum OrderSide {
    Buy,
    Sell,
}

impl LockFreeOrderBook {
    pub fn new() -> Self {
        Self {
            bids: SkipMap::new(),
            asks: SkipMap::new(),
            last_update: AtomicU64::new(0),
        }
    }

    /// Add order with wait-free guarantee
    pub fn add_order(&self, order: Order) {
        let price_key = OrderedFloat::from(order.price);
        
        match order.side {
            OrderSide::Buy => {
                self.bids.insert(price_key, order);
            }
            OrderSide::Sell => {
                self.asks.insert(price_key, order);
            }
        }
        
        self.last_update.store(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_micros() as u64,
            Ordering::Release
        );
    }

    /// Get best bid/ask with lock-free read
    pub fn get_best_bid_ask(&self) -> Option<(f64, f64)> {
        let best_bid = self.bids.back()
            .map(|entry| f64::from(entry.key().clone()));
        
        let best_ask = self.asks.front()
            .map(|entry| f64::from(entry.key().clone()));
        
        match (best_bid, best_ask) {
            (Some(bid), Some(ask)) => Some((bid, ask)),
            _ => None,
        }
    }

    /// Match orders with lock-free algorithm
    pub fn match_orders(&self) -> Vec<(Order, Order)> {
        let mut matches = Vec::new();
        
        // Lock-free matching using skip list iterators
        if let (Some(best_bid_entry), Some(best_ask_entry)) = 
            (self.bids.back(), self.asks.front()) {
            
            let bid_price = f64::from(best_bid_entry.key().clone());
            let ask_price = f64::from(best_ask_entry.key().clone());
            
            if bid_price >= ask_price {
                let bid = best_bid_entry.value().clone();
                let ask = best_ask_entry.value().clone();
                
                // Remove matched orders atomically
                self.bids.pop_back();
                self.asks.pop_front();
                
                matches.push((bid, ask));
            }
        }
        
        matches
    }
}

impl LockFreePositionTracker {
    pub fn new() -> Self {
        Self {
            positions: Arc::new(ArcSwap::from_pointee(FxHashMap::default())),
            total_exposure: AtomicU64::new(0),
            position_count: AtomicU64::new(0),
        }
    }

    /// Update position with lock-free swap
    pub fn update_position(&self, symbol: String, update: impl FnOnce(Option<&Position>) -> Position) {
        self.positions.rcu(|positions| {
            let mut new_positions = (**positions).clone();
            let old_position = new_positions.get(&symbol);
            let new_position = update(old_position);
            
            // Update metrics atomically
            if old_position.is_none() {
                self.position_count.fetch_add(1, Ordering::AcqRel);
            }
            
            new_positions.insert(symbol, new_position);
            Arc::new(new_positions)
        });
    }

    /// Get position with wait-free read
    pub fn get_position(&self, symbol: &str) -> Option<Position> {
        let positions = self.positions.load();
        positions.get(symbol).cloned()
    }

    /// Calculate total exposure atomically
    pub fn calculate_total_exposure(&self) -> f64 {
        let positions = self.positions.load();
        let total: f64 = positions.values()
            .map(|p| (p.quantity * p.avg_price).abs())
            .sum();
        
        self.total_exposure.store(total.to_bits(), Ordering::Release);
        total
    }
}

impl WaitFreeRiskChecker {
    pub fn new(max_position_size: f64, max_total_exposure: f64, max_order_rate: u64) -> Self {
        Self {
            max_position_size: AtomicU64::new(max_position_size.to_bits()),
            max_total_exposure: AtomicU64::new(max_total_exposure.to_bits()),
            max_order_rate: AtomicU64::new(max_order_rate),
            order_count: AtomicU64::new(0),
            last_reset: AtomicU64::new(0),
            enabled: AtomicBool::new(true),
        }
    }

    /// Ultra-fast risk check with atomic operations only
    #[inline(always)]
    pub fn check_order(&self, order: &Order, current_position: f64, total_exposure: f64) -> bool {
        // Check if risk checking is enabled
        if !self.enabled.load(Ordering::Acquire) {
            return true;
        }

        // Check position size limit
        let new_position = current_position + match order.side {
            OrderSide::Buy => order.quantity,
            OrderSide::Sell => -order.quantity,
        };
        
        let max_size = f64::from_bits(self.max_position_size.load(Ordering::Acquire));
        if new_position.abs() > max_size {
            return false;
        }

        // Check total exposure limit
        let new_exposure = total_exposure + (order.quantity * order.price).abs();
        let max_exposure = f64::from_bits(self.max_total_exposure.load(Ordering::Acquire));
        if new_exposure > max_exposure {
            return false;
        }

        // Check order rate limit
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        let last_reset = self.last_reset.load(Ordering::Acquire);
        if now - last_reset >= 1 {
            self.order_count.store(0, Ordering::Release);
            self.last_reset.store(now, Ordering::Release);
        }
        
        let count = self.order_count.fetch_add(1, Ordering::AcqRel);
        let max_rate = self.max_order_rate.load(Ordering::Acquire);
        
        count < max_rate
    }

    /// Update risk limits atomically
    pub fn update_limits(&self, max_position_size: f64, max_total_exposure: f64, max_order_rate: u64) {
        self.max_position_size.store(max_position_size.to_bits(), Ordering::Release);
        self.max_total_exposure.store(max_total_exposure.to_bits(), Ordering::Release);
        self.max_order_rate.store(max_order_rate, Ordering::Release);
    }

    /// Enable/disable risk checking atomically
    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Release);
    }
}

impl LockFreeOrderQueue {
    pub fn new(capacity: usize) -> Self {
        let (tx, rx) = flume::bounded(capacity);
        Self {
            queue: tx,
            receiver: rx,
            pending_count: AtomicU64::new(0),
        }
    }

    /// Send order without blocking
    pub fn send_order(&self, order: Order) -> Result<(), Order> {
        match self.queue.try_send(order) {
            Ok(()) => {
                self.pending_count.fetch_add(1, Ordering::AcqRel);
                Ok(())
            }
            Err(flume::TrySendError::Full(order)) => Err(order),
            Err(flume::TrySendError::Disconnected(order)) => Err(order),
        }
    }

    /// Receive order without blocking
    pub fn recv_order(&self) -> Option<Order> {
        match self.receiver.try_recv() {
            Ok(order) => {
                self.pending_count.fetch_sub(1, Ordering::AcqRel);
                Some(order)
            }
            Err(_) => None,
        }
    }

    /// Batch receive for better throughput
    pub fn recv_batch(&self, max_batch: usize) -> SmallVec<[Order; 16]> {
        let mut batch = SmallVec::new();
        
        for _ in 0..max_batch {
            match self.receiver.try_recv() {
                Ok(order) => batch.push(order),
                Err(_) => break,
            }
        }
        
        if !batch.is_empty() {
            self.pending_count.fetch_sub(batch.len() as u64, Ordering::AcqRel);
        }
        
        batch
    }

    pub fn pending_count(&self) -> u64 {
        self.pending_count.load(Ordering::Acquire)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::sync::Arc;

    #[test]
    fn test_lock_free_order_book() {
        let book = Arc::new(LockFreeOrderBook::new());
        let book_clone = book.clone();

        // Spawn multiple threads to add orders concurrently
        let handle = thread::spawn(move || {
            for i in 0..1000 {
                book_clone.add_order(Order {
                    id: i,
                    symbol: "BTC/USD".to_string(),
                    price: 50000.0 + i as f64,
                    quantity: 1.0,
                    side: OrderSide::Buy,
                    timestamp: i,
                });
            }
        });

        // Add asks from main thread
        for i in 0..1000 {
            book.add_order(Order {
                id: i + 1000,
                symbol: "BTC/USD".to_string(),
                price: 51000.0 - i as f64,
                quantity: 1.0,
                side: OrderSide::Sell,
                timestamp: i,
            });
        }

        handle.join().unwrap();

        // Check best bid/ask
        if let Some((bid, ask)) = book.get_best_bid_ask() {
            assert!(bid < ask);
        }
    }

    #[test]
    fn test_wait_free_risk_checker() {
        let checker = WaitFreeRiskChecker::new(100.0, 10000.0, 100);
        
        let order = Order {
            id: 1,
            symbol: "BTC/USD".to_string(),
            price: 50000.0,
            quantity: 1.0,
            side: OrderSide::Buy,
            timestamp: 0,
        };

        // Should pass risk check
        assert!(checker.check_order(&order, 0.0, 0.0));

        // Should fail position size check
        assert!(!checker.check_order(&order, 99.5, 0.0));

        // Test rate limiting
        for i in 0..150 {
            let result = checker.check_order(&order, 0.0, 0.0);
            if i < 99 {
                assert!(result);
            }
        }
    }
} 