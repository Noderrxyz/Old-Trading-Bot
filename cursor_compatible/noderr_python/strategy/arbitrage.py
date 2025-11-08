#!/usr/bin/env python3
# -*- coding: utf-8 -*-
#
# SPDX-License-Identifier: MIT
#
# Copyright (c) 2025 Noderr Protocol Foundation
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.

"""
Arbitrage strategies that exploit price differences between exchanges.
"""

import logging
from datetime import datetime
from typing import Dict, Any, Optional, List, Tuple
import numpy as np
import asyncio

from .base import BaseStrategy, MarketData, Signal, ExecutionResult, RiskProfile

logger = logging.getLogger(__name__)

class SimpleArbitrageStrategy(BaseStrategy):
    """
    A basic arbitrage strategy that looks for price differences
    between two exchanges for the same asset.
    
    Parameters:
    -----------
    exchange1 : str
        First exchange to monitor
    exchange2 : str
        Second exchange to monitor
    min_spread_pct : float
        Minimum percentage spread required to execute (default: 0.5)
    max_position_size : float
        Maximum position size as a percentage of available capital (default: 1.0)
    slippage_tolerance_pct : float
        Maximum expected slippage percentage (default: 0.1)
    """
    
    def __init__(self, 
                 strategy_id: str,
                 exchange1: str,
                 exchange2: str,
                 min_spread_pct: float = 0.5,
                 max_position_size: float = 1.0,
                 slippage_tolerance_pct: float = 0.1):
        """Initialize the arbitrage strategy with exchange pairs."""
        parameters = {
            "exchange1": exchange1,
            "exchange2": exchange2,
            "min_spread_pct": min_spread_pct,
            "max_position_size": max_position_size,
            "slippage_tolerance_pct": slippage_tolerance_pct
        }
        super().__init__(strategy_id, parameters)
        
        # Initialize strategy-specific state
        self.state = {
            "positions": {},
            "trades_count": 0,
            "successful_arbs": 0,
            "total_profit": 0.0,
            "last_spread": 0.0,
            "opportunities_found": 0,
            "opportunities_executed": 0,
            "execution_times": []
        }
        
    def _configure_risk_profile(self):
        """Configure risk profile for arbitrage strategy."""
        super()._configure_risk_profile()
        
        # Set arbitrage-specific risk parameters
        self.risk_profile.max_position_size = self.parameters["max_position_size"]
        self.risk_profile.use_stop_loss = True
        self.risk_profile.stop_loss_pct = self.parameters.get("stop_loss_pct", 0.5)
        
        # Add arbitrage-specific parameters
        self.risk_profile.additional_params["slippage_tolerance_pct"] = self.parameters.get("slippage_tolerance_pct", 0.1)
        self.risk_profile.additional_params["max_execution_time_sec"] = 30  # Maximum time to complete both legs
        
    async def analyze(self, market_data: MarketData) -> Optional[Signal]:
        """
        Analyze market data across exchanges to identify arbitrage opportunities.
        
        Returns a Signal if an opportunity is found, otherwise None.
        """
        # Get prices from both exchanges
        exchange1 = self.parameters["exchange1"]
        exchange2 = self.parameters["exchange2"]
        
        # Check if we have data for both exchanges
        if (exchange1 not in market_data.metadata or 
            exchange2 not in market_data.metadata or
            "price" not in market_data.metadata[exchange1] or
            "price" not in market_data.metadata[exchange2]):
            logger.debug(f"Missing price data for {exchange1} or {exchange2}")
            return None
        
        # Extract prices
        price1 = market_data.metadata[exchange1]["price"]
        price2 = market_data.metadata[exchange2]["price"]
        
        # Calculate spread
        spread_pct = abs(price1 - price2) / min(price1, price2) * 100
        self.state["last_spread"] = spread_pct
        
        # If spread exceeds minimum, generate arbitrage signal
        if spread_pct >= self.parameters["min_spread_pct"]:
            self.state["opportunities_found"] += 1
            logger.info(f"Arbitrage opportunity: {exchange1}={price1}, {exchange2}={price2}, spread={spread_pct:.2f}%")
            
            # Determine which exchange to buy from and sell to
            buy_exchange = exchange1 if price1 < price2 else exchange2
            sell_exchange = exchange2 if price1 < price2 else exchange1
            
            # Calculate position size (with entropy for unpredictability)
            position_size = self.parameters["max_position_size"]
            
            # Add slight randomness to position size for entropy
            position_size *= (0.9 + 0.2 * np.random.random())
            
            # Create a buy signal
            buy_signal = Signal(
                strategy_id=self.strategy_id,
                timestamp=datetime.now(),
                symbol=market_data.symbol,
                action="BUY",
                quantity=position_size,
                price_limit=None,  # Market order
                urgency=0.9,  # High urgency for arbitrage
                parameters={
                    "exchange": buy_exchange,
                    "pair_trade_id": f"arb_{self.state['trades_count']}",
                    "trade_type": "arbitrage_leg1",
                    "planned_sell_exchange": sell_exchange,
                    "spread_pct": spread_pct
                }
            )
            
            # Update state
            self.state["trades_count"] += 1
            self.state["opportunities_executed"] += 1
            
            return buy_signal
        
        return None
    
    def on_execution_result(self, result: ExecutionResult) -> None:
        """
        Handle execution result feedback and create the second leg of the arbitrage if needed.
        """
        super().on_execution_result(result)
        
        # Record execution time for entropy calculation
        self.state["execution_times"].append(result.latency_ms)
        if len(self.state["execution_times"]) > 50:
            self.state["execution_times"] = self.state["execution_times"][-50:]
        
        # Check if this is the first leg of an arbitrage pair
        if (result.is_successful() and 
            "trade_type" in result.metadata and 
            result.metadata["trade_type"] == "arbitrage_leg1"):
            
            # Prepare second leg (sell)
            # In a real implementation, this would create another Signal and submit it
            # to the execution system, but for simplicity we just log it here
            pair_id = result.metadata.get("pair_trade_id")
            sell_exchange = result.metadata.get("planned_sell_exchange")
            
            logger.info(f"First leg of arbitrage {pair_id} executed successfully. "
                      f"Preparing second leg on {sell_exchange}")
            
            # In a real implementation, we would track both legs and calculate profit/loss
            # when both are completed
            
            # Update successful arbitrages count if both legs complete
            if "second_leg_result" in result.metadata and result.metadata["second_leg_result"] == "success":
                self.state["successful_arbs"] += 1
                profit = result.metadata.get("profit", 0.0)
                self.state["total_profit"] += profit
                
                logger.info(f"Arbitrage {pair_id} completed successfully with profit {profit:.2f}")
    
    def entropy_score(self) -> float:
        """
        Calculate the unpredictability of this strategy.
        Arbitrage strategies need some entropy to prevent detection.
        """
        # Use timing variability of past executions
        if "execution_times" not in self.state or len(self.state["execution_times"]) < 10:
            return 0.6  # Default slightly above average
            
        times = np.array(self.state["execution_times"])
        
        # Calculate coefficient of variation (CV)
        std_dev = np.std(times)
        mean = np.mean(times)
        
        if mean == 0:
            return 0.6
            
        cv = std_dev / mean
        
        # Map CV to 0-1 range (higher CV means more randomness)
        entropy = min(1.0, 0.5 + cv)
        
        # Further adjust based on strategy parameters
        # More variation in position sizes increases entropy
        if "max_position_size" in self.parameters and self.parameters["max_position_size"] > 2.0:
            entropy = min(1.0, entropy + 0.1)
            
        return entropy


class TriangularArbitrageStrategy(BaseStrategy):
    """
    A more advanced arbitrage strategy that identifies opportunities across three trading pairs.
    
    This strategy looks for price discrepancies in triangular relationships, such as:
    BTC/USD → ETH/BTC → ETH/USD
    
    Parameters:
    -----------
    exchange : str
        Exchange to execute the triangular arbitrage on
    base_asset : str
        Base asset to start and end with (e.g., "USD")
    intermediate_assets : List[str]
        List of intermediate assets to consider (e.g., ["BTC", "ETH"])
    min_profit_pct : float
        Minimum percentage profit required to execute (default: 0.3)
    max_position_size : float
        Maximum position size as a percentage of available capital (default: 1.0)
    """
    
    def __init__(self, 
                 strategy_id: str,
                 exchange: str,
                 base_asset: str,
                 intermediate_assets: List[str],
                 min_profit_pct: float = 0.3,
                 max_position_size: float = 1.0):
        """Initialize the triangular arbitrage strategy."""
        parameters = {
            "exchange": exchange,
            "base_asset": base_asset,
            "intermediate_assets": intermediate_assets,
            "min_profit_pct": min_profit_pct,
            "max_position_size": max_position_size
        }
        super().__init__(strategy_id, parameters)
        
        # Initialize strategy-specific state
        self.state = {
            "trades_count": 0,
            "successful_arbs": 0,
            "total_profit": 0.0,
            "opportunities_found": 0,
            "opportunities_executed": 0,
            "execution_times": []
        }
        
    async def analyze(self, market_data: MarketData) -> Optional[Signal]:
        """
        Analyze market data to identify triangular arbitrage opportunities.
        
        Returns a Signal if an opportunity is found, otherwise None.
        """
        # Find triangular arbitrage opportunities
        # In a real implementation, this would be more sophisticated
        
        # For now, we'll just return None as a placeholder
        # In a complete implementation, this would calculate triangular arbitrage opportunities
        # across the specified intermediate assets
        
        return None
    
    def _find_triangular_opportunities(self, market_data: MarketData) -> List[Dict[str, Any]]:
        """
        Find all potential triangular arbitrage opportunities.
        
        Returns a list of dictionaries containing opportunity details.
        """
        opportunities = []
        base_asset = self.parameters["base_asset"]
        exchange = self.parameters["exchange"]
        
        for asset1 in self.parameters["intermediate_assets"]:
            for asset2 in self.parameters["intermediate_assets"]:
                if asset1 == asset2:
                    continue
                    
                # Construct the three pairs for the triangular arbitrage
                pair1 = f"{asset1}/{base_asset}"  # e.g., BTC/USD
                pair2 = f"{asset2}/{asset1}"      # e.g., ETH/BTC
                pair3 = f"{asset2}/{base_asset}"  # e.g., ETH/USD
                
                # Check if we have all required price data
                if not self._has_price_data(market_data, exchange, [pair1, pair2, pair3]):
                    continue
                
                # Calculate potential profit
                profit_pct = self._calculate_triangular_profit(
                    market_data, exchange, pair1, pair2, pair3)
                
                if profit_pct > self.parameters["min_profit_pct"]:
                    opportunities.append({
                        "base_asset": base_asset,
                        "asset1": asset1,
                        "asset2": asset2,
                        "pair1": pair1,
                        "pair2": pair2,
                        "pair3": pair3,
                        "profit_pct": profit_pct
                    })
        
        return opportunities
    
    def _has_price_data(self, market_data: MarketData, exchange: str, pairs: List[str]) -> bool:
        """Check if we have price data for all required pairs."""
        # In a real implementation, this would check for the existence of price data
        # for all specified pairs on the exchange
        return False  # Placeholder
    
    def _calculate_triangular_profit(self, 
                                    market_data: MarketData, 
                                    exchange: str,
                                    pair1: str, 
                                    pair2: str, 
                                    pair3: str) -> float:
        """Calculate the potential profit from a triangular arbitrage opportunity."""
        # In a real implementation, this would calculate the profit percentage
        # from following the triangular path:
        # base_asset → asset1 → asset2 → base_asset
        return 0.0  # Placeholder 