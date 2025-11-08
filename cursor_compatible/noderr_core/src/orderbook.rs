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

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, RwLock};
use serde::{Serialize, Deserialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// Side of the order book (Bid or Ask)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum OrderSide {
    Bid,
    Ask,
}

/// Type of order book update
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum UpdateType {
    New,
    Update,
    Delete,
}

/// Representation of a price level in the order book
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PriceLevel {
    pub price: f64,
    pub size: f64,
    pub order_count: usize,
    pub timestamp: u64,
}

impl PriceLevel {
    pub fn new(price: f64, size: f64, order_count: usize) -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        
        Self {
            price,
            size,
            order_count,
            timestamp,
        }
    }
}

/// Order book representation for a specific symbol
pub struct OrderBook {
    symbol: String,
    bids: BTreeMap<OrderedFloat, PriceLevel>,
    asks: BTreeMap<OrderedFloat, PriceLevel>,
    last_update_id: u64,
    last_update_timestamp: u64,
    depth_snapshots: RwLock<HashMap<usize, (Vec<PriceLevel>, Vec<PriceLevel>)>>,
}

/// Wrapper struct for f64 to be used in BTreeMap
#[derive(Debug, Clone, Copy)]
struct OrderedFloat(f64);

impl PartialEq for OrderedFloat {
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}

impl Eq for OrderedFloat {}

impl PartialOrd for OrderedFloat {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        self.0.partial_cmp(&other.0)
    }
}

impl Ord for OrderedFloat {
    fn cmp(&self, other: &Self) -> Ordering {
        self.partial_cmp(other).unwrap_or(Ordering::Equal)
    }
}

impl OrderBook {
    /// Create a new order book for a symbol
    pub fn new(symbol: &str) -> Self {
        let bids = BTreeMap::new();
        let asks = BTreeMap::new();
        
        Self {
            symbol: symbol.to_string(),
            bids,
            asks,
            last_update_id: 0,
            last_update_timestamp: 0,
            depth_snapshots: RwLock::new(HashMap::new()),
        }
    }
    
    /// Process an update to the order book
    pub fn process_update(&mut self, price: f64, size: f64, side: OrderSide, update_id: u64) -> UpdateType {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        
        self.last_update_id = update_id;
        self.last_update_timestamp = now;
        
        let ordered_price = OrderedFloat(price);
        let levels = match side {
            OrderSide::Bid => &mut self.bids,
            OrderSide::Ask => &mut self.asks,
        };
        
        let update_type = if size == 0.0 {
            levels.remove(&ordered_price);
            UpdateType::Delete
        } else if levels.contains_key(&ordered_price) {
            let level = levels.get_mut(&ordered_price).unwrap();
            level.size = size;
            level.timestamp = now;
            UpdateType::Update
        } else {
            let level = PriceLevel::new(price, size, 1);
            levels.insert(ordered_price, level);
            UpdateType::New
        };
        
        // Clear cached snapshots when the book changes
        let mut snapshots = self.depth_snapshots.write().unwrap();
        snapshots.clear();
        
        update_type
    }
    
    /// Get a snapshot of the order book for a specific depth
    pub fn get_depth(&self, levels: usize) -> (Vec<PriceLevel>, Vec<PriceLevel>) {
        {
            let snapshots = self.depth_snapshots.read().unwrap();
            if let Some(snapshot) = snapshots.get(&levels) {
                return snapshot.clone();
            }
        }
        
        // Create new snapshot if not cached
        let mut bids: Vec<PriceLevel> = self.bids.values()
            .rev() // Highest bids first for bids
            .take(levels)
            .cloned()
            .collect();
        
        let mut asks: Vec<PriceLevel> = self.asks.values()
            .take(levels) // Lowest asks first for asks
            .cloned()
            .collect();
        
        // Cache the snapshot
        let mut snapshots = self.depth_snapshots.write().unwrap();
        snapshots.insert(levels, (bids.clone(), asks.clone()));
        
        (bids, asks)
    }
    
    /// Get the best bid price
    pub fn best_bid(&self) -> Option<f64> {
        self.bids.keys().rev().next().map(|k| k.0)
    }
    
    /// Get the best ask price
    pub fn best_ask(&self) -> Option<f64> {
        self.asks.keys().next().map(|k| k.0)
    }
    
    /// Get the mid price
    pub fn mid_price(&self) -> Option<f64> {
        match (self.best_bid(), self.best_ask()) {
            (Some(bid), Some(ask)) => Some((bid + ask) / 2.0),
            _ => None,
        }
    }
    
    /// Calculate the order book imbalance
    /// Returns a value between -1.0 (sell pressure) and 1.0 (buy pressure)
    pub fn calculate_imbalance(&self, depth: usize) -> f64 {
        let (bids, asks) = self.get_depth(depth);
        
        let bid_volume: f64 = bids.iter().map(|level| level.size).sum();
        let ask_volume: f64 = asks.iter().map(|level| level.size).sum();
        
        if bid_volume + ask_volume == 0.0 {
            return 0.0;
        }
        
        (bid_volume - ask_volume) / (bid_volume + ask_volume)
    }
    
    /// Get the weighted average price for a specific size
    pub fn get_vwap_for_size(&self, size: f64, side: OrderSide) -> Option<f64> {
        let levels = match side {
            OrderSide::Bid => &self.asks, // If we want to buy, we look at asks
            OrderSide::Ask => &self.bids, // If we want to sell, we look at bids
        };
        
        let mut remaining_size = size;
        let mut weighted_sum = 0.0;
        let mut total_filled = 0.0;
        
        for level in match side {
            OrderSide::Bid => levels.values(),
            OrderSide::Ask => levels.values().rev(),
        } {
            let fill_size = level.size.min(remaining_size);
            weighted_sum += fill_size * level.price;
            total_filled += fill_size;
            remaining_size -= fill_size;
            
            if remaining_size <= 0.0 {
                break;
            }
        }
        
        if total_filled > 0.0 {
            Some(weighted_sum / total_filled)
        } else {
            None
        }
    }
    
    /// Calculate liquidity within price range
    pub fn calculate_liquidity(&self, price_range_pct: f64) -> (f64, f64) {
        let mid = match self.mid_price() {
            Some(price) => price,
            None => return (0.0, 0.0),
        };
        
        let range = mid * price_range_pct;
        let min_price = mid - range;
        let max_price = mid + range;
        
        let bid_liquidity = self.bids.iter()
            .filter(|(k, _)| k.0 >= min_price)
            .map(|(_, v)| v.size)
            .sum();
        
        let ask_liquidity = self.asks.iter()
            .filter(|(k, _)| k.0 <= max_price)
            .map(|(_, v)| v.size)
            .sum();
        
        (bid_liquidity, ask_liquidity)
    }
    
    /// Get last update ID
    pub fn get_last_update_id(&self) -> u64 {
        self.last_update_id
    }
    
    /// Get last update timestamp
    pub fn get_last_update_timestamp(&self) -> u64 {
        self.last_update_timestamp
    }
    
    /// Get the symbol
    pub fn get_symbol(&self) -> &str {
        &self.symbol
    }
    
    /// Clear the order book
    pub fn clear(&mut self) {
        self.bids.clear();
        self.asks.clear();
        self.depth_snapshots.write().unwrap().clear();
    }
}

/// Manager for multiple order books
pub struct OrderBookManager {
    order_books: RwLock<HashMap<String, Arc<RwLock<OrderBook>>>>,
}

impl OrderBookManager {
    /// Create a new order book manager
    pub fn new() -> Self {
        Self {
            order_books: RwLock::new(HashMap::new()),
        }
    }
    
    /// Get or create an order book for a symbol
    pub fn get_order_book(&self, symbol: &str) -> Arc<RwLock<OrderBook>> {
        let mut books = self.order_books.write().unwrap();
        
        books.entry(symbol.to_string())
            .or_insert_with(|| Arc::new(RwLock::new(OrderBook::new(symbol))))
            .clone()
    }
    
    /// Process an update for a specific symbol
    pub fn process_update(&self, symbol: &str, price: f64, size: f64, side: OrderSide, update_id: u64) -> UpdateType {
        let order_book = self.get_order_book(symbol);
        let mut book = order_book.write().unwrap();
        book.process_update(price, size, side, update_id)
    }
    
    /// Process a batch of updates for a symbol
    pub fn process_updates(&self, symbol: &str, updates: Vec<(f64, f64, OrderSide, u64)>) -> Vec<UpdateType> {
        let order_book = self.get_order_book(symbol);
        let mut book = order_book.write().unwrap();
        
        let mut results = Vec::with_capacity(updates.len());
        for (price, size, side, update_id) in updates {
            let result = book.process_update(price, size, side, update_id);
            results.push(result);
        }
        
        results
    }
    
    /// Get a snapshot of an order book
    pub fn get_snapshot(&self, symbol: &str, depth: usize) -> Option<(Vec<PriceLevel>, Vec<PriceLevel>)> {
        let books = self.order_books.read().unwrap();
        
        if let Some(book) = books.get(symbol) {
            let book_guard = book.read().unwrap();
            Some(book_guard.get_depth(depth))
        } else {
            None
        }
    }
    
    /// Calculate imbalance for a symbol
    pub fn calculate_imbalance(&self, symbol: &str, depth: usize) -> Option<f64> {
        let books = self.order_books.read().unwrap();
        
        if let Some(book) = books.get(symbol) {
            let book_guard = book.read().unwrap();
            Some(book_guard.calculate_imbalance(depth))
        } else {
            None
        }
    }
    
    /// Get the mid price for a symbol
    pub fn get_mid_price(&self, symbol: &str) -> Option<f64> {
        let books = self.order_books.read().unwrap();
        
        if let Some(book) = books.get(symbol) {
            let book_guard = book.read().unwrap();
            book_guard.mid_price()
        } else {
            None
        }
    }
    
    /// Get VWAP for a specific size
    pub fn get_vwap(&self, symbol: &str, size: f64, side: OrderSide) -> Option<f64> {
        let books = self.order_books.read().unwrap();
        
        if let Some(book) = books.get(symbol) {
            let book_guard = book.read().unwrap();
            book_guard.get_vwap_for_size(size, side)
        } else {
            None
        }
    }
    
    /// List all symbols with active order books
    pub fn list_symbols(&self) -> Vec<String> {
        let books = self.order_books.read().unwrap();
        books.keys().cloned().collect()
    }
    
    /// Remove an order book
    pub fn remove_order_book(&self, symbol: &str) -> bool {
        let mut books = self.order_books.write().unwrap();
        books.remove(symbol).is_some()
    }
}

impl Default for OrderBookManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Create a singleton order book manager
pub fn create_order_book_manager() -> Arc<OrderBookManager> {
    Arc::new(OrderBookManager::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_process_update() {
        let mut order_book = OrderBook::new("BTC/USD");
        
        // Add a bid
        let result = order_book.process_update(10000.0, 1.5, OrderSide::Bid, 1);
        assert_eq!(result, UpdateType::New);
        
        // Update the bid
        let result = order_book.process_update(10000.0, 2.0, OrderSide::Bid, 2);
        assert_eq!(result, UpdateType::Update);
        
        // Delete the bid
        let result = order_book.process_update(10000.0, 0.0, OrderSide::Bid, 3);
        assert_eq!(result, UpdateType::Delete);
    }
    
    #[test]
    fn test_get_depth() {
        let mut order_book = OrderBook::new("BTC/USD");
        
        // Add bids
        order_book.process_update(10000.0, 1.0, OrderSide::Bid, 1);
        order_book.process_update(9900.0, 2.0, OrderSide::Bid, 2);
        order_book.process_update(9800.0, 3.0, OrderSide::Bid, 3);
        
        // Add asks
        order_book.process_update(10100.0, 1.5, OrderSide::Ask, 4);
        order_book.process_update(10200.0, 2.5, OrderSide::Ask, 5);
        order_book.process_update(10300.0, 3.5, OrderSide::Ask, 6);
        
        // Get depth with all levels
        let (bids, asks) = order_book.get_depth(10);
        assert_eq!(bids.len(), 3);
        assert_eq!(asks.len(), 3);
        
        // Check bid order (highest first)
        assert_eq!(bids[0].price, 10000.0);
        assert_eq!(bids[1].price, 9900.0);
        assert_eq!(bids[2].price, 9800.0);
        
        // Check ask order (lowest first)
        assert_eq!(asks[0].price, 10100.0);
        assert_eq!(asks[1].price, 10200.0);
        assert_eq!(asks[2].price, 10300.0);
        
        // Get limited depth
        let (bids, asks) = order_book.get_depth(2);
        assert_eq!(bids.len(), 2);
        assert_eq!(asks.len(), 2);
    }
    
    #[test]
    fn test_best_bid_ask() {
        let mut order_book = OrderBook::new("BTC/USD");
        
        // Empty book
        assert_eq!(order_book.best_bid(), None);
        assert_eq!(order_book.best_ask(), None);
        
        // Add bids and asks
        order_book.process_update(10000.0, 1.0, OrderSide::Bid, 1);
        order_book.process_update(9900.0, 2.0, OrderSide::Bid, 2);
        order_book.process_update(10100.0, 1.5, OrderSide::Ask, 3);
        order_book.process_update(10200.0, 2.5, OrderSide::Ask, 4);
        
        // Check best bid and ask
        assert_eq!(order_book.best_bid(), Some(10000.0));
        assert_eq!(order_book.best_ask(), Some(10100.0));
        
        // Check mid price
        assert_eq!(order_book.mid_price(), Some(10050.0));
    }
    
    #[test]
    fn test_calculate_imbalance() {
        let mut order_book = OrderBook::new("BTC/USD");
        
        // Add bid side heavy
        order_book.process_update(10000.0, 5.0, OrderSide::Bid, 1);
        order_book.process_update(9900.0, 4.0, OrderSide::Bid, 2);
        order_book.process_update(10100.0, 1.0, OrderSide::Ask, 3);
        order_book.process_update(10200.0, 2.0, OrderSide::Ask, 4);
        
        // Calculate imbalance
        let imbalance = order_book.calculate_imbalance(10);
        assert!(imbalance > 0.0); // Positive imbalance (buy pressure)
        
        // Clear
        order_book.clear();
        
        // Add ask side heavy
        order_book.process_update(10000.0, 1.0, OrderSide::Bid, 5);
        order_book.process_update(9900.0, 2.0, OrderSide::Bid, 6);
        order_book.process_update(10100.0, 5.0, OrderSide::Ask, 7);
        order_book.process_update(10200.0, 4.0, OrderSide::Ask, 8);
        
        // Calculate imbalance
        let imbalance = order_book.calculate_imbalance(10);
        assert!(imbalance < 0.0); // Negative imbalance (sell pressure)
    }
    
    #[test]
    fn test_vwap() {
        let mut order_book = OrderBook::new("BTC/USD");
        
        // Add asks
        order_book.process_update(10100.0, 1.0, OrderSide::Ask, 1);
        order_book.process_update(10200.0, 2.0, OrderSide::Ask, 2);
        order_book.process_update(10300.0, 3.0, OrderSide::Ask, 3);
        
        // Calculate VWAP for buying
        let vwap = order_book.get_vwap_for_size(2.0, OrderSide::Bid);
        
        // VWAP should be (10100*1 + 10200*1) / 2 = 10150
        assert_eq!(vwap, Some(10150.0));
        
        // Add bids
        order_book.process_update(10000.0, 1.0, OrderSide::Bid, 4);
        order_book.process_update(9900.0, 2.0, OrderSide::Bid, 5);
        order_book.process_update(9800.0, 3.0, OrderSide::Bid, 6);
        
        // Calculate VWAP for selling
        let vwap = order_book.get_vwap_for_size(2.0, OrderSide::Ask);
        
        // VWAP should be (10000*1 + 9900*1) / 2 = 9950
        assert_eq!(vwap, Some(9950.0));
    }
    
    #[test]
    fn test_order_book_manager() {
        let manager = OrderBookManager::new();
        
        // Process updates for two symbols
        manager.process_update("BTC/USD", 10000.0, 1.0, OrderSide::Bid, 1);
        manager.process_update("ETH/USD", 1000.0, 2.0, OrderSide::Bid, 1);
        
        // Get snapshots
        let btc_snapshot = manager.get_snapshot("BTC/USD", 10);
        let eth_snapshot = manager.get_snapshot("ETH/USD", 10);
        
        assert!(btc_snapshot.is_some());
        assert!(eth_snapshot.is_some());
        
        // Get mid prices
        assert_eq!(manager.get_mid_price("BTC/USD"), None); // No asks yet
        
        // Process batch updates
        let updates = vec![
            (10100.0, 1.5, OrderSide::Ask, 2),
            (10200.0, 2.5, OrderSide::Ask, 3),
        ];
        
        manager.process_updates("BTC/USD", updates);
        
        // Now mid price should be available
        assert_eq!(manager.get_mid_price("BTC/USD"), Some(10050.0));
        
        // Check symbol list
        let symbols = manager.list_symbols();
        assert_eq!(symbols.len(), 2);
        assert!(symbols.contains(&"BTC/USD".to_string()));
        assert!(symbols.contains(&"ETH/USD".to_string()));
        
        // Remove order book
        assert!(manager.remove_order_book("ETH/USD"));
        assert_eq!(manager.list_symbols().len(), 1);
    }
} 