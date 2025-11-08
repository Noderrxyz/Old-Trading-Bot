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

//! Example implementations and demonstrations for Noderr Protocol components.

mod trust_feedback_demo;
pub use trust_feedback_demo::run_trust_feedback_demo;

mod global_loop_example;
pub use global_loop_example::run_global_loop_example;

mod trust_decay_example;
pub use trust_decay_example::run_trust_decay_simulation_example;

mod correlation_example;
pub use correlation_example::run_correlation_example;

pub mod strategy_executor_integration;
pub mod risk_strategy_integration;

// Add the new regime allocation example module
pub mod risk_management_example;
pub mod strategy_execution_example;
pub mod performance_analytics_example;
pub mod trust_scoring_example;
pub mod regime_allocation_example;

// Re-export examples for easier access
pub use risk_management_example::run_risk_management_example;
pub use strategy_execution_example::run_strategy_execution_example;
pub use performance_analytics_example::run_performance_analytics_example;
pub use trust_scoring_example::run_trust_scoring_example;
pub use correlation_example::run_correlation_example;
pub use regime_allocation_example::run_regime_allocation_example; 