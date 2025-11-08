use anyhow::Result;
use async_trait::async_trait;
use std::collections::HashSet;
use std::sync::Mutex;

use noderr_core::strategy_storage::StrategyStorage;

/// A mock implementation of StrategyStorage for CLI testing
pub struct MockStrategyStorage {
    strategy_ids: Mutex<HashSet<String>>,
}

impl MockStrategyStorage {
    /// Create a new mock strategy storage
    pub fn new() -> Self {
        let mut strategies = HashSet::new();
        
        // Add some sample strategies
        strategies.insert("strategy-1".to_string());
        strategies.insert("strategy-2".to_string());
        strategies.insert("strategy-3".to_string());
        strategies.insert("strategy-4".to_string());
        strategies.insert("strategy-5".to_string());
        
        Self {
            strategy_ids: Mutex::new(strategies),
        }
    }
    
    /// Get all strategy IDs
    pub fn get_strategy_ids(&self) -> Result<Vec<String>> {
        let strategies = self.strategy_ids.lock().unwrap();
        Ok(strategies.iter().cloned().collect())
    }
    
    /// Add a strategy ID
    pub fn add_strategy(&self, strategy_id: &str) -> Result<()> {
        let mut strategies = self.strategy_ids.lock().unwrap();
        strategies.insert(strategy_id.to_string());
        Ok(())
    }
    
    /// Remove a strategy ID
    pub fn remove_strategy(&self, strategy_id: &str) -> Result<bool> {
        let mut strategies = self.strategy_ids.lock().unwrap();
        Ok(strategies.remove(strategy_id))
    }
}

#[async_trait]
impl StrategyStorage for MockStrategyStorage {
    /// Get all strategy IDs (async version for trait compatibility)
    async fn get_all_strategy_ids(&self) -> Result<Vec<String>> {
        self.get_strategy_ids()
    }
    
    // Other methods would be implemented here as needed for CLI testing
    // For now, we only need the get_all_strategy_ids method
} 