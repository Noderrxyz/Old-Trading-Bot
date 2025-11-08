/**
 * Re-exports of types from the telemetry module
 */

// Re-export severity level from Telemetry
export { SeverityLevel } from './Telemetry';

// Re-export types from execution_telemetry.types.ts
export * from './types/execution_telemetry.types';

// Common interface for telemetry data
export interface TelemetryData {
  timestamp: number;
  source: string;
  tags?: Record<string, string>;
  metadata?: Record<string, any>;
}

// Re-export other types needed by consumers
export type { Metric, ErrorRecord, EventRecord } from './Telemetry'; 