/**
 * Telemetry Module Stub
 * 
 * This is a minimal stub implementation of the telemetry system to allow
 * testing of the blockchain adapters without the full telemetry system.
 */

/**
 * Main telemetry interface
 */
export const telemetry = {
  recordMetric: (name, value, tags = {}) => {
    console.log(`[Telemetry] Recording metric ${name}: ${value}`, tags);
  },
  
  recordEvent: (name, source, tags = {}, details = {}) => {
    console.log(`[Telemetry] Recording event ${name} from ${source}`, tags, details);
  },
  
  recordError: (source, error, severity = 1, tags = {}) => {
    console.log(`[Telemetry] Recording error from ${source}: ${error}`, { severity, ...tags });
  }
};

/**
 * Blockchain adapter specific metrics
 */
export const blockchainAdapterMetrics = {
  updateConnectionStatus: (chainId, isConnected) => {
    console.log(`[Telemetry] Blockchain connection status for chain ${chainId}: ${isConnected ? 'connected' : 'disconnected'}`);
  },
  
  recordOperationLatency: (chainId, operation, latencyMs) => {
    console.log(`[Telemetry] Operation ${operation} on chain ${chainId} took ${latencyMs}ms`);
  }
};

/**
 * Record blockchain operation metrics
 */
export function recordBlockchainOperation(chainId, operationType, isMainnet, startTime, success, errorType = null) {
  const latency = Date.now() - startTime;
  console.log(`[Telemetry] Blockchain operation: ${operationType} on chain ${chainId} - success: ${success}, latency: ${latency}ms`);
  
  if (!success && errorType) {
    console.log(`[Telemetry] Blockchain error: ${errorType} on chain ${chainId}`);
  }
}

/**
 * Update blockchain status
 */
export function updateBlockchainStatus(chainId, isMainnet, connected, blockHeight, gasPrice) {
  console.log(`[Telemetry] Blockchain status for chain ${chainId}: connected=${connected}, block=${blockHeight}, gas=${gasPrice}`);
}

/**
 * Update circuit breaker state
 */
export function updateCircuitBreakerState(chainId, isMainnet, isOpen) {
  console.log(`[Telemetry] Circuit breaker for chain ${chainId} is now ${isOpen ? 'OPEN' : 'CLOSED'}`);
}

/**
 * Record trade execution
 */
export function recordTradeExecution(chainId, fromAsset, toAsset, isMainnet, startTime, volumeUsd, success) {
  const duration = Date.now() - startTime;
  console.log(`[Telemetry] Trade execution on chain ${chainId}: ${fromAsset} → ${toAsset}, volume: $${volumeUsd}, duration: ${duration}ms, success: ${success}`);
}

/**
 * Record RPC call
 */
export function recordRpcCall(chainId, method, isMainnet, startTime, retry) {
  const duration = Date.now() - startTime;
  console.log(`[Telemetry] RPC call ${method} on chain ${chainId} took ${duration}ms, retry: ${retry}`);
} 