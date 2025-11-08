use core_affinity::{self, CoreId};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tracing::{info, warn, error};

/// CPU affinity configuration for critical trading components
#[derive(Debug, Clone)]
pub struct CpuAffinityConfig {
    /// Enable CPU pinning
    pub enabled: bool,
    /// Core assignments for different components
    pub core_assignments: HashMap<String, Vec<usize>>,
    /// Reserve cores for OS and other processes
    pub reserved_cores: Vec<usize>,
    /// Enable NUMA optimization
    pub numa_aware: bool,
}

impl Default for CpuAffinityConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            core_assignments: HashMap::new(),
            reserved_cores: vec![0], // Reserve core 0 for OS
            numa_aware: false,
        }
    }
}

/// CPU affinity manager for optimizing thread placement
pub struct CpuAffinityManager {
    config: Arc<RwLock<CpuAffinityConfig>>,
    available_cores: Vec<CoreId>,
}

impl CpuAffinityManager {
    /// Create a new CPU affinity manager
    pub fn new(config: CpuAffinityConfig) -> Self {
        let available_cores = core_affinity::get_core_ids().unwrap_or_default();
        
        info!(
            "CPU affinity manager initialized with {} cores available",
            available_cores.len()
        );
        
        Self {
            config: Arc::new(RwLock::new(config)),
            available_cores,
        }
    }
    
    /// Pin the current thread to specific cores
    pub fn pin_current_thread(&self, component: &str) -> Result<(), String> {
        let config = self.config.read().unwrap();
        
        if !config.enabled {
            return Ok(());
        }
        
        if let Some(core_indices) = config.core_assignments.get(component) {
            if let Some(&core_idx) = core_indices.first() {
                if core_idx < self.available_cores.len() {
                    let core_id = self.available_cores[core_idx];
                    
                    match core_affinity::set_for_current(core_id) {
                        true => {
                            info!("Pinned {} thread to core {}", component, core_idx);
                            Ok(())
                        }
                        false => {
                            warn!("Failed to pin {} thread to core {}", component, core_idx);
                            Err(format!("Failed to pin thread to core {}", core_idx))
                        }
                    }
                } else {
                    error!("Invalid core index {} for component {}", core_idx, component);
                    Err(format!("Invalid core index {}", core_idx))
                }
            } else {
                Ok(()) // No cores assigned
            }
        } else {
            Ok(()) // Component not configured
        }
    }
    
    /// Get optimal core assignment for a component
    pub fn get_optimal_cores(&self, component: &str, num_threads: usize) -> Vec<usize> {
        let config = self.config.read().unwrap();
        
        // If already configured, return those
        if let Some(cores) = config.core_assignments.get(component) {
            return cores.clone();
        }
        
        // Otherwise, find available cores
        let mut available: Vec<usize> = (0..self.available_cores.len())
            .filter(|&idx| !config.reserved_cores.contains(&idx))
            .collect();
        
        // Remove cores already assigned to other components
        for (_, assigned_cores) in &config.core_assignments {
            for &core in assigned_cores {
                available.retain(|&c| c != core);
            }
        }
        
        // Return up to num_threads cores
        available.into_iter().take(num_threads).collect()
    }
    
    /// Configure optimal CPU affinity for trading components
    pub fn configure_trading_affinity(&mut self) -> Result<(), String> {
        let mut config = self.config.write().unwrap();
        
        if self.available_cores.len() < 4 {
            warn!("Less than 4 cores available, CPU pinning may not be effective");
            config.enabled = false;
            return Ok(());
        }
        
        // Reserve core 0 for OS
        config.reserved_cores = vec![0];
        
        // Assign cores to critical components
        // Market data processing gets dedicated cores
        config.core_assignments.insert(
            "market_data".to_string(),
            vec![1, 2],
        );
        
        // Order routing gets dedicated core
        config.core_assignments.insert(
            "order_router".to_string(),
            vec![3],
        );
        
        // Risk calculation gets dedicated core
        config.core_assignments.insert(
            "risk_calc".to_string(),
            vec![4],
        );
        
        // Strategy execution can use remaining cores
        let strategy_cores: Vec<usize> = (5..self.available_cores.len()).collect();
        if !strategy_cores.is_empty() {
            config.core_assignments.insert(
                "strategy_executor".to_string(),
                strategy_cores,
            );
        }
        
        config.enabled = true;
        
        info!("Configured CPU affinity for trading components");
        Ok(())
    }
    
    /// Get current CPU affinity configuration
    pub fn get_config(&self) -> CpuAffinityConfig {
        self.config.read().unwrap().clone()
    }
    
    /// Update CPU affinity configuration
    pub fn update_config(&self, new_config: CpuAffinityConfig) {
        let mut config = self.config.write().unwrap();
        *config = new_config;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_cpu_affinity_manager_creation() {
        let config = CpuAffinityConfig::default();
        let manager = CpuAffinityManager::new(config);
        
        assert!(!manager.available_cores.is_empty());
    }
    
    #[test]
    fn test_optimal_core_assignment() {
        let mut config = CpuAffinityConfig::default();
        config.reserved_cores = vec![0];
        
        let manager = CpuAffinityManager::new(config);
        let cores = manager.get_optimal_cores("test_component", 2);
        
        // Should not include reserved core 0
        assert!(!cores.contains(&0));
        assert!(cores.len() <= 2);
    }
} 