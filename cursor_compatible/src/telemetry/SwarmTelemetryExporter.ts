import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { TelemetryBus } from './TelemetryBus';
import { SwarmRuntime, SwarmRuntimeMetrics } from '../swarm/SwarmRuntime';
import { AgentState } from '../swarm/SwarmAgent';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Configuration for SwarmTelemetryExporter
 */
export interface SwarmTelemetryExporterConfig {
  /**
   * How often to collect and export metrics in milliseconds
   */
  collectIntervalMs: number;
  
  /**
   * Whether to enable detailed metrics
   */
  detailedMetrics: boolean;
  
  /**
   * File path to write metrics to (for scraping by Prometheus)
   */
  metricsFilePath?: string;
  
  /**
   * HTTP port to expose metrics on (if using HTTP server mode)
   */
  httpPort?: number;
  
  /**
   * Whether to enable HTTP server for metrics
   */
  enableHttpServer: boolean;
  
  /**
   * Maximum metrics history to keep in memory
   */
  maxMetricsHistory: number;
  
  /**
   * Node labels to include with metrics
   */
  nodeLabels?: Record<string, string>;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: SwarmTelemetryExporterConfig = {
  collectIntervalMs: 15000,
  detailedMetrics: true,
  enableHttpServer: false,
  maxMetricsHistory: 1000,
  metricsFilePath: path.join(os.tmpdir(), 'noderr_metrics.prom')
};

/**
 * Metric type
 */
export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  SUMMARY = 'summary'
}

/**
 * Metric definition
 */
export interface MetricDefinition {
  /**
   * Metric name
   */
  name: string;
  
  /**
   * Metric help text
   */
  help: string;
  
  /**
   * Metric type
   */
  type: MetricType;
  
  /**
   * Label names this metric can have
   */
  labelNames: string[];
}

/**
 * Metric value with labels
 */
export interface MetricValue {
  /**
   * Metric name
   */
  name: string;
  
  /**
   * Metric value
   */
  value: number;
  
  /**
   * Labels for this metric value
   */
  labels: Record<string, string>;
  
  /**
   * Timestamp when this metric was collected
   */
  timestamp: number;
}

/**
 * SwarmTelemetryExporter
 * 
 * Exports swarm telemetry metrics in a Prometheus-compatible format
 * for monitoring and alerting.
 */
export class SwarmTelemetryExporter extends EventEmitter {
  private static instance: SwarmTelemetryExporter | null = null;
  private config: SwarmTelemetryExporterConfig;
  private telemetryBus: TelemetryBus;
  private swarmRuntime: SwarmRuntime;
  private collectInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private metrics: Map<string, MetricDefinition> = new Map();
  private metricValues: Map<string, MetricValue[]> = new Map();
  private httpServer: any = null; // Simple HTTP server (would use express or similar in production)
  
  /**
   * Private constructor
   */
  private constructor(config: Partial<SwarmTelemetryExporterConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetryBus = TelemetryBus.getInstance();
    this.swarmRuntime = SwarmRuntime.getInstance();
    
    // Define default metrics
    this.defineDefaultMetrics();
    
    logger.info('SwarmTelemetryExporter initialized');
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<SwarmTelemetryExporterConfig>): SwarmTelemetryExporter {
    if (!SwarmTelemetryExporter.instance) {
      SwarmTelemetryExporter.instance = new SwarmTelemetryExporter(config);
    }
    return SwarmTelemetryExporter.instance;
  }
  
  /**
   * Start the exporter
   */
  public start(): void {
    if (this.isRunning) {
      logger.warn('SwarmTelemetryExporter already running');
      return;
    }
    
    logger.info('Starting SwarmTelemetryExporter...');
    
    // Subscribe to relevant telemetry events
    this.subscribeTelemetryEvents();
    
    // Start collection interval
    this.collectInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.collectIntervalMs);
    
    // Start HTTP server if enabled
    if (this.config.enableHttpServer && this.config.httpPort) {
      this.startHttpServer();
    }
    
    this.isRunning = true;
    logger.info(`SwarmTelemetryExporter started with ${this.config.enableHttpServer ? 'HTTP server on port ' + this.config.httpPort : 'file export'} mode`);
  }
  
  /**
   * Stop the exporter
   */
  public stop(): void {
    if (!this.isRunning) {
      return;
    }
    
    // Clear collection interval
    if (this.collectInterval) {
      clearInterval(this.collectInterval);
      this.collectInterval = null;
    }
    
    // Unsubscribe from telemetry events
    this.unsubscribeTelemetryEvents();
    
    // Stop HTTP server if running
    if (this.httpServer) {
      // In a real implementation, this would properly close the server
      this.httpServer = null;
    }
    
    this.isRunning = false;
    logger.info('SwarmTelemetryExporter stopped');
  }
  
  /**
   * Define a new metric
   */
  public defineMetric(def: MetricDefinition): void {
    this.metrics.set(def.name, def);
  }
  
  /**
   * Record a metric value
   */
  public recordMetric(metric: MetricValue): void {
    if (!this.metrics.has(metric.name)) {
      logger.warn(`Attempting to record undefined metric: ${metric.name}`);
      return;
    }
    
    // Initialize metric values array if needed
    if (!this.metricValues.has(metric.name)) {
      this.metricValues.set(metric.name, []);
    }
    
    // Add metric value
    const values = this.metricValues.get(metric.name)!;
    values.push({
      ...metric,
      timestamp: metric.timestamp || Date.now()
    });
    
    // Trim if exceeding max history
    if (values.length > this.config.maxMetricsHistory) {
      values.splice(0, values.length - this.config.maxMetricsHistory);
    }
  }
  
  /**
   * Get all metric definitions
   */
  public getMetricDefinitions(): MetricDefinition[] {
    return Array.from(this.metrics.values());
  }
  
  /**
   * Get metric values for a specific metric
   */
  public getMetricValues(metricName: string): MetricValue[] {
    return this.metricValues.get(metricName) || [];
  }
  
  /**
   * Get all current metric values
   */
  public getAllMetricValues(): Record<string, MetricValue[]> {
    const result: Record<string, MetricValue[]> = {};
    
    for (const [name, values] of this.metricValues.entries()) {
      result[name] = [...values];
    }
    
    return result;
  }
  
  /**
   * Format metrics in Prometheus text format
   */
  public formatMetricsForPrometheus(): string {
    let output = '';
    
    // Group metrics by name
    for (const [name, def] of this.metrics.entries()) {
      // Add metric definition comments
      output += `# HELP ${name} ${def.help}\n`;
      output += `# TYPE ${name} ${def.type}\n`;
      
      // Add metric values
      const values = this.metricValues.get(name) || [];
      if (values.length === 0) continue;
      
      // For each value, format as Prometheus line
      for (const value of values) {
        // Skip outdated values, only include most recent for Prometheus format
        if (value.timestamp < Date.now() - this.config.collectIntervalMs * 2) continue;
        
        // Format labels if present
        let labelStr = '';
        const labels = { ...value.labels };
        
        if (Object.keys(labels).length > 0 || (this.config.nodeLabels && Object.keys(this.config.nodeLabels).length > 0)) {
          // Add node labels
          if (this.config.nodeLabels) {
            Object.assign(labels, this.config.nodeLabels);
          }
          
          const labelParts = Object.entries(labels).map(([k, v]) => `${k}="${v.toString().replace(/"/g, '\\"')}"`);
          labelStr = `{${labelParts.join(',')}}`;
        }
        
        output += `${name}${labelStr} ${value.value}\n`;
      }
      
      output += '\n';
    }
    
    return output;
  }
  
  /**
   * Export metrics to file
   */
  public exportMetricsToFile(): void {
    if (!this.config.metricsFilePath) {
      logger.warn('No metrics file path configured');
      return;
    }
    
    try {
      const metricsStr = this.formatMetricsForPrometheus();
      fs.writeFileSync(this.config.metricsFilePath, metricsStr);
      logger.debug(`Exported metrics to ${this.config.metricsFilePath}`);
    } catch (error) {
      logger.error(`Failed to export metrics to file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Define default metrics
   */
  private defineDefaultMetrics(): void {
    // Runtime metrics
    this.defineMetric({
      name: 'noderr_swarm_active_agents',
      help: 'Number of active agents running in the swarm node',
      type: MetricType.GAUGE,
      labelNames: ['node_id', 'region']
    });
    
    this.defineMetric({
      name: 'noderr_swarm_connected_peers',
      help: 'Number of connected peers in the swarm',
      type: MetricType.GAUGE,
      labelNames: ['node_id', 'region']
    });
    
    this.defineMetric({
      name: 'noderr_swarm_memory_usage_mb',
      help: 'Memory usage of the swarm node in MB',
      type: MetricType.GAUGE,
      labelNames: ['node_id', 'region']
    });
    
    this.defineMetric({
      name: 'noderr_swarm_cpu_usage',
      help: 'CPU usage of the swarm node',
      type: MetricType.GAUGE,
      labelNames: ['node_id', 'region']
    });
    
    this.defineMetric({
      name: 'noderr_swarm_uptime_seconds',
      help: 'Uptime of the swarm node in seconds',
      type: MetricType.COUNTER,
      labelNames: ['node_id', 'region']
    });
    
    // Agent metrics
    this.defineMetric({
      name: 'noderr_agent_execution_time_ms',
      help: 'Execution time of agent cycle in milliseconds',
      type: MetricType.GAUGE,
      labelNames: ['node_id', 'agent_id', 'symbol', 'state']
    });
    
    this.defineMetric({
      name: 'noderr_agent_signal_count',
      help: 'Number of signals generated by the agent',
      type: MetricType.COUNTER,
      labelNames: ['node_id', 'agent_id', 'symbol']
    });
    
    this.defineMetric({
      name: 'noderr_agent_error_count',
      help: 'Number of errors encountered by the agent',
      type: MetricType.COUNTER,
      labelNames: ['node_id', 'agent_id', 'symbol']
    });
    
    this.defineMetric({
      name: 'noderr_agent_performance_score',
      help: 'Overall performance score of the agent',
      type: MetricType.GAUGE,
      labelNames: ['node_id', 'agent_id', 'symbol', 'regime']
    });
    
    // Memory metrics
    this.defineMetric({
      name: 'noderr_memory_record_count',
      help: 'Number of records in the distributed memory',
      type: MetricType.GAUGE,
      labelNames: ['node_id', 'region']
    });
    
    this.defineMetric({
      name: 'noderr_memory_sync_count',
      help: 'Number of memory synchronizations',
      type: MetricType.COUNTER,
      labelNames: ['node_id', 'region']
    });
    
    // Mutation metrics
    this.defineMetric({
      name: 'noderr_mutation_cycle_count',
      help: 'Number of mutation cycles completed',
      type: MetricType.COUNTER,
      labelNames: ['node_id', 'region']
    });
    
    this.defineMetric({
      name: 'noderr_mutation_success_rate',
      help: 'Success rate of mutations (0-1)',
      type: MetricType.GAUGE,
      labelNames: ['node_id', 'region']
    });

    // Execution metrics
    this.defineMetric({
      name: 'execution_transactions_total',
      help: 'Total number of transactions executed, by chain, market, and status',
      type: MetricType.COUNTER,
      labelNames: ['chain_id', 'market', 'status']
    });

    this.defineMetric({
      name: 'execution_transactions_latency_ms',
      help: 'Execution latency in milliseconds, by chain and market',
      type: MetricType.HISTOGRAM,
      labelNames: ['chain_id', 'market']
    });

    this.defineMetric({
      name: 'execution_gas_cost',
      help: 'Gas/fee cost for transactions, by chain',
      type: MetricType.HISTOGRAM,
      labelNames: ['chain_id']
    });

    this.defineMetric({
      name: 'execution_slippage_percentage',
      help: 'Actual slippage percentage for transactions, by chain and market',
      type: MetricType.HISTOGRAM,
      labelNames: ['chain_id', 'market']
    });

    this.defineMetric({
      name: 'execution_chain_health',
      help: 'Health score for each chain (0-1)',
      type: MetricType.GAUGE,
      labelNames: ['chain_id']
    });

    this.defineMetric({
      name: 'execution_chain_block_height',
      help: 'Latest block height for each chain',
      type: MetricType.GAUGE,
      labelNames: ['chain_id']
    });

    this.defineMetric({
      name: 'execution_chain_tps',
      help: 'Current TPS (transactions per second) for each chain',
      type: MetricType.GAUGE,
      labelNames: ['chain_id']
    });

    this.defineMetric({
      name: 'execution_routing_decisions_total',
      help: 'Total routing decisions made, by selected chain',
      type: MetricType.COUNTER,
      labelNames: ['selected_chain', 'reason']
    });

    this.defineMetric({
      name: 'execution_strategy_deployments_total',
      help: 'Total strategy deployments, by chain',
      type: MetricType.COUNTER,
      labelNames: ['chain_id', 'status']
    });

    this.defineMetric({
      name: 'execution_security_authorizations_total',
      help: 'Total security authorization attempts, by chain and status',
      type: MetricType.COUNTER,
      labelNames: ['chain_id', 'status', 'reason']
    });

    this.defineMetric({
      name: 'execution_retry_attempts_total',
      help: 'Total retry attempts for failed executions, by chain',
      type: MetricType.COUNTER,
      labelNames: ['chain_id', 'success']
    });

    this.defineMetric({
      name: 'execution_adapter_status',
      help: 'Status of chain adapters (1=operational, 0=down)',
      type: MetricType.GAUGE,
      labelNames: ['chain_id', 'network']
    });
  }
  
  /**
   * Subscribe to telemetry events
   */
  private subscribeTelemetryEvents(): void {
    // Runtime events
    this.telemetryBus.on('swarm_runtime_started', this.handleRuntimeStarted.bind(this));
    this.telemetryBus.on('swarm_runtime_stopped', this.handleRuntimeStopped.bind(this));
    this.telemetryBus.on('swarm_coordination_completed', this.handleCoordinationCompleted.bind(this));
    
    // Agent events
    this.telemetryBus.on('agent_created', this.handleAgentCreated.bind(this));
    this.telemetryBus.on('agent_stopped', this.handleAgentStopped.bind(this));
    this.telemetryBus.on('agent_failure', this.handleAgentFailure.bind(this));
    this.telemetryBus.on('agent_execution_error', this.handleAgentExecutionError.bind(this));
    
    // Memory events
    this.telemetryBus.on('memory_sync_completed', this.handleMemorySyncCompleted.bind(this));
    
    // Mutation events
    this.telemetryBus.on('agent_genome_updated', this.handleGenomeUpdated.bind(this));

    // Execution events
    this.telemetryBus.on('ethereum_execution_completed', (event) => this.handleExecutionCompleted(event));
    this.telemetryBus.on('solana_execution_completed', (event) => this.handleExecutionCompleted(event));
    this.telemetryBus.on('ethereum_execution_failed', (event) => this.handleExecutionFailed(event));
    this.telemetryBus.on('solana_execution_failed', (event) => this.handleExecutionFailed(event));
    this.telemetryBus.on('execution_chain_selected', (event) => this.handleChainSelected(event));
    this.telemetryBus.on('ethereum_health_check', (event) => this.handleChainHealthCheck(event));
    this.telemetryBus.on('solana_health_check', (event) => this.handleChainHealthCheck(event));
    this.telemetryBus.on('ethereum_adapter_initialized', (event) => this.handleAdapterStatus(event, true));
    this.telemetryBus.on('solana_adapter_initialized', (event) => this.handleAdapterStatus(event, true));
    this.telemetryBus.on('ethereum_adapter_initialization_failed', (event) => this.handleAdapterStatus(event, false));
    this.telemetryBus.on('solana_adapter_initialization_failed', (event) => this.handleAdapterStatus(event, false));
    this.telemetryBus.on('strategy_deployment_registered', (event) => this.handleStrategyDeployment(event, 'success'));
    this.telemetryBus.on('execution_security_blocked', (event) => this.handleSecurityAuthorization(event, 'blocked'));
    this.telemetryBus.on('execution_authorization_granted', (event) => this.handleSecurityAuthorization(event, 'granted'));
    this.telemetryBus.on('execution_authorization_rejected', (event) => this.handleSecurityAuthorization(event, 'rejected'));
    this.telemetryBus.on('execution_retry_attempt', (event) => this.handleRetryAttempt(event));
  }
  
  /**
   * Unsubscribe from telemetry events
   */
  private unsubscribeTelemetryEvents(): void {
    // Use the removeAllListeners method that we added to TelemetryBus
    this.telemetryBus.removeAllListeners();
    logger.debug('Removed all telemetry event listeners');

    // Execution events
    this.telemetryBus.off('ethereum_execution_completed', (event) => this.handleExecutionCompleted(event));
    this.telemetryBus.off('solana_execution_completed', (event) => this.handleExecutionCompleted(event));
    this.telemetryBus.off('ethereum_execution_failed', (event) => this.handleExecutionFailed(event));
    this.telemetryBus.off('solana_execution_failed', (event) => this.handleExecutionFailed(event));
    this.telemetryBus.off('execution_chain_selected', (event) => this.handleChainSelected(event));
    this.telemetryBus.off('ethereum_health_check', (event) => this.handleChainHealthCheck(event));
    this.telemetryBus.off('solana_health_check', (event) => this.handleChainHealthCheck(event));
    this.telemetryBus.off('ethereum_adapter_initialized', (event) => this.handleAdapterStatus(event, true));
    this.telemetryBus.off('solana_adapter_initialized', (event) => this.handleAdapterStatus(event, true));
    this.telemetryBus.off('ethereum_adapter_initialization_failed', (event) => this.handleAdapterStatus(event, false));
    this.telemetryBus.off('solana_adapter_initialization_failed', (event) => this.handleAdapterStatus(event, false));
    this.telemetryBus.off('strategy_deployment_registered', (event) => this.handleStrategyDeployment(event, 'success'));
    this.telemetryBus.off('execution_security_blocked', (event) => this.handleSecurityAuthorization(event, 'blocked'));
    this.telemetryBus.off('execution_authorization_granted', (event) => this.handleSecurityAuthorization(event, 'granted'));
    this.telemetryBus.off('execution_authorization_rejected', (event) => this.handleSecurityAuthorization(event, 'rejected'));
    this.telemetryBus.off('execution_retry_attempt', (event) => this.handleRetryAttempt(event));
  }
  
  /**
   * Start HTTP server for metrics
   */
  private startHttpServer(): void {
    // In a real implementation, this would use express or similar
    // For this implementation, we'll simulate the HTTP server
    
    logger.info(`Metrics HTTP server would start on port ${this.config.httpPort}`);
    
    // Simulate HTTP server object
    this.httpServer = {
      close: () => {
        logger.info('Metrics HTTP server would close');
      }
    };
  }
  
  /**
   * Collect metrics from the swarm
   */
  private collectMetrics(): void {
    try {
      // Collect runtime metrics
      this.collectRuntimeMetrics();
      
      // Collect agent metrics
      this.collectAgentMetrics();
      
      // Collect execution metrics
      this.collectExecutionMetrics();
      
      // Export metrics if file path is configured
      if (this.config.metricsFilePath) {
        this.exportMetricsToFile();
      }
      
      // Emit event
      this.emit('metrics_collected', {
        timestamp: Date.now(),
        metricCount: this.metricValues.size
      });
    } catch (error) {
      logger.error(`Error collecting metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Collect runtime metrics
   */
  private collectRuntimeMetrics(): void {
    const metrics = this.swarmRuntime.getRuntimeMetrics();
    const nodeId = metrics.nodeId;
    const region = metrics.region;
    
    // Record active agents
    this.recordMetric({
      name: 'noderr_swarm_active_agents',
      value: metrics.activeAgents,
      labels: { node_id: nodeId, region },
      timestamp: Date.now()
    });
    
    // Record connected peers
    this.recordMetric({
      name: 'noderr_swarm_connected_peers',
      value: metrics.connectedPeers,
      labels: { node_id: nodeId, region },
      timestamp: Date.now()
    });
    
    // Record memory usage
    this.recordMetric({
      name: 'noderr_swarm_memory_usage_mb',
      value: metrics.memoryUsage,
      labels: { node_id: nodeId, region },
      timestamp: Date.now()
    });
    
    // Record CPU usage
    this.recordMetric({
      name: 'noderr_swarm_cpu_usage',
      value: metrics.cpuUsage,
      labels: { node_id: nodeId, region },
      timestamp: Date.now()
    });
    
    // Record uptime
    this.recordMetric({
      name: 'noderr_swarm_uptime_seconds',
      value: metrics.uptime / 1000, // Convert ms to seconds
      labels: { node_id: nodeId, region },
      timestamp: Date.now()
    });
  }
  
  /**
   * Collect agent metrics
   */
  private collectAgentMetrics(): void {
    const nodeId = this.swarmRuntime.getNodeId();
    const agents = this.swarmRuntime.getAllAgents();
    
    for (const agent of agents) {
      const agentId = agent.getAgentId();
      const symbol = agent.getSymbol();
      const state = agent.getState();
      const metrics = agent.getMetrics();
      
      // Record execution time
      this.recordMetric({
        name: 'noderr_agent_execution_time_ms',
        value: metrics.averageExecutionTimeMs,
        labels: { node_id: nodeId, agent_id: agentId, symbol, state },
        timestamp: Date.now()
      });
      
      // Record signal count
      this.recordMetric({
        name: 'noderr_agent_signal_count',
        value: metrics.signalCount,
        labels: { node_id: nodeId, agent_id: agentId, symbol },
        timestamp: Date.now()
      });
      
      // Record error count
      this.recordMetric({
        name: 'noderr_agent_error_count',
        value: metrics.errorCount,
        labels: { node_id: nodeId, agent_id: agentId, symbol },
        timestamp: Date.now()
      });
      
      // Record performance score
      this.recordMetric({
        name: 'noderr_agent_performance_score',
        value: metrics.currentScore,
        labels: { 
          node_id: nodeId, 
          agent_id: agentId, 
          symbol,
          regime: metrics.lastRegime
        },
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Collect execution-related metrics
   */
  private collectExecutionMetrics(): void {
    try {
      // In a full implementation, we might fetch some metrics directly from the execution system
      // For this example, most metrics will come from event handlers
      logger.debug('Collecting execution metrics');
    } catch (error) {
      logger.error(`Error collecting execution metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Event handlers
  
  private handleRuntimeStarted(event: any): void {
    logger.debug('Runtime started event received');
  }
  
  private handleRuntimeStopped(event: any): void {
    logger.debug('Runtime stopped event received');
  }
  
  private handleCoordinationCompleted(event: any): void {
    // Update connected peers metric
    this.recordMetric({
      name: 'noderr_swarm_connected_peers',
      value: event.peerCount || 0,
      labels: { node_id: event.nodeId, region: this.swarmRuntime.getRegion() },
      timestamp: event.timestamp
    });
  }
  
  private handleAgentCreated(event: any): void {
    logger.debug(`Agent created event: ${event.agentId}`);
  }
  
  private handleAgentStopped(event: any): void {
    logger.debug(`Agent stopped event: ${event.agentId}`);
  }
  
  private handleAgentFailure(event: any): void {
    // Increment error count
    this.recordMetric({
      name: 'noderr_agent_error_count',
      value: 1, // Increment by 1
      labels: { 
        node_id: event.nodeId, 
        agent_id: event.agentId, 
        symbol: event.symbol 
      },
      timestamp: event.timestamp
    });
  }
  
  private handleAgentExecutionError(event: any): void {
    // Already handled by agent_failure event
    logger.debug(`Agent execution error: ${event.agentId} - ${event.error}`);
  }
  
  private handleMemorySyncCompleted(event: any): void {
    // Increment sync count
    this.recordMetric({
      name: 'noderr_memory_sync_count',
      value: 1, // Increment by 1
      labels: { node_id: event.nodeId, region: this.swarmRuntime.getRegion() },
      timestamp: event.timestamp
    });
    
    // Update record count
    this.recordMetric({
      name: 'noderr_memory_record_count',
      value: event.recordCount || 0,
      labels: { node_id: event.nodeId, region: this.swarmRuntime.getRegion() },
      timestamp: event.timestamp
    });
  }
  
  private handleGenomeUpdated(event: any): void {
    logger.debug(`Genome updated event: ${event.agentId}`);
  }

  /**
   * Handle transaction completed events
   */
  private handleExecutionCompleted(event: any): void {
    // Increment transaction counter
    this.recordMetric({
      name: 'execution_transactions_total',
      value: 1,
      labels: {
        chain_id: event.chainId,
        market: event.market,
        status: 'success'
      },
      timestamp: event.timestamp
    });
    
    // Record execution latency
    this.recordMetric({
      name: 'execution_transactions_latency_ms',
      value: event.executionTimeMs,
      labels: {
        chain_id: event.chainId,
        market: event.market
      },
      timestamp: event.timestamp
    });
    
    // Record gas cost
    this.recordMetric({
      name: 'execution_gas_cost',
      value: event.feeCost,
      labels: {
        chain_id: event.chainId
      },
      timestamp: event.timestamp
    });
    
    // Record slippage if available
    if (event.actualSlippage !== undefined) {
      this.recordMetric({
        name: 'execution_slippage_percentage',
        value: event.actualSlippage,
        labels: {
          chain_id: event.chainId,
          market: event.market
        },
        timestamp: event.timestamp
      });
    }
  }

  /**
   * Handle transaction failed events
   */
  private handleExecutionFailed(event: any): void {
    // Increment transaction counter
    this.recordMetric({
      name: 'execution_transactions_total',
      value: 1,
      labels: {
        chain_id: event.chainId,
        market: event.market,
        status: 'failed'
      },
      timestamp: event.timestamp
    });
  }

  /**
   * Handle chain selection events
   */
  private handleChainSelected(event: any): void {
    // Increment routing decision counter
    this.recordMetric({
      name: 'execution_routing_decisions_total',
      value: 1,
      labels: {
        selected_chain: event.chainId,
        reason: event.reason
      },
      timestamp: event.timestamp
    });
  }

  /**
   * Handle chain health check events
   */
  private handleChainHealthCheck(event: any): void {
    // Update chain health
    this.recordMetric({
      name: 'execution_chain_health',
      value: event.networkCongestion ? 1 - event.networkCongestion : 0.5, // Invert congestion for health
      labels: {
        chain_id: event.chainId
      },
      timestamp: event.timestamp
    });
    
    // Update block height
    if (event.blockHeight !== undefined) {
      this.recordMetric({
        name: 'execution_chain_block_height',
        value: event.blockHeight,
        labels: {
          chain_id: event.chainId
        },
        timestamp: event.timestamp
      });
    }
    
    // Update TPS
    if (event.currentTps !== undefined) {
      this.recordMetric({
        name: 'execution_chain_tps',
        value: event.currentTps,
        labels: {
          chain_id: event.chainId
        },
        timestamp: event.timestamp
      });
    }
  }

  /**
   * Handle adapter status events
   */
  private handleAdapterStatus(event: any, isOperational: boolean): void {
    // Update adapter status
    this.recordMetric({
      name: 'execution_adapter_status',
      value: isOperational ? 1 : 0,
      labels: {
        chain_id: event.chainId,
        network: event.networkName || event.network || 'unknown'
      },
      timestamp: event.timestamp
    });
  }

  /**
   * Handle strategy deployment events
   */
  private handleStrategyDeployment(event: any, status: string): void {
    // Increment deployment counter
    this.recordMetric({
      name: 'execution_strategy_deployments_total',
      value: 1,
      labels: {
        chain_id: event.chainId,
        status
      },
      timestamp: event.timestamp
    });
  }

  /**
   * Handle security authorization events
   */
  private handleSecurityAuthorization(event: any, status: string): void {
    // Increment authorization counter
    this.recordMetric({
      name: 'execution_security_authorizations_total',
      value: 1,
      labels: {
        chain_id: event.chainId,
        status,
        reason: event.reason || 'unknown'
      },
      timestamp: event.timestamp
    });
  }

  /**
   * Handle retry attempt events
   */
  private handleRetryAttempt(event: any): void {
    // Increment retry counter
    this.recordMetric({
      name: 'execution_retry_attempts_total',
      value: 1,
      labels: {
        chain_id: event.chainId,
        success: event.success ? 'true' : 'false'
      },
      timestamp: event.timestamp
    });
  }
} 