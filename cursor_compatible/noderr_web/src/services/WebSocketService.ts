/**
 * WebSocket Service
 * 
 * Service for managing WebSocket connections and broadcasting federation updates
 */

/**
 * Event types for federation WebSocket messages
 */
export type FederatedEvent =
  | { type: "REBALANCE_PROPOSAL"; source: string; target: string; amount: number; reason: string }
  | { type: "SLASH_ENFORCED"; cluster: string; amount: number; reason: string; confidence: number }
  | { type: "TREASURY_UPDATE"; cluster: string; balance: number; previousBalance: number }
  | { type: "TRUST_VIOLATION"; cluster: string; violation: string; severity: number };

/**
 * WebSocket service for federation events
 */
export class WebSocketService {
  private static instance: WebSocketService;
  private socket: WebSocket | null = null;
  private reconnectInterval: number = 3000;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private eventListeners: Map<string, ((event: FederatedEvent) => void)[]> = new Map();
  private url: string;
  
  /**
   * Create a new WebSocket service
   * @param url WebSocket connection URL
   */
  private constructor(url: string = `ws://${window.location.host}/ws/federation`) {
    this.url = url;
  }

  /**
   * Get the WebSocket service instance (singleton)
   */
  public static getInstance(url?: string): WebSocketService {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService(url);
    }
    return WebSocketService.instance;
  }

  /**
   * Connect to the WebSocket server
   */
  public connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => {
      console.log('Federation WebSocket connection established');
      this.reconnectAttempts = 0;
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as FederatedEvent;
        this.dispatchEvent(data);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    this.socket.onerror = (error) => {
      console.error('Federation WebSocket error:', error);
    };

    this.socket.onclose = () => {
      console.log('Federation WebSocket connection closed');
      this.handleReconnect();
    };
  }

  /**
   * Handle WebSocket reconnection
   */
  private handleReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        this.connect();
      }, this.reconnectInterval);
    } else {
      console.error('Max reconnection attempts reached. Please refresh the page.');
    }
  }

  /**
   * Disconnect from the WebSocket server
   */
  public disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  /**
   * Add event listener for federation events
   * @param eventType Event type to listen for, or "all" for all events
   * @param callback Callback function to invoke when event is received
   */
  public addEventListener(eventType: string, callback: (event: FederatedEvent) => void): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType)?.push(callback);
  }

  /**
   * Remove event listener
   * @param eventType Event type
   * @param callback Callback function to remove
   */
  public removeEventListener(eventType: string, callback: (event: FederatedEvent) => void): void {
    if (!this.eventListeners.has(eventType)) return;
    
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Dispatch event to registered listeners
   * @param event Event to dispatch
   */
  private dispatchEvent(event: FederatedEvent): void {
    // Dispatch to specific event type listeners
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach(callback => callback(event));
    }
    
    // Dispatch to "all" listeners
    const allListeners = this.eventListeners.get('all');
    if (allListeners) {
      allListeners.forEach(callback => callback(event));
    }
  }

  /**
   * Check if WebSocket is connected
   */
  public isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }
} 