import { logger } from '../utils/logger';
import { TelemetryBus } from '../telemetry/TelemetryBus';
import { ChaosGenerator } from './ChaosGenerator';
import { ChaosSimulationBus } from './ChaosSimulationBus';

/**
 * Configuration for network partition simulation
 */
export interface NetworkPartitionConfig {
  /**
   * Probability of a network partition occurring (0-1)
   */
  partitionProbability: number;
  
  /**
   * Minimum duration of the partition in ms
   */
  minPartitionDurationMs: number;
  
  /**
   * Maximum duration of the partition in ms
   */
  maxPartitionDurationMs: number;
  
  /**
   * Target adapters to affect (e.g. 'ethereum', 'solana', 'cosmos')
   */
  targetAdapters: string[];
  
  /**
   * Whether to log detailed events
   */
  enableDetailedLogs: boolean;
  
  /**
   * Whether to affect all RPC endpoints (vs. just some)
   */
  affectAllEndpoints: boolean;
  
  /**
   * Types of errors to simulate
   */
  errorTypes: ('timeout' | 'connection-reset' | 'invalid-response' | 'high-latency')[];
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: NetworkPartitionConfig = {
  partitionProbability: 0.05, // 5% chance
  minPartitionDurationMs: 10000, // 10 seconds
  maxPartitionDurationMs: 60000, // 1 minute
  targetAdapters: ['ethereum', 'solana', 'cosmos'],
  enableDetailedLogs: true,
  affectAllEndpoints: false,
  errorTypes: ['timeout', 'connection-reset']
};

/**
 * Network Partition Simulator
 * 
 * Creates simulated network partitions to test system resilience
 * when blockchain RPC communication is interrupted or degraded.
 */
export class NetworkPartitionSimulator {
  private config: NetworkPartitionConfig;
  private telemetry: TelemetryBus;
  private chaosSimulationBus: ChaosSimulationBus;
  private chaosGenerator: ChaosGenerator;
  private activePartitions: Map<string, NodeJS.Timeout> = new Map();
  private isEnabled: boolean = false;
  
  /**
   * Constructor
   */
  constructor(
    config: Partial<NetworkPartitionConfig> = {}, 
    chaosGenerator?: ChaosGenerator
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.telemetry = TelemetryBus.getInstance();
    this.chaosSimulationBus = ChaosSimulationBus.getInstance();
    this.chaosGenerator = chaosGenerator || new ChaosGenerator();
    
    this.setupChaosHandlers();
  }
  
  /**
   * Enable the network partition simulator
   */
  public enable(): void {
    if (this.isEnabled) {
      logger.warn('Network partition simulator is already enabled');
      return;
    }
    
    this.isEnabled = true;
    this.log('Network partition simulator enabled');
    
    // Register with chaos generator for periodic triggering
    this.chaosGenerator.registerChaosSource({
      name: 'network-partition',
      probability: this.config.partitionProbability,
      trigger: () => this.triggerRandomPartition()
    });
  }
  
  /**
   * Disable the network partition simulator
   */
  public disable(): void {
    if (!this.isEnabled) {
      logger.warn('Network partition simulator is already disabled');
      return;
    }
    
    this.isEnabled = false;
    this.log('Network partition simulator disabled');
    
    // Cleanup any active partitions
    this.activePartitions.forEach((timeout, id) => {
      clearTimeout(timeout);
      this.endPartition(id);
    });
    
    // Unregister from chaos generator
    this.chaosGenerator.unregisterChaosSource('network-partition');
  }
  
  /**
   * Trigger a network partition on a specific adapter
   */
  public triggerPartition(adapter: string, durationMs?: number): string {
    if (!this.isEnabled) {
      logger.warn('Attempted to trigger partition while simulator is disabled');
      return '';
    }
    
    const partitionId = `partition_${adapter}_${Date.now()}`;
    const duration = durationMs || this.getRandomDuration();
    const errorType = this.getRandomErrorType();
    
    // Simulate the partition
    this.log(`Triggering ${errorType} partition on ${adapter} for ${duration}ms`);
    
    // Notify via simulation bus
    this.chaosSimulationBus.emit('partition.start', {
      id: partitionId,
      adapter,
      duration,
      errorType,
      timestamp: Date.now(),
      affectAllEndpoints: this.config.affectAllEndpoints
    });
    
    // Emit telemetry
    this.telemetry.emit('chaos.network_partition', {
      id: partitionId,
      adapter,
      duration,
      errorType,
      timestamp: Date.now()
    });
    
    // Schedule the end of the partition
    const timeout = setTimeout(() => {
      this.endPartition(partitionId);
    }, duration);
    
    this.activePartitions.set(partitionId, timeout);
    
    return partitionId;
  }
  
  /**
   * Trigger a random partition based on configuration
   */
  public triggerRandomPartition(): string {
    if (!this.isEnabled || this.config.targetAdapters.length === 0) {
      return '';
    }
    
    // Select a random adapter from the configured targets
    const randomAdapterIndex = Math.floor(Math.random() * this.config.targetAdapters.length);
    const adapter = this.config.targetAdapters[randomAdapterIndex];
    
    return this.triggerPartition(adapter);
  }
  
  /**
   * Manually end a specific partition
   */
  public endPartition(partitionId: string): void {
    if (!this.activePartitions.has(partitionId)) {
      logger.warn(`Attempted to end non-existent partition: ${partitionId}`);
      return;
    }
    
    // Clear the timeout if it exists
    const timeout = this.activePartitions.get(partitionId);
    if (timeout) {
      clearTimeout(timeout);
    }
    
    this.activePartitions.delete(partitionId);
    
    // Notify via simulation bus
    this.chaosSimulationBus.emit('partition.end', {
      id: partitionId,
      timestamp: Date.now()
    });
    
    // Emit telemetry
    this.telemetry.emit('chaos.network_partition_end', {
      id: partitionId,
      timestamp: Date.now()
    });
    
    this.log(`Ended network partition: ${partitionId}`);
  }
  
  /**
   * Get all active partitions
   */
  public getActivePartitions(): string[] {
    return Array.from(this.activePartitions.keys());
  }
  
  /**
   * Setup chain adapter mock handlers
   */
  private setupChaosHandlers(): void {
    // Register network partition handlers with simulation bus
    this.chaosSimulationBus.on('partition.get_active', () => {
      return this.getActivePartitions();
    });
    
    this.chaosSimulationBus.on('partition.request_intercept', (data: any) => {
      // This is used by adapters to check if a request should be intercepted
      const { adapter, endpoint } = data;
      
      // Check if there's an active partition for this adapter
      for (const partitionId of this.activePartitions.keys()) {
        if (partitionId.includes(`partition_${adapter}`)) {
          // If not affecting all endpoints, use probability
          if (!this.config.affectAllEndpoints && Math.random() > 0.7) {
            return false;
          }
          
          return true;
        }
      }
      
      return false;
    });
  }
  
  /**
   * Get a random duration for the partition
   */
  private getRandomDuration(): number {
    return Math.floor(
      Math.random() * 
      (this.config.maxPartitionDurationMs - this.config.minPartitionDurationMs) + 
      this.config.minPartitionDurationMs
    );
  }
  
  /**
   * Get a random error type
   */
  private getRandomErrorType(): 'timeout' | 'connection-reset' | 'invalid-response' | 'high-latency' {
    const index = Math.floor(Math.random() * this.config.errorTypes.length);
    return this.config.errorTypes[index];
  }
  
  /**
   * Log if detailed logging is enabled
   */
  private log(message: string): void {
    if (this.config.enableDetailedLogs) {
      logger.info(`[NetworkPartitionSimulator] ${message}`);
    }
  }
} 