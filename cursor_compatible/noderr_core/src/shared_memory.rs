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

use std::sync::{Arc, Mutex, RwLock};
use std::collections::VecDeque;
use dashmap::DashMap;
use serde::{Serialize, Deserialize};
use std::time::{Duration, Instant};
use std::mem;

/// Default maximum capacity for shared ring buffers
const DEFAULT_BUFFER_CAPACITY: usize = 1000;

/// Maximum number of batched operations to execute at once
const MAX_BATCH_SIZE: usize = 100;

/// Buffer type identifiers for different data types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BufferType {
    MarketData,
    OrderBookDeltas, 
    OrderEvents,
    TradeEvents,
    LatencyMetrics,
    StrategyStates,
    RiskStates,
    Custom(u8),
}

/// Shared memory buffer configuration
#[derive(Debug, Clone)]
pub struct BufferConfig {
    pub capacity: usize,
    pub buffer_type: BufferType,
    pub allow_overwrites: bool,
    pub auto_compact: bool,
}

impl Default for BufferConfig {
    fn default() -> Self {
        Self {
            capacity: DEFAULT_BUFFER_CAPACITY,
            buffer_type: BufferType::Custom(0),
            allow_overwrites: true,
            auto_compact: true,
        }
    }
}

/// A generic event in the shared memory buffer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BufferEvent<T> {
    pub timestamp: u64,
    pub sequence: u64,
    pub data: T,
}

/// Shared memory ring buffer
/// Thread-safe circular buffer with read/write access
pub struct SharedRingBuffer<T: Clone + Send + Sync + 'static> {
    buffer: Arc<RwLock<VecDeque<BufferEvent<T>>>>,
    config: BufferConfig,
    next_sequence: Arc<Mutex<u64>>,
}

impl<T: Clone + Send + Sync + 'static> SharedRingBuffer<T> {
    /// Create a new shared ring buffer with the given configuration
    pub fn new(config: BufferConfig) -> Self {
        Self {
            buffer: Arc::new(RwLock::new(VecDeque::with_capacity(config.capacity))),
            config,
            next_sequence: Arc::new(Mutex::new(0)),
        }
    }
    
    /// Push a new item into the buffer
    pub fn push(&self, item: T) -> u64 {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_else(|_| Duration::from_secs(0))
            .as_micros() as u64;
        
        let sequence = {
            let mut seq = self.next_sequence.lock().unwrap();
            let current = *seq;
            *seq += 1;
            current
        };
        
        let event = BufferEvent {
            timestamp,
            sequence,
            data: item,
        };
        
        let mut buffer = self.buffer.write().unwrap();
        
        // Handle capacity limits
        if buffer.len() >= self.config.capacity {
            if self.config.allow_overwrites {
                buffer.pop_front(); // Remove oldest item
            } else {
                // If overwrites are not allowed, we don't add the item
                return sequence;
            }
        }
        
        buffer.push_back(event);
        
        // Compact buffer if needed and auto_compact is enabled
        if self.config.auto_compact && buffer.len() > self.config.capacity / 2 {
            self.compact_buffer(&mut buffer);
        }
        
        sequence
    }
    
    /// Push multiple items at once (batch operation)
    pub fn push_batch(&self, items: Vec<T>) -> Vec<u64> {
        if items.is_empty() {
            return Vec::new();
        }
        
        let mut sequences = Vec::with_capacity(items.len());
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_else(|_| Duration::from_secs(0))
            .as_micros() as u64;
        
        let mut buffer = self.buffer.write().unwrap();
        let start_sequence = {
            let mut seq = self.next_sequence.lock().unwrap();
            let current = *seq;
            *seq += items.len() as u64;
            current
        };
        
        // Check if we need to make room
        let needed_capacity = buffer.len() + items.len();
        if needed_capacity > self.config.capacity && self.config.allow_overwrites {
            let to_remove = needed_capacity.saturating_sub(self.config.capacity);
            for _ in 0..to_remove {
                buffer.pop_front();
            }
        }
        
        // Add all items
        for (i, item) in items.into_iter().enumerate() {
            let sequence = start_sequence + i as u64;
            sequences.push(sequence);
            
            let event = BufferEvent {
                timestamp,
                sequence,
                data: item,
            };
            
            if buffer.len() < self.config.capacity || self.config.allow_overwrites {
                buffer.push_back(event);
            }
        }
        
        // Compact buffer if needed and auto_compact is enabled
        if self.config.auto_compact && buffer.len() > self.config.capacity / 2 {
            self.compact_buffer(&mut buffer);
        }
        
        sequences
    }
    
    /// Get the most recent items from the buffer, up to the specified limit
    /// Returns a vector of cloned items, newest first
    pub fn get_recent(&self, limit: usize) -> Vec<BufferEvent<T>> {
        let buffer = self.buffer.read().unwrap();
        let count = limit.min(buffer.len());
        
        let mut result = Vec::with_capacity(count);
        let start_idx = buffer.len().saturating_sub(count);
        
        for i in (start_idx..buffer.len()).rev() {
            if let Some(item) = buffer.get(i) {
                result.push(item.clone());
            }
        }
        
        result
    }
    
    /// Get items from the buffer that occurred after the specified sequence number
    /// Returns a vector of cloned items in chronological order (oldest first)
    pub fn get_after_sequence(&self, sequence: u64) -> Vec<BufferEvent<T>> {
        let buffer = self.buffer.read().unwrap();
        
        // Find items with sequence > the provided sequence
        let mut result = Vec::new();
        for item in buffer.iter() {
            if item.sequence > sequence {
                result.push(item.clone());
            }
        }
        
        result
    }
    
    /// Get items from the buffer that occurred after the specified timestamp
    /// Returns a vector of cloned items in chronological order (oldest first)
    pub fn get_after_timestamp(&self, timestamp: u64) -> Vec<BufferEvent<T>> {
        let buffer = self.buffer.read().unwrap();
        
        // Find items with timestamp > the provided timestamp
        let mut result = Vec::new();
        for item in buffer.iter() {
            if item.timestamp > timestamp {
                result.push(item.clone());
            }
        }
        
        result
    }
    
    /// Clear the buffer
    pub fn clear(&self) {
        let mut buffer = self.buffer.write().unwrap();
        buffer.clear();
    }
    
    /// Get the current length of the buffer
    pub fn len(&self) -> usize {
        self.buffer.read().unwrap().len()
    }
    
    /// Check if the buffer is empty
    pub fn is_empty(&self) -> bool {
        self.buffer.read().unwrap().is_empty()
    }
    
    /// Compact the buffer to save memory
    /// This is an internal operation that removes gaps in the sequence
    fn compact_buffer(&self, buffer: &mut VecDeque<BufferEvent<T>>) {
        // In a real implementation, we might do more sophisticated compaction
        // For now, we'll just ensure the buffer is at or below capacity
        while buffer.len() > self.config.capacity {
            buffer.pop_front();
        }
    }
}

/// Shared memory manager
/// Central registry for all shared buffers in the application
pub struct SharedMemoryManager {
    buffers: DashMap<String, Arc<dyn std::any::Any + Send + Sync>>,
}

impl SharedMemoryManager {
    /// Create a new shared memory manager
    pub fn new() -> Self {
        Self {
            buffers: DashMap::new(),
        }
    }
    
    /// Create a new shared buffer with the given name and configuration
    pub fn create_buffer<T: Clone + Send + Sync + 'static>(
        &self,
        name: &str,
        config: BufferConfig,
    ) -> Arc<SharedRingBuffer<T>> {
        let buffer = Arc::new(SharedRingBuffer::<T>::new(config));
        self.buffers.insert(name.to_string(), buffer.clone() as Arc<dyn std::any::Any + Send + Sync>);
        buffer
    }
    
    /// Get a shared buffer by name
    pub fn get_buffer<T: Clone + Send + Sync + 'static>(&self, name: &str) -> Option<Arc<SharedRingBuffer<T>>> {
        self.buffers.get(name).and_then(|buffer| {
            buffer.value().clone().downcast::<SharedRingBuffer<T>>().ok()
        })
    }
    
    /// Remove a shared buffer by name
    pub fn remove_buffer(&self, name: &str) -> bool {
        self.buffers.remove(name).is_some()
    }
    
    /// List all buffer names
    pub fn list_buffers(&self) -> Vec<String> {
        self.buffers.iter().map(|entry| entry.key().clone()).collect()
    }
}

impl Default for SharedMemoryManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Create a shared memory manager singleton
pub fn create_shared_memory_manager() -> Arc<SharedMemoryManager> {
    Arc::new(SharedMemoryManager::new())
}

// Batch processing support

/// Batch operation result
#[derive(Debug, Clone)]
pub struct BatchResult<T> {
    pub successes: Vec<T>,
    pub failures: Vec<(T, String)>,
    pub total_time_us: u64,
}

/// Batch processor for executing operations in bulk
pub struct BatchProcessor<T, R> {
    processor: Box<dyn Fn(Vec<T>) -> BatchResult<R> + Send + Sync>,
    max_batch_size: usize,
    pending_items: Arc<Mutex<Vec<T>>>,
}

impl<T: Clone + Send + 'static, R: Clone + Send + 'static> BatchProcessor<T, R> {
    /// Create a new batch processor with the given processing function
    pub fn new<F>(processor: F) -> Self 
    where
        F: Fn(Vec<T>) -> BatchResult<R> + Send + Sync + 'static,
    {
        Self {
            processor: Box::new(processor),
            max_batch_size: MAX_BATCH_SIZE,
            pending_items: Arc::new(Mutex::new(Vec::with_capacity(MAX_BATCH_SIZE))),
        }
    }
    
    /// Set the maximum batch size
    pub fn with_max_batch_size(mut self, size: usize) -> Self {
        self.max_batch_size = size;
        self
    }
    
    /// Add an item to the batch
    /// Returns true if the batch is ready to be processed
    pub fn add_item(&self, item: T) -> bool {
        let mut pending = self.pending_items.lock().unwrap();
        pending.push(item);
        pending.len() >= self.max_batch_size
    }
    
    /// Process the current batch of items
    /// Returns the result of the batch operation
    pub fn process_batch(&self) -> BatchResult<R> {
        let items = {
            let mut pending = self.pending_items.lock().unwrap();
            if pending.is_empty() {
                return BatchResult {
                    successes: vec![],
                    failures: vec![],
                    total_time_us: 0,
                };
            }
            
            // Take the items and replace with empty vec
            mem::take(&mut *pending)
        };
        
        let start = Instant::now();
        let result = (self.processor)(items);
        let elapsed = start.elapsed();
        
        BatchResult {
            successes: result.successes,
            failures: result.failures,
            total_time_us: elapsed.as_micros() as u64,
        }
    }
    
    /// Get the number of pending items
    pub fn pending_count(&self) -> usize {
        self.pending_items.lock().unwrap().len()
    }
    
    /// Clear all pending items
    pub fn clear_pending(&self) {
        self.pending_items.lock().unwrap().clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_shared_ring_buffer() {
        let config = BufferConfig {
            capacity: 5,
            buffer_type: BufferType::Custom(1),
            allow_overwrites: true,
            auto_compact: true,
        };
        
        let buffer: SharedRingBuffer<i32> = SharedRingBuffer::new(config);
        
        // Push items
        buffer.push(1);
        buffer.push(2);
        buffer.push(3);
        
        // Get recent items
        let recent = buffer.get_recent(10);
        assert_eq!(recent.len(), 3);
        assert_eq!(recent[0].data, 3); // Newest first
        assert_eq!(recent[1].data, 2);
        assert_eq!(recent[2].data, 1);
        
        // Push more items to trigger overwrite
        buffer.push(4);
        buffer.push(5);
        buffer.push(6); // This should cause item 1 to be overwritten
        
        let all = buffer.get_recent(10);
        assert_eq!(all.len(), 5);
        assert_eq!(all[0].data, 6);
        assert_eq!(all[4].data, 2); // Item 1 was overwritten
    }
    
    #[test]
    fn test_batch_processing() {
        // Create a batch processor that doubles numbers
        let processor = BatchProcessor::new(|items: Vec<i32>| {
            let mut successes = Vec::with_capacity(items.len());
            let mut failures = Vec::new();
            
            for item in items {
                if item >= 0 {
                    successes.push(item * 2);
                } else {
                    failures.push((item, "Cannot process negative numbers".to_string()));
                }
            }
            
            BatchResult {
                successes,
                failures,
                total_time_us: 0,
            }
        }).with_max_batch_size(3);
        
        // Add items
        processor.add_item(1);
        processor.add_item(2);
        let batch_ready = processor.add_item(-3);
        
        assert!(batch_ready);
        
        // Process the batch
        let result = processor.process_batch();
        
        assert_eq!(result.successes.len(), 2);
        assert_eq!(result.failures.len(), 1);
        assert_eq!(result.successes[0], 2);
        assert_eq!(result.successes[1], 4);
        assert_eq!(result.failures[0].0, -3);
    }
} 