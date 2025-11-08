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

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

use crate::correlation_engine::CorrelationEngine;
use crate::market::Symbol;
use crate::market_regime::{MarketRegimeDetector, MarketRegimeState};
use crate::risk::RiskManager;

/// Error types for asset allocation operations
#[derive(Debug, Error)]
pub enum AssetAllocationError {
    #[error("Insufficient data: {0}")]
    InsufficientData(String),
    
    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
    
    #[error("Regime detection error: {0}")]
    RegimeError(String),
    
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Result type for asset allocation operations
pub type AssetAllocationResult<T> = Result<T, AssetAllocationError>;

/// Asset risk classification
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AssetRiskClass {
    /// High-risk assets (e.g., volatile cryptocurrencies)
    RiskOn,
    
    /// Low-risk assets (e.g., stablecoins, fiat)
    RiskOff,
    
    /// Neutral risk assets (e.g., blue-chip stocks/crypto)
    Neutral,
}

impl std::fmt::Display for AssetRiskClass {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AssetRiskClass::RiskOn => write!(f, "RISK_ON"),
            AssetRiskClass::RiskOff => write!(f, "RISK_OFF"),
            AssetRiskClass::Neutral => write!(f, "NEUTRAL"),
        }
    }
}

/// Asset allocation configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetAllocationConfig {
    /// Whether to enable regime-based allocation
    pub enable_regime_based: bool,
    
    /// Default allocations for each risk class
    pub default_allocations: HashMap<AssetRiskClass, f64>,
    
    /// Allocations for bull market regime
    pub bull_allocations: HashMap<AssetRiskClass, f64>,
    
    /// Allocations for bear market regime
    pub bear_allocations: HashMap<AssetRiskClass, f64>,
    
    /// Allocations for sideways market regime
    pub sideways_allocations: HashMap<AssetRiskClass, f64>,
    
    /// Allocations for volatile market regime
    pub volatile_allocations: HashMap<AssetRiskClass, f64>,
    
    /// Maximum allocation to any single asset
    pub max_asset_allocation: f64,
    
    /// Minimum allocation for any included asset
    pub min_asset_allocation: f64,
    
    /// How often to recalculate allocations (in seconds)
    pub update_interval_sec: u64,
    
    /// Weight given to volatility in allocation decisions (0.0-1.0)
    pub volatility_weight: f64,
    
    /// Weight given to correlation in allocation decisions (0.0-1.0)
    pub correlation_weight: f64,
    
    /// Weight given to regime confidence in allocation decisions (0.0-1.0)
    pub regime_confidence_weight: f64,
}

impl Default for AssetAllocationConfig {
    fn default() -> Self {
        let mut default_allocations = HashMap::new();
        default_allocations.insert(AssetRiskClass::RiskOn, 0.4);
        default_allocations.insert(AssetRiskClass::RiskOff, 0.3);
        default_allocations.insert(AssetRiskClass::Neutral, 0.3);
        
        let mut bull_allocations = HashMap::new();
        bull_allocations.insert(AssetRiskClass::RiskOn, 0.7);
        bull_allocations.insert(AssetRiskClass::RiskOff, 0.1);
        bull_allocations.insert(AssetRiskClass::Neutral, 0.2);
        
        let mut bear_allocations = HashMap::new();
        bear_allocations.insert(AssetRiskClass::RiskOn, 0.2);
        bear_allocations.insert(AssetRiskClass::RiskOff, 0.7);
        bear_allocations.insert(AssetRiskClass::Neutral, 0.1);
        
        let mut sideways_allocations = HashMap::new();
        sideways_allocations.insert(AssetRiskClass::RiskOn, 0.3);
        sideways_allocations.insert(AssetRiskClass::RiskOff, 0.3);
        sideways_allocations.insert(AssetRiskClass::Neutral, 0.4);
        
        let mut volatile_allocations = HashMap::new();
        volatile_allocations.insert(AssetRiskClass::RiskOn, 0.2);
        volatile_allocations.insert(AssetRiskClass::RiskOff, 0.6);
        volatile_allocations.insert(AssetRiskClass::Neutral, 0.2);
        
        Self {
            enable_regime_based: true,
            default_allocations,
            bull_allocations,
            bear_allocations,
            sideways_allocations,
            volatile_allocations,
            max_asset_allocation: 0.3,
            min_asset_allocation: 0.01,
            update_interval_sec: 3600, // 1 hour
            volatility_weight: 0.3,
            correlation_weight: 0.3,
            regime_confidence_weight: 0.4,
        }
    }
}

/// Asset metadata used for allocation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetMetadata {
    /// Symbol of the asset
    pub symbol: Symbol,
    
    /// Asset risk classification
    pub risk_class: AssetRiskClass,
    
    /// Historical volatility (0.0-1.0)
    pub volatility: f64,
    
    /// Current price
    pub price: f64,
    
    /// Additional metadata
    pub metadata: HashMap<String, serde_json::Value>,
}

impl AssetMetadata {
    /// Create a new asset metadata instance
    pub fn new(symbol: Symbol, risk_class: AssetRiskClass, volatility: f64, price: f64) -> Self {
        Self {
            symbol,
            risk_class,
            volatility,
            price,
            metadata: HashMap::new(),
        }
    }
    
    /// Add additional metadata
    pub fn with_metadata(mut self, key: &str, value: serde_json::Value) -> Self {
        self.metadata.insert(key.to_string(), value);
        self
    }
}

/// Individual asset allocation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetAllocation {
    /// Symbol of the asset
    pub symbol: Symbol,
    
    /// Asset risk classification
    pub risk_class: AssetRiskClass,
    
    /// Allocation percentage (0.0-1.0)
    pub allocation: f64,
    
    /// Base allocation before adjustments
    pub base_allocation: f64,
    
    /// Allocation adjustments and rationale
    pub adjustments: HashMap<String, f64>,
}

/// Portfolio-wide allocation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortfolioAllocation {
    /// When this allocation was calculated
    pub timestamp: DateTime<Utc>,
    
    /// Individual asset allocations
    pub allocations: Vec<AssetAllocation>,
    
    /// Current market regime used for allocation
    pub market_regime: MarketRegimeState,
    
    /// Confidence in the market regime
    pub regime_confidence: f64,
    
    /// Risk-on percentage allocation
    pub risk_on_allocation: f64,
    
    /// Risk-off percentage allocation
    pub risk_off_allocation: f64,
    
    /// Neutral percentage allocation
    pub neutral_allocation: f64,
    
    /// Total allocated percentage (should sum to 1.0)
    pub total_allocation: f64,
}

/// Trait for systems that can perform asset allocation
#[async_trait]
pub trait AssetAllocator: Send + Sync {
    /// Register an asset for allocation
    async fn register_asset(&self, asset: AssetMetadata) -> AssetAllocationResult<()>;
    
    /// Update asset metadata
    async fn update_asset(&self, symbol: &Symbol, asset: AssetMetadata) -> AssetAllocationResult<()>;
    
    /// Remove an asset from allocation
    async fn remove_asset(&self, symbol: &Symbol) -> AssetAllocationResult<()>;
    
    /// Get current asset allocation
    async fn get_asset_allocation(&self, symbol: &Symbol) -> Option<AssetAllocation>;
    
    /// Get all asset allocations
    async fn get_portfolio_allocation(&self) -> Option<PortfolioAllocation>;
    
    /// Calculate optimal asset allocation
    async fn optimize_allocation(&self) -> AssetAllocationResult<PortfolioAllocation>;
    
    /// Update allocation
    async fn update_allocation(&self) -> AssetAllocationResult<()>;
    
    /// Initialize the asset allocator
    async fn initialize(&self) -> AssetAllocationResult<()>;
}

/// Default implementation of asset allocator using market regime detection
pub struct RegimeBasedAssetAllocator {
    /// Configuration
    config: AssetAllocationConfig,
    
    /// Market regime detector
    regime_detector: Arc<dyn MarketRegimeDetector>,
    
    /// Correlation engine
    correlation_engine: Arc<dyn CorrelationEngine>,
    
    /// Risk manager
    risk_manager: Option<Arc<dyn RiskManager>>,
    
    /// Registered assets
    assets: Arc<RwLock<HashMap<Symbol, AssetMetadata>>>,
    
    /// Current portfolio allocation
    current_allocation: Arc<RwLock<Option<PortfolioAllocation>>>,
    
    /// Last update time
    last_update: Arc<RwLock<Instant>>,
}

impl RegimeBasedAssetAllocator {
    /// Create a new RegimeBasedAssetAllocator
    pub fn new(
        config: AssetAllocationConfig,
        regime_detector: Arc<dyn MarketRegimeDetector>,
        correlation_engine: Arc<dyn CorrelationEngine>,
        risk_manager: Option<Arc<dyn RiskManager>>,
    ) -> Self {
        Self {
            config,
            regime_detector,
            correlation_engine,
            risk_manager,
            assets: Arc::new(RwLock::new(HashMap::new())),
            current_allocation: Arc::new(RwLock::new(None)),
            last_update: Arc::new(RwLock::new(Instant::now() - Duration::from_secs(3600))), // Force immediate update
        }
    }
    
    /// Create with default configuration
    pub fn default(
        regime_detector: Arc<dyn MarketRegimeDetector>,
        correlation_engine: Arc<dyn CorrelationEngine>,
    ) -> Self {
        Self::new(
            AssetAllocationConfig::default(),
            regime_detector,
            correlation_engine,
            None,
        )
    }
    
    /// Get regime-based allocation for a risk class
    fn get_allocation_for_regime(
        &self, 
        risk_class: AssetRiskClass, 
        regime: MarketRegimeState
    ) -> f64 {
        match regime {
            MarketRegimeState::Bull => self.config.bull_allocations
                .get(&risk_class)
                .copied()
                .unwrap_or_else(|| self.config.default_allocations.get(&risk_class).copied().unwrap_or(0.33)),
                
            MarketRegimeState::Bear => self.config.bear_allocations
                .get(&risk_class)
                .copied()
                .unwrap_or_else(|| self.config.default_allocations.get(&risk_class).copied().unwrap_or(0.33)),
                
            MarketRegimeState::Sideways => self.config.sideways_allocations
                .get(&risk_class)
                .copied()
                .unwrap_or_else(|| self.config.default_allocations.get(&risk_class).copied().unwrap_or(0.33)),
                
            MarketRegimeState::Volatile => self.config.volatile_allocations
                .get(&risk_class)
                .copied()
                .unwrap_or_else(|| self.config.default_allocations.get(&risk_class).copied().unwrap_or(0.33)),
                
            _ => self.config.default_allocations
                .get(&risk_class)
                .copied()
                .unwrap_or(0.33),
        }
    }
    
    /// Calculate inverse volatility weights
    fn calculate_inverse_volatility_weights(&self, assets: &HashMap<Symbol, AssetMetadata>) -> HashMap<Symbol, f64> {
        let mut weights = HashMap::new();
        let mut total_inverse_vol = 0.0;
        
        // Calculate inverse volatility
        for (symbol, metadata) in assets {
            // Avoid division by zero
            let volatility = metadata.volatility.max(0.01);
            let inverse_vol = 1.0 / volatility;
            weights.insert(symbol.clone(), inverse_vol);
            total_inverse_vol += inverse_vol;
        }
        
        // Normalize weights
        if total_inverse_vol > 0.0 {
            for weight in weights.values_mut() {
                *weight /= total_inverse_vol;
            }
        }
        
        weights
    }
    
    /// Calculate base allocations before correlation adjustment
    async fn calculate_base_allocations(&self) -> AssetAllocationResult<HashMap<Symbol, AssetAllocation>> {
        // Get current regimes for assets
        let all_regimes = self.regime_detector.get_all_regimes().await;
        if all_regimes.is_empty() {
            return Err(AssetAllocationError::InsufficientData(
                "No market regime data available".to_string()
            ));
        }
        
        // Get the dominant market regime (from the most representative asset or most confident)
        let dominant_regime = all_regimes.values()
            .max_by(|a, b| a.confidence.partial_cmp(&b.confidence).unwrap_or(std::cmp::Ordering::Equal))
            .ok_or_else(|| AssetAllocationError::InsufficientData("No regime data available".to_string()))?;
        
        // Use registered assets
        let assets = self.assets.read().await;
        if assets.is_empty() {
            return Err(AssetAllocationError::InsufficientData(
                "No assets registered for allocation".to_string()
            ));
        }
        
        // Group assets by risk class
        let mut risk_on_assets = Vec::new();
        let mut risk_off_assets = Vec::new();
        let mut neutral_assets = Vec::new();
        
        for (symbol, metadata) in assets.iter() {
            match metadata.risk_class {
                AssetRiskClass::RiskOn => risk_on_assets.push((symbol.clone(), metadata.clone())),
                AssetRiskClass::RiskOff => risk_off_assets.push((symbol.clone(), metadata.clone())),
                AssetRiskClass::Neutral => neutral_assets.push((symbol.clone(), metadata.clone())),
            }
        }
        
        // Get risk class allocations based on regime
        let risk_on_allocation = self.get_allocation_for_regime(AssetRiskClass::RiskOn, dominant_regime.state);
        let risk_off_allocation = self.get_allocation_for_regime(AssetRiskClass::RiskOff, dominant_regime.state);
        let neutral_allocation = self.get_allocation_for_regime(AssetRiskClass::Neutral, dominant_regime.state);
        
        // Calculate volatility-based weights within each class
        let mut risk_on_weights = HashMap::new();
        let mut risk_off_weights = HashMap::new();
        let mut neutral_weights = HashMap::new();
        
        // Risk-on assets
        if !risk_on_assets.is_empty() {
            let risk_on_metadata: HashMap<Symbol, AssetMetadata> = risk_on_assets.into_iter().collect();
            risk_on_weights = self.calculate_inverse_volatility_weights(&risk_on_metadata);
        }
        
        // Risk-off assets
        if !risk_off_assets.is_empty() {
            let risk_off_metadata: HashMap<Symbol, AssetMetadata> = risk_off_assets.into_iter().collect();
            risk_off_weights = self.calculate_inverse_volatility_weights(&risk_off_metadata);
        }
        
        // Neutral assets
        if !neutral_assets.is_empty() {
            let neutral_metadata: HashMap<Symbol, AssetMetadata> = neutral_assets.into_iter().collect();
            neutral_weights = self.calculate_inverse_volatility_weights(&neutral_metadata);
        }
        
        // Combine weights with class allocations
        let mut asset_allocations = HashMap::new();
        
        // Apply risk-on allocations
        for (symbol, weight) in risk_on_weights {
            let allocation = weight * risk_on_allocation;
            asset_allocations.insert(symbol.clone(), AssetAllocation {
                symbol,
                risk_class: AssetRiskClass::RiskOn,
                allocation,
                base_allocation: allocation,
                adjustments: HashMap::new(),
            });
        }
        
        // Apply risk-off allocations
        for (symbol, weight) in risk_off_weights {
            let allocation = weight * risk_off_allocation;
            asset_allocations.insert(symbol.clone(), AssetAllocation {
                symbol,
                risk_class: AssetRiskClass::RiskOff,
                allocation,
                base_allocation: allocation,
                adjustments: HashMap::new(),
            });
        }
        
        // Apply neutral allocations
        for (symbol, weight) in neutral_weights {
            let allocation = weight * neutral_allocation;
            asset_allocations.insert(symbol.clone(), AssetAllocation {
                symbol,
                risk_class: AssetRiskClass::Neutral,
                allocation,
                base_allocation: allocation,
                adjustments: HashMap::new(),
            });
        }
        
        Ok(asset_allocations)
    }
    
    /// Apply correlation-based adjustments to allocations
    async fn apply_correlation_adjustments(&self, allocations: &mut HashMap<Symbol, AssetAllocation>) -> AssetAllocationResult<()> {
        // Get correlation data for all assets
        let symbols: Vec<Symbol> = allocations.keys().cloned().collect();
        
        // Skip if we have too few assets
        if symbols.len() < 2 {
            return Ok(());
        }
        
        // Get correlation matrix
        let correlation_matrix = match self.correlation_engine.get_correlation_matrix(&symbols).await {
            Ok(matrix) => matrix,
            Err(e) => {
                warn!("Failed to get correlation matrix: {}", e);
                return Ok(());
            }
        };
        
        // Identify highly correlated pairs and reduce their combined weight
        for i in 0..symbols.len() {
            for j in (i+1)..symbols.len() {
                let symbol_a = &symbols[i];
                let symbol_b = &symbols[j];
                
                if let Some(correlation) = correlation_matrix.get(symbol_a, symbol_b) {
                    // Only adjust if correlation is high (over 0.7)
                    if *correlation > 0.7 {
                        if let (Some(alloc_a), Some(alloc_b)) = (allocations.get_mut(symbol_a), allocations.get_mut(symbol_b)) {
                            // Reduce allocations proportionally to correlation
                            let adjustment_factor = 1.0 - (*correlation - 0.7) * 0.5;
                            
                            // Apply adjustments
                            let adjusted_a = alloc_a.allocation * adjustment_factor;
                            let adjusted_b = alloc_b.allocation * adjustment_factor;
                            
                            // Record adjustments
                            alloc_a.adjustments.insert("correlation".to_string(), adjustment_factor);
                            alloc_b.adjustments.insert("correlation".to_string(), adjustment_factor);
                            
                            // Update allocations
                            alloc_a.allocation = adjusted_a;
                            alloc_b.allocation = adjusted_b;
                        }
                    }
                }
            }
        }
        
        Ok(())
    }
    
    /// Apply max/min constraints and normalize allocations
    fn apply_constraints_and_normalize(&self, allocations: &mut HashMap<Symbol, AssetAllocation>) {
        // Apply max constraint
        for allocation in allocations.values_mut() {
            allocation.allocation = allocation.allocation.min(self.config.max_asset_allocation);
        }
        
        // Calculate total allocation
        let total: f64 = allocations.values().map(|a| a.allocation).sum();
        
        if total > 0.0 {
            // Normalize
            for allocation in allocations.values_mut() {
                allocation.allocation /= total;
                
                // Apply min constraint after normalization (exclude if too small)
                if allocation.allocation < self.config.min_asset_allocation {
                    allocation.allocation = 0.0;
                }
            }
            
            // Renormalize after exclusions
            let new_total: f64 = allocations.values().map(|a| a.allocation).sum();
            
            if new_total > 0.0 {
                for allocation in allocations.values_mut() {
                    if allocation.allocation > 0.0 {
                        allocation.allocation /= new_total;
                    }
                }
            }
        }
    }
}

#[async_trait]
impl AssetAllocator for RegimeBasedAssetAllocator {
    async fn initialize(&self) -> AssetAllocationResult<()> {
        // Initial allocation
        self.update_allocation().await?;
        
        info!("Regime-based asset allocator initialized");
        Ok(())
    }
    
    async fn register_asset(&self, asset: AssetMetadata) -> AssetAllocationResult<()> {
        let mut assets = self.assets.write().await;
        assets.insert(asset.symbol.clone(), asset);
        
        debug!("Registered asset {} for allocation", asset.symbol);
        Ok(())
    }
    
    async fn update_asset(&self, symbol: &Symbol, asset: AssetMetadata) -> AssetAllocationResult<()> {
        let mut assets = self.assets.write().await;
        
        if !assets.contains_key(symbol) {
            return Err(AssetAllocationError::InvalidParameter(
                format!("Asset {} not registered", symbol)
            ));
        }
        
        assets.insert(symbol.clone(), asset);
        
        debug!("Updated asset {} metadata", symbol);
        Ok(())
    }
    
    async fn remove_asset(&self, symbol: &Symbol) -> AssetAllocationResult<()> {
        let mut assets = self.assets.write().await;
        
        if assets.remove(symbol).is_none() {
            return Err(AssetAllocationError::InvalidParameter(
                format!("Asset {} not registered", symbol)
            ));
        }
        
        debug!("Removed asset {} from allocation", symbol);
        Ok(())
    }
    
    async fn get_asset_allocation(&self, symbol: &Symbol) -> Option<AssetAllocation> {
        let current = self.current_allocation.read().await;
        
        if let Some(allocation) = &*current {
            allocation.allocations.iter()
                .find(|a| &a.symbol == symbol)
                .cloned()
        } else {
            None
        }
    }
    
    async fn get_portfolio_allocation(&self) -> Option<PortfolioAllocation> {
        let current = self.current_allocation.read().await;
        current.clone()
    }
    
    async fn optimize_allocation(&self) -> AssetAllocationResult<PortfolioAllocation> {
        // Check for cached allocation that's still fresh
        {
            let last_update = self.last_update.read().await;
            let current = self.current_allocation.read().await;
            
            if let Some(allocation) = &*current {
                if last_update.elapsed() < Duration::from_secs(self.config.update_interval_sec) {
                    return Ok(allocation.clone());
                }
            }
        }
        
        // Get base allocations
        let mut asset_allocations = self.calculate_base_allocations().await?;
        
        // Apply correlation-based adjustments
        if self.config.correlation_weight > 0.0 {
            self.apply_correlation_adjustments(&mut asset_allocations).await?;
        }
        
        // Apply constraints and normalize
        self.apply_constraints_and_normalize(&mut asset_allocations);
        
        // Convert to vector of allocations
        let allocations: Vec<AssetAllocation> = asset_allocations.into_values().collect();
        
        // Calculate class allocations
        let risk_on_allocation: f64 = allocations.iter()
            .filter(|a| a.risk_class == AssetRiskClass::RiskOn)
            .map(|a| a.allocation)
            .sum();
            
        let risk_off_allocation: f64 = allocations.iter()
            .filter(|a| a.risk_class == AssetRiskClass::RiskOff)
            .map(|a| a.allocation)
            .sum();
            
        let neutral_allocation: f64 = allocations.iter()
            .filter(|a| a.risk_class == AssetRiskClass::Neutral)
            .map(|a| a.allocation)
            .sum();
        
        // Get the dominant market regime
        let all_regimes = self.regime_detector.get_all_regimes().await;
        let dominant_regime = all_regimes.values()
            .max_by(|a, b| a.confidence.partial_cmp(&b.confidence).unwrap_or(std::cmp::Ordering::Equal))
            .ok_or_else(|| AssetAllocationError::InsufficientData("No regime data available".to_string()))?;
        
        // Create portfolio allocation
        let result = PortfolioAllocation {
            timestamp: Utc::now(),
            allocations,
            market_regime: dominant_regime.state,
            regime_confidence: dominant_regime.confidence,
            risk_on_allocation,
            risk_off_allocation,
            neutral_allocation,
            total_allocation: risk_on_allocation + risk_off_allocation + neutral_allocation,
        };
        
        // Update cache
        {
            let mut current = self.current_allocation.write().await;
            *current = Some(result.clone());
            
            let mut last_update = self.last_update.write().await;
            *last_update = Instant::now();
        }
        
        Ok(result)
    }
    
    async fn update_allocation(&self) -> AssetAllocationResult<()> {
        // Calculate new allocation
        let allocation = self.optimize_allocation().await?;
        
        // Log allocation
        info!(
            "Updated portfolio allocation: risk_on={:.2}%, risk_off={:.2}%, neutral={:.2}% (regime: {})",
            allocation.risk_on_allocation * 100.0,
            allocation.risk_off_allocation * 100.0,
            allocation.neutral_allocation * 100.0,
            allocation.market_regime
        );
        
        for asset in &allocation.allocations {
            debug!(
                "  Asset {}: {:.2}% ({})",
                asset.symbol,
                asset.allocation * 100.0,
                asset.risk_class
            );
        }
        
        Ok(())
    }
}

/// Factory for creating asset allocators
pub struct AssetAllocatorFactory;

impl AssetAllocatorFactory {
    /// Create allocator with default configuration
    pub fn create_default(
        regime_detector: Arc<dyn MarketRegimeDetector>,
        correlation_engine: Arc<dyn CorrelationEngine>,
    ) -> Arc<dyn AssetAllocator> {
        Arc::new(RegimeBasedAssetAllocator::default(regime_detector, correlation_engine))
    }
    
    /// Create allocator with custom configuration
    pub fn create_custom(
        config: AssetAllocationConfig,
        regime_detector: Arc<dyn MarketRegimeDetector>,
        correlation_engine: Arc<dyn CorrelationEngine>,
        risk_manager: Option<Arc<dyn RiskManager>>,
    ) -> Arc<dyn AssetAllocator> {
        Arc::new(RegimeBasedAssetAllocator::new(
            config,
            regime_detector,
            correlation_engine,
            risk_manager,
        ))
    }
}

/// Helper function to create a default asset allocator
pub fn create_asset_allocator(
    regime_detector: Arc<dyn MarketRegimeDetector>,
    correlation_engine: Arc<dyn CorrelationEngine>,
) -> Arc<dyn AssetAllocator> {
    AssetAllocatorFactory::create_default(regime_detector, correlation_engine)
}

/// Helper function to create a custom asset allocator
pub fn create_asset_allocator_with_config(
    config: AssetAllocationConfig,
    regime_detector: Arc<dyn MarketRegimeDetector>,
    correlation_engine: Arc<dyn CorrelationEngine>,
    risk_manager: Option<Arc<dyn RiskManager>>,
) -> Arc<dyn AssetAllocator> {
    AssetAllocatorFactory::create_custom(config, regime_detector, correlation_engine, risk_manager)
} 