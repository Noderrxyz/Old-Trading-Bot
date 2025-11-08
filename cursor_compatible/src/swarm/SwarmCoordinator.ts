import { logger } from '../utils/logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

/**
 * Configuration for the SwarmCoordinator
 */
export interface SwarmCoordinatorConfig {
  /**
   * Unique node ID
   */
  nodeId: string;
  
  /**
   * Geographic region
   */
  region: string;
  
  /**
   * Optional bootstrap peers to connect to
   */
  bootstrapPeers?: string[];
  
  /**
   * Whether to auto connect to peers
   */
  autoConnect?: boolean;
  
  /**
   * Maximum number of peers to connect to
   */
  maxPeers?: number;
  
  /**
   * Connection timeout in milliseconds
   */
  connectionTimeoutMs?: number;
  
  /**
   * Coordination protocol version
   */
  protocolVersion?: string;
}

/**
 * Information about a peer node
 */
export interface PeerInfo {
  /**
   * Unique peer ID
   */
  peerId: string;
  
  /**
   * Geographic region
   */
  region: string;
  
  /**
   * Connection address
   */
  address: string;
  
  /**
   * Last seen timestamp
   */
  lastSeen: number;
  
  /**
   * Agent count
   */
  agentCount: number;
  
  /**
   * Protocol version
   */
  protocolVersion: string;
  
  /**
   * Connection status
   */
  status: 'connected' | 'disconnected' | 'connecting';
  
  /**
   * Additional metadata
   */
  metadata?: Record<string, any>;
}

/**
 * Coordination request
 */
export interface CoordinationRequest {
  /**
   * Unique node ID
   */
  nodeId: string;
  
  /**
   * Geographic region
   */
  region: string;
  
  /**
   * Timestamp of the request
   */
  timestamp: number;
  
  /**
   * Agent statuses
   */
  agentStatuses: any[];
  
  /**
   * Runtime metrics
   */
  runtimeMetrics: any;
  
  /**
   * Optional command batch
   */
  commands?: any[];
}

/**
 * Coordination response
 */
export interface CoordinationResponse {
  /**
   * Protocol version
   */
  protocolVersion: string;
  
  /**
   * Response status
   */
  status: 'success' | 'error';
  
  /**
   * Timestamp of the response
   */
  timestamp: number;
  
  /**
   * Known peers
   */
  peers?: PeerInfo[];
  
  /**
   * Coordination commands
   */
  commands?: any[];
  
  /**
   * Error message if status is 'error'
   */
  error?: string;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Partial<SwarmCoordinatorConfig> = {
  autoConnect: true,
  maxPeers: 10,
  connectionTimeoutMs: 5000,
  protocolVersion: '1.0.0'
};

/**
 * SwarmCoordinator
 * 
 * Manages coordination between distributed nodes in the swarm.
 * Handles peer discovery, command propagation, and swarm synchronization.
 */
export class SwarmCoordinator extends EventEmitter {
  private static instance: SwarmCoordinator | null = null;
  private config: SwarmCoordinatorConfig;
  private telemetryBus: TelemetryBus;
  private peers: Map<string, PeerInfo> = new Map();
  private connectedPeers: Set<string> = new Set();
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private isJoined: boolean = false;
  private lastCoordinationTime: number = 0;
  private pendingCommands: any[] = [];
  
  /**
   * Private constructor
   */
  private constructor(config: SwarmCoordinatorConfig) {
    super();
    this.config = {
      ...DEFAULT_CONFIG,
      ...config
    } as SwarmCoordinatorConfig;
    
    this.telemetryBus = TelemetryBus.getInstance();
    
    logger.info(`SwarmCoordinator initialized with nodeId: ${this.config.nodeId}`);
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config?: SwarmCoordinatorConfig): SwarmCoordinator {
    if (!SwarmCoordinator.instance) {
      if (!config) {
        throw new Error('SwarmCoordinator config required for first initialization');
      }
      SwarmCoordinator.instance = new SwarmCoordinator(config);
    }
    return SwarmCoordinator.instance;
  }
  
  /**
   * Join the swarm network
   */
  public async joinSwarm(): Promise<void> {
    if (this.isJoined) {
      logger.warn('Already joined swarm network');
      return;
    }
    
    logger.info('Joining swarm network...');
    
    try {
      // In a real implementation, this would establish a network connection
      // to other peer nodes. For this implementation, we'll simulate network behavior.
      
      // Connect to bootstrap peers if provided
      if (this.config.bootstrapPeers && this.config.bootstrapPeers.length > 0) {
        for (const peerAddress of this.config.bootstrapPeers) {
          await this.connectToPeer(peerAddress);
        }
      }
      
      this.isJoined = true;
      
      // Emit telemetry
      this.telemetryBus.emit('swarm_joined', {
        timestamp: Date.now(),
        nodeId: this.config.nodeId,
        region: this.config.region,
        peerCount: this.connectedPeers.size
      });
      
      logger.info(`Joined swarm network with ${this.connectedPeers.size} initial peers`);
      
      // Emit event
      this.emit('joined', {
        timestamp: Date.now(),
        peerCount: this.connectedPeers.size
      });
    } catch (error) {
      // Emit telemetry
      this.telemetryBus.emit('swarm_join_failed', {
        timestamp: Date.now(),
        nodeId: this.config.nodeId,
        region: this.config.region,
        error: error instanceof Error ? error.message : String(error)
      });
      
      logger.error('Failed to join swarm network:', error);
      throw error;
    }
  }
  
  /**
   * Leave the swarm network
   */
  public async leaveSwarm(): Promise<void> {
    if (!this.isJoined) {
      return;
    }
    
    logger.info('Leaving swarm network...');
    
    try {
      // Disconnect from all peers
      for (const peerId of this.connectedPeers) {
        await this.disconnectFromPeer(peerId);
      }
      
      // Clear reconnect timers
      for (const timer of this.reconnectTimers.values()) {
        clearTimeout(timer);
      }
      this.reconnectTimers.clear();
      
      this.isJoined = false;
      
      // Emit telemetry
      this.telemetryBus.emit('swarm_left', {
        timestamp: Date.now(),
        nodeId: this.config.nodeId,
        region: this.config.region
      });
      
      logger.info('Left swarm network');
      
      // Emit event
      this.emit('left', {
        timestamp: Date.now()
      });
    } catch (error) {
      // Emit telemetry
      this.telemetryBus.emit('swarm_leave_failed', {
        timestamp: Date.now(),
        nodeId: this.config.nodeId,
        region: this.config.region,
        error: error instanceof Error ? error.message : String(error)
      });
      
      logger.error('Error leaving swarm network:', error);
      throw error;
    }
  }
  
  /**
   * Connect to a peer
   */
  public async connectToPeer(peerAddress: string): Promise<PeerInfo | null> {
    // In a real implementation, this would establish a network connection
    
    // Generate a simulated peer ID
    const peerId = `peer-${uuidv4()}`;
    
    // Create a mock peer info
    const peerInfo: PeerInfo = {
      peerId,
      region: this.generateRandomRegion(),
      address: peerAddress,
      lastSeen: Date.now(),
      agentCount: Math.floor(Math.random() * 5) + 1,
      protocolVersion: '1.0.0',
      status: 'connecting'
    };
    
    // Store peer info
    this.peers.set(peerId, peerInfo);
    
    try {
      // Simulate connection delay
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Update peer status
      peerInfo.status = 'connected';
      this.peers.set(peerId, peerInfo);
      this.connectedPeers.add(peerId);
      
      // Emit telemetry
      this.telemetryBus.emit('peer_connected', {
        timestamp: Date.now(),
        nodeId: this.config.nodeId,
        peerId,
        peerRegion: peerInfo.region,
        peerAddress: peerAddress
      });
      
      logger.info(`Connected to peer ${peerId} (${peerAddress}) in region ${peerInfo.region}`);
      
      // Emit event
      this.emit('peer_connected', peerInfo);
      
      return peerInfo;
    } catch (error) {
      // Update peer status
      peerInfo.status = 'disconnected';
      this.peers.set(peerId, peerInfo);
      
      // Emit telemetry
      this.telemetryBus.emit('peer_connection_failed', {
        timestamp: Date.now(),
        nodeId: this.config.nodeId,
        peerAddress: peerAddress,
        error: error instanceof Error ? error.message : String(error)
      });
      
      logger.error(`Failed to connect to peer at ${peerAddress}:`, error);
      
      // Schedule reconnect if auto-connect is enabled
      if (this.config.autoConnect) {
        this.scheduleReconnect(peerId);
      }
      
      return null;
    }
  }
  
  /**
   * Disconnect from a peer
   */
  public async disconnectFromPeer(peerId: string): Promise<boolean> {
    const peerInfo = this.peers.get(peerId);
    if (!peerInfo) {
      return false;
    }
    
    try {
      // Simulate disconnection delay
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Update peer status
      peerInfo.status = 'disconnected';
      this.peers.set(peerId, peerInfo);
      this.connectedPeers.delete(peerId);
      
      // Cancel any reconnect timer
      const timer = this.reconnectTimers.get(peerId);
      if (timer) {
        clearTimeout(timer);
        this.reconnectTimers.delete(peerId);
      }
      
      // Emit telemetry
      this.telemetryBus.emit('peer_disconnected', {
        timestamp: Date.now(),
        nodeId: this.config.nodeId,
        peerId,
        peerAddress: peerInfo.address
      });
      
      logger.info(`Disconnected from peer ${peerId} (${peerInfo.address})`);
      
      // Emit event
      this.emit('peer_disconnected', peerInfo);
      
      return true;
    } catch (error) {
      // Emit telemetry
      this.telemetryBus.emit('peer_disconnection_failed', {
        timestamp: Date.now(),
        nodeId: this.config.nodeId,
        peerId,
        peerAddress: peerInfo.address,
        error: error instanceof Error ? error.message : String(error)
      });
      
      logger.error(`Failed to disconnect from peer ${peerId}:`, error);
      return false;
    }
  }
  
  /**
   * Schedule reconnection to a peer
   */
  private scheduleReconnect(peerId: string): void {
    const peerInfo = this.peers.get(peerId);
    if (!peerInfo) {
      return;
    }
    
    // Cancel any existing timer
    const existingTimer = this.reconnectTimers.get(peerId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Schedule reconnect
    const reconnectDelay = Math.floor(Math.random() * 5000) + 5000; // 5-10 seconds
    const timer = setTimeout(async () => {
      logger.info(`Attempting to reconnect to peer ${peerId} (${peerInfo.address})`);
      
      try {
        // Update peer status
        peerInfo.status = 'connecting';
        this.peers.set(peerId, peerInfo);
        
        // Simulate reconnection delay
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Update peer status
        peerInfo.status = 'connected';
        peerInfo.lastSeen = Date.now();
        this.peers.set(peerId, peerInfo);
        this.connectedPeers.add(peerId);
        
        // Emit telemetry
        this.telemetryBus.emit('peer_reconnected', {
          timestamp: Date.now(),
          nodeId: this.config.nodeId,
          peerId,
          peerAddress: peerInfo.address
        });
        
        logger.info(`Reconnected to peer ${peerId} (${peerInfo.address})`);
        
        // Emit event
        this.emit('peer_reconnected', peerInfo);
      } catch (error) {
        // Update peer status
        peerInfo.status = 'disconnected';
        this.peers.set(peerId, peerInfo);
        
        // Schedule another reconnect
        this.scheduleReconnect(peerId);
        
        logger.error(`Failed to reconnect to peer ${peerId}:`, error);
      }
    }, reconnectDelay);
    
    this.reconnectTimers.set(peerId, timer);
  }
  
  /**
   * Coordinate with the swarm
   */
  public async coordinateWithSwarm(request: CoordinationRequest): Promise<CoordinationResponse> {
    if (!this.isJoined) {
      throw new Error('Not joined to swarm network');
    }
    
    logger.debug(`Coordinating with swarm, ${this.connectedPeers.size} connected peers`);
    
    try {
      this.lastCoordinationTime = Date.now();
      
      // Get available peers for coordination
      const availablePeers = Array.from(this.connectedPeers)
        .map(peerId => this.peers.get(peerId))
        .filter(Boolean) as PeerInfo[];
      
      // Simulate coordination with peers
      const coordPromises = availablePeers.map(peer => this.coordinateWithPeer(peer, request));
      const peerResponses = await Promise.allSettled(coordPromises);
      
      // Process successful responses
      const successfulResponses = peerResponses
        .filter((result): result is PromiseFulfilledResult<CoordinationResponse> => result.status === 'fulfilled')
        .map(result => result.value);
      
      // Aggregate commands from peer responses
      const commands = this.aggregateCommands(successfulResponses);
      
      // Combine with pending commands
      const allCommands = [...this.pendingCommands, ...commands];
      this.pendingCommands = [];
      
      // Update peer information
      for (const response of successfulResponses) {
        if (response.peers && response.peers.length > 0) {
          this.updatePeersFromResponse(response);
        }
      }
      
      // Emit telemetry
      this.telemetryBus.emit('swarm_coordination_completed', {
        timestamp: Date.now(),
        nodeId: this.config.nodeId,
        peerCount: availablePeers.length,
        successCount: successfulResponses.length,
        commandCount: allCommands.length
      });
      
      // Create response
      const response: CoordinationResponse = {
        protocolVersion: this.config.protocolVersion || '1.0.0',
        status: 'success',
        timestamp: Date.now(),
        peers: Array.from(this.peers.values()),
        commands: allCommands
      };
      
      return response;
    } catch (error) {
      // Emit telemetry
      this.telemetryBus.emit('swarm_coordination_failed', {
        timestamp: Date.now(),
        nodeId: this.config.nodeId,
        error: error instanceof Error ? error.message : String(error)
      });
      
      logger.error('Error coordinating with swarm:', error);
      
      // Create error response
      return {
        protocolVersion: this.config.protocolVersion || '1.0.0',
        status: 'error',
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Coordinate with a single peer
   */
  private async coordinateWithPeer(peer: PeerInfo, request: CoordinationRequest): Promise<CoordinationResponse> {
    // In a real implementation, this would send a network request to the peer
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 50));
    
    // Update peer last seen time
    peer.lastSeen = Date.now();
    this.peers.set(peer.peerId, peer);
    
    // Generate simulated peer response
    return {
      protocolVersion: peer.protocolVersion,
      status: 'success',
      timestamp: Date.now(),
      peers: this.generateSimulatedPeers(3),
      commands: this.generateSimulatedCommands(Math.floor(Math.random() * 2))
    };
  }
  
  /**
   * Update peers from coordination response
   */
  private updatePeersFromResponse(response: CoordinationResponse): void {
    if (!response.peers) return;
    
    for (const peerInfo of response.peers) {
      const existingPeer = this.peers.get(peerInfo.peerId);
      
      if (!existingPeer) {
        // New peer discovered
        this.peers.set(peerInfo.peerId, peerInfo);
        
        // Emit telemetry
        this.telemetryBus.emit('peer_discovered', {
          timestamp: Date.now(),
          nodeId: this.config.nodeId,
          peerId: peerInfo.peerId,
          peerRegion: peerInfo.region,
          peerAddress: peerInfo.address
        });
        
        logger.info(`Discovered new peer ${peerInfo.peerId} (${peerInfo.address}) in region ${peerInfo.region}`);
        
        // Auto-connect if enabled and we have room for more peers
        if (this.config.autoConnect && 
            this.connectedPeers.size < (this.config.maxPeers || Infinity)) {
          this.connectToPeer(peerInfo.address)
            .catch(error => {
              logger.error(`Failed to connect to discovered peer ${peerInfo.peerId}:`, error);
            });
        }
      } else {
        // Update existing peer info
        this.peers.set(peerInfo.peerId, {
          ...existingPeer,
          lastSeen: Math.max(existingPeer.lastSeen, peerInfo.lastSeen),
          region: peerInfo.region,
          agentCount: peerInfo.agentCount,
          metadata: { ...existingPeer.metadata, ...peerInfo.metadata }
        });
      }
    }
  }
  
  /**
   * Aggregate commands from peer responses
   */
  private aggregateCommands(responses: CoordinationResponse[]): any[] {
    const commands: any[] = [];
    
    for (const response of responses) {
      if (response.commands) {
        commands.push(...response.commands);
      }
    }
    
    // Deduplicate commands based on some unique identifier
    const uniqueCommands = commands.filter((command, index, self) => 
      index === self.findIndex(c => c.id === command.id)
    );
    
    return uniqueCommands;
  }
  
  /**
   * Queue a command to be sent in the next coordination cycle
   */
  public queueCommand(command: any): void {
    this.pendingCommands.push({
      ...command,
      id: command.id || uuidv4(),
      timestamp: Date.now(),
      sourceNodeId: this.config.nodeId
    });
    
    logger.debug(`Queued command: ${command.type}`);
  }
  
  /**
   * Generate simulated peers for testing
   */
  private generateSimulatedPeers(count: number): PeerInfo[] {
    const peers: PeerInfo[] = [];
    
    for (let i = 0; i < count; i++) {
      const peerId = `peer-${uuidv4()}`;
      const region = this.generateRandomRegion();
      
      peers.push({
        peerId,
        region,
        address: `node-${region}-${Math.floor(Math.random() * 1000)}.example.com`,
        lastSeen: Date.now() - Math.floor(Math.random() * 60000),
        agentCount: Math.floor(Math.random() * 5) + 1,
        protocolVersion: '1.0.0',
        status: 'connected'
      });
    }
    
    return peers;
  }
  
  /**
   * Generate simulated commands for testing
   */
  private generateSimulatedCommands(count: number): any[] {
    const commands: any[] = [];
    const commandTypes = ['START_AGENT', 'STOP_AGENT', 'SYNC_GENOME', 'RETIRE_AGENT'];
    
    for (let i = 0; i < count; i++) {
      const type = commandTypes[Math.floor(Math.random() * commandTypes.length)];
      const id = uuidv4();
      
      switch (type) {
        case 'START_AGENT':
          commands.push({
            id,
            type,
            config: {
              symbol: ['BTC/USD', 'ETH/USD', 'SOL/USD'][Math.floor(Math.random() * 3)],
              name: `Agent-${Math.floor(Math.random() * 1000)}`,
              allowMutation: Math.random() > 0.5,
              allowSynchronization: Math.random() > 0.3
            }
          });
          break;
          
        case 'STOP_AGENT':
          commands.push({
            id,
            type,
            agentId: `agent-sim-${uuidv4()}`
          });
          break;
          
        case 'SYNC_GENOME':
          commands.push({
            id,
            type,
            agentId: `agent-sim-${uuidv4()}`,
            genome: {
              strategyType: 'adaptive',
              parameters: {
                param1: Math.random(),
                param2: Math.random() * 10,
                param3: Math.random() > 0.5
              },
              metrics: {
                sharpe: Math.random() * 2,
                drawdown: Math.random() * 0.2,
                winRate: 0.5 + (Math.random() * 0.3)
              },
              version: Math.floor(Math.random() * 10) + 1
            }
          });
          break;
          
        case 'RETIRE_AGENT':
          commands.push({
            id,
            type,
            agentId: `agent-sim-${uuidv4()}`
          });
          break;
      }
    }
    
    return commands;
  }
  
  /**
   * Generate a random region
   */
  private generateRandomRegion(): string {
    const regions = ['us-east', 'us-west', 'eu-west', 'eu-central', 'ap-south', 'ap-northeast'];
    return regions[Math.floor(Math.random() * regions.length)];
  }
  
  /**
   * Update peers manually
   */
  public updatePeers(peers: PeerInfo[]): void {
    for (const peer of peers) {
      this.peers.set(peer.peerId, {
        ...peer,
        lastSeen: Date.now()
      });
    }
  }
  
  /**
   * Get connected peer count
   */
  public getConnectedPeerCount(): number {
    return this.connectedPeers.size;
  }
  
  /**
   * Get all peers
   */
  public getAllPeers(): PeerInfo[] {
    return Array.from(this.peers.values());
  }
  
  /**
   * Get connected peers
   */
  public getConnectedPeers(): PeerInfo[] {
    return Array.from(this.peers.values())
      .filter(peer => peer.status === 'connected');
  }
  
  /**
   * Check if joined to swarm
   */
  public isSwarmJoined(): boolean {
    return this.isJoined;
  }
  
  /**
   * Get last coordination time
   */
  public getLastCoordinationTime(): number {
    return this.lastCoordinationTime;
  }
  
  /**
   * Get node ID
   */
  public getNodeId(): string {
    return this.config.nodeId;
  }
  
  /**
   * Get region
   */
  public getRegion(): string {
    return this.config.region;
  }
} 