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

// Re-export public items
pub use crate::market_regime::hmm::{
    HiddenMarkovModel, MarketObservation, calculate_market_features, normalize_observations
};

// Re-export HMM detector
pub use crate::market_regime::hmm_detector::{
    HmmRegimeConfig, HmmMarketRegimeDetector, create_hmm_regime_detector, create_default_hmm_regime_detector
};

// Re-export leading indicators
pub use crate::market_regime::leading_indicators::{
    LeadingIndicator, IndicatorDirection, RegimeWarning, IndicatorConfig,
    RegimeForecast, StrategyPrepSignal, StrategyPrepAction
};

// Re-export warning engine
pub use crate::market_regime::warning_engine::{
    RegimeWarningConfig, RegimeWarningEngine, RegimeWarningError,
    create_regime_warning_engine, create_regime_warning_engine_with_config
};

// Re-export key types from parent module
pub use crate::market_regime::{
    MarketRegimeError, MarketRegimeResult, MarketRegimeState, MarketRegime, 
    MarketRegimeConfig, MarketRegimeDetector
};

// Make sub-modules available
pub mod hmm;
pub mod hmm_detector;
pub mod leading_indicators;
pub mod warning_engine; 