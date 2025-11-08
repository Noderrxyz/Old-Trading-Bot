// This file provides the type definitions and documentation for implementing
// a React hook for WebSocket communication with the analytics telemetry system.
// 
// To implement this hook in your project:
// 1. Install the necessary dependencies (React)
// 2. Configure proper TypeScript settings
// 3. Use these types and implement the hook following the implementation notes

/**
 * Types of telemetry messages
 */
export enum TelemetryMessageType {
  Trendline = 'trendline',
  PerformanceSummary = 'performance_summary',
  ExecutionStats = 'execution_stats',
  AnomalyAlert = 'anomaly',
  TrustScoreUpdate = 'trust_score',
  HealthCheck = 'health_check',
}

/**
 * WebSocket message from the server
 */
export interface WebSocketMessage<T = any> {
  message_type: string;
  source: string;
  timestamp: string;
  payload: T;
}

/**
 * Subscription request to send to the server
 */
export interface SubscriptionRequest {
  action: 'subscribe' | 'unsubscribe' | 'list';
  strategy_ids: string[];
  message_types: string[];
  auth_token?: string;
}

/**
 * Client message to send to the server
 */
export interface ClientMessage {
  message_type: 'subscription' | 'ping' | 'auth';
  payload: any;
}

/**
 * Hook options for useTelemetry
 */
export interface TelemetryOptions {
  /** WebSocket URL */
  wsUrl: string;
  /** Authentication token (if required) */
  authToken?: string;
  /** Initial strategies to subscribe to */
  initialStrategyIds?: string[];
  /** Initial message types to subscribe to */
  initialMessageTypes?: TelemetryMessageType[];
  /** Auto-reconnect if connection is lost */
  autoReconnect?: boolean;
  /** Reconnect delay in milliseconds */
  reconnectDelay?: number;
  /** Ping interval in milliseconds */
  pingInterval?: number;
  /** Callback when connection is established */
  onConnect?: () => void;
  /** Callback when connection is lost */
  onDisconnect?: () => void;
  /** Callback for message processing errors */
  onError?: (error: any) => void;
}

/**
 * Hook return value
 */
export interface TelemetryHookResult {
  /** Whether the WebSocket is connected */
  isConnected: boolean;
  /** Last message received */
  lastMessage: WebSocketMessage | null;
  /** All messages received, categorized by type and strategy */
  messages: Record<string, Record<string, WebSocketMessage[]>>;
  /** Subscribe to strategies and message types */
  subscribe: (strategyIds: string[], messageTypes: TelemetryMessageType[]) => void;
  /** Unsubscribe from strategies and message types */
  unsubscribe: (strategyIds: string[], messageTypes: TelemetryMessageType[]) => void;
  /** List current subscriptions */
  listSubscriptions: () => void;
  /** Send a ping to the server */
  ping: () => void;
  /** Manually reconnect (if disconnected) */
  reconnect: () => void;
  /** Manually disconnect */
  disconnect: () => void;
}

/**
 * Implementation notes for useTelemetry hook:
 * 
 * This hook should manage a WebSocket connection to the analytics API
 * and provide functionality to subscribe to real-time telemetry data.
 * 
 * Core functions to implement:
 * - Managing WebSocket connection lifecycle (connect, disconnect, reconnect)
 * - Subscription management (subscribe, unsubscribe, list subscriptions)
 * - Message handling and organization
 * - Automatic reconnection on connection loss
 * - Periodic ping to keep connection alive
 * 
 * Example implementation approach:
 * 
 * 1. Use useState hooks for state management (isConnected, lastMessage, messages)
 * 2. Use useRef hooks for WebSocket and interval references
 * 3. Implement connection handling with useCallback
 * 4. Set up message handling and subscription management
 * 5. Use useEffect for connection initialization and cleanup
 * 
 * Example usage in a component:
 * 
 * ```tsx
 * function TelemetryDashboard() {
 *   const { 
 *     isConnected, 
 *     messages,
 *     subscribe,
 *     unsubscribe
 *   } = useTelemetry({
 *     wsUrl: 'ws://localhost:3000/api/analytics/ws',
 *     authToken: 'your-auth-token',
 *     initialStrategyIds: ['strategy-1', 'strategy-2'],
 *     initialMessageTypes: [
 *       TelemetryMessageType.PerformanceSummary, 
 *       TelemetryMessageType.AnomalyAlert
 *     ],
 *   });
 *   
 *   // Render dashboard with the data
 * }
 * ```
 */ 