use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Position manager error types
#[derive(Error, Debug)]
pub enum PositionError {
    #[error("Invalid position update: {0}")]
    InvalidUpdate(String),
    #[error("Position not found for agent: {0}")]
    PositionNotFound(String),
    #[error("Position limit exceeded: {0}")]
    LimitExceeded(String),
    #[error("Invalid order or fill data: {0}")]
    InvalidOrderData(String),
}

/// Result type for position operations
pub type PositionResult<T> = Result<T, PositionError>;

/// Order side enumeration
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Side {
    Buy,
    Sell,
}

/// Order or fill data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderOrFill {
    pub symbol: String,
    pub side: Side,
    pub size: f64,
    pub price: f64,
    pub timestamp: DateTime<Utc>,
    pub order_id: String,
    pub fill_id: Option<String>,
    pub is_fill: bool,
    pub venue: Option<String>,
    pub strategy_id: Option<String>,
}

/// Position information for a specific symbol
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolPosition {
    pub symbol: String,
    pub net_size: f64,
    pub average_price: f64,
    pub unrealized_pnl: f64,
    pub realized_pnl: f64,
    pub last_update: DateTime<Utc>,
    pub open_orders: HashMap<String, OrderOrFill>,
    pub fills: Vec<OrderOrFill>,
}

impl SymbolPosition {
    /// Create a new symbol position
    pub fn new(symbol: &str) -> Self {
        Self {
            symbol: symbol.to_string(),
            net_size: 0.0,
            average_price: 0.0,
            unrealized_pnl: 0.0,
            realized_pnl: 0.0,
            last_update: Utc::now(),
            open_orders: HashMap::new(),
            fills: Vec::new(),
        }
    }

    /// Update position with a new order or fill
    pub fn update(&mut self, order: &OrderOrFill) -> PositionResult<()> {
        self.last_update = Utc::now();

        // Handle fill
        if order.is_fill {
            // Remove from open orders if this is a fill for an existing order
            if let Some(fill_id) = &order.fill_id {
                self.open_orders.remove(fill_id);
            }

            // Update position size and average price
            let old_position_value = self.net_size * self.average_price;
            let trade_value = order.size * order.price;
            
            match order.side {
                Side::Buy => {
                    // Buying increases position
                    let new_size = self.net_size + order.size;
                    
                    // Calculate new average price (weighted)
                    if new_size > 0.0 {
                        self.average_price = (old_position_value + trade_value) / new_size;
                    }
                    
                    self.net_size = new_size;
                }
                Side::Sell => {
                    // Selling decreases position
                    let old_size = self.net_size;
                    let new_size = old_size - order.size;
                    
                    // Calculate realized P&L if reducing or closing position
                    if old_size > 0.0 && order.size > 0.0 {
                        let size_closed = if new_size < 0.0 { old_size } else { order.size };
                        self.realized_pnl += size_closed * (order.price - self.average_price);
                    }
                    
                    // If crossing from long to short, reset average price
                    if old_size > 0.0 && new_size < 0.0 {
                        self.average_price = order.price;
                    } else if new_size < 0.0 {
                        // For short positions, calculate new average price
                        let short_value = if old_size < 0.0 { old_position_value } else { 0.0 };
                        self.average_price = (short_value - trade_value) / new_size;
                    }
                    
                    self.net_size = new_size;
                }
            }

            // Add to fills history
            self.fills.push(order.clone());
            
            // Keep only the last 100 fills
            if self.fills.len() > 100 {
                self.fills = self.fills.split_off(self.fills.len() - 100);
            }
        } else {
            // This is an open order - add to open orders
            self.open_orders.insert(order.order_id.clone(), order.clone());
        }

        Ok(())
    }

    /// Calculate unrealized PnL based on current market price
    pub fn update_unrealized_pnl(&mut self, current_price: f64) {
        if self.net_size == 0.0 {
            self.unrealized_pnl = 0.0;
            return;
        }

        if self.net_size > 0.0 {
            // Long position
            self.unrealized_pnl = self.net_size * (current_price - self.average_price);
        } else {
            // Short position
            self.unrealized_pnl = -self.net_size * (self.average_price - current_price);
        }
    }

    /// Get total position value at current price
    pub fn position_value(&self, current_price: f64) -> f64 {
        self.net_size.abs() * current_price
    }

    /// Check if adding a new position would exceed limits
    pub fn would_exceed_limit(&self, side: Side, size: f64, limit: f64) -> bool {
        let new_size = match side {
            Side::Buy => self.net_size + size,
            Side::Sell => self.net_size - size,
        };

        new_size.abs() > limit
    }
}

/// Agent position containing positions for multiple symbols
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPosition {
    pub agent_id: String,
    pub positions: HashMap<String, SymbolPosition>,
    pub cash_balance: f64,
    pub last_update: DateTime<Utc>,
}

impl AgentPosition {
    /// Create a new agent position
    pub fn new(agent_id: &str, initial_cash: f64) -> Self {
        Self {
            agent_id: agent_id.to_string(),
            positions: HashMap::new(),
            cash_balance: initial_cash,
            last_update: Utc::now(),
        }
    }

    /// Update position with a new order or fill
    pub fn update_position(&mut self, order: &OrderOrFill) -> PositionResult<()> {
        self.last_update = Utc::now();
        
        // Get or create symbol position
        let symbol_position = self.positions
            .entry(order.symbol.clone())
            .or_insert_with(|| SymbolPosition::new(&order.symbol));
        
        // Update the symbol position
        symbol_position.update(order)?;
        
        // Update cash balance for fills
        if order.is_fill {
            match order.side {
                Side::Buy => {
                    // Buying decreases cash
                    self.cash_balance -= order.size * order.price;
                }
                Side::Sell => {
                    // Selling increases cash
                    self.cash_balance += order.size * order.price;
                }
            }
        }
        
        Ok(())
    }

    /// Calculate total exposure for the agent across all symbols
    pub fn calculate_exposure(&self, current_prices: &HashMap<String, f64>) -> f64 {
        let mut total_exposure = 0.0;
        
        for (symbol, position) in &self.positions {
            if let Some(price) = current_prices.get(symbol) {
                total_exposure += position.position_value(*price);
            }
        }
        
        total_exposure
    }

    /// Calculate exposure for a specific symbol
    pub fn calculate_symbol_exposure(&self, symbol: &str, current_price: f64) -> f64 {
        if let Some(position) = self.positions.get(symbol) {
            position.position_value(current_price)
        } else {
            0.0
        }
    }

    /// Check if a new position would exceed limits
    pub fn check_limits(&self, symbol: &str, side: Side, size: f64, current_price: f64, symbol_limit: f64) -> bool {
        if let Some(position) = self.positions.get(symbol) {
            position.would_exceed_limit(side, size, symbol_limit)
        } else {
            // No existing position, check if new position exceeds limit
            size > symbol_limit
        }
    }

    /// Calculate total P&L (realized + unrealized)
    pub fn calculate_total_pnl(&self, current_prices: &HashMap<String, f64>) -> f64 {
        let mut total_pnl = 0.0;
        
        for (symbol, position) in &self.positions {
            if let Some(price) = current_prices.get(symbol) {
                let mut position_clone = position.clone();
                position_clone.update_unrealized_pnl(*price);
                total_pnl += position_clone.realized_pnl + position_clone.unrealized_pnl;
            } else {
                total_pnl += position.realized_pnl;
            }
        }
        
        total_pnl
    }
}

/// Position manager configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionManagerConfig {
    pub max_position_per_symbol: HashMap<String, f64>,
    pub default_max_position: f64,
    pub max_total_exposure: f64,
    pub initial_cash_balance: f64,
}

impl Default for PositionManagerConfig {
    fn default() -> Self {
        Self {
            max_position_per_symbol: HashMap::new(),
            default_max_position: 10.0,
            max_total_exposure: 100.0,
            initial_cash_balance: 1000.0,
        }
    }
}

/// Position manager for tracking and managing positions
pub struct PositionManager {
    positions: RwLock<HashMap<String, AgentPosition>>,
    current_prices: RwLock<HashMap<String, f64>>,
    config: RwLock<PositionManagerConfig>,
}

impl PositionManager {
    /// Create a new position manager with default configuration
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            positions: RwLock::new(HashMap::new()),
            current_prices: RwLock::new(HashMap::new()),
            config: RwLock::new(PositionManagerConfig::default()),
        })
    }

    /// Create a new position manager with custom configuration
    pub fn with_config(config: PositionManagerConfig) -> Arc<Self> {
        Arc::new(Self {
            positions: RwLock::new(HashMap::new()),
            current_prices: RwLock::new(HashMap::new()),
            config: RwLock::new(config),
        })
    }

    /// Get or create an agent position
    fn get_or_create_agent_position(&self, agent_id: &str) -> PositionResult<AgentPosition> {
        let positions = self.positions.read().map_err(|_| PositionError::InvalidUpdate("Poisoned lock".to_string()))?;
        
        if let Some(position) = positions.get(agent_id) {
            Ok(position.clone())
        } else {
            drop(positions);
            
            let config = self.config.read().map_err(|_| PositionError::InvalidUpdate("Poisoned lock".to_string()))?;
            let new_position = AgentPosition::new(agent_id, config.initial_cash_balance);
            
            let mut positions = self.positions.write().map_err(|_| PositionError::InvalidUpdate("Poisoned lock".to_string()))?;
            positions.insert(agent_id.to_string(), new_position.clone());
            
            Ok(new_position)
        }
    }

    /// Update a position with a new order or fill
    pub fn update_position(&self, agent_id: &str, order: &OrderOrFill) -> PositionResult<()> {
        // Validate the order data
        if order.size <= 0.0 {
            return Err(PositionError::InvalidOrderData("Order size must be positive".to_string()));
        }
        
        if order.price <= 0.0 {
            return Err(PositionError::InvalidOrderData("Order price must be positive".to_string()));
        }
        
        // Update current price
        {
            let mut prices = self.current_prices.write().map_err(|_| PositionError::InvalidUpdate("Poisoned lock".to_string()))?;
            prices.insert(order.symbol.clone(), order.price);
        }
        
        // Get or create agent position and update it
        let mut positions = self.positions.write().map_err(|_| PositionError::InvalidUpdate("Poisoned lock".to_string()))?;
        
        let agent_position = positions
            .entry(agent_id.to_string())
            .or_insert_with(|| {
                let config = self.config.read().unwrap();
                AgentPosition::new(agent_id, config.initial_cash_balance)
            });
        
        agent_position.update_position(order)
    }

    /// Calculate exposure for an agent
    pub fn calculate_exposure(&self, agent_id: &str) -> PositionResult<f64> {
        let positions = self.positions.read().map_err(|_| PositionError::InvalidUpdate("Poisoned lock".to_string()))?;
        let agent_position = positions.get(agent_id).ok_or_else(|| PositionError::PositionNotFound(agent_id.to_string()))?;
        
        let prices = self.current_prices.read().map_err(|_| PositionError::InvalidUpdate("Poisoned lock".to_string()))?;
        
        Ok(agent_position.calculate_exposure(&prices))
    }

    /// Check if a new position would exceed limits
    pub fn check_limits(&self, agent_id: &str, symbol: &str, side: Side, size: f64) -> PositionResult<bool> {
        let positions = self.positions.read().map_err(|_| PositionError::InvalidUpdate("Poisoned lock".to_string()))?;
        let agent_position = positions.get(agent_id).ok_or_else(|| PositionError::PositionNotFound(agent_id.to_string()))?;
        
        let prices = self.current_prices.read().map_err(|_| PositionError::InvalidUpdate("Poisoned lock".to_string()))?;
        let price = prices.get(symbol).cloned().unwrap_or(0.0);
        
        if price <= 0.0 {
            return Err(PositionError::InvalidOrderData(format!("No price data for symbol {}", symbol)));
        }
        
        let config = self.config.read().map_err(|_| PositionError::InvalidUpdate("Poisoned lock".to_string()))?;
        
        // Get symbol-specific limit or default
        let symbol_limit = config.max_position_per_symbol.get(symbol).cloned().unwrap_or(config.default_max_position);
        
        // Check if new position would exceed symbol limit
        let would_exceed_symbol_limit = agent_position.check_limits(symbol, side, size, price, symbol_limit);
        
        // Check if new position would exceed total exposure limit
        let new_exposure = {
            let mut new_agent_position = agent_position.clone();
            let order = OrderOrFill {
                symbol: symbol.to_string(),
                side,
                size,
                price,
                timestamp: Utc::now(),
                order_id: "temp".to_string(),
                fill_id: None,
                is_fill: true,
                venue: None,
                strategy_id: None,
            };
            
            // Calculate hypothetical exposure
            if new_agent_position.update_position(&order).is_ok() {
                new_agent_position.calculate_exposure(&prices)
            } else {
                // If update fails, use current exposure
                agent_position.calculate_exposure(&prices)
            }
        };
        
        Ok(would_exceed_symbol_limit || new_exposure > config.max_total_exposure)
    }

    /// Update current market price for a symbol
    pub fn update_price(&self, symbol: &str, price: f64) -> PositionResult<()> {
        if price <= 0.0 {
            return Err(PositionError::InvalidOrderData("Price must be positive".to_string()));
        }
        
        let mut prices = self.current_prices.write().map_err(|_| PositionError::InvalidUpdate("Poisoned lock".to_string()))?;
        prices.insert(symbol.to_string(), price);
        
        Ok(())
    }

    /// Get position for an agent
    pub fn get_position(&self, agent_id: &str) -> PositionResult<AgentPosition> {
        let positions = self.positions.read().map_err(|_| PositionError::InvalidUpdate("Poisoned lock".to_string()))?;
        positions.get(agent_id).cloned().ok_or_else(|| PositionError::PositionNotFound(agent_id.to_string()))
    }

    /// Get position for an agent and symbol
    pub fn get_symbol_position(&self, agent_id: &str, symbol: &str) -> PositionResult<SymbolPosition> {
        let positions = self.positions.read().map_err(|_| PositionError::InvalidUpdate("Poisoned lock".to_string()))?;
        
        let agent_position = positions.get(agent_id).ok_or_else(|| PositionError::PositionNotFound(agent_id.to_string()))?;
        
        agent_position.positions.get(symbol).cloned().ok_or_else(|| PositionError::PositionNotFound(format!("Symbol {} not found for agent {}", symbol, agent_id)))
    }

    /// Update configuration
    pub fn update_config(&self, new_config: PositionManagerConfig) -> PositionResult<()> {
        let mut config = self.config.write().map_err(|_| PositionError::InvalidUpdate("Poisoned lock".to_string()))?;
        *config = new_config;
        
        Ok(())
    }

    /// Get current configuration
    pub fn get_config(&self) -> PositionResult<PositionManagerConfig> {
        let config = self.config.read().map_err(|_| PositionError::InvalidUpdate("Poisoned lock".to_string()))?;
        Ok(config.clone())
    }
}

/// Create a new position manager with default configuration
pub fn create_position_manager() -> Arc<PositionManager> {
    PositionManager::new()
}

/// Create a new position manager with custom configuration
pub fn create_position_manager_with_config(config: PositionManagerConfig) -> Arc<PositionManager> {
    PositionManager::with_config(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_position_update() {
        let position_manager = create_position_manager();
        
        let order = OrderOrFill {
            symbol: "BTC-USD".to_string(),
            side: Side::Buy,
            size: 1.0,
            price: 50000.0,
            timestamp: Utc::now(),
            order_id: "order1".to_string(),
            fill_id: None,
            is_fill: true,
            venue: Some("exchange1".to_string()),
            strategy_id: Some("strategy1".to_string()),
        };
        
        position_manager.update_position("agent1", &order).unwrap();
        
        let position = position_manager.get_symbol_position("agent1", "BTC-USD").unwrap();
        assert_eq!(position.net_size, 1.0);
        assert_eq!(position.average_price, 50000.0);
    }

    #[test]
    fn test_check_limits() {
        let config = PositionManagerConfig {
            max_position_per_symbol: {
                let mut map = HashMap::new();
                map.insert("BTC-USD".to_string(), 2.0);
                map
            },
            default_max_position: 1.0,
            max_total_exposure: 100000.0,
            initial_cash_balance: 100000.0,
        };
        
        let position_manager = create_position_manager_with_config(config);
        
        let order = OrderOrFill {
            symbol: "BTC-USD".to_string(),
            side: Side::Buy,
            size: 1.0,
            price: 50000.0,
            timestamp: Utc::now(),
            order_id: "order1".to_string(),
            fill_id: None,
            is_fill: true,
            venue: Some("exchange1".to_string()),
            strategy_id: Some("strategy1".to_string()),
        };
        
        position_manager.update_position("agent1", &order).unwrap();
        
        // This should not exceed limits (1.0 + 0.5 = 1.5 < 2.0)
        let exceeds = position_manager.check_limits("agent1", "BTC-USD", Side::Buy, 0.5).unwrap();
        assert!(!exceeds);
        
        // This should exceed limits (1.0 + 1.5 = 2.5 > 2.0)
        let exceeds = position_manager.check_limits("agent1", "BTC-USD", Side::Buy, 1.5).unwrap();
        assert!(exceeds);
    }
} 