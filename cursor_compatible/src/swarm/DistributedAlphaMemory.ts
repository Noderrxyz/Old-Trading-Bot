import { logger } from '../utils/logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { AlphaMemory } from '../memory/AlphaMemory';
import { SwarmCoordinator } from './SwarmCoordinator';
import { EventEmitter } from 'events';

/**
 * Configuration for the distributed alpha memory
 */
export interface DistributedAlphaMemoryConfig {
  /**
   * Unique node ID
   */
  nodeId: string;
  
  /**
   * Geographic region
   */
  region: string;
  
  /**
   * How often to sync memory with peers (ms)
   */
  syncIntervalMs?: number;
  
  /**
   * Whether to replicate all memory entries
   */
  replicateAll?: boolean;
  
  /**
   * Maximum memory entries to sync at once
   */
  maxSyncBatchSize?: number;
  
  /**
   * Strategy records time to live (ms)
   */
  recordTtlMs?: number;
}

/**
 * Memory query for distributed memory
 */
export interface DistributedMemoryQuery {
  /**
   * Symbol to query for
   */
  symbol?: string;
  
  /**
   * Regime type to query for
   */
  regimeType?: string;
  
  /**
   * Strategy type to query for
   */
  strategyType?: string;
  
  /**
   * Minimum performance score
   */
  minPerformanceScore?: number;
  
  /**
   * Maximum number of records to return
   */
  limit?: number;
  
  /**
   * Sort order for results
   */
  sortBy?: 'performance' | 'recency' | 'stability';
  
  /**
   * Node ID to query from
   */
  nodeId?: string;
  
  /**
   * Region to query from
   */
  region?: string;
}

/**
 * Sync operation type
 */
export enum SyncOperationType {
  FULL = 'full',
  INCREMENTAL = 'incremental',
  TARGETED = 'targeted'
}

/**
 * Sync result
 */
export interface SyncResult {
  /**
   * Operation type
   */
  operationType: SyncOperationType;
  
  /**
   * Number of records synced
   */
  recordCount: number;
  
  /**
   * Timestamp of sync
   */
  timestamp: number;
  
  /**
   * Node IDs involved in sync
   */
  nodeIds: string[];
  
  /**
   * Whether sync was successful
   */
  success: boolean;
  
  /**
   * Error if sync failed
   */
  error?: string;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Partial<DistributedAlphaMemoryConfig> = {
  syncIntervalMs: 60000, // 1 minute
  replicateAll: false,
  maxSyncBatchSize: 100,
  recordTtlMs: 7 * 24 * 60 * 60 * 1000 // 7 days
};

/**
 * DistributedAlphaMemory
 * 
 * Implements a distributed storage system for strategy performance data.
 * Synchronizes with other nodes in the swarm to share successful strategy configurations.
 */
export class DistributedAlphaMemory extends EventEmitter {
  private static instance: DistributedAlphaMemory | null = null;
  private config: DistributedAlphaMemoryConfig;
  private localMemory: AlphaMemory;
  private remoteMemories: Map<string, Map<string, any>> = new Map();
  private swarmCoordinator: SwarmCoordinator;
  private telemetryBus: TelemetryBus;
  private syncInterval: NodeJS.Timeout | null = null;
  private lastSyncTime: number = 0;
  private isStarted: boolean = false;
  private pendingRecords: Map<string, any[]> = new Map();
  
  /**
   * Private constructor
   */
  private constructor(config: DistributedAlphaMemoryConfig) {
    super();
    this.config = {
      ...DEFAULT_CONFIG,
      ...config
    } as DistributedAlphaMemoryConfig;
    
    // Initialize dependencies
    this.localMemory = AlphaMemory.getInstance();
    this.telemetryBus = TelemetryBus.getInstance();
    this.swarmCoordinator = SwarmCoordinator.getInstance({
      nodeId: this.config.nodeId,
      region: this.config.region
    });
    
    logger.info(`DistributedAlphaMemory initialized with nodeId: ${this.config.nodeId}`);
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config?: DistributedAlphaMemoryConfig): DistributedAlphaMemory {
    if (!DistributedAlphaMemory.instance) {
      if (!config) {
        throw new Error('DistributedAlphaMemory config required for first initialization');
      }
      DistributedAlphaMemory.instance = new DistributedAlphaMemory(config);
    }
    return DistributedAlphaMemory.instance;
  }
  
  /**
   * Start the distributed memory service
   */
  public async start(): Promise<void> {
    if (this.isStarted) {
      logger.warn('DistributedAlphaMemory already started');
      return;
    }
    
    logger.info('Starting distributed memory service...');
    
    // Set up sync interval
    this.syncInterval = setInterval(() => {
      this.syncWithPeers()
        .catch(error => {
          logger.error('Error syncing with peers:', error);
        });
    }, this.config.syncIntervalMs);
    
    // Register event listeners for swarm events
    this.swarmCoordinator.on('peer_connected', this.handlePeerConnected.bind(this));
    this.swarmCoordinator.on('peer_disconnected', this.handlePeerDisconnected.bind(this));
    
    this.isStarted = true;
    
    // Emit telemetry
    this.telemetryBus.emit('distributed_memory_started', {
      timestamp: Date.now(),
      nodeId: this.config.nodeId,
      region: this.config.region
    });
    
    logger.info('Distributed memory service started');
  }
  
  /**
   * Stop the distributed memory service
   */
  public async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }
    
    // Clear sync interval
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    
    // Remove event listeners
    this.swarmCoordinator.removeAllListeners();
    
    this.isStarted = false;
    
    // Emit telemetry
    this.telemetryBus.emit('distributed_memory_stopped', {
      timestamp: Date.now(),
      nodeId: this.config.nodeId,
      region: this.config.region
    });
    
    logger.info('Distributed memory service stopped');
  }
  
  /**
   * Record strategy performance in distributed memory
   */
  public async recordStrategyPerformance(record: any): Promise<void> {
    // Record in local memory first
    await this.localMemory.recordStrategyPerformance(record);
    
    // Add to pending records for next sync
    const nodeId = record.nodeId || this.config.nodeId;
    if (!this.pendingRecords.has(nodeId)) {
      this.pendingRecords.set(nodeId, []);
    }
    this.pendingRecords.get(nodeId)!.push(record);
    
    // Emit telemetry
    this.telemetryBus.emit('strategy_performance_recorded', {
      timestamp: Date.now(),
      nodeId: this.config.nodeId,
      strategyId: record.strategyId,
      symbol: record.symbol,
      regimeType: record.regimeType,
      performanceScore: record.metrics?.overallScore || 0
    });
    
    // Emit event
    this.emit('record_added', record);
  }
  
  /**
   * Query top performing strategies with distributed awareness
   */
  public async queryTopPerformingStrategies(query: DistributedMemoryQuery): Promise<any[]> {
    // First, query local memory
    const localResults = await this.localMemory.queryTopPerformingStrategies(query);
    
    // If node ID or region is specified and doesn't match this node, only use remote data
    if ((query.nodeId && query.nodeId !== this.config.nodeId) || 
        (query.region && query.region !== this.config.region)) {
      return this.queryRemoteMemories(query);
    }
    
    // Otherwise, merge local and remote results
    const remoteResults = await this.queryRemoteMemories(query);
    
    // Combine and deduplicate results
    const combinedResults = [...localResults, ...remoteResults];
    
    // Deduplicate by strategy ID and parameters hash
    const deduped = this.deduplicateResults(combinedResults);
    
    // Sort according to query preferences
    const sorted = this.sortResults(deduped, query);
    
    // Apply limit if specified
    if (query.limit && query.limit > 0) {
      return sorted.slice(0, query.limit);
    }
    
    return sorted;
  }
  
  /**
   * Sync memory with peers in the swarm
   */
  public async syncWithPeers(): Promise<SyncResult> {
    if (!this.isStarted) {
      throw new Error('Distributed memory service not started');
    }
    
    const result: SyncResult = {
      operationType: SyncOperationType.INCREMENTAL,
      recordCount: 0,
      timestamp: Date.now(),
      nodeIds: [],
      success: false
    };
    
    try {
      // Get connected peers from swarm coordinator
      const connectedPeers = this.swarmCoordinator.getConnectedPeers();
      
      if (connectedPeers.length === 0) {
        logger.debug('No connected peers to sync with');
        result.success = true;
        return result;
      }
      
      // Determine sync operation type based on time since last sync
      const timeSinceLastSync = Date.now() - this.lastSyncTime;
      result.operationType = timeSinceLastSync > 24 * 60 * 60 * 1000 ? // 24 hours
        SyncOperationType.FULL : SyncOperationType.INCREMENTAL;
      
      // Get pending records to sync
      const recordsToSync = this.getPendingRecordsForSync();
      
      // For each peer, perform sync operation
      const syncPromises = connectedPeers.map(peer => this.syncWithPeer(peer, recordsToSync, result.operationType));
      const syncResults = await Promise.allSettled(syncPromises);
      
      // Process results
      let totalRecords = 0;
      const successfulNodeIds: string[] = [];
      
      for (const syncResult of syncResults) {
        if (syncResult.status === 'fulfilled') {
          totalRecords += syncResult.value.recordCount;
          successfulNodeIds.push(syncResult.value.peerId);
        }
      }
      
      result.recordCount = totalRecords;
      result.nodeIds = successfulNodeIds;
      result.success = true;
      
      // Update last sync time
      this.lastSyncTime = Date.now();
      
      // Clear pending records for successful syncs
      for (const nodeId of successfulNodeIds) {
        this.pendingRecords.delete(nodeId);
      }
      
      // Emit telemetry
      this.telemetryBus.emit('memory_sync_completed', {
        timestamp: Date.now(),
        nodeId: this.config.nodeId,
        syncType: result.operationType,
        peerCount: connectedPeers.length,
        recordCount: totalRecords
      });
      
      logger.info(`Memory sync completed: ${totalRecords} records with ${successfulNodeIds.length}/${connectedPeers.length} peers`);
    } catch (error) {
      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);
      
      // Emit telemetry
      this.telemetryBus.emit('memory_sync_failed', {
        timestamp: Date.now(),
        nodeId: this.config.nodeId,
        error: result.error
      });
      
      logger.error('Memory sync failed:', error);
    }
    
    return result;
  }
  
  /**
   * Sync with a specific peer
   */
  private async syncWithPeer(peer: any, records: any[], operationType: SyncOperationType): Promise<{
    peerId: string;
    recordCount: number;
  }> {
    // In a real implementation, this would make network requests
    // For this implementation, we'll simulate network behavior
    
    try {
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 50));
      
      // Simulate peer memory sync
      const peerNodeId = peer.peerId;
      
      // Create or update remote memory storage for this peer
      if (!this.remoteMemories.has(peerNodeId)) {
        this.remoteMemories.set(peerNodeId, new Map());
      }
      const peerMemory = this.remoteMemories.get(peerNodeId)!;
      
      // Generate or get simulated records from the peer
      let receivedRecords: any[];
      
      if (operationType === SyncOperationType.FULL) {
        // For full sync, generate a complete set of simulated records
        receivedRecords = this.generateSimulatedRecords(10, peerNodeId);
      } else {
        // For incremental sync, generate a smaller set
        receivedRecords = this.generateSimulatedRecords(3, peerNodeId);
      }
      
      // Store received records in remote memory
      for (const record of receivedRecords) {
        const key = this.generateRecordKey(record);
        peerMemory.set(key, record);
      }
      
      // Send our records to the peer (simulated - no actual network call)
      
      return {
        peerId: peerNodeId,
        recordCount: receivedRecords.length
      };
    } catch (error) {
      logger.error(`Error syncing with peer ${peer.peerId}:`, error);
      throw error;
    }
  }
  
  /**
   * Query remote memories based on query criteria
   */
  private async queryRemoteMemories(query: DistributedMemoryQuery): Promise<any[]> {
    const results: any[] = [];
    
    // Filter memories by node ID or region if specified
    let memoriesToQuery = Array.from(this.remoteMemories.entries());
    
    if (query.nodeId) {
      memoriesToQuery = memoriesToQuery.filter(([nodeId]) => nodeId === query.nodeId);
    } else if (query.region) {
      // We would need peer region info to filter by region
      // For now, we'll simulate this by assuming node IDs contain region info
      memoriesToQuery = memoriesToQuery.filter(([nodeId]) => nodeId.includes(query.region!));
    }
    
    // Query each remote memory
    for (const [nodeId, memory] of memoriesToQuery) {
      const records = Array.from(memory.values());
      
      // Apply filters
      let filteredRecords = records;
      
      if (query.symbol) {
        filteredRecords = filteredRecords.filter(record => record.symbol === query.symbol);
      }
      
      if (query.regimeType) {
        filteredRecords = filteredRecords.filter(record => record.regimeType === query.regimeType);
      }
      
      if (query.strategyType) {
        filteredRecords = filteredRecords.filter(record => record.strategyType === query.strategyType);
      }
      
      if (query.minPerformanceScore !== undefined) {
        filteredRecords = filteredRecords.filter(record => 
          (record.metrics?.overallScore || 0) >= query.minPerformanceScore!
        );
      }
      
      results.push(...filteredRecords);
    }
    
    return results;
  }
  
  /**
   * Deduplicate results by strategy ID and parameters hash
   */
  private deduplicateResults(results: any[]): any[] {
    const uniqueMap = new Map<string, any>();
    
    for (const record of results) {
      const key = this.generateRecordKey(record);
      
      // If key doesn't exist or new record has better performance, use it
      if (!uniqueMap.has(key) || 
          (record.metrics?.overallScore || 0) > (uniqueMap.get(key).metrics?.overallScore || 0)) {
        uniqueMap.set(key, record);
      }
    }
    
    return Array.from(uniqueMap.values());
  }
  
  /**
   * Sort results according to query preferences
   */
  private sortResults(results: any[], query: DistributedMemoryQuery): any[] {
    const sortBy = query.sortBy || 'performance';
    
    switch (sortBy) {
      case 'performance':
        return results.sort((a, b) => 
          (b.metrics?.overallScore || 0) - (a.metrics?.overallScore || 0)
        );
        
      case 'recency':
        return results.sort((a, b) => 
          (b.timestamp || 0) - (a.timestamp || 0)
        );
        
      case 'stability':
        return results.sort((a, b) => 
          (b.metrics?.stability || 0) - (a.metrics?.stability || 0)
        );
        
      default:
        return results;
    }
  }
  
  /**
   * Get pending records for sync
   */
  private getPendingRecordsForSync(): any[] {
    const records: any[] = [];
    
    for (const nodeRecords of this.pendingRecords.values()) {
      records.push(...nodeRecords);
    }
    
    // Limit to max batch size
    const maxSize = this.config.maxSyncBatchSize || 100;
    if (records.length > maxSize) {
      return records.slice(0, maxSize);
    }
    
    return records;
  }
  
  /**
   * Generate a unique key for a record
   */
  private generateRecordKey(record: any): string {
    // Key includes strategy type, symbol, and a hash of parameters
    const strategyType = record.strategyType || 'unknown';
    const symbol = record.symbol || 'unknown';
    const paramsHash = JSON.stringify(record.parameters || {});
    
    return `${strategyType}:${symbol}:${paramsHash}`;
  }
  
  /**
   * Handle peer connected event
   */
  private handlePeerConnected(peer: any): void {
    logger.debug(`Peer connected: ${peer.peerId}, scheduling memory sync`);
    
    // Schedule a sync with this peer
    setTimeout(() => {
      this.syncWithPeer(peer, this.getPendingRecordsForSync(), SyncOperationType.INCREMENTAL)
        .catch(error => {
          logger.error(`Error in initial sync with peer ${peer.peerId}:`, error);
        });
    }, 1000); // 1 second delay before initial sync
  }
  
  /**
   * Handle peer disconnected event
   */
  private handlePeerDisconnected(peer: any): void {
    logger.debug(`Peer disconnected: ${peer.peerId}`);
    
    // Update remote memory status
    if (this.remoteMemories.has(peer.peerId)) {
      // We could mark memory as stale or keep it - for now, we'll keep it
    }
  }
  
  /**
   * Generate simulated records for testing
   */
  private generateSimulatedRecords(count: number, nodeId: string): any[] {
    const records: any[] = [];
    const symbols = ['BTC/USD', 'ETH/USD', 'SOL/USD'];
    const regimeTypes = ['BullishTrend', 'BearishTrend', 'Ranging', 'Volatile'];
    const strategyTypes = ['adaptive', 'momentum', 'meanReversion', 'volatility'];
    
    for (let i = 0; i < count; i++) {
      const symbol = symbols[Math.floor(Math.random() * symbols.length)];
      const regimeType = regimeTypes[Math.floor(Math.random() * regimeTypes.length)];
      const strategyType = strategyTypes[Math.floor(Math.random() * strategyTypes.length)];
      
      records.push({
        strategyId: `sim-strategy-${nodeId}-${i}`,
        strategyType,
        symbol,
        regimeType,
        parameters: {
          param1: Math.random(),
          param2: Math.random() * 10,
          param3: Math.random() > 0.5
        },
        metrics: {
          sharpe: Math.random() * 2,
          drawdown: Math.random() * 0.2,
          winRate: 0.5 + (Math.random() * 0.3),
          pnl: Math.random() * 1000,
          tradeCount: Math.floor(Math.random() * 100) + 10,
          overallScore: Math.random() * 100
        },
        timestamp: Date.now() - Math.floor(Math.random() * 86400000), // Random time in last 24 hours
        nodeId,
        region: nodeId.split('-')[0] // Extract region from node ID
      });
    }
    
    return records;
  }
  
  /**
   * Get the local memory instance
   */
  public getLocalInstance(): AlphaMemory {
    return this.localMemory;
  }
  
  /**
   * Get the last sync time
   */
  public getLastSyncTime(): number {
    return this.lastSyncTime;
  }
  
  /**
   * Get record count (local + remote)
   */
  public async getRecordCount(): Promise<number> {
    // Count local records
    const localCount = await this.localMemory.getStrategyCount();
    
    // Count remote records
    let remoteCount = 0;
    for (const memory of this.remoteMemories.values()) {
      remoteCount += memory.size;
    }
    
    return localCount + remoteCount;
  }
} 