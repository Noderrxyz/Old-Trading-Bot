/**
 * Execution status values
 */
export enum ExecutionStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Completed = 'completed',
  Failed = 'failed',
  Rejected = 'rejected',
  Cancelled = 'cancelled',
  PartialFill = 'partial_fill',
}

/**
 * Latency profile points for execution timing
 */
export interface LatencyProfile {
  requestReceived: number;
  strategySelected: number;
  orderCreated: number;
  orderSent: number;
  orderAcknowledged: number;
  orderCompleted: number;
  executionCompleted: number;
}

/**
 * Rejection details when an order is rejected
 */
export interface RejectionDetails {
  reason: string;
  code: string;
  details: Record<string, any>;
  recoverable: boolean;
}

/**
 * Result of an execution
 */
export interface ExecutionResult {
  id: string;
  request_id: string;
  signal_id: string;
  status: ExecutionStatus | string;
  order_id: string | null;
  executed_quantity: number | null;
  average_price: number | null;
  fee_info: string | null;
  fees: number | null;
  fee_currency: string | null;
  timestamp: Date;
  execution_time_ms: number;
  latency_profile: LatencyProfile | null;
  error_message: string | null;
  error_context: string | null;
  realized_pnl: number;
  additional_data: Record<string, any>;
  rejection_details: RejectionDetails | null;
  trust_score: number | null;
} 