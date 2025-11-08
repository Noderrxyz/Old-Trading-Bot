import { TelemetryBus } from '../TelemetryBus';
import { logger } from '../../utils/logger';
import { MarketRegimeClassifier } from '../../regime/MarketRegimeClassifier';
import { RegimeTransitionEngine } from '../../regime/RegimeTransitionEngine';
import { MarketRegime, RegimeTransitionState } from '../../regime/MarketRegimeTypes';

/**
 * Configuration for the Regime Dashboard
 */
export interface RegimeDashboardConfig {
  /**
   * Port to serve the dashboard on
   */
  port: number;

  /**
   * Host to bind to
   */
  host: string;
  
  /**
   * Update interval in milliseconds
   */
  updateIntervalMs: number;
  
  /**
   * Maximum history points to keep per symbol
   */
  maxHistoryPoints: number;
  
  /**
   * Timeout for WebSocket connections
   */
  wsTimeoutMs: number;
  
  /**
   * Symbols to track by default
   */
  defaultSymbols: string[];
  
  /**
   * Enable detailed logging
   */
  enableDetailedLogs: boolean;
}

/**
 * Default dashboard configuration
 */
const DEFAULT_CONFIG: RegimeDashboardConfig = {
  port: 8085,
  host: '0.0.0.0',
  updateIntervalMs: 5000,
  maxHistoryPoints: 1000,
  wsTimeoutMs: 30000,
  defaultSymbols: ['BTC/USD', 'ETH/USD'],
  enableDetailedLogs: false
};

/**
 * Regime dashboard data point
 */
interface RegimeDataPoint {
  timestamp: number;
  primaryRegime: MarketRegime;
  secondaryRegime: MarketRegime | null;
  confidence: number;
  transitionState: RegimeTransitionState;
  volatility: number;
  returns: number;
}

/**
 * Regime transition event
 */
interface TransitionEvent {
  timestamp: number;
  fromRegime: MarketRegime;
  toRegime: MarketRegime;
  confidence: number;
  duration: number;
}

/**
 * Dashboard state by symbol
 */
interface SymbolDashboardState {
  symbol: string;
  currentRegime: MarketRegime;
  confidence: number;
  transitionState: RegimeTransitionState;
  historyPoints: RegimeDataPoint[];
  transitions: TransitionEvent[];
  lastUpdated: number;
}

/**
 * Client connection
 */
interface ClientConnection {
  id: string;
  send: (data: any) => void;
  subscribedSymbols: Set<string>;
  lastActive: number;
  ip: string;
}

/**
 * Regime Dashboard
 * 
 * Provides real-time visualization of market regime classifications
 * and transitions via a WebSocket API and web interface.
 */
export class RegimeDashboard {
  private static instance: RegimeDashboard | null = null;
  private config: RegimeDashboardConfig;
  private telemetry: TelemetryBus;
  private regimeClassifier: MarketRegimeClassifier;
  private transitionEngine: RegimeTransitionEngine;
  
  private server: any = null; // HTTP server
  private wsServer: any = null; // WebSocket server
  private clients: Map<string, ClientConnection> = new Map();
  private dashboardState: Map<string, SymbolDashboardState> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  
  /**
   * Private constructor for singleton pattern
   */
  private constructor(config: Partial<RegimeDashboardConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetry = TelemetryBus.getInstance();
    this.regimeClassifier = MarketRegimeClassifier.getInstance();
    this.transitionEngine = RegimeTransitionEngine.getInstance();
    
    // Initialize default symbol states
    this.config.defaultSymbols.forEach(symbol => {
      this.initializeSymbolState(symbol);
    });
    
    // Set up telemetry handlers
    this.setupTelemetryHandlers();
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config: Partial<RegimeDashboardConfig> = {}): RegimeDashboard {
    if (!RegimeDashboard.instance) {
      RegimeDashboard.instance = new RegimeDashboard(config);
    }
    return RegimeDashboard.instance;
  }
  
  /**
   * Start the dashboard server
   */
  public async start(): Promise<boolean> {
    if (this.isRunning) {
      logger.warn('Regime Dashboard is already running');
      return true;
    }
    
    try {
      // In a full implementation, this would:
      // 1. Create HTTP server for static files
      // 2. Set up WebSocket server for real-time updates
      // 3. Start update interval
      
      this.log(`Starting Regime Dashboard on ${this.config.host}:${this.config.port}`);
      
      // Simulate server and websocket setup
      this.server = { address: () => ({ port: this.config.port }) };
      this.wsServer = { clients: new Set() };
      
      // Start update interval
      this.updateInterval = setInterval(() => {
        this.broadcastUpdates();
      }, this.config.updateIntervalMs);
      
      this.isRunning = true;
      
      // Subscribe to regime transitions
      this.subscribeToRegimeTransitions();
      
      logger.info(`Regime Dashboard started on port ${this.config.port}`);
      return true;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to start Regime Dashboard: ${errorMessage}`, error);
      return false;
    }
  }
  
  /**
   * Stop the dashboard server
   */
  public stop(): void {
    if (!this.isRunning) {
      logger.warn('Regime Dashboard is not running');
      return;
    }
    
    this.log('Stopping Regime Dashboard');
    
    // Clear update interval
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    // Close all connections
    this.clients.forEach(client => {
      try {
        // This would be a proper WebSocket close in real implementation
        this.log(`Closing connection to client ${client.id}`);
      } catch (e) {
        // Ignore errors when closing
      }
    });
    
    this.clients.clear();
    
    // Close server
    if (this.server) {
      // This would be a proper server close in real implementation
      this.server = null;
    }
    
    if (this.wsServer) {
      // This would be a proper WebSocket server close in real implementation
      this.wsServer = null;
    }
    
    this.isRunning = false;
    logger.info('Regime Dashboard stopped');
  }
  
  /**
   * Handle a new client connection
   */
  public handleConnection(client: any, request: any): void {
    const clientId = `client_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const ip = request.socket.remoteAddress || 'unknown';
    
    this.log(`New client connection: ${clientId} from ${ip}`);
    
    // Create client connection object
    const connection: ClientConnection = {
      id: clientId,
      send: (data: any) => {
        // In a real implementation, this would use WebSocket send
        this.log(`Sending data to client ${clientId}`);
      },
      subscribedSymbols: new Set(this.config.defaultSymbols),
      lastActive: Date.now(),
      ip
    };
    
    // Store client
    this.clients.set(clientId, connection);
    
    // Send initial data
    this.sendInitialData(connection);
    
    // Set up message handler
    // In a real implementation, this would handle WebSocket messages
    
    // Set up close handler
    // In a real implementation, this would handle WebSocket close
  }
  
  /**
   * Process client message
   */
  private processClientMessage(clientId: string, message: any): void {
    try {
      const connection = this.clients.get(clientId);
      if (!connection) return;
      
      connection.lastActive = Date.now();
      
      // Parse message
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'subscribe':
          if (data.symbol && typeof data.symbol === 'string') {
            this.subscribeClientToSymbol(connection, data.symbol);
          }
          break;
          
        case 'unsubscribe':
          if (data.symbol && typeof data.symbol === 'string') {
            connection.subscribedSymbols.delete(data.symbol);
          }
          break;
          
        case 'get_symbols':
          this.sendAvailableSymbols(connection);
          break;
          
        default:
          this.log(`Unknown message type: ${data.type}`);
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error processing client message: ${errorMessage}`, error);
    }
  }
  
  /**
   * Subscribe client to a symbol
   */
  private subscribeClientToSymbol(client: ClientConnection, symbol: string): void {
    if (!client.subscribedSymbols.has(symbol)) {
      client.subscribedSymbols.add(symbol);
      
      // Initialize symbol state if needed
      if (!this.dashboardState.has(symbol)) {
        this.initializeSymbolState(symbol);
      }
      
      // Send initial data for this symbol
      const symbolState = this.dashboardState.get(symbol);
      if (symbolState) {
        client.send(JSON.stringify({
          type: 'symbol_data',
          data: this.formatSymbolState(symbolState)
        }));
      }
    }
  }
  
  /**
   * Send available symbols to client
   */
  private sendAvailableSymbols(client: ClientConnection): void {
    const symbols = Array.from(this.dashboardState.keys());
    
    client.send(JSON.stringify({
      type: 'available_symbols',
      data: symbols
    }));
  }
  
  /**
   * Send initial data to a client
   */
  private sendInitialData(client: ClientConnection): void {
    // Send dashboard overview
    const overview = this.getDashboardOverview();
    client.send(JSON.stringify({
      type: 'dashboard_overview',
      data: overview
    }));
    
    // Send data for subscribed symbols
    client.subscribedSymbols.forEach(symbol => {
      const symbolState = this.dashboardState.get(symbol);
      if (symbolState) {
        client.send(JSON.stringify({
          type: 'symbol_data',
          data: this.formatSymbolState(symbolState)
        }));
      }
    });
  }
  
  /**
   * Broadcast updates to all clients
   */
  private broadcastUpdates(): void {
    if (this.clients.size === 0) return;
    
    // For each symbol, send updates to subscribed clients
    this.dashboardState.forEach((state, symbol) => {
      // Only send if there are updates
      if (state.lastUpdated > Date.now() - this.config.updateIntervalMs * 2) {
        const formattedData = this.formatSymbolState(state);
        
        // Send to all subscribed clients
        this.clients.forEach(client => {
          if (client.subscribedSymbols.has(symbol)) {
            client.send(JSON.stringify({
              type: 'symbol_update',
              data: formattedData
            }));
          }
        });
      }
    });
    
    // Clean up inactive clients
    this.cleanupInactiveClients();
  }
  
  /**
   * Format symbol state for sending to clients
   */
  private formatSymbolState(state: SymbolDashboardState): any {
    // Simplify and format data for transmission
    return {
      symbol: state.symbol,
      currentRegime: state.currentRegime,
      confidence: state.confidence,
      transitionState: state.transitionState,
      // Send limited history to avoid large payloads
      history: state.historyPoints.slice(-50),
      transitions: state.transitions.slice(-10),
      lastUpdated: state.lastUpdated
    };
  }
  
  /**
   * Clean up inactive clients
   */
  private cleanupInactiveClients(): void {
    const now = Date.now();
    const inactiveTimeout = this.config.wsTimeoutMs;
    
    // Find inactive clients
    const inactiveClientIds: string[] = [];
    
    this.clients.forEach((client, id) => {
      if (now - client.lastActive > inactiveTimeout) {
        inactiveClientIds.push(id);
      }
    });
    
    // Remove inactive clients
    inactiveClientIds.forEach(id => {
      this.log(`Removing inactive client: ${id}`);
      this.clients.delete(id);
    });
  }
  
  /**
   * Subscribe to regime transitions
   */
  private subscribeToRegimeTransitions(): void {
    // Listen for regime transitions
    this.transitionEngine.onTransition((transition, symbol) => {
      this.handleRegimeTransition(transition, symbol);
    });
    
    // Listen for regime classifications
    this.transitionEngine.onClassification((classification, symbol) => {
      this.handleRegimeClassification(classification, symbol);
    });
  }
  
  /**
   * Handle a regime transition
   */
  private handleRegimeTransition(transition: any, symbol: string): void {
    // Initialize symbol state if needed
    if (!this.dashboardState.has(symbol)) {
      this.initializeSymbolState(symbol);
    }
    
    const state = this.dashboardState.get(symbol)!;
    
    // Add transition event
    state.transitions.push({
      timestamp: transition.detectedAt,
      fromRegime: transition.fromRegime,
      toRegime: transition.toRegime,
      confidence: transition.confidence,
      duration: transition.transitionDurationMs
    });
    
    // Limit transitions history
    if (state.transitions.length > this.config.maxHistoryPoints) {
      state.transitions = state.transitions.slice(-this.config.maxHistoryPoints);
    }
    
    // Update current regime
    state.currentRegime = transition.toRegime;
    state.lastUpdated = Date.now();
    
    this.log(`Regime transition for ${symbol}: ${transition.fromRegime} -> ${transition.toRegime}`);
    
    // Broadcast update immediately for important events
    this.broadcastSymbolUpdate(symbol);
  }
  
  /**
   * Handle a regime classification
   */
  private handleRegimeClassification(classification: any, symbol: string): void {
    // Initialize symbol state if needed
    if (!this.dashboardState.has(symbol)) {
      this.initializeSymbolState(symbol);
    }
    
    const state = this.dashboardState.get(symbol)!;
    
    // Add data point
    state.historyPoints.push({
      timestamp: classification.timestamp,
      primaryRegime: classification.primaryRegime,
      secondaryRegime: classification.secondaryRegime,
      confidence: classification.confidence,
      transitionState: classification.transitionState,
      volatility: classification.features.volatility20d || 0,
      returns: classification.features.returns5d || 0
    });
    
    // Limit history
    if (state.historyPoints.length > this.config.maxHistoryPoints) {
      state.historyPoints = state.historyPoints.slice(-this.config.maxHistoryPoints);
    }
    
    // Update current state
    state.currentRegime = classification.primaryRegime;
    state.confidence = classification.confidence;
    state.transitionState = classification.transitionState;
    state.lastUpdated = Date.now();
  }
  
  /**
   * Broadcast update for a specific symbol
   */
  private broadcastSymbolUpdate(symbol: string): void {
    const state = this.dashboardState.get(symbol);
    if (!state) return;
    
    const formattedData = this.formatSymbolState(state);
    
    // Send to all subscribed clients
    this.clients.forEach(client => {
      if (client.subscribedSymbols.has(symbol)) {
        client.send(JSON.stringify({
          type: 'symbol_update',
          data: formattedData
        }));
      }
    });
  }
  
  /**
   * Get dashboard overview
   */
  private getDashboardOverview(): any {
    const regimeCounts: Record<string, number> = {};
    const transitionCounts: Record<string, number> = {};
    
    // Count regimes and transitions
    this.dashboardState.forEach(state => {
      // Count current regime
      const regime = state.currentRegime;
      regimeCounts[regime] = (regimeCounts[regime] || 0) + 1;
      
      // Count recent transitions
      state.transitions.forEach(transition => {
        const key = `${transition.fromRegime}->${transition.toRegime}`;
        transitionCounts[key] = (transitionCounts[key] || 0) + 1;
      });
    });
    
    return {
      symbolCount: this.dashboardState.size,
      regimeCounts,
      transitionCounts,
      clientCount: this.clients.size,
      timestamp: Date.now()
    };
  }
  
  /**
   * Initialize state for a symbol
   */
  private initializeSymbolState(symbol: string): void {
    if (this.dashboardState.has(symbol)) return;
    
    this.log(`Initializing dashboard state for symbol: ${symbol}`);
    
    // Create initial state
    const initialState: SymbolDashboardState = {
      symbol,
      currentRegime: MarketRegime.Unknown,
      confidence: 0,
      transitionState: RegimeTransitionState.Ambiguous,
      historyPoints: [],
      transitions: [],
      lastUpdated: Date.now()
    };
    
    // Try to get current regime from classifier
    const currentRegime = this.regimeClassifier.getCurrentRegime(symbol);
    if (currentRegime) {
      initialState.currentRegime = currentRegime.primaryRegime;
      initialState.confidence = currentRegime.confidence;
      initialState.transitionState = currentRegime.transitionState;
      
      // Add initial data point
      initialState.historyPoints.push({
        timestamp: currentRegime.timestamp,
        primaryRegime: currentRegime.primaryRegime,
        secondaryRegime: currentRegime.secondaryRegime,
        confidence: currentRegime.confidence,
        transitionState: currentRegime.transitionState,
        volatility: currentRegime.features.volatility20d || 0,
        returns: currentRegime.features.returns5d || 0
      });
    }
    
    // Get regime history
    const history = this.regimeClassifier.getRegimeHistory(symbol);
    if (history) {
      // Add transition history
      initialState.transitions = history.transitions.map(t => ({
        timestamp: t.detectedAt,
        fromRegime: t.fromRegime,
        toRegime: t.toRegime,
        confidence: t.confidence,
        duration: t.transitionDurationMs
      }));
    }
    
    this.dashboardState.set(symbol, initialState);
  }
  
  /**
   * Set up telemetry handlers
   */
  private setupTelemetryHandlers(): void {
    // Log telemetry events for regime classifications
    this.telemetry.on('regime.classification', (event: any) => {
      // In a real implementation, this would update a telemetry counter
    });
    
    // Log telemetry events for regime transitions
    this.telemetry.on('regime.transition', (event: any) => {
      // In a real implementation, this would update a telemetry counter
    });
  }
  
  /**
   * Log if detailed logging is enabled
   */
  private log(message: string): void {
    if (this.config.enableDetailedLogs) {
      logger.info(`[RegimeDashboard] ${message}`);
    }
  }
} 