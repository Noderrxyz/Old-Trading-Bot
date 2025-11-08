use anyhow::Result;
use clap::{Args, Subcommand};
use comfy_table::{ContentArrangement, Table};
use serde::{Deserialize, Serialize};
use colored::Colorize;
use std::collections::HashMap;
use chrono::{DateTime, Utc};
use std::path::PathBuf;
use serde_json;
use serde_yaml;
use std::fs;
use anyhow::anyhow;
use uuid::Uuid;

// Add the ReasonChainBuilder struct as described in the requirements
/// Builder for constructing reasoning chains step by step
#[derive(Debug, Clone)]
pub struct ReasonChainBuilder {
    /// Collection of reasoning steps
    steps: Vec<String>,
    /// Context for this reasoning chain
    context: HashMap<String, serde_json::Value>,
    /// Timestamp of when this reasoning chain was started
    timestamp: DateTime<Utc>,
    /// Decision ID for this reasoning
    decision_id: String,
    /// Agent ID responsible for this reasoning
    agent_id: String,
}

impl ReasonChainBuilder {
    /// Create a new reasoning chain builder
    pub fn new(agent_id: String) -> Self {
        Self {
            steps: Vec::new(),
            context: HashMap::new(),
            timestamp: Utc::now(),
            decision_id: format!("decision-{}", Uuid::new_v4()),
            agent_id,
        }
    }
    
    /// Create a new reasoning chain builder with a specific decision ID
    pub fn with_decision_id(agent_id: String, decision_id: String) -> Self {
        Self {
            steps: Vec::new(),
            context: HashMap::new(),
            timestamp: Utc::now(),
            decision_id,
            agent_id,
        }
    }

    /// Add a reasoning step to the chain
    pub fn push<S: Into<String>>(&mut self, reason: S) {
        self.steps.push(reason.into());
    }
    
    /// Add multiple reasoning steps at once
    pub fn push_all<S: Into<String>>(&mut self, reasons: Vec<S>) {
        for reason in reasons {
            self.steps.push(reason.into());
        }
    }
    
    /// Add context information
    pub fn with_context<S: Into<String>, V: Serialize>(&mut self, key: S, value: V) -> Result<&mut Self> {
        let value = serde_json::to_value(value)?;
        self.context.insert(key.into(), value);
        Ok(self)
    }
    
    /// Set the timestamp
    pub fn with_timestamp(&mut self, timestamp: DateTime<Utc>) -> &mut Self {
        self.timestamp = timestamp;
        self
    }
    
    /// Get the decision ID
    pub fn decision_id(&self) -> &str {
        &self.decision_id
    }
    
    /// Get the current reasoning steps
    pub fn steps(&self) -> &Vec<String> {
        &self.steps
    }
    
    /// Get the reasoning steps and consume the builder
    pub fn finalize(self) -> Vec<String> {
        self.steps
    }
    
    /// Convert to a reason chain export
    pub async fn to_export(self, final_strategy: String, final_score: f32, confidence: f32) -> Result<crate::reason_exporter::ReasonChainExport> {
        let context_json = serde_json::to_string(&self.context)?;
        
        Ok(crate::reason_exporter::ReasonChainExport {
            decision_id: self.decision_id,
            agent_id: self.agent_id,
            context: context_json,
            timestamp: self.timestamp.timestamp(),
            steps: self.steps,
            final_strategy,
            final_score,
            confidence,
        })
    }
    
    /// Export the reasoning chain to storage
    pub async fn export(self, final_strategy: String, final_score: f32, confidence: f32) -> Result<()> {
        let export = self.to_export(final_strategy, final_score, confidence).await?;
        crate::reason_exporter::ReasonChainExporter::export(export).await
    }
}

/// Command for exporting and visualizing reasoning chains
#[derive(Debug, clap::Parser)]
pub struct ReasonChainCommand {
    #[clap(subcommand)]
    pub subcommand: ReasonChainSubcommand,
}

#[derive(Debug, clap::Subcommand)]
pub enum ReasonChainSubcommand {
    /// Export a reasoning chain from a decision or simulation
    Export(ExportArgs),
    
    /// Visualize a reasoning chain in different formats
    Visualize(VisualizeArgs),
    
    /// List available reason chains from simulations or decisions
    List(ListArgs),
    
    /// Simulate API endpoint for getting decision explanation
    Api(ApiArgs),
    
    /// Query and display agent reasoning records (agent:reasons)
    Reasons(ReasonsArgs),
}

#[derive(Debug, Args)]
pub struct ExportArgs {
    /// Decision ID or simulation ID to export the reason chain from
    #[clap(short, long)]
    pub decision_id: String,
    
    /// Output file path for the exported reasoning chain
    #[clap(short, long)]
    pub output: Option<PathBuf>,
    
    /// Include detailed explanations in natural language
    #[clap(short, long)]
    pub debug_explanation: bool,
    
    /// Export format (json, yaml, markdown)
    #[clap(short, long, default_value = "json")]
    pub format: String,
}

#[derive(Debug, Args)]
pub struct VisualizeArgs {
    /// Decision ID or path to exported reason chain file
    #[clap(short, long)]
    pub source: String,
    
    /// Visualization format (dot, mermaid, text)
    #[clap(short, long, default_value = "text")]
    pub format: String,
    
    /// Output file for the visualization
    #[clap(short, long)]
    pub output: Option<PathBuf>,
    
    /// Include detailed component explanations
    #[clap(short, long)]
    pub detailed: bool,
}

#[derive(Debug, Args)]
pub struct ListArgs {
    /// Filter by agent ID
    #[clap(short, long)]
    pub agent_id: Option<String>,
    
    /// Filter by time period in hours
    #[clap(short, long, default_value = "24")]
    pub hours: u64,
    
    /// Show detailed information
    #[clap(short, long)]
    pub detailed: bool,
}

#[derive(Debug, Args)]
pub struct ApiArgs {
    /// Decision ID to explain
    #[clap(short, long)]
    pub decision_id: String,
    
    /// Include detailed explanations
    #[clap(short, long)]
    pub debug_explanation: bool,
    
    /// Output format (json, pretty)
    #[clap(short, long, default_value = "pretty")]
    pub format: String,
}

#[derive(Debug, Args)]
pub struct ReasonsArgs {
    /// Agent ID to filter reasoning chains
    #[clap(long)]
    pub agent_id: String,
    
    /// Maximum number of records to display
    #[clap(long, default_value = "10")]
    pub limit: usize,
    
    /// Export format (none, csv, json, pdf)
    #[clap(long, default_value = "none")]
    pub export: String,
    
    /// Output file path for export
    #[clap(long)]
    pub output: Option<PathBuf>,
}

/// Types for the reasoning chain structures

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SignalSummary {
    pub id: String,
    pub source: String,
    pub timestamp: String,
    pub confidence: f32,
    pub impact_score: f32,
    pub description: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StrategyReport {
    pub id: String,
    pub name: String,
    pub confidence_score: f32,
    pub risk_evaluation: String,
    pub expected_outcome: String,
    pub consideration_factors: Vec<String>,
    pub was_selected: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReasonChainReport {
    pub decision_id: String,
    pub agent_id: String,
    pub timestamp: String,
    pub signals_considered: Vec<SignalSummary>,
    pub strategies_considered: Vec<StrategyReport>,
    pub strategy_selected: Option<StrategyReport>,
    pub risk_assessment: String,
    pub final_action: String,
    pub explanation: Option<String>,
}

/// Mock structures to represent the agent decision trace
/// In a real implementation, these would come from the actual agent system

#[derive(Debug, Clone)]
pub struct SignalMetadata {
    pub id: String,
    pub source: String,
    pub timestamp: String,
    pub confidence: f32,
    pub impact_score: f32,
    pub description: String,
}

#[derive(Debug, Clone)]
pub struct StrategyAttempt {
    pub id: String,
    pub name: String,
    pub confidence_score: f32,
    pub risk_evaluation: String,
    pub expected_outcome: String,
    pub consideration_factors: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct RiskAssessment {
    pub level: String,
    pub factors: Vec<String>,
    pub mitigation_steps: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct TradeAction {
    pub action_type: String,
    pub parameters: HashMap<String, String>,
    pub justification: String,
}

#[derive(Debug, Clone)]
pub struct AgentDecisionTrace {
    pub decision_id: String,
    pub agent_id: String,
    pub timestamp: String,
    pub signals: Vec<SignalMetadata>,
    pub strategy_candidates: Vec<StrategyAttempt>,
    pub selected_strategy_id: Option<String>,
    pub risk_outcome: RiskAssessment,
    pub final_decision: TradeAction,
}

pub type CommandResult = Result<()>;

pub async fn run_reason_chain_command(command: &ReasonChainCommand) -> CommandResult {
    match &command.subcommand {
        ReasonChainSubcommand::Export(args) => export_reason_chain(args).await,
        ReasonChainSubcommand::Visualize(args) => visualize_reason_chain(args).await,
        ReasonChainSubcommand::List(args) => list_reason_chains(args).await,
        ReasonChainSubcommand::Api(args) => simulate_api_endpoint(args).await,
        ReasonChainSubcommand::Reasons(args) => reasons_command(args).await,
    }
}

async fn export_reason_chain(args: &ExportArgs) -> CommandResult {
    println!("{}", "🔍 Exporting Reasoning Chain".bright_blue());
    println!("Decision ID: {}", args.decision_id.bright_yellow());
    
    // Simulate fetching decision trace from database or simulation storage
    println!("\n{}", "Fetching decision trace...".italic());
    tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;
    
    // Generate mock decision trace for demonstration
    let decision_trace = get_mock_decision_trace(&args.decision_id);
    println!("Found decision trace for agent: {}", decision_trace.agent_id.bright_green());
    
    // Convert to report format
    let report = generate_reason_chain_report(&decision_trace, args.debug_explanation);
    
    // Display summary information
    println!("\nReasoning Chain Summary:");
    println!("Signals Considered: {}", report.signals_considered.len());
    println!("Strategies Evaluated: {}", report.strategies_considered.len());
    println!("Selected Strategy: {}", report.strategy_selected.as_ref().map_or("None".to_string(), |s| s.name.clone()));
    println!("Final Action: {}", report.final_action);
    
    // Export to file if specified
    if let Some(output_path) = &args.output {
        println!("\n{}", "Exporting to file...".italic());
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        
        export_to_file(&report, output_path, &args.format, args.debug_explanation).await?;
        
        let file_path = match args.format.to_lowercase().as_str() {
            "json" => format!("{}.json", output_path.display()),
            "yaml" => format!("{}.yaml", output_path.display()),
            "markdown" => format!("{}.md", output_path.display()),
            _ => format!("{}.json", output_path.display()),
        };
        
        println!("Reason chain exported to: {}", file_path.bright_green());
    } else {
        // Print the report details to console
        print_reason_chain_report(&report);
    }
    
    Ok(())
}

// Function to export reason chain to various file formats
async fn export_to_file(report: &ReasonChainReport, path: &PathBuf, format: &str, include_explanation: bool) -> Result<()> {
    let content = match format.to_lowercase().as_str() {
        "json" => {
            // Export as JSON
            let json_value = if include_explanation {
                // Use API format that includes explanations
                generate_api_response(report)
            } else {
                // Use simpler JSON format
                serde_json::to_value(report)?
            };
            
            serde_json::to_string_pretty(&json_value)?
        },
        "yaml" => {
            // Export as YAML
            serde_yaml::to_string(report)?
        },
        "markdown" => {
            // Export as Markdown
            generate_markdown_report(report)
        },
        "core" => {
            // Export to core-compatible format
            let core_format = export_to_core_format(report);
            serde_json::to_string_pretty(&core_format)?
        },
        _ => {
            // Default to JSON
            serde_json::to_string_pretty(&serde_json::to_value(report)?)?
        }
    };
    
    // In a real implementation, we would write to the file
    // For demonstration, we'll just simulate the file write
    println!("Writing {} bytes to {}.{}", content.len(), path.display(), format.to_lowercase());
    
    Ok(())
}

// Generate a markdown representation of the report
fn generate_markdown_report(report: &ReasonChainReport) -> String {
    let mut markdown = String::new();
    
    // Add header
    markdown.push_str(&format!("# Reasoning Chain Report: {}\n\n", report.decision_id));
    markdown.push_str(&format!("- **Agent**: {}\n", report.agent_id));
    markdown.push_str(&format!("- **Timestamp**: {}\n", report.timestamp));
    markdown.push_str(&format!("- **Final Action**: {}\n\n", report.final_action));
    
    // Add signals section
    markdown.push_str("## Signals Considered\n\n");
    if report.signals_considered.is_empty() {
        markdown.push_str("*No signals considered*\n\n");
    } else {
        for signal in &report.signals_considered {
            markdown.push_str(&format!("### Signal: {}\n", signal.id));
            markdown.push_str(&format!("- **Description**: {}\n", signal.description));
            markdown.push_str(&format!("- **Source**: {}\n", signal.source));
            markdown.push_str(&format!("- **Confidence**: {:.1}%\n", signal.confidence * 100.0));
            markdown.push_str(&format!("- **Impact**: {:.1}%\n", signal.impact_score * 100.0));
            markdown.push_str(&format!("- **Timestamp**: {}\n\n", signal.timestamp));
        }
    }
    
    // Add strategies section
    markdown.push_str("## Strategies Evaluated\n\n");
    if report.strategies_considered.is_empty() {
        markdown.push_str("*No strategies evaluated*\n\n");
    } else {
        for strategy in &report.strategies_considered {
            let selected_label = if strategy.was_selected { " ✅ **SELECTED**" } else { "" };
            markdown.push_str(&format!("### Strategy: {}{}\n", strategy.name, selected_label));
            markdown.push_str(&format!("- **ID**: {}\n", strategy.id));
            markdown.push_str(&format!("- **Confidence**: {:.1}%\n", strategy.confidence_score * 100.0));
            markdown.push_str(&format!("- **Risk**: {}\n", strategy.risk_evaluation));
            markdown.push_str(&format!("- **Expected Outcome**: {}\n", strategy.expected_outcome));
            
            // Add consideration factors
            markdown.push_str("- **Consideration Factors**:\n");
            for factor in &strategy.consideration_factors {
                markdown.push_str(&format!("  - {}\n", factor));
            }
            markdown.push_str("\n");
        }
    }
    
    // Add risk assessment section
    markdown.push_str("## Risk Assessment\n\n");
    markdown.push_str(&format!("- **Level**: {}\n\n", report.risk_assessment));
    
    // Add explanation if available
    if let Some(explanation) = &report.explanation {
        markdown.push_str("## Explanation\n\n");
        markdown.push_str(&format!("{}\n\n", explanation));
    }
    
    // Add metadata footer
    markdown.push_str("---\n");
    markdown.push_str(&format!("Generated on: {}\n", chrono::Utc::now().to_rfc3339()));
    
    markdown
}

async fn visualize_reason_chain(args: &VisualizeArgs) -> CommandResult {
    println!("{}", "📊 Visualizing Reasoning Chain".bright_blue());
    println!("Source: {}", args.source.bright_yellow());
    println!("Format: {}", args.format.to_uppercase());
    
    // Simulate loading decision trace or reading from file
    println!("\n{}", "Loading reason chain data...".italic());
    tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;
    
    let is_decision_id = !args.source.contains('.');
    
    if is_decision_id {
        println!("Loading decision trace for ID: {}", args.source);
        // In a real implementation, we would load from storage
    } else {
        println!("Loading reason chain from file: {}", args.source);
        // In a real implementation, we would read from file
    }
    
    // Generate mock data for demonstration
    let decision_trace = get_mock_decision_trace("decision-123");
    let report = generate_reason_chain_report(&decision_trace, args.detailed);
    
    match args.format.to_lowercase().as_str() {
        "dot" => visualize_as_dot(&report, args.output.as_ref(), args.detailed),
        "mermaid" => visualize_as_mermaid(&report, args.output.as_ref(), args.detailed),
        "text" => visualize_as_text(&report, args.detailed),
        _ => {
            println!("Unsupported visualization format: {}", args.format);
            println!("Defaulting to text visualization.");
            visualize_as_text(&report, args.detailed);
        }
    }
    
    Ok(())
}

async fn list_reason_chains(args: &ListArgs) -> CommandResult {
    println!("{}", "📋 Available Reasoning Chains".bright_blue());
    
    if let Some(agent_id) = &args.agent_id {
        println!("Filtering by Agent ID: {}", agent_id.bright_yellow());
    }
    println!("Time Period: Last {} hours", args.hours);
    
    // Simulate fetching from database
    println!("\n{}", "Retrieving reason chains...".italic());
    tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
    
    // Create a table to display the results
    let mut table = Table::new();
    table.set_content_arrangement(ContentArrangement::Dynamic);
    
    if args.detailed {
        table.set_header(vec![
            "Decision ID", "Agent ID", "Timestamp", "Signals", "Strategies", 
            "Selected Strategy", "Action"
        ]);
        
        // Add mock data
        table.add_row(vec![
            "decision-123", "agent-1", "2023-09-15 14:32:45", "4", "3", 
            "Market Trend Follower", "BUY"
        ]);
        
        table.add_row(vec![
            "decision-124", "agent-2", "2023-09-15 15:10:22", "5", "2", 
            "Risk Minimizer", "HOLD"
        ]);
        
        table.add_row(vec![
            "decision-125", "agent-1", "2023-09-15 16:45:10", "3", "4", 
            "Volatility Adapter", "SELL"
        ]);
    } else {
        table.set_header(vec!["Decision ID", "Agent ID", "Timestamp", "Action"]);
        
        // Add mock data
        table.add_row(vec!["decision-123", "agent-1", "2023-09-15 14:32:45", "BUY"]);
        table.add_row(vec!["decision-124", "agent-2", "2023-09-15 15:10:22", "HOLD"]);
        table.add_row(vec!["decision-125", "agent-1", "2023-09-15 16:45:10", "SELL"]);
    }
    
    println!("{}", table);
    
    println!("\n{}", "Use 'reason-chain export --decision-id <ID>' to export a specific reasoning chain".italic());
    
    Ok(())
}

// Helper function to generate a mock decision trace for demonstration
fn get_mock_decision_trace(decision_id: &str) -> AgentDecisionTrace {
    let signals = vec![
        SignalMetadata {
            id: "signal-1".to_string(),
            source: "market_data".to_string(),
            timestamp: "2023-09-15T14:30:00Z".to_string(),
            confidence: 0.85,
            impact_score: 0.7,
            description: "Price above 50-day moving average".to_string(),
        },
        SignalMetadata {
            id: "signal-2".to_string(),
            source: "sentiment_analysis".to_string(),
            timestamp: "2023-09-15T14:31:15Z".to_string(),
            confidence: 0.72,
            impact_score: 0.5,
            description: "Positive social media sentiment detected".to_string(),
        },
        SignalMetadata {
            id: "signal-3".to_string(),
            source: "news_feed".to_string(),
            timestamp: "2023-09-15T14:29:30Z".to_string(),
            confidence: 0.95,
            impact_score: 0.8,
            description: "Favorable quarterly earnings report".to_string(),
        },
    ];
    
    let strategy_candidates = vec![
        StrategyAttempt {
            id: "strategy-1".to_string(),
            name: "Market Trend Follower".to_string(),
            confidence_score: 0.78,
            risk_evaluation: "Medium".to_string(),
            expected_outcome: "8.5% potential gain with 4.2% risk".to_string(),
            consideration_factors: vec![
                "Price momentum".to_string(),
                "Moving average crossover".to_string(),
                "Volume increase".to_string(),
            ],
        },
        StrategyAttempt {
            id: "strategy-2".to_string(),
            name: "Risk Minimizer".to_string(),
            confidence_score: 0.65,
            risk_evaluation: "Low".to_string(),
            expected_outcome: "3.2% potential gain with 1.5% risk".to_string(),
            consideration_factors: vec![
                "Volatility assessment".to_string(),
                "Historical support levels".to_string(),
            ],
        },
        StrategyAttempt {
            id: "strategy-3".to_string(),
            name: "Sentiment Driven".to_string(),
            confidence_score: 0.72,
            risk_evaluation: "Medium-High".to_string(),
            expected_outcome: "12.1% potential gain with 7.8% risk".to_string(),
            consideration_factors: vec![
                "Social sentiment score".to_string(),
                "News sentiment analysis".to_string(),
                "Market mood index".to_string(),
            ],
        },
    ];
    
    let mut params = HashMap::new();
    params.insert("asset".to_string(), "AAPL".to_string());
    params.insert("quantity".to_string(), "100".to_string());
    params.insert("price".to_string(), "185.50".to_string());
    
    AgentDecisionTrace {
        decision_id: decision_id.to_string(),
        agent_id: "agent-1".to_string(),
        timestamp: "2023-09-15T14:32:45Z".to_string(),
        signals,
        strategy_candidates,
        selected_strategy_id: Some("strategy-1".to_string()),
        risk_outcome: RiskAssessment {
            level: "Medium".to_string(),
            factors: vec![
                "Market volatility".to_string(),
                "Recent earnings report".to_string(),
            ],
            mitigation_steps: vec![
                "Set stop loss at 175.25".to_string(),
                "Monitor hourly for sentiment shifts".to_string(),
            ],
        },
        final_decision: TradeAction {
            action_type: "BUY".to_string(),
            parameters: params,
            justification: "Strong technical indicators and positive sentiment".to_string(),
        },
    }
}

// Convert from AgentDecisionTrace to ReasonChainReport
fn generate_reason_chain_report(decision: &AgentDecisionTrace, include_explanation: bool) -> ReasonChainReport {
    let signals_considered = decision.signals.iter().map(|s| SignalSummary {
        id: s.id.clone(),
        source: s.source.clone(),
        timestamp: s.timestamp.clone(),
        confidence: s.confidence,
        impact_score: s.impact_score,
        description: s.description.clone(),
    }).collect();
    
    let strategies_considered = decision.strategy_candidates.iter().map(|s| StrategyReport {
        id: s.id.clone(),
        name: s.name.clone(),
        confidence_score: s.confidence_score,
        risk_evaluation: s.risk_evaluation.clone(),
        expected_outcome: s.expected_outcome.clone(),
        consideration_factors: s.consideration_factors.clone(),
        was_selected: decision.selected_strategy_id.as_ref().map_or(false, |selected_id| selected_id == &s.id),
    }).collect();
    
    let strategy_selected = decision.selected_strategy_id.as_ref().and_then(|selected_id| {
        decision.strategy_candidates.iter().find(|s| &s.id == selected_id).map(|s| StrategyReport {
            id: s.id.clone(),
            name: s.name.clone(),
            confidence_score: s.confidence_score,
            risk_evaluation: s.risk_evaluation.clone(),
            expected_outcome: s.expected_outcome.clone(),
            consideration_factors: s.consideration_factors.clone(),
            was_selected: true,
        })
    });
    
    let explanation = if include_explanation {
        Some(generate_natural_language_explanation(decision))
    } else {
        None
    };
    
    ReasonChainReport {
        decision_id: decision.decision_id.clone(),
        agent_id: decision.agent_id.clone(),
        timestamp: decision.timestamp.clone(),
        signals_considered,
        strategies_considered,
        strategy_selected,
        risk_assessment: decision.risk_outcome.level.clone(),
        final_action: decision.final_decision.action_type.clone(),
        explanation,
    }
}

// Generate a natural language explanation of the decision process
fn generate_natural_language_explanation(decision: &AgentDecisionTrace) -> String {
    let strategy_name = decision.selected_strategy_id.as_ref()
        .and_then(|id| decision.strategy_candidates.iter().find(|s| &s.id == id))
        .map_or("No strategy".to_string(), |s| s.name.clone());
    
    format!(
        "Agent {} evaluated {} signals and {} strategies at {}. Based primarily on {} and {}, \
        it selected the {} strategy. The risk was assessed as {}, with mitigation steps including {}. \
        The final decision was to {} {} units of {} at a price of {}.",
        decision.agent_id,
        decision.signals.len(),
        decision.strategy_candidates.len(),
        decision.timestamp,
        decision.signals.first().map_or("no signals", |s| &s.description),
        decision.signals.get(1).map_or("", |s| &s.description),
        strategy_name,
        decision.risk_outcome.level,
        decision.risk_outcome.mitigation_steps.first().unwrap_or(&"none".to_string()),
        decision.final_decision.action_type,
        decision.final_decision.parameters.get("quantity").unwrap_or(&"unknown".to_string()),
        decision.final_decision.parameters.get("asset").unwrap_or(&"unknown".to_string()),
        decision.final_decision.parameters.get("price").unwrap_or(&"unknown".to_string())
    )
}

// Print a reasoning chain report to the console
fn print_reason_chain_report(report: &ReasonChainReport) {
    println!("\n{}", "📊 Reason Chain Report".bright_blue().bold());
    println!("Decision ID: {}", report.decision_id);
    println!("Agent: {}", report.agent_id);
    println!("Timestamp: {}", report.timestamp);
    
    println!("\n{}", "📡 Signals Considered:".bright_yellow().bold());
    for signal in &report.signals_considered {
        println!("  • {} (confidence: {:.1}%, impact: {:.1}%)", 
            signal.description.bold(), 
            signal.confidence * 100.0,
            signal.impact_score * 100.0);
        println!("    Source: {} at {}", signal.source, signal.timestamp);
    }
    
    println!("\n{}", "🧠 Strategies Evaluated:".bright_yellow().bold());
    for strategy in &report.strategies_considered {
        let status = if strategy.was_selected { 
            "[SELECTED]".bright_green().bold() 
        } else { 
            "".normal() 
        };
        
        println!("  • {} {} (confidence: {:.1}%)", 
            strategy.name.bold(), 
            status,
            strategy.confidence_score * 100.0);
        println!("    Risk: {}, Expected outcome: {}", 
            strategy.risk_evaluation,
            strategy.expected_outcome);
        println!("    Factors: {}", strategy.consideration_factors.join(", "));
    }
    
    println!("\n{}", "🛡️ Risk Assessment:".bright_yellow().bold());
    println!("  Level: {}", report.risk_assessment);
    
    println!("\n{}", "🎯 Final Decision:".bright_yellow().bold());
    println!("  Action: {}", report.final_action.bold());
    
    if let Some(explanation) = &report.explanation {
        println!("\n{}", "🔍 Explanation:".bright_yellow().bold());
        println!("  {}", explanation);
    }
}

// Visualize as DOT graph format
fn visualize_as_dot(report: &ReasonChainReport, output_path: Option<&PathBuf>, detailed: bool) {
    println!("\n{}", "Generating DOT graph visualization...".italic());
    
    // Generate mock DOT graph for demonstration
    println!("digraph ReasoningChain {");
    println!("  node [shape=box, style=filled, fillcolor=lightblue];");
    println!("  Decision [label=\"Decision\\n{}\"];", report.decision_id);
    
    for (i, signal) in report.signals_considered.iter().enumerate() {
        println!("  Signal{} [label=\"Signal {}\\n{}\"];", 
            i, signal.id, signal.description);
        println!("  Signal{} -> Decision;", i);
    }
    
    for (i, strategy) in report.strategies_considered.iter().enumerate() {
        let color = if strategy.was_selected { "lightgreen" } else { "white" };
        println!("  Strategy{} [label=\"Strategy\\n{}\", fillcolor=\"{}\"];", 
            i, strategy.name, color);
        println!("  Strategy{} -> Decision;", i);
        
        for (j, factor) in strategy.consideration_factors.iter().enumerate() {
            if detailed {
                println!("  Factor{}{} [label=\"Factor\\n{}\", fillcolor=\"lightgrey\"];", 
                    i, j, factor);
                println!("  Factor{}{} -> Strategy{};", i, j, i);
            }
        }
    }
    
    println!("  Action [label=\"Action\\n{}\", fillcolor=\"orange\"];", report.final_action);
    println!("  Decision -> Action;");
    println!("}");
    
    if let Some(path) = output_path {
        println!("\nDOT graph saved to: {}.dot", path.display());
        println!("You can render this with Graphviz: dot -Tpng {}.dot -o {}.png", path.display(), path.display());
    }
}

// Visualize as Mermaid chart
fn visualize_as_mermaid(report: &ReasonChainReport, output_path: Option<&PathBuf>, detailed: bool) {
    println!("\n{}", "Generating Mermaid chart visualization...".italic());
    
    // Generate mock Mermaid chart for demonstration
    println!("```mermaid");
    println!("graph TD");
    println!("  Decision[\"Decision<br/>{}\"]", report.decision_id);
    
    for (i, signal) in report.signals_considered.iter().enumerate() {
        println!("  Signal{}[\"Signal: {}\"]", i, signal.description);
        println!("  Signal{} --> Decision", i);
    }
    
    for (i, strategy) in report.strategies_considered.iter().enumerate() {
        let style = if strategy.was_selected { 
            ", style=filled, fillcolor=#lightgreen" 
        } else { 
            "" 
        };
        
        println!("  Strategy{}[\"Strategy: {}\"{style}]", i, strategy.name);
        println!("  Strategy{} --> Decision", i);
        
        if detailed {
            for (j, factor) in strategy.consideration_factors.iter().enumerate() {
                println!("  Factor{}{}[\"Factor: {}\"]", i, j, factor);
                println!("  Factor{}{} --> Strategy{}", i, j, i);
            }
        }
    }
    
    println!("  Action[\"Action: {}\", style=filled, fillcolor=#orange]", report.final_action);
    println!("  Decision --> Action");
    println!("```");
    
    if let Some(path) = output_path {
        println!("\nMermaid chart saved to: {}.md", path.display());
        println!("You can render this with a Mermaid-compatible Markdown viewer.");
    }
}

// Visualize as text-based tree
fn visualize_as_text(report: &ReasonChainReport, detailed: bool) {
    println!("\n{}", "Text Visualization of Reasoning Chain".bright_blue().bold());
    println!("Decision: {} (Agent: {}, Time: {})", 
        report.decision_id.bold(),
        report.agent_id,
        report.timestamp);
    
    println!("│");
    println!("├── Signals");
    
    for (i, signal) in report.signals_considered.iter().enumerate() {
        let is_last = i == report.signals_considered.len() - 1;
        let prefix = if is_last { "└── " } else { "├── " };
        
        println!("│   {}{} (confidence: {:.1}%)", 
            prefix, signal.description.bold(), signal.confidence * 100.0);
        
        if detailed {
            let detail_prefix = if is_last { "    " } else { "│   " };
            println!("│   {}└── Source: {} at {}", detail_prefix, signal.source, signal.timestamp);
        }
    }
    
    println!("│");
    println!("├── Strategies");
    
    for (i, strategy) in report.strategies_considered.iter().enumerate() {
        let is_last = i == report.strategies_considered.len() - 1;
        let prefix = if is_last { "└── " } else { "├── " };
        let status = if strategy.was_selected { 
            "[SELECTED]".bright_green().bold() 
        } else { 
            "".normal() 
        };
        
        println!("│   {}{} {} (confidence: {:.1}%)", 
            prefix, strategy.name.bold(), status, strategy.confidence_score * 100.0);
        
        if detailed {
            let detail_prefix = if is_last { "    " } else { "│   " };
            println!("│   {}├── Risk: {}", detail_prefix, strategy.risk_evaluation);
            println!("│   {}├── Outcome: {}", detail_prefix, strategy.expected_outcome);
            
            println!("│   {}└── Factors:", detail_prefix);
            
            for (j, factor) in strategy.consideration_factors.iter().enumerate() {
                let factor_is_last = j == strategy.consideration_factors.len() - 1;
                let factor_prefix = if factor_is_last { "└── " } else { "├── " };
                
                println!("│   {}    {}{}", detail_prefix, factor_prefix, factor);
            }
        }
    }
    
    println!("│");
    println!("├── Risk Assessment: {}", report.risk_assessment.bold());
    println!("│");
    println!("└── Final Action: {}", report.final_action.bold());
    
    if let Some(explanation) = &report.explanation {
        println!("\n{}", "Explanation:".bright_yellow().bold());
        println!("{}", explanation);
    }
}

// This function would take our CLI-oriented report and convert it to
// a format compatible with the noderr_core library's expected format
// for reasoning chain reports.
pub fn export_to_core_format(report: &ReasonChainReport) -> serde_json::Value {
    // In a real implementation, this would convert to the exact format
    // expected by noderr_core. For now, we'll create a sample JSON structure
    // that would be compatible with such a library.
    
    // Create signals array
    let signals = report.signals_considered.iter().map(|s| {
        serde_json::json!({
            "id": s.id,
            "source": s.source,
            "timestamp": s.timestamp,
            "confidence": s.confidence,
            "impact": s.impact_score,
            "description": s.description,
            "metadata": {
                "type": "signal",
                "format_version": "1.0"
            }
        })
    }).collect::<Vec<_>>();
    
    // Create strategies array
    let strategies = report.strategies_considered.iter().map(|s| {
        serde_json::json!({
            "id": s.id,
            "name": s.name,
            "confidence": s.confidence_score,
            "risk": s.risk_evaluation,
            "expected_outcome": s.expected_outcome,
            "factors": s.consideration_factors,
            "was_selected": s.was_selected,
            "metadata": {
                "type": "strategy",
                "format_version": "1.0"
            }
        })
    }).collect::<Vec<_>>();
    
    // Create the core-compatible structure
    serde_json::json!({
        "reason_chain": {
            "version": "1.0",
            "metadata": {
                "decision_id": report.decision_id,
                "agent_id": report.agent_id,
                "timestamp": report.timestamp,
                "export_timestamp": chrono::Utc::now().to_rfc3339()
            },
            "input": {
                "signals": signals
            },
            "processing": {
                "strategies": strategies,
                "selected_strategy": report.strategy_selected.as_ref().map(|s| s.id.clone())
            },
            "output": {
                "risk_assessment": report.risk_assessment,
                "action": report.final_action
            },
            "explanation": report.explanation
        }
    })
}

// Also add a helper function to generate a REST API compatible response 
// that matches the structure in the original prompt
pub fn generate_api_response(report: &ReasonChainReport) -> serde_json::Value {
    serde_json::json!({
        "signals_considered": report.signals_considered.iter().map(|s| {
            serde_json::json!({
                "id": s.id,
                "source": s.source,
                "confidence": s.confidence,
                "description": s.description
            })
        }).collect::<Vec<_>>(),
        "strategies_considered": report.strategies_considered.iter().map(|s| {
            serde_json::json!({
                "id": s.id,
                "name": s.name,
                "confidence_score": s.confidence_score,
                "risk_evaluation": s.risk_evaluation,
                "expected_outcome": s.expected_outcome,
                "consideration_factors": s.consideration_factors
            })
        }).collect::<Vec<_>>(),
        "strategy_selected": report.strategy_selected.as_ref().map(|s| {
            serde_json::json!({
                "id": s.id,
                "name": s.name,
                "confidence_score": s.confidence_score,
                "risk_evaluation": s.risk_evaluation,
                "expected_outcome": s.expected_outcome,
                "consideration_factors": s.consideration_factors
            })
        }),
        "risk_decision": {
            "level": report.risk_assessment
        },
        "final_action": report.final_action,
        "explanation": report.explanation
    })
}

// Function to simulate the API endpoint functionality
pub async fn api_explain_decision(decision_id: &str, debug_explanation: bool) -> Result<serde_json::Value> {
    // In a real implementation, this would load the decision trace from
    // a database, memory store, or SQLite trace log.
    // For demonstration, we'll use our mock implementation
    
    // Simulate data retrieval delay
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
    
    // Check if the decision trace exists (simulated)
    if decision_id.is_empty() || (!decision_id.starts_with("decision-") && !decision_id.starts_with("sim-")) {
        return Err(anyhow!("Decision ID not found or invalid format"));
    }
    
    // Get the decision trace
    let decision_trace = get_mock_decision_trace(decision_id);
    
    // Generate the report
    let report = generate_reason_chain_report(&decision_trace, debug_explanation);
    
    // Convert to API response format
    let response = generate_api_response(&report);
    
    Ok(response)
}

// Add this function to load a decision trace from a file (for future implementation)
pub async fn load_decision_trace_from_file(file_path: &PathBuf) -> Result<AgentDecisionTrace> {
    // In a real implementation, this would read the file and deserialize
    // the decision trace from JSON or another format.
    // For demonstration, we'll return a mock trace
    
    if !file_path.exists() {
        return Err(anyhow!("File not found: {}", file_path.display()));
    }
    
    // Simulate file read delay
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    
    // For demonstration, parse the decision ID from the filename
    let file_name = file_path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("unknown");
    
    let decision_id = if file_name.contains("decision-") {
        let parts: Vec<&str> = file_name.split('.').collect();
        parts[0].to_string()
    } else {
        "decision-from-file".to_string()
    };
    
    Ok(get_mock_decision_trace(&decision_id))
}

// Implementation of the simulate_api_endpoint function
async fn simulate_api_endpoint(args: &ApiArgs) -> CommandResult {
    println!("{}", "🌐 Simulating API Endpoint".bright_blue());
    println!("GET /explain/{}", args.decision_id.bright_yellow());
    
    if args.debug_explanation {
        println!("Query param: debug_explanation=true");
    }
    
    // Simulate API processing
    println!("\n{}", "Processing request...".italic());
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    
    // Call the API function
    match api_explain_decision(&args.decision_id, args.debug_explanation).await {
        Ok(response) => {
            println!("{}", "✅ Request successful".bright_green());
            println!("Status: 200 OK");
            println!("Content-Type: application/json");
            
            // Display the response based on format
            if args.format == "pretty" {
                println!("\nResponse Body:");
                let pretty_json = serde_json::to_string_pretty(&response)?;
                println!("{}", pretty_json);
            } else {
                println!("\nResponse JSON:");
                let json = serde_json::to_string(&response)?;
                println!("{}", json);
            }
        },
        Err(e) => {
            println!("{}", "❌ Request failed".bright_red());
            println!("Status: 404 Not Found");
            println!("Error: {}", e);
        }
    }
    
    println!("\n{}", "This is a simulation of how the API endpoint would work.".italic());
    println!("In a real implementation, this would be accessible via HTTP.");
    
    Ok(())
}

/// Implementation of the 'agent:reasons' command
async fn reasons_command(args: &ReasonsArgs) -> CommandResult {
    println!("{}", "🧠 Agent Reasoning Records".bright_blue());
    println!("Agent ID: {}", args.agent_id.bright_yellow());
    println!("Limit: {}", args.limit);
    println!("Retrieving records from database...");
    
    // Query the database for reasoning chains
    let chains = crate::reason_exporter::ReasonChainExporter::get_chains_by_agent(
        &args.agent_id,
        args.limit,
        Some(24 * 30), // Default to last 30 days
    ).await?;
    
    if chains.is_empty() {
        println!("\n{}", "No reasoning records found for this agent.".bright_yellow());
        return Ok(());
    }
    
    println!("\nFound {} reasoning records:", chains.len().to_string().bright_green());
    
    // Create a table for displaying the chains
    let mut table = Table::new();
    table.set_content_arrangement(ContentArrangement::Dynamic);
    table.set_header(vec![
        "Decision ID".bright_blue(),
        "Timestamp".bright_blue(),
        "Steps".bright_blue(),
        "Final Strategy".bright_blue(),
        "Score".bright_blue(),
        "Confidence".bright_blue(),
    ]);
    
    for chain in &chains {
        // Format the timestamp
        let dt = DateTime::<Utc>::from_timestamp(chain.timestamp, 0)
            .unwrap_or_else(|| Utc::now());
            
        // Format steps as a bullet list but limit for display
        let steps_display = if chain.steps.len() > 3 {
            let mut display = chain.steps[0..3].join("\n• ");
            display.insert(0, '•');
            display.push_str("\n• ...");
            display
        } else if !chain.steps.is_empty() {
            let mut display = chain.steps.join("\n• ");
            display.insert(0, '•');
            display
        } else {
            "[No steps recorded]".to_string()
        };
        
        table.add_row(vec![
            chain.decision_id.clone(),
            dt.format("%Y-%m-%d %H:%M:%S").to_string(),
            steps_display,
            chain.final_strategy.clone(),
            format!("{:.2}", chain.final_score),
            format!("{:.2}", chain.confidence),
        ]);
    }
    
    println!("{}", table);
    
    // Export if requested
    if args.export != "none" {
        if let Some(path) = &args.output {
            match args.export.as_str() {
                "csv" => export_to_csv(&chains, path)?,
                "json" => export_to_json(&chains, path)?,
                "pdf" => {
                    println!("{}", "PDF export not implemented yet.".bright_red());
                    println!("Falling back to JSON export.");
                    export_to_json(&chains, path)?
                },
                _ => {
                    println!("{}", format!("Unknown export format: {}", args.export).bright_red());
                }
            }
            println!("Exported reasoning chains to {}", path.display());
        } else {
            println!("{}", "Error: --output must be specified when using --export".bright_red());
        }
    }
    
    Ok(())
}

/// Export reasoning chains to CSV
fn export_to_csv(chains: &[crate::reason_exporter::ReasonChainExport], path: &PathBuf) -> Result<()> {
    use std::io::Write;
    
    let mut file = fs::File::create(path)?;
    
    // Write header
    writeln!(file, "decision_id,agent_id,timestamp,steps,final_strategy,final_score,confidence")?;
    
    // Write data
    for chain in chains {
        let dt = DateTime::<Utc>::from_timestamp(chain.timestamp, 0)
            .unwrap_or_else(|| Utc::now())
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
        
        // Escape and join steps for CSV
        let steps = chain.steps.iter()
            .map(|s| s.replace(',', "\\,").replace('"', "\"\""))
            .collect::<Vec<_>>()
            .join("||"); // Using || as a separator that's unlikely to be in the steps
        
        writeln!(
            file,
            "\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",{:.2},{:.2}",
            chain.decision_id,
            chain.agent_id,
            dt,
            steps,
            chain.final_strategy,
            chain.final_score,
            chain.confidence
        )?;
    }
    
    Ok(())
}

/// Export reasoning chains to JSON
fn export_to_json(chains: &[crate::reason_exporter::ReasonChainExport], path: &PathBuf) -> Result<()> {
    // Convert to a format more suitable for export
    let export_data: Vec<serde_json::Value> = chains.iter().map(|chain| {
        let dt = DateTime::<Utc>::from_timestamp(chain.timestamp, 0)
            .unwrap_or_else(|| Utc::now());
            
        serde_json::json!({
            "decision_id": chain.decision_id,
            "agent_id": chain.agent_id,
            "timestamp": dt.to_rfc3339(),
            "context": chain.context,
            "steps": chain.steps,
            "final_strategy": chain.final_strategy,
            "final_score": chain.final_score,
            "confidence": chain.confidence
        })
    }).collect();
    
    // Write to file
    let json = serde_json::to_string_pretty(&export_data)?;
    fs::write(path, json)?;
    
    Ok(())
} 