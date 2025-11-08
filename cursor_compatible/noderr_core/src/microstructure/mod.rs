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

//! Market Microstructure Analysis Module
//!
//! This module provides tools for analyzing low-level market behavior,
//! including order flow, liquidity profiling, and trade aggressiveness.

pub mod order_flow;
pub mod liquidity;
pub mod footprint;
pub mod timing_signals;

// Re-export main types
pub use order_flow::{
    OrderFlowAnalyzer, 
    OrderFlowMetrics, 
    OrderFlowEvent, 
    TradeAggression,
    OrderImbalance,
    create_order_flow_analyzer
};

pub use liquidity::{
    LiquidityProfiler,
    LiquiditySnapshot,
    create_liquidity_profiler
};

pub use footprint::{
    FootprintChartData,
    PriceLevel,
    FootprintDataPipeline,
    create_footprint_pipeline
};

pub use timing_signals::{
    ExecutionTimingSignal,
    TimingSignalEngine,
    SignalConfidence,
    create_timing_signal_engine
}; 