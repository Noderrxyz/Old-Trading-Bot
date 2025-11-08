/**
 * Prometheus metrics for Noderr Protocol Trading Bot
 * 
 * This file defines metrics for monitoring the performance and reliability
 * of blockchain adapters, trading operations, and system health.
 */
import * as prom from 'prom-client';

// Ensure singleton behavior for metrics collection
export const register = new prom.Registry();

// Add default metrics (GC, memory, event loop, etc.)
prom.collectDefaultMetrics({ register });

//------------------------------------------------------------------------------
// Blockchain Adapter Metrics
//------------------------------------------------------------------------------

/**
 * RPC requests latency in milliseconds
 */
export const rpcLatency = new prom.Histogram({
  name: 'blockchain_rpc_latency_ms',
  help: 'Latency of blockchain RPC calls in milliseconds',
  labelNames: ['chain_id', 'method', 'mainnet', 'status'],
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [register]
});

/**
 * RPC request rate
 */
export const rpcRequests = new prom.Counter({
  name: 'blockchain_rpc_requests_total',
  help: 'Total number of blockchain RPC requests',
  labelNames: ['chain_id', 'method', 'mainnet', 'status'],
  registers: [register]
});

/**
 * RPC errors counter
 */
export const rpcErrors = new prom.Counter({
  name: 'blockchain_rpc_errors_total',
  help: 'Total number of blockchain RPC errors',
  labelNames: ['chain_id', 'method', 'mainnet', 'error_type'],
  registers: [register]
});

/**
 * Blockchain connection status (1=connected, 0=disconnected)
 */
export const connectionStatus = new prom.Gauge({
  name: 'blockchain_connection_status',
  help: 'Connection status for blockchain networks (1=connected, 0=disconnected)',
  labelNames: ['chain_id', 'mainnet'],
  registers: [register]
});

/**
 * Circuit breaker status (1=open, 0=closed)
 */
export const circuitBreakerStatus = new prom.Gauge({
  name: 'blockchain_circuit_breaker_status',
  help: 'Circuit breaker status (1=open, 0=closed)',
  labelNames: ['chain_id', 'mainnet'],
  registers: [register]
});

/**
 * Retry attempts counter
 */
export const retryAttempts = new prom.Counter({
  name: 'blockchain_retry_attempts_total',
  help: 'Total number of retry attempts for blockchain operations',
  labelNames: ['chain_id', 'method', 'mainnet'],
  registers: [register]
});

/**
 * Blockchain operation latency
 */
export const operationLatency = new prom.Histogram({
  name: 'blockchain_operation_latency_ms',
  help: 'Latency of blockchain operations in milliseconds',
  labelNames: ['chain_id', 'operation', 'mainnet', 'status'],
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
  registers: [register]
});

/**
 * Blockchain block height
 */
export const blockHeight = new prom.Gauge({
  name: 'blockchain_block_height',
  help: 'Current block height for blockchain networks',
  labelNames: ['chain_id', 'mainnet'],
  registers: [register]
});

/**
 * Gas price in Gwei
 */
export const gasPrice = new prom.Gauge({
  name: 'blockchain_gas_price_gwei',
  help: 'Current gas price in Gwei',
  labelNames: ['chain_id', 'mainnet'],
  registers: [register]
});

/**
 * Adapter queue depth
 */
export const adapterQueueDepth = new prom.Gauge({
  name: 'blockchain_adapter_queue_depth',
  help: 'Number of pending operations in adapter queue',
  labelNames: ['chain_id', 'mainnet'],
  registers: [register]
});

//------------------------------------------------------------------------------
// Trading and Execution Metrics
//------------------------------------------------------------------------------

/**
 * Trade execution latency
 */
export const tradeExecutionLatency = new prom.Histogram({
  name: 'trade_execution_latency_ms',
  help: 'Latency of trade execution in milliseconds',
  labelNames: ['chain_id', 'mainnet', 'status'],
  buckets: [100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
  registers: [register]
});

/**
 * Trade volume in USD
 */
export const tradeVolumeUsd = new prom.Counter({
  name: 'trade_volume_usd_total',
  help: 'Total trading volume in USD',
  labelNames: ['chain_id', 'mainnet', 'status'],
  registers: [register]
});

/**
 * Slippage percentage
 */
export const tradeSlippage = new prom.Histogram({
  name: 'trade_slippage_percent',
  help: 'Trade execution slippage percentage',
  labelNames: ['chain_id', 'mainnet'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [register]
});

/**
 * Trading fees in USD
 */
export const tradeFees = new prom.Counter({
  name: 'trade_fees_usd_total',
  help: 'Total trading fees in USD',
  labelNames: ['chain_id', 'mainnet', 'fee_type'],
  registers: [register]
});

//------------------------------------------------------------------------------
// Helper Functions to Record Metrics
//------------------------------------------------------------------------------

/**
 * Record the latency and status of an RPC call
 * 
 * @param chainId The chain ID
 * @param method The RPC method name
 * @param isMainnet Whether the chain is mainnet
 * @param startTime The start time of the operation (ms)
 * @param success Whether the operation succeeded
 * @param errorType Optional error type if the operation failed
 */
export function recordRpcMetrics(
  chainId: number,
  method: string,
  isMainnet: boolean,
  startTime: number,
  success: boolean,
  errorType?: string
): void {
  const latency = Date.now() - startTime;
  const status = success ? 'success' : 'failure';
  const mainnetLabel = isMainnet ? 'true' : 'false';

  // Record latency and request count
  rpcLatency.observe({ chain_id: chainId.toString(), method, mainnet: mainnetLabel, status }, latency);
  rpcRequests.inc({ chain_id: chainId.toString(), method, mainnet: mainnetLabel, status });

  // Record error if failed
  if (!success && errorType) {
    rpcErrors.inc({ chain_id: chainId.toString(), method, mainnet: mainnetLabel, error_type: errorType });
  }
}

/**
 * Record retry attempt for a blockchain operation
 * 
 * @param chainId The chain ID
 * @param method The method or operation name
 * @param isMainnet Whether the chain is mainnet
 */
export function recordRetryAttempt(
  chainId: number,
  method: string,
  isMainnet: boolean
): void {
  const mainnetLabel = isMainnet ? 'true' : 'false';
  retryAttempts.inc({ chain_id: chainId.toString(), method, mainnet: mainnetLabel });
}

/**
 * Update blockchain connection status
 * 
 * @param chainId The chain ID
 * @param isMainnet Whether the chain is mainnet
 * @param connected Whether the blockchain is connected
 * @param currentBlockHeight Optional current block height
 * @param currentGasPrice Optional current gas price in Gwei
 */
export function updateBlockchainConnectionStatus(
  chainId: number,
  isMainnet: boolean,
  connected: boolean,
  currentBlockHeight?: number,
  currentGasPrice?: number
): void {
  const mainnetLabel = isMainnet ? 'true' : 'false';
  
  // Update connection status gauge
  connectionStatus.set({ chain_id: chainId.toString(), mainnet: mainnetLabel }, connected ? 1 : 0);
  
  // Update block height if provided
  if (currentBlockHeight !== undefined) {
    blockHeight.set({ chain_id: chainId.toString(), mainnet: mainnetLabel }, currentBlockHeight);
  }
  
  // Update gas price if provided
  if (currentGasPrice !== undefined) {
    gasPrice.set({ chain_id: chainId.toString(), mainnet: mainnetLabel }, currentGasPrice);
  }
}

/**
 * Update circuit breaker state
 * 
 * @param chainId The chain ID
 * @param isMainnet Whether the chain is mainnet
 * @param isOpen Whether the circuit breaker is open
 */
export function updateCircuitBreakerState(
  chainId: number,
  isMainnet: boolean,
  isOpen: boolean
): void {
  const mainnetLabel = isMainnet ? 'true' : 'false';
  circuitBreakerStatus.set({ chain_id: chainId.toString(), mainnet: mainnetLabel }, isOpen ? 1 : 0);
}

/**
 * Record blockchain operation metrics
 * 
 * @param chainId The chain ID
 * @param operation The operation type
 * @param isMainnet Whether the chain is mainnet
 * @param startTime The start time of the operation (ms)
 * @param success Whether the operation succeeded
 */
export function recordBlockchainOperation(
  chainId: number,
  operation: string,
  isMainnet: boolean,
  startTime: number,
  success: boolean
): void {
  const latency = Date.now() - startTime;
  const status = success ? 'success' : 'failure';
  const mainnetLabel = isMainnet ? 'true' : 'false';
  
  operationLatency.observe({ 
    chain_id: chainId.toString(), 
    operation, 
    mainnet: mainnetLabel, 
    status 
  }, latency);
}

/**
 * Record trade execution metrics
 * 
 * @param chainId The chain ID
 * @param isMainnet Whether the chain is mainnet
 * @param startTime The start time of the operation (ms)
 * @param volumeUsd The trade volume in USD
 * @param success Whether the trade succeeded
 * @param slippagePercent Optional slippage percentage
 * @param feesUsd Optional fees in USD
 */
export function recordTradeExecution(
  chainId: number,
  isMainnet: boolean,
  startTime: number,
  volumeUsd: number,
  success: boolean,
  slippagePercent?: number,
  feesUsd?: number
): void {
  const latency = Date.now() - startTime;
  const status = success ? 'success' : 'failure';
  const mainnetLabel = isMainnet ? 'true' : 'false';
  
  // Record latency and volume
  tradeExecutionLatency.observe({ 
    chain_id: chainId.toString(), 
    mainnet: mainnetLabel, 
    status 
  }, latency);
  
  tradeVolumeUsd.inc({
    chain_id: chainId.toString(),
    mainnet: mainnetLabel,
    status
  }, volumeUsd);
  
  // Record slippage if provided
  if (slippagePercent !== undefined) {
    tradeSlippage.observe({
      chain_id: chainId.toString(),
      mainnet: mainnetLabel
    }, slippagePercent);
  }
  
  // Record fees if provided
  if (feesUsd !== undefined) {
    tradeFees.inc({
      chain_id: chainId.toString(),
      mainnet: mainnetLabel,
      fee_type: 'total'
    }, feesUsd);
  }
}

/**
 * Update adapter queue depth
 * 
 * @param chainId The chain ID
 * @param isMainnet Whether the chain is mainnet
 * @param queueDepth The current queue depth
 */
export function updateAdapterQueueDepth(
  chainId: number,
  isMainnet: boolean,
  queueDepth: number
): void {
  const mainnetLabel = isMainnet ? 'true' : 'false';
  adapterQueueDepth.set({ chain_id: chainId.toString(), mainnet: mainnetLabel }, queueDepth);
}

/**
 * Get the Prometheus metrics registry
 */
export function getMetricsRegistry(): prom.Registry {
  return register;
}

/**
 * Get metrics as a string in Prometheus exposition format
 */
export async function getMetricsAsString(): Promise<string> {
  return await register.metrics();
}

/**
 * Clear all metrics (primarily for testing)
 */
export function clearMetrics(): void {
  register.resetMetrics();
} 